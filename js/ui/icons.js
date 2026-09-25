/* 드럼 출석부 — 아이콘 (24 격자 선 아이콘, currentColor, 선 굵기 2, 둥근 끝)
 * DA.ui.icon(name, size=20) → SVGElement
 * DA.ui.iconSvg(name, size=20, extraAttrs) → SVG 문자열(인쇄·innerHTML용)
 * DA.ui.iconNames() → 이름 목록
 */
(function (DA) {
  'use strict';
  var ui = DA.ui = DA.ui || {};
  var NS = 'http://www.w3.org/2000/svg';

  function P(d) { return ['path', { d: d }]; }
  function C(cx, cy, r, fill) { var a = { cx: cx, cy: cy, r: r }; if (fill) { a.fill = 'currentColor'; a.stroke = 'none'; } return ['circle', a]; }
  function R(x, y, w, h, rx) { return ['rect', { x: x, y: y, width: w, height: h, rx: rx || 0 }]; }
  function PL(points) { return ['polyline', { points: points }]; }
  function PG(points) { return ['polygon', { points: points }]; }
  function E(cx, cy, rx, ry) { return ['ellipse', { cx: cx, cy: cy, rx: rx, ry: ry }]; }

  function n(v) { return Math.round(v * 100) / 100; }

  // 톱니바퀴(설정) — 8개 톱니를 계산으로 그린다
  function gearPath() {
    var teeth = 8, rO = 10, rI = 7.3, aw = 0.155, bw = 0.27;
    var step = Math.PI * 2 / teeth, d = '';
    function pt(r, a) { return n(12 + r * Math.cos(a)) + ' ' + n(12 + r * Math.sin(a)); }
    for (var i = 0; i < teeth; i++) {
      var a = i * step - Math.PI / 2;
      d += (i === 0 ? 'M' : 'L') + pt(rI, a - bw);
      d += 'L' + pt(rO, a - aw) + 'L' + pt(rO, a + aw) + 'L' + pt(rI, a + bw);
      d += 'A' + rI + ' ' + rI + ' 0 0 1 ' + pt(rI, a + step - bw);
    }
    return d + 'Z';
  }

  var CAL = [R(3, 4.5, 18, 17, 3), P('M8 2.5v4M16 2.5v4M3 10h18')];

  var DEFS = {
    today: CAL.concat([P('M9 15.5l2.2 2.2L15.5 13.4')]),
    calendar: CAL.concat([P('M7.5 14h.01M12 14h.01M16.5 14h.01M7.5 18h.01M12 18h.01M16.5 18h.01')]),
    'calendar-x': CAL.concat([P('M10 13.5l4 4M14 13.5l-4 4')]),
    users: [P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), C(9, 7, 4), P('M22 21v-2a4 4 0 0 0-3-3.87'), P('M16 3.13a4 4 0 0 1 0 7.75')],
    user: [P('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'), C(12, 7, 4)],
    'user-plus': [P('M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'), C(8, 7, 4), P('M19 8v6M22 11h-6')],
    chart: [P('M3 3v18h18'), P('M8 17v-4M13 17V7M18 17v-7')],
    settings: [P(gearPath()), C(12, 12, 3)],
    plus: [P('M12 5v14M5 12h14')],
    minus: [P('M5 12h14')],
    check: [P('M20 6L9 17l-5-5')],
    x: [P('M18 6L6 18M6 6l12 12')],
    chevL: [P('M15 18l-6-6 6-6')],
    chevR: [P('M9 18l6-6-6-6')],
    chevD: [P('M6 9l6 6 6-6')],
    chevU: [P('M18 15l-6-6-6 6')],
    search: [C(11, 11, 7.5), P('M21 21l-4.6-4.6')],
    pen: [P('M12 20h9'), P('M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z')],
    edit: [P('M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'), P('M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z')],
    trash: [P('M3 6h18'), P('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'), P('M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'), P('M10 11v6M14 11v6')],
    download: [P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), P('M7 10l5 5 5-5'), P('M12 15V3')],
    upload: [P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), P('M17 8l-5-5-5 5'), P('M12 3v12')],
    share: [P('M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8'), P('M16 6l-4-4-4 4'), P('M12 2v13')],
    print: [P('M6 9V2h12v7'), P('M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2'), R(6, 14, 12, 8, 1)],
    lock: [R(3.5, 11, 17, 11, 2.5), P('M7.5 11V7a4.5 4.5 0 0 1 9 0v4')],
    unlock: [R(3.5, 11, 17, 11, 2.5), P('M7.5 11V7a4.5 4.5 0 0 1 8.9-1')],
    clock: [C(12, 12, 10), P('M12 6.5V12l3.5 2')],
    drum: [E(12, 11, 8.5, 3), P('M3.5 11v6.2c0 1.66 3.8 3 8.5 3s8.5-1.34 8.5-3V11'), P('M7.5 13.6v5.2M16.5 13.6v5.2'), P('M4 2.5l6.2 5.4M20 2.5l-6.2 5.4')],
    sms: [P('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'), P('M8 10h.01M12 10h.01M16 10h.01')],
    phone: [P('M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z')],
    more: [C(5, 12, 1.6, true), C(12, 12, 1.6, true), C(19, 12, 1.6, true)],
    'more-v': [C(12, 5, 1.6, true), C(12, 12, 1.6, true), C(12, 19, 1.6, true)],
    filter: [PG('22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3')],
    kiosk: [R(3, 3, 18, 13, 2.5), P('M12 16v4.5M8 21h8'), P('M9 9.6l2 2 4-4')],
    undo: [P('M9 14L4 9l5-5'), P('M4 9h10.5a5.5 5.5 0 0 1 0 11H11')],
    redo: [P('M15 14l5-5-5-5'), P('M20 9H9.5a5.5 5.5 0 0 0 0 11H13')],
    eraser: [P('M7 21l-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21'), P('M22 21H7'), P('M5.5 11.5l8 8')],
    star: [PG('12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2')],
    alert: [P('M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'), P('M12 9v4M12 17h.01')],
    info: [C(12, 12, 10), P('M12 16v-4M12 8h.01')],
    copy: [R(9, 9, 13, 13, 2), P('M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1')],
    repeat: [P('M17 1l4 4-4 4'), P('M3 11V9a4 4 0 0 1 4-4h14'), P('M7 23l-4-4 4-4'), P('M21 13v2a4 4 0 0 1-4 4H3')],
    refresh: [P('M21 3v6h-6'), P('M3 21v-6h6'), P('M20.5 9A9 9 0 0 0 5.6 5.6L3 8'), P('M3.5 15a9 9 0 0 0 14.9 3.4L21 16')],
    music: [P('M9 18V5l12-2v13'), C(6, 18, 3), C(18, 16, 3)],
    trend: [P('M23 6l-9.5 9.5-5-5L1 18'), P('M17 6h6v6')],
    home: [P('M3 10.5L12 3l9 7.5V20a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z')],
    list: [P('M8 6h13M8 12h13M8 18h13'), P('M3 6h.01M3 12h.01M3 18h.01')],
    grid: [R(3, 3, 7, 7, 1.5), R(14, 3, 7, 7, 1.5), R(14, 14, 7, 7, 1.5), R(3, 14, 7, 7, 1.5)],
    note: [P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'), P('M14 2v6h6'), P('M8 13h8M8 17h5')],
    money: [R(2, 5, 20, 14, 2.5), C(12, 12, 2.5), P('M6 12h.01M18 12h.01')],
    card: [R(1.5, 4.5, 21, 15, 2.5), P('M1.5 10h21')],
    bell: [P('M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9'), P('M13.73 21a2 2 0 0 1-3.46 0')],
    sun: [C(12, 12, 4), P('M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41')],
    moon: [P('M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z')],
    logout: [P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'), P('M16 17l5-5-5-5'), P('M21 12H9')],
    external: [P('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'), P('M15 3h6v6'), P('M10 14L21 3')],
    door: [P('M13 4h3a2 2 0 0 1 2 2v14'), P('M2 20h3M13 20h9'), P('M10 12v.01'), P('M13 4.56v16.28a.5.5 0 0 1-.62.49L5 19.5V5.92a2 2 0 0 1 1.5-1.94l5-1.25A1.2 1.2 0 0 1 13 4.56z')],
    tag: [P('M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z'), P('M7 7h.01')],
    book: [P('M4 19.5A2.5 2.5 0 0 1 6.5 17H20'), P('M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z')],
    metronome: [P('M9.2 3.4h5.6l4.7 17.1a1.2 1.2 0 0 1-1.2 1.5H5.7a1.2 1.2 0 0 1-1.2-1.5z'), P('M12 16.5L17 6'), P('M6.5 16.5h11')],
    sparkle: [P('M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z'), P('M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z')],
    backspace: [P('M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z'), P('M18 9l-6 6M12 9l6 6')],
    'user-x': [P('M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'), C(8.5, 7, 4), P('M18 8l5 5M23 8l-5 5')],
    pause: [R(6, 4, 4, 16, 1), R(14, 4, 4, 16, 1)],
    play: [PG('6 3 20 12 6 21 6 3')],
    eye: [P('M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'), C(12, 12, 3)],
    hash: [P('M4 9h16M4 15h16M10 3L8 21M16 3l-2 18')],
    camera: [P('M3 8.5A1.5 1.5 0 0 1 4.5 7h2.6l1.6-2.2h6.6L16.9 7h2.6A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z'), C(12, 13, 3.6)],
    qr: [R(3.5, 3.5, 6.5, 6.5, 1), R(14, 3.5, 6.5, 6.5, 1), R(3.5, 14, 6.5, 6.5, 1), P('M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 20.5h2M20.5 14v2')]
  };

  var ALIAS = { 'chev-l': 'chevL', 'chev-r': 'chevR', 'chev-d': 'chevD', 'chev-u': 'chevU', chevronLeft: 'chevL', chevronRight: 'chevR', chevronDown: 'chevD', close: 'x', warn: 'alert', warning: 'alert', message: 'sms', 'calendarX': 'calendar-x', 'userPlus': 'user-plus', stats: 'chart', student: 'user', students: 'users', timetable: 'calendar' };
  var warned = {};

  function resolve(name) {
    if (DEFS[name]) return DEFS[name];
    if (ALIAS[name] && DEFS[ALIAS[name]]) return DEFS[ALIAS[name]];
    if (!warned[name] && typeof console !== 'undefined') { warned[name] = 1; console.warn('[icons] 없는 아이콘:', name); }
    return null;
  }

  function baseAttrs(name, size) {
    var s = size == null ? 20 : size;
    return {
      width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'aria-hidden': 'true', focusable: 'false', 'class': 'ic ic-' + String(name)
    };
  }

  ui.icon = function (name, size) {
    var def = resolve(name);
    var svg = document.createElementNS(NS, 'svg');
    var a = baseAttrs(name, size), k;
    for (k in a) svg.setAttribute(k, a[k]);
    if (def) {
      for (var i = 0; i < def.length; i++) {
        var el = document.createElementNS(NS, def[i][0]);
        var at = def[i][1];
        for (k in at) el.setAttribute(k, at[k]);
        svg.appendChild(el);
      }
    }
    return svg;
  };

  function esc(v) { return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  ui.iconSvg = function (name, size, extra) {
    var def = resolve(name) || [];
    var a = baseAttrs(name, size), k, out = '<svg xmlns="' + NS + '"';
    if (extra) for (k in extra) a[k] = extra[k];
    for (k in a) out += ' ' + k + '="' + esc(a[k]) + '"';
    out += '>';
    for (var i = 0; i < def.length; i++) {
      out += '<' + def[i][0];
      for (k in def[i][1]) out += ' ' + k + '="' + esc(def[i][1][k]) + '"';
      out += '/>';
    }
    return out + '</svg>';
  };

  ui.iconNames = function () { return Object.keys(DEFS); };
})(typeof window !== 'undefined' ? (window.DA = window.DA || {}) : (globalThis.DA = globalThis.DA || {}));
