/* 드럼 출석부 — 이용권 화면 부품 (v1.1)
 * DA.passUI = {
 *   monthCard(student, ym, {onMonth(ym)}) → 이번 달 출석 카드(회차 칸 1회·2회…, 사용/발급 금액, ±1, 출석·당일취소 버튼)
 *   issueBanner(student, ym) → [정규반 A] [정규반 B] [실속반] [직접 입력] 큰 버튼 묶음
 *   issueSheet(student, {productId, custom, month, payment}) → 발급(또는 수정) 시트
 *   adjust(student, ym, ±1) → 횟수 조정 기록
 *   slotSheet(student, rec, n) → 채워진 칸: 서명 크게 보기·메뉴
 *   statusBadge(info) → 남은 횟수 배지(0이면 주황, 초과면 빨강, 미발급)
 * }
 */
(function (DA) {
  'use strict';
  var ui = DA.ui;
  if (!ui) return;
  var h = ui.h;
  var U = DA.util;
  var PU = DA.passUI = {};
  var WD = ['일', '월', '화', '수', '목', '금', '토'];

  function P() { return DA.pass; }
  function D() { return DA.store.data; }
  function S() { return (DA.store.data && DA.store.data.settings) || {}; }
  function ic(n, s) { return ui.icon ? ui.icon(n, s) : h('span'); }
  function today() { return U.today(); }
  function logErr(e, w) { if (ui._logErr) ui._logErr(e, 'passUI.' + (w || '')); }
  function num(v, d) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; }
  function won(n) { return U.fmtMoney(Math.round(n || 0)); }
  function ymTitle(ym) { return ym.slice(0, 4) + '년 ' + (+ym.slice(5, 7)) + '월'; }
  function addYm(ym, n) { return U.ym(U.addMonths(ym + '-01', n)); }
  function products() { return P().products(S()); }
  function productOf(student) { return student ? P().product(S(), student.courseId) : null; }
  function mdw(ymd) { return (+ymd.slice(5, 7)) + '/' + (+ymd.slice(8, 10)) + ' (' + WD[U.weekday(ymd)] + ')'; }
  function recTime(r) {
    if (r.signedAt) { var d = new Date(r.signedAt); if (!isNaN(d.getTime())) return U.fmtTime(d); }
    return (r.snap && r.snap.start) || '';
  }
  function fail(e, what) {
    logErr(e, what);
    ui.toast((what ? what + ' 실패: ' : '') + (e && e.message ? e.message : '다시 시도해 주세요'), { kind: 'error' });
  }

  PU.statusBadge = function (m, opts) {
    opts = opts || {};
    if (!m || m.status === 'none') return h('span', { class: 'badge pass-none' }, '미발급');
    return h('span', { class: 'badge pass-' + m.status + (opts.lg ? ' lg' : '') }, P().remainText(m));
  };

  /* ---------------- 이번 달 출석 카드 ---------------- */
  PU.monthCard = function (student, ym, opts) {
    opts = opts || {};
    var t = today(), nowYm = t.slice(0, 7);
    var m = P().month(D(), student.id, ym);
    var prod = m.productId ? P().product(S(), m.productId) : productOf(student);
    var prodName = m.productName || (prod ? prod.name : '반 미지정');
    var color = (prod && prod.color) || 'var(--accent)';
    var isNow = ym === nowYm;
    var left = student.status === 'left';

    function move(n) { ui.haptic('select'); if (opts.onMonth) opts.onMonth(addYm(ym, n)); }
    var head = h('div', { class: 'pc-head' },
      h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '이전 달' }, onClick: function () { move(-1); } }, ic('chevL', 22)),
      h('div', { class: 'pc-month' }, h('b', null, ymTitle(ym)), isNow ? h('span', { class: 'pc-now' }, '이번 달') : null),
      h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '다음 달' }, disabled: ym >= addYm(nowYm, 1), onClick: function () { move(1); } }, ic('chevR', 22)),
      !isNow ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: function () { if (opts.onMonth) opts.onMonth(nowYm); } }, '이번 달') : null);

    var main;
    if (m.status === 'none') {
      main = h('div', { class: 'pc-main none' },
        h('div', { class: 'pc-prod' }, h('span', { class: 'pc-dot', style: { background: color } }), prodName),
        h('div', { class: 'pc-count' }, h('span', { class: 'pc-big' }, (isNow ? '이번 달' : (+ym.slice(5, 7)) + '월') + ' 이용권 미발급')),
        h('div', { class: 'pc-money muted' }, left ? '퇴원한 수강생이에요.' : '아래 [이용권 발급]에서 이 달 횟수를 충전해 주세요.'));
    } else {
      main = h('div', { class: 'pc-main' },
        h('div', { class: 'pc-prod' }, h('span', { class: 'pc-dot', style: { background: color } }), prodName,
          m.issues.length > 1 ? h('span', { class: 'muted small' }, ' · 발급 ' + m.issues.length + '번') : null),
        h('div', { class: 'pc-count' },
          h('span', { class: 'pc-big num' }, (isNow ? '이번 달 ' : (+ym.slice(5, 7)) + '월 ') + m.used + ' / ' + m.total + '회'),
          PU.statusBadge(m, { lg: true })),
        h('div', { class: 'pc-money owner-only' },
          h('span', null, '사용 ', h('b', { class: 'num' }, won(m.usedAmount))), ' / 발급 ', h('span', { class: 'num' }, won(m.amount)),
          m.remainingValue ? h('span', { class: 'muted' }, ' · 남은 횟수 가치 ' + won(m.remainingValue)) : null),
        h('div', { class: 'pc-sub muted small owner-only' }, '회당 ' + won(m.unitPrice) + (m.adjust ? ' · 횟수 조정 ' + (m.adjust > 0 ? '+' : '') + m.adjust + '회' : '') +
          (m.absent ? ' · 당일 취소 ' + m.absent + '회 포함' : '')),
        payChips(student, ym, m));
    }

    // 회차 칸
    var slotsN = Math.max(m.total, m.used);
    var slots = h('div', { class: 'pc-slots', attrs: { role: 'list', 'aria-label': '회차' } });
    for (var i = 0; i < slotsN; i++) slots.appendChild(slotEl(student, ym, m, i));
    if (!slotsN) slots.appendChild(h('div', { class: 'pc-slots-empty muted small' }, '발급하면 여기에 1회·2회… 칸이 생겨요.'));

    var body = [head, main, slots];

    if (!left) {
      body.push(h('div', { class: 'pc-adj owner-only' },
        h('span', { class: 'pc-adj-l' }, '횟수 조정'),
        h('button', { class: 'btn btn-sm', type: 'button', attrs: { 'aria-label': '1회 빼기' }, onClick: function () { PU.adjust(student, ym, -1); } }, ic('minus', 16), '1'),
        h('button', { class: 'btn btn-sm', type: 'button', attrs: { 'aria-label': '1회 더하기' }, onClick: function () { PU.adjust(student, ym, 1); } }, ic('plus', 16), '1'),
        h('span', { class: 'pc-adj-hint muted small' }, '예: 둘째 주 시작이라 3회만')));
    }

    if (isNow && !left) {
      body.push(h('div', { class: 'pc-acts' },
        h('button', { class: 'btn btn-primary btn-lg pc-sign', type: 'button', onClick: function () { DA.actions.passSign(student.id, {}); } },
          ic('qr', 22), 'QR 찍고 서명'),
        h('button', { class: 'btn btn-lg pc-absent', type: 'button', onClick: function () { DA.actions.passAbsent(student.id, {}); } },
          ic('calendar-x', 20), '당일취소')));
    }
    if (!left) {
      body.push(h('button', { class: 'btn btn-sm btn-ghost pc-past', type: 'button', onClick: function () {
        DA.actions.passRecord(student.id, { date: isNow ? t : U.monthEnd(ym + '-01') });
      } }, ic('edit', 15), '지난 날짜로 기록'));
    }
    return h('section', { class: 'card pc-card', style: { '--pc': color }, attrs: { 'aria-label': ymTitle(ym) + ' 출석' } }, body);
  };

  // v1.2 수납: 이 달 미납 발급 → [결제 받음], 선납이면 '선납 ~ N월까지'
  function payChips(student, ym, m) {
    if (!DA.billing || !ui.moduleOn('billing')) return null;
    var B = DA.billing;
    var unpaid = m.issues.filter(B.isUnpaid);
    var until = B.prepaidUntil(D(), student.id, ym);
    var bits = [];
    unpaid.forEach(function (p) {
      bits.push(h('span', { class: 'pc-unpaid' }, h('span', { class: 'badge st-absent' }, '미납'), ' ' + won(p.amount) + (p.dueDate ? ' · 기한 ' + (+p.dueDate.slice(5, 7)) + '/' + (+p.dueDate.slice(8, 10)) : ''),
        h('button', { class: 'btn btn-sm btn-primary pc-pay', type: 'button', onClick: function () { DA.billingUI.markPaid(p); } }, ic('check', 15), '결제 받음')));
    });
    if (until && until > ym) bits.push(h('span', { class: 'pc-prepay badge accent' }, '선납 ~ ' + (until.slice(0, 4) !== ym.slice(0, 4) ? until.slice(2, 4) + '년 ' : '') + (+until.slice(5, 7)) + '월까지'));
    return bits.length ? h('div', { class: 'pc-pay-row owner-only' }, bits) : null;
  }

  function slotEl(student, ym, m, i) {
    var r = m.uses[i];
    var n = i + 1;
    var over = i >= m.total;
    if (!r) {
      return h('button', { class: 'pc-slot empty', type: 'button', attrs: { role: 'listitem', 'aria-label': n + '회 비어 있음' }, onClick: function () { emptySlot(student, ym, n); } },
        h('span', { class: 'pc-slot-n' }, n + '회'), h('span', { class: 'pc-slot-e' }, '—'));
    }
    var absent = r.status === 'absent';
    return h('button', {
      class: 'pc-slot filled ' + (absent ? 'is-absent' : 'is-present') + (over ? ' is-over' : ''), type: 'button',
      attrs: { role: 'listitem', 'aria-label': n + '회 ' + mdw(r.date) + ' ' + (absent ? '당일취소' : '출석') },
      onClick: function () { PU.slotSheet(student, r, n); }
    },
      h('span', { class: 'pc-slot-n' }, n + '회', over ? h('i', { class: 'pc-over' }, '초과') : null),
      h('span', { class: 'pc-slot-d' }, mdw(r.date)),
      h('span', { class: 'pc-slot-t' }, h('span', { class: 'num' }, recTime(r)), h('b', { class: 'pc-slot-st' }, absent ? '당일취소' : '출석')),
      r.signature && DA.sig && DA.sig.el ? h('span', { class: 'pc-slot-sig' }, DA.sig.el(r.signature, { width: 76, height: 26, strokeWidth: 1.4 })) :
        h('span', { class: 'pc-slot-sig none' }, absent ? '당일 취소' : '직접 입력'));
  }

  function emptySlot(student, ym, n) {
    var isNow = ym === today().slice(0, 7);
    var sh = null;
    function later(fn) { return function () { if (sh) sh.close(); setTimeout(fn, 60); }; }
    function item(icon, title, sub, fn) {
      return h('button', { class: 'list-item', type: 'button', onClick: later(fn) },
        h('span', { class: 'li-ic' }, ic(icon, 19)),
        h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, title), sub ? h('div', { class: 'li-sub' }, sub) : null),
        ic('chevR', 18));
    }
    sh = ui.sheet({
      title: n + '회 칸', sub: student.name + ' · ' + ymTitle(ym), autofocus: false,
      content: h('div', { class: 'list flat' },
        isNow ? item('qr', 'QR 찍고 서명', '레슨실 QR을 찍고 서명 → 1회 사용', function () { DA.actions.passSign(student.id, {}); }) : null,
        isNow ? item('calendar-x', '당일취소', '1회 차감 · 금액 포함 · 보강 없음', function () { DA.actions.passAbsent(student.id, {}); }) : null,
        item('edit', '지난 날짜로 기록', '깜빡한 출석·당일취소을 날짜를 골라 넣어요', function () { DA.actions.passRecord(student.id, { date: isNow ? today() : U.monthEnd(ym + '-01') }); }))
    });
  }

  PU.slotSheet = function (student, rec, n) {
    var absent = rec.status === 'absent';
    var m = P().month(D(), student.id, rec.date.slice(0, 7));
    var unit = m.issued > 0 ? m.amount / m.issued : 0;
    var occ = null;
    try { occ = DA.schedule.occForRecord(D(), rec); } catch (e) { logErr(e, 'slot.occ'); }
    var sh = ui.sheet({
      title: n + '회 · ' + U.fmtDate(rec.date, { year: 'auto' }),
      sub: student.name,
      size: 'wide', autofocus: false, className: 'pc-slot-sheet',
      content: h('div', null,
        rec.signature && DA.sig ? h('div', { class: 'sig-view' }, DA.sig.el(rec.signature, { height: 200 })) :
          h('div', { class: 'pc-nosig' }, ic(absent ? 'calendar-x' : 'pen', 22), absent ? '당일취소 — 서명 없음' : '서명 없이 직접 입력한 기록'),
        h('dl', { class: 'kv' },
          h('dt', null, '상태'), h('dd', null, ui.badge(rec.status), absent ? ' 보강 불가 · 1회 차감' : ''),
          h('dt', null, rec.signedAt ? '서명 시각' : '시각'), h('dd', null, recTime(rec) || '—'),
          h('dt', null, '사용 금액'), h('dd', { class: 'num' }, unit ? won(unit) + ' (회당)' : '—'),
          rec.note ? h('dt', null, '메모') : null, rec.note ? h('dd', null, rec.note) : null,
          rec.progress && (rec.progress.song || rec.progress.bpm) ? h('dt', null, '진도') : null,
          rec.progress && (rec.progress.song || rec.progress.bpm) ? h('dd', null, [rec.progress.song, rec.progress.book, rec.progress.bpm ? rec.progress.bpm + ' BPM' : ''].filter(Boolean).join(' · ')) : null)),
      actions: [
        { label: '닫기', kind: 'ghost' },
        occ ? { label: '출결 메뉴', kind: 'primary', onClick: function () { setTimeout(function () { DA.actions.menu(occ, student.id, { date: rec.date }); }, 60); } } : null
      ]
    });
    return sh;
  };

  /* ---------------- 이용권 발급 버튼 묶음 ---------------- */
  PU.issueBanner = function (student, ym) {
    var list = products();
    var nowYm = today().slice(0, 7);
    var btns = h('div', { class: 'pc-issue-btns' });
    list.forEach(function (p) {
      var mine = student.courseId === p.id;
      btns.appendChild(h('button', {
        class: 'pc-issue-btn' + (mine ? ' mine' : ''), type: 'button', style: { '--pc': p.color || 'var(--accent)' },
        onClick: function () { PU.issueSheet(student, { productId: p.id, month: ym }); }
      },
        h('span', { class: 'pc-issue-name' }, p.name, mine ? h('i', null, '내 반') : null),
        h('span', { class: 'pc-issue-meta num' }, p.count + '회 · ' + U.fmtNumber(p.amount) + '원')));
    });
    btns.appendChild(h('button', { class: 'pc-issue-btn custom', type: 'button', onClick: function () { PU.issueSheet(student, { custom: true, month: ym }); } },
      h('span', { class: 'pc-issue-name' }, ic('edit', 16), '직접 입력'),
      h('span', { class: 'pc-issue-meta' }, '횟수·금액 자유')));
    return h('section', { class: 'card pc-issue owner-only' },
      h('div', { class: 'card-h' }, h('h3', null, ic('card', 18), ' 이용권 발급'), h('span', { class: 'muted small' }, (ym === nowYm ? '이번 달' : ymTitle(ym)) + '분')),
      btns);
  };

  /* ---------------- 발급 시트 ---------------- */
  PU.issueSheet = function (student, opts) {
    opts = opts || {};
    var edit = opts.payment || null;
    var list = products();
    var t = today();
    var f = {
      month: edit ? P().revenueMonth(edit) : (opts.month || t.slice(0, 7)),
      productId: edit ? (edit.productId || '') : (opts.custom ? '' : (opts.productId || student.courseId || (list[0] && list[0].id) || '')),
      count: 0, amount: 0,
      method: edit ? (edit.method || '카드') : '카드',
      date: edit ? edit.date : t,
      memo: edit ? (edit.memo || '') : '',
      paid: edit ? edit.paid !== false : true,          // v1.2: 결제 완료 / 미납(나중에 받기)
      dueDate: edit && edit.dueDate ? edit.dueDate : '',
      months: 1                                        // v1.2: 선납(몇 달치)
    };
    var billing = !!(DA.billing && ui.moduleOn('billing'));
    if (f.productId && !P().product(S(), f.productId)) f.productId = '';
    function fill() {
      var p = P().product(S(), f.productId);
      if (p) { f.count = p.count; f.amount = p.amount; }
    }
    if (edit) { f.count = Math.max(0, Math.round(num(edit.count, 0))); f.amount = Math.max(0, num(edit.amount, 0)); }
    else if (f.productId) fill();
    else { f.count = 1; f.amount = 0; }
    // 지난 결제 수단 기억
    if (!edit) {
      var prev = (DA.schedule.index.paymentsByStudent(D()).get(student.id) || []).filter(function (p) { return !P().isAdjust(p); });
      if (prev.length && prev[prev.length - 1].method) f.method = prev[prev.length - 1].method;
    }

    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var monthEl = h('div', { class: 'pc-ym' });
      function paintMonth() {
        ui.clear(monthEl);
        monthEl.appendChild(h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '이전 달' }, onClick: function () { f.month = addYm(f.month, -1); paintMonth(); paintInfo(); } }, ic('chevL', 20)));
        monthEl.appendChild(h('b', { class: 'pc-ym-v' }, ymTitle(f.month)));
        monthEl.appendChild(h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '다음 달' }, onClick: function () { f.month = addYm(f.month, 1); paintMonth(); paintInfo(); } }, ic('chevR', 20)));
      }
      paintMonth();
      var prodSel = ui.select(list.map(function (p) { return { value: p.id, label: p.name + ' (' + p.count + '회 · ' + U.fmtNumber(p.amount) + '원)' }; })
        .concat([{ value: '', label: '직접 입력 (횟수·금액 자유)' }]), f.productId, function (v) { f.productId = v; if (v) { fill(); cntIn.value = f.count; amtIn.value = U.fmtNumber(f.amount); } paintInfo(); });
      var cntIn = ui.input({ type: 'number', value: f.count, min: 0, max: 99, step: 1, inputmode: 'numeric', onInput: function () { paintInfo(); } });
      cntIn.setAttribute('aria-label', '횟수');
      function stepCnt(d) { cntIn.value = Math.max(0, Math.min(99, Math.round(num(cntIn.value, 0)) + d)); ui.haptic('select'); paintInfo(); }
      var amtIn = ui.input({ type: 'text', id: 'pc-amt', value: f.amount ? U.fmtNumber(f.amount) : '', placeholder: '예: 220,000', inputmode: 'numeric', maxLength: 13 });
      function amtVal() { return parseInt(String(amtIn.value).replace(/[^0-9]/g, ''), 10) || 0; }
      amtIn.addEventListener('input', function () {
        var v = amtVal();
        amtIn.value = v ? U.fmtNumber(v) : '';
        paintInfo();
      });
      var info = h('div', { class: 'pc-issue-info' });
      function paintInfo() {
        var c = Math.max(0, Math.round(num(cntIn.value, 0))), a = amtVal();
        var cur = P().month(D(), student.id, f.month);
        var had = edit ? cur.total - (P().revenueMonth(edit) === f.month ? Math.round(num(edit.count, 0)) : 0) : cur.total;
        ui.clear(info);
        info.appendChild(h('div', null, '회당 ', h('b', { class: 'num' }, c ? won(a / c) : '—')));
        info.appendChild(h('div', { class: 'muted small' }, ymTitle(f.month) + ' 보유 ' + had + '회 → ' + (had + c) + '회' + (cur.used ? ' (이미 ' + cur.used + '회 사용)' : '')));
        if (f.months > 1) info.appendChild(h('div', { class: 'pc-prepay-info' }, '선납 ' + f.months + '개월: ' + (+f.month.slice(5, 7)) + '월 ~ ' + (+addYm(f.month, f.months - 1).slice(5, 7)) + '월 · 달마다 ' + c + '회 · 합계 ', h('b', { class: 'num' }, won(a * f.months))));
      }
      // v1.2 결제 상태·선납
      var dueIn = ui.input({ type: 'date', value: f.dueDate || (f.month + '-10') });
      var dueField = ui.field('납부 기한', dueIn, '이 날이 지나면 수납 화면에 ‘기한 지남’으로 보여요');
      var paySeg = ui.segmented([{ value: 'paid', label: '결제 완료' }, { value: 'unpaid', label: '미납(나중에 받기)' }], f.paid ? 'paid' : 'unpaid', function (v) { f.paid = v === 'paid'; syncPay(); });
      paySeg.classList.add('full', 'pc-pay-seg');
      var monthsVal = h('b', { class: 'num pc-months-v' }, '1개월');
      function stepMonths(d) { f.months = Math.max(1, Math.min(12, f.months + d)); monthsVal.textContent = f.months + '개월'; ui.haptic('select'); paintInfo(); }
      var monthsEl = h('div', { class: 'stepper pc-months' },
        h('button', { class: 'btn', type: 'button', attrs: { 'aria-label': '한 달 줄이기' }, onClick: function () { stepMonths(-1); } }, ic('minus', 18)),
        monthsVal,
        h('button', { class: 'btn', type: 'button', attrs: { 'aria-label': '한 달 늘리기' }, onClick: function () { stepMonths(1); } }, ic('plus', 18)));
      function syncPay() { dueField.hidden = f.paid; }
      var methodSeg = ui.segmented((DA.C.PAY_METHODS || ['카드', '현금', '계좌이체', '기타']).map(function (x) { return { value: x, label: x }; }), f.method, function (v) { f.method = v; });
      methodSeg.classList.add('full');
      var dateIn = ui.input({ type: 'date', value: f.date || t });
      var memoIn = ui.input({ value: f.memo, placeholder: '예: 첫 달 일할, 형제 할인', maxLength: 60 });

      var content = h('div', { class: 'pc-issue-form' },
        h('div', { class: 'info-card' }, ui.avatar(student.name, ui.studentColor(student)),
          h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, student.name), h('div', { class: 'li-sub' }, '한 달 횟수 충전 · 매달 1일 기준'))),
        ui.field('대상 월', monthEl),
        ui.field('이용권', prodSel),
        h('div', { class: 'field-row' },
          ui.field('횟수', h('div', { class: 'stepper' },
            h('button', { class: 'btn', type: 'button', attrs: { 'aria-label': '1회 줄이기' }, onClick: function () { stepCnt(-1); } }, ic('minus', 18)),
            cntIn,
            h('button', { class: 'btn', type: 'button', attrs: { 'aria-label': '1회 늘리기' }, onClick: function () { stepCnt(1); } }, ic('plus', 18)))),
          h('div', { class: 'field' }, h('label', { class: 'field-label', attrs: { for: 'pc-amt' } }, '금액 (원)'), amtIn)),
        info,
        billing ? ui.field('결제', paySeg) : null,
        billing ? dueField : null,
        billing && !edit ? ui.field('몇 달치 (선납)', monthsEl, '여러 달을 한 번에 받으면 달마다 한 건씩 같은 묶음으로 발급해요') : null,
        ui.field('결제 수단', methodSeg),
        h('div', { class: 'field-row' }, ui.field(billing ? '결제(발급)일' : '결제일', dateIn), ui.field('메모', memoIn)));
      syncPay();
      paintInfo();

      var actions = [{ label: '취소', kind: 'ghost', onClick: function () { fin(null); } }];
      if (edit) actions.push({
        label: '삭제', kind: 'danger', onClick: function () {
          return ui.confirm(ymTitle(P().revenueMonth(edit)) + ' ' + (edit.productName || '이용권') + ' ' + Math.round(num(edit.count, 0)) + '회 발급을 지울까요?\n이 달 보유 횟수에서 빠져요.', { title: '발급 삭제', ok: '삭제', danger: true }).then(function (ok) {
            if (!ok) return false;
            return DA.store.remove('payments', edit.id).then(function () { ui.toast('발급 기록을 지웠어요', { kind: 'ok' }); fin(null); });
          });
        }
      });
      actions.push({
        label: edit ? '저장' : '발급', kind: 'primary', onClick: function () {
          var c = Math.max(0, Math.min(99, Math.round(num(cntIn.value, 0)))), a = amtVal();
          if (!c) { ui.toast('횟수를 1회 이상 넣어 주세요', { kind: 'warn' }); cntIn.focus(); return false; }
          var p = P().product(S(), f.productId);
          var payDate = U.isYmd(dateIn.value) ? dateIn.value : t;
          var due = U.isYmd(dueIn.value) ? dueIn.value : f.month + '-01';
          if (!edit && billing && f.months > 1) {
            var recs = DA.billing.buildIssues({
              studentId: student.id, startYm: f.month, months: f.months, productId: p ? p.id : '', productName: p ? p.name : '직접 입력',
              count: c, amount: a, method: f.method, date: payDate, memo: memoIn.value.trim(), paid: f.paid, dueDate: due
            });
            return DA.store.putMany('payments', recs).then(function (saved) {
              ui.haptic('success');
              ui.toast(ymTitle(f.month) + '부터 ' + f.months + '개월 선납 발급 · ' + won(a * f.months) + (f.paid ? '' : ' (미납)'), { kind: 'ok' });
              fin(saved && saved[0] || recs[0]);
            }, function (e) { fail(e, '발급'); return false; });
          }
          var rec = Object.assign({}, edit || {}, {
            studentId: student.id, date: payDate, amount: a, count: c, months: 0,
            month: f.month, productId: p ? p.id : '', productName: p ? p.name : '직접 입력',
            method: f.method, memo: memoIn.value.trim(), kind: 'issue'
          });
          if (billing) {
            if (f.paid) { rec.paid = true; rec.paidDate = edit && edit.paid !== false && edit.paidDate ? edit.paidDate : payDate; delete rec.dueDate; }
            else { rec.paid = false; rec.dueDate = due; delete rec.paidDate; }
          }
          return DA.store.put('payments', rec).then(function (saved) {
            ui.haptic('success');
            ui.toast(edit ? '발급 기록을 고쳤어요' : ymTitle(f.month) + ' ' + rec.productName + ' ' + c + '회 발급 · ' + won(a) + (rec.paid === false ? ' (미납)' : ''), { kind: 'ok' });
            fin(saved || rec);
          }, function (e) { fail(e, '발급'); return false; });
        }
      });
      ui.sheet({
        title: edit ? '이용권 발급 수정' : '이용권 발급', sub: student.name, className: 'pc-issue-sheet', autofocus: false,
        content: content, actions: actions, onClose: function () { fin(null); }
      });
    });
  };

  /* ---------------- 횟수 조정 ±1 ---------------- */
  PU.adjust = function (student, ym, delta) {
    var rec = {
      studentId: student.id, date: today(), amount: 0, count: delta > 0 ? 1 : -1, months: 0,
      month: ym, kind: 'adjust', method: '', memo: '횟수 조정'
    };
    return DA.store.put('payments', rec).then(function (saved) {
      ui.haptic('select');
      var m = P().month(D(), student.id, ym);
      ui.toast(ymTitle(ym) + ' 횟수 ' + (delta > 0 ? '+1' : '−1') + ' → ' + m.total + '회', {
        kind: 'ok',
        action: { label: '되돌리기', onClick: function () { DA.store.remove('payments', saved.id); } }
      });
      return saved;
    }, function (e) { fail(e, '횟수 조정'); });
  };
})(window.DA = window.DA || {});
