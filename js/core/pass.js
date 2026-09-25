/* 드럼 출석부 — core/pass.js (v1.1)
 * 이용권 = 한 달 횟수 충전. 모든 이용권은 매달 1일 기준 '월'(YYYY-MM)에 붙는다(등록일 기준 아님).
 *   보유 횟수 = 그 달 발급 count 합 + 수동 조정(±1)
 *   사용 = 그 달 출석(present·late) + 결석(absent = 당일 취소, 차감·금액 포함). 공결·휴강·기록 없는 수업은 사용 아님.
 *   회당 금액 = 그 달 발급 금액 합 ÷ 발급 횟수 합(조정 제외, 0이면 0)
 *   사용 금액 = 회당 금액 × 사용 횟수, 남은 횟수 가치 = 회당 금액 × 남은 횟수(0 미만이면 0)
 * 저장 형식(payments 스토어):
 *   발급 {studentId, date, amount, count, month:'YYYY-MM', productId, productName, method, memo, kind:'issue'}
 *   조정 {studentId, date, amount:0, count:+1|-1, month, kind:'adjust', memo:'횟수 조정'}
 *   v1.0 결제(month 없음)는 결제일의 달 발급으로 읽는다: count>0 이면 그 횟수, 월 정액(months≥1)이면 학생의 월 N회.
 * DOM 없음(node vm 테스트 가능).
 */
