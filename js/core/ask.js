/* 드럼 출석부 — core/ask.js (v1.2 스마트 검색)
 * 기기 안 규칙 기반 질문 응답. 서버·AI 없음. 데이터에 있는 사실만 답하고, 모르면 "확인이 필요해요".
 *   DA.ask.parse(text, data, now)  → {intent, students:[id], ambiguous:[id], period, course, raw}
 *   DA.ask.answer(text, data, now) → {ok, intent, title, summary, items:[{text, studentId?, amount?, warn?}], total?, warn?, actions:[], suggestions?}
 * 의도: studentMonth(학생 이번 달 수업) · studentUnpaid · studentPractice · headcount(재원·반별·강사별·반 인원) · unpaid(미납자)
 *       prepay(선납 목록) · prepayExpiring(선납 만료) · nextDue(다음 달 납부 예정) · leave(퇴원자) · join(신규) · paused(휴원)
 *       todayAttend(오늘 출석) · revenue(매출·사용 금액) · noshow(연습실 노쇼) · help
 * 기간: 오늘·어제·이번 주·지난 주·다음 주·이번 달·지난 달·다음 달·N월(·YYYY년 N월·작년 N월)·올해
 * 학생 이름: 전체 이름 > 이름만(성 빼고) > 초성(ㄱㅅㅈ). 여러 명이 같게 맞으면 되묻는다.
 * DOM 없음(node vm 테스트 가능).
 */
