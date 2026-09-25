/* 드럼 출석부 — 키오스크 (SPEC §6.2): 학생이 직접 이름을 누르고 서명하는 접수대 화면
 * 큰 시계·인사말, 서명 창이 열린 수업의 학생 타일, 명단에 없어요(초성 키패드 검색),
 * 왼쪽 위 길게 누르기/자물쇠 → PIN으로 나가기, 화면 켜둠, 60초 무조작 시 처음 화면으로.
 */
(function (DA) {
  'use strict';
  var ui = DA.ui;
  if (!ui || !ui.registerView) return;
  var h = ui.h;

  var CHO = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  var IDLE_MS = 60000;
  var CLOCK_MS = 30000;
  var CORNER_MS = 800;

  var K = {
    active: false,        // 키오스크 화면에 있는 동안 true
    wake: null,           // WakeLockSentinel
    wakePending: false,
    nativeOn: false,
    idleTimer: null,
    clockTimer: null,
    clockEls: null,
    openSig: '',
    pinOpen: false,
    exiting: false
  };

  /* ---------------- 도우미 ---------------- */
  function U() { return DA.util; }
  function SC() { return DA.schedule; }
  function data() { return DA.store.data; }
  function settings() { return (DA.store.data && DA.store.data.settings) || {}; }
  function ic(n, s) { return ui.icon ? ui.icon(n, s) : h('span'); }
  function logErr(e, w) { if (ui._logErr) ui._logErr(e, 'kiosk.' + (w || '')); }
  function nowMin(d) { return d.getHours() * 60 + d.getMinutes(); }
  function sMin(o) { return o.startMin != null ? o.startMin : U().hm2min(o.start); }
  function eMin(o) { return o.endMin != null ? o.endMin : sMin(o) + (+o.duration || 0); }
  function busy() { return !!(DA.actions && DA.actions.isSigning && DA.actions.isSigning()); }
  function greeting(d) {
    var hr = d.getHours();
    if (hr < 11) return '좋은 아침이에요!';
    if (hr < 17) return '안녕하세요!';
    return '오늘도 반가워요!';
  }

  /* ---------------- 화면 켜둠 ---------------- */
  function acquireWake() {
    K.active = true;
    if (!K.nativeOn) {
      try {
        if (window.DrumNative && typeof window.DrumNative.keepScreenOn === 'function') { window.DrumNative.keepScreenOn(true); K.nativeOn = true; }
      } catch (e) { logErr(e, 'keepScreenOn'); }
    }
    if (K.wake || K.wakePending || document.visibilityState === 'hidden') return;
    var wl = navigator.wakeLock;
    if (!wl || typeof wl.request !== 'function') return;
    K.wakePending = true;
    try {
      wl.request('screen').then(function (s) {
        K.wakePending = false;
        if (!K.active) { try { s.release(); } catch (e) { /* 무시 */ } return; }
        K.wake = s;
        try { s.addEventListener('release', function () { if (K.wake === s) K.wake = null; }); } catch (e) { /* 무시 */ }
      }, function () { K.wakePending = false; });
    } catch (e) { K.wakePending = false; }
  }
  function releaseWake() {
    K.active = false;
    if (K.nativeOn) {
      try { window.DrumNative.keepScreenOn(false); } catch (e) { logErr(e, 'keepScreenOff'); }
      K.nativeOn = false;
    }
    if (K.wake) {
      var s = K.wake; K.wake = null;
      try { var p = s.release(); if (p && p.catch) p.catch(function () { /* 무시 */ }); } catch (e) { /* 무시 */ }
    }
  }
  document.addEventListener('visibilitychange', function () {
    if (!K.active) return;
    if (document.visibilityState === 'visible') { acquireWake(); updateClock(); checkOpen(); }
  });

  /* ---------------- 무조작 60초 ---------------- */
  function onActivity() {
    if (!K.active) return;
    if (K.idleTimer) clearTimeout(K.idleTimer);
    K.idleTimer = setTimeout(onIdle, IDLE_MS);
  }
  function onIdle() {
    K.idleTimer = null;
    if (!K.active) return;
    if (ui.sheetCount && ui.sheetCount()) ui.closeSheets();
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
    // 서명 창이 새로 열렸을 수 있으니 목록도 새로
    setTimeout(function () { if (K.active) ui.refresh(); }, 400);
  }
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
    document.addEventListener(ev, onActivity, { capture: true, passive: true });
  });

  /* ---------------- 시계 ---------------- */
  function updateClock() {
    if (!K.clockEls) return;
    var d = new Date();
    var t = U().fmtTime(d, { ampm: true }).split(' ');
    K.clockEls.ap.textContent = t[0] || '';
    K.clockEls.hm.textContent = t[1] || '';
    K.clockEls.date.textContent = U().fmtDate(U().today(d));
    K.clockEls.greet.textContent = greeting(d);
  }
  function openSignature(now) {
    var occs = [];
    try { occs = SC().occurrencesOn(data(), U().today(now)) || []; } catch (e) { return ''; }
    var s = settings(), nm = nowMin(now);
    return occs.map(function (o) {
      return SC().signWindowOpen(o, now, s) ? o.key + (eMin(o) <= nm ? ':e' : sMin(o) <= nm ? ':r' : ':o') : '';
    }).join(',');
  }
  function checkOpen() {
    if (!K.active) return;
    var sig = openSignature(new Date());
    if (sig !== K.openSig && !busy() && !(ui.sheetCount && ui.sheetCount())) ui.refresh();
  }

  /* ---------------- 타일 목록 ---------------- */
  function buildTiles(now) {
    var d = data(), s = settings(), date = U().today(now), nm = nowMin(now);
    var occs = [];
    try { occs = SC().occurrencesOn(d, date) || []; } catch (e) { logErr(e, 'occurrencesOn'); }
    var open = occs.filter(function (o) { return !o.canceled && SC().signWindowOpen(o, now, s); });
    var active = [], ended = [];
    open.forEach(function (o) {
      var ids = [];
      try { ids = SC().expectedStudents(d, o) || []; } catch (e) { logErr(e, 'expected'); }
      var tiles = ids.map(function (sid) {
        var st = DA.store.get('students', sid);
        if (!st) return null;
        var rec = DA.store.get('attendance', DA.store.attendanceKey(date, o.srcId, sid));
        var done = !!(rec && (rec.status === 'present' || rec.status === 'late'));
        return { occ: o, sid: sid, student: st, rec: rec || null, done: done };
      }).filter(Boolean);
      if (!tiles.length) return;
      tiles.sort(function (a, b) { return (a.done - b.done) || (U().collate ? U().collate(a.student.name, b.student.name) : String(a.student.name).localeCompare(String(b.student.name), 'ko')); });
      (eMin(o) <= nm ? ended : active).push({ occ: o, tiles: tiles });
    });
    // 곧 시작/진행 중 강조: 아직 서명 안 한 학생이 있는 첫 수업
    var focus = null;
    for (var i = 0; i < active.length; i++) {
      if (active[i].tiles.some(function (t) { return !t.done; })) { focus = active[i].occ.key; break; }
    }
    var next = null;
    occs.forEach(function (o) {
      if (o.canceled || SC().signWindowOpen(o, now, s)) return;
      if (sMin(o) > nm && (!next || sMin(o) < sMin(next))) next = o;
    });
    var attendedToday = 0;
    (d.attendance || []).forEach(function (r) { if (r.date === date && (r.status === 'present' || r.status === 'late')) attendedToday++; });
    return { active: active, ended: ended, focus: focus, next: next, nowMin: nm, date: date, attendedToday: attendedToday };
  }

  function tileEl(t, focus, nm) {
    var o = t.occ, st = t.student;
    var started = sMin(o) <= nm;
    var soon = !t.done && focus;
    var when = U().fmtTime(o.start) + ' 수업';
    var sub;
    if (t.done) {
      var at = t.rec && t.rec.signedAt ? U().fmtTime(new Date(t.rec.signedAt)) : '';
      sub = h('span', { class: 'ks-t-sub done' }, ic('check', 16), (at ? at + ' ' : '') + (t.rec.status === 'late' ? '지각 출석' : '출석 완료'));
    } else {
      sub = h('span', { class: 'ks-t-sub' }, when, o.teacherId ? h('span', { class: 'ks-t-teacher' }, ' · ' + ui.nameOf('teacher', o.teacherId)) : null);
    }
    var tag = null;
    if (soon) tag = h('span', { class: 'ks-t-tag' }, started ? '수업 중' : '곧 시작');
    else if (o.kind && o.kind !== 'regular' && !t.done && ui.kindBadge) tag = ui.kindBadge(o.kind);
    return h('button', {
      class: ['ks-tile', t.done ? 'done' : '', soon ? 'soon' : ''], type: 'button',
      style: { '--tc': ui.teacherColor(o.teacherId) },
      attrs: { 'aria-label': st.name + ' ' + when + (t.done ? ', 출석 완료' : ', 눌러서 서명') },
      onClick: function () {
        if (busy() || K.exiting) return;
        ui.haptic('light');
        DA.actions.sign(o, t.sid, { date: o.date, kiosk: true, confirmOtherDay: false }).catch(function (e) { logErr(e, 'sign'); });
      }
    },
      tag,
      t.done ? h('span', { class: 'ks-t-check', attrs: { 'aria-hidden': 'true' } }, ic('check', 18)) : null,
      ui.avatar(st.name, ui.studentColor(st), 'lg'),
      h('span', { class: 'ks-t-name' }, st.name),
      sub);
  }

  /* ---------------- 명단에 없어요(검색) ---------------- */
  function openSearch() {
    if (busy() || K.exiting) return;
    ui.haptic('light');
    var date = U().today();
    var query = '';
    var input = ui.input({
      type: 'search', placeholder: '이름 또는 초성 (예: ㄱㅁㅅ)', className: 'ks-search-input',
      onInput: function (v) { query = v; renderResults(); }
    });
    input.setAttribute('enterkeyhint', 'search');
    input.setAttribute('aria-label', '이름 검색');
    var results = h('div', { class: 'ks-results', attrs: { 'aria-live': 'polite' } });
    var pad = h('div', { class: 'ks-cho', attrs: { role: 'group', 'aria-label': '초성 키패드' } });
    CHO.forEach(function (c) {
      pad.appendChild(h('button', { class: 'ks-key', type: 'button', onClick: function () { press(c); } }, c));
    });
    pad.appendChild(h('button', { class: 'ks-key fn', type: 'button', attrs: { 'aria-label': '한 글자 지우기' }, onClick: function () { back(); } }, ic('backspace', 22)));
    pad.appendChild(h('button', { class: 'ks-key fn', type: 'button', onClick: function () { setQ(''); } }, '비우기'));

    function setQ(v) { query = v; input.value = v; renderResults(); }
    function press(c) { ui.haptic('select'); setQ(String(input.value || '') + c); }
    function back() { ui.haptic('select'); var v = Array.from(String(input.value || '')); v.pop(); setQ(v.join('')); }
    function pool() {
      return (data().students || []).filter(function (s) { return s && s.id && s.status !== 'left'; });
    }
    function renderResults() {
      ui.clear(results);
      var q = String(query || '').trim();
      if (!q) {
        results.appendChild(h('div', { class: 'ks-hint' }, ic('search', 22), h('span', null, '초성을 누르거나 이름을 입력하면 여기에 나와요')));
        return;
      }
      var list = pool().filter(function (s) { return U().matchName(s.name, q); });
      list.sort(function (a, b) { return U().collate ? U().collate(a.name, b.name) : String(a.name).localeCompare(String(b.name), 'ko'); });
      if (!list.length) {
        results.appendChild(h('div', { class: 'ks-hint' }, ic('info', 22), h('span', null, '찾는 이름이 없어요. 선생님께 말씀해 주세요 🙂')));
        return;
      }
      list.slice(0, 30).forEach(function (s) {
        results.appendChild(h('button', {
          class: 'ks-result', type: 'button',
          onClick: function () {
            ui.haptic('light');
            sh.close();
            setTimeout(function () {
              DA.actions.walkin({ date: date, studentId: s.id, kiosk: true }).catch(function (e) { logErr(e, 'walkin'); ui.toast('출석하지 못했어요. 선생님께 말씀해 주세요', { kind: 'error' }); });
            }, 60);
          }
        }, ui.avatar(s.name, ui.studentColor(s)), h('span', { class: 'ks-r-name' }, s.name), ic('chevR', 20)));
      });
      if (list.length > 30) results.appendChild(h('div', { class: 'ks-hint small' }, '더 정확하게 입력해 주세요 (' + list.length + '명)'));
    }
    var sh = ui.sheet({
      title: '명단에 이름이 없나요?',
      sub: '이름을 찾아 누르면 바로 서명할 수 있어요',
      size: 'full', autofocus: false, className: 'ks-search-sheet',
      content: h('div', { class: 'ks-search' },
        h('div', { class: 'input-group ks-search-box' }, ic('search', 22), input),
        h('div', { class: 'ks-search-body' }, pad, results))
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
        var only = results.querySelectorAll('.ks-result');
        if (only.length === 1) { e.preventDefault(); only[0].click(); }
      }
    });
    renderResults();
  }

  /* ---------------- 나가기(PIN) ---------------- */
  function exitKiosk() {
    K.exiting = true;
    ui.closeSheets();
    ui.haptic('light');
    ui.go('#/today', { replace: true, resetStack: true });
    setTimeout(function () { K.exiting = false; }, 500);
  }
  function requestExit() {
    if (K.pinOpen || K.exiting) return;
    var pin = String(settings().kioskPin || '');
    if (!/^\d{4}$/.test(pin)) {
      ui.confirm('키오스크를 끝내고 선생님 화면으로 돌아갈까요?\n설정에서 PIN을 정해 두면 학생이 실수로 나가지 못해요.', { title: '키오스크 끝내기', ok: '끝내기' })
        .then(function (ok) { if (ok) exitKiosk(); });
      return;
    }
    pinPad(pin).then(function (ok) { if (ok) exitKiosk(); });
  }
  function pinPad(pin) {
    K.pinOpen = true;
    return new Promise(function (resolve) {
      var entered = '', done = false, locked = false, fails = 0;
      function fin(v) { if (!done) { done = true; K.pinOpen = false; document.removeEventListener('keydown', onKey, true); resolve(v); } }
      var dots = h('div', { class: 'ks-pin-dots', attrs: { 'aria-live': 'polite', 'aria-label': '입력한 자리 0/4' } });
      var msg = h('div', { class: 'ks-pin-msg' }, '관리자 PIN 4자리를 눌러 주세요');
      function paint() {
        ui.clear(dots);
        for (var i = 0; i < 4; i++) dots.appendChild(h('span', { class: 'ks-pin-dot' + (i < entered.length ? ' on' : '') }));
        dots.setAttribute('aria-label', '입력한 자리 ' + entered.length + '/4');
      }
      function key(d) {
        if (locked || entered.length >= 4) return;
        ui.haptic('select');
        entered += d; paint();
        if (entered.length === 4) setTimeout(check, 120);
      }
      function del() { if (locked) return; entered = entered.slice(0, -1); paint(); }
      function check() {
        if (entered === pin) { ui.haptic('success'); fin(true); sh.close(true); return; }
        fails++;
        locked = true;
        ui.haptic('error');
        dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
        msg.textContent = fails >= 3 ? 'PIN이 맞지 않아요 (' + fails + '번째). 설정에서 정한 번호를 확인해 주세요' : 'PIN이 맞지 않아요. 다시 눌러 주세요';
        msg.classList.add('err');
        setTimeout(function () { entered = ''; locked = false; paint(); dots.classList.remove('shake'); }, 520);
      }
      var grid = h('div', { class: 'ks-pin-grid' });
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'].forEach(function (d) {
        grid.appendChild(h('button', { class: 'ks-pin-key', type: 'button', onClick: function () { key(d); } }, d));
      });
      grid.appendChild(h('button', { class: 'ks-pin-key fn', type: 'button', onClick: function () { sh.close(); } }, '취소'));
      grid.appendChild(h('button', { class: 'ks-pin-key', type: 'button', onClick: function () { key('0'); } }, '0'));
      grid.appendChild(h('button', { class: 'ks-pin-key fn', type: 'button', attrs: { 'aria-label': '지우기' }, onClick: del }, ic('backspace', 24)));
      function onKey(e) {
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); key(e.key); }
        else if (e.key === 'Backspace') { e.preventDefault(); del(); }
      }
      document.addEventListener('keydown', onKey, true);
      paint();
      var sh = ui.sheet({
        title: '키오스크 나가기', autofocus: false, className: 'ks-pin-sheet',
        content: h('div', { class: 'ks-pin' }, h('div', { class: 'ks-pin-ic' }, ic('lock', 26)), msg, dots, grid),
        onClose: function () { fin(false); }
      });
    });
  }

  function bindCorner(el) {
    var timer = null;
    function clear() { if (timer) { clearTimeout(timer); timer = null; } el.classList.remove('pressing'); }
    el.addEventListener('pointerdown', function () {
      clear();
      el.classList.add('pressing');
      timer = setTimeout(function () { timer = null; el.classList.remove('pressing'); ui.haptic('heavy'); requestExit(); }, CORNER_MS);
    });
    el.addEventListener('pointerup', clear);
    el.addEventListener('pointercancel', clear);
    el.addEventListener('pointerleave', clear);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ---------------- 그리기 ---------------- */
  function render(el) {
    acquireWake();
    onActivity();
    var now = new Date();
    var s = settings();
    var T = buildTiles(now);
    K.openSig = openSignature(now);
    el.classList.add('v-kiosk');

    var ap = h('span', { class: 'ks-ap' }), hm = h('span', { class: 'ks-hm num' });
    var dateEl = h('div', { class: 'ks-date' }), greet = h('div', { class: 'ks-greet' });
    K.clockEls = { ap: ap, hm: hm, date: dateEl, greet: greet };

    var corner = h('div', { class: 'ks-corner', attrs: { 'aria-hidden': 'true', title: '길게 누르면 나가기' } }, ic('drum', 28));
    bindCorner(corner);

    var top = h('header', { class: 'ks-top' },
      corner,
      h('div', { class: 'ks-academy ellipsis' }, s.academyName || '드럼 학원'),
      h('button', { class: 'btn btn-icon ks-lock', type: 'button', attrs: { 'aria-label': '키오스크 나가기' }, onClick: requestExit }, ic('lock', 20)));

    var hero = h('div', { class: 'ks-hero' },
      h('div', { class: 'ks-clock', attrs: { role: 'timer', 'aria-live': 'off' } }, ap, hm),
      dateEl,
      greet,
      h('div', { class: 'ks-lead' }, '자기 이름을 눌러 출석 서명을 해 주세요 ✍️'),
      T.attendedToday ? h('div', { class: 'ks-count' }, ic('check', 16), '오늘 ' + T.attendedToday + '명 출석') : null);

    var main = h('main', { class: 'ks-main' });
    if (!T.active.length && !T.ended.length) {
      var msg;
      if (T.next) {
        var wait = sMin(T.next) - T.nowMin;
        var before = +s.signWindowBeforeMin || 60;
        msg = '다음 수업은 ' + U().fmtTime(T.next.start, { ampm: true }) + '에 시작해요' + (wait > 0 ? ' (' + (U().fmtDuration ? U().fmtDuration(wait) : wait + '분') + ' 뒤)' : '') + '.\n수업 ' + before + '분 전부터 이름이 여기에 나와요.';
      } else msg = '오늘은 더 서명할 수업이 없어요.\n수업이 없는데 왔다면 아래 버튼을 눌러 주세요.';
      main.appendChild(h('div', { class: 'ks-empty' },
        h('div', { class: 'ks-empty-ic' }, ic('drum', 40)),
        h('h2', null, '지금은 서명할 수업이 없어요'),
        h('p', null, msg)));
    } else {
      var grid = h('div', { class: 'ks-grid' });
      T.active.forEach(function (g) {
        g.tiles.forEach(function (t) { grid.appendChild(tileEl(t, g.occ.key === T.focus, T.nowMin)); });
      });
      if (T.active.length) main.appendChild(grid);
      if (T.ended.length) {
        var grid2 = h('div', { class: 'ks-grid ks-grid-ended' });
        T.ended.forEach(function (g) { g.tiles.forEach(function (t) { grid2.appendChild(tileEl(t, false, T.nowMin)); }); });
        main.appendChild(h('div', { class: 'ks-sec' }, '앞서 끝난 수업'));
        main.appendChild(grid2);
      }
    }

    var foot = h('footer', { class: 'ks-foot' },
      h('button', { class: 'btn btn-lg ks-missing', type: 'button', onClick: openSearch }, ic('search', 22), '명단에 없어요'));

    el.appendChild(h('div', { class: 'ks' }, top, hero, main, foot));
    updateClock();

    if (K.clockTimer) clearInterval(K.clockTimer);
    K.clockTimer = setInterval(function () {
      if (document.visibilityState === 'hidden') return;
      updateClock();
      checkOpen();
    }, CLOCK_MS);

    return function () {
      if (K.clockTimer) { clearInterval(K.clockTimer); K.clockTimer = null; }
      K.clockEls = null;
    };
  }

  ui.registerView('kiosk', {
    title: '키오스크',
    module: 'kiosk',
    render: render,
    onLeave: function () {
      releaseWake();
      if (K.idleTimer) { clearTimeout(K.idleTimer); K.idleTimer = null; }
      if (K.clockTimer) { clearInterval(K.clockTimer); K.clockTimer = null; }
    },
    onBack: function () {
      // 안드로이드 뒤로가기: PIN이 있으면 PIN 입력, 없으면 셸이 오늘 화면으로 보낸다
      if (/^\d{4}$/.test(String(settings().kioskPin || ''))) { requestExit(); return true; }
      return false;
    }
  });
})(window.DA = window.DA || {});