(function (DA) {
  'use strict';

  var U = DA.util;
  var P = DA.pass = {};
  var EMPTY = [];
  var YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

  P.DEFAULT_PRODUCTS = [
    { id: 'prod-a', name: '정규반 A', count: 4, amount: 220000, minutes: 50, color: '#D9480F' },
    { id: 'prod-b', name: '정규반 B', count: 3, amount: 195000, minutes: 50, color: '#2563EB' },
    { id: 'prod-s', name: '실속반', count: 4, amount: 180000, minutes: 30, color: '#0D9488' }
  ];
  P.QR_PREFIX = 'DRUMQR:1:';

  function arr(v) { return Array.isArray(v) ? v : EMPTY; }
  function num(v, d) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; }
  function int(v, d) { return Math.round(num(v, d)); }

  P.isYm = function (s) { return typeof s === 'string' && YM_RE.test(s); };
  P.defaultProducts = function () { return P.DEFAULT_PRODUCTS.map(function (p) { return Object.assign({}, p); }); };

  // 설정의 상품 목록을 현재 형식으로(알 수 없는 필드는 보존)
  P.normalizeProducts = function (list) {
    var seen = {};
    return arr(list).filter(function (x) { return x && typeof x === 'object'; }).map(function (x) {
      var y = Object.assign({}, x);
      y.id = (y.id == null || y.id === '') ? U.uid() : String(y.id);
      y.name = y.name == null ? '' : String(y.name);
      y.count = Math.max(0, Math.min(99, int(y.count, 0)));
      y.amount = Math.max(0, int(y.amount, 0));
      y.minutes = Math.max(0, Math.min(600, int(y.minutes, 50)));
      y.color = typeof y.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(y.color) ? y.color.toUpperCase() : '';
      return y;
    }).filter(function (y) { if (seen[y.id]) return false; seen[y.id] = true; return true; });
  };

  P.products = function (settings) { return arr(settings && settings.passProducts); };
  P.product = function (settings, id) {
    var list = P.products(settings);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  // ── 결제 기록 읽기 ────────────────────────────────────
  P.isAdjust = function (p) { return !!p && p.kind === 'adjust'; };

  // 매출(발급 기준)이 잡히는 달
  P.revenueMonth = function (p) {
    if (!p) return '';
    if (P.isYm(p.month)) return p.month;
    return U.isYmd(p.date) ? p.date.slice(0, 7) : '';
  };

  // 발급으로 읽을 수 있으면 {ym, count, amount, legacy}, 아니면 null(조정·체험비 같은 금액만 있는 결제)
  P.issueOf = function (p, student) {
    if (!p || P.isAdjust(p)) return null;
    var ym = P.revenueMonth(p);
    if (!ym) return null;
    var amount = Math.max(0, num(p.amount, 0));
    if (P.isYm(p.month) || p.kind === 'issue') {
      return { ym: ym, count: Math.max(0, int(p.count, 0)), amount: amount, legacy: false };
    }
    // v1.0 결제
    var c = Math.max(0, Math.floor(num(p.count, 0)));
    if (!c && num(p.months, 0) >= 1 && student && student.pass && student.pass.type === 'monthly') {
      c = Math.max(0, Math.floor(num(student.pass.monthlyCount, 0)));
    }
    if (!c) return null;
    return { ym: ym, count: c, amount: amount, legacy: true };
  };

  function isUse(r) { return r && (r.status === 'present' || r.status === 'late' || r.status === 'absent'); }
  function useTime(r) { return (r.signedAt || '') + '|' + ((r.snap && r.snap.start) || '') + '|' + (r.createdAt || ''); }

  // ── 한 학생의 한 달 ───────────────────────────────────
  var memo = new WeakMap();   // attendance 배열 → Map(key → info)
  P.month = function (data, studentId, ym) {
    var att = arr(data && data.attendance), pays = arr(data && data.payments);
    var bucket = memo.get(att);
    if (!bucket) { bucket = new WeakMap(); memo.set(att, bucket); }
    var m2 = bucket.get(pays);
    if (!m2) { m2 = new Map(); bucket.set(pays, m2); }
    var stuArr = arr(data && data.students);
    var key = studentId + '|' + ym + '|' + stuArr.length;
    var hit = m2.get(key);
    if (hit && hit.stuArr === stuArr) return hit.info;
    var info = compute(data, studentId, ym);
    m2.set(key, { stuArr: stuArr, info: info });
    return info;
  };

  function compute(data, studentId, ym) {
    var SC = DA.schedule;
    var student = SC.index.studentsById(data).get(studentId) || null;
    var issues = [], adjusts = [], uses = [];
    var issued = 0, amount = 0, adjust = 0;
    (SC.index.paymentsByStudent(data).get(studentId) || EMPTY).forEach(function (p) {
      if (P.isAdjust(p)) {
        if (P.revenueMonth(p) !== ym) return;
        var d = int(p.count, 0);
        adjust += d;
        adjusts.push(p);
        return;
      }
      var is = P.issueOf(p, student);
      if (!is || is.ym !== ym) return;
      issued += is.count;
      amount += is.amount;
      issues.push(p);
    });
    (SC.index.attendanceByStudent(data).get(studentId) || EMPTY).forEach(function (r) {
      if (r.date && r.date.slice(0, 7) === ym && isUse(r)) uses.push(r);
    });
    uses.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      var x = useTime(a), y = useTime(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
    var attended = 0, absent = 0;
    uses.forEach(function (r) { if (r.status === 'absent') absent++; else attended++; });
    var total = issued + adjust;
    var used = uses.length;
    var remaining = total - used;
    var unit = issued > 0 ? amount / issued : 0;
    var last = issues.length ? issues[issues.length - 1] : null;
    var info = {
      ym: ym, studentId: studentId,
      issued: issued, adjust: adjust, total: total,
      amount: amount, unitPrice: unit,
      used: used, attended: attended, absent: absent,
      remaining: remaining, over: Math.max(0, used - total),
      usedAmount: issued > 0 ? Math.round(amount * used / issued) : 0,
      remainingValue: issued > 0 && remaining > 0 ? Math.round(amount * remaining / issued) : 0,
      hasIssue: issues.length > 0,
      productId: last ? (last.productId || '') : '',
      productName: last ? (last.productName || '') : '',
      issues: issues, adjusts: adjusts, uses: uses
    };
    info.status = P.statusOf(info);
    return info;
  }

  // 'none' 미발급(조정도 없음) | 'ok' 남음 | 'empty' 딱 다 씀 | 'over' 초과
  P.statusOf = function (info) {
    if (!info) return 'none';
    if (!info.hasIssue && !info.adjust && !info.used) return 'none';
    if (info.remaining < 0) return 'over';
    if (info.remaining === 0) return 'empty';
    return 'ok';
  };

  P.monthLabel = function (ym, nowYm) {
    if (ym === nowYm) return '이번 달';
    var y = ym.slice(0, 4), m = +ym.slice(5, 7);
    return (nowYm && nowYm.slice(0, 4) !== y ? y.slice(2) + '년 ' : '') + m + '월';
  };

  // 짧은 표시: '이번 달 2/4회', '미발급', '1회 초과'
  P.label = function (info, nowYm) {
    if (!info) return '—';
    var pre = P.monthLabel(info.ym, nowYm || info.ym);
    if (info.status === 'none') return pre + ' 미발급';
    return pre + ' ' + info.used + '/' + info.total + '회';
  };
  P.remainText = function (info) {
    if (!info || info.status === 'none') return '미발급';
    if (info.remaining < 0) return (-info.remaining) + '회 초과';
    if (info.remaining === 0) return '남은 0회';
    return '남은 ' + info.remaining + '회';
  };

  // schedule.passInfo 가 돌려주는 모양(v1.0 호출부 호환) + 달 정보
  P.info = function (data, student, refYmd, now) {
    var nowYm = U.ym(U.today(now));
    var ym = U.isYmd(refYmd) ? refYmd.slice(0, 7) : nowYm;
    var m = P.month(data, student.id, ym);
    return {
      type: 'month', label: m.status === 'none' ? P.monthLabel(ym, nowYm) + ' 미발급' : P.label(m, nowYm),
      used: m.used, total: m.total, remaining: m.status === 'none' ? null : m.remaining,
      warn: m.status !== 'ok', over: m.over, status: m.status, ym: ym,
      usedAmount: m.usedAmount, amount: m.amount, unitPrice: m.unitPrice, remainingValue: m.remainingValue,
      productName: m.productName
    };
  };

  // 기록 한 건의 사용 금액(그 달 회당 금액)
  P.useAmount = function (data, rec) {
    if (!isUse(rec)) return 0;
    var m = P.month(data, rec.studentId, rec.date.slice(0, 7));
    return m.issued > 0 ? m.amount / m.issued : 0;
  };

  // 하루 요약(오늘 화면): 출석·결석 기록과 사용 금액
  P.day = function (data, ymd) {
    var out = { date: ymd, attended: 0, absent: 0, amount: 0, records: [] };
    arr(data && data.attendance).forEach(function (r) {
      if (!r || r.date !== ymd || !isUse(r)) return;
      out.records.push(r);
      if (r.status === 'absent') out.absent++; else out.attended++;
      out.amount += P.useAmount(data, r);
    });
    out.amount = Math.round(out.amount);
    out.records.sort(function (a, b) { var x = useTime(a), y = useTime(b); return x < y ? -1 : x > y ? 1 : 0; });
    return out;
  };

  // 여러 달·여러 학생 합계. filter(student) → bool
  P.summary = function (data, yms, filter) {
    var SC = DA.schedule;
    var stuById = SC.index.studentsById(data);
    var ids = {};
    arr(data && data.students).forEach(function (s) { if (s && s.id) ids[s.id] = true; });
    arr(data && data.payments).forEach(function (p) { if (p && p.studentId) ids[p.studentId] = true; });
    arr(data && data.attendance).forEach(function (r) { if (r && r.studentId && isUse(r)) ids[r.studentId] = true; });
    var byMonth = yms.map(function (ym) {
      return { ym: ym, label: (+ym.slice(5, 7)) + '월', issuedAmount: 0, issuedCount: 0, adjust: 0, usedAmount: 0, used: 0, attended: 0, absent: 0, remainingValue: 0, students: 0, notIssued: 0 };
    });
    var byStudent = {}, byProduct = {}, totals = { issuedAmount: 0, issuedCount: 0, usedAmount: 0, used: 0, attended: 0, absent: 0, remainingValue: 0, over: 0 };
    var settings = (data && data.settings) || {};
    Object.keys(ids).forEach(function (sid) {
      var s = stuById.get(sid);
      if (filter && !filter(s, sid)) return;
      var e = null;
      yms.forEach(function (ym, i) {
        var m = P.month(data, sid, ym);
        if (m.status === 'none') {
          if (s && s.status === 'active' && SC.isStudentExpected(s, U.monthEnd(ym + '-01'))) byMonth[i].notIssued++;
          return;
        }
        var bm = byMonth[i];
        bm.issuedAmount += m.amount; bm.issuedCount += m.issued; bm.adjust += m.adjust;
        bm.usedAmount += m.usedAmount; bm.used += m.used; bm.attended += m.attended; bm.absent += m.absent;
        bm.remainingValue += m.remainingValue; bm.students++;
        if (!e) e = byStudent[sid] = { studentId: sid, issuedAmount: 0, issuedCount: 0, usedAmount: 0, used: 0, attended: 0, absent: 0, remainingValue: 0, over: 0, months: 0 };
        e.issuedAmount += m.amount; e.issuedCount += m.issued; e.usedAmount += m.usedAmount; e.used += m.used;
        e.attended += m.attended; e.absent += m.absent; e.remainingValue += m.remainingValue; e.over += m.over; e.months++;
        var pid = m.productId || (s && s.courseId) || '';
        var prod = P.product(settings, pid);
        var g = byProduct[pid] || (byProduct[pid] = {
          id: pid, name: prod ? prod.name : (m.productName || '직접 입력'),
          color: prod ? prod.color : '', issuedAmount: 0, issuedCount: 0, usedAmount: 0, used: 0, students: {}, order: prod ? P.products(settings).indexOf(prod) : 999
        });
        if (!prod && m.productName) g.name = m.productName;
        g.issuedAmount += m.amount; g.issuedCount += m.issued; g.usedAmount += m.usedAmount; g.used += m.used; g.students[sid] = true;
      });
      if (e) {
        ['issuedAmount', 'issuedCount', 'usedAmount', 'used', 'attended', 'absent', 'remainingValue', 'over'].forEach(function (k) { totals[k] += e[k]; });
      }
    });
    var products = Object.keys(byProduct).map(function (k) {
      var g = byProduct[k];
      g.students = Object.keys(g.students).length;
      return g;
    }).sort(function (a, b) { return a.order - b.order || U.collate(a.name, b.name); });
    products.forEach(function (g) { delete g.order; });
    return { byMonth: byMonth, byStudent: byStudent, byProduct: products, totals: totals };
  };

  // ── QR ────────────────────────────────────────────────
  P.newToken = function () {
    var s = U.uid().replace(/-/g, '').toUpperCase();
    return s.slice(0, 16);
  };
  P.qrText = function (token) { return P.QR_PREFIX + String(token || ''); };
  // 'DRUMQR:1:<token>' → token, 아니면 null(다른 QR)
  P.parseQr = function (text) {
    var t = String(text == null ? '' : text).trim();
    if (t.indexOf(P.QR_PREFIX) !== 0) return null;
    var tok = t.slice(P.QR_PREFIX.length);
    return /^[0-9A-Za-z_-]{6,64}$/.test(tok) ? tok : null;
  };
  // 'ok' | 'other'(이 학원 QR 아님) | 'noToken'(학원 QR을 아직 안 만듦)
  P.checkQr = function (settings, text) {
    var want = settings && settings.qrToken;
    if (!want) return 'noToken';
    return P.parseQr(text) === want ? 'ok' : 'other';
  };
})(typeof window !== 'undefined' ? (window.DA = window.DA || {}) : (globalThis.DA = globalThis.DA || {}));
