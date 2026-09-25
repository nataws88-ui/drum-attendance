/* 드럼 출석부 — 스마트 검색 화면 (v1.2)
 * #/ask[?q=질문]  채팅 말풍선 + 입력창 + 자주 쓰는 질문 칩. 답은 core/ask.js(기기 안 규칙 기반)가 만든다.
 * 답의 이름은 누르면 학생 화면. 문자 보내기 같은 실행은 버튼으로만(원장이 눌러야 문자 앱이 열린다).
 * 대화는 이 기기에만(최근 50개, localStorage 편의용).
 * DA.askUI = { ask(text) → answer, clear(), log() }
 */
(function (DA) {
  'use strict';
  var ui = DA.ui;
  if (!ui || !ui.registerView) return;
  var h = ui.h;
  var U = DA.util;
  var LOG_KEY = 'da.ask.log', MAX = 50;
  function ic(n, s) { return ui.icon ? ui.icon(n, s) : h('span'); }
  function D() { return DA.store.data; }

  function load() {
    try { var a = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-MAX))); } catch (e) { /* 개인정보 보호 모드 등: 화면에만 */ }
  }
  var memLog = null;
  function log() { if (!memLog) memLog = load(); return memLog; }
  function push(entry) { var l = log(); l.push(entry); if (l.length > MAX) l.splice(0, l.length - MAX); save(l); }

  function slim(a) {
    return {
      ok: a.ok, intent: a.intent, title: a.title, summary: a.summary, warn: !!a.warn,
      items: (a.items || []).slice(0, 40).map(function (x) { return { text: x.text, studentId: x.studentId || '', warn: !!x.warn, ask: x.ask || '' }; }),
      actions: (a.actions || []).slice(0, 20)
    };
  }

  function ask(text) {
    var q = String(text == null ? '' : text).trim();
    var a = DA.ask.answer(q, D(), new Date());
    push({ role: 'me', text: q || '도움말', at: new Date().toISOString() });
    push({ role: 'bot', answer: slim(a), at: new Date().toISOString() });
    return a;
  }

  function smsLink(act) {
    var s = DA.store.get('students', act.studentId);
    if (!s || !s.phone) return null;
    var body = DA.billing ? DA.billing.smsText(D(), s, act.item || {}) : '';
    return h('a', { class: 'btn btn-sm ask-act', href: U.smsHref(s.phone, body), onClick: function () { ui.haptic('light'); } }, ic('sms', 16), act.label || s.name);
  }

  function bubble(entry, onAsk) {
    if (entry.role === 'me') return h('div', { class: 'ask-msg me' }, h('div', { class: 'ask-bubble' }, entry.text));
    var a = entry.answer || {};
    var items = h('ul', { class: 'ask-items' });
    (a.items || []).forEach(function (x) {
      var content;
      if (x.studentId && DA.store.get('students', x.studentId)) {
        content = h('button', { class: 'ask-link', type: 'button', onClick: function () { ui.go('#/students/' + encodeURIComponent(x.studentId)); } }, x.text, ic('chevR', 14));
      } else if (x.ask) {
        content = h('button', { class: 'ask-link', type: 'button', onClick: function () { onAsk(x.ask); } }, x.text);
      } else content = h('span', null, x.text);
      items.appendChild(h('li', { class: x.warn ? 'warn' : '' }, content));
    });
    var acts = (a.actions || []).map(function (act) { return act.type === 'sms' ? smsLink(act) : null; }).filter(Boolean);
    return h('div', { class: 'ask-msg bot' + (a.warn ? ' warn' : '') + (a.ok === false ? ' unknown' : '') },
      h('span', { class: 'ask-avatar', attrs: { 'aria-hidden': 'true' } }, ic('drum', 18)),
      h('div', { class: 'ask-bubble' },
        a.title ? h('div', { class: 'ask-title' }, a.title) : null,
        h('div', { class: 'ask-sum' }, a.summary || ''),
        (a.items || []).length ? items : null,
        acts.length ? h('div', { class: 'ask-acts' }, h('div', { class: 'ask-acts-l muted small' }, '안내 문자 — 누르면 문자 앱이 열려요(보내기는 직접)'), h('div', { class: 'ask-acts-row' }, acts)) : null));
  }

  function render(el, params) {
    var q0 = params && params.query && params.query.q;
    var root = h('div', { class: 'v-ask' });
    var clearBtn = h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: function () {
      ui.confirm('이 기기에 남은 검색 기록을 지울까요?', { title: '대화 지우기', ok: '지우기', danger: true }).then(function (ok) {
        if (!ok) return; memLog = []; save([]); paint();
      });
    } }, ic('trash', 16), '지우기');
    root.appendChild(h('header', { class: 'topbar' }, h('div', { class: 'topbar-row' },
      h('button', { class: 'btn btn-icon back', type: 'button', attrs: { 'aria-label': '뒤로' }, onClick: function () { window.appBack(); } }, ic('chevL', 24)),
      h('h1', { class: 'topbar-title' }, '스마트 검색'),
      h('div', { class: 'topbar-actions' }, clearBtn))));
    var page = h('div', { class: 'page narrow ask-page' });
    var thread = h('div', { class: 'ask-thread', attrs: { 'aria-live': 'polite' } });
    var input = ui.input({ type: 'search', placeholder: '예: 이번 달 미납자 누구야?', id: 'ask-input', maxLength: 120 });
    input.setAttribute('enterkeyhint', 'send');
    function send(text) {
      var t = String(text == null ? input.value : text).trim();
      if (!t) { input.focus(); return; }
      ask(t); input.value = ''; ui.haptic('light'); paint(true);
    }
    var form = h('form', { class: 'ask-form', onSubmit: function (e) { e.preventDefault(); send(); } },
      input, h('button', { class: 'btn btn-primary ask-send', type: 'submit', attrs: { 'aria-label': '묻기' } }, ic('chevR', 22)));
    var chips = h('div', { class: 'hscroll ask-chips', attrs: { 'data-scroll': '' } }, DA.ask.SUGGESTIONS.map(function (sg) {
      return h('button', { class: 'chip', type: 'button', onClick: function () { send(sg); } }, sg);
    }));
    function paint(scroll) {
      ui.clear(thread);
      var l = log();
      if (!l.length) {
        thread.appendChild(h('div', { class: 'ask-msg bot' }, h('span', { class: 'ask-avatar' }, ic('drum', 18)),
          h('div', { class: 'ask-bubble' }, h('div', { class: 'ask-title' }, '스마트 검색'),
            h('div', { class: 'ask-sum' }, '학원 기록을 보고 답해 드려요. 이름·기간을 넣어 물어보세요. 기록에 없는 건 “확인이 필요해요”라고 말씀드려요.'))));
      }
      l.forEach(function (e) { thread.appendChild(bubble(e, send)); });
      if (scroll) setTimeout(function () { var last = thread.lastChild; if (last && last.scrollIntoView) last.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 30);
    }
    page.appendChild(thread);
    root.appendChild(page);
    root.appendChild(h('div', { class: 'ask-dock' }, chips, form));
    el.appendChild(root);
    paint(false);
    if (q0 && render._lastQ !== params.hash) { render._lastQ = params.hash; send(q0); }
    else setTimeout(function () { var last = thread.lastChild; if (last && last.scrollIntoView) last.scrollIntoView({ block: 'end' }); }, 30);
  }

  DA.askUI = { ask: function (t) { var a = ask(t); if (ui.current().name === 'ask') ui.refresh(); return a; }, clear: function () { memLog = []; save([]); }, log: function () { return log().slice(); } };

  ui.registerView('ask', {
    title: '스마트 검색',
    module: 'ask',
    owner: true,
    autoRefresh: false,
    render: render
  });
})(window.DA = window.DA || {});
