/* 드럼 출석부 — 서명 패드 + 서명 렌더 (SPEC §5)
 * DA.sig.pad(container, {height, onChange, placeholder, guide}) → {clear, undo, isEmpty, value, destroy, count, resize, el}
 * DA.sig.path(sig) → SVG path d
 * DA.sig.el(sig, {width, height, color, strokeWidth, crop=true, pad}) → SVGElement(비율 유지)
 * DA.sig.svgString(sig, opts) → string ; DA.sig.dataUrl(sig, opts) → 'data:image/svg+xml,…'
 * Signature = { w, h, strokes: [[x0,y0,p0, x1,y1,p1, ...], ...] }  (CSS px, 소수 1자리, p=필압 0~1, 없으면 0.5)
 */
(function (DA) {
  'use strict';
  var sig = DA.sig = DA.sig || {};
  var NS = 'http://www.w3.org/2000/svg';

  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------------- 서명 패드 ---------------- */
  sig.pad = function (container, opts) {
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'sig-pad';
    if (opts.height != null) wrap.style.height = typeof opts.height === 'number' ? opts.height + 'px' : String(opts.height);
    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', '서명 칸');
    canvas.setAttribute('role', 'img');
    var base = null, ph = null;
    if (opts.guide !== false) {
      base = document.createElement('div'); base.className = 'sig-base';
      ph = document.createElement('div'); ph.className = 'sig-ph';
      if (DA.ui && DA.ui.icon) ph.appendChild(DA.ui.icon('pen', 26));
      ph.appendChild(document.createTextNode(opts.placeholder || '여기에 서명하세요'));
      wrap.appendChild(base); wrap.appendChild(ph);
    }
    wrap.appendChild(canvas);
    if (container) container.appendChild(wrap);

    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, dpr = 1;
    var strokes = [];          // [{pts:[{x,y,p,w}], pen:bool}]
    var cur = null, activeId = null, activeType = null, penSeen = false;
    var rect = null, lastT = 0, vel = 0, lastW = 0, ink = '#14120F';
    var destroyed = false;

    function baseWidth() { return clamp(Math.min(W || 300, H || 200) / 105, 2.2, 3.7); }

    function measure() {
      // 캔버스(테두리 안쪽) 크기. offsetWidth/Height는 열림 애니메이션의 transform(scale)에 영향받지 않는다
      var w = canvas.offsetWidth || wrap.clientWidth, hh = canvas.offsetHeight || wrap.clientHeight;
      if (!w || !hh) { var r = canvas.getBoundingClientRect(); w = r.width; hh = r.height; }
      return { w: w, h: hh };
    }

    function resize() {
      if (destroyed) return;
      var m = measure();
      if (m.w < 4 || m.h < 4) return;
      var nd = Math.min(window.devicePixelRatio || 1, 3);
      if (Math.abs(m.w - W) < 0.5 && Math.abs(m.h - H) < 0.5 && nd === dpr && canvas.width) return;
      if (W > 0 && H > 0 && strokes.length && (Math.abs(m.w - W) >= 0.5 || Math.abs(m.h - H) >= 0.5)) {
        var s = Math.min(m.w / W, m.h / H);
        var ox = (m.w - W * s) / 2, oy = (m.h - H * s) / 2;
        strokes.forEach(function (st) {
          st.pts.forEach(function (p) { p.x = p.x * s + ox; p.y = p.y * s + oy; p.w = p.w * s; });
        });
      }
      W = m.w; H = m.h; dpr = nd;
      // iOS 캔버스 한도(약 16.7M px) 안쪽으로
      var scale = dpr;
      if (W * H * scale * scale > 12e6) scale = Math.sqrt(12e6 / (W * H));
      canvas.width = Math.max(1, Math.round(W * scale));
      canvas.height = Math.max(1, Math.round(H * scale));
      dpr = scale;
      redraw();
    }

    function inkColor() {
      try { return getComputedStyle(wrap).color || '#14120F'; } catch (e) { return '#14120F'; }
    }

    function setup() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = ink; ctx.fillStyle = ink;
    }

    function dot(p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.8, p.w * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }

    // i번째 점이 들어왔을 때 그릴 조각: mid(i-2,i-1) → mid(i-1,i), 조절점 i-1
    function segment(pts, i) {
      var p0 = pts[i - 2], p1 = pts[i - 1], p2 = pts[i];
      var sx, sy;
      if (!p0) { sx = p1.x; sy = p1.y; } else { sx = (p0.x + p1.x) / 2; sy = (p0.y + p1.y) / 2; }
      var ex = (p1.x + p2.x) / 2, ey = (p1.y + p2.y) / 2;
      ctx.beginPath();
      ctx.lineWidth = (p1.w + p2.w) / 2;
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(p1.x, p1.y, ex, ey);
      ctx.stroke();
    }
    function tail(pts) {
      var n = pts.length;
      if (n < 2) return;
      var a = pts[n - 2], b = pts[n - 1];
      ctx.beginPath();
      ctx.lineWidth = b.w;
      ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    function drawStroke(st) {
      var pts = st.pts;
      if (!pts.length) return;
      if (pts.length === 1) { dot(pts[0]); return; }
      for (var i = 1; i < pts.length; i++) segment(pts, i);
      tail(pts);
    }
    function redraw() {
      if (!canvas.width) return;
      ink = inkColor();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setup();
      strokes.forEach(drawStroke);
    }

    function pos(e) {
      var sx = rect.width ? W / rect.width : 1, sy = rect.height ? H / rect.height : 1;
      return { x: clamp((e.clientX - rect.left) * sx, 0, W), y: clamp((e.clientY - rect.top) * sy, 0, H) };
    }

    function widthFor(e, v, isPen) {
      var bw = baseWidth();
      var target;
      if (isPen && e.pressure > 0) {
        target = bw * (0.42 + Math.pow(clamp(e.pressure, 0, 1), 0.8) * 1.15);
      } else {
        target = bw * clamp(1.32 - v * 0.34, 0.55, 1.32);
      }
      return lastW ? lastW * 0.62 + target * 0.38 : target;
    }

    function addPoint(e, force) {
      var p = pos(e);
      var pts = cur.pts;
      var last = pts[pts.length - 1];
      var t = e.timeStamp || Date.now();
      if (last && !force) {
        var dx = p.x - last.x, dy = p.y - last.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.8) return false;
        var dt = Math.max(1, t - lastT);
        vel = 0.65 * vel + 0.35 * (dist / dt);
      }
      lastT = t;
      var isPen = cur.pen;
      var w = widthFor(e, vel, isPen);
      lastW = w;
      var pr = isPen && e.pressure > 0 ? clamp(e.pressure, 0, 1) : 0.5;
      pts.push({ x: p.x, y: p.y, p: pr, w: w });
      return true;
    }

    function start(e) {
      resize();
      rect = canvas.getBoundingClientRect();
      ink = inkColor(); setup();
      activeId = e.pointerId; activeType = e.pointerType;
      vel = 0; lastW = 0;
      cur = { pts: [], pen: e.pointerType === 'pen' };
      strokes.push(cur);
      addPoint(e, true);
      dot(cur.pts[0]);
      wrap.classList.add('inked', 'active');
    }

    function onDown(e) {
      if (destroyed) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.pointerType === 'pen') penSeen = true;
      if (activeId !== null) {
        // 손바닥이 먼저 닿은 상태에서 펜이 들어오면 손바닥 획을 버리고 펜으로
        if (e.pointerType === 'pen' && activeType === 'touch') {
          strokes.pop(); cur = null; activeId = null; redraw();
        } else return;
      }
      if (e.pointerType === 'touch' && penSeen) return;       // 펜 사용 중엔 손가락 무시(손바닥 거부)
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
      start(e);
    }

    function onMove(e) {
      if (e.pointerId !== activeId || !cur) return;
      e.preventDefault();
      var list = (typeof e.getCoalescedEvents === 'function') ? e.getCoalescedEvents() : null;
      if (!list || !list.length) list = [e];
      for (var i = 0; i < list.length; i++) {
        var ev = list[i];
        if (addPoint(ev, false)) {
          var n = cur.pts.length;
          if (n >= 2) segment(cur.pts, n - 1);
        }
      }
    }

    function onUp(e) {
      if (e.pointerId !== activeId || !cur) return;
      if (e.type === 'pointerup') { addPoint(e, false); }
      var n = cur.pts.length;
      if (n >= 2) { segment(cur.pts, n - 1); tail(cur.pts); }
      // 정확한 모양으로 다시 그림(조각 경계 정리)
      redraw();
      cur = null; activeId = null; activeType = null;
      wrap.classList.remove('active');
      try { canvas.releasePointerCapture(e.pointerId); } catch (x) { /* 무시 */ }
      changed();
    }

    function changed() {
      wrap.classList.toggle('inked', strokes.length > 0);
      if (typeof opts.onChange === 'function') { try { opts.onChange(api); } catch (x) { if (DA.ui && DA.ui._logErr) DA.ui._logErr(x, 'sig.onChange'); } }
    }

    function prevent(e) { if (e.cancelable) e.preventDefault(); }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('lostpointercapture', function (e) { if (e.pointerId === activeId) onUp(e); });
    // iOS 스크롤·바운스·확대·길게 누르기 메뉴 막기
    wrap.addEventListener('touchstart', prevent, { passive: false });
    wrap.addEventListener('touchmove', prevent, { passive: false });
    wrap.addEventListener('gesturestart', prevent);
    wrap.addEventListener('contextmenu', prevent);
    wrap.addEventListener('selectstart', prevent);

    var ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(function () { resize(); });
      ro.observe(wrap);
    }
    function onWinResize() { resize(); }
    window.addEventListener('resize', onWinResize);
    window.addEventListener('orientationchange', onWinResize);
    requestAnimationFrame(resize);

    function allPoints() {
      var n = 0; strokes.forEach(function (s) { n += s.pts.length; }); return n;
    }
    function bbox() {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      strokes.forEach(function (s) { s.pts.forEach(function (p) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }); });
      return { w: x1 - x0, h: y1 - y0 };
    }

    var api = {
      el: wrap,
      canvas: canvas,
      clear: function () { strokes = []; cur = null; activeId = null; redraw(); changed(); },
      undo: function () { if (!strokes.length) return false; strokes.pop(); cur = null; activeId = null; redraw(); changed(); return true; },
      count: function () { return strokes.length; },
      isEmpty: function () {
        if (allPoints() < 5) return true;
        var b = bbox();
        return b.w < 12 && b.h < 12;
      },
      value: function () {
        return {
          w: r1(W), h: r1(H),
          strokes: strokes.filter(function (s) { return s.pts.length; }).map(function (s) {
            var pts = simplify(s.pts, 0.3), flat = [];
            for (var i = 0; i < pts.length; i++) flat.push(r1(pts[i].x), r1(pts[i].y), r2(pts[i].p));
            return flat;
          })
        };
      },
      resize: resize,
      redraw: redraw,
      destroy: function () {
        destroyed = true;
        if (ro) ro.disconnect();
        window.removeEventListener('resize', onWinResize);
        window.removeEventListener('orientationchange', onWinResize);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }
    };
    return api;
  };

  // 라머-더글러스-퍼커(점 줄이기). 끝점은 보존
  function simplify(pts, eps) {
    if (pts.length < 3) return pts.slice();
    var keep = new Array(pts.length), stackArr = [[0, pts.length - 1]], e2 = eps * eps;
    keep[0] = keep[pts.length - 1] = true;
    while (stackArr.length) {
      var seg = stackArr.pop(), a = seg[0], b = seg[1];
      var ax = pts[a].x, ay = pts[a].y, bx = pts[b].x, by = pts[b].y;
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      var maxD = -1, idx = -1;
      for (var i = a + 1; i < b; i++) {
        var px = pts[i].x - ax, py = pts[i].y - ay, d;
        if (len2 === 0) d = px * px + py * py;
        else {
          var t = clamp((px * dx + py * dy) / len2, 0, 1);
          var qx = px - t * dx, qy = py - t * dy; d = qx * qx + qy * qy;
        }
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (maxD > e2 && idx > 0) { keep[idx] = true; stackArr.push([a, idx], [idx, b]); }
    }
    var out = [];
    for (var j = 0; j < pts.length; j++) if (keep[j]) out.push(pts[j]);
    return out;
  }
  sig._simplify = simplify;

  /* ---------------- 서명 렌더 ---------------- */
  // 여러 형식을 너그럽게 받아 [[x,y,p...]] 평면 배열로
  function strokesOf(s) {
    if (!s || !s.strokes || !s.strokes.length) return [];
    var out = [];
    for (var i = 0; i < s.strokes.length; i++) {
      var st = s.strokes[i];
      if (!st || !st.length) continue;
      if (typeof st[0] === 'number') { out.push(st); continue; }
      var flat = [];
      for (var j = 0; j < st.length; j++) {
        var p = st[j];
        if (Array.isArray(p)) flat.push(+p[0], +p[1], p[2] == null ? 0.5 : +p[2]);
        else if (p && typeof p === 'object') flat.push(+p.x, +p.y, p.p == null ? 0.5 : +p.p);
      }
      if (flat.length) out.push(flat);
    }
    return out;
  }
  function f1(v) { return String(Math.round(v * 10) / 10); }

  sig.path = function (s) {
    var list = strokesOf(s), d = '';
    for (var k = 0; k < list.length; k++) {
      var st = list[k], n = Math.floor(st.length / 3);
      if (!n) continue;
      var X = function (i) { return st[i * 3]; }, Y = function (i) { return st[i * 3 + 1]; };
      d += 'M' + f1(X(0)) + ' ' + f1(Y(0));
      if (n === 1) { d += 'l0.1 0'; continue; }
      if (n === 2) { d += 'L' + f1(X(1)) + ' ' + f1(Y(1)); continue; }
      for (var i = 1; i < n - 1; i++) {
        d += 'Q' + f1(X(i)) + ' ' + f1(Y(i)) + ' ' + f1((X(i) + X(i + 1)) / 2) + ' ' + f1((Y(i) + Y(i + 1)) / 2);
      }
      d += 'L' + f1(X(n - 1)) + ' ' + f1(Y(n - 1));
    }
    return d;
  };

  sig.isEmpty = function (s) {
    var list = strokesOf(s), n = 0;
    for (var i = 0; i < list.length; i++) n += Math.floor(list[i].length / 3);
    return n === 0;
  };

  function layout(s, opts) {
    opts = opts || {};
    var list = strokesOf(s);
    var w = +(s && s.w) || 300, h = +(s && s.h) || 150;
    var vb = [0, 0, w, h];
    if (opts.crop !== false && list.length) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      list.forEach(function (st) {
        for (var i = 0; i + 1 < st.length; i += 3) {
          if (st[i] < x0) x0 = st[i]; if (st[i] > x1) x1 = st[i];
          if (st[i + 1] < y0) y0 = st[i + 1]; if (st[i + 1] > y1) y1 = st[i + 1];
        }
      });
      var bw = Math.max(x1 - x0, w * 0.22), bh = Math.max(y1 - y0, h * 0.22);
      var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      var m = opts.pad != null ? opts.pad : Math.max(6, Math.max(bw, bh) * 0.07);
      vb = [cx - bw / 2 - m, cy - bh / 2 - m, bw + m * 2, bh + m * 2];
    }
    var sw = opts.strokeWidth;
    if (sw == null) sw = typeof opts.width === 'number' ? clamp(opts.width / 130, 1.2, 3.2) : 2.2;
    return { vb: vb.map(function (v) { return Math.round(v * 10) / 10; }), sw: sw, d: sig.path(s) };
  }

  sig.el = function (s, opts) {
    opts = opts || {};
    var L = layout(s, opts);
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', L.vb.join(' '));
    svg.setAttribute('preserveAspectRatio', opts.preserveAspectRatio || 'xMidYMid meet');
    svg.setAttribute('class', 'sig-svg' + (L.d ? '' : ' empty') + (opts.className ? ' ' + opts.className : ''));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.label || '서명');
    if (opts.width != null) { if (typeof opts.width === 'number') svg.setAttribute('width', opts.width); else svg.style.width = opts.width; }
    if (opts.height != null) { if (typeof opts.height === 'number') svg.setAttribute('height', opts.height); else svg.style.height = opts.height; }
    if (opts.width == null && opts.height == null) svg.style.width = '100%';
    if (L.d) {
      var p = document.createElementNS(NS, 'path');
      p.setAttribute('d', L.d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', opts.color || 'currentColor');
      p.setAttribute('stroke-width', L.sw);
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(p);
    }
    return svg;
  };

  sig.svgString = function (s, opts) {
    opts = opts || {};
    var L = layout(s, opts);
    var attrs = ' xmlns="' + NS + '" viewBox="' + L.vb.join(' ') + '" preserveAspectRatio="xMidYMid meet"';
    if (opts.width != null) attrs += ' width="' + opts.width + '"';
    if (opts.height != null) attrs += ' height="' + opts.height + '"';
    var out = '<svg' + attrs + '>';
    if (L.d) {
      out += '<path d="' + L.d + '" fill="none" stroke="' + String(opts.color || '#1D1B18').replace(/"/g, '') + '" stroke-width="' + L.sw +
        '" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
    }
    return out + '</svg>';
  };

  sig.dataUrl = function (s, opts) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sig.svgString(s, opts));
  };
})(window.DA = window.DA || {});
