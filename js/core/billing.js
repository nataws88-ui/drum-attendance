/* 드럼 출석부 — core/billing.js (v1.2 수납)
 * 회비·미납 관리. 이용권 발급(payments kind:'issue')에 결제 상태를 붙인다.
 *   결제 완료(기본·옛 기록): paid 없음 또는 paid:true
 *   미납(나중에 받기):       paid:false, dueDate:'YYYY-MM-DD'  → [결제 받음] 하면 paid:true, paidDate, method
 *   선납(여러 달 한 번에):   달마다 한 건씩, 같은 groupId (memo '선납 1/3' …)
 * 미납자 = ① 미납 표시된 발급(그 달 이전 것 포함) ② 재원생인데 그 달 이용권이 없음(예상 금액 = 반 상품 금액) — 둘을 구분한다.
 * 다음 달 납부 예정 = 재원생 중 다음 달 발급이 없는 사람(+ 다음 달 미납 발급). 선납 만료 = 선납 묶음의 마지막 달이 그 달인 사람.
 * 받은 돈 = 그 달에 결제된 발급(결제일 paidDate, 없으면 발급일 date 기준).
 * DOM 없음(node vm 테스트 가능).
 */
(function (DA) {
  'use strict';

  var U = DA.util;
  var B = DA.billing = {};
  var EMPTY = [];

  function arr(v) { return Array.isArray(v) ? v : EMPTY; }
  function num(v, d) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; }
  function P() { return DA.pass; }
  function SC() { return DA.schedule; }
  function addYm(ym, n) { return U.ym(U.addMonths(ym + '-01', n)); }
  function byName(a, b) { return U.collate(a.name, b.name) || (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0); }
  function nameOf(data, sid) { var s = SC().index.studentsById(data).get(sid); return s ? s.name : '(삭제된 수강생)'; }

  B.addYm = addYm;

  // 발급 기록인가(조정·금액만 있는 옛 결제 제외)
  B.isIssue = function (p) {
    if (!p || P().isAdjust(p)) return false;
    return P().isYm(p.month) || p.kind === 'issue';
  };
  B.isUnpaid = function (p) { return B.isIssue(p) && p.paid === false; };
  B.isPaid = function (p) { return !!p && !P().isAdjust(p) && p.paid !== false; };
  // 결제된 날(받은 돈 집계 기준)
  B.paidDateOf = function (p) {
    if (!B.isPaid(p)) return '';
    return U.isYmd(p.paidDate) ? p.paidDate : (U.isYmd(p.date) ? p.date : '');
  };

  // 그 학생의 반 상품 금액(없으면 마지막 발급 금액, 그것도 없으면 0)
  B.expectedAmount = function (data, student) {
    if (!student) return 0;
    var prod = P().product((data && data.settings) || {}, student.courseId);
    if (prod && prod.amount > 0) return prod.amount;
    var list = (SC().index.paymentsByStudent(data).get(student.id) || EMPTY).filter(B.isIssue);
    return list.length ? Math.max(0, num(list[list.length - 1].amount, 0)) : 0;
  };
  B.productName = function (data, student) {
    var prod = student ? P().product((data && data.settings) || {}, student.courseId) : null;
    return prod ? prod.name : '';
  };

  // 그 달에 돈을 받아야 하는 재원생인가(재원 상태, 그 달 말 이전 등록, 그 달 전에 퇴원하지 않음)
  B.isBillable = function (student, ym) {
    if (!student || (student.status || 'active') !== 'active') return false;
    if (student.joinDate && student.joinDate > U.monthEnd(ym + '-01')) return false;
    if (student.leftDate && student.leftDate < ym + '-01') return false;
    return true;
  };

  B.monthIssues = function (data, sid, ym) {
    var student = SC().index.studentsById(data).get(sid) || null;
    return (SC().index.paymentsByStudent(data).get(sid) || EMPTY).filter(function (p) {
      var is = P().issueOf(p, student);
      return is && is.ym === ym;
    });
  };
  function hasIssue(data, sid, ym) { return B.monthIssues(data, sid, ym).length > 0; }

  function unpaidItem(data, p, today) {
    var due = U.isYmd(p.dueDate) ? p.dueDate : p.date;
    return {
      kind: 'unpaid', paymentId: p.id, studentId: p.studentId, name: nameOf(data, p.studentId),
      ym: P().revenueMonth(p), amount: Math.max(0, num(p.amount, 0)), count: num(p.count, 0), productName: p.productName || '',
      dueDate: due || '', overdue: !!(due && today && due < today), groupId: p.groupId || ''
    };
  }

  // 미납자: {ym, items, unpaid, noIssue, total, unpaidTotal, noIssueTotal, students}
  B.unpaid = function (data, ym, now) {
    var today = U.today(now);
    var unpaid = [], noIssue = [];
    arr(data && data.payments).forEach(function (p) {
      if (!B.isUnpaid(p)) return;
      if (P().revenueMonth(p) > ym) return;       // 다음 달 이후(선납 미수)는 그 달이 되면
      unpaid.push(unpaidItem(data, p, today));
    });
    arr(data && data.students).forEach(function (s) {
      if (!s || !B.isBillable(s, ym)) return;
      if (hasIssue(data, s.id, ym)) return;
      noIssue.push({
        kind: 'noIssue', studentId: s.id, name: s.name, ym: ym,
        amount: B.expectedAmount(data, s), productName: B.productName(data, s), dueDate: ym + '-01', overdue: false
      });
    });
    unpaid.sort(byName); noIssue.sort(byName);
    var ids = {};
    unpaid.concat(noIssue).forEach(function (x) { ids[x.studentId] = true; });
    var ut = U.sum(unpaid, function (x) { return x.amount; }), nt = U.sum(noIssue, function (x) { return x.amount; });
    return {
      ym: ym, items: unpaid.concat(noIssue), unpaid: unpaid, noIssue: noIssue,
      unpaidTotal: ut, noIssueTotal: nt, total: ut + nt, students: Object.keys(ids).length
    };
  };

  // 다음 달(ym) 납부 예정: 발급 없는 재원생(예상 금액) + 그 달 미납 발급
  B.nextDue = function (data, ym, now) {
    var today = U.today(now);
    var items = [];
    arr(data && data.students).forEach(function (s) {
      if (!s || !B.isBillable(s, ym)) return;
      if (hasIssue(data, s.id, ym)) return;
      items.push({ kind: 'noIssue', studentId: s.id, name: s.name, ym: ym, amount: B.expectedAmount(data, s), productName: B.productName(data, s), dueDate: ym + '-01' });
    });
    arr(data && data.payments).forEach(function (p) {
      if (B.isUnpaid(p) && P().revenueMonth(p) === ym) items.push(unpaidItem(data, p, today));
    });
    items.sort(byName);
    return { ym: ym, items: items, total: U.sum(items, function (x) { return x.amount; }), students: U.uniq(items.map(function (x) { return x.studentId; })).length };
  };

  // fromYm 부터 발급이 이어진 마지막 달('' = fromYm 에 발급 없음)
  B.prepaidUntil = function (data, sid, fromYm) {
    if (!hasIssue(data, sid, fromYm)) return '';
    var ym = fromYm;
    for (var i = 0; i < 36 && hasIssue(data, sid, addYm(ym, 1)); i++) ym = addYm(ym, 1);
    return ym;
  };

  // 선납 만료 예정: 그 달 발급이 선납 묶음(groupId)의 일부이고 다음 달 발급이 없는 재원생
  B.prepayExpiring = function (data, ym) {
    var items = [];
    arr(data && data.students).forEach(function (s) {
      if (!s || (s.status || 'active') !== 'active') return;
      var iss = B.monthIssues(data, s.id, ym);
      var grp = iss.filter(function (p) { return !!p.groupId; });
      if (!grp.length || hasIssue(data, s.id, addYm(ym, 1))) return;
      var g = grp[grp.length - 1];
      var months = arr(data.payments).filter(function (p) { return p.groupId === g.groupId; }).map(function (p) { return P().revenueMonth(p); }).sort();
      items.push({
        kind: 'prepay', studentId: s.id, name: s.name, ym: ym, fromYm: months[0] || ym, months: months.length,
        amount: B.expectedAmount(data, s), productName: B.productName(data, s)
      });
    });
    items.sort(byName);
    return { ym: ym, items: items, total: U.sum(items, function (x) { return x.amount; }) };
  };

  // 그 달에 받은 돈(결제일 기준)
  B.received = function (data, ym) {
    var items = [];
    arr(data && data.payments).forEach(function (p) {
      if (!B.isIssue(p) && !(p && !P().isAdjust(p) && num(p.amount, 0) > 0)) return;
      var d = B.paidDateOf(p);
      if (!d || d.slice(0, 7) !== ym) return;
      var amt = Math.max(0, num(p.amount, 0));
      if (!amt) return;
      items.push({
        paymentId: p.id, studentId: p.studentId, name: nameOf(data, p.studentId), date: d, amount: amt,
        method: p.method || '', forYm: P().revenueMonth(p), productName: p.productName || '', groupId: p.groupId || ''
      });
    });
    items.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : U.collate(a.name, b.name); });
    var byMethod = {};
    items.forEach(function (x) { var k = x.method || '기타'; byMethod[k] = (byMethod[k] || 0) + x.amount; });
    return { ym: ym, items: items, total: U.sum(items, function (x) { return x.amount; }), byMethod: byMethod };
  };

  // [결제 받음] 저장할 필드
  B.paidPatch = function (opts) {
    var o = opts || {};
    return { paid: true, paidDate: U.isYmd(o.date) ? o.date : U.today(o.now), method: o.method || '카드' };
  };

  /* 발급 기록 만들기(선납이면 N개월 한 건씩, 같은 groupId)
   * o = {studentId, startYm, months(1~12), productId, productName, count, amount, method, date, memo, paid(bool), dueDate}
   */
  B.buildIssues = function (o) {
    var months = Math.max(1, Math.min(12, Math.round(num(o.months, 1))));
    var gid = months > 1 ? 'grp-' + U.uid().slice(0, 8) : '';
    var out = [];
    for (var i = 0; i < months; i++) {
      var ym = addYm(o.startYm, i);
      var rec = {
        studentId: o.studentId, date: U.isYmd(o.date) ? o.date : U.today(), amount: Math.max(0, Math.round(num(o.amount, 0))),
        count: Math.max(0, Math.round(num(o.count, 0))), months: 0, month: ym,
        productId: o.productId || '', productName: o.productName || '직접 입력',
        method: o.method || '카드', memo: o.memo || '', kind: 'issue'
      };
      if (gid) { rec.groupId = gid; rec.memo = ('선납 ' + (i + 1) + '/' + months + (o.memo ? ' · ' + o.memo : '')); }
      if (o.paid === false) {
        rec.paid = false;
        rec.dueDate = U.isYmd(o.dueDate) ? (i ? U.addMonths(o.dueDate, i) : o.dueDate) : ym + '-01';
      } else {
        rec.paid = true;
        rec.paidDate = rec.date;
      }
      out.push(rec);
    }
    return out;
  };

  // 안내 문자 내용: 설정 문구의 {학원}{이름}{월}{금액}{반}
  B.smsText = function (data, student, item) {
    var s = (data && data.settings) || {};
    var tpl = s.billingSmsTemplate || (DA.store && DA.store.DEFAULT_BILLING_SMS) || '';
    var ym = (item && item.ym) || U.ym(U.today());
    return U.fillTemplate(tpl, {
      '학원': s.academyName || '드럼 학원',
      '이름': student ? student.name : '',
      '월': (+ym.slice(5, 7)) + '월',
      '금액': U.fmtMoney((item && item.amount) || 0),
      '반': B.productName(data, student) || (item && item.productName) || ''
    });
  };

  // 현황판·알림용 한 줄 요약(이번 달)
  B.summary = function (data, now) {
    var ym = U.ym(U.today(now));
    var up = B.unpaid(data, ym, now);
    var rc = B.received(data, ym);
    var nx = B.nextDue(data, addYm(ym, 1), now);
    var pe = B.prepayExpiring(data, ym);
    return {
      ym: ym, unpaidStudents: up.students, unpaidTotal: up.total, unpaidMarked: up.unpaid.length, noIssue: up.noIssue.length,
      received: rc.total, nextDueStudents: nx.students, nextDueTotal: nx.total, prepayExpiring: pe.items.length
    };
  };
})(typeof window !== 'undefined' ? (window.DA = window.DA || {}) : (globalThis.DA = globalThis.DA || {}));
