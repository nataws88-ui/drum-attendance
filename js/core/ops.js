/* 드럼 출석부 — core/ops.js (v1.2 운영)
 * 입·퇴원 기록, 운영 현황판, 주간 브리핑, 월간 운영 리포트, 앱 안 알림, 강사 정산. DOM 없음(node vm 테스트 가능).
 *   학생 이력: student.history = [{date, type:'join'|'pause'|'resume'|'leave'|'rejoin', reason, at}]
 *   이력이 없는 옛 학생은 joinDate·pauses·leftDate 로 이력을 추정해 보여 준다(derived:true). 새 사건을 넣을 때 추정 이력을 먼저 저장한다.
 *   강사 정산 방식: settings.teachers[i].pay = {type:'perLesson'|'percent', amount(회당 원), percent(사용 금액의 %)}
 */
(function (DA) {
  'use strict';

  var U = DA.util;
  var O = DA.ops = {};
  var EMPTY = [];

  function arr(v) { return Array.isArray(v) ? v : EMPTY; }
  function num(v, d) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; }
  function SC() { return DA.schedule; }
  function P() { return DA.pass; }
  function isUse(r) { return r && (r.status === 'present' || r.status === 'late' || r.status === 'absent'); }
  function won(n) { return U.fmtMoney(Math.round(n || 0)); }
  function md(ymd) { return (+ymd.slice(5, 7)) + '/' + (+ymd.slice(8, 10)); }
  function ymLabel(ym) { return ym.slice(0, 4) + '년 ' + (+ym.slice(5, 7)) + '월'; }

  O.HISTORY_TYPES = { join: '입회', pause: '휴원', resume: '복귀', leave: '퇴원', rejoin: '재등록' };
  var TYPE_ORDER = { join: 0, rejoin: 1, resume: 2, pause: 3, leave: 4 };

  function sortHist(list) {
    return list.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if ((a.at || '') !== (b.at || '')) return (a.at || '') < (b.at || '') ? -1 : 1;
      return (TYPE_ORDER[a.type] || 0) - (TYPE_ORDER[b.type] || 0);
    });
  }

  // 옛 학생: 등록일·휴원 구간·퇴원일로 이력 추정
  O.derivedHistory = function (s) {
    var out = [];
    if (!s) return out;
    if (U.isYmd(s.joinDate)) out.push({ date: s.joinDate, type: 'join', reason: '', derived: true });
    arr(s.pauses).forEach(function (p) {
      if (!p || !U.isYmd(p.from)) return;
      out.push({ date: p.from, type: 'pause', reason: p.reason || '', derived: true });
      if (U.isYmd(p.to) && !(s.leftDate && p.to >= s.leftDate)) out.push({ date: U.addDays(p.to, 1), type: 'resume', reason: '', derived: true });
    });
    if (U.isYmd(s.leftDate)) out.push({ date: s.leftDate, type: 'leave', reason: '', derived: true });
    return sortHist(out);
  };

  O.historyOf = function (s) {
    if (!s) return [];
    if (Array.isArray(s.history)) {
      return sortHist(s.history.filter(function (e) { return e && U.isYmd(e.date) && O.HISTORY_TYPES[e.type]; })
        .map(function (e) { return Object.assign({}, e, { reason: e.reason == null ? '' : String(e.reason) }); }));
    }
    return O.derivedHistory(s);
  };

  // 새 사건을 붙인 학생 객체(저장은 호출측). 추정 이력은 이때 굳혀서 함께 저장한다.
  O.withHistory = function (s, type, date, reason, atIso) {
    var base = O.historyOf(s).map(function (e) { var y = Object.assign({}, e); delete y.derived; return y; });
    base.push({ date: U.isYmd(date) ? date : U.today(), type: type, reason: String(reason == null ? '' : reason).trim(), at: atIso || U.nowIso() });
    return Object.assign({}, s, { history: sortHist(base) });
  };

  // i번째(historyOf 순서) 사유 고치기 → 새 학생 객체
  O.setHistoryReason = function (s, index, reason) {
    var list = O.historyOf(s).map(function (e) { var y = Object.assign({}, e); delete y.derived; return y; });
    if (!list[index]) return s;
    list[index] = Object.assign({}, list[index], { reason: String(reason == null ? '' : reason).trim() });
    return Object.assign({}, s, { history: list });
  };

  O.missingReason = function (e) { return !!e && e.type === 'leave' && !String(e.reason || '').trim(); };

  // 기간의 이력: {from, to, entries:[{studentId, name, index, date, type, reason, derived, missing}], counts, missing}
  O.historyBetween = function (data, from, to) {
    var entries = [];
    arr(data && data.students).forEach(function (s) {
      if (!s || !s.id) return;
      O.historyOf(s).forEach(function (e, i) {
        if (e.date < from || e.date > to) return;
        entries.push({ studentId: s.id, name: s.name, index: i, date: e.date, type: e.type, reason: e.reason || '', derived: !!e.derived, missing: O.missingReason(e) });
      });
    });
    entries.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : U.collate(a.name, b.name); });
    var counts = { join: 0, pause: 0, resume: 0, leave: 0, rejoin: 0 };
    entries.forEach(function (e) { counts[e.type]++; });
    return { from: from, to: to, entries: entries, counts: counts, missing: entries.filter(function (e) { return e.missing; }) };
  };

  O.historyCSV = function (data, from, to) {
    var h = O.historyBetween(data, from, to);
    var lines = [['날짜', '이름', '구분', '사유', '비고']];
    h.entries.slice().reverse().forEach(function (e) {
      lines.push([e.date, e.name, O.HISTORY_TYPES[e.type], e.reason, e.missing ? '퇴원 사유 없음' : (e.derived ? '예전 기록에서 추정' : '')]);
    });
    return DA.backup.toCSV(lines);
  };

  // ── 운영 현황판 ───────────────────────────────────────
  function listCount(list, key, students, nameList) {
    var m = {};
    students.forEach(function (s) { var k = s[key] || ''; m[k] = (m[k] || 0) + 1; });
    var out = [];
    arr(nameList).forEach(function (x, i) { if (m[x.id]) { out.push({ id: x.id, name: x.name, color: x.color || '', count: m[x.id], order: i }); delete m[x.id]; } });
    Object.keys(m).forEach(function (k) { out.push({ id: k, name: k ? '(지워진 항목)' : '미지정', color: '', count: m[k], order: 999 }); });
    return out.sort(function (a, b) { return a.order - b.order; }).map(function (x) { delete x.order; return x; });
  }

  O.board = function (data, now) {
    var t = U.today(now), ym = t.slice(0, 7), s = (data && data.settings) || {};
    var studs = arr(data && data.students).filter(function (x) { return x && x.id; });
    var active = studs.filter(function (x) { return (x.status || 'active') === 'active'; });
    var paused = studs.filter(function (x) { return x.status === 'paused'; });
    var left = studs.filter(function (x) { return x.status === 'left'; });
    var mh = O.historyBetween(data, ym + '-01', U.monthEnd(t));
    var day = P().day(data, t);
    var bill = DA.billing ? DA.billing.summary(data, now) : null;
    var prac = DA.rooms ? DA.rooms.summary(data, ym + '-01', t, now) : null;
    return {
      date: t, ym: ym, total: studs.length, active: active.length, paused: paused.length, left: left.length,
      byCourse: listCount(active, 'courseId', active, s.courses),
      byTeacher: listCount(active, 'teacherId', active, s.teachers),
      newThisMonth: mh.counts.join + mh.counts.rejoin, leftThisMonth: mh.counts.leave, leftMissing: mh.missing.length,
      todayAttended: day.attended, todayAbsent: day.absent, todayAmount: day.amount,
      billing: bill, practice: prac
    };
  };

  // ── 주간 브리핑(지난주) ─────────────────────────────────
  O.weekRange = function (now, weekStart, offset) {
    var t = U.today(now);
    var from = U.addDays(U.startOfWeek(t, weekStart), 7 * (offset == null ? -1 : offset));
    return { from: from, to: U.addDays(from, 6) };
  };

  function lastAttended(data, sid) {
    var list = SC().index.attendanceByStudent(data).get(sid) || EMPTY, last = '';
    list.forEach(function (r) { if ((r.status === 'present' || r.status === 'late') && r.date > last) last = r.date; });
    return last;
  }

  O.todo = function (data, now) {
    var t = U.today(now), ym = t.slice(0, 7);
    var low = [], away = [], noshow = [];
    arr(data && data.students).forEach(function (s) {
      if (!s || (s.status || 'active') !== 'active') return;
      var m = P().month(data, s.id, ym);
      if (m.hasIssue && m.remaining <= 1) low.push({ studentId: s.id, name: s.name, remaining: m.remaining, total: m.total });
      var last = lastAttended(data, s.id);
      var ref = last || s.joinDate || '';
      if (ref && U.diffDays(ref, t) >= 21) away.push({ studentId: s.id, name: s.name, last: last, days: U.diffDays(ref, t) });
      if (DA.rooms) {
        var pen = DA.rooms.penalty(data, s.id, now);
        var recent = pen.noshows.filter(function (b) { return U.diffDays(b.date, t) <= 30; }).length;
        if (pen.banned || recent >= 2) noshow.push({ studentId: s.id, name: s.name, noshow: recent, points: pen.points, banned: pen.banned, banUntil: pen.banUntil });
      }
    });
    function byN(a, b) { return U.collate(a.name, b.name); }
    low.sort(function (a, b) { return a.remaining - b.remaining || byN(a, b); });
    away.sort(function (a, b) { return b.days - a.days || byN(a, b); });
    noshow.sort(function (a, b) { return b.noshow - a.noshow || byN(a, b); });
    return { lowRemaining: low, longAbsent: away, noshowMany: noshow };
  };

  // range 를 주면 그 주(예: 이번 주·그 전 주), 없으면 지난주. '다음 주 챙길 일'은 늘 지금(now) 기준.
  O.weekly = function (data, now, weekStart, range) {
    var ws = weekStart == null ? (Number(data && data.settings && data.settings.weekStart) === 0 ? 0 : 1) : weekStart;
    var r = range && U.isYmd(range.from) && U.isYmd(range.to) ? { from: range.from, to: range.to } : O.weekRange(now, ws, -1);
    var attended = 0, absent = 0, amount = 0;
    arr(data && data.attendance).forEach(function (rec) {
      if (!isUse(rec) || rec.date < r.from || rec.date > r.to) return;
      if (rec.status === 'absent') absent++; else attended++;
      amount += P().useAmount(data, rec);
    });
    var hist = O.historyBetween(data, r.from, r.to);
    var ym = U.ym(U.today(now));
    var up = DA.billing ? DA.billing.unpaid(data, ym, now) : { students: 0, total: 0, items: [] };
    var pe = DA.billing ? DA.billing.prepayExpiring(data, ym) : { items: [] };
    var prac = DA.rooms ? DA.rooms.summary(data, r.from, r.to, now) : null;
    var out = {
      range: r, attended: attended, absent: absent, usedAmount: Math.round(amount),
      joined: hist.entries.filter(function (e) { return e.type === 'join' || e.type === 'rejoin'; }),
      left: hist.entries.filter(function (e) { return e.type === 'leave'; }),
      leftMissing: hist.missing,
      unpaid: up, prepayExpiring: pe.items, practice: prac, todo: O.todo(data, now)
    };
    out.text = O.weeklyText(data, out);
    return out;
  };

  function names(list, max) {
    var n = list.map(function (x) { return x.name; });
    if (n.length > (max || 6)) return n.slice(0, max || 6).join(', ') + ' 외 ' + (n.length - (max || 6)) + '명';
    return n.join(', ');
  }

  O.weeklyText = function (data, w) {
    var s = (data && data.settings) || {};
    var L = [];
    L.push('[' + (s.academyName || '드럼 학원') + '] 주간 브리핑');
    L.push(U.fmtDate(w.range.from, { weekday: false }) + ' ~ ' + U.fmtDate(w.range.to, { weekday: false }));
    L.push('');
    L.push('· 출석 ' + w.attended + '회 · 당일취소 ' + w.absent + '회 · 사용 금액 ' + won(w.usedAmount));
    L.push('· 신규 ' + w.joined.length + '명' + (w.joined.length ? ' (' + names(w.joined) + ')' : ''));
    L.push('· 퇴원 ' + w.left.length + '명' + (w.left.length ? ' (' + w.left.map(function (e) { return e.name + (e.reason ? ': ' + e.reason : ': 사유 없음'); }).join(', ') + ')' : ''));
    if (w.leftMissing.length) L.push('  ⚠ 퇴원 사유가 비어 있어요 — 확인이 필요해요');
    L.push('· 이번 달 미납 ' + w.unpaid.students + '명 · ' + won(w.unpaid.total));
    if (w.prepayExpiring.length) L.push('· 선납 만료 ' + w.prepayExpiring.length + '명 (' + names(w.prepayExpiring) + ')');
    if (w.practice && (w.practice.total || w.practice.noshow)) L.push('· 연습실 노쇼 ' + w.practice.noshow + '회 / ' + w.practice.total + '회');
    L.push('');
    L.push('다음 주 챙길 일');
    var td = w.todo, any = false;
    if (td.lowRemaining.length) { any = true; L.push('· 이용권 곧 소진: ' + td.lowRemaining.map(function (x) { return x.name + '(' + (x.remaining < 0 ? (-x.remaining) + '회 초과' : '남은 ' + x.remaining + '회') + ')'; }).join(', ')); }
    if (td.longAbsent.length) { any = true; L.push('· 3주 넘게 안 온 학생: ' + td.longAbsent.map(function (x) { return x.name + '(' + x.days + '일)'; }).join(', ')); }
    if (td.noshowMany.length) { any = true; L.push('· 연습실 노쇼 많은 사람: ' + td.noshowMany.map(function (x) { return x.name + '(' + x.noshow + '회' + (x.banned ? ', 예약 제한' : '') + ')'; }).join(', ')); }
    if (!any) L.push('· 특별히 챙길 일이 없어요');
    return L.join('\n');
  };

  // ── 월간 운영 리포트 ───────────────────────────────────
  O.monthly = function (data, ym, now) {
    var t = U.today(now);
    var first = ym + '-01', last = U.monthEnd(first);
    var endRef = last > t ? t : last;
    var sum = P().summary(data, [ym]);
    var bm = sum.byMonth[0];
    var rc = DA.billing ? DA.billing.received(data, ym) : { total: 0, items: [] };
    var up = DA.billing ? DA.billing.unpaid(data, ym, now) : { students: 0, total: 0 };
    var hist = O.historyBetween(data, first, last);
    var startActive = 0, endActive = 0;
    arr(data && data.students).forEach(function (s) {
      if (!s) return;
      if (SC().isStudentExpected(s, first)) startActive++;
      if (endRef >= first && SC().isStudentExpected(s, endRef)) endActive++;
    });
    var prac = DA.rooms ? DA.rooms.summary(data, first, last, now) : null;
    var out = {
      ym: ym, label: ymLabel(ym),
      issuedAmount: bm.issuedAmount, issuedCount: bm.issuedCount, usedAmount: bm.usedAmount, remainingValue: bm.remainingValue,
      attended: bm.attended, absent: bm.absent, received: rc.total, unpaid: up,
      byProduct: sum.byProduct,
      people: { start: startActive, end: endActive, joined: hist.counts.join + hist.counts.rejoin, left: hist.counts.leave, paused: hist.counts.pause, missing: hist.missing.length },
      practice: prac
    };
    out.text = O.monthlyText(data, out);
    return out;
  };

  O.monthlyText = function (data, m) {
    var s = (data && data.settings) || {};
    var L = [];
    L.push('[' + (s.academyName || '드럼 학원') + '] ' + m.label + ' 운영 리포트');
    L.push('');
    L.push('· 매출(발급) ' + won(m.issuedAmount) + ' · 사용 금액 ' + won(m.usedAmount));
    L.push('· 받은 돈 ' + won(m.received) + ' · 미납 ' + m.unpaid.students + '명 ' + won(m.unpaid.total));
    L.push('· 출석 ' + m.attended + '회 · 당일취소 ' + m.absent + '회');
    L.push('· 재원 ' + m.people.start + '명 → ' + m.people.end + '명 (신규 ' + m.people.joined + ' · 퇴원 ' + m.people.left + ' · 휴원 ' + m.people.paused + ')');
    if (m.people.missing) L.push('  ⚠ 퇴원 사유 없음 ' + m.people.missing + '건 — 확인이 필요해요');
    if (m.byProduct.length) {
      L.push('');
      L.push('반별');
      m.byProduct.forEach(function (g) { L.push('· ' + g.name + ': ' + g.students + '명 · 발급 ' + won(g.issuedAmount) + ' · 사용 ' + won(g.usedAmount)); });
    }
    if (m.practice && (m.practice.total || m.practice.booked)) {
      L.push('');
      L.push('연습실: 예약 ' + m.practice.booked + '건 · 노쇼 ' + m.practice.noshow + '회' + (m.practice.rate != null ? ' (' + U.pct(m.practice.rate) + ')' : ''));
    }
    return L.join('\n');
  };

  // ── 앱 안 알림(오늘 화면) ───────────────────────────────
  O.alerts = function (data, now, weekStart) {
    var t = U.today(now);
    var ws = weekStart == null ? (Number(data && data.settings && data.settings.weekStart) === 0 ? 0 : 1) : weekStart;
    var out = [];
    var wk = O.weekRange(now, ws, 0);
    var hist = O.historyBetween(data, wk.from, t);
    if (hist.counts.leave) {
      out.push({
        id: 'leave-' + wk.from + '-' + hist.counts.leave + '-' + hist.missing.length, kind: hist.missing.length ? 'warn' : 'info', icon: 'door',
        title: '이번 주 퇴원 ' + hist.counts.leave + '명' + (hist.missing.length ? ' · 사유 없음 ' + hist.missing.length + '명' : ''),
        text: hist.missing.length ? '퇴원 사유가 비어 있어요. 확인이 필요해요.' : hist.entries.filter(function (e) { return e.type === 'leave'; }).map(function (e) { return e.name + ' — ' + e.reason; }).join(', '),
        route: '#/history'
      });
    }
    if (U.weekday(t) === (ws === 0 ? 0 : 1)) {
      out.push({ id: 'brief-' + wk.from, kind: 'accent', icon: 'bell', title: '이번 주 브리핑이 준비됐어요', text: '지난주 출석·신규·퇴원·미납과 이번 주 챙길 일을 모았어요.', route: '#/report' });
    }
    return out;
  };

  // ── 강사 정산 ───────────────────────────────────────────
  O.PAY_TYPES = { perLesson: '회당 금액', percent: '사용 금액의 %' };

  O.settle = function (data, ym, opts) {
    var o = opts || {};
    var includeAbsent = o.includeAbsent !== false;
    var s = (data && data.settings) || {};
    var teachers = arr(s.teachers);
    var stuById = SC().index.studentsById(data);
    var rows = {}, order = {};
    teachers.forEach(function (tc, i) { order[tc.id] = i; });
    function row(tid) {
      if (rows[tid]) return rows[tid];
      var tc = null;
      for (var i = 0; i < teachers.length; i++) if (teachers[i].id === tid) tc = teachers[i];
      rows[tid] = { teacherId: tid, name: tc ? tc.name : (tid ? '(지워진 강사)' : '강사 미지정'), color: tc ? tc.color : '', pay: tc && tc.pay ? tc.pay : null,
        attended: 0, absent: 0, lessons: 0, usedAmount: 0, issuedAmount: 0, students: {}, payout: null };
      return rows[tid];
    }
    arr(data && data.attendance).forEach(function (r) {
      if (!isUse(r) || !r.date || r.date.slice(0, 7) !== ym) return;
      var st = stuById.get(r.studentId);
      var tid = (r.snap && r.snap.teacherId) || (st && st.teacherId) || '';
      var e = row(tid);
      if (r.status === 'absent') { e.absent++; if (!includeAbsent) return; }
      else e.attended++;
      e.lessons++;
      e.usedAmount += P().useAmount(data, r);
      e.students[r.studentId] = true;
    });
    arr(data && data.students).forEach(function (st) {
      if (!st) return;
      var m = P().month(data, st.id, ym);
      if (!m.amount) return;
      row(st.teacherId || '').issuedAmount += m.amount;
    });
    teachers.forEach(function (tc) { row(tc.id); });
    var list = Object.keys(rows).map(function (k) { return rows[k]; });
    list.forEach(function (e) {
      e.students = Object.keys(e.students).length;
      e.usedAmount = Math.round(e.usedAmount);
      var pay = e.pay;
      if (pay && pay.type === 'percent') { e.payout = Math.round(e.usedAmount * num(pay.percent, 0) / 100); e.basis = '사용 금액 ' + won(e.usedAmount) + ' × ' + num(pay.percent, 0) + '%'; }
      else if (pay && pay.type === 'perLesson' && num(pay.amount, 0) > 0) { e.payout = e.lessons * num(pay.amount, 0); e.basis = e.lessons + '회 × ' + won(pay.amount); }
      else { e.payout = null; e.basis = '정산 방식 미설정'; }
    });
    list = list.filter(function (e) { return e.lessons || e.issuedAmount || order[e.teacherId] != null; });
    list.sort(function (a, b) { return (order[a.teacherId] != null ? order[a.teacherId] : 999) - (order[b.teacherId] != null ? order[b.teacherId] : 999); });
    var totals = { lessons: 0, attended: 0, absent: 0, usedAmount: 0, issuedAmount: 0, payout: 0 };
    list.forEach(function (e) {
      totals.lessons += e.lessons; totals.attended += e.attended; totals.absent += e.absent;
      totals.usedAmount += e.usedAmount; totals.issuedAmount += e.issuedAmount; totals.payout += e.payout || 0;
    });
    var owner = teachers.length <= 1 && !list.some(function (e) { return e.payout != null; });
    return { ym: ym, includeAbsent: includeAbsent, rows: list, totals: totals, owner: owner, ownerNet: totals.usedAmount - totals.payout };
  };

  O.settleCSV = function (res) {
    var lines = [['강사', '출석', '당일취소', '정산 수업 수', '담당 학생', '발급 금액', '사용 금액', '정산 방식', '정산 금액']];
    res.rows.forEach(function (e) {
      lines.push([e.name, e.attended, e.absent, e.lessons, e.students, e.issuedAmount, e.usedAmount, e.basis, e.payout == null ? '' : e.payout]);
    });
    var t = res.totals;
    lines.push(['합계', t.attended, t.absent, t.lessons, '', t.issuedAmount, t.usedAmount, '', t.payout]);
    return DA.backup.toCSV(lines);
  };
})(typeof window !== 'undefined' ? (window.DA = window.DA || {}) : (globalThis.DA = globalThis.DA || {}));