(function (DA) {
  'use strict';

  var U = DA.util;
  var A = DA.ask = {};
  var EMPTY = [];

  function arr(v) { return Array.isArray(v) ? v : EMPTY; }
  function won(n) { return U.fmtMoney(Math.round(n || 0)); }
  function squash(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
  function md(ymd) { return (+ymd.slice(5, 7)) + '/' + (+ymd.slice(8, 10)); }
  function mLabel(ym, nowYm) {
    if (ym === nowYm) return '이번 달(' + (+ym.slice(5, 7)) + '월)';
    return (nowYm && ym.slice(0, 4) !== nowYm.slice(0, 4) ? ym.slice(0, 4) + '년 ' : '') + (+ym.slice(5, 7)) + '월';
  }
  function addYm(ym, n) { return U.ym(U.addMonths(ym + '-01', n)); }

  A.SUGGESTIONS = [
    '이번 달 미납자 누구야?',
    '재원생 몇 명이야?',
    '반별 인원 알려줘',
    '다음 달 납부 예정자',
    '선납 만료되는 사람',
    '이번 주 퇴원자',
    '오늘 출석한 사람',
    '이번 달 매출 얼마야?',
    '연습실 노쇼 누구야?'
  ];

  /* ---------------- 기간 ---------------- */
  A.parsePeriod = function (text, now) {
    var t = U.today(now), ym = t.slice(0, 7);
    var ws = 1;
    try { ws = Number(DA.store && DA.store.data && DA.store.data.settings && DA.store.data.settings.weekStart) === 0 ? 0 : 1; } catch (e) { ws = 1; }
    var q = squash(text);
    function month(ym2, label) { return { kind: 'month', ym: ym2, from: ym2 + '-01', to: U.monthEnd(ym2 + '-01'), label: label || mLabel(ym2, ym) }; }
    function range(from, to, label, kind) { return { kind: kind || 'range', from: from, to: to, ym: from.slice(0, 7), label: label }; }
    if (/오늘|금일/.test(q)) return range(t, t, '오늘', 'day');
    if (/어제/.test(q)) { var y = U.addDays(t, -1); return range(y, y, '어제', 'day'); }
    var wk = U.startOfWeek(t, ws);
    if (/(지난|저번)주/.test(q)) return range(U.addDays(wk, -7), U.addDays(wk, -1), '지난주', 'week');
    if (/다음주/.test(q)) return range(U.addDays(wk, 7), U.addDays(wk, 13), '다음 주', 'week');
    if (/이번주|금주|이주일?동안/.test(q)) return range(wk, U.addDays(wk, 6), '이번 주', 'week');
    if (/(지난|저번|전)달|지난월|전월/.test(q)) return month(addYm(ym, -1));
    if (/다음달|내달|담달|익월/.test(q)) return month(addYm(ym, 1));
    if (/이번달|이달|금월|당월/.test(q)) return month(ym);
    var m = /(\d{4})년(\d{1,2})월/.exec(q);
    if (m && +m[2] >= 1 && +m[2] <= 12) return month(m[1] + '-' + U.pad2(+m[2]), m[1] + '년 ' + (+m[2]) + '월');
    m = /작년(\d{1,2})월/.exec(q);
    if (m && +m[1] >= 1 && +m[1] <= 12) { var py = +ym.slice(0, 4) - 1; return month(py + '-' + U.pad2(+m[1]), py + '년 ' + (+m[1]) + '월'); }
    m = /(\d{1,2})월/.exec(q);
    if (m && +m[1] >= 1 && +m[1] <= 12) {
      var n = +m[1], cy = +ym.slice(0, 4), cm = +ym.slice(5, 7);
      var yy = n > cm + 3 ? cy - 1 : cy;   // 석 달 뒤까지는 올해(선납·납부 예정), 그보다 뒤면 작년(1월에 '12월' = 작년 12월)
      return month(yy + '-' + U.pad2(n), (yy !== cy ? yy + '년 ' : '') + n + '월');
    }
    if (/올해|금년|올한해/.test(q)) return range(ym.slice(0, 4) + '-01-01', t, '올해', 'year');
    return null;
  };

  /* ---------------- 학생 이름 ---------------- */
  A.findStudents = function (text, data) {
    var q = squash(text);
    var tokens = String(text || '').split(/[\s,.?!~]+/).filter(function (w) { return /^[ㄱ-ㅎ]{2,}$/.test(w); });
    var best = 0, hits = [];
    arr(data && data.students).forEach(function (s) {
      if (!s || !s.name) return;
      var n = squash(s.name), score = 0;
      if (n.length >= 2 && q.indexOf(n) >= 0) score = 3;
      else if (n.length >= 3 && q.indexOf(n.slice(1)) >= 0) score = 2;
      else if (tokens.some(function (tk) { return U.chosung(n) === tk || (n.length >= 3 && U.chosung(n.slice(1)) === tk); })) score = 1;
      if (!score) return;
      if (score > best) { best = score; hits = [s]; }
      else if (score === best) hits.push(s);
    });
    // 같은 이름 전체 일치가 여러 개면 모두(동명이인) — 호출측에서 되묻는다
    return { best: best, list: hits };
  };

  function findCourse(text, data) {
    var q = squash(text), s = (data && data.settings) || {}, hit = null;
    arr(s.courses).forEach(function (c) {
      var n = squash(c && c.name);
      if (n.length >= 2 && q.indexOf(n) >= 0 && (!hit || n.length > squash(hit.name).length)) hit = c;
    });
    return hit;
  }

  /* ---------------- 의도 ---------------- */
  var K = {
    noshow: /노쇼|펑크|벌점|예약제한|안온예약|연습실/,
    prepayEnd: /선납.*(만료|끝나|끝난|끝|종료|마지막)|(만료|끝나).*선납/,
    prepay: /선납|미리낸|미리결제/,
    nextDue: /(다음달|내달|담달|익월).*(납부|낼|내야|예정|수강료|회비|결제|받을)|납부예정|결제예정|낼사람|내야할/,
    unpaid: /미납|안낸|안냈|못낸|밀린|못받은|안받은|미수|연체|수강료안|돈안/,
    leave: /퇴원|그만둔|그만뒀|그만|탈퇴|나간/,
    join: /신규|입회|새로온|새로등록|새로들어|등록한|들어온|신입/,
    paused: /휴원/,
    revenue: /매출|사용금액|수입|벌었|번돈|얼마벌|받은돈|입금|수납액|금액합계|총액|총금액/,
    attend: /출석|왔|온사람|출첵|수업한|레슨한/,
    count: /몇명|인원|재원|학생수|수강생수|몇분|총원|명이야|명있/,
    byCourse: /반별|반마다|반별로|과정별|이용권별|반인원/,
    byTeacher: /강사별|선생님별|강사마다|선생님마다/,
    studentish: /수업|몇회|몇번|횟수|출석|남은|남았|왔|결제|얼마|금액|이용권|언제|며칠|기록|사용/,
    help: /도움|뭘물어|무엇을물어|뭐물어|사용법|어떻게써|예시/
  };

  A.parse = function (text, data, now) {
    var raw = String(text == null ? '' : text).trim();
    var q = squash(raw);
    var period = A.parsePeriod(raw, now);
    var who = A.findStudents(raw, data);
    var course = findCourse(raw, data);
    var intent = null;
    var students = who.list.map(function (s) { return s.id; });
    var ambiguous = [];
    if (who.list.length > 1) { ambiguous = students; }
    if (!q) intent = 'help';
    else if (who.list.length) {
      if (K.noshow.test(q)) intent = 'studentPractice';
      else if (K.unpaid.test(q) || /냈|냈어|납부/.test(q)) intent = 'studentUnpaid';
      else intent = 'studentMonth';
    }
    else if (K.help.test(q)) intent = 'help';
    else if (K.noshow.test(q)) intent = 'noshow';
    else if (K.prepayEnd.test(q)) intent = 'prepayExpiring';
    else if (K.nextDue.test(q)) intent = 'nextDue';
    else if (K.prepay.test(q)) intent = 'prepay';
    else if (K.unpaid.test(q)) intent = 'unpaid';
    else if (K.leave.test(q)) intent = 'leave';
    else if (K.join.test(q)) intent = 'join';
    else if (K.paused.test(q) && !K.count.test(q)) intent = 'paused';
    else if (K.revenue.test(q)) intent = 'revenue';
    else if (K.byCourse.test(q)) intent = 'headcount';
    else if (K.byTeacher.test(q)) intent = 'headcount';
    else if (K.attend.test(q) && (!period || period.kind === 'day')) intent = 'todayAttend';
    else if (K.attend.test(q) && period) intent = 'attendRange';
    else if (K.count.test(q) || course) intent = 'headcount';
    var sub = '';
    if (intent === 'headcount') sub = K.byCourse.test(q) ? 'byCourse' : K.byTeacher.test(q) ? 'byTeacher' : course ? 'course' : 'total';
    return { raw: raw, intent: intent || 'unknown', sub: sub, students: students, ambiguous: ambiguous, period: period, course: course ? course.id : '' };
  };

  /* ---------------- 답 ---------------- */
  function out(intent, title, summary, items, extra) {
    return Object.assign({ ok: true, intent: intent, title: title, summary: summary, items: items || [], actions: [] }, extra || {});
  }
  function need(intent, summary, extra) {
    return Object.assign({ ok: true, intent: intent, title: '확인이 필요해요', summary: summary, items: [], actions: [], warn: true }, extra || {});
  }
  function stuById(data) { return DA.schedule.index.studentsById(data); }

  function monthOf(p, now, dflt) {
    var t = U.today(now);
    if (p && p.kind === 'month') return p.ym;
    if (p && p.ym) return p.ym;
    return dflt || t.slice(0, 7);
  }

  var H = {};

  H.help = function () {
    return out('help', '이렇게 물어보세요', '이름·기간과 함께 물으면 기기 안 기록으로 답해요. 문자 보내기 같은 일은 답 아래 버튼을 눌러야 실행돼요.',
      A.SUGGESTIONS.map(function (s) { return { text: s, ask: s }; }).concat([{ text: '김서준 이번 달 수업 몇 회야?', ask: '' }]), { suggestions: A.SUGGESTIONS.slice() });
  };

  H.studentMonth = function (data, p, now) {
    var s = stuById(data).get(p.students[0]);
    var ym = monthOf(p.period, now), nowYm = U.today(now).slice(0, 7);
    var m = DA.pass.month(data, s.id, ym);
    var label = mLabel(ym, nowYm);
    var items = [];
    if (m.status === 'none') {
      var exp = DA.billing ? DA.billing.expectedAmount(data, s) : 0;
      return need('studentMonth', s.name + ' 님 ' + label + ' 이용권 발급 기록이 없어요. 확인이 필요해요.' +
        (exp && DA.billing && DA.billing.isBillable(s, ym) ? ' 반 기준 예상 금액은 ' + won(exp) + '이에요.' : ''),
        { title: s.name + ' · ' + label, studentId: s.id, items: [{ text: s.name + ' 님 화면 열기', studentId: s.id }] });
    }
    var attDays = m.uses.filter(function (r) { return r.status !== 'absent'; }).map(function (r) { return md(r.date); });
    var absDays = m.uses.filter(function (r) { return r.status === 'absent'; }).map(function (r) { return md(r.date); });
    items.push({ text: '출석 ' + m.attended + '회' + (attDays.length ? ' (' + attDays.join(', ') + ')' : ''), studentId: s.id });
    items.push({ text: '당일취소 ' + m.absent + '회' + (absDays.length ? ' (' + absDays.join(', ') + ')' : '') });
    items.push({ text: '사용 ' + m.used + ' / ' + m.total + '회 · ' + DA.pass.remainText(m) });
    items.push({ text: '사용 금액 ' + won(m.usedAmount) + ' (회당 ' + won(m.unitPrice) + ') / 발급 ' + won(m.amount), amount: m.usedAmount });
    var unpaid = DA.billing ? DA.billing.monthIssues(data, s.id, ym).filter(DA.billing.isUnpaid) : [];
    var payText;
    if (unpaid.length) {
      var ua = U.sum(unpaid, function (x) { return +x.amount || 0; });
      payText = '결제 예정 ' + won(ua) + ' — 아직 미납이에요';
      items.push({ text: payText, warn: true, amount: ua });
    } else {
      payText = '결제 완료 ' + won(m.amount);
      items.push({ text: payText });
    }
    var sum = s.name + ' 님 ' + label + ': 출석 ' + m.attended + '회 · 당일취소 ' + m.absent + '회 · 남은 ' + Math.max(0, m.remaining) + '회' +
      (m.remaining < 0 ? ' (' + (-m.remaining) + '회 초과)' : '') + ' · 회당 ' + won(m.unitPrice) + '.';
    var r = out('studentMonth', s.name + ' · ' + label, sum, items, { studentId: s.id });
    if (unpaid.length && s.phone) r.actions.push({ type: 'sms', studentId: s.id, item: { ym: ym, amount: U.sum(unpaid, function (x) { return +x.amount || 0; }) }, label: s.name + ' 님께 안내 문자' });
    return r;
  };

  H.studentUnpaid = function (data, p, now) {
    var s = stuById(data).get(p.students[0]);
    var ym = monthOf(p.period, now), nowYm = U.today(now).slice(0, 7);
    var up = DA.billing.unpaid(data, ym, now);
    var mine = up.items.filter(function (x) { return x.studentId === s.id; });
    if (!mine.length) {
      var iss = DA.billing.monthIssues(data, s.id, ym);
      return out('studentUnpaid', s.name + ' · ' + mLabel(ym, nowYm), s.name + ' 님은 ' + mLabel(ym, nowYm) + ' 미납이 없어요' + (iss.length ? ' (결제 완료 ' + won(U.sum(iss, function (x) { return +x.amount || 0; })) + ').' : '.'),
        [{ text: s.name + ' 님 화면 열기', studentId: s.id }], { studentId: s.id });
    }
    var items = mine.map(function (x) {
      return { text: (x.kind === 'unpaid' ? (+x.ym.slice(5, 7)) + '월 발급 미납 ' : (+x.ym.slice(5, 7)) + '월 이용권 미발급(예상) ') + won(x.amount), studentId: s.id, amount: x.amount, warn: true };
    });
    var total = U.sum(mine, function (x) { return x.amount; });
    var r = out('studentUnpaid', s.name + ' · 미납', s.name + ' 님 받을 돈 ' + won(total) + '이 있어요.', items, { studentId: s.id, total: total });
    if (s.phone) r.actions.push({ type: 'sms', studentId: s.id, item: { ym: ym, amount: total }, label: s.name + ' 님께 안내 문자' });
    return r;
  };

  H.studentPractice = function (data, p, now) {
    var s = stuById(data).get(p.students[0]);
    if (!DA.rooms) return need('studentPractice', '연습실 기능을 불러오지 못했어요.');
    var pen = DA.rooms.penalty(data, s.id, now);
    var list = DA.rooms.forStudent(data, s.id);
    var items = pen.noshows.slice(-5).reverse().map(function (b) { return { text: '노쇼 ' + md(b.date) + ' ' + b.start, studentId: s.id }; });
    var sum = s.name + ' 님 연습실: 예약 ' + list.filter(function (b) { return b.status !== 'canceled'; }).length + '건 · 노쇼 ' + pen.total + '회 · 벌점 ' + pen.points + '점' +
      (pen.banned ? ' · ' + U.fmtDate(pen.banUntil, { weekday: false }) + '까지 예약 제한' : '') + '.';
    return out('studentPractice', s.name + ' · 연습실', sum, items, { studentId: s.id });
  };

  H.headcount = function (data, p, now) {
    var b = DA.ops.board(data, now);
    var base = '재원 ' + b.active + '명 (휴원 ' + b.paused + '명 · 퇴원 ' + b.left + '명)';
    if (p.sub === 'byCourse') {
      return out('headcount', '반별 재원 인원', base + '.', b.byCourse.map(function (x) { return { text: x.name + ' ' + x.count + '명', value: x.count }; }), { total: b.active });
    }
    if (p.sub === 'byTeacher') {
      return out('headcount', '강사별 재원 인원', base + '.', b.byTeacher.map(function (x) { return { text: x.name + ' ' + x.count + '명', value: x.count }; }), { total: b.active });
    }
    if (p.sub === 'course') {
      var c = null;
      b.byCourse.forEach(function (x) { if (x.id === p.course) c = x; });
      var cs = arr(data.settings && data.settings.courses).filter(function (x) { return x.id === p.course; })[0];
      var name = cs ? cs.name : '그 반';
      var studs = arr(data.students).filter(function (s) { return s && (s.status || 'active') === 'active' && s.courseId === p.course; });
      return out('headcount', name + ' 인원', name + ' 재원 ' + (c ? c.count : 0) + '명이에요.', studs.map(function (s) { return { text: s.name, studentId: s.id }; }), { total: c ? c.count : 0 });
    }
    return out('headcount', '재원생', '지금 ' + base + '이에요.', [
      { text: '이번 달 신규 ' + b.newThisMonth + '명 · 퇴원 ' + b.leftThisMonth + '명' },
      { text: '오늘 출석 ' + b.todayAttended + '명' + (b.todayAbsent ? ' · 당일취소 ' + b.todayAbsent + '명' : '') }
    ], { total: b.active });
  };

  function smsActions(data, items) {
    var acts = [], seen = {};
    items.forEach(function (x) {
      var s = stuById(data).get(x.studentId);
      if (!s || !s.phone || seen[s.id]) return;
      seen[s.id] = true;
      acts.push({ type: 'sms', studentId: s.id, item: { ym: x.ym, amount: x.amount }, label: s.name });
    });
    return acts;
  }

  H.unpaid = function (data, p, now) {
    var ym = monthOf(p.period, now), nowYm = U.today(now).slice(0, 7);
    var up = DA.billing.unpaid(data, ym, now);
    var label = mLabel(ym, nowYm);
    if (!up.items.length) return out('unpaid', label + ' 미납', label + ' 미납자가 없어요. 모두 결제됐어요.', []);
    var items = up.items.map(function (x) {
      return { text: x.name + ' — ' + won(x.amount) + (x.kind === 'unpaid' ? ' (미납 표시' + (x.ym !== ym ? ', ' + (+x.ym.slice(5, 7)) + '월분' : '') + ')' : ' (이용권 미발급 · 예상)'), studentId: x.studentId, amount: x.amount, warn: x.kind === 'unpaid' };
    });
    var r = out('unpaid', label + ' 미납', label + ' 미납 ' + up.students + '명 · 합계 ' + won(up.total) + ' (미납 표시 ' + up.unpaid.length + '건 ' + won(up.unpaidTotal) + ' · 미발급 ' + up.noIssue.length + '명 ' + won(up.noIssueTotal) + ').', items, { total: up.total });
    r.actions = smsActions(data, up.items);
    return r;
  };

  H.nextDue = function (data, p, now) {
    var ym = p.period && p.period.kind === 'month' && p.period.ym > U.today(now).slice(0, 7) ? p.period.ym : addYm(U.today(now).slice(0, 7), 1);
    var nd = DA.billing.nextDue(data, ym, now);
    var label = mLabel(ym, U.today(now).slice(0, 7));
    if (!nd.items.length) return out('nextDue', label + ' 납부 예정', label + ' 낼 사람이 없어요 — 모두 선납했거나 재원생이 없어요.', []);
    return out('nextDue', label + ' 납부 예정', label + ' 납부 예정 ' + nd.students + '명 · 합계 ' + won(nd.total) + '.',
      nd.items.map(function (x) { return { text: x.name + ' — ' + won(x.amount) + (x.productName ? ' (' + x.productName + ')' : ''), studentId: x.studentId, amount: x.amount }; }), { total: nd.total });
  };

  H.prepayExpiring = function (data, p, now) {
    var ym = monthOf(p.period, now), label = mLabel(ym, U.today(now).slice(0, 7));
    var pe = DA.billing.prepayExpiring(data, ym);
    if (!pe.items.length) return out('prepayExpiring', '선납 만료', label + '에 선납이 끝나는 사람이 없어요.', []);
    return out('prepayExpiring', '선납 만료', label + '로 선납이 끝나는 사람 ' + pe.items.length + '명 · 다음 달 예상 ' + won(pe.total) + '.',
      pe.items.map(function (x) { return { text: x.name + ' — ' + (+x.fromYm.slice(5, 7)) + '~' + (+x.ym.slice(5, 7)) + '월 ' + x.months + '개월 선납', studentId: x.studentId, amount: x.amount }; }), { total: pe.total });
  };

  H.prepay = function (data, p, now) {
    var ym = U.today(now).slice(0, 7), items = [];
    arr(data.students).forEach(function (s) {
      if (!s || (s.status || 'active') !== 'active') return;
      var until = DA.billing.prepaidUntil(data, s.id, ym);
      if (until && until > ym) items.push({ text: s.name + ' — ' + (+until.slice(5, 7)) + '월까지 선납', studentId: s.id, until: until });
    });
    items.sort(function (a, b) { return a.until < b.until ? -1 : a.until > b.until ? 1 : 0; });
    if (!items.length) return out('prepay', '선납', '다음 달 이후까지 미리 낸 재원생이 없어요.', []);
    return out('prepay', '선납', '선납한 재원생 ' + items.length + '명이에요.', items);
  };

  function periodOr(p, now, dflt) {
    if (p.period) return p.period;
    var t = U.today(now);
    if (dflt === 'month') return { kind: 'month', ym: t.slice(0, 7), from: t.slice(0, 7) + '-01', to: U.monthEnd(t), label: '이번 달' };
    return null;
  }

  H.leave = function (data, p, now) {
    var per = periodOr(p, now, 'month');
    var hb = DA.ops.historyBetween(data, per.from, per.to);
    var list = hb.entries.filter(function (e) { return e.type === 'leave'; });
    if (!list.length) return out('leave', per.label + ' 퇴원', per.label + ' 퇴원한 사람이 없어요.', []);
    var items = list.map(function (e) {
      return { text: e.name + ' — ' + md(e.date) + ' · ' + (e.reason ? e.reason : '사유 없음'), studentId: e.studentId, warn: e.missing };
    });
    var miss = list.filter(function (e) { return e.missing; }).length;
    var r = out('leave', per.label + ' 퇴원', per.label + ' 퇴원 ' + list.length + '명.' + (miss ? ' 퇴원 사유가 비어 있어요. 확인이 필요해요.' : ''), items);
    if (miss) r.warn = true;
    return r;
  };

  H.join = function (data, p, now) {
    var per = periodOr(p, now, 'month');
    var hb = DA.ops.historyBetween(data, per.from, per.to);
    var list = hb.entries.filter(function (e) { return e.type === 'join' || e.type === 'rejoin'; });
    if (!list.length) return out('join', per.label + ' 신규', per.label + ' 새로 등록한 사람이 없어요.', []);
    return out('join', per.label + ' 신규', per.label + ' 신규 ' + list.length + '명이에요.',
      list.map(function (e) { return { text: e.name + ' — ' + md(e.date) + (e.type === 'rejoin' ? ' (재등록)' : ''), studentId: e.studentId }; }));
  };

  H.paused = function (data, p, now) {
    var list = arr(data.students).filter(function (s) { return s && s.status === 'paused'; });
    if (!list.length) return out('paused', '휴원', '지금 휴원 중인 사람이 없어요.', []);
    return out('paused', '휴원', '휴원 중 ' + list.length + '명이에요.', list.map(function (s) {
      var op = arr(s.pauses).filter(function (x) { return x && x.from && !x.to; })[0];
      return { text: s.name + (op ? ' — ' + md(op.from) + '부터' : ''), studentId: s.id };
    }));
  };

  H.todayAttend = function (data, p, now) {
    var per = p.period && p.period.kind === 'day' ? p.period : { from: U.today(now), label: '오늘' };
    var day = DA.pass.day(data, per.from);
    var sb = stuById(data);
    if (!day.records.length) return out('todayAttend', per.label + ' 출석', per.label + ' 출석 기록이 아직 없어요.', []);
    var items = day.records.map(function (r) {
      var s = sb.get(r.studentId);
      var tm = r.signedAt ? U.fmtTime(new Date(r.signedAt)) : ((r.snap && r.snap.start) || '');
      return { text: (s ? s.name : '(삭제된 수강생)') + ' — ' + tm + ' ' + (r.status === 'absent' ? '당일취소' : '출석'), studentId: r.studentId };
    });
    return out('todayAttend', per.label + ' 출석', per.label + ' 출석 ' + day.attended + '명' + (day.absent ? ' · 당일취소 ' + day.absent + '명' : '') + ' · 사용 금액 ' + won(day.amount) + '.', items);
  };

  H.attendRange = function (data, p, now) {
    var per = p.period, att = 0, abs = 0, amt = 0, who = {};
    arr(data.attendance).forEach(function (r) {
      if (!r || r.date < per.from || r.date > per.to) return;
      if (r.status === 'absent') abs++; else if (r.status === 'present' || r.status === 'late') att++; else return;
      amt += DA.pass.useAmount(data, r);
      who[r.studentId] = (who[r.studentId] || 0) + 1;
    });
    return out('attendRange', per.label + ' 출석', per.label + ' 출석 ' + att + '회 · 당일취소 ' + abs + '회 · ' + Object.keys(who).length + '명 · 사용 금액 ' + won(amt) + '.', []);
  };

  H.revenue = function (data, p, now) {
    var ym = monthOf(p.period, now), label = mLabel(ym, U.today(now).slice(0, 7));
    var rep = DA.ops.monthly(data, ym, now);
    return out('revenue', label + ' 금액', label + ' 매출(발급) ' + won(rep.issuedAmount) + ' · 사용 금액 ' + won(rep.usedAmount) + ' · 받은 돈 ' + won(rep.received) + '.', [
      { text: '이용권 발급 ' + rep.issuedCount + '회분 · 남은 횟수 가치 ' + won(rep.remainingValue) },
      { text: '미납 ' + rep.unpaid.students + '명 · ' + won(rep.unpaid.total), warn: rep.unpaid.students > 0 }
    ].concat(rep.byProduct.map(function (g) { return { text: g.name + ': 발급 ' + won(g.issuedAmount) + ' · 사용 ' + won(g.usedAmount) }; })), { total: rep.issuedAmount });
  };

  H.noshow = function (data, p, now) {
    if (!DA.rooms) return need('noshow', '연습실 기능을 불러오지 못했어요.');
    var per = periodOr(p, now, 'month');
    var sm = DA.rooms.summary(data, per.from, per.to, now);
    var banned = arr(data.students).filter(function (s) { return s && DA.rooms.penalty(data, s.id, now).banned; });
    var items = sm.byStudent.map(function (x) {
      var pen = DA.rooms.penalty(data, x.studentId, now);
      return { text: x.name + ' — 노쇼 ' + x.noshow + '회 · 벌점 ' + pen.points + '점' + (pen.banned ? ' · ' + md(pen.banUntil) + '까지 예약 제한' : ''), studentId: x.studentId, warn: pen.banned };
    });
    banned.forEach(function (s) { if (!sm.byStudent.some(function (x) { return x.studentId === s.id; })) items.push({ text: s.name + ' — 예약 제한 중', studentId: s.id, warn: true }); });
    if (!sm.noshow && !items.length) return out('noshow', per.label + ' 연습실 노쇼', per.label + ' 연습실 노쇼가 없어요' + (sm.total ? ' (체크인 ' + sm.checkedin + '회).' : '.'), []);
    return out('noshow', per.label + ' 연습실 노쇼', per.label + ' 노쇼 ' + sm.noshow + '회 / ' + sm.total + '회' + (sm.rate != null ? ' (노쇼율 ' + U.pct(sm.rate) + ')' : '') + '.', items);
  };

  A.answer = function (text, data, now) {
    var d = data || { settings: {}, students: [] };
    var p = A.parse(text, d, now);
    try {
      if (p.ambiguous.length > 1 && /^student/.test(p.intent)) {
        var sb = stuById(d);
        return need(p.intent, '누구를 말씀하시는지 확인이 필요해요. 이름을 한 번 더 적어 주세요.', {
          items: p.ambiguous.map(function (id) { var s = sb.get(id); return { text: s.name + (s.status === 'left' ? ' (퇴원)' : ''), studentId: id, ask: s.name + ' ' + p.raw.replace(/\S*$/, '').trim() }; }),
          parsed: p
        });
      }
      var fn = H[p.intent];
      if (!fn) {
        return {
          ok: false, intent: 'unknown', title: '잘 모르겠어요', parsed: p,
          summary: '질문을 이해하지 못했어요. 이름·기간·알고 싶은 것(미납, 인원, 퇴원, 출석, 매출, 노쇼)을 넣어 다시 물어봐 주세요.',
          items: A.SUGGESTIONS.slice(0, 5).map(function (s) { return { text: s, ask: s }; }), actions: [], suggestions: A.SUGGESTIONS.slice()
        };
      }
      var r = fn(d, p, now);
      r.parsed = p;
      return r;
    } catch (e) {
      return { ok: false, intent: p.intent, title: '확인이 필요해요', summary: '답을 만드는 중에 문제가 생겼어요. 확인이 필요해요. (' + (e && e.message || e) + ')', items: [], actions: [], parsed: p, error: true };
    }
  };
})(typeof window !== 'undefined' ? (window.DA = window.DA || {}) : (globalThis.DA = globalThis.DA || {}));
