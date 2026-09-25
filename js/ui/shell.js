/* 드럼 출석부 — 셸 (SPEC §5)
 * h(), 뷰 등록·라우터, 시트(바텀시트/모달), 토스트, 확인창, 입력창, 수강생 고르기, 폼 부품, 햅틱·효과음, 색·이름 도우미.
 */
(function (DA) {
  'use strict';
  var ui = DA.ui = DA.ui || {};
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var SVG_TAGS = { svg: 1, g: 1, path: 1, circle: 1, rect: 1, line: 1, polyline: 1, polygon: 1, ellipse: 1, text: 1, tspan: 1, defs: 1, linearGradient: 1, radialGradient: 1, stop: 1, clipPath: 1, mask: 1, pattern: 1, use: 1, foreignObject: 1, symbol: 1, marker: 1 };

  /* ------------------------------------------------------------------
   * core 도우미(없으면 대체) — core 모듈이 늦게 오거나 일부가 없어도 셸은 돈다
   * ------------------------------------------------------------------ */
  function U() { return DA.util || {}; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function today() {
    if (U().today) return U().today();
    var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function parseYmd(s) {
    if (U().parseYmd) return U().parseYmd(s);
    var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  function fmtDate(ymd, opts) {
    if (U().fmtDate) return U().fmtDate(ymd, opts || { weekday: true });
    var d = parseYmd(ymd); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[d.getDay()] + ')';
  }
  function fmtTime(v, opts) {
    if (U().fmtTime) return U().fmtTime(v, opts || {});
    if (v instanceof Date) v = pad2(v.getHours()) + ':' + pad2(v.getMinutes());
    return String(v || '');
  }
  function chosung(s) {
    if (U().chosung) return U().chosung(s);
    var CH = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ', out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i) - 0xAC00;
      out += (c >= 0 && c <= 11171) ? CH.charAt(Math.floor(c / 588)) : s.charAt(i);
    }
    return out;
  }
  function matchName(name, q) {
    if (U().matchName) return U().matchName(name, q);
    name = String(name || '').replace(/\s+/g, '').toLowerCase(); q = String(q || '').replace(/\s+/g, '').toLowerCase();
    if (!q) return true;
    if (name.indexOf(q) >= 0) return true;
    return /^[ㄱ-ㅎ]+$/.test(q) && chosung(name).indexOf(q) >= 0;
  }
  ui._u = { today: today, parseYmd: parseYmd, fmtDate: fmtDate, fmtTime: fmtTime, matchName: matchName, chosung: chosung, pad2: pad2 };

  function settings() { return (DA.store && DA.store.data && DA.store.data.settings) || {}; }
  function students() { return (DA.store && DA.store.data && DA.store.data.students) || []; }
  function logErr(e, where) {
    try {
      DA.errors = DA.errors || [];
      DA.errors.push({ type: 'ui', where: where || '', message: String(e && e.message || e), stack: e && e.stack ? String(e.stack).slice(0, 2000) : '', at: new Date().toISOString() });
      if (DA.errors.length > 50) DA.errors.splice(0, DA.errors.length - 50);
    } catch (x) { /* 무시 */ }
    if (typeof console !== 'undefined') console.error('[' + (where || 'ui') + ']', e);
  }
  ui._logErr = logErr;

  /* ------------------------------------------------------------------
   * h(tag, props, ...children)
   *   tag: 'div', 'button.btn.btn-primary', 'span#id.cls', 'svg:title'(SVG 네임스페이스 강제)
   *   props: {class, style(문자열|객체), dataset, attrs, on:{click}, onClick…, html, text, ref(el)}
   * ------------------------------------------------------------------ */
  function append(el, c) {
    if (c == null || c === false || c === true) return;
    if (Array.isArray(c)) { for (var i = 0; i < c.length; i++) append(el, c[i]); return; }
    if (typeof c === 'object' && c.nodeType) { el.appendChild(c); return; }
    el.appendChild(document.createTextNode(String(c)));
  }
  function isPropsObject(p) {
    return p && typeof p === 'object' && !Array.isArray(p) && !p.nodeType;
  }
  function h(tag, props) {
    var children = Array.prototype.slice.call(arguments, 2);
    if (props != null && !isPropsObject(props)) { children.unshift(props); props = null; }
    tag = String(tag || 'div');
    var forceSvg = false;
    if (tag.indexOf('svg:') === 0) { forceSvg = true; tag = tag.slice(4); }
    var classes = [], id = null;
    if (tag.indexOf('.') >= 0 || tag.indexOf('#') >= 0) {
      var parts = tag.split(/(?=[.#])/);
      tag = parts[0] && parts[0].charAt(0) !== '.' && parts[0].charAt(0) !== '#' ? parts.shift() : 'div';
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].charAt(0) === '.') classes.push(parts[i].slice(1)); else if (parts[i].charAt(0) === '#') id = parts[i].slice(1);
      }
    }
    var isSvg = forceSvg || SVG_TAGS.hasOwnProperty(tag);
    var el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    if (id) el.setAttribute('id', id);
    if (classes.length) el.setAttribute('class', classes.join(' '));
    if (props) setProps(el, props, isSvg);
    append(el, children);
    return el;
  }
  function classStr(v) {
    if (Array.isArray(v)) return v.filter(Boolean).join(' ');
    if (v && typeof v === 'object') { var out = []; for (var k in v) if (v[k]) out.push(k); return out.join(' '); }
    return String(v);
  }
  function setProps(el, props, isSvg) {
    if (props.type != null && !isSvg) { try { el.type = props.type; } catch (e) { el.setAttribute('type', props.type); } }
    for (var k in props) {
      if (!props.hasOwnProperty(k) || k === 'type') continue;
      var v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') {
        var cur = el.getAttribute('class');
        el.setAttribute('class', (cur ? cur + ' ' : '') + classStr(v));
      } else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText += ';' + v;
        else for (var s in v) {
          if (v[s] == null) continue;
          if (s.indexOf('--') === 0 || s.indexOf('-') > 0) el.style.setProperty(s, v[s]); else el.style[s] = v[s];
        }
      } else if (k === 'dataset') {
        for (var d in v) if (v[d] != null) el.setAttribute('data-' + d.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); }), v[d]);
      } else if (k === 'attrs') {
        for (var a in v) if (v[a] != null && v[a] !== false) el.setAttribute(a, v[a] === true ? '' : v[a]);
      } else if (k === 'on') {
        for (var ev in v) if (typeof v[ev] === 'function') el.addEventListener(ev, v[ev]);
      } else if (k === 'html') {
        el.innerHTML = v;
      } else if (k === 'text') {
        el.textContent = v;
      } else if (k === 'ref') {
        if (typeof v === 'function') v(el);
      } else if (k.length > 2 && k.charAt(0) === 'o' && k.charAt(1) === 'n' && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (isSvg) {
        el.setAttribute(k, v);
      } else if (k in el && k !== 'list' && k !== 'form' && k !== 'width' && k !== 'height' && typeof el[k] !== 'function') {
        try { el[k] = v; } catch (e2) { el.setAttribute(k, v); }
      } else {
        el.setAttribute(k, v === true ? '' : v);
      }
    }
  }
  ui.h = h;
  ui.append = append;
  ui.clear = function (el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; };
  ui.mount = function (el) { ui.clear(el); append(el, Array.prototype.slice.call(arguments, 1)); return el; };
  function ic(name, size) { return ui.icon ? ui.icon(name, size) : h('span'); }

  /* ------------------------------------------------------------------
   * 색 · 이름
   * ------------------------------------------------------------------ */
  var FALLBACK_COLORS = ['#D9480F', '#2563EB', '#16A34A', '#9333EA', '#DB2777', '#0891B2', '#CA8A04', '#4F46E5', '#059669', '#E11D48'];
  function palette() { return (DA.C && DA.C.DEFAULT_COLORS && DA.C.DEFAULT_COLORS.length) ? DA.C.DEFAULT_COLORS : FALLBACK_COLORS; }
  function hashColor(key) {
    var s = String(key || ''), hsh = 0;
    for (var i = 0; i < s.length; i++) hsh = (hsh * 31 + s.charCodeAt(i)) | 0;
    var p = palette(); return p[Math.abs(hsh) % p.length];
  }
  function findIn(list, id) {
    if (!list || !id) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }
  ui.teacherColor = function (id) {
    if (!id) return '#A8A29E';
    var t = findIn(settings().teachers, id); return (t && t.color) || hashColor(id);
  };
  ui.courseColor = function (id) {
    if (!id) return '#A8A29E';
    var c = findIn(settings().courses, id); return (c && c.color) || hashColor(id);
  };
  ui.studentColor = function (student) {
    if (!student) return '#A8A29E';
    if (student.color) return student.color;
    if (student.courseId) return ui.courseColor(student.courseId);
    return hashColor(student.id || student.name);
  };
  var KIND_LISTS = { teacher: 'teachers', teachers: 'teachers', course: 'courses', courses: 'courses', level: 'levels', levels: 'levels', room: 'rooms', rooms: 'rooms' };
  ui.nameOf = function (kind, id) {
    if (!id) return '미지정';
    if (kind === 'student' || kind === 'students') {
      var s = DA.store && DA.store.get ? DA.store.get('students', id) : findIn(students(), id);
      return (s && s.name) || '미지정';
    }
    if (kind === 'lesson' || kind === 'lessons') {
      var l = DA.store && DA.store.get ? DA.store.get('lessons', id) : null;
      if (l && DA.schedule && DA.schedule.lessonLabel) return DA.schedule.lessonLabel(DA.store.data, l);
      return (l && l.title) || '미지정';
    }
    var listName = KIND_LISTS[kind];
    var item = listName ? findIn(settings()[listName], id) : null;
    return (item && item.name) || '미지정';
  };

  /* ------------------------------------------------------------------
   * 햅틱 · 효과음
   * ------------------------------------------------------------------ */
  var HAPTIC = { light: 10, tap: 10, select: 12, success: [14, 70, 26], ok: [14, 70, 26], warn: [30, 60, 30], error: [45, 60, 45, 60, 45], heavy: 32 };
  ui.haptic = function (kind) {
    var pat = HAPTIC[kind || 'light'] || 10;
    try {
      if (window.DrumNative && typeof window.DrumNative.vibrate === 'function') {
        var ms = Array.isArray(pat) ? pat.filter(function (_, i) { return i % 2 === 0; }).reduce(function (a, b) { return a + b; }, 0) : pat;
        window.DrumNative.vibrate(ms);
      } else if (navigator.vibrate) {
        navigator.vibrate(pat);
      }
    } catch (e) { /* 지원 안 함 */ }
  };

  var actx = null, master = null;
  function audioCtx() {
    if (actx) return actx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      actx = new AC();
      master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination);
    } catch (e) { actx = null; }
    return actx;
  }
  function unlockAudio() {
    if (settings().soundEnabled === false) return;
    var c = audioCtx(); if (!c) return;
    try {
      if (c.state === 'suspended' && c.resume) c.resume();
      var b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
      s.buffer = b; s.connect(c.destination); s.start(0);
    } catch (e) { /* 무시 */ }
    if (c.state === 'running') {
      document.removeEventListener('touchend', unlockAudio, true);
      document.removeEventListener('pointerdown', unlockAudio, true);
      document.removeEventListener('keydown', unlockAudio, true);
    }
  }
  document.addEventListener('touchend', unlockAudio, true);
  document.addEventListener('pointerdown', unlockAudio, true);
  document.addEventListener('keydown', unlockAudio, true);

  function tone(c, freq, t0, dur, vol) {
    var o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), g2 = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t0);
    o2.type = 'triangle'; o2.frequency.setValueAtTime(freq * 2, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g2.gain.setValueAtTime(0.0001, t0);
    g2.gain.exponentialRampToValueAtTime(vol * 0.18, t0 + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.6);
    o.connect(g); o2.connect(g2); g.connect(master); g2.connect(master);
    o.start(t0); o2.start(t0); o.stop(t0 + dur + 0.05); o2.stop(t0 + dur + 0.05);
  }
  ui.chime = function (kind) {
    if (settings().soundEnabled === false) return;
    var c = audioCtx(); if (!c) return;
    try {
      if (c.state === 'suspended' && c.resume) c.resume();
      var t = c.currentTime + 0.02;
      if (kind === 'late') { tone(c, 783.99, t, 0.22, 0.16); tone(c, 1046.5, t + 0.11, 0.34, 0.14); }
      else if (kind === 'error') { tone(c, 440, t, 0.18, 0.14); tone(c, 349.23, t + 0.12, 0.28, 0.12); }
      else { tone(c, 1046.5, t, 0.2, 0.16); tone(c, 1567.98, t + 0.1, 0.38, 0.14); }
    } catch (e) { /* 소리 실패는 무시 */ }
  };

  /* ------------------------------------------------------------------
   * 토스트
   * ------------------------------------------------------------------ */
  var TOAST_IC = { ok: 'check', warn: 'alert', error: 'x' };
  ui.toast = function (msg, opts) {
    opts = opts || {};
    var root = document.getElementById('toast-root');
    if (!root) { root = h('div', { id: 'toast-root', attrs: { 'aria-live': 'polite' } }); document.body.appendChild(root); }
    var kind = opts.kind || 'ok';
    var ms = opts.ms != null ? opts.ms : (opts.action ? 4500 : (kind === 'error' ? 3800 : 2400));
    var el = h('div', { class: 'toast ' + kind, attrs: { role: kind === 'error' ? 'alert' : 'status' } },
      h('span', { class: 'toast-ic' }, ic(TOAST_IC[kind] || 'info', 15)),
      h('span', { class: 'toast-msg' }, msg));
    var timer = null, closed = false;
    function close() {
      if (closed) return; closed = true; clearTimeout(timer);
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }
    if (opts.action && opts.action.label) {
      el.appendChild(h('button', {
        class: 'toast-act', type: 'button',
        onClick: function (e) { e.stopPropagation(); close(); try { opts.action.onClick && opts.action.onClick(); } catch (x) { logErr(x, 'toast'); } }
      }, opts.action.label));
    }
    el.addEventListener('click', close);
    while (root.children.length >= 3) root.removeChild(root.firstChild);
    root.appendChild(el);
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('show'); }); });
    if (ms > 0) timer = setTimeout(close, ms);
    return { close: close, el: el };
  };

  /* ------------------------------------------------------------------
   * 시트 스택
   * ------------------------------------------------------------------ */
  var stack = [];
  var FOCUSABLE = 'input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  var TEXTY = 'input[autofocus], textarea[autofocus], input:not([type]), input[type=text], input[type=search], input[type=tel], input[type=number], input[type=email], input[type=password], input[type=url], textarea';

  function lockScroll() { document.documentElement.classList.add('scroll-lock'); }
  function unlockScroll() { document.documentElement.classList.remove('scroll-lock'); }

  function syncViewport() {
    var vv = window.visualViewport, root = document.documentElement;
    var kb = vv && stack.length ? window.innerHeight - vv.height : 0;
    if (kb > 80) {
      root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
      root.style.setProperty('--vvt', Math.round(vv.offsetTop) + 'px');
      root.classList.add('kb-open');
    } else {
      root.classList.remove('kb-open');
      root.style.removeProperty('--vvh'); root.style.removeProperty('--vvt');
    }
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncViewport);
    window.visualViewport.addEventListener('scroll', syncViewport);
  }

  function scrollableAncestor(t, layer) {
    while (t && t !== layer) {
      if (t.nodeType === 1) {
        if (t.classList.contains('sig-pad')) return t;
        if (t.classList.contains('hscroll') || t.classList.contains('table-wrap') || t.classList.contains('seg') || t.hasAttribute('data-scroll')) return t;
        if (t.classList.contains('sheet-b') && t.scrollHeight > t.clientHeight + 1) return t;
        if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type === 'range')) return t;
      }
      t = t.parentNode;
    }
    return null;
  }

  /**
   * DA.ui.sheet({title, sub, content, actions, size:'auto'|'full'|'wide', onClose, dismissible=true,
   *              header=true, className, autofocus=true, closeButton=true})
   *   → {close(result), el, body, layer, buttons, setTitle(text)}
   */
  ui.sheet = function (opts) {
    opts = opts || {};
    var size = opts.size || 'auto';
    var dismissible = opts.dismissible !== false;
    var closed = false;
    var prevFocus = document.activeElement;
    var layer = h('div', { class: 'sheet-layer', attrs: { role: 'dialog', 'aria-modal': 'true' } });
    layer.style.zIndex = String(100 + stack.length * 2);
    var backdrop = h('div', { class: 'sheet-backdrop' });
    var sheetEl = h('div', { class: ['sheet', size === 'full' ? 'full' : '', size === 'wide' ? 'wide' : '', opts.className || ''], attrs: { tabindex: '-1' } });
    var body = h('div', { class: 'sheet-b' });
    var titleEl = null, header = null, grip = null;
    var api = { el: sheetEl, body: body, layer: layer, buttons: [] };

    function close(result) {
      if (closed) return; closed = true;
      var idx = stack.indexOf(api); if (idx >= 0) stack.splice(idx, 1);
      layer.classList.remove('open'); layer.classList.add('closing');
      var removed = false;
      function remove() { if (removed) return; removed = true; if (layer.parentNode) layer.parentNode.removeChild(layer); }
      sheetEl.addEventListener('transitionend', function (e) { if (e.target === sheetEl) remove(); });
      setTimeout(remove, 380);
      if (!stack.length) { unlockScroll(); syncViewport(); }
      try { if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
      if (typeof opts.onClose === 'function') { try { opts.onClose(result); } catch (e) { logErr(e, 'sheet.onClose'); } }
    }
    api.close = close;
    api.isOpen = function () { return !closed; };
    api.dismissible = dismissible;

    if (size !== 'full') grip = h('div', { class: 'sheet-grip', attrs: { 'aria-hidden': 'true' } });
    if (opts.header !== false && (opts.title || opts.closeButton !== false)) {
      titleEl = h('h2', { class: 'sheet-title' }, opts.title || '');
      header = h('div', { class: 'sheet-h' },
        h('div', { class: 'grow' }, titleEl, opts.sub ? h('div', { class: 'sheet-sub' }, opts.sub) : null),
        opts.closeButton === false ? null : h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '닫기' }, onClick: function () { close(); } }, ic('x', 22)));
      layer.setAttribute('aria-label', opts.title || '');
    }
    api.setTitle = function (t) { if (titleEl) titleEl.textContent = t; };

    var content = opts.content;
    if (typeof content === 'function') {
      try { content = content(close, api); } catch (e) { logErr(e, 'sheet.content'); content = h('div', { class: 'banner error' }, '화면을 그리지 못했어요.'); }
    }
    append(body, content);

    var footer = null;
    if (opts.actions && opts.actions.length) {
      footer = h('div', { class: 'sheet-f' });
      opts.actions.forEach(function (a) {
        if (!a) return;
        var cls = 'btn ' + (a.kind === 'primary' ? 'btn-primary' : a.kind === 'danger' ? 'btn-danger' : a.kind === 'ghost' ? 'btn-ghost' : '');
        var b = h('button', { class: cls + (a.className ? ' ' + a.className : ''), type: 'button', disabled: !!a.disabled }, a.icon ? ic(a.icon, 18) : null, a.label);
        b._wasDisabled = !!a.disabled;
        b.addEventListener('click', function () {
          if (closed || b.disabled) return;
          var r;
          try { r = a.onClick ? a.onClick(close, api) : undefined; } catch (e) { logErr(e, 'sheet.action'); ui.toast('처리하지 못했어요. 다시 시도해 주세요.', { kind: 'error' }); return; }
          if (r && typeof r.then === 'function') {
            api.buttons.forEach(function (x) { x.disabled = true; });
            r.then(function (v) {
              if (v !== false) close(); else api.buttons.forEach(function (x) { x.disabled = !!x._wasDisabled; });
            }, function (err) {
              logErr(err, 'sheet.action');
              ui.toast('처리하지 못했어요: ' + (err && err.message || err), { kind: 'error' });
              api.buttons.forEach(function (x) { x.disabled = !!x._wasDisabled; });
            });
          } else if (r !== false) close();
        });
        api.buttons.push(b);
        footer.appendChild(b);
      });
    }

    append(sheetEl, [grip, header, body, footer]);
    layer.appendChild(backdrop);
    layer.appendChild(sheetEl);

    backdrop.addEventListener('click', function () { if (dismissible) close(); });
    // 배경 스크롤 막기(iOS): 스크롤 가능한 영역 밖의 touchmove는 막는다
    layer.addEventListener('touchmove', function (e) {
      if (!scrollableAncestor(e.target, layer)) e.preventDefault();
    }, { passive: false });

    // 스와이프로 닫기(폰 바텀시트: 손잡이·머리 영역)
    if (size !== 'full') setupDrag(api, sheetEl, [grip, header], dismissible);

    var root = document.getElementById('sheet-root') || document.body;
    root.appendChild(layer);
    stack.push(api);
    lockScroll();
    syncViewport();
    // 강제 리플로 후 열기 애니메이션
    void sheetEl.offsetHeight;
    layer.classList.add('open');

    setTimeout(function () {
      if (closed) return;
      var target = null;
      if (opts.autofocus !== false) target = body.querySelector('[autofocus]') || body.querySelector(TEXTY);
      try { (target || sheetEl).focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
    }, opts.autofocus === 'now' ? 0 : 60);
    if (opts.autofocus === 'now') {
      var t0 = body.querySelector('[autofocus]') || body.querySelector(TEXTY);
      if (t0) try { t0.focus({ preventScroll: true }); } catch (e) { /* 무시 */ }
    }
    return api;
  };

  function setupDrag(api, sheetEl, handles, dismissible) {
    var startY = 0, lastY = 0, lastT = 0, vel = 0, dragging = false, pid = null, target = null;
    function isWide() { return window.matchMedia && window.matchMedia('(min-width: 720px)').matches; }
    function down(e) {
      if (isWide() || !dismissible) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest && e.target.closest('button, a, input, select, textarea')) return;
      dragging = true; pid = e.pointerId; target = e.currentTarget;
      startY = lastY = e.clientY; lastT = e.timeStamp || Date.now(); vel = 0;
      try { target.setPointerCapture(pid); } catch (x) { /* 무시 */ }
      api.layer.classList.add('dragging');
    }
    function move(e) {
      if (!dragging || e.pointerId !== pid) return;
      var y = e.clientY, t = e.timeStamp || Date.now();
      var dt = Math.max(1, t - lastT);
      vel = 0.8 * ((y - lastY) / dt) + 0.2 * vel;
      lastY = y; lastT = t;
      var dy = Math.max(0, y - startY);
      var rubber = y < startY ? -Math.min(24, Math.sqrt(startY - y) * 2) : 0;
      sheetEl.style.transform = 'translate3d(0,' + (dy + rubber) + 'px,0)';
    }
    function up(e) {
      if (!dragging || (e && e.pointerId !== pid)) return;
      dragging = false;
      api.layer.classList.remove('dragging');
      var dy = Math.max(0, lastY - startY);
      var hgt = sheetEl.getBoundingClientRect().height || 400;
      if (dy > Math.min(140, hgt * 0.3) || (vel > 0.55 && dy > 12)) {
        sheetEl.style.transform = '';
        api.close();
      } else {
        sheetEl.style.transform = '';
      }
    }
    handles.forEach(function (hd) {
      if (!hd) return;
      hd.addEventListener('pointerdown', down);
      hd.addEventListener('pointermove', move);
      hd.addEventListener('pointerup', up);
      hd.addEventListener('pointercancel', up);
    });
  }

  ui.sheetCount = function () { return stack.length; };
  ui.topSheet = function () { return stack[stack.length - 1] || null; };
  ui.closeTopSheet = function () { var s = stack[stack.length - 1]; if (s) { s.close(); return true; } return false; };
  ui.closeSheets = function () { var copy = stack.slice().reverse(); copy.forEach(function (s) { s.close(); }); return copy.length; };

  document.addEventListener('keydown', function (e) {
    if (!stack.length) return;
    var top = stack[stack.length - 1];
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (top.dismissible) { e.preventDefault(); top.close(); }
    } else if (e.key === 'Tab') {
      var f = Array.prototype.filter.call(top.el.querySelectorAll(FOCUSABLE), function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (!top.el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ------------------------------------------------------------------
   * 확인창 · 입력창
   * ------------------------------------------------------------------ */
  ui.confirm = function (msg, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      ui.sheet({
        title: opts.title || '확인',
        className: 'confirm-sheet',
        autofocus: false,
        content: h('div', { class: 'sheet-msg' }, msg),
        actions: [
          { label: opts.cancel || '취소', kind: 'ghost', onClick: function () { fin(false); } },
          { label: opts.ok || '확인', kind: opts.danger ? 'danger' : 'primary', onClick: function () { fin(true); } }
        ],
        onClose: function () { fin(false); }
      });
    });
  };

  ui.promptText = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false, sh = null;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var type = opts.type || 'text';
      var input = ui.input({
        value: opts.value == null ? '' : opts.value, type: type, placeholder: opts.placeholder || '',
        maxLength: opts.maxLength, inputmode: opts.inputmode, min: opts.min, max: opts.max, step: opts.step,
        onInput: function () { sync(); }
      });
      input.setAttribute('autofocus', '');
      if (type !== 'textarea') {
        input.setAttribute('enterkeyhint', 'done');
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(); }
        });
      }
      function val() { return String(input.value == null ? '' : input.value).trim(); }
      function sync() { if (sh && sh.buttons[1]) sh.buttons[1].disabled = !!opts.required && !val(); }
      function submit() {
        if (opts.required && !val()) { input.focus(); return; }
        fin(val()); if (sh) sh.close();
      }
      sh = ui.sheet({
        title: opts.title || '입력',
        sub: opts.sub,
        content: h('div', null,
          opts.message ? h('p', { class: 'sheet-msg' }, opts.message) : null,
          ui.field(opts.label || '', input, opts.hint)),
        actions: [
          { label: opts.cancel || '취소', kind: 'ghost', onClick: function () { fin(null); } },
          { label: opts.ok || '확인', kind: opts.danger ? 'danger' : 'primary', onClick: function () { if (opts.required && !val()) return false; fin(val()); } }
        ],
        onClose: function () { fin(null); }
      });
      sync();
    });
  };

  /* ------------------------------------------------------------------
   * 폼 부품
   * ------------------------------------------------------------------ */
  var fieldSeq = 0;
  ui.field = function (label, control, hint) {
    var id = null;
    var tag = control && control.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      id = control.id || ('f' + (++fieldSeq)); control.id = id;
    }
    return h('div', { class: 'field' },
      label ? h('label', { class: 'field-label', attrs: id ? { for: id } : null }, label) : null,
      control,
      hint ? h('div', { class: 'field-hint' }, hint) : null);
  };

  ui.input = function (o) {
    o = o || {};
    var isArea = o.type === 'textarea';
    var el = isArea ? h('textarea', { class: 'input', rows: o.rows || 3 }) : h('input', { class: 'input', type: o.type || 'text' });
    if (o.value != null) el.value = o.value;
    if (o.placeholder) el.placeholder = o.placeholder;
    if (o.maxLength) el.maxLength = o.maxLength;
    if (o.min != null) el.setAttribute('min', o.min);
    if (o.max != null) el.setAttribute('max', o.max);
    if (o.step != null) el.setAttribute('step', o.step);
    if (o.inputmode) el.setAttribute('inputmode', o.inputmode);
    else if (o.type === 'number') el.setAttribute('inputmode', 'numeric');
    else if (o.type === 'tel') el.setAttribute('inputmode', 'tel');
    if (o.autocomplete) el.setAttribute('autocomplete', o.autocomplete);
    else if (!isArea && o.type !== 'password') el.setAttribute('autocomplete', 'off');
    if (o.required) el.required = true;
    if (o.readonly) el.readOnly = true;
    if (o.id) el.id = o.id;
    if (o.name) el.name = o.name;
    if (o.list) el.setAttribute('list', o.list);
    if (o.className) el.className += ' ' + o.className;
    if (o.attrs) for (var k in o.attrs) if (o.attrs[k] != null) el.setAttribute(k, o.attrs[k]);
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
    if (o.onInput) el.addEventListener('input', function () { o.onInput(el.value, el); });
    if (o.onChange) el.addEventListener('change', function () { o.onChange(el.value, el); });
    if (o.onEnter) el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); o.onEnter(el.value, el); } });
    return el;
  };

  ui.select = function (options, value, onChange) {
    var el = h('select', { class: 'select' });
    (options || []).forEach(function (op) {
      if (op == null) return;
      if (typeof op !== 'object') op = { value: op, label: String(op) };
      var o = h('option', { value: String(op.value == null ? '' : op.value) }, op.label == null ? String(op.value) : op.label);
      if (op.disabled) o.disabled = true;
      el.appendChild(o);
    });
    el.value = value == null ? '' : String(value);
    if (el.selectedIndex < 0 && el.options.length) el.selectedIndex = 0;
    if (onChange) el.addEventListener('change', function () { onChange(el.value, el); });
    return el;
  };

  ui.segmented = function (options, value, onChange) {
    var cur = value;
    var el = h('div', { class: 'seg', attrs: { role: 'radiogroup' } });
    var btns = [];
    (options || []).forEach(function (op) {
      if (op == null) return;
      if (typeof op !== 'object') op = { value: op, label: String(op) };
      var b = h('button', { type: 'button', attrs: { role: 'radio' } }, op.icon ? ic(op.icon, 16) : null, op.label);
      b._value = op.value;
      b.addEventListener('click', function () {
        var changed = cur !== op.value;
        set(op.value);
        if (changed) ui.haptic('select');
        if (changed && onChange) onChange(op.value, el);
      });
      btns.push(b); el.appendChild(b);
    });
    function set(v) {
      cur = v;
      btns.forEach(function (b) {
        var on = b._value === v;
        b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
      });
    }
    set(cur);
    el.getValue = function () { return cur; };
    el.setValue = set;
    // 선택된 칸이 보이도록(가로 스크롤)
    setTimeout(function () {
      var on = el.querySelector('.on');
      if (on && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, on.offsetLeft - 24);
    }, 0);
    return el;
  };

  ui.toggle = function (checked, onChange, label) {
    var input = h('input', { type: 'checkbox', attrs: { role: 'switch', 'aria-label': label || '' } });
    input.checked = !!checked;
    if (onChange) input.addEventListener('change', function () { ui.haptic('select'); onChange(input.checked, input); });
    var el = h('label', { class: 'switch' }, input, h('span'));
    el.input = input;
    return el;
  };

  ui.badge = function (status, opts) {
    opts = opts || {};
    // v1.1 간단 모드: 지각 개념 없음 → 옛 지각 기록도 '출석'으로 보여 준다
    if (status === 'late' && ui.simpleMode()) status = 'present';
    var labels = (DA.C && DA.C.STATUS) || {};
    var label = labels[status] || ({ present: '출석', late: '지각', absent: '결석', excused: '공결', canceled: '휴강', unmarked: '미확인', pending: '서명 대기', upcoming: '예정' })[status] || String(status || '');
    return h('span', { class: 'badge st-' + status + (opts.auto ? ' auto' : '') + (opts.lg ? ' lg' : ''), attrs: { title: opts.auto ? '기록이 없어 자동으로 ' + label + ' 처리' : null } },
      label, opts.auto ? h('i', null, '자동') : null);
  };
  ui.simpleMode = function () { return settings().simpleMode !== false; };
  ui.kindBadge = function (kind) {
    var K = (DA.C && DA.C.KIND) || { regular: '정규', makeup: '보강', special: '특강', trial: '체험', walkin: '이용권' };
    return h('span', { class: 'badge k-' + kind }, K[kind] || kind);
  };

  ui.avatar = function (name, color, size) {
    var s = String(name || '').trim();
    var ch = s ? Array.from(s)[0] : '?';
    return h('span', { class: 'avatar' + (size ? ' ' + size : ''), style: { background: color || hashColor(s) }, attrs: { 'aria-hidden': 'true' } }, ch);
  };

  ui.empty = function (icon, title, text, action) {
    var act = null;
    if (action) {
      if (action.nodeType) act = action;
      else act = h('button', { class: 'btn ' + (action.kind === 'ghost' ? 'btn-ghost' : 'btn-primary'), type: 'button', onClick: action.onClick }, action.icon ? ic(action.icon, 18) : null, action.label);
    }
    return h('div', { class: 'empty' },
      icon ? h('div', { class: 'empty-ic' }, ic(icon, 30)) : null,
      title ? h('h3', null, title) : null,
      text ? h('p', null, text) : null,
      act);
  };

  ui.banner = function (kind, text, opts) {
    opts = opts || {};
    var icons = { warn: 'alert', info: 'info', ok: 'check', error: 'alert', accent: 'drum' };
    return h('div', { class: 'banner ' + (kind || 'info') },
      ic(opts.icon || icons[kind] || 'info', 20),
      h('div', { class: 'banner-body' }, opts.title ? h('div', { class: 'banner-title' }, opts.title) : null, text),
      opts.action ? h('button', { class: 'btn btn-sm ' + (opts.action.kind === 'primary' ? 'btn-primary' : ''), type: 'button', onClick: opts.action.onClick }, opts.action.label) : null);
  };

  /* ------------------------------------------------------------------
   * 파일 저장·열기·인쇄 (안드로이드 DrumNative / 웹 공유시트·다운로드)
   * ------------------------------------------------------------------ */
  /* 안드로이드: 저장 창(ACTION_CREATE_DOCUMENT) 결과를 window.DA_onNativeSaved(status, name)로 받는다.
     'saved' → 'native', 'canceled'·'error' → 'cancel'. 콜백이 안 오는 옛 껍데기 대비: 앱으로 돌아온 뒤 6초면 'native'. */
  var nativeSaveWait = null;
  window.DA_onNativeSaved = function (status, name) {
    var w = nativeSaveWait; nativeSaveWait = null;
    if (!w) { if (status === 'saved') ui.toast('저장했어요' + (name ? ': ' + name : ''), { kind: 'ok' }); return; }
    w.done(status === 'saved' ? 'native' : 'cancel', name);
  };
  function nativeSave(filename, mime, text) {
    if (nativeSaveWait) nativeSaveWait.done('cancel');
    return new Promise(function (resolve) {
      var timer = null, settled = false;
      function onResume() { clearTimeout(timer); timer = setTimeout(function () { w.done('native'); }, 6000); }
      var w = {
        done: function (res) {
          if (settled) return; settled = true;
          clearTimeout(timer); window.removeEventListener('da:resume', onResume);
          if (nativeSaveWait === w) nativeSaveWait = null;
          resolve(res);
        }
      };
      nativeSaveWait = w;
      window.addEventListener('da:resume', onResume);
      try { window.DrumNative.saveFile(filename, mime, text); } catch (e) { logErr(e, 'saveFile.native'); w.done('cancel'); }
    });
  }

  ui.saveFile = function (filename, mime, text) {
    mime = mime || 'application/octet-stream';
    try {
      if (window.DrumNative && typeof window.DrumNative.saveFile === 'function') {
        return nativeSave(filename, mime, String(text));
      }
    } catch (e) { logErr(e, 'saveFile.native'); }
    var blob = new Blob([text], { type: mime });
    var file = null;
    try { file = new File([blob], filename, { type: mime }); } catch (e) { file = null; }
    var isApple = (U().isIOS ? U().isIOS() : /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    if (file && isApple && navigator.canShare && navigator.share) {
      try {
        if (navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: filename }).then(function () { return 'share'; }, function (err) {
            if (err && err.name === 'AbortError') return 'cancel';
            download(blob, filename); return 'download';
          });
        }
      } catch (e) { /* 다운로드로 */ }
    }
    download(blob, filename);
    return Promise.resolve('download');
  };
  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, attrs: { download: filename }, style: 'display:none' });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 4000);
  }
  // 파일 열기 → Promise<{text, name}|null>
  ui.openFile = function (accept) {
    return new Promise(function (resolve) {
      var settled = false;
      function fin(v) { if (!settled) { settled = true; resolve(v); } }
      if (window.DrumNative && typeof window.DrumNative.openFile === 'function') {
        var prev = window.DA_onNativeFile;
        window.DA_onNativeFile = function (text, name) {
          window.DA_onNativeFile = prev;
          fin({ text: String(text == null ? '' : text), name: name || '' });
        };
        try { window.DrumNative.openFile(accept || '*/*'); return; } catch (e) { window.DA_onNativeFile = prev; logErr(e, 'openFile.native'); }
      }
      var inp = h('input', { type: 'file', style: 'position:fixed;left:-9999px;top:0;opacity:0' });
      if (accept) inp.setAttribute('accept', accept);
      function onBack() {
        window.removeEventListener('focus', onBack);
        setTimeout(function () {
          if (!settled && !(inp.files && inp.files.length)) { if (inp.parentNode) inp.parentNode.removeChild(inp); fin(null); }
        }, 1500);
      }
      inp.addEventListener('cancel', function () { if (inp.parentNode) inp.parentNode.removeChild(inp); fin(null); });
      setTimeout(function () { window.addEventListener('focus', onBack); }, 300);
      inp.addEventListener('change', function () {
        window.removeEventListener('focus', onBack);
        var f = inp.files && inp.files[0];
        if (inp.parentNode) inp.parentNode.removeChild(inp);
        if (!f) { fin(null); return; }
        var rd = new FileReader();
        rd.onload = function () { fin({ text: String(rd.result || ''), name: f.name }); };
        rd.onerror = function () { ui.toast('파일을 읽지 못했어요', { kind: 'error' }); fin(null); };
        rd.readAsText(f, 'utf-8');
      });
      document.body.appendChild(inp);
      inp.click();
    });
  };
  ui.print = function (title) {
    try {
      if (window.DrumNative && typeof window.DrumNative.print === 'function') { window.DrumNative.print(title || document.title); return; }
    } catch (e) { logErr(e, 'print.native'); }
    window.print();
  };

  /* ------------------------------------------------------------------
   * 수강생 고르기
   * ------------------------------------------------------------------ */
  var STATUS_TABS = [
    { value: 'active', label: '재원' }, { value: 'paused', label: '휴원' }, { value: 'left', label: '퇴원' }, { value: 'all', label: '전체' }
  ];
  ui.pickStudent = function (opts) {
    opts = opts || {};
    var multiple = !!opts.multiple;
    var selected = (opts.selected || []).slice();
    var statusTab = opts.status || 'active';
    var query = '';
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return new Promise(function (resolve) {
      var done = false, sh;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var all = students().slice().filter(function (s) { return s && s.id && (!opts.filter || safeFilter(opts.filter, s)); });
      all.sort(function (a, b) {
        var ra = a.status === 'active' ? 0 : a.status === 'paused' ? 1 : 2, rb = b.status === 'active' ? 0 : b.status === 'paused' ? 1 : 2;
        return ra - rb || String(a.name).localeCompare(String(b.name), 'ko');
      });
      // v1.1: 호출측 정렬(예: 이번 달 이용권 있는 재원생 먼저)
      if (typeof opts.sort === 'function') { try { all.sort(opts.sort); } catch (e) { logErr(e, 'pickStudent.sort'); } }
      var counts = { active: 0, paused: 0, left: 0, all: all.length };
      all.forEach(function (s) { counts[s.status || 'active'] = (counts[s.status || 'active'] || 0) + 1; });
      if (!counts[statusTab] && statusTab !== 'all') statusTab = 'all';

      var search = ui.input({ type: 'search', placeholder: '이름 또는 초성 검색 (예: ㄱㅁㅅ)', onInput: function (v) { query = v; renderList(); } });
      search.setAttribute('enterkeyhint', 'search');
      if (!coarse) search.setAttribute('autofocus', '');
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          var vis = visible();
          if (vis.length === 1) choose(vis[0].id);
        }
      });
      var chipsEl = h('div', { class: 'chips' });
      var listEl = h('div', { class: 'list pick-list' });
      var countEl = multiple ? h('div', { class: 'pick-count' }) : null;

      function renderChips() {
        ui.clear(chipsEl);
        STATUS_TABS.forEach(function (t) {
          if (t.value !== 'all' && t.value !== 'active' && !counts[t.value]) return;
          chipsEl.appendChild(h('button', {
            class: 'chip' + (statusTab === t.value ? ' on' : ''), type: 'button',
            onClick: function () { statusTab = t.value; renderChips(); renderList(); }
          }, t.label, h('span', { class: 'count' }, counts[t.value] || 0)));
        });
      }
      function visible() {
        return all.filter(function (s) {
          var st = s.status || 'active';
          var inTab = statusTab === 'all' || st === statusTab || (multiple && selected.indexOf(s.id) >= 0 && !query);
          return inTab && matchName(s.name, query);
        });
      }
      function sub(s) {
        var parts = [];
        if (s.courseId) parts.push(ui.nameOf('course', s.courseId));
        if (s.levelId) parts.push(ui.nameOf('level', s.levelId));
        if (s.teacherId) parts.push(ui.nameOf('teacher', s.teacherId));
        return parts.join(' · ') || (s.school || '정보 없음');
      }
      function renderList() {
        ui.clear(listEl);
        var vis = visible();
        if (!vis.length) {
          listEl.appendChild(ui.empty('search', all.length ? '찾는 수강생이 없어요' : '등록된 수강생이 없어요',
            all.length ? (statusTab !== 'all' ? '‘전체’에서 찾아보거나 다른 이름으로 검색해 보세요.' : '이름이나 초성을 다시 확인해 주세요.') : '수강생 탭에서 먼저 등록해 주세요.'));
        }
        vis.forEach(function (s) {
          var sel = selected.indexOf(s.id) >= 0;
          var st = s.status || 'active';
          listEl.appendChild(h('button', {
            class: 'list-item' + (sel ? ' sel' : ''), type: 'button',
            onClick: function () { choose(s.id); }
          },
            ui.avatar(s.name, ui.studentColor(s)),
            h('div', { class: 'li-main' },
              h('div', { class: 'li-title' }, s.name),
              h('div', { class: 'li-sub' }, opts.sub ? safeCall(opts.sub, s, sub(s)) : sub(s))),
            h('div', { class: 'li-end' },
              opts.badge ? safeCall(opts.badge, s, null) : null,
              st === 'paused' ? h('span', { class: 'badge warn' }, '휴원') : st === 'left' ? h('span', { class: 'badge st-canceled' }, '퇴원') : null,
              multiple ? h('span', { class: 'pick-check' }, ic('check', 16)) : ic('chevR', 18))));
        });
        if (countEl) countEl.textContent = selected.length ? selected.length + '명 선택됨' : '여러 명을 고를 수 있어요';
        if (sh && sh.buttons[1]) {
          sh.buttons[1].textContent = selected.length ? selected.length + '명 선택' : '선택 완료';
          sh.buttons[1].disabled = !opts.allowEmpty && !selected.length && !(opts.selected && opts.selected.length);
        }
      }
      function choose(id) {
        ui.haptic('select');
        if (!multiple) { fin(id); sh.close(); return; }
        var i = selected.indexOf(id);
        if (i >= 0) selected.splice(i, 1); else selected.push(id);
        renderList();
      }
      renderChips();
      sh = ui.sheet({
        title: opts.title || (multiple ? '수강생 선택 (여러 명)' : '수강생 선택'),
        className: 'pick-sheet',
        autofocus: !coarse,
        content: h('div', null,
          h('div', { class: 'pick-top' }, h('div', { class: 'input-group' }, ic('search', 20), search), chipsEl, countEl),
          listEl),
        actions: multiple ? [
          { label: '취소', kind: 'ghost', onClick: function () { fin(null); } },
          { label: '선택 완료', kind: 'primary', onClick: function () { fin(selected.slice()); } }
        ] : null,
        onClose: function () { fin(null); }
      });
      renderList();
    });
  };
  function safeFilter(fn, s) { try { return !!fn(s); } catch (e) { logErr(e, 'pickStudent.filter'); return true; } }
  function safeCall(fn, s, dflt) { try { return fn(s); } catch (e) { logErr(e, 'pickStudent.opt'); return dflt; } }

  /* ------------------------------------------------------------------
   * 뷰 등록 · 라우터
   *   registerView(name, {title, render(container, params) → cleanup?, onLeave?, onBack?, tab?, autoRefresh?, onChange?})
   *   params = {rest:[...], query:{...}, hash}
   * ------------------------------------------------------------------ */
  var views = {};
  var started = false;
  var cur = null;           // {name, params, hash}
  var cleanupFn = null;
  var lastRenderedHash = null;
  var navStack = [];
  var navDirty = false;

  ui.views = views;
  ui.registerView = function (name, def) {
    if (!name || !def || typeof def.render !== 'function') { logErr(new Error('registerView: 잘못된 정의 ' + name), 'registerView'); return; }
    views[name] = def; def.name = name;
    scheduleNav();
    if (started && cur && cur.name === name) renderRoute(true);
  };

  function scheduleNav() {
    if (navDirty) return; navDirty = true;
    setTimeout(function () { navDirty = false; buildNav(); }, 0);
  }
  /* v1.2: 기능 켜기(모듈) · 강사 모드(원장 PIN) ------------------------------ */
  var ownerUntil = 0, relockTimer = null, lastNavKey = '';
  ui.moduleOn = function (key) {
    if (!key) return true;
    var m = settings().modules;
    return !m || m[key] !== false;
  };
  // 강사 모드로 잠겨 있으면 true(원장 PIN 을 넣으면 5분 동안 풀림)
  ui.isTeacherLocked = function () {
    var s = settings();
    return !!(s.teacherMode && s.ownerPin) && Date.now() >= ownerUntil;
  };
  ui.ownerUnlockedFor = function () { return Math.max(0, ownerUntil - Date.now()); };
  function viewAllowed(v) {
    if (!v) return false;
    if (v.module && !ui.moduleOn(v.module)) return false;
    if (v.owner && ui.isTeacherLocked()) return false;
    return true;
  }
  ui.viewAllowed = function (name) { return viewAllowed(views[name]); };
  function syncRoleClass() {
    var locked = ui.isTeacherLocked();
    document.body.classList.toggle('teacher-mode', locked);
    document.body.classList.toggle('owner-unlocked', !locked && !!settings().teacherMode && !!settings().ownerPin);
  }
  ui.lockOwner = function () {
    ownerUntil = 0; clearTimeout(relockTimer); relockTimer = null;
    syncRoleClass(); buildNav();
    if (started) renderRoute(true);
  };
  function setUnlocked(ms) {
    ownerUntil = Date.now() + ms;
    clearTimeout(relockTimer);
    relockTimer = setTimeout(function () {
      if (!settings().teacherMode) return;
      ui.lockOwner();
      ui.toast('5분이 지나 강사 모드로 다시 잠갔어요', { kind: 'warn' });
    }, ms + 50);
    syncRoleClass(); buildNav();
    if (started) renderRoute(true);
  }
  /* 숫자 PIN 입력 시트: {title, sub, min=4, max=6, check(pin) → true(닫기)|string(오류 문구)} → Promise<string|null> */
  ui.pinPad = function (opts) {
    opts = opts || {};
    var min = opts.min || 4, max = opts.max || 6;
    return new Promise(function (resolve) {
      var cur = '', done = false, sh = null;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var dots = h('div', { class: 'pin-dots', attrs: { 'aria-live': 'polite' } });
      var msg = h('div', { class: 'pin-msg' }, opts.sub || '');
      var okBtn = h('button', { class: 'btn btn-primary pin-ok', type: 'button', disabled: true, onClick: submit }, '확인');
      function paint() {
        ui.clear(dots);
        for (var i = 0; i < Math.max(min, cur.length); i++) dots.appendChild(h('span', { class: i < cur.length ? 'on' : '' }));
        dots.setAttribute('aria-label', cur.length + '자리 입력됨');
        okBtn.disabled = cur.length < min;
      }
      function press(d) { if (cur.length >= max) return; cur += d; ui.haptic('light'); msg.classList.remove('err'); msg.textContent = opts.sub || ''; paint(); if (cur.length === max) setTimeout(submit, 120); }
      function back() { if (cur.length) { cur = cur.slice(0, -1); ui.haptic('light'); paint(); } }
      function submit() {
        if (done || cur.length < min) return;
        var r = opts.check ? opts.check(cur) : true;
        if (r === true) { var v = cur; fin(v); if (sh) sh.close(); return; }
        ui.haptic('error');
        msg.textContent = typeof r === 'string' ? r : 'PIN이 맞지 않아요';
        msg.classList.add('err');
        dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
        cur = ''; paint();
      }
      var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
      var pad = h('div', { class: 'pin-pad' }, keys.map(function (k) {
        if (!k) return h('span');
        if (k === 'back') return h('button', { class: 'pin-key fn', type: 'button', attrs: { 'aria-label': '지우기' }, onClick: back }, ic('backspace', 24));
        return h('button', { class: 'pin-key', type: 'button', onClick: function () { press(k); } }, k);
      }));
      function onKey(e) {
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
        else if (e.key === 'Backspace') { e.preventDefault(); back(); }
        else if (e.key === 'Enter') { e.preventDefault(); submit(); }
      }
      document.addEventListener('keydown', onKey);
      sh = ui.sheet({
        title: opts.title || 'PIN 입력', className: 'pin-sheet', autofocus: false,
        content: h('div', { class: 'pin-box' }, msg, dots, pad, h('div', { class: 'pin-foot' }, okBtn)),
        onClose: function () { document.removeEventListener('keydown', onKey); fin(null); }
      });
      paint();
    });
  };
  // 원장 PIN 을 물어 5분 동안 풀기 → Promise<bool>
  ui.unlockOwner = function (why) {
    if (!ui.isTeacherLocked()) return Promise.resolve(true);
    var pin = String(settings().ownerPin || '');
    return ui.pinPad({
      title: '원장 PIN', sub: why || '원장 PIN을 넣으면 5분 동안 모든 기능이 열려요.',
      min: pin.length || 4, max: pin.length || 6,
      check: function (v) { return v === pin ? true : 'PIN이 맞지 않아요. 다시 눌러 주세요.'; }
    }).then(function (v) {
      if (v == null) return false;
      setUnlocked(5 * 60000);
      ui.toast('원장 모드 — 5분 뒤 다시 잠겨요', { kind: 'ok' });
      return true;
    });
  };
  // 원장만 할 수 있는 일: 잠겨 있으면 PIN 부터
  ui.requireOwner = function (why) { return ui.unlockOwner(why); };

  /* 글 공유(카톡 등): 안드로이드 공유 인텐트 → Web Share → 클립보드 */
  ui.shareText = function (title, text) {
    try {
      if (window.DrumNative && typeof window.DrumNative.shareText === 'function') { window.DrumNative.shareText(title || '', text || ''); return Promise.resolve('native'); }
    } catch (e) { logErr(e, 'shareText.native'); }
    if (navigator.share) {
      return navigator.share({ title: title || '', text: text || '' }).then(function () { return 'share'; }, function (err) {
        if (err && err.name === 'AbortError') return 'cancel';
        return copyText(text);
      });
    }
    return copyText(text);
  };
  function copyText(text) {
    var p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard'));
    return p.then(function () { ui.toast('복사했어요. 카톡 등에 붙여 넣어 주세요.', { kind: 'ok' }); return 'copy'; }, function () {
      var ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0' }); ta.value = text; document.body.appendChild(ta);
      try { ta.select(); document.execCommand('copy'); ui.toast('복사했어요. 카톡 등에 붙여 넣어 주세요.', { kind: 'ok' }); } catch (e) { ui.toast('복사하지 못했어요', { kind: 'error' }); }
      document.body.removeChild(ta);
      return 'copy';
    });
  }

  function buildNav() {
    var nav = document.getElementById('tabbar');
    if (!nav) return;
    var tabs = Object.keys(views).map(function (k) { return views[k]; }).filter(function (v) { return v.tab && viewAllowed(v); });
    lastNavKey = navKey();
    tabs.sort(function (a, b) { return (a.tab.order || 99) - (b.tab.order || 99); });
    ui.clear(nav);
    nav.appendChild(h('div', { class: 'tabbar-brand', attrs: { 'aria-hidden': 'true' } }, ic('drum', 26)));
    tabs.forEach(function (v) {
      var b = h('button', {
        class: 'tab', type: 'button', dataset: { view: v.name },
        onClick: function () { onTab(v.name); }
      }, h('span', { class: 'tab-ic' }, ic(v.tab.icon || 'info', 23)), h('span', { class: 'tab-label' }, v.tab.label || v.title || v.name));
      nav.appendChild(b);
    });
    markTabs();
  }
  function navKey() {
    var s = settings();
    return JSON.stringify([s.modules || null, !!ui.isTeacherLocked()]);
  }
  function markTabs() {
    var nav = document.getElementById('tabbar');
    if (!nav) return;
    var curTab = cur ? cur.name : '';
    if (cur && views[cur.name] && !views[cur.name].tab && views.more) curTab = 'more';   // 더보기 안 화면이면 더보기 탭 켜기
    Array.prototype.forEach.call(nav.querySelectorAll('.tab'), function (b) {
      var on = !!cur && b.getAttribute('data-view') === curTab;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  function onTab(name) {
    ui.haptic('light');
    if (cur && cur.name === name) {
      if (cur.params.rest.length) { ui.go('#/' + name, { replace: true, resetStack: true }); return; }
      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
      return;
    }
    ui.go('#/' + name, { replace: true, resetStack: true });
  }

  function normHash(hash) {
    hash = String(hash == null ? '' : hash);
    if (hash.charAt(0) === '#') hash = hash.slice(1);
    if (hash.charAt(0) !== '/') hash = '/' + hash;
    return '#' + hash;
  }
  function parseHash(hash) {
    hash = normHash(hash || location.hash || '#/today');
    var body = hash.slice(2), q = {}, qi = body.indexOf('?');
    if (qi >= 0) {
      body.slice(qi + 1).split('&').forEach(function (kv) {
        if (!kv) return;
        var p = kv.split('=');
        try { q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); } catch (e) { q[p[0]] = p[1] || ''; }
      });
      body = body.slice(0, qi);
    }
    var segs = body.split('/').filter(Boolean).map(function (s) { try { return decodeURIComponent(s); } catch (e) { return s; } });
    var name = segs.shift() || 'today';
    return { name: name, params: { rest: segs, query: q, hash: hash }, hash: hash };
  }

  ui.current = function () { return cur ? { name: cur.name, params: cur.params } : parseHash(location.hash); };

  ui.go = function (hash, opts) {
    opts = opts || {};
    hash = normHash(hash);
    var curHash = cur ? cur.hash : null;
    if (opts.resetStack) navStack = [];
    else if (!opts.replace && curHash && curHash !== hash) {
      navStack.push(curHash);
      if (navStack.length > 30) navStack.shift();
    }
    try {
      if (opts.replace) history.replaceState(null, '', hash); else history.pushState(null, '', hash);
    } catch (e) {
      if (location.hash !== hash) { location.hash = hash; return; }
    }
    renderRoute(hash === curHash);
  };

  function scrollY() { return window.pageYOffset || document.documentElement.scrollTop || 0; }

  function renderRoute(isRefresh) {
    var viewEl = document.getElementById('view');
    if (!viewEl) return;
    var r = parseHash(location.hash);
    var def = views[r.name];
    if (!def) {
      if (r.name !== 'today' && views.today) {
        try { history.replaceState(null, '', '#/today'); } catch (e) { /* 무시 */ }
        r = parseHash('#/today'); def = views.today;
      } else if (!views.today) {
        ui.mount(viewEl, h('div', { class: 'page' }, ui.empty('drum', '화면을 불러오는 중', '잠시만 기다려 주세요.')));
        return;
      } else { def = views.today; }
    }
    var blocked = null;
    if (def && def.module && !ui.moduleOn(def.module)) blocked = 'module';
    else if (def && def.owner && ui.isTeacherLocked()) blocked = 'owner';
    var sameView = cur && cur.name === r.name;
    if (!isRefresh && !sameView) {
      if (stack.length) ui.closeSheets();
      if (cur && views[cur.name] && typeof views[cur.name].onLeave === 'function') {
        try { views[cur.name].onLeave(); } catch (e) { logErr(e, cur.name + '.onLeave'); }
      }
    } else if (!isRefresh && stack.length) {
      ui.closeSheets();
    }
    if (cleanupFn) { try { cleanupFn(); } catch (e) { logErr(e, 'view.cleanup'); } cleanupFn = null; }

    var keepY = isRefresh ? scrollY() : 0;
    // 새로 그릴 때 입력 중이던 칸 되살리기
    var ae = document.activeElement, focusId = null, selS = null, selE = null;
    if (isRefresh && ae && ae.id && viewEl.contains(ae)) {
      focusId = ae.id;
      try { selS = ae.selectionStart; selE = ae.selectionEnd; } catch (e) { /* 무시 */ }
    }

    cur = { name: r.name, params: r.params, hash: r.hash };
    lastRenderedHash = r.hash;
    document.body.className = document.body.className.replace(/\broute-\S+/g, '').trim();
    document.body.classList.add('route-' + r.name);
    viewEl.className = 'view view-' + r.name;
    ui.clear(viewEl);
    syncRoleClass();
    try {
      var ret = blocked ? renderBlocked(viewEl, def, blocked) : def.render(viewEl, r.params);
      if (typeof ret === 'function') cleanupFn = ret;
    } catch (e) {
      logErr(e, r.name + '.render');
      ui.clear(viewEl);
      viewEl.appendChild(h('div', { class: 'page' }, h('div', { class: 'card view-error' },
        ui.empty('alert', '화면을 그리는 중 문제가 생겼어요', String(e && e.message || e),
          { label: '다시 시도', icon: 'refresh', onClick: function () { ui.refresh(); } }))));
    }
    document.title = (def.title ? def.title + ' · ' : '') + '드럼 출석부';
    markTabs();
    if (isRefresh) {
      if (keepY) window.scrollTo(0, keepY);
      if (focusId) {
        var f = document.getElementById(focusId);
        if (f && f.focus) { try { f.focus({ preventScroll: true }); if (selS != null) f.setSelectionRange(selS, selE); } catch (e) { /* 무시 */ } }
      }
    } else {
      window.scrollTo(0, 0);
    }
  }

  // 꺼진 기능·강사 모드로 막힌 화면
  function renderBlocked(viewEl, def, why) {
    var title = def.title || '화면';
    viewEl.appendChild(h('div', { class: 'page narrow' },
      h('header', { class: 'topbar' }, h('div', { class: 'topbar-row' }, h('h1', { class: 'topbar-title' }, title))),
      h('div', { class: 'card' }, why === 'module'
        ? ui.empty('grid', title + ' 기능이 꺼져 있어요', '설정 → 기능 켜기에서 다시 켤 수 있어요. 기록은 그대로 남아 있어요.',
          ui.viewAllowed('settings') ? { label: '기능 켜기로', icon: 'settings', onClick: function () { ui.go('#/settings?section=modules'); } } : null)
        : ui.empty('lock', '강사 모드예요', title + ' 화면은 원장님만 볼 수 있어요. 원장 PIN을 넣으면 5분 동안 열려요.',
          { label: '원장 PIN 넣기', icon: 'unlock', onClick: function () { ui.unlockOwner(); } }))));
  }

  ui.refresh = function () {
    if (!started) return;
    clearTimeout(refreshTimer);
    renderRoute(true);
  };
  var refreshTimer = null;
  function scheduleRefresh(evt) {
    if (!started || !cur) return;
    var def = views[cur.name];
    if (def && def.autoRefresh === false) {
      if (typeof def.onChange === 'function') { try { def.onChange(evt); } catch (e) { logErr(e, cur.name + '.onChange'); } }
      return;
    }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () { renderRoute(true); }, 80);
  }

  function onLocationChange() {
    var hash = normHash(location.hash || '#/today');
    if (hash === lastRenderedHash) return;
    renderRoute(false);
  }

  /* 뒤로가기(안드로이드 껍데기 약속) */
  window.appBack = function () {
    try {
      if (stack.length) {
        var top = stack[stack.length - 1];
        if (top.dismissible) top.close();
        return true;
      }
      var c = cur || parseHash(location.hash);
      var def = views[c.name];
      if (def && typeof def.onBack === 'function') {
        if (def.onBack()) return true;
      }
      if (c.name === 'kiosk') {
        if (settings().kioskPin) return true;      // PIN 잠금 키오스크는 뒤로가기로 못 나간다
        ui.go('#/today', { replace: true, resetStack: true });
        return true;
      }
      if (c.name !== 'today' || c.params.rest.length) {
        var prev = null;
        while (navStack.length && !prev) {
          var p = navStack.pop();
          if (p !== c.hash && parseHash(p).name !== 'kiosk') prev = p;
        }
        ui.go(prev || '#/today', { replace: true });
        return true;
      }
      return false;
    } catch (e) {
      logErr(e, 'appBack');
      return false;
    }
  };

  /* 날짜 넘어감 감지 + 1분 틱(화면이 보일 때만) */
  var lastDay = null, tickTimer = null;
  function checkDay() {
    var t = today();
    if (lastDay && t !== lastDay) {
      var from = lastDay; lastDay = t;
      try { window.dispatchEvent(new CustomEvent('da:daychange', { detail: { from: from, to: t } })); } catch (e) { /* 무시 */ }
      if (cur && (cur.name === 'today' || cur.name === 'kiosk')) ui.refresh();
    } else lastDay = t;
  }
  function startTick() {
    if (tickTimer) return;
    tickTimer = setInterval(function () {
      if (document.visibilityState === 'hidden') { stopTick(); return; }
      checkDay();
      try { window.dispatchEvent(new CustomEvent('da:tick', { detail: { now: new Date() } })); } catch (e) { /* 무시 */ }
    }, 60000);
  }
  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

  ui.start = function () {
    if (started) return;
    started = true;
    lastDay = today();
    buildNav();
    if (DA.store && typeof DA.store.on === 'function') DA.store.on('change', function (ev) {
      if (ev && (ev.kind === 'settings' || ev.kind === 'all') && navKey() !== lastNavKey) scheduleNav();
    });
    window.addEventListener('da:tick', function () { if (navKey() !== lastNavKey) { scheduleNav(); if (cur) renderRoute(true); } });
    window.addEventListener('hashchange', onLocationChange);
    window.addEventListener('popstate', onLocationChange);
    if (DA.store && typeof DA.store.on === 'function') DA.store.on('change', scheduleRefresh);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        checkDay(); startTick();
        if (actx && actx.state === 'suspended' && actx.resume) { try { actx.resume(); } catch (e) { /* 무시 */ } }
      } else stopTick();
    });
    window.addEventListener('focus', checkDay);
    window.addEventListener('pageshow', checkDay);
    if (document.visibilityState !== 'hidden') startTick();
    if (!location.hash || location.hash === '#' || location.hash === '#/') {
      try { history.replaceState(null, '', '#/today'); } catch (e) { location.hash = '#/today'; }
    }
    renderRoute(false);
  };
  ui.isStarted = function () { return started; };
  ui.checkDay = checkDay;
})(window.DA = window.DA || {});
