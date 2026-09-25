/* 드럼 출석부 — ui/charts.js (통계 담당)
 * 라이브러리 없는 반응형 SVG 차트 부품. 통계 화면과 수강생 상세가 함께 쓴다.
 *
 *   DA.charts.bar(container, {data:[{label, value, color?, title?}], horizontal, height, max, format, valueLabels, track, onSelect})
 *   DA.charts.stacked(container, {data:[{label, values:{key:n}}], series:[{key,label,color}], height, percent, horizontal})
 *   DA.charts.line(container, {data:[{label, value}], height, format, color, yMin, yMax, area, points})
 *   DA.charts.combo(container, {data:[{label, bar, line}], barLabel, lineLabel, barFormat, lineFormat, height})
 *   DA.charts.donut(container, {data:[{label, value, color}], size, centerText, centerSub, format})
 *   DA.charts.heatmap(container, {rows, cols, cells:[[{value, title}]], format, min, max, color})
 *   DA.charts.spark(container, {values, color, height})
 *   → 모두 {el, update(opts)} (spark도 update 있음)
 *
 * 원칙: 얇은 막대(<=24px, 끝 4px 둥글게·기준선은 각지게), 2px 선, 2px 표면색 틈, 옅은 격자.
 *       글자는 늘 글자색 토큰(데이터 색을 글자에 입히지 않음). 탭하면 작은 말풍선(마우스는 올리기만 해도).
 *       값 두 종류(수·비율)는 축 두 개를 겹치지 않고 위아래 두 칸으로 나눠 그린다(combo).
 */
