/* 드럼 출석부 — 수납 화면 (v1.2)
 * #/billing[?ym=YYYY-MM&tab=unpaid|next|prepay|received]
 *   이번 달 미납(미납 표시 + 이용권 미발급 예상) / 다음 달 납부 예정 / 선납 만료 / 받은 돈 — 목록·합계
 *   줄마다 [결제 받음](또는 [발급]) · [안내 문자](문자 앱을 미리 채워 열기 — 보내기는 원장이 누름). 여러 명이면 한 명씩 차례로.
 * DA.billingUI = { markPaid(payment) → Promise, smsQueue(items) }
 */
(function (DA) {
  'use strict';
  var ui = DA.ui;
  if (!ui || !ui.registerView) return;
  var h = ui.h;
  var U = DA.util;
  function ic(n, s) { return ui.icon ? ui.icon(n, s) : h('span'); }
  function D() { return DA.store.data; }
  function B() { return DA.billing; }
  function won(n) { return U.fmtMoney(Math.round(n || 0)); }
  function ymTitle(ym) { return ym.slice(0, 4) + '년 ' + (+ym.slice(5, 7)) + '월'; }
  function mo(ym) { return (+ym.slice(5, 7)) + '월'; }
  function addYm(ym, n) { return U.ym(U.addMonths(ym + '-01', n)); }
  function logErr(e, w) { if (ui._logErr) ui._logErr(e, 'billing.' + (w || '')); }

  var st = { ym: '', tab: 'unpaid' };
  var TABS = [
    { value: 'unpaid', label: '미납' }, { value: 'next', label: '다음 달 예정' },
    { value: 'prepay', label: '선납 만료' }, { value: 'received', label: '받은 돈' }
  ];

  /* ---------------- 결제 받음 ---------------- */
  function markPaid(p) {
    var s = DA.store.get('students', p.studentId);
    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var f = { date: U.today(), method: p.method && p.method !== '' ? p.method : '카드' };
      var dateIn = ui.input({ type: 'date', value: f.date, max: U.today() });
      var seg = ui.segmented((DA.C.PAY_METHODS || ['카드', '현금', '계좌이체', '기타']).map(function (x) { return { value: x, label: x }; }), f.method, function (v) { f.method = v; });
      seg.classList.add('full');
      ui.sheet({
        title: '결제 받음', sub: (s ? s.name + ' · ' : '') + mo(DA.pass.revenueMonth(p)) + ' ' + (p.productName || '이용권'), className: 'bl-paid-sheet', autofocus: false,
        content: h('div', null,
          h('div', { class: 'info-card' }, ic('money', 22), h('div', { class: 'li-main' }, h('div', { class: 'li-title num' }, won(p.amount)), h('div', { class: 'li-sub' }, (p.count || 0) + '회 이용권 · 기한 ' + (p.dueDate ? U.fmtDate(p.dueDate, { weekday: false }) : '—')))),
          ui.field('받은 날', dateIn), ui.field('결제 수단', seg)),
        actions: [
          { label: '취소', kind: 'ghost', onClick: function () { fin(null); } },
          { label: '결제 받음', kind: 'primary', onClick: function () {
            var rec = Object.assign({}, p, B().paidPatch({ date: U.isYmd(dateIn.value) ? dateIn.value : U.today(), method: f.method }));
            delete rec.dueDate;
            return DA.store.put('payments', rec).then(function (saved) {
              ui.haptic('success');
              ui.toast((s ? s.name + ' ' : '') + won(p.amount) + ' 결제 받음', { kind: 'ok', action: { label: '되돌리기', onClick: function () { DA.store.put('payments', p); } } });
              fin(saved);
            });
          } }
        ],
        onClose: function () { fin(null); }
      });
    });
  }

  /* ---------------- 안내 문자(한 명씩 차례로) ---------------- */
  function smsFor(item) {
    var s = DA.store.get('students', item.studentId);
    if (!s || !s.phone) return null;
    return U.smsHref(s.phone, B().smsText(D(), s, item));
  }
  function smsQueue(items) {
    var list = [], seen = {};
    items.forEach(function (x) {
      if (seen[x.studentId]) { seen[x.studentId].amount += x.amount; return; }
      var y = Object.assign({}, x); seen[x.studentId] = y; list.push(y);
    });
    var withPhone = list.filter(function (x) { return !!smsFor(x); });
    var noPhone = list.length - withPhone.length;
    if (!withPhone.length) { ui.toast('연락처가 있는 사람이 없어요', { kind: 'warn' }); return; }
    var i = 0, sh = null;
    var body = h('div', { class: 'bl-queue' });
    function paint() {
      ui.clear(body);
      var x = withPhone[i], s = DA.store.get('students', x.studentId);
      var text = B().smsText(D(), s, x);
      body.appendChild(h('div', { class: 'bl-queue-n muted small' }, (i + 1) + ' / ' + withPhone.length + '명' + (noPhone ? ' · 연락처 없는 ' + noPhone + '명 제외' : '')));
      body.appendChild(h('div', { class: 'info-card' }, ui.avatar(s.name, ui.studentColor(s)), h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, s.name), h('div', { class: 'li-sub' }, s.phone + ' · ' + won(x.amount)))));
      body.appendChild(h('div', { class: 'st-bubble bl-preview' }, text));
      body.appendChild(h('div', { class: 'btn-row' },
        h('a', { class: 'btn btn-primary bl-open-sms', href: smsFor(x), onClick: function () { ui.haptic('light'); x.opened = true; setTimeout(next, 400); } }, ic('sms', 18), '문자 앱 열기'),
        h('button', { class: 'btn', type: 'button', onClick: next }, i < withPhone.length - 1 ? '건너뛰기' : '끝')));
    }
    function next() { if (i < withPhone.length - 1) { i++; paint(); } else if (sh) sh.close(); }
    paint();
    sh = ui.sheet({ title: '안내 문자 차례로 보내기', sub: '문자 앱에서 [보내기]를 누른 뒤 이 앱으로 돌아오세요', className: 'bl-queue-sheet', autofocus: false, content: body });
  }

  /* ---------------- 줄 ---------------- */
  function nameBtn(item) {
    return h('button', { class: 'bl-name', type: 'button', onClick: function () { ui.go('#/students/' + encodeURIComponent(item.studentId)); } }, item.name);
  }
  function smsBtn(item) {
    var href = smsFor(item);
    if (!href) return h('button', { class: 'btn btn-sm', type: 'button', disabled: true, attrs: { title: '연락처 없음' } }, ic('sms', 16), '연락처 없음');
    return h('a', { class: 'btn btn-sm bl-sms', href: href, onClick: function () { ui.haptic('light'); } }, ic('sms', 16), '안내 문자');
  }
  function issueBtn(item, label) {
    return h('button', { class: 'btn btn-sm btn-soft bl-issue', type: 'button', onClick: function () {
      var s = DA.store.get('students', item.studentId);
      if (s && DA.passUI) DA.passUI.issueSheet(s, { month: item.ym });
    } }, ic('card', 16), label || '발급');
  }
  function row(item, sub, buttons, amountCls) {
    return h('div', { class: 'bl-row' + (item.overdue ? ' overdue' : ''), dataset: { sid: item.studentId, kind: item.kind || '' } },
      h('div', { class: 'bl-main' },
        h('div', { class: 'bl-top' }, nameBtn(item), h('b', { class: 'bl-amt num ' + (amountCls || '') }, won(item.amount))),
        h('div', { class: 'bl-sub muted small' }, sub)),
      buttons && buttons.length ? h('div', { class: 'bl-btns' }, buttons) : null);
  }

  function kindText(x, ym) {
    if (x.kind === 'unpaid') return (x.ym !== ym ? mo(x.ym) + '분 · ' : '') + '미납 표시 · ' + (x.productName || '이용권') + ' · 기한 ' + (x.dueDate ? U.fmtDate(x.dueDate, { weekday: false }) : '—') + (x.overdue ? ' (지남)' : '');
    return '이용권 미발급 · 예상 ' + (x.productName || '반 금액');
  }

  function render(el, params) {
    var q = (params && params.query) || {};
    var nowYm = U.today().slice(0, 7);
    if (q.ym && /^\d{4}-\d{2}$/.test(q.ym) && render._q !== params.hash) { st.ym = q.ym; }
    if (q.tab && render._q !== params.hash && TABS.some(function (t) { return t.value === q.tab; })) st.tab = q.tab;
    render._q = params && params.hash;
    var ym = st.ym || nowYm;
    var d = D();
    var up = B().unpaid(d, ym, new Date());
    var nx = B().nextDue(d, addYm(ym, 1), new Date());
    var pe = B().prepayExpiring(d, ym);
    var rc = B().received(d, ym);

    var root = h('div', { class: 'v-billing' });
    root.appendChild(h('header', { class: 'topbar' },
      h('div', { class: 'topbar-row' }, h('h1', { class: 'topbar-title' }, '수납'),
        h('div', { class: 'topbar-actions' },
          h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '이전 달' }, onClick: function () { st.ym = addYm(ym, -1); ui.refresh(); } }, ic('chevL', 22)),
          h('b', { class: 'bl-ym' }, ym === nowYm ? '이번 달' : ymTitle(ym)),
          h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '다음 달' }, onClick: function () { st.ym = addYm(ym, 1); ui.refresh(); } }, ic('chevR', 22))))));
    var page = h('div', { class: 'page narrow bl-page' });

    function tile(key, label, val, sub, tone) {
      return h('button', { class: 'kpi bl-kpi' + (st.tab === key ? ' on' : '') + (tone ? ' ' + tone : ''), type: 'button', onClick: function () { st.tab = key; ui.refresh(); } },
        h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, val), h('div', { class: 'kpi-sub' }, sub));
    }
    page.appendChild(h('div', { class: 'kpi-grid bl-kpis' },
      tile('unpaid', mo(ym) + ' 미납', up.students + '명', won(up.total), up.students ? 'warn' : ''),
      tile('next', mo(addYm(ym, 1)) + ' 납부 예정', nx.students + '명', won(nx.total)),
      tile('prepay', '선납 만료', pe.items.length + '명', mo(ym) + '로 끝나요'),
      tile('received', mo(ym) + ' 받은 돈', won(rc.total), rc.items.length + '건')));

    var seg = ui.segmented(TABS, st.tab, function (v) { st.tab = v; ui.refresh(); });
    seg.classList.add('full', 'bl-tabs');
    page.appendChild(seg);

    var card = h('section', { class: 'card bl-list' });
    var items = [];
    if (st.tab === 'unpaid') {
      items = up.items;
      card.appendChild(h('div', { class: 'card-h' }, h('h2', null, mo(ym) + ' 미납 ' + up.students + '명'), h('b', { class: 'num bl-total' }, won(up.total))));
      if (up.unpaid.length) card.appendChild(h('div', { class: 'muted small bl-legend' }, '미납 표시 ' + up.unpaid.length + '건 ' + won(up.unpaidTotal) + ' · 이용권 미발급 ' + up.noIssue.length + '명 ' + won(up.noIssueTotal) + '(반 금액으로 예상)'));
      if (!items.length) card.appendChild(ui.empty('check', '미납이 없어요', mo(ym) + ' 수강료는 모두 받았어요.'));
      items.forEach(function (x) {
        var btns = x.kind === 'unpaid'
          ? [h('button', { class: 'btn btn-sm btn-primary bl-pay', type: 'button', onClick: function () { var p = DA.store.get('payments', x.paymentId); if (p) markPaid(p); } }, ic('check', 16), '결제 받음'), smsBtn(x)]
          : [issueBtn(x, '발급'), smsBtn(x)];
        card.appendChild(row(x, kindText(x, ym), btns, x.kind === 'unpaid' ? 'warn' : 'muted'));
      });
    } else if (st.tab === 'next') {
      items = nx.items;
      card.appendChild(h('div', { class: 'card-h' }, h('h2', null, mo(nx.ym) + ' 납부 예정 ' + nx.students + '명'), h('b', { class: 'num bl-total' }, won(nx.total))));
      card.appendChild(h('div', { class: 'muted small bl-legend' }, '재원생 중 ' + mo(nx.ym) + ' 이용권이 아직 없는 사람(선납한 사람은 빠져요)'));
      if (!items.length) card.appendChild(ui.empty('check', '낼 사람이 없어요', '모두 선납했거나 재원생이 없어요.'));
      items.forEach(function (x) { card.appendChild(row(x, x.kind === 'unpaid' ? kindText(x, nx.ym) : '예상 · ' + (x.productName || '반 금액'), [issueBtn(x, mo(nx.ym) + ' 발급'), smsBtn(x)])); });
    } else if (st.tab === 'prepay') {
      items = pe.items;
      card.appendChild(h('div', { class: 'card-h' }, h('h2', null, mo(ym) + '로 선납이 끝나는 사람'), h('b', { class: 'num bl-total' }, pe.items.length + '명')));
      if (!items.length) card.appendChild(ui.empty('card', '선납 만료가 없어요', '여러 달을 한 번에 발급(선납)하면 끝나는 달에 여기 나와요.'));
      items.forEach(function (x) { card.appendChild(row(x, mo(x.fromYm) + '~' + mo(x.ym) + ' ' + x.months + '개월 선납 · 다음 달 예상', [issueBtn({ studentId: x.studentId, ym: addYm(ym, 1) }, '연장 발급'), smsBtn({ studentId: x.studentId, ym: addYm(ym, 1), amount: x.amount, productName: x.productName })])); });
    } else {
      card.appendChild(h('div', { class: 'card-h' }, h('h2', null, mo(ym) + ' 받은 돈 ' + rc.items.length + '건'), h('b', { class: 'num bl-total' }, won(rc.total))));
      var methods = Object.keys(rc.byMethod);
      if (methods.length) card.appendChild(h('div', { class: 'muted small bl-legend' }, methods.map(function (m) { return m + ' ' + won(rc.byMethod[m]); }).join(' · ')));
      if (!rc.items.length) card.appendChild(ui.empty('money', '받은 돈이 없어요', '이용권을 발급하거나 [결제 받음]을 누르면 여기 모여요.'));
      rc.items.forEach(function (x) {
        card.appendChild(row(x, U.fmtDate(x.date, { weekday: true }) + ' · ' + (x.method || '기타') + ' · ' + mo(x.forYm) + ' ' + (x.productName || '이용권') + (x.groupId ? ' (선납)' : ''), null));
      });
    }
    if (st.tab !== 'received' && items.length > 1) {
      card.appendChild(h('button', { class: 'btn btn-block bl-queue-btn', type: 'button', onClick: function () { smsQueue(items.map(function (x) { return { studentId: x.studentId, ym: x.ym, amount: x.amount, productName: x.productName }; })); } }, ic('sms', 18), '안내 문자 한 명씩 차례로 보내기'));
    }
    page.appendChild(card);
    page.appendChild(h('p', { class: 'muted small' }, '안내 문자는 이 폰의 문자 앱을 미리 채워 여는 것까지만 해요. 보내기는 원장님이 직접 눌러요. 문구는 설정 → 수납 문자에서 바꿔요.'));
    root.appendChild(page);
    el.appendChild(root);
  }

  DA.billingUI = { markPaid: markPaid, smsQueue: smsQueue, state: st };

  ui.registerView('billing', {
    title: '수납',
    tab: { label: '수납', icon: 'money', order: 3 },
    module: 'billing',
    owner: true,
    render: render
  });
})(window.DA = window.DA || {});