(function (DA) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var CH = DA.charts = {};
  var FONT = 'inherit';

  // ── 작은 도구 ─────────────────────────────────────────
  function U() { return DA.util || {}; }
  function svg(tag, attrs, parent) {
    var el = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs.hasOwnProperty(k) && attrs[k] != null && attrs[k] !== false) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  }
  function div(cls, text, parent) {
    var el = document.createElement('div');
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }
  function span(cls, text, parent) {
    var el = document.createElement('span');
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    if (parent) parent.appendChild(el);
    return el;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function assign(a, b) { var o = {}, k; for (k in a) if (a.hasOwnProperty(k)) o[k] = a[k]; if (b) for (k in b) if (b.hasOwnProperty(k)) o[k] = b[k]; return o; }
  function fmtNum(v) {
    if (v == null || typeof v !== 'number' || !isFinite(v)) return '–';
    if (Math.round(v) === v) return U().fmtNumber ? U().fmtNumber(v) : String(v);
    return String(Math.round(v * 10) / 10);
  }
  function fmtOf(f) { return typeof f === 'function' ? function (v) { try { return String(f(v)); } catch (e) { return fmtNum(v); } } : fmtNum; }

  // 글자 폭 대략 계산(한글=전각, 숫자·영문=반각) — 겹침 방지와 줄임표용
  function textW(str, fs) {
    str = String(str == null ? '' : str);
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0x1100) w += 0.94;
      else if (c === 32) w += 0.3;
      else if (c >= 48 && c <= 57) w += 0.58;
      else if (c === 37) w += 0.82;                 // %
      else if (c === 44 || c === 46 || c === 58) w += 0.3;
      else if (c >= 65 && c <= 90) w += 0.66;
      else if (c >= 97 && c <= 122) w += 0.53;
      else w += 0.45;
    }
    return w * fs;
  }
  function fit(str, fs, maxW) {
    str = String(str == null ? '' : str);
    if (textW(str, fs) <= maxW) return str;
    var chars = Array.from ? Array.from(str) : str.split('');
    while (chars.length > 1 && textW(chars.join('') + '…', fs) > maxW) chars.pop();
    return chars.join('') + '…';
  }

  // 깔끔한 눈금(0 · 5 · 10 …)
  function niceStep(range, count) {
    var raw = range / Math.max(1, count);
    if (!(raw > 0)) return 1;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var n = raw / mag;
    var s = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return s * mag;
  }
  function niceScale(min, max, count, integer) {
    if (!(max > min)) max = min + (integer ? Math.max(1, count || 4) : 1);
    var step = niceStep(max - min, count || 4);
    if (integer && step < 1) step = 1;
    var lo = Math.floor(min / step + 1e-9) * step, hi = Math.ceil(max / step - 1e-9) * step;
    if (hi <= lo) hi = lo + step;
    var ticks = [];
    for (var v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { min: lo, max: hi, ticks: ticks };
  }
  function fixedScale(min, max, count) {
    var step = niceStep(max - min, count || 4);
    var ticks = [];
    for (var v = min; v <= max + step * 1e-6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    if (ticks[ticks.length - 1] < max - 1e-9) ticks.push(max);
    return { min: min, max: max, ticks: ticks };
  }

  // 모서리별 둥근 사각형 path
  function rr(x, y, w, h, tl, tr, br, bl) {
    w = Math.max(0, w); h = Math.max(0, h);
    var m = Math.min(w, h) / 2;
    tl = Math.min(tl || 0, m); tr = Math.min(tr || 0, m); br = Math.min(br || 0, m); bl = Math.min(bl || 0, m);
    return 'M' + r1(x + tl) + ',' + r1(y) +
      'H' + r1(x + w - tr) + (tr ? 'A' + tr + ',' + tr + ' 0 0 1 ' + r1(x + w) + ',' + r1(y + tr) : '') +
      'V' + r1(y + h - br) + (br ? 'A' + br + ',' + br + ' 0 0 1 ' + r1(x + w - br) + ',' + r1(y + h) : '') +
      'H' + r1(x + bl) + (bl ? 'A' + bl + ',' + bl + ' 0 0 1 ' + r1(x) + ',' + r1(y + h - bl) : '') +
      'V' + r1(y + tl) + (tl ? 'A' + tl + ',' + tl + ' 0 0 1 ' + r1(x + tl) + ',' + r1(y) : '') + 'Z';
  }

  // CSS 변수 색을 실제 색으로(안쪽 글자 흑백 고르기용)
  function resolveColor(c) {
    c = String(c || '').trim();
    var m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(c);
    if (m) {
      var v = '';
      try { v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim(); } catch (e) { v = ''; }
      return v || (m[2] ? m[2].trim() : '#888888');
    }
    return c;
  }
  function luminance(c) {
    c = resolveColor(c);
    var r, g, b, m;
    if (/^#([0-9a-f]{3}){1,2}$/i.test(c)) {
      if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
      r = parseInt(c.slice(1, 3), 16); g = parseInt(c.slice(3, 5), 16); b = parseInt(c.slice(5, 7), 16);
    } else if ((m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(c))) {
      r = +m[1]; g = +m[2]; b = +m[3];
    } else return 0.3;
    function ch(x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  }
  function inkFor(c) { return luminance(c) > 0.4 ? '#1D1B18' : '#FFFFFF'; }

  // ── 인스턴스 관리 + 크기 변화 감지 ─────────────────────
  var live = [];
  var ro = null;
  try {
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) { var inst = entries[i].target.__daChart; if (inst) inst.schedule(); }
      });
    }
  } catch (e) { ro = null; }
  if (!ro && typeof window !== 'undefined') {
    window.addEventListener('resize', function () { live.forEach(function (i) { i.schedule(); }); });
    window.addEventListener('orientationchange', function () { live.forEach(function (i) { i.schedule(); }); });
  }
  function prune() {
    var now = Date.now();
    live = live.filter(function (inst) {
      var on = inst.el.isConnected;
      if (on) inst.seen = true;
      var dead = inst.seen ? !on : (now - inst.born > 15000 && !on);
      if (dead) { if (ro) try { ro.unobserve(inst.el); } catch (e) { /* 무시 */ } inst.el.__daChart = null; if (activeTip === inst) activeTip = null; }
      return !dead;
    });
  }

  var activeTip = null;
  function hideActive() { if (activeTip) { activeTip.hideTip(); activeTip = null; } }
  if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', function (e) {
      if (!activeTip) return;
      var t = e.target;
      if (t && t.closest && activeTip.el.contains(t)) return;
      hideActive();
    }, true);
    window.addEventListener('scroll', function () { if (activeTip && activeTip.tipByTouch) hideActive(); }, { passive: true });
  }

  function measure(inst) {
    var w = inst.el.clientWidth;
    if (!w && inst.el.parentNode && inst.el.parentNode.clientWidth) w = inst.el.parentNode.clientWidth;
    return Math.floor(w || 0);
  }

  function base(container, kind, opts, draw) {
    prune();
    var el = div('chart chart-' + kind + (opts && opts.className ? ' ' + opts.className : ''));
    var inst = { el: el, opts: opts || {}, width: 0, timer: null, born: Date.now(), seen: false, sel: null };
    el.__daChart = inst;
    if (container) container.appendChild(el);

    inst.render = function () {
      var w = measure(inst);
      inst.width = w;
      var cw = w || 320;
      hideTipOnly(inst);
      while (el.firstChild) el.removeChild(el.firstChild);
      try { draw(inst, cw, inst.opts); } catch (e) {
        while (el.firstChild) el.removeChild(el.firstChild);
        div('chart-empty', '차트를 그리지 못했어요', el);
        if (DA.ui && DA.ui._logErr) DA.ui._logErr(e, 'charts.' + kind);
      }
      inst.tip = div('chart-tip', null, el);
      inst.tip.setAttribute('aria-hidden', 'true');
    };
    inst.schedule = function () {
      clearTimeout(inst.timer);
      inst.timer = setTimeout(function () {
        if (!el.isConnected) return;
        var w = measure(inst);
        if (w && Math.abs(w - inst.width) >= 1) inst.render();
      }, 90);
    };
    inst.showTip = function (x, y, content, byTouch) {
      var tip = inst.tip;
      if (!tip) return;
      while (tip.firstChild) tip.removeChild(tip.firstChild);
      if (content.title) div('chart-tip-t', content.title, tip);
      (content.lines || []).forEach(function (ln) {
        var row = div('chart-tip-r', null, tip);
        if (ln.color) {
          var key = span('chart-tip-k' + (ln.kind === 'line' ? ' line' : ''), null, row);
          key.style.background = ln.color;
        }
        span('chart-tip-v', ln.value, row);
        if (ln.label) span('chart-tip-l', ln.label, row);
      });
      if (content.note) div('chart-tip-n', content.note, tip);
      tip.classList.add('on');
      var W = el.clientWidth || inst.width || 320;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = Math.max(2, Math.min(W - tw - 2, x - tw / 2));
      var top = y - th - 10;
      if (top < 0) top = y + 14;
      tip.style.left = Math.round(left) + 'px';
      tip.style.top = Math.round(top) + 'px';
      if (activeTip && activeTip !== inst) activeTip.hideTip();
      activeTip = inst;
      inst.tipByTouch = !!byTouch;
    };
    inst.hideTip = function () {
      hideTipOnly(inst);
      if (inst.onHide) inst.onHide();
    };
    inst.render();
    if (ro) { try { ro.observe(el); } catch (e) { /* 무시 */ } }
    live.push(inst);
    if (!inst.width) {
      // 아직 문서에 붙기 전이면 붙은 다음 틀에서 실제 폭으로 다시 그림
      var tries = 0;
      (function later() {
        requestAnimationFrame(function () {
          if (el.isConnected && measure(inst)) { if (measure(inst) !== inst.width) inst.render(); }
          else if (++tries < 20) later();
        });
      })();
    }
    return {
      el: el,
      update: function (o) { inst.opts = assign(inst.opts, o || {}); inst.render(); }
    };
  }
  function hideTipOnly(inst) {
    if (inst.tip) inst.tip.classList.remove('on');
    var s = inst.svgEl;
    if (s) {
      s.classList.remove('has-sel');
      var on = s.querySelectorAll('.on');
      for (var i = 0; i < on.length; i++) on[i].classList.remove('on');
    }
  }

  function makeSvg(inst, w, h, label) {
    var s = svg('svg', {
      width: w, height: h, viewBox: '0 0 ' + w + ' ' + h, role: 'img', 'aria-label': label || '차트',
      'font-family': FONT, class: 'chart-svg'
    });
    var t = svg('title', null, s);
    t.textContent = label || '차트';
    inst.svgEl = s;
    return s;
  }
  function emptyState(inst, opts, h) {
    var e = div('chart-empty', opts.emptyText || '표시할 기록이 없어요', inst.el);
    if (h) e.style.minHeight = Math.max(80, Math.min(h, 200)) + 'px';
  }
  function summary(prefix, items, fmt) {
    var parts = [];
    for (var i = 0; i < items.length && i < 16; i++) parts.push((items[i].label || '') + ' ' + fmt(items[i].value));
    if (items.length > 16) parts.push('외 ' + (items.length - 16) + '개');
    return prefix + ': ' + parts.join(', ');
  }

  // 막대·칸 탭/올리기 → 말풍선. getTip(el) → {x, y, content} | null
  function bindMarks(inst, s, getTip, onSelect) {
    function find(t) {
      while (t && t !== s) { if (t.__tipIdx != null) return t; t = t.parentNode; }
      return null;
    }
    function show(t, byTouch) {
      var info = getTip(t.__tipIdx, t);
      if (!info) return;
      s.classList.add('has-sel');
      var prev = s.querySelectorAll('.on');
      for (var i = 0; i < prev.length; i++) prev[i].classList.remove('on');
      if (t.__mark) t.__mark.classList.add('on'); else t.classList.add('on');
      inst.showTip(info.x, info.y, info.content, byTouch);
    }
    s.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse') return;
      var t = find(e.target);
      if (t) show(t, true);
    });
    s.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var t = find(e.target);
      if (t) show(t, false); else inst.hideTip();
    });
    s.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') inst.hideTip(); });
    s.addEventListener('click', function (e) {
      var t = find(e.target);
      if (!t) return;
      if (onSelect) onSelect(t.__tipIdx, e);
      else if (e.pointerType === 'mouse' || !e.pointerType) show(t, false);
    });
    s.addEventListener('focusin', function (e) { var t = find(e.target); if (t) show(t, false); });
    s.addEventListener('focusout', function () { inst.hideTip(); });
    s.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && onSelect) { var t = find(e.target); if (t) { e.preventDefault(); onSelect(t.__tipIdx, e); } }
    });
  }

  function legend(parent, items, kind) {
    var lg = div('chart-legend' + (kind ? ' ' + kind : ''), null, parent);
    items.forEach(function (it) {
      var li = div('chart-lg-i', null, lg);
      var key = span('chart-lg-k' + (it.line ? ' line' : ''), null, li);
      key.style.background = it.color;
      span('chart-lg-l', it.label, li);
      if (it.value != null && it.value !== '') span('chart-lg-v', it.value, li);
      if (it.sub) span('chart-lg-s', it.sub, li);
    });
    return lg;
  }

  function xLabels(g, labels, x0, band, y, maxLen) {
    var fs = 11;
    var maxW = 0;
    labels.forEach(function (l) { maxW = Math.max(maxW, textW(l, fs)); });
    var step = Math.max(1, Math.ceil((Math.min(maxW, maxLen || 80) + 6) / Math.max(1, band)));
    var n = labels.length;
    for (var i = 0; i < n; i++) {
      var show = (i % step === 0);
      // 마지막 칸은 앞 라벨과 겹치지 않을 때만 추가로 보여 줌
      if (!show && i === n - 1 && (i % step) >= Math.ceil(step * 0.75)) show = true;
      if (!show) continue;
      var t = svg('text', { x: r1(x0 + band * (i + 0.5)), y: y, 'text-anchor': 'middle', class: 'chart-ax' }, g);
      t.textContent = fit(labels[i], fs, Math.max(band * step - 4, 24));
    }
  }
  function yAxis(g, scale, fmt, x0, x1, yOf, yW) {
    scale.ticks.forEach(function (tv) {
      var y = r1(yOf(tv)) + 0.5;
      svg('line', { x1: x0, x2: x1, y1: y, y2: y, class: tv === scale.min ? 'chart-base' : 'chart-grid' }, g);
      var t = svg('text', { x: x0 - 6, y: y + 3.5, 'text-anchor': 'end', class: 'chart-ax' }, g);
      t.textContent = fmt(tv);
    });
  }
  function yAxisWidth(scale, fmt) {
    var w = 0;
    scale.ticks.forEach(function (tv) { w = Math.max(w, textW(fmt(tv), 11)); });
    return Math.ceil(w) + 10;
  }

  // ── 막대 ─────────────────────────────────────────────
  CH.bar = function (container, opts) {
    return base(container, 'bar', opts, function (inst, W, o) {
      var data = Array.isArray(o.data) ? o.data : [];
      var fmt = fmtOf(o.format);
      var vals = data.map(function (d) { return num(d && d.value); });
      var any = vals.some(function (v) { return v != null && v !== 0; });
      if (!data.length || (!any && !o.showZero)) { emptyState(inst, o, o.height || 180); return; }
      var color = o.color || 'var(--accent)';
      var maxV = 0;
      vals.forEach(function (v) { if (v != null && v > maxV) maxV = v; });
      var label = o.ariaLabel || o.title || summary('막대 그래프', data.map(function (d, i) { return { label: d.label, value: vals[i] }; }), fmt);
      var valueLabels = o.valueLabels !== false;
      if (o.horizontal) return drawHBar(inst, W, o, data, vals, fmt, color, maxV, label, valueLabels);

      var H = o.height || 180;
      var scale = o.max != null ? fixedScale(0, o.max, 4) : niceScale(0, maxV, 4, o.integer !== false && vals.every(function (v) { return v == null || Math.round(v) === v; }));
      var top = valueLabels ? 18 : 8, axisH = 22;
      var yW = o.yAxis === false ? 4 : yAxisWidth(scale, fmt);
      var x0 = yW, plotW = Math.max(40, W - x0 - 4);
      var n = data.length, band = plotW / n;
      var barW = Math.min(24, Math.max(3, band * 0.62));
      if (band < 6) barW = Math.max(1.5, band - 1.5);
      var h = top + H + axisH;
      var s = makeSvg(inst, W, h, label);
      var g = svg('g', null, s);
      function yOf(v) { return top + H - (Math.min(v, scale.max) - scale.min) / (scale.max - scale.min) * H; }
      if (o.yAxis !== false) yAxis(g, scale, fmt, x0, x0 + plotW, yOf, yW);
      else svg('line', { x1: x0, x2: x0 + plotW, y1: top + H + 0.5, y2: top + H + 0.5, class: 'chart-base' }, g);
      var marks = svg('g', null, s);
      var hits = svg('g', null, s);
      var r = Math.min(4, barW / 2);
      data.forEach(function (d, i) {
        var v = vals[i];
        var cx = x0 + band * (i + 0.5);
        var mk = null;
        if (v != null && v > 0) {
          var y = yOf(v), bh = top + H - y;
          mk = svg('path', { d: rr(cx - barW / 2, y, barW, bh, r, r, 0, 0), fill: d.color || color, class: 'mk' }, marks);
          if (valueLabels && textW(fmt(v), 11) <= band * 1.1 + 2 && n <= 24) {
            var tl = svg('text', { x: r1(cx), y: r1(y - 5), 'text-anchor': 'middle', class: 'chart-val' }, marks);
            tl.textContent = fmt(v);
          }
        }
        var hit = svg('rect', { x: r1(x0 + band * i), y: 0, width: r1(band), height: top + H, fill: 'transparent', class: 'hit' }, hits);
        hit.__tipIdx = i; hit.__mark = mk;
        if (n <= 40) { hit.setAttribute('tabindex', '0'); hit.setAttribute('aria-label', (d.label || '') + ' ' + (v == null ? '–' : fmt(v))); }
      });
      xLabels(g, data.map(function (d) { return d.label || ''; }), x0, band, top + H + 16);
      inst.el.appendChild(s);
      bindMarks(inst, s, function (i) {
        var d = data[i], v = vals[i];
        return {
          x: x0 + band * (i + 0.5), y: v != null && v > 0 ? yOf(v) : top + H,
          content: { title: d.label, lines: [{ value: v == null ? '–' : fmt(v), color: d.color || color }], note: d.title || '' }
        };
      }, o.onSelect ? function (i) { o.onSelect(data[i], i); } : null);
      if (o.onSelect) s.classList.add('selectable');
    });
  };

  function drawHBar(inst, W, o, data, vals, fmt, color, maxV, label, valueLabels) {
    var rowH = o.rowHeight || 32;
    var barH = Math.min(18, rowH - 12);
    var maxLabel = 0, maxVal = 0;
    data.forEach(function (d, i) {
      maxLabel = Math.max(maxLabel, textW(d.label, 13));
      maxVal = Math.max(maxVal, textW(vals[i] == null ? '–' : fmt(vals[i]), 12));
    });
    var labelW = Math.max(44, Math.min(W * 0.36, maxLabel + 10));
    var valW = valueLabels ? Math.ceil(maxVal) + 10 : 4;
    var plotW = Math.max(30, W - labelW - valW);
    var max = o.max != null ? o.max : (maxV || 1);
    var h = data.length * rowH + 4;
    var s = makeSvg(inst, W, h, label);
    var marks = svg('g', null, s), hits = svg('g', null, s);
    var r = Math.min(4, barH / 2);
    data.forEach(function (d, i) {
      var v = vals[i];
      var y = i * rowH + 2, cy = y + rowH / 2;
      var t = svg('text', { x: labelW - 8, y: r1(cy + 4.5), 'text-anchor': 'end', class: 'chart-lab' }, marks);
      t.textContent = fit(d.label || '', 13, labelW - 10);
      if (o.track) svg('path', { d: rr(labelW, cy - barH / 2, plotW, barH, r, r, r, r), class: 'chart-track' }, marks);
      var mk = null, bw = 0;
      if (v != null && v > 0) {
        bw = Math.max(2, Math.min(1, v / max) * plotW);
        mk = svg('path', { d: rr(labelW, cy - barH / 2, bw, barH, 0, r, r, 0), fill: d.color || color, class: 'mk' }, marks);
      }
      if (valueLabels) {
        var vt = svg('text', { x: r1(labelW + (o.track ? plotW : bw) + 6), y: r1(cy + 4), class: 'chart-val' + (v == null ? ' faint' : '') }, marks);
        vt.textContent = v == null ? '–' : fmt(v);
      }
      var hit = svg('rect', { x: 0, y: y, width: W, height: rowH, fill: 'transparent', class: 'hit' }, hits);
      hit.__tipIdx = i; hit.__mark = mk;
      hit.setAttribute('tabindex', '0');
      hit.setAttribute('aria-label', (d.label || '') + ' ' + (v == null ? '–' : fmt(v)));
    });
    inst.el.appendChild(s);
    bindMarks(inst, s, function (i) {
      var d = data[i], v = vals[i];
      var bw = v != null && v > 0 ? Math.min(1, v / max) * plotW : 0;
      return {
        x: Math.min(W - 20, labelW + bw), y: i * rowH + 2,
        content: { title: d.label, lines: [{ value: v == null ? '–' : fmt(v), color: d.color || color }], note: d.title || '' }
      };
    }, o.onSelect ? function (i) { o.onSelect(data[i], i); } : null);
    if (o.onSelect) s.classList.add('selectable');
  }

  // ── 누적 막대 ────────────────────────────────────────
  CH.stacked = function (container, opts) {
    return base(container, 'stacked', opts, function (inst, W, o) {
      var data = Array.isArray(o.data) ? o.data : [];
      var series = (Array.isArray(o.series) ? o.series : []).filter(Boolean);
      var fmt = fmtOf(o.format);
      var pctFmt = function (r) { return U().pct ? U().pct(r) : Math.round(r * 100) + '%'; };
      var totals = data.map(function (d) {
        var t = 0;
        series.forEach(function (sr) { var v = num(d.values && d.values[sr.key]); if (v != null && v > 0) t += v; });
        return t;
      });
      var grand = totals.reduce(function (a, b) { return a + b; }, 0);
      if (!data.length || !series.length || !grand) { emptyState(inst, o, o.height || 160); return; }
      var sumBy = {};
      series.forEach(function (sr) {
        sumBy[sr.key] = 0;
        data.forEach(function (d) { var v = num(d.values && d.values[sr.key]); if (v != null && v > 0) sumBy[sr.key] += v; });
      });
      var label = o.ariaLabel || o.title || ('누적 막대 그래프: ' + series.map(function (sr) { return sr.label + ' ' + fmt(sumBy[sr.key]); }).join(', '));
      var tipOf = function (i) {
        var d = data[i], tot = totals[i];
        return {
          title: d.label || '',
          lines: series.filter(function (sr) { return num(d.values && d.values[sr.key]); }).map(function (sr) {
            var v = num(d.values[sr.key]) || 0;
            return { value: fmt(v) + (tot ? ' · ' + pctFmt(v / tot) : ''), label: sr.label, color: sr.color };
          }),
          note: o.percent ? '합계 ' + fmt(tot) : (tot ? '합계 ' + fmt(tot) : '')
        };
      };
      if (o.horizontal) drawHStacked(inst, W, o, data, series, totals, fmt, pctFmt, label, tipOf);
      else drawVStacked(inst, W, o, data, series, totals, fmt, pctFmt, label, tipOf);
      if (o.legend !== false) {
        legend(inst.el, series.filter(function (sr) { return sumBy[sr.key] > 0 || o.legendAll; }).map(function (sr) {
          return {
            label: sr.label, color: sr.color,
            value: o.legendValues === false ? '' : fmt(sumBy[sr.key]),
            sub: o.percent || o.legendPercent ? pctFmt(sumBy[sr.key] / grand) : ''
          };
        }));
      }
    });
  };

  function drawVStacked(inst, W, o, data, series, totals, fmt, pctFmt, label, tipOf) {
    var H = o.height || 180;
    var maxT = 0; totals.forEach(function (t) { maxT = Math.max(maxT, t); });
    var scale = o.percent ? fixedScale(0, 1, 4) : niceScale(0, o.max != null ? o.max : maxT, 4, true);
    var afmt = o.percent ? pctFmt : fmtOf(o.format);
    var showTotals = !o.percent && o.valueLabels !== false;
    var top = showTotals ? 18 : 8, axisH = 22;
    var yW = yAxisWidth(scale, afmt);
    var x0 = yW, plotW = Math.max(40, W - x0 - 4);
    var n = data.length, band = plotW / n;
    var barW = Math.min(24, Math.max(3, band * 0.62));
    if (band < 6) barW = Math.max(1.5, band - 1.5);
    var s = makeSvg(inst, W, top + H + axisH, label);
    var g = svg('g', null, s);
    function yOf(v) { return top + H - (v - scale.min) / (scale.max - scale.min) * H; }
    yAxis(g, scale, afmt, x0, x0 + plotW, yOf, yW);
    var marks = svg('g', null, s), hits = svg('g', null, s);
    var r = Math.min(4, barW / 2);
    data.forEach(function (d, i) {
      var tot = totals[i];
      var cx = x0 + band * (i + 0.5);
      var col = svg('g', { class: 'mk' }, marks);
      if (tot > 0) {
        var acc = 0;
        var segs = [];
        series.forEach(function (sr) {
          var v = num(d.values && d.values[sr.key]);
          if (v == null || v <= 0) return;
          segs.push({ v: o.percent ? v / tot : v, color: sr.color });
        });
        segs.forEach(function (sg, k) {
          var yb = yOf(acc), yt = yOf(acc + sg.v);
          acc += sg.v;
          var hh = yb - yt;
          var isTop = k === segs.length - 1;
          if (k > 0 && hh > 3) { hh -= 2; }                 // 아래 조각과 2px 틈
          if (hh <= 0.2) return;
          svg('path', { d: rr(cx - barW / 2, yt, barW, hh, isTop ? r : 0, isTop ? r : 0, 0, 0), fill: sg.color }, col);
        });
        if (showTotals && textW(fmt(tot), 11) <= band * 1.1 + 2 && n <= 24) {
          var tl = svg('text', { x: r1(cx), y: r1(yOf(o.percent ? 1 : tot) - 5), 'text-anchor': 'middle', class: 'chart-val' }, marks);
          tl.textContent = fmt(tot);
        }
      }
      var hit = svg('rect', { x: r1(x0 + band * i), y: 0, width: r1(band), height: top + H, fill: 'transparent', class: 'hit' }, hits);
      hit.__tipIdx = i; hit.__mark = col;
      if (n <= 40) { hit.setAttribute('tabindex', '0'); hit.setAttribute('aria-label', (d.label || '') + ' 합계 ' + fmt(tot)); }
    });
    xLabels(g, data.map(function (d) { return d.label || ''; }), x0, band, top + H + 16);
    inst.el.appendChild(s);
    bindMarks(inst, s, function (i) {
      return { x: x0 + band * (i + 0.5), y: totals[i] ? yOf(o.percent ? 1 : totals[i]) : top + H, content: tipOf(i) };
    });
  }

  function drawHStacked(inst, W, o, data, series, totals, fmt, pctFmt, label, tipOf) {
    var hasLabels = data.some(function (d) { return d.label; });
    var barH = Math.min(24, o.barHeight || (data.length === 1 ? 24 : 18));
    var rowH = Math.max(barH + 12, o.rowHeight || (data.length === 1 ? barH + 8 : 32));
    var maxLabel = 0; data.forEach(function (d) { maxLabel = Math.max(maxLabel, textW(d.label, 13)); });
    var labelW = hasLabels ? Math.max(44, Math.min(W * 0.34, maxLabel + 10)) : 0;
    var showTotals = !o.percent && o.valueLabels !== false;
    var maxT = 0; totals.forEach(function (t) { maxT = Math.max(maxT, t); });
    var valW = showTotals ? Math.ceil(textW(fmt(maxT), 12)) + 10 : 0;
    var plotW = Math.max(30, W - labelW - valW);
    var max = o.percent ? 1 : (o.max != null ? o.max : maxT || 1);
    var s = makeSvg(inst, W, data.length * rowH, label);
    var marks = svg('g', null, s), hits = svg('g', null, s);
    var r = Math.min(4, barH / 2);
    data.forEach(function (d, i) {
      var tot = totals[i];
      var cy = i * rowH + rowH / 2;
      if (hasLabels) {
        var t = svg('text', { x: labelW - 8, y: r1(cy + 4.5), 'text-anchor': 'end', class: 'chart-lab' }, marks);
        t.textContent = fit(d.label || '', 13, labelW - 10);
      }
      var row = svg('g', { class: 'mk' }, marks);
      var segs = [];
      series.forEach(function (sr) {
        var v = num(d.values && d.values[sr.key]);
        if (v == null || v <= 0) return;
        segs.push({ v: v, w: (o.percent ? v / tot : v / max) * plotW, color: sr.color, label: sr.label });
      });
      var x = labelW;
      segs.forEach(function (sg, k) {
        var w = sg.w;
        var first = k === 0, last = k === segs.length - 1;
        var gap = !last && w > 3 ? 2 : 0;
        var dw = w - gap;
        if (dw > 0.2) {
          svg('path', {
            d: rr(x, cy - barH / 2, dw, barH, o.percent && first ? r : 0, last ? r : 0, last ? r : 0, o.percent && first ? r : 0),
            fill: sg.color
          }, row);
          if (o.percent && o.inlineLabels !== false) {
            var txt = pctFmt(sg.v / tot);
            if (dw >= textW(txt, 12) + 12 && barH >= 16) {
              var it = svg('text', { x: r1(x + dw / 2), y: r1(cy + 4.2), 'text-anchor': 'middle', class: 'chart-in', fill: inkFor(sg.color) }, row);
              it.textContent = txt;
            }
          }
        }
        x += w;
      });
      if (showTotals && tot) {
        var vt = svg('text', { x: r1(x + 6), y: r1(cy + 4), class: 'chart-val' }, marks);
        vt.textContent = fmt(tot);
      }
      var hit = svg('rect', { x: 0, y: i * rowH, width: W, height: rowH, fill: 'transparent', class: 'hit' }, hits);
      hit.__tipIdx = i; hit.__mark = row;
      hit.setAttribute('tabindex', '0');
      hit.setAttribute('aria-label', (d.label || '구성') + ' 합계 ' + fmt(tot));
    });
    inst.el.appendChild(s);
    bindMarks(inst, s, function (i, t) {
      return { x: labelW + plotW / 2, y: i * rowH + 2, content: tipOf(i) };
    });
  }

  // ── 선 ───────────────────────────────────────────────
  CH.line = function (container, opts) {
    return base(container, 'line', opts, function (inst, W, o) {
      var data = Array.isArray(o.data) ? o.data : [];
      var vals = data.map(function (d) { return num(d && d.value); });
      var fmt = fmtOf(o.format);
      var real = vals.filter(function (v) { return v != null; });
      if (!data.length || !real.length) { emptyState(inst, o, o.height || 180); return; }
      var color = o.color || 'var(--accent)';
      var H = o.height || 180;
      var lo = o.yMin != null ? o.yMin : Math.min.apply(null, real.concat([0]));
      var hi = o.yMax != null ? o.yMax : Math.max.apply(null, real);
      var scale = (o.yMin != null && o.yMax != null) ? fixedScale(lo, hi, 4) : niceScale(lo, hi, 4, real.every(function (v) { return Math.round(v) === v; }));
      if (o.yMin != null) scale.min = Math.min(scale.min, o.yMin);
      var top = 14, axisH = 22;
      var yW = yAxisWidth(scale, fmt);
      var x0 = yW, plotW = Math.max(40, W - x0 - 10);
      var n = data.length, band = plotW / n;
      var label = o.ariaLabel || o.title || summary('선 그래프', data.map(function (d, i) { return { label: d.label, value: vals[i] }; }), fmt);
      var s = makeSvg(inst, W, top + H + axisH, label);
      s.style.touchAction = 'pan-y';
      var g = svg('g', null, s);
      function yOf(v) { return top + H - (Math.max(scale.min, Math.min(scale.max, v)) - scale.min) / (scale.max - scale.min) * H; }
      function xOf(i) { return x0 + band * (i + 0.5); }
      yAxis(g, scale, fmt, x0, x0 + plotW, yOf, yW);
      var ser = { vals: vals, color: color, fmt: fmt, label: o.seriesLabel || '' };
      drawLineSeries(s, ser, xOf, yOf, top + H, o.area !== false, o.points !== false && n <= 36);
      endLabel(s, vals, xOf, yOf, fmt, W);
      xLabels(g, data.map(function (d) { return d.label || ''; }), x0, band, top + H + 16);
      inst.el.appendChild(s);
      crosshair(inst, s, n, xOf, band, x0, plotW, top, top + H, function (i) {
        return {
          dots: vals[i] != null ? [{ x: xOf(i), y: yOf(vals[i]), color: color }] : [],
          y: vals[i] != null ? yOf(vals[i]) : top + H / 2,
          content: { title: data[i].label, lines: [{ value: vals[i] == null ? '–' : fmt(vals[i]), label: o.seriesLabel || '', color: color, kind: 'line' }], note: data[i].title || '' }
        };
      });
    });
  };

  function drawLineSeries(s, ser, xOf, yOf, baseY, area, points) {
    var segs = [], cur = null;
    ser.vals.forEach(function (v, i) {
      if (v == null) { cur = null; return; }
      if (!cur) { cur = []; segs.push(cur); }
      cur.push([xOf(i), yOf(v)]);
    });
    var g = svg('g', null, s);
    segs.forEach(function (pts) {
      if (area && pts.length > 1) {
        var da = 'M' + r1(pts[0][0]) + ',' + baseY + pts.map(function (p) { return 'L' + r1(p[0]) + ',' + r1(p[1]); }).join('') + 'L' + r1(pts[pts.length - 1][0]) + ',' + baseY + 'Z';
        svg('path', { d: da, fill: ser.color, 'fill-opacity': 0.1, stroke: 'none' }, g);
      }
      if (pts.length > 1) {
        svg('path', { d: 'M' + pts.map(function (p) { return r1(p[0]) + ',' + r1(p[1]); }).join('L'), fill: 'none', stroke: ser.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, g);
      }
    });
    // 점: 적으면 모두, 많으면 떨어진 점(앞뒤가 비어 선이 안 보이는 점)과 마지막만
    ser.vals.forEach(function (v, i) {
      if (v == null) return;
      var isolated = (i === 0 || ser.vals[i - 1] == null) && (i === ser.vals.length - 1 || ser.vals[i + 1] == null);
      var last = true;
      for (var k = i + 1; k < ser.vals.length; k++) if (ser.vals[k] != null) { last = false; break; }
      if (points || isolated || last) svg('circle', { cx: r1(xOf(i)), cy: r1(yOf(v)), r: 4, fill: ser.color, class: 'chart-dot' }, g);
    });
  }
  function endLabel(s, vals, xOf, yOf, fmt, W) {
    for (var i = vals.length - 1; i >= 0; i--) {
      if (vals[i] == null) continue;
      var x = xOf(i), y = yOf(vals[i]);
      var txt = fmt(vals[i]);
      var tw = textW(txt, 12);
      var anchor = x + tw / 2 > W - 2 ? 'end' : 'middle';
      var t = svg('text', { x: r1(anchor === 'end' ? Math.min(W - 2, x + 4) : x), y: r1(Math.max(11, y - 9)), 'text-anchor': anchor, class: 'chart-val strong' }, s);
      t.textContent = txt;
      return;
    }
  }

  // 선·복합 그래프 공통: 가로 위치로 가장 가까운 칸을 찾아 세로선 + 말풍선
  function crosshair(inst, s, n, xOf, band, x0, plotW, y0, y1, info) {
    var layer = svg('g', { class: 'chart-cross', 'pointer-events': 'none' }, s);
    var overlay = svg('rect', { x: x0, y: 0, width: plotW, height: y1 + 4, fill: 'transparent', class: 'hit', tabindex: 0, 'aria-label': '값 살펴보기(좌우 화살표)' }, s);
    var cur = -1;
    function clear() { while (layer.firstChild) layer.removeChild(layer.firstChild); cur = -1; }
    inst.onHide = clear;
    function show(i, byTouch) {
      if (i < 0 || i >= n) return;
      cur = i;
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      var x = r1(xOf(i)) + 0.5;
      svg('line', { x1: x, x2: x, y1: y0 - 4, y2: y1, class: 'chart-xline' }, layer);
      var inf = info(i);
      (inf.dots || []).forEach(function (d) { svg('circle', { cx: r1(d.x), cy: r1(d.y), r: 5, fill: d.color, class: 'chart-dot' }, layer); });
      inst.showTip(xOf(i), Math.max(8, inf.y), inf.content, byTouch);
      inst.onHide = clear;
    }
    function idxAt(e) {
      var rect = s.getBoundingClientRect();
      var sx = (e.clientX - rect.left) * (s.viewBox && s.viewBox.baseVal && rect.width ? s.viewBox.baseVal.width / rect.width : 1);
      return Math.max(0, Math.min(n - 1, Math.floor((sx - x0) / band)));
    }
    overlay.addEventListener('pointerdown', function (e) { show(idxAt(e), e.pointerType !== 'mouse'); });
    overlay.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' || e.buttons || e.pressure) show(idxAt(e), e.pointerType !== 'mouse'); });
    overlay.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') inst.hideTip(); });
    overlay.addEventListener('focus', function () { show(cur >= 0 ? cur : n - 1, false); });
    overlay.addEventListener('blur', function () { inst.hideTip(); });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(Math.max(0, (cur < 0 ? n : cur) - 1), false); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); show(Math.min(n - 1, cur + 1), false); }
    });
  }

  // ── 복합(수 막대 + 비율 선): 축을 겹치지 않고 위(비율)·아래(수) 두 칸 ──
  CH.combo = function (container, opts) {
    return base(container, 'combo', opts, function (inst, W, o) {
      var data = Array.isArray(o.data) ? o.data : [];
      var bars = data.map(function (d) { return num(d && d.bar); });
      var lines = data.map(function (d) { return num(d && d.line); });
      var bfmt = fmtOf(o.barFormat), lfmt = o.lineFormat ? fmtOf(o.lineFormat) : function (v) { return U().pct ? U().pct(v) : Math.round(v * 100) + '%'; };
      var anyB = bars.some(function (v) { return v; }), anyL = lines.some(function (v) { return v != null; });
      if (!data.length || (!anyB && !anyL)) { emptyState(inst, o, o.height || 220); return; }
      var lineColor = o.lineColor || 'var(--accent)', barColor = o.barColor || 'var(--st-unmarked)';
      var H = o.height || 220;
      var lineH = Math.max(70, Math.round(H * 0.5)), gapH = 16, barH = Math.max(50, H - lineH - gapH);
      var lScale = fixedScale(0, 1, 2);
      var maxB = 0; bars.forEach(function (v) { if (v != null) maxB = Math.max(maxB, v); });
      var bScale = niceScale(0, maxB, 2, true);
      var yW = Math.max(yAxisWidth(lScale, lfmt), yAxisWidth(bScale, bfmt));
      var top = 16, axisH = 22;
      var x0 = yW, plotW = Math.max(40, W - x0 - 10);
      var n = data.length, band = plotW / n;
      var barW = Math.min(24, Math.max(3, band * 0.56));
      if (band < 6) barW = Math.max(1.5, band - 1.5);
      var lTop = top, lBot = top + lineH, bTop = lBot + gapH, bBot = bTop + barH;
      var label = o.ariaLabel || o.title || ((o.lineLabel || '비율') + ' · ' + (o.barLabel || '수') + ' 추이: ' +
        data.slice(-8).map(function (d, i) { var k = data.length - Math.min(8, data.length) + i; return d.label + ' ' + (lines[k] == null ? '–' : lfmt(lines[k])) + '/' + (bars[k] == null ? '–' : bfmt(bars[k])); }).join(', '));
      var s = makeSvg(inst, W, bBot + axisH, label);
      s.style.touchAction = 'pan-y';
      var g = svg('g', null, s);
      function xOf(i) { return x0 + band * (i + 0.5); }
      function lY(v) { return lBot - (Math.max(0, Math.min(1, v)) - lScale.min) / (lScale.max - lScale.min) * lineH; }
      function bY(v) { return bBot - (v - bScale.min) / (bScale.max - bScale.min) * barH; }
      yAxis(g, lScale, lfmt, x0, x0 + plotW, lY, yW);
      yAxis(g, bScale, bfmt, x0, x0 + plotW, bY, yW);
      var cap1 = svg('text', { x: x0 + 2, y: lTop - 5, class: 'chart-cap' }, g); cap1.textContent = o.lineLabel || '비율';
      var cap2 = svg('text', { x: x0 + 2, y: bTop - 5, class: 'chart-cap' }, g); cap2.textContent = o.barLabel || '수';
      var marks = svg('g', null, s);
      var r = Math.min(4, barW / 2);
      bars.forEach(function (v, i) {
        if (v == null || v <= 0) return;
        var y = bY(v);
        svg('path', { d: rr(xOf(i) - barW / 2, y, barW, bBot - y, r, r, 0, 0), fill: barColor }, marks);
      });
      drawLineSeries(s, { vals: lines, color: lineColor }, xOf, lY, lBot, o.area !== false, n <= 30);
      endLabel(s, lines, xOf, lY, lfmt, W);
      xLabels(g, data.map(function (d) { return d.label || ''; }), x0, band, bBot + 16);
      inst.el.appendChild(s);
      crosshair(inst, s, n, xOf, band, x0, plotW, lTop, bBot, function (i) {
        return {
          dots: lines[i] != null ? [{ x: xOf(i), y: lY(lines[i]), color: lineColor }] : [],
          y: lines[i] != null ? lY(lines[i]) : lTop + lineH / 2,
          content: {
            title: data[i].label,
            lines: [
              { value: lines[i] == null ? '–' : lfmt(lines[i]), label: o.lineLabel || '', color: lineColor, kind: 'line' },
              { value: bars[i] == null ? '–' : bfmt(bars[i]), label: o.barLabel || '', color: barColor }
            ],
            note: data[i].title || ''
          }
        };
      });
      if (o.legend !== false) {
        legend(inst.el, [
          { label: o.lineLabel || '비율', color: lineColor, line: true },
          { label: o.barLabel || '수', color: barColor }
        ], 'compact');
      }
    });
  };

  // ── 도넛 ─────────────────────────────────────────────
  CH.donut = function (container, opts) {
    return base(container, 'donut', opts, function (inst, W, o) {
      var data = (Array.isArray(o.data) ? o.data : []).filter(function (d) { return d && num(d.value) > 0; });
      var fmt = fmtOf(o.format);
      var total = data.reduce(function (a, d) { return a + d.value; }, 0);
      if (!total) { emptyState(inst, o, o.size || 160); return; }
      var pctFmt = function (r) { return U().pct ? U().pct(r) : Math.round(r * 100) + '%'; };
      var size = Math.min(o.size || 160, W);
      var R = size / 2, th = Math.max(14, Math.round(size * 0.15)), ri = R - th;
      var wrap = div('chart-donut-wrap' + (W >= size + 190 ? ' side' : ''), null, inst.el);
      var label = o.ariaLabel || o.title || ('도넛 그래프: ' + data.map(function (d) { return d.label + ' ' + fmt(d.value) + '(' + pctFmt(d.value / total) + ')'; }).join(', '));
      var s = makeSvg(inst, size, size, label);
      var marks = svg('g', null, s);
      var pad = data.length > 1 ? 2 / (R - th / 2) : 0;       // 2px 표면색 틈
      var a = -Math.PI / 2;
      var arcs = [];
      data.forEach(function (d, i) {
        var sweep = d.value / total * Math.PI * 2;
        var a0 = a + pad / 2, a1 = a + sweep - pad / 2;
        a += sweep;
        if (a1 <= a0) a1 = a0 + 0.001;
        var p;
        if (data.length === 1 || sweep >= Math.PI * 2 - 1e-6) {
          svg('circle', { cx: R, cy: R, r: r1(R - th / 2), fill: 'none', stroke: d.color || 'var(--accent)', 'stroke-width': th, class: 'mk' }, marks);
          arcs.push({ mid: -Math.PI / 2 });
        } else {
          var large = a1 - a0 > Math.PI ? 1 : 0;
          var x0 = R + R * Math.cos(a0), y0 = R + R * Math.sin(a0), x1 = R + R * Math.cos(a1), y1 = R + R * Math.sin(a1);
          var x2 = R + ri * Math.cos(a1), y2 = R + ri * Math.sin(a1), x3 = R + ri * Math.cos(a0), y3 = R + ri * Math.sin(a0);
          p = 'M' + r1(x0) + ',' + r1(y0) + 'A' + R + ',' + R + ' 0 ' + large + ' 1 ' + r1(x1) + ',' + r1(y1) +
            'L' + r1(x2) + ',' + r1(y2) + 'A' + ri + ',' + ri + ' 0 ' + large + ' 0 ' + r1(x3) + ',' + r1(y3) + 'Z';
          var seg = svg('path', { d: p, fill: d.color || 'var(--accent)', class: 'mk hit', tabindex: 0, 'aria-label': d.label + ' ' + fmt(d.value) }, marks);
          seg.__tipIdx = i;
          arcs.push({ mid: (a0 + a1) / 2 });
        }
      });
      if (data.length === 1) {
        var only = svg('circle', { cx: R, cy: R, r: R, fill: 'transparent', class: 'hit', tabindex: 0 }, marks);
        only.__tipIdx = 0;
      }
      if (o.centerText != null && o.centerText !== '') {
        var ct = svg('text', { x: R, y: o.centerSub ? R + 3 : R + 8, 'text-anchor': 'middle', class: 'chart-center' }, s);
        ct.textContent = fit(o.centerText, Math.max(14, Math.round(size * 0.13)), ri * 1.8);
        ct.setAttribute('font-size', Math.max(14, Math.round(size * 0.13)));
      }
      if (o.centerSub) {
        var cs = svg('text', { x: R, y: R + 21, 'text-anchor': 'middle', class: 'chart-center-sub' }, s);
        cs.textContent = fit(o.centerSub, 12, ri * 1.7);
      }
      wrap.appendChild(s);
      bindMarks(inst, s, function (i) {
        var d = data[i], m = arcs[i] ? arcs[i].mid : 0;
        var off = wrap.classList.contains('side') ? 0 : Math.max(0, (W - size) / 2);
        return {
          x: off + R + (R - th / 2) * Math.cos(m), y: R + (R - th / 2) * Math.sin(m) - 4,
          content: { title: d.label, lines: [{ value: fmt(d.value) + ' · ' + pctFmt(d.value / total), color: d.color }], note: d.title || '' }
        };
      });
      if (o.legend !== false) {
        legend(wrap, data.map(function (d) { return { label: d.label, color: d.color || 'var(--accent)', value: fmt(d.value), sub: pctFmt(d.value / total) }; }), 'list');
      }
    });
  };

  // ── 히트맵(한 가지 색의 진하기) ──────────────────────
  CH.heatmap = function (container, opts) {
    return base(container, 'heatmap', opts, function (inst, W, o) {
      var rows = Array.isArray(o.rows) ? o.rows : [], cols = Array.isArray(o.cols) ? o.cols : [];
      var cells = Array.isArray(o.cells) ? o.cells : [];
      var fmt = fmtOf(o.format);
      var vals = [];
      cells.forEach(function (row) { (row || []).forEach(function (c) { var v = num(c && c.value); if (v != null) vals.push(v); }); });
      if (!rows.length || !cols.length || !vals.length) { emptyState(inst, o, 160); return; }
      var color = o.color || 'var(--accent)';
      var vmin = o.min != null ? o.min : Math.min.apply(null, vals.concat([0]));
      var vmax = o.max != null ? o.max : Math.max.apply(null, vals);
      if (!(vmax > vmin)) vmax = vmin + 1;
      var maxRow = 0; rows.forEach(function (r) { maxRow = Math.max(maxRow, textW(r, 13)); });
      var labelW = Math.ceil(maxRow) + 12;
      var cellW = Math.max(30, Math.floor((W - labelW) / cols.length));
      var cellH = o.cellHeight || 34;
      var headH = 20;
      var totalW = labelW + cellW * cols.length;
      var scroll = totalW > W + 1;
      var host = scroll ? div('chart-scroll', null, inst.el) : inst.el;
      var label = o.ariaLabel || o.title || ('히트맵: ' + rows.length + '행 × ' + cols.length + '열');
      var s = makeSvg(inst, Math.max(totalW, 10), headH + rows.length * cellH, label);
      var g = svg('g', null, s), marks = svg('g', null, s);
      var colStep = Math.max(1, Math.ceil((Math.max.apply(null, cols.map(function (c) { return textW(c, 11); })) + 4) / cellW));
      cols.forEach(function (c, j) {
        if (j % colStep) return;
        var t = svg('text', { x: r1(labelW + cellW * (j + 0.5)), y: 13, 'text-anchor': 'middle', class: 'chart-ax' }, g);
        t.textContent = c;
      });
      var ink = inkFor(color);
      rows.forEach(function (rl, i) {
        var t = svg('text', { x: labelW - 8, y: r1(headH + cellH * (i + 0.5) + 4.5), 'text-anchor': 'end', class: 'chart-lab' }, g);
        t.textContent = rl;
        cols.forEach(function (c, j) {
          var cell = (cells[i] || [])[j] || {};
          var v = num(cell.value);
          var x = labelW + cellW * j + 1, y = headH + cellH * i + 1;
          var rect;
          if (v == null) {
            rect = svg('rect', { x: x, y: y, width: cellW - 2, height: cellH - 2, rx: 4, class: 'chart-cell-empty' }, marks);
          } else {
            var tt = Math.max(0, Math.min(1, (v - vmin) / (vmax - vmin)));
            rect = svg('rect', { x: x, y: y, width: cellW - 2, height: cellH - 2, rx: 4, fill: color, 'fill-opacity': Math.round((0.12 + 0.88 * tt) * 100) / 100, class: 'mk' }, marks);
            var txt = fmt(v);
            if (textW(txt, 11) + 6 <= cellW - 2) {
              var vt = svg('text', { x: r1(x + (cellW - 2) / 2), y: r1(y + (cellH - 2) / 2 + 4), 'text-anchor': 'middle', class: 'chart-cellv', fill: tt > 0.55 ? ink : 'var(--text)' }, marks);
              vt.textContent = txt;
            }
          }
          rect.__tipIdx = i * cols.length + j;
          rect.setAttribute('class', rect.getAttribute('class') + ' hit');
        });
      });
      host.appendChild(s);
      bindMarks(inst, s, function (k) {
        var i = Math.floor(k / cols.length), j = k % cols.length;
        var cell = (cells[i] || [])[j] || {};
        var v = num(cell.value);
        var sl = scroll ? host.scrollLeft : 0;
        return {
          x: labelW + cellW * (j + 0.5) - sl, y: headH + cellH * i,
          content: { title: rows[i] + ' · ' + cols[j], lines: [{ value: v == null ? '수업 없음' : fmt(v), color: v == null ? null : color }], note: cell.title || '' }
        };
      });
      if (o.legend !== false) {
        var lg = div('chart-scale', null, inst.el);
        span('chart-scale-l', o.minLabel || fmt(vmin), lg);
        var bar = span('chart-scale-bar', null, lg);
        bar.style.background = 'linear-gradient(90deg, transparent, ' + resolveColor(color) + ')';
        bar.style.backgroundColor = 'var(--surface-2)';
        span('chart-scale-l', o.maxLabel || fmt(vmax), lg);
        var em = span('chart-scale-e', null, lg);
        span('chart-scale-sw', null, em);
        span(null, o.emptyLabel || '수업 없음', em);
      }
    });
  };

  // ── 작은 추세선 ──────────────────────────────────────
  CH.spark = function (container, opts) {
    return base(container, 'spark', opts, function (inst, W, o) {
      var vals = (Array.isArray(o.values) ? o.values : []).map(num);
      var real = vals.filter(function (v) { return v != null; });
      var H = o.height || 28;
      var s = makeSvg(inst, W, H, o.ariaLabel || '추세');
      if (!o.ariaLabel) s.setAttribute('aria-hidden', 'true');
      inst.el.appendChild(s);
      if (real.length < 2) return;
      var lo = o.yMin != null ? o.yMin : Math.min.apply(null, real), hi = o.yMax != null ? o.yMax : Math.max.apply(null, real);
      if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
      var n = vals.length, pad = 4;
      function xOf(i) { return pad + (W - pad * 2) * (n === 1 ? 0.5 : i / (n - 1)); }
      function yOf(v) { return 3 + (H - 6) * (1 - (v - lo) / (hi - lo)); }
      var color = o.color || 'var(--accent)';
      var d = '', started = false, lastI = -1;
      vals.forEach(function (v, i) {
        if (v == null) { started = false; return; }
        d += (started ? 'L' : 'M') + r1(xOf(i)) + ',' + r1(yOf(v));
        started = true; lastI = i;
      });
      svg('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 1.75, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s);
      if (lastI >= 0) svg('circle', { cx: r1(xOf(lastI)), cy: r1(yOf(vals[lastI])), r: 3, fill: color }, s);
    });
  };

  // 다른 뷰에서도 쓸 수 있는 도구(선택)
  CH.niceScale = niceScale;
  CH.textWidth = textW;
  CH.resolveColor = resolveColor;
  CH.hideTips = hideActive;
})(window.DA = window.DA || {});
