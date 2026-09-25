/* 드럼 출석부 — 시간표 (SPEC §6.3)
 * 주간 격자 / 일간 타임라인, 블록 위 그날 출석 현황, 이름 탭 = 서명 출석,
 * 수업 시트(상태 줄·편집·휴강·보강·종료), 수업 편집기(여러 요일·겹침 경고·오늘부터 적용 분할).
 * 공개: DA.timetable.editLesson(src, preset) / openOccurrence(occ) / goto(ymd, mode)
 * 라우트 질의: #/timetable?date=YYYY-MM-DD[&mode=day|week]  ?new=1[&student=<id>]  ?lesson=<id>
 */
(function (DA) {
  'use strict';
  var ui = DA.ui;
  if (!ui || !ui.registerView) return;
  var h = ui.h;
  var U = DA.util;
  var SC = DA.schedule;
  var TT = DA.timetable = DA.timetable || {};

  var LS_MODE = 'da.tt.mode';
  var LS_COLOR = 'da.tt.color';
  var PX = { week: 1.5, day: 2.4 };          // 분당 픽셀
  var TIME_W = 52;                            // 시간 열 폭(CSS와 같게)
  var COL_MIN = 104;                          // 주간 요일 열 최소 폭(CSS와 같게)
  var MARK = { present: '✓', late: '✓', absent: '✕', excused: '공', canceled: '휴', unmarked: '?', pending: '·', upcoming: '·' };
  var KIND_LABEL = { regular: '정규', makeup: '보강', special: '특강', trial: '체험', walkin: '이용권' };
  var DUR_PRESETS = [30, 40, 50, 60];

  /* ---------------- 보기 상태(다시 그려도 유지) ---------------- */
  var st = {
    mode: null,          // 'week' | 'day'
    date: null,          // 기준 날짜(일간: 그날, 주간: 그 주)
    colorBy: null,       // 'teacher' | 'course'
    teacher: '',         // 강사 필터('' 전체)
    room: '',            // 방 필터
    scroll: { key: '', top: 0, left: 0 },
    consumed: null,      // 처리한 질의 해시
    ticks: 0
  };
  var refs = null;       // 현재 화면 요소 참조

  /* ---------------- 도우미 ---------------- */
  function lsGet(k) { try { return window.localStorage ? window.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (window.localStorage) window.localStorage.setItem(k, v); } catch (e) { /* 무시 */ } }
  function data() { return DA.store.data; }
  function settings() { return (DA.store.data && DA.store.data.settings) || {}; }
  function today() { return U.today(); }
  function logErr(e, w) { if (ui._logErr) ui._logErr(e, w); else if (window.console) console.error(w, e); }
  function ic(n, s) { return ui.icon ? ui.icon(n, s) : h('span'); }
  function weekStart() { return Number(settings().weekStart) === 0 ? 0 : 1; }
  function wsOf(ymd) { return U.startOfWeek(ymd, weekStart()); }
  function weekDays(ws) { var out = []; for (var i = 0; i < 7; i++) out.push(U.addDays(ws, i)); return out; }
  function weekdayOrder() { var w = weekStart(), out = []; for (var i = 0; i < 7; i++) out.push((w + i) % 7); return out; }
  function WD(n) { return ((DA.C && DA.C.WEEKDAYS) || ['일', '월', '화', '수', '목', '금', '토'])[n]; }
  function kindLabel(k) { return ((DA.C && DA.C.KIND) || KIND_LABEL)[k] || KIND_LABEL[k] || '수업'; }
  function stLabel(s) { return (DA.actions && DA.actions.statusLabel) ? DA.actions.statusLabel(s) : ((DA.C && DA.C.STATUS) || {})[s] || s; }
  function hm(min) { return U.min2hm(min); }
  function startMin(o) { return o.startMin != null ? o.startMin : U.hm2min(o.start); }
  function endMin(o) { return o.endMin != null ? o.endMin : startMin(o) + (+o.duration || 0); }
  function studentName(id) {
    var s = DA.store.get('students', id);
    return s ? s.name : '(삭제된 수강생)';
  }
  function hexRgba(hex, a) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    var x = m[1];
    if (x.length === 3) x = x.charAt(0) + x.charAt(0) + x.charAt(1) + x.charAt(1) + x.charAt(2) + x.charAt(2);
    var n = parseInt(x, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function sameSet(a, b) {
    a = (a || []).slice().sort(); b = (b || []).slice().sort();
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function isNarrow() { return (window.innerWidth || 1024) < 720; }
  function fmtShort(ymd) { var d = U.parseYmd(ymd); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; }
  function weekLabel(ws) {
    var we = U.addDays(ws, 6);
    var a = U.parseYmd(ws), b = U.parseYmd(we);
    var yr = a.getFullYear() !== new Date().getFullYear() ? a.getFullYear() + '년 ' : '';
    if (a.getMonth() === b.getMonth()) return yr + (a.getMonth() + 1) + '월 ' + a.getDate() + '일 – ' + b.getDate() + '일';
    return yr + fmtShort(ws) + ' – ' + fmtShort(we);
  }
  function occTime(o) { return U.fmtTime(o.start) + '–' + U.fmtTime(o.end || hm(endMin(o))); }

  function init() {
    if (!st.mode) {
      var m = lsGet(LS_MODE);
      st.mode = (m === 'week' || m === 'day') ? m : (isNarrow() ? 'day' : 'week');
    }
    if (!st.colorBy) st.colorBy = lsGet(LS_COLOR) === 'course' ? 'course' : 'teacher';
    if (!st.date || !U.isYmd(st.date)) st.date = today();
    // 지워진 강사·방 필터 정리
    var s = settings();
    if (st.teacher && !(s.teachers || []).some(function (t) { return t.id === st.teacher; })) st.teacher = '';
    if (st.room && !(s.rooms || []).some(function (r) { return r.id === st.room; })) st.room = '';
  }

  function blockColor(occ, expected) {
    if (st.colorBy === 'course') {
      for (var i = 0; i < expected.length; i++) {
        var s = DA.store.get('students', expected[i]);
        if (s && s.courseId) return ui.courseColor(s.courseId);
      }
      var ids = occ.studentIds || [];
      for (var j = 0; j < ids.length; j++) {
        var s2 = DA.store.get('students', ids[j]);
        if (s2 && s2.courseId) return ui.courseColor(s2.courseId);
      }
      return '#A8A29E';
    }
    return occ.teacherId ? ui.teacherColor(occ.teacherId) : '#A8A29E';
  }

  function passFilter(occ) {
    if (st.teacher && (occ.teacherId || '') !== st.teacher) return false;
    if (st.room && (occ.roomId || '') !== st.room) return false;
    return true;
  }

  // 회차별 표시할 학생: 그날 기대 대상 + 기록만 있는 학생(명단에서 빠진 뒤 기록 등)
  function occStudents(d, occ, recsByOcc) {
    var ids = [];
    try { ids = SC.expectedStudents(d, occ).slice(); } catch (e) { ids = (occ.studentIds || []).slice(); }
    var recs = recsByOcc.get(occ.key);
    if (recs) recs.forEach(function (r) { if (ids.indexOf(r.studentId) < 0) ids.push(r.studentId); });
    return ids;
  }
  function statusOf(d, occ, sid, now) {
    try { return SC.effectiveStatus(d, occ, sid, now) || { status: 'upcoming', record: null, auto: false }; } catch (e) {
      logErr(e, 'tt.effectiveStatus'); return { status: 'upcoming', record: null, auto: false };
    }
  }

  // 겹치는 블록 나란히 배치
  function layoutDay(list) {
    var items = list.slice().sort(function (a, b) { return startMin(a) - startMin(b) || endMin(b) - endMin(a); });
    var out = [], cluster = null, clusterEnd = -1;
    function closeCluster() { if (cluster) cluster.items.forEach(function (it) { it.n = cluster.cols.length; }); }
    items.forEach(function (o) {
      var s = startMin(o), e = Math.max(endMin(o), s + 15);
      if (!cluster || s >= clusterEnd) { closeCluster(); cluster = { items: [], cols: [] }; clusterEnd = e; } else clusterEnd = Math.max(clusterEnd, e);
      var c = 0;
      while (c < cluster.cols.length && cluster.cols[c] > s) c++;
      cluster.cols[c] = e;
      var it = { occ: o, col: c, n: 1, span: 1 };
      cluster.items.push(it); out.push(it);
    });
    closeCluster();
    // 오른쪽 칸이 비어 있으면 넓혀 쓰기
    out.forEach(function (it) {
      var s = startMin(it.occ), e = Math.max(endMin(it.occ), s + 15);
      for (var c = it.col + 1; c < it.n; c++) {
        var blocked = out.some(function (o2) {
          if (o2 === it || o2.col !== c || o2.n !== it.n) return false;
          var s2 = startMin(o2.occ), e2 = Math.max(endMin(o2.occ), s2 + 15);
          return s < e2 && s2 < e;
        });
        if (blocked) break;
        it.span++;
      }
    });
    return out;
  }

  function timeRange(occs) {
    var s = settings();
    var slot = U.clamp(+s.slotMinutes || 30, 5, 120);
    var open = U.isHm && U.isHm(s.openTime) ? U.hm2min(s.openTime) : 600;
    var close = U.isHm && U.isHm(s.closeTime) ? U.hm2min(s.closeTime) : 1320;
    if (!(close > open)) { open = 600; close = 1320; }
    occs.forEach(function (o) { open = Math.min(open, startMin(o)); close = Math.max(close, endMin(o)); });
    open = Math.max(0, Math.floor(open / slot) * slot);
    close = Math.min(24 * 60, Math.ceil(close / slot) * slot);
    if (close <= open) close = open + slot;
    return { open: open, close: close, slot: slot };
  }

  // 이름 칩이 몇 개 들어가는지(넘치면 '+n')
  function chipCapacity(names, blockH, blockW, mode, hasTitle) {
    var headH = mode === 'day' ? 24 : 17, titleH = hasTitle ? (mode === 'day' ? 20 : 15) : 0;
    var chipH = mode === 'day' ? 36 : 22, gap = mode === 'day' ? 4 : 2;
    var rows = Math.floor((blockH - 8 - headH - titleH + gap) / (chipH + gap));
    if (rows < 1) return 0;
    if (mode !== 'day' || !blockW) return rows;
    var usable = blockW - 12, row = 1, x = 0, fit = 0;
    for (var i = 0; i < names.length; i++) {
      var w = 40 + Math.min(8, names[i].length) * 15;
      if (x && x + w > usable) { row++; x = 0; }
      if (row > rows) break;
      x += w + gap; fit++;
    }
    if (fit < names.length && fit > 0) fit--;       // '+n' 자리
    return Math.max(fit, 1);
  }

  /* ================================================================
   * 화면 그리기
   * ================================================================ */
  function render(container, params) {
    init();
    handleQuery(params);
    var d = data();
    var s = settings();
    var now = new Date();
    var t = today();
    var mode = st.mode;
    var ws = wsOf(st.date);
    var days = mode === 'week' ? weekDays(ws) : [st.date];
    var weekList = weekDays(ws);

    var weekOccs = [];
    try { weekOccs = SC.occurrencesBetween(d, weekList[0], weekList[6]) || []; } catch (e) { logErr(e, 'tt.occurrencesBetween'); }
    var visible = weekOccs.filter(function (o) { return days.indexOf(o.date) >= 0 && passFilter(o); });
    var byDate = {};
    days.forEach(function (x) { byDate[x] = []; });
    visible.forEach(function (o) { byDate[o.date].push(o); });

    var recsByOcc = new Map();
    (d.attendance || []).forEach(function (r) {
      if (!r || r.date < days[0] || r.date > days[days.length - 1]) return;
      var k = r.date + '|' + r.srcId;
      var l = recsByOcc.get(k); if (!l) recsByOcc.set(k, l = []);
      l.push(r);
    });

    var closed = {};
    (s.closedDays || []).forEach(function (x) { closed[x] = true; });
    var range = timeRange(visible);
    var px = PX[mode];

    refs = { container: container, now: null, nowTag: null, scroller: null, range: range, px: px, days: days, grid: null };

    container.classList.add('v-tt');
    container.appendChild(topbar(ws, weekOccs, t, closed));

    var page = h('div', { class: 'page wide tt-page' });
    container.appendChild(page);

    // 빈 상태·필터 안내
    var noLessons = !(d.lessons || []).length && !(d.exceptions || []).some(function (e) { return e.type === 'extra'; });
    if (noLessons) page.appendChild(emptyCard());
    var fchips = filterChips();
    if (fchips) page.appendChild(fchips);
    if (!noLessons && !visible.length) {
      page.appendChild(h('div', { class: 'tt-note' }, ic('info', 16),
        h('span', null, (st.teacher || st.room) ? '고른 조건에 맞는 수업이 ' + (mode === 'week' ? '이 주에' : '이 날에') + ' 없어요.' :
          (mode === 'week' ? '이 주에는 수업이 없어요. 빈 칸을 눌러 수업을 추가할 수 있어요.' : '이 날은 수업이 없어요. 빈 칸을 눌러 수업을 추가할 수 있어요.'))));
    }
    var legend = legendRow(visible);
    if (legend) page.appendChild(legend);

    // 격자
    var viewW = innerWidthOf(container);
    var colW = mode === 'week' ? Math.max(COL_MIN, (viewW - TIME_W - 2) / 7) : Math.max(120, viewW - TIME_W - 2);
    var totalH = Math.round((range.close - range.open) * px);
    var grid = h('div', {
      class: 'tt-grid tt-' + mode,
      style: {
        gridTemplateColumns: TIME_W + 'px repeat(' + days.length + ', minmax(' + (mode === 'week' ? COL_MIN : 0) + 'px, 1fr))',
        minWidth: mode === 'week' ? (TIME_W + COL_MIN * 7) + 'px' : '0',
        '--slot-px': (range.slot * px) + 'px',
        '--grid-h': totalH + 'px'
      }
    });
    refs.grid = grid;
    grid.appendChild(h('div', { class: 'tt-corner' }));
    days.forEach(function (day) { grid.appendChild(dayHead(day, byDate[day], t, closed[day], mode)); });
    grid.appendChild(timeColumn(range, px));
    days.forEach(function (day) {
      grid.appendChild(dayColumn(d, day, byDate[day], {
        now: now, today: t, px: px, range: range, mode: mode, colW: colW, closed: !!closed[day], recsByOcc: recsByOcc
      }));
    });

    var scroller = h('div', { class: 'tt-scroll', attrs: { tabindex: '-1' } }, grid);
    refs.scroller = scroller;
    page.appendChild(h('div', { class: 'tt-card' }, scroller));

    // 현재 시각 선
    placeNowLine();

    // 크기·스크롤
    fitHeight();
    restoreScroll(visible, t, days);
    scroller.addEventListener('scroll', function () {
      st.scroll.top = scroller.scrollTop; st.scroll.left = scroller.scrollLeft;
    }, { passive: true });

    function onResize() {
      if (!refs || refs.scroller !== scroller) return;
      fitHeight();
    }
    function onTick() {
      if (!refs || refs.scroller !== scroller) return;
      st.ticks++;
      placeNowLine();
      // 서명 대기·예정 상태가 바뀌므로 오늘이 보이면 5분마다 새로 그림
      if (st.ticks % 5 === 0 && days.indexOf(today()) >= 0 && !(DA.actions && DA.actions.isSigning && DA.actions.isSigning())) ui.refresh();
    }
    function onDay(e) {
      var det = (e && e.detail) || {};
      if (det.from && st.date === det.from && det.to) st.date = det.to;
      ui.refresh();
    }
    function onKey(e) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (ui.sheetCount && ui.sheetCount()) return;
      var tg = e.target && e.target.tagName;
      if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); goToday(); }
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.addEventListener('da:tick', onTick);
    window.addEventListener('da:daychange', onDay);
    document.addEventListener('keydown', onKey);
    return function cleanup() {
      st.scroll.top = scroller.scrollTop; st.scroll.left = scroller.scrollLeft;
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.removeEventListener('da:tick', onTick);
      window.removeEventListener('da:daychange', onDay);
      document.removeEventListener('keydown', onKey);
      if (refs && refs.scroller === scroller) refs = null;
    };
  }

  function innerWidthOf(container) {
    var w = container.clientWidth || window.innerWidth || 360;
    try {
      var cs = window.getComputedStyle(container);
      w -= (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    } catch (e) { /* 무시 */ }
    return Math.max(280, w - (w < 720 ? 16 : 32) - 2);
  }

  /* ---------------- 상단 막대 ---------------- */
  function topbar(ws, weekOccs, t, closed) {
    var mode = st.mode;
    var filtered = !!(st.teacher || st.room);
    var seg = ui.segmented([{ value: 'day', label: '일간' }, { value: 'week', label: '주간' }], mode, function (v) {
      st.mode = v; lsSet(LS_MODE, v); ui.refresh();
    });
    seg.classList.add('tt-mode');
    var row1 = h('div', { class: 'topbar-row' },
      h('h1', { class: 'topbar-title' }, '시간표'),
      h('div', { class: 'topbar-actions' },
        h('button', {
          class: 'btn btn-icon tt-filter-btn' + (filtered ? ' on' : ''), type: 'button',
          attrs: { 'aria-label': '강사·방 필터와 블록 색' + (filtered ? ' (필터 적용 중)' : '') },
          onClick: openFilterSheet
        }, ic('filter', 22), filtered ? h('span', { class: 'tt-dot' }) : null),
        seg,
        h('button', { class: 'btn btn-primary btn-sm tt-add', type: 'button', onClick: function () { TT.editLesson(null, newPreset()); } },
          ic('plus', 18), h('span', null, '수업'))));

    var isCur = mode === 'week' ? ws === wsOf(t) : st.date === t;
    var label = mode === 'week' ? weekLabel(ws) : U.fmtDate(st.date, { weekday: true, year: 'auto' });
    var rel = mode === 'day' && U.relDay ? U.relDay(st.date) : '';
    var row2 = h('div', { class: 'topbar-row tt-nav' },
      h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': mode === 'week' ? '지난 주' : '전날' }, onClick: function () { move(-1); } }, ic('chevL', 22)),
      h('button', { class: 'tt-label', type: 'button', attrs: { 'aria-label': label + ' — 날짜 고르기' }, onClick: pickDate },
        h('span', { class: 'tt-label-main' }, label),
        rel ? h('span', { class: 'tt-rel' }, rel) : (mode === 'week' && ws === wsOf(t) ? h('span', { class: 'tt-rel' }, '이번 주') : null)),
      h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': mode === 'week' ? '다음 주' : '다음 날' }, onClick: function () { move(1); } }, ic('chevR', 22)),
      h('button', { class: 'btn btn-sm tt-today' + (isCur ? ' is-cur' : ''), type: 'button', onClick: goToday }, mode === 'week' ? '이번 주' : '오늘'));

    var bar = h('header', { class: 'topbar tt-topbar' }, row1, row2);
    if (mode === 'day') bar.appendChild(weekStrip(ws, weekOccs, t, closed));
    return bar;
  }

  function weekStrip(ws, weekOccs, t, closed) {
    var counts = {};
    weekOccs.forEach(function (o) { if (!o.canceled && passFilter(o)) counts[o.date] = (counts[o.date] || 0) + 1; });
    var strip = h('div', { class: 'full tt-strip', attrs: { role: 'tablist', 'aria-label': '요일 고르기' } });
    weekDays(ws).forEach(function (day) {
      var dd = U.parseYmd(day);
      var n = counts[day] || 0;
      var on = day === st.date;
      strip.appendChild(h('button', {
        class: ['tt-sday', on ? 'on' : '', day === t ? 'is-today' : '', closed[day] ? 'is-closed' : '', dd.getDay() === 0 ? 'sun' : '', dd.getDay() === 6 ? 'sat' : ''],
        type: 'button', attrs: { role: 'tab', 'aria-selected': on ? 'true' : 'false', 'aria-label': U.fmtDate(day) + (closed[day] ? ' 휴원' : ' 수업 ' + n + '개') },
        onClick: function () { if (st.date !== day) { st.date = day; ui.haptic('select'); ui.refresh(); } }
      },
        h('span', { class: 'tt-sday-w' }, WD(dd.getDay())),
        h('span', { class: 'tt-sday-d' }, String(dd.getDate())),
        h('span', { class: 'tt-sday-n' }, closed[day] ? '휴원' : (n ? n + '개' : '–'))));
    });
    return strip;
  }

  function move(dir) {
    st.date = U.addDays(st.date, st.mode === 'week' ? dir * 7 : dir);
    ui.haptic('light');
    ui.refresh();
  }
  function goToday() {
    var t = today();
    if (st.date === t) { scrollToNow(); return; }
    st.date = t; ui.refresh();
  }
  function pickDate() {
    ui.promptText({ title: '날짜로 이동', label: '날짜', type: 'date', value: st.date, ok: '이동' }).then(function (v) {
      if (v && U.isYmd(v)) { st.date = v; ui.refresh(); }
    });
  }
  function newPreset() {
    var p = { teacherId: st.teacher || '', roomId: st.room || '' };
    if (st.mode === 'day') { p.date = st.date; p.weekday = U.weekday(st.date); }
    return p;
  }

  /* ---------------- 빈 상태 · 필터 표시 · 범례 ---------------- */
  function emptyCard() {
    var d = data();
    var hasStudents = (d.students || []).length > 0;
    var btns = h('div', { class: 'btn-row tt-empty-actions' },
      h('button', { class: 'btn btn-primary', type: 'button', onClick: function () { TT.editLesson(null, newPreset()); } }, ic('plus', 18), '수업 추가'),
      !hasStudents ? h('button', { class: 'btn', type: 'button', onClick: function () { ui.go('#/students'); } }, ic('user-plus', 18), '수강생 먼저 등록') : null,
      !hasStudents && DA.demo && DA.demo.load ? h('button', {
        class: 'btn btn-ghost', type: 'button', onClick: function (e) {
          var b = e.currentTarget; b.disabled = true;
          DA.demo.load(new Date()).then(function () { ui.toast('예시 데이터를 불러왔어요', { kind: 'ok' }); }, function (err) {
            b.disabled = false; ui.toast('예시 데이터를 불러오지 못했어요: ' + (err && err.message || err), { kind: 'error' });
          });
        }
      }, ic('sparkle', 18), '예시 데이터로 둘러보기') : null);
    return h('div', { class: 'card tt-empty' },
      ui.empty('calendar', '아직 등록된 수업이 없어요',
        hasStudents ? '빈 칸을 누르거나 [수업 추가]로 매주 반복되는 레슨을 만들어 보세요. 여러 요일을 한 번에 만들 수 있어요.'
          : '수강생을 먼저 등록해 두면 수업에 바로 넣을 수 있어요. 빈 칸을 눌러도 수업을 만들 수 있어요.'),
      btns);
  }

  function filterChips() {
    if (!st.teacher && !st.room) return null;
    var row = h('div', { class: 'chips tt-fchips' });
    if (st.teacher) row.appendChild(h('button', {
      class: 'chip on', type: 'button', attrs: { 'aria-label': '강사 필터 해제' },
      onClick: function () { st.teacher = ''; ui.refresh(); }
    }, h('span', { class: 'swatch', style: { background: ui.teacherColor(st.teacher) } }), ui.nameOf('teacher', st.teacher), ic('x', 16)));
    if (st.room) row.appendChild(h('button', {
      class: 'chip on', type: 'button', attrs: { 'aria-label': '방 필터 해제' },
      onClick: function () { st.room = ''; ui.refresh(); }
    }, ic('door', 16), ui.nameOf('room', st.room), ic('x', 16)));
    return row;
  }

  function legendRow(visible) {
    var s = settings();
    var items = [];
    if (st.colorBy === 'course') {
      var used = {};
      visible.forEach(function (o) {
        (o.studentIds || []).forEach(function (sid) { var x = DA.store.get('students', sid); if (x && x.courseId) used[x.courseId] = true; });
      });
      (s.courses || []).forEach(function (c) { if (used[c.id]) items.push({ name: c.name, color: ui.courseColor(c.id) }); });
    } else {
      var usedT = {};
      visible.forEach(function (o) { if (o.teacherId) usedT[o.teacherId] = true; });
      (s.teachers || []).forEach(function (x) { if (usedT[x.id]) items.push({ name: x.name, color: ui.teacherColor(x.id) }); });
    }
    if (items.length < 2) return null;
    return h('div', { class: 'tt-legend hscroll', attrs: { 'aria-label': st.colorBy === 'course' ? '과정 색' : '강사 색' } },
      items.map(function (it) { return h('span', { class: 'tt-leg' }, h('i', { style: { background: it.color } }), it.name); }),
      h('button', { class: 'tt-leg tt-leg-btn', type: 'button', onClick: openFilterSheet }, st.colorBy === 'course' ? '과정 색' : '강사 색', ic('chevD', 14)));
  }

  function openFilterSheet() {
    var s = settings();
    var wrap = h('div', { class: 'tt-fsheet' });
    function paint() {
      ui.clear(wrap);
      var tChips = h('div', { class: 'chips' },
        h('button', { class: 'chip' + (!st.teacher ? ' on' : ''), type: 'button', onClick: function () { st.teacher = ''; apply(); } }, '전체'));
      (s.teachers || []).forEach(function (x) {
        tChips.appendChild(h('button', { class: 'chip' + (st.teacher === x.id ? ' on' : ''), type: 'button', onClick: function () { st.teacher = st.teacher === x.id ? '' : x.id; apply(); } },
          h('span', { class: 'swatch', style: { background: ui.teacherColor(x.id) } }), x.name));
      });
      var rChips = h('div', { class: 'chips' },
        h('button', { class: 'chip' + (!st.room ? ' on' : ''), type: 'button', onClick: function () { st.room = ''; apply(); } }, '전체'));
      (s.rooms || []).forEach(function (x) {
        rChips.appendChild(h('button', { class: 'chip' + (st.room === x.id ? ' on' : ''), type: 'button', onClick: function () { st.room = st.room === x.id ? '' : x.id; apply(); } }, x.name));
      });
      var colorSeg = ui.segmented([{ value: 'teacher', label: '강사 색' }, { value: 'course', label: '과정 색' }], st.colorBy, function (v) {
        st.colorBy = v; lsSet(LS_COLOR, v); apply();
      });
      colorSeg.classList.add('full');
      wrap.appendChild(h('div', { class: 'section-title' }, '강사'));
      wrap.appendChild(tChips);
      if ((s.rooms || []).length) {
        wrap.appendChild(h('div', { class: 'section-title' }, '방'));
        wrap.appendChild(rChips);
      }
      wrap.appendChild(h('div', { class: 'section-title' }, '블록 색'));
      wrap.appendChild(colorSeg);
      wrap.appendChild(h('p', { class: 'small muted tt-fhint' }, st.colorBy === 'course' ? '수업 학생의 과정 색으로 칠해요.' : '담당 강사 색으로 칠해요. 색은 설정 → 강사에서 바꿀 수 있어요.'));
    }
    function apply() { ui.haptic('select'); paint(); ui.refresh(); }
    paint();
    ui.sheet({
      title: '보기 설정', className: 'tt-sheet', autofocus: false, content: wrap,
      actions: [{ label: '초기화', kind: 'ghost', onClick: function () { st.teacher = ''; st.room = ''; ui.refresh(); } }, { label: '완료', kind: 'primary' }]
    });
  }

  /* ---------------- 격자 부품 ---------------- */
  function dayHead(day, list, t, isClosed, mode) {
    var dd = U.parseYmd(day);
    var n = list.filter(function (o) { return !o.canceled; }).length;
    var cls = ['tt-dh', day === t ? 'is-today' : '', day < t ? 'is-past' : '', isClosed ? 'is-closed' : '', dd.getDay() === 0 ? 'sun' : '', dd.getDay() === 6 ? 'sat' : ''];
    if (mode === 'day') {
      return h('div', { class: cls },
        h('span', { class: 'tt-dh-w' }, U.fmtDate(day, { weekday: true })),
        h('span', { class: 'tt-dh-n' }, isClosed ? '휴원' : (n ? '수업 ' + n + '개' : '수업 없음')));
    }
    return h('button', {
      class: cls, type: 'button', attrs: { 'aria-label': U.fmtDate(day) + ' 일간으로 보기' },
      onClick: function () { st.date = day; st.mode = 'day'; ui.haptic('select'); ui.refresh(); }
    },
      h('span', { class: 'tt-dh-w' }, WD(dd.getDay())),
      h('span', { class: 'tt-dh-d' }, String(dd.getDate())),
      h('span', { class: 'tt-dh-n' }, isClosed ? '휴원' : (n ? n + '개' : '')));
  }

  function timeColumn(range, px) {
    var col = h('div', { class: 'tt-times', style: { height: Math.round((range.close - range.open) * px) + 'px' } });
    for (var m = range.open; m < range.close; m += range.slot) {
      var onHour = m % 60 === 0;
      if (!onHour && range.slot * px < 26) continue;
      col.appendChild(h('div', { class: 'tt-tl' + (onHour ? ' hr' : ''), style: { top: Math.round((m - range.open) * px) + 'px' } },
        onHour ? hm(m) : ':' + U.pad2(m % 60)));
    }
    var tag = h('div', { class: 'tt-now-tag', attrs: { 'aria-hidden': 'true' } });
    col.appendChild(tag);
    refs.nowTag = tag;
    return col;
  }

  function dayColumn(d, day, list, ctx) {
    var col = h('div', {
      class: ['tt-col', day === ctx.today ? 'is-today' : '', day < ctx.today ? 'is-past' : '', ctx.closed ? 'is-closed' : ''],
      dataset: { date: day },
      style: { height: Math.round((ctx.range.close - ctx.range.open) * ctx.px) + 'px' },
      attrs: { 'aria-label': U.fmtDate(day) + ' 시간표' }
    });
    if (ctx.closed) col.appendChild(h('div', { class: 'tt-closed-tag' }, '휴원'));
    col.addEventListener('click', function (e) {
      if (e.target !== col && !(e.target.classList && e.target.classList.contains('tt-closed-tag'))) return;
      var rect = col.getBoundingClientRect();
      var y = e.clientY - rect.top;
      var slot = ctx.range.slot;
      var m = ctx.range.open + Math.floor(y / ctx.px / slot) * slot;
      m = U.clamp(m, ctx.range.open, ctx.range.close - slot);
      flashGhost(col, m, ctx);
      ui.haptic('light');
      TT.editLesson(null, { weekday: U.weekday(day), start: hm(m), date: day, teacherId: st.teacher || '', roomId: st.room || '' });
    });
    if (day === ctx.today) {
      var line = h('div', { class: 'tt-now', attrs: { 'aria-hidden': 'true' } });
      col.appendChild(line);
      refs.now = line;
    }
    layoutDay(list).forEach(function (it) { col.appendChild(blockEl(d, it, ctx)); });
    return col;
  }

  function flashGhost(col, m, ctx) {
    var g = h('div', { class: 'tt-ghost', style: { top: Math.round((m - ctx.range.open) * ctx.px) + 'px', height: Math.round(ctx.range.slot * ctx.px) + 'px' } },
      ic('plus', 14), hm(m));
    col.appendChild(g);
    setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 700);
  }

  function blockEl(d, it, ctx) {
    var occ = it.occ, mode = ctx.mode;
    var ids = occStudents(d, occ, ctx.recsByOcc);
    var names = ids.map(studentName);
    var color = blockColor(occ, ids);
    var top = Math.round((startMin(occ) - ctx.range.open) * ctx.px);
    var ht = Math.max(mode === 'day' ? 40 : 28, Math.round((+occ.duration || 0) * ctx.px) - 2);
    var leftPct = it.col / it.n * 100, wPct = it.span / it.n * 100;
    var blockW = ctx.colW * it.span / it.n - 4;
    var isExtra = occ.srcType === 'extra';
    var tname = occ.teacherId ? ui.nameOf('teacher', occ.teacherId) : '';
    var rname = occ.roomId ? ui.nameOf('room', occ.roomId) : '';

    var blk = h('div', {
      class: ['tt-blk', occ.canceled ? 'is-canceled' : '', isExtra ? 'is-extra k-' + occ.kind : '', it.n > 1 ? 'is-split' : '', ht < 44 ? 'is-short' : ''],
      style: {
        top: top + 'px', height: ht + 'px',
        left: 'calc(' + leftPct + '% + 2px)', width: 'calc(' + wPct + '% - 4px)',
        '--c': color, '--c-soft': hexRgba(color, 0.15) || 'var(--surface-2)', '--c-line': hexRgba(color, 0.55) || color
      },
      attrs: {
        role: 'button', tabindex: '0',
        'aria-label': occTime(occ) + ' ' + (occ.title || names.join(', ') || '수업') + (occ.canceled ? ' 휴강' : '') + ' — 수업 열기',
        title: occTime(occ) + (occ.title ? ' ' + occ.title : '') + (tname ? ' · ' + tname : '') + (rname ? ' · ' + rname : '') + (occ.canceled ? ' · 휴강' + (occ.cancelReason ? '(' + occ.cancelReason + ')' : '') : '')
      }
    });
    blk.addEventListener('click', function () { TT.openOccurrence(occ); });
    blk.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === blk) { e.preventDefault(); TT.openOccurrence(occ); }
    });

    // 머리: 시각 · 종류 · 방
    var head = h('div', { class: 'tt-bh' },
      h('span', { class: 'tt-bt' }, mode === 'day' ? occTime(occ) : U.fmtTime(occ.start)),
      isExtra ? h('span', { class: 'tt-kind' }, kindLabel(occ.kind)) : null,
      occ.canceled ? h('span', { class: 'tt-cx' }, occ.closedDay ? '휴원' : '휴강') : null,
      mode === 'day' && tname ? h('span', { class: 'tt-meta' }, tname) : null,
      rname ? h('span', { class: 'tt-meta tt-room' }, rname) : null);
    blk.appendChild(head);
    if (occ.title) blk.appendChild(h('div', { class: 'tt-btitle' }, occ.title));

    var cap = chipCapacity(names, ht, blockW, mode, !!occ.title);
    if (!ids.length) {
      if (ht >= 44) blk.appendChild(h('div', { class: 'tt-bempty' }, '학생 없음'));
      return blk;
    }
    if (cap <= 0) {
      head.appendChild(h('span', { class: 'tt-bnames' }, names.length > 1 ? names[0] + ' 외 ' + (names.length - 1) : names[0]));
      return blk;
    }
    var box = h('div', { class: 'tt-names' });
    var show = Math.min(names.length, cap);
    for (var i = 0; i < show; i++) box.appendChild(nameChip(d, occ, ids[i], names[i], ctx.now));
    if (ids.length > show) {
      var more = h('button', {
        class: 'tt-more', type: 'button', attrs: { 'aria-label': '나머지 ' + (ids.length - show) + '명 보기' },
        onClick: function (e) { e.stopPropagation(); TT.openOccurrence(occ); }
      }, '+' + (ids.length - show));
      // 주간: 머리 줄 오른쪽에(칩 줄을 하나라도 더 쓰도록), 일간: 칩 뒤에
      if (mode === 'day') box.appendChild(more);
      else { more.classList.add('in-head'); head.insertBefore(more, head.querySelector('.tt-room')); }
    }
    blk.appendChild(box);
    return blk;
  }

  function nameChip(d, occ, sid, name, now) {
    var eff = statusOf(d, occ, sid, now);
    var status = eff.status;
    var exists = !!DA.store.get('students', sid);
    var sigTime = eff.record && eff.record.signedAt && U.hmOf ? U.hmOf(U.toDate(eff.record.signedAt)) : '';
    var b = h('button', {
      class: ['tt-name', 'st-' + status, eff.auto ? 'auto' : ''], type: 'button', disabled: !exists,
      attrs: {
        'aria-label': name + ' ' + stLabel(status) + (eff.auto ? '(자동)' : '') + (exists ? ' — 눌러서 서명 출석' : ''),
        title: name + ' · ' + stLabel(status) + (eff.auto ? '(기록 없음)' : '') + (sigTime ? ' · ' + sigTime + ' 서명' : '')
      }
    }, h('span', { class: 'tt-mk', attrs: { 'aria-hidden': 'true' } }, MARK[status] || '·'), h('span', { class: 'tt-nm' }, name));
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!DA.actions || !DA.actions.sign) return;
      ui.haptic('light');
      DA.actions.sign(occ, sid, { date: occ.date, confirmOtherDay: true });
    });
    b.addEventListener('contextmenu', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (DA.actions && DA.actions.menu) DA.actions.menu(occ, sid, { date: occ.date });
    });
    return b;
  }

  /* ---------------- 현재 시각 · 크기 · 스크롤 ---------------- */
  function nowMinutes() { var n = new Date(); return n.getHours() * 60 + n.getMinutes(); }
  function placeNowLine() {
    if (!refs) return;
    var m = nowMinutes(), r = refs.range;
    var show = refs.now && m >= r.open && m <= r.close && refs.days.indexOf(today()) >= 0;
    var y = Math.round((m - r.open) * refs.px);
    if (refs.now) { refs.now.style.display = show ? '' : 'none'; refs.now.style.top = y + 'px'; }
    if (refs.nowTag) {
      refs.nowTag.style.display = show ? '' : 'none';
      refs.nowTag.style.top = y + 'px';
      refs.nowTag.textContent = hm(m);
    }
  }

  function fitHeight() {
    if (!refs || !refs.scroller) return;
    var sc = refs.scroller;
    var bar = refs.container.querySelector('.topbar');
    var barH = bar ? bar.offsetHeight : 0;
    var tab = document.getElementById('tabbar');
    var wide = (window.innerWidth || 0) >= 900;
    var bottom = wide || !tab ? 12 : tab.offsetHeight + 8;
    var headH = 52;
    var content = Math.round((refs.range.close - refs.range.open) * refs.px) + headH + 2;
    var avail = (window.innerHeight || 700) - barH - bottom - (isNarrow() ? 16 : 32);
    sc.style.height = Math.max(Math.min(320, content), Math.min(content, avail)) + 'px';
  }

  function restoreScroll(visible, t, days) {
    var sc = refs.scroller;
    var key = st.mode + '|' + (st.mode === 'week' ? wsOf(st.date) : st.date) + '|' + refs.range.open + '|' + refs.px + '|' + st.teacher + '|' + st.room;
    if (st.scroll.key === key) {
      sc.scrollTop = st.scroll.top; sc.scrollLeft = st.scroll.left;
      return;
    }
    st.scroll.key = key;
    var target;
    var todayIn = days.indexOf(t) >= 0;
    var live = visible.filter(function (o) { return !o.canceled; });
    var nm = nowMinutes();
    // 오늘이 보이고 운영 시간 안이면 '지금' 근처, 아니면 첫 수업부터
    if (todayIn && nm >= refs.range.open && nm <= refs.range.close) target = nm - 60;
    else if (live.length) target = Math.min.apply(null, live.map(startMin)) - 20;
    else target = refs.range.open;
    var top = Math.max(0, Math.round((target - refs.range.open) * refs.px));
    sc.scrollTop = top;
    var left = 0;
    if (st.mode === 'week' && todayIn && sc.scrollWidth > sc.clientWidth + 4) {
      var idx = days.indexOf(t);
      var colW = (sc.scrollWidth - TIME_W) / 7;
      left = Math.max(0, Math.round(idx * colW - colW * 0.5));
    }
    sc.scrollLeft = left;
    st.scroll.top = sc.scrollTop; st.scroll.left = sc.scrollLeft;
  }

  function scrollToNow() {
    if (!refs || !refs.scroller) return;
    var top = Math.max(0, Math.round((nowMinutes() - 40 - refs.range.open) * refs.px));
    try { refs.scroller.scrollTo({ top: top, behavior: 'smooth' }); } catch (e) { refs.scroller.scrollTop = top; }
  }

  /* ---------------- 라우트 질의 ---------------- */
  function handleQuery(params) {
    var q = (params && params.query) || {};
    var hash = params && params.hash;
    if (!hash || st.consumed === hash) return;
    var keys = Object.keys(q);
    if (!keys.length) return;
    st.consumed = hash;
    if (q.date && U.isYmd(q.date)) st.date = q.date;
    if (q.mode === 'day' || q.mode === 'week') st.mode = q.mode;
    var job = null;
    if (q.lesson) {
      var L = DA.store.get('lessons', q.lesson) || DA.store.get('exceptions', q.lesson);
      if (L) job = function () { TT.editLesson(L); };
    } else if (q['new'] === '1' || q['new'] === 'true' || q.student) {
      var sid = q.student && DA.store.get('students', q.student) ? q.student : '';
      job = function () { TT.editLesson(null, sid ? { studentIds: [sid], teacherId: (DA.store.get('students', sid) || {}).teacherId || '' } : newPreset()); };
    }
    // 질의를 지운 주소로 바꾼 뒤(그때 한 번 다시 그림) 편집기를 연다
    setTimeout(function () {
      try { ui.go('#/timetable', { replace: true }); } catch (e) { /* 무시 */ }
      if (job) setTimeout(job, 30);
    }, 0);
  }

  /* ================================================================
   * 수업 시트
   * ================================================================ */
  TT.openOccurrence = function (occ0) {
    if (!occ0) return null;
    var occ = occ0;
    var wrap = h('div', { class: 'tt-occ' });
    var sh = null, timer = null, closed = false;
    function current() {
      try { return SC.occurrence(data(), occ0.date, occ0.srcId); } catch (e) { return null; }
    }
    function repaint() {
      ui.clear(wrap);
      try { wrap.appendChild(occBody(occ, sh)); } catch (e) {
        logErr(e, 'tt.occBody');
        wrap.appendChild(ui.banner('error', '수업 정보를 그리지 못했어요.'));
      }
      if (sh) sh.setTitle(occTitle(occ));
    }
    function onChange() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (closed) return;
        var o = current();
        if (!o) { if (sh) sh.close(); return; }
        occ = o; repaint();
      }, 60);
    }
    repaint();
    sh = ui.sheet({
      title: occTitle(occ), className: 'tt-sheet', autofocus: false, content: wrap,
      onClose: function () { closed = true; clearTimeout(timer); DA.store.off('change', onChange); }
    });
    DA.store.on('change', onChange);
    return sh;
  };

  function occTitle(occ) {
    var label = '수업';
    try { label = SC.lessonLabel(data(), occ); } catch (e) { /* 무시 */ }
    return label;
  }

  function occBody(occ, sh) {
    var d = data();
    var now = new Date();
    var t = today();
    var isExtra = occ.srcType === 'extra';
    var lesson = !isExtra ? DA.store.get('lessons', occ.lessonId || occ.srcId) : null;
    var ex = isExtra ? DA.store.get('exceptions', occ.exceptionId || occ.srcId) : null;
    var out = h('div');

    // 정보 줄
    var tcolor = occ.teacherId ? ui.teacherColor(occ.teacherId) : null;
    out.appendChild(h('div', { class: 'tt-occ-meta' },
      h('span', { class: 'meta-chip' + (occ.date === t ? ' accent' : '') }, ic('calendar', 15), U.fmtDate(occ.date) + (occ.date === t ? ' · 오늘' : '')),
      h('span', { class: 'meta-chip' }, ic('clock', 15), occTime(occ) + ' (' + (U.fmtDuration ? U.fmtDuration(+occ.duration || 0) : occ.duration + '분') + ')'),
      occ.teacherId ? h('span', { class: 'meta-chip' }, h('span', { class: 'dot', style: { background: tcolor } }), ui.nameOf('teacher', occ.teacherId)) : null,
      occ.roomId ? h('span', { class: 'meta-chip' }, ic('door', 15), ui.nameOf('room', occ.roomId)) : null,
      isExtra ? ui.kindBadge(occ.kind) : (lesson ? h('span', { class: 'meta-chip' }, ic('repeat', 15), '매주 ' + WD(+lesson.weekday) + '요일') : null)));

    if (occ.canceled) {
      out.appendChild(ui.banner('warn', occ.closedDay ? '휴원일로 지정된 날이라 수업이 쉬어요. 설정 → 휴원일에서 바꿀 수 있어요.' : (occ.cancelReason && occ.cancelReason !== '휴강' ? '사유: ' + occ.cancelReason : '이 날만 휴강이에요.'), {
        title: occ.closedDay ? '휴원일' : '휴강',
        icon: 'calendar-x',
        action: occ.closedDay ? null : { label: '휴강 취소', onClick: function () { if (DA.actions && DA.actions.uncancel) DA.actions.uncancel(occ); } }
      }));
    }
    if (isExtra && occ.makeupFor && occ.makeupFor.date) {
      var srcL = DA.store.get('lessons', occ.makeupFor.srcId);
      out.appendChild(h('div', { class: 'tt-note' }, ic('repeat', 16),
        h('span', null, U.fmtDate(occ.makeupFor.date) + (srcL ? ' ' + U.fmtTime(srcL.start) : '') + ' 수업의 보강이에요.')));
    }
    var memo = (lesson && lesson.memo) || (ex && ex.memo) || '';
    if (memo) out.appendChild(h('div', { class: 'tt-note' }, ic('note', 16), h('span', null, memo)));

    // 학생 줄
    var recsByOcc = new Map();
    (d.attendance || []).forEach(function (r) {
      if (r && r.date === occ.date && r.srcId === occ.srcId) {
        var l = recsByOcc.get(occ.key); if (!l) recsByOcc.set(occ.key, l = []); l.push(r);
      }
    });
    var ids = occStudents(d, occ, recsByOcc);
    var notExpected = (occ.studentIds || []).filter(function (sid) { return ids.indexOf(sid) < 0; });
    var head = h('div', { class: 'tt-occ-sh' },
      h('span', null, '출석 현황'),
      ids.length ? h('span', { class: 'muted small' }, summaryText(d, occ, ids, now)) : null);
    out.appendChild(head);

    if (!ids.length) {
      out.appendChild(h('div', { class: 'card tt-occ-empty' }, ui.empty('users', '이 수업에 학생이 없어요',
        notExpected.length ? '명단의 학생이 이 날짜에 휴원·퇴원 상태예요.' : '수업 편집에서 학생을 넣어 주세요.',
        (lesson || ex) ? { label: '학생 넣기', icon: 'user-plus', onClick: function () { TT.editLesson(lesson || ex); } } : null)));
    } else {
      var list = h('div', { class: 'list tt-srows' });
      var pendingIds = [];
      ids.forEach(function (sid) {
        var eff = statusOf(d, occ, sid, now);
        if (!eff.record && eff.status !== 'canceled' && occ.date <= t && DA.store.get('students', sid)) pendingIds.push(sid);
        list.appendChild(studentRow(d, occ, sid, eff));
      });
      out.appendChild(list);
      if (notExpected.length) {
        out.appendChild(h('p', { class: 'small muted tt-occ-foot' },
          notExpected.map(studentName).join(', ') + ' 학생은 이 날 휴원·퇴원 중이라 목록에서 뺐어요.'));
      }
      if (pendingIds.length >= 2 && !occ.canceled) {
        out.appendChild(h('button', {
          class: 'btn btn-soft btn-block tt-allin', type: 'button',
          onClick: function (e) { markAllPresent(occ, pendingIds, e.currentTarget); }
        }, ic('check', 18), '남은 ' + pendingIds.length + '명 모두 출석 처리'));
      }
    }

    // 동작
    var acts = h('div', { class: 'tt-acts' });
    function tile(icon, label, fn, cls) {
      acts.appendChild(h('button', { class: 'tt-act' + (cls ? ' ' + cls : ''), type: 'button', onClick: function () {
        Promise.resolve().then(fn).catch(function (err) { logErr(err, 'tt.action'); ui.toast('처리하지 못했어요: ' + (err && err.message || err), { kind: 'error' }); });
      } }, ic(icon, 22), h('span', null, label)));
    }
    if (lesson) {
      tile('edit', '수업 편집', function () { return TT.editLesson(lesson, { fromDate: occ.date }); });
      tile('calendar-x', occ.canceled ? '휴강 취소' : '이 날만 휴강', function () {
        if (occ.closedDay) { ui.toast('휴원일이에요. 설정 → 휴원일에서 바꿀 수 있어요.', { kind: 'warn' }); return; }
        return DA.actions && DA.actions.cancelOccurrence(occ);
      }, occ.canceled ? '' : 'warn');
      tile('repeat', '보강 추가', function () { return makeupFor(occ, ids); });
      tile('trash', '수업 종료/삭제', function () {
        return endOrDelete(lesson).then(function (done) { if (done && sh) sh.close(); });
      }, 'danger');
    } else if (ex) {
      tile('edit', '수정', function () { return TT.editLesson(ex); });
      tile('user-plus', '학생 추가', function () { return addStudentsToExtra(ex); });
      tile('trash', kindLabel(occ.kind) + ' 삭제', function () {
        return DA.actions && DA.actions.cancelOccurrence(occ).then(function (done) { if (done && sh) sh.close(); });
      }, 'danger');
    }
    out.appendChild(acts);
    return out;
  }

  function summaryText(d, occ, ids, now) {
    var c = { att: 0, late: 0, absent: 0, other: 0 };
    ids.forEach(function (sid) {
      var s = statusOf(d, occ, sid, now).status;
      if (s === 'present') c.att++;
      else if (s === 'late') { c.att++; c.late++; }
      else if (s === 'absent' || s === 'unmarked') c.absent++;
    });
    var parts = ['출석 ' + c.att + ' / ' + ids.length];
    if (c.late) parts.push('지각 ' + c.late);
    if (c.absent) parts.push('결석 ' + c.absent);
    return parts.join(' · ');
  }

  function studentRow(d, occ, sid, eff) {
    var s = DA.store.get('students', sid);
    var name = s ? s.name : '(삭제된 수강생)';
    var rec = eff.record;
    var sub = [];
    if (rec && rec.signedAt && rec.method === 'sign' && U.hmOf) sub.push(U.hmOf(U.toDate(rec.signedAt)) + ' 서명');
    else if (rec && rec.method === 'manual') sub.push('직접 입력');
    if (rec && rec.note) sub.push(rec.note);
    if (rec && rec.progress && (rec.progress.song || rec.progress.bpm)) sub.push('🥁 ' + [rec.progress.song, rec.progress.bpm ? rec.progress.bpm + ' BPM' : ''].filter(Boolean).join(' · '));
    if (!rec && s) {
      try { var p = SC.passInfo(d, s, occ.date, new Date()); if (p && p.label && p.label !== '—') sub.push(p.label); } catch (e) { /* 무시 */ }
    }
    var thumb = null;
    if (rec && rec.signature && DA.sig && DA.sig.el) {
      try { thumb = h('span', { class: 'sig-thumb' }, DA.sig.el(rec.signature, { width: 72, height: 32 })); } catch (e) { thumb = null; }
    }
    var main = h('button', {
      class: 'tt-srow-main', type: 'button', disabled: !s,
      attrs: { 'aria-label': name + ' ' + stLabel(eff.status) + ' — 눌러서 서명 출석' },
      onClick: function () { if (DA.actions) DA.actions.sign(occ, sid, { date: occ.date, confirmOtherDay: true }); }
    },
      ui.avatar(name, s ? ui.studentColor(s) : '#A8A29E'),
      h('span', { class: 'li-main' },
        h('span', { class: 'li-title' }, name),
        sub.length ? h('span', { class: 'li-sub' }, sub.join(' · ')) : h('span', { class: 'li-sub tt-hint' }, '이름을 누르면 서명 출석')));
    return h('div', { class: 'list-item tt-srow' },
      main,
      thumb,
      ui.badge(eff.status, { auto: eff.auto }),
      s ? h('button', {
        class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': name + ' 출결 메뉴' },
        onClick: function () { if (DA.actions) DA.actions.menu(occ, sid, { date: occ.date }); }
      }, ic('more', 22)) : null);
  }

  function markAllPresent(occ, ids, btn) {
    var snap = SC.snapOf ? SC.snapOf(occ) : { start: occ.start, duration: occ.duration, teacherId: occ.teacherId || '', roomId: occ.roomId || '', kind: occ.kind || 'regular' };
    var recs = ids.map(function (sid) {
      return {
        id: DA.store.attendanceKey(occ.date, occ.srcId, sid), date: occ.date, srcId: occ.srcId, studentId: sid,
        status: 'present', method: 'manual', signedAt: null, signature: null, note: '', progress: null, snap: snap
      };
    });
    if (btn) btn.disabled = true;
    return DA.store.putMany('attendance', recs).then(function () {
      ui.haptic('success');
      ui.toast(ids.length + '명 출석 처리했어요', {
        kind: 'ok',
        action: { label: '되돌리기', onClick: function () { DA.store.removeMany('attendance', recs.map(function (r) { return r.id; })); } }
      });
    }, function (err) {
      if (btn) btn.disabled = false;
      ui.toast('저장하지 못했어요: ' + (err && err.message || err), { kind: 'error' });
    });
  }

  function makeupFor(occ, ids) {
    if (!DA.actions || !DA.actions.makeup) return null;
    var pool = ids.filter(function (sid) { return !!DA.store.get('students', sid); });
    var opts = { forDate: occ.date, forSrcId: occ.srcId };
    if (pool.length === 1) return DA.actions.makeup(pool[0], opts);
    if (!pool.length) return DA.actions.makeup(null, {});
    return ui.pickStudent({ title: '보강할 학생', filter: function (s) { return pool.indexOf(s.id) >= 0; }, status: 'all' }).then(function (sid) {
      return sid ? DA.actions.makeup(sid, opts) : null;
    });
  }

  function addStudentsToExtra(ex) {
    return ui.pickStudent({ title: '학생 추가', multiple: true, selected: (ex.studentIds || []).slice(), allowEmpty: true }).then(function (ids) {
      if (!ids) return null;
      return DA.store.put('exceptions', Object.assign({}, ex, { studentIds: U.uniq(ids) })).then(function () { ui.toast('명단을 바꿨어요', { kind: 'ok' }); });
    });
  }

  /* ---------------- 수업 종료 / 삭제 ---------------- */
  function endOrDelete(L) {
    var d = data();
    var t = today();
    var yday = U.addDays(t, -1);
    var recs = (d.attendance || []).filter(function (r) { return r.srcId === L.id; });
    var cancels = (d.exceptions || []).filter(function (e) { return e.type === 'cancel' && e.lessonId === L.id; });
    var label = SC.lessonLabel(d, L) + ' (매주 ' + WD(+L.weekday) + '요일 ' + U.fmtTime(L.start) + ')';
    if (recs.length) {
      if (L.endDate && L.endDate <= yday) {
        ui.toast('이미 ' + U.fmtDate(L.endDate) + '에 끝난 수업이에요. 출석 기록이 있어 지우지 않고 남겨 둬요.', { kind: 'warn', ms: 4200 });
        return Promise.resolve(false);
      }
      return ui.confirm(label + '\n\n출석 기록이 ' + recs.length + '건 있어서 지우지 않고 어제(' + U.fmtDate(yday) + ')까지 운영한 수업으로 끝낼게요. 기록과 통계는 그대로 남고, 오늘부터 시간표에서 빠져요.', {
        title: '수업 종료', ok: '수업 종료', danger: true
      }).then(function (ok) {
        if (!ok) return false;
        var prev = Object.assign({}, L);
        var ended = Object.assign({}, L, { endDate: yday });
        var stale = cancels.filter(function (e) { return e.date > yday; });
        return DA.store.put('lessons', ended).then(function () {
          return stale.length ? DA.store.removeMany('exceptions', stale.map(function (e) { return e.id; })) : null;
        }).then(function () {
          ui.haptic('success');
          ui.toast('수업을 끝냈어요', {
            kind: 'ok',
            action: { label: '되돌리기', onClick: function () {
              DA.store.put('lessons', prev).then(function () { return stale.length ? DA.store.putMany('exceptions', stale) : null; });
            } }
          });
          return true;
        });
      });
    }
    return ui.confirm(label + '\n\n출석 기록이 없는 수업이라 완전히 지워요.', { title: '수업 삭제', ok: '삭제', danger: true }).then(function (ok) {
      if (!ok) return false;
      var prev = Object.assign({}, L);
      return DA.store.remove('lessons', L.id).then(function () {
        return cancels.length ? DA.store.removeMany('exceptions', cancels.map(function (e) { return e.id; })) : null;
      }).then(function () {
        ui.toast('수업을 삭제했어요', {
          kind: 'ok',
          action: { label: '되돌리기', onClick: function () {
            DA.store.put('lessons', prev).then(function () { return cancels.length ? DA.store.putMany('exceptions', cancels) : null; });
          } }
        });
        return true;
      });
    });
  }

  function hasPastOccurrence(L, t) {
    if ((data().attendance || []).some(function (r) { return r.srcId === L.id && r.date < t; })) return true;
    var from = L.startDate && U.isYmd(L.startDate) ? L.startDate : null;
    if (!from) return true;
    if (from >= t) return false;
    var off = ((+L.weekday) - U.weekday(from) + 7) % 7;
    var first = U.addDays(from, off);
    return first < t && (!L.endDate || first <= L.endDate);
  }

  /* 선택지 시트 → Promise<value|null> */
  function choose(title, msg, options) {
    return new Promise(function (resolve) {
      var done = false, sh;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var box = h('div', { class: 'tt-choices' });
      options.forEach(function (o) {
        box.appendChild(h('button', {
          class: 'btn btn-block tt-choice' + (o.kind === 'primary' ? ' btn-primary' : ''), type: 'button',
          onClick: function () { fin(o.value); sh.close(); }
        }, h('span', { class: 'tt-choice-l' }, o.label), o.sub ? h('span', { class: 'tt-choice-s' }, o.sub) : null));
      });
      sh = ui.sheet({
        title: title, className: 'tt-sheet', autofocus: false,
        content: h('div', null, msg ? h('p', { class: 'sheet-msg' }, msg) : null, box),
        actions: [{ label: '취소', kind: 'ghost', onClick: function () { fin(null); } }],
        onClose: function () { fin(null); }
      });
    });
  }

  /* ================================================================
   * 수업 편집기
   *   TT.editLesson(src, preset) → Promise<저장된 레코드[]|null>
   *   src: Lesson | Exception(type 'extra') | null(새 수업)
   *   preset: {mode:'weekly'|'once', weekday, weekdays, start, date, duration, studentIds, teacherId, roomId, kind, title}
   * ================================================================ */
  TT.editLesson = function (src, preset) {
    preset = preset || {};
    var s = settings();
    var t = today();
    var isEdit = !!(src && src.id);
    var srcIsExtra = !!(src && src.type === 'extra');
    var srcRecCount = srcIsExtra ? (data().attendance || []).filter(function (r) { return r.srcId === src.id; }).length : 0;
    var defDur = +s.defaultDuration || 50;
    var singleTeacher = (s.teachers || []).length === 1 ? s.teachers[0].id : '';
    var draft = {
      mode: isEdit ? (srcIsExtra ? 'once' : 'weekly') : (preset.mode === 'once' ? 'once' : 'weekly'),
      weekdays: isEdit && !srcIsExtra ? [+src.weekday] : (preset.weekdays ? preset.weekdays.slice() : [preset.weekday != null ? +preset.weekday : U.weekday(preset.date || t)]),
      date: srcIsExtra ? src.date : (preset.date || t),
      kind: srcIsExtra ? (src.kind || 'special') : (preset.kind || 'special'),
      start: (src && src.start) || preset.start || '',
      duration: +((src && src.duration) || preset.duration || defDur),
      studentIds: ((src && src.studentIds) || preset.studentIds || []).slice(),
      teacherId: src ? (src.teacherId || '') : (preset.teacherId || singleTeacher || ''),
      roomId: src ? (src.roomId || '') : (preset.roomId || ''),
      title: (src && src.title) || preset.title || '',
      memo: (src && src.memo) || '',
      startDate: isEdit && !srcIsExtra ? (src.startDate || '') : (preset.date && preset.date > t ? preset.date : t),
      endDate: isEdit && !srcIsExtra ? (src.endDate || '') : ''
    };
    if (!draft.start) draft.start = defaultStartFor(draft);
    if (!draft.teacherId && draft.studentIds.length) {
      var st0 = DA.store.get('students', draft.studentIds[0]);
      if (st0 && st0.teacherId) draft.teacherId = st0.teacherId;
    }

    return new Promise(function (resolve) {
      var done = false, sh;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var body = h('div', { class: 'tt-editor' });
      var conflictBox = h('div', { class: 'conflicts' });
      var endHint = h('span', { class: 'tt-endhint' });
      var stuBox = h('div', { class: 'tt-stus' });
      var checkTimer = null;
      var lastConflicts = [];

      /* --- 모드 --- */
      var modeSeg = null;
      if (!isEdit) {
        modeSeg = ui.segmented([{ value: 'weekly', label: '매주 반복' }, { value: 'once', label: '하루만 (보강·특강·체험)' }], draft.mode, function (v) {
          draft.mode = v; syncMode(); check();
        });
        modeSeg.classList.add('full');
      }

      /* --- 요일 --- */
      var wdBox = h('div', { class: 'tt-wds', attrs: { role: 'group', 'aria-label': '요일' } });
      function paintWds() {
        ui.clear(wdBox);
        weekdayOrder().forEach(function (w) {
          var on = draft.weekdays.indexOf(w) >= 0;
          wdBox.appendChild(h('button', {
            class: ['tt-wd', on ? 'on' : '', w === 0 ? 'sun' : '', w === 6 ? 'sat' : ''], type: 'button',
            attrs: { 'aria-pressed': on ? 'true' : 'false', 'aria-label': WD(w) + '요일' },
            onClick: function () {
              var i = draft.weekdays.indexOf(w);
              if (i >= 0) draft.weekdays.splice(i, 1); else draft.weekdays.push(w);
              ui.haptic('select'); paintWds(); check();
            }
          }, WD(w)));
        });
      }
      var wdHint = h('div', { class: 'field-hint' });
      function paintWdHint() {
        var n = draft.weekdays.length;
        if (isEdit) wdHint.textContent = n > 1 ? '추가로 고른 요일은 같은 설정의 수업이 새로 만들어져요.' : '';
        else wdHint.textContent = n > 1 ? '요일마다 수업이 하나씩, 모두 ' + n + '개 만들어져요.' : '여러 요일을 고르면 요일마다 수업이 따로 만들어져요.';
      }

      /* --- 날짜·종류(하루만) --- */
      var dateIn = ui.input({ type: 'date', value: draft.date, onInput: function (v) { draft.date = v; check(); }, onChange: function (v) { draft.date = v; check(); } });
      if (srcRecCount) dateIn.disabled = true;
      var kindSeg = ui.segmented(['special', 'trial', 'makeup', 'walkin'].map(function (k) { return { value: k, label: kindLabel(k) }; }), draft.kind, function (v) { draft.kind = v; });
      kindSeg.classList.add('full');

      /* --- 시각·길이 --- */
      var timeIn = ui.input({ type: 'time', value: draft.start, step: 300, onInput: function (v) { draft.start = v; paintEnd(); check(); }, onChange: function (v) { draft.start = v; paintEnd(); check(); } });
      var customDur = ui.input({
        type: 'number', value: draft.duration, min: 5, max: 600, step: 5, inputmode: 'numeric', className: 'tt-durin',
        onInput: function (v) { var n = Math.round(+v); if (n > 0) { draft.duration = n; paintEnd(); check(); } }
      });
      var durCustomOn = DUR_PRESETS.indexOf(draft.duration) < 0;
      var durSeg = ui.segmented(DUR_PRESETS.map(function (m) { return { value: m, label: m + '분' }; }).concat([{ value: 'custom', label: '직접' }]),
        durCustomOn ? 'custom' : draft.duration, function (v) {
          if (v === 'custom') { durCustomOn = true; customWrap.style.display = ''; setTimeout(function () { try { customDur.focus(); customDur.select(); } catch (e) { /* 무시 */ } }, 30); }
          else { durCustomOn = false; draft.duration = v; customDur.value = v; customWrap.style.display = 'none'; }
          paintEnd(); check();
        });
      durSeg.classList.add('full');
      var customWrap = h('div', { class: 'tt-durwrap' }, customDur, h('span', { class: 'muted' }, '분'));
      if (!durCustomOn) customWrap.style.display = 'none';
      function paintEnd() {
        var ok = U.isHm ? U.isHm(draft.start) : /^\d\d:\d\d$/.test(draft.start);
        endHint.textContent = ok && draft.duration > 0 ? U.fmtTime(draft.start) + ' ~ ' + hm(U.hm2min(draft.start) + draft.duration) + ' (' + (U.fmtDuration ? U.fmtDuration(draft.duration) : draft.duration + '분') + ')' : '';
      }

      /* --- 학생 --- */
      function paintStudents() {
        ui.clear(stuBox);
        draft.studentIds.forEach(function (sid) {
          var x = DA.store.get('students', sid);
          var nm = x ? x.name : '(삭제된 수강생)';
          stuBox.appendChild(h('span', { class: 'tt-stu' + (x && x.status && x.status !== 'active' ? ' dim' : '') },
            ui.avatar(nm, x ? ui.studentColor(x) : '#A8A29E'),
            h('span', { class: 'tt-stu-n' }, nm, x && x.status === 'paused' ? h('small', null, ' 휴원') : x && x.status === 'left' ? h('small', null, ' 퇴원') : null),
            h('button', {
              class: 'tt-stu-x', type: 'button', attrs: { 'aria-label': nm + ' 빼기' },
              onClick: function () { draft.studentIds = draft.studentIds.filter(function (y) { return y !== sid; }); paintStudents(); check(); }
            }, ic('x', 16))));
        });
        stuBox.appendChild(h('button', { class: 'btn btn-sm tt-stu-add', type: 'button', onClick: pickStudents },
          ic(draft.studentIds.length ? 'edit' : 'user-plus', 16), draft.studentIds.length ? '학생 바꾸기' : '학생 선택'));
      }
      function pickStudents() {
        ui.pickStudent({ title: '수업 학생 (여러 명 가능)', multiple: true, selected: draft.studentIds.slice(), allowEmpty: true }).then(function (ids) {
          if (!ids) return;
          draft.studentIds = U.uniq(ids);
          if (!draft.teacherId && draft.studentIds.length) {
            var x = DA.store.get('students', draft.studentIds[0]);
            if (x && x.teacherId) { draft.teacherId = x.teacherId; tSel.value = x.teacherId; }
          }
          paintStudents(); check();
        });
      }

      /* --- 강사·방·제목·기간·메모 --- */
      var tSel = ui.select([{ value: '', label: '미지정' }].concat((s.teachers || []).map(function (x) { return { value: x.id, label: x.name }; })), draft.teacherId, function (v) { draft.teacherId = v; check(); });
      var rSel = ui.select([{ value: '', label: '미지정' }].concat((s.rooms || []).map(function (x) { return { value: x.id, label: x.name }; })), draft.roomId, function (v) { draft.roomId = v; check(); });
      var titleIn = ui.input({ value: draft.title, placeholder: '비워 두면 학생 이름으로 표시', maxLength: 40, onInput: function (v) { draft.title = v; } });
      var sdIn = ui.input({ type: 'date', value: draft.startDate, onInput: function (v) { draft.startDate = v; check(); }, onChange: function (v) { draft.startDate = v; check(); } });
      var edIn = ui.input({ type: 'date', value: draft.endDate, onInput: function (v) { draft.endDate = v; check(); }, onChange: function (v) { draft.endDate = v; check(); } });
      var edClear = h('button', { class: 'btn btn-icon btn-sm', type: 'button', attrs: { 'aria-label': '종료일 지우기' }, onClick: function () { edIn.value = ''; draft.endDate = ''; check(); } }, ic('x', 18));
      var memoIn = ui.input({ type: 'textarea', value: draft.memo, rows: 2, placeholder: '예: 교재 준비, 합주곡', onInput: function (v) { draft.memo = v; } });

      var weeklyPart = h('div', null,
        ui.field('요일', wdBox), wdHint);
      var oncePart = h('div', null,
        ui.field('날짜', dateIn, srcRecCount ? '출석 기록이 ' + srcRecCount + '건 있어 날짜는 바꿀 수 없어요.' : null),
        ui.field('종류', kindSeg));
      var periodPart = h('div', { class: 'field-row' },
        ui.field('시작일', sdIn),
        ui.field('종료일 (선택)', h('div', { class: 'tt-inrow' }, edIn, edClear)));

      body.appendChild(h('div', null,
        modeSeg ? h('div', { class: 'tt-modewrap' }, modeSeg) : null,
        weeklyPart, oncePart,
        h('div', { class: 'field-row' },
          ui.field('시작 시각', timeIn),
          h('div', { class: 'field tt-endf' }, h('span', { class: 'field-label' }, '끝나는 시각'), endHint)),
        ui.field('수업 길이', h('div', null, durSeg, customWrap)),
        ui.field('학생', stuBox),
        h('div', { class: 'field-row' }, ui.field('강사', tSel), ui.field('방', rSel)),
        ui.field('수업 이름 (선택)', titleIn),
        periodPart,
        ui.field('메모 (선택)', memoIn),
        conflictBox,
        isEdit ? h('button', {
          class: 'btn btn-ghost btn-block tt-danger', type: 'button',
          onClick: function () {
            var p = srcIsExtra ? deleteExtra(src) : endOrDelete(src);
            Promise.resolve(p).then(function (ok) { if (ok) { fin(null); sh.close(); } });
          }
        }, ic('trash', 18), srcIsExtra ? '이 수업 삭제' : '수업 종료/삭제') : null));

      function syncMode() {
        var once = draft.mode === 'once';
        weeklyPart.style.display = once ? 'none' : '';
        periodPart.style.display = once ? 'none' : '';
        oncePart.style.display = once ? '' : 'none';
        if (sh) sh.setTitle(titleText());
      }
      function titleText() {
        if (isEdit) return srcIsExtra ? kindLabel(src.kind) + ' 수업 수정' : '수업 편집';
        return draft.mode === 'once' ? '하루 수업 만들기' : '새 수업';
      }

      function check() {
        paintWdHint();
        clearTimeout(checkTimer);
        checkTimer = setTimeout(runCheck, 120);
      }
      function runCheck() {
        ui.clear(conflictBox);
        lastConflicts = [];
        if (!(U.isHm ? U.isHm(draft.start) : draft.start) || !(draft.duration > 0)) return;
        try {
          if (draft.mode === 'once') {
            if (!U.isYmd(draft.date)) return;
            lastConflicts = SC.conflicts(data(), {
              date: draft.date, start: draft.start, duration: draft.duration, teacherId: draft.teacherId, roomId: draft.roomId,
              studentIds: draft.studentIds, startDate: draft.date, endDate: draft.date
            }, { ignoreIds: srcIsExtra ? [src.id] : [] }) || [];
          } else {
            if (!draft.weekdays.length) return;
            lastConflicts = SC.conflicts(data(), {
              weekdays: draft.weekdays.slice(), weekday: draft.weekdays[0], start: draft.start, duration: draft.duration,
              teacherId: draft.teacherId, roomId: draft.roomId, studentIds: draft.studentIds,
              startDate: draft.startDate || t, endDate: draft.endDate || ''
            }, { ignoreLessonId: isEdit && !srcIsExtra ? src.id : '', ignoreIds: isEdit ? [src.id] : [] }) || [];
          }
        } catch (e) { logErr(e, 'tt.conflicts'); lastConflicts = []; }
        var seen = {};
        var uniq = lastConflicts.filter(function (c) { var k = c.message; if (seen[k]) return false; seen[k] = true; return true; });
        uniq.slice(0, 4).forEach(function (c) { conflictBox.appendChild(ui.banner('warn', c.message || '시간이 겹치는 수업이 있어요', { icon: 'alert' })); });
        if (uniq.length > 4) conflictBox.appendChild(h('div', { class: 'small muted' }, '외 ' + (uniq.length - 4) + '건 더 겹쳐요'));
      }

      paintWds(); paintWdHint(); paintEnd(); paintStudents();

      sh = ui.sheet({
        title: titleText(),
        className: 'tt-sheet tt-edit-sheet',
        autofocus: false,
        content: body,
        actions: [
          { label: '취소', kind: 'ghost', onClick: function () { fin(null); } },
          { label: isEdit ? '저장' : '만들기', kind: 'primary', onClick: function () { return save(); } }
        ],
        onClose: function () { clearTimeout(checkTimer); fin(null); }
      });
      syncMode();
      runCheck();

      /* --- 저장 --- */
      async function save() {
        // 입력 확정
        draft.start = timeIn.value || draft.start;
        if (durCustomOn) { var n = Math.round(+customDur.value); if (n > 0) draft.duration = n; }
        var err = validate();
        if (err) { ui.toast(err, { kind: 'warn' }); ui.haptic('warn'); return false; }
        runCheck();
        if (lastConflicts.length) {
          var ok = await ui.confirm('겹치는 수업이 ' + lastConflicts.length + '건 있어요.\n' +
            lastConflicts.slice(0, 3).map(function (c) { return '• ' + c.message; }).join('\n') + '\n\n그래도 저장할까요?', { title: '시간이 겹쳐요', ok: '그래도 저장' });
          if (!ok) return false;
        }
        var saved;
        if (draft.mode === 'once') saved = await saveExtra();
        else saved = await saveWeekly();
        if (saved === false) return false;
        ui.haptic('success');
        fin(saved);
        // 새 수업이면 그 날짜/주로 이동해 바로 보이게
        if (!isEdit) {
          var target = draft.mode === 'once' ? draft.date : null;
          if (target && (st.mode === 'day' ? st.date !== target : wsOf(st.date) !== wsOf(target))) { st.date = target; ui.refresh(); }
        }
        return true;
      }
      function validate() {
        if (!(U.isHm ? U.isHm(draft.start) : /^\d\d:\d\d$/.test(draft.start))) return '시작 시각을 입력해 주세요';
        if (!(draft.duration >= 5 && draft.duration <= 600)) return '수업 길이는 5분에서 600분 사이로 입력해 주세요';
        if (U.hm2min(draft.start) + draft.duration > 24 * 60) return '자정을 넘기는 수업은 만들 수 없어요';
        if (draft.mode === 'once') {
          if (!U.isYmd(draft.date)) return '날짜를 골라 주세요';
          if (!draft.studentIds.length && (draft.kind === 'makeup' || draft.kind === 'walkin')) return kindLabel(draft.kind) + ' 수업은 학생을 한 명 이상 넣어 주세요';
        } else {
          if (!draft.weekdays.length) return '요일을 하나 이상 골라 주세요';
          if (draft.startDate && !U.isYmd(draft.startDate)) return '시작일을 확인해 주세요';
          if (draft.endDate && !U.isYmd(draft.endDate)) return '종료일을 확인해 주세요';
          if (draft.endDate && draft.startDate && draft.endDate < draft.startDate) return '종료일이 시작일보다 빨라요';
        }
        return '';
      }
      function fields() {
        return {
          start: draft.start, duration: draft.duration, studentIds: U.uniq(draft.studentIds),
          teacherId: draft.teacherId || '', roomId: draft.roomId || '', title: String(draft.title || '').trim(), memo: String(draft.memo || '').trim()
        };
      }
      async function saveExtra() {
        var rec = Object.assign({}, srcIsExtra ? src : { type: 'extra', makeupFor: null }, fields(), { date: draft.date, kind: draft.kind });
        if (!rec.id) rec.id = U.uid();
        var out = await DA.store.put('exceptions', rec);
        ui.toast(isEdit ? '수업을 고쳤어요' : U.fmtDate(draft.date) + ' ' + kindLabel(draft.kind) + ' 수업을 만들었어요', { kind: 'ok' });
        return [out || rec];
      }
      async function saveWeekly() {
        var f = fields();
        var order = weekdayOrder();
        var W = draft.weekdays.slice().sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
        var base = Object.assign({}, f, { startDate: draft.startDate || t, endDate: draft.endDate || '' });
        if (!isEdit) {
          var list = W.map(function (w) { return Object.assign({ id: U.uid(), weekday: w }, base); });
          var res = await DA.store.putMany('lessons', list);
          ui.toast(list.length > 1 ? '수업 ' + list.length + '개를 만들었어요 (' + W.map(WD).join('·') + ')' : '매주 ' + WD(W[0]) + '요일 ' + U.fmtTime(f.start) + ' 수업을 만들었어요', { kind: 'ok' });
          return res || list;
        }
        var L = src;
        var primary = W.indexOf(+L.weekday) >= 0 ? +L.weekday : W[0];
        var others = W.filter(function (w) { return w !== primary; });
        var extraLessons = others.map(function (w) {
          return Object.assign({ id: U.uid(), weekday: w }, base, { startDate: (draft.startDate && draft.startDate > t) ? draft.startDate : t });
        });
        var structural = primary !== +L.weekday || f.start !== L.start || f.duration !== +L.duration || !sameSet(f.studentIds, L.studentIds) ||
          f.teacherId !== (L.teacherId || '') || f.roomId !== (L.roomId || '');
        var startChanged = (draft.startDate || '') !== (L.startDate || '');
        var how = 'all';
        if (structural && !startChanged && hasPastOccurrence(L, t)) {
          how = await choose('언제부터 바꿀까요?', '이미 지난 회차가 있는 수업이에요. 지난 출석 기록과 통계를 지키려면 오늘부터 적용하세요.', [
            { value: 'split', label: '오늘부터 적용', sub: '이전 기록 보존 · 권장', kind: 'primary' },
            { value: 'all', label: '전체 기간 수정', sub: '지난 회차도 새 설정으로 바뀌어요' }
          ]);
          if (!how) return false;
        }
        var saved = [];
        if (how === 'split') {
          var sp = SC.splitLesson(data(), L, t);
          if (sp.emptyEnded) how = 'all';
          else {
            var created = Object.assign({}, sp.created, f, { weekday: primary, startDate: t, endDate: draft.endDate || '' });
            await DA.store.putMany('lessons', [sp.ended, created].concat(extraLessons));
            if (sp.exceptions && sp.exceptions.length) await DA.store.putMany('exceptions', sp.exceptions);
            if (sp.attendance && sp.attendance.put && sp.attendance.put.length) {
              await DA.store.putMany('attendance', sp.attendance.put);
              if (sp.attendance.removeIds && sp.attendance.removeIds.length) await DA.store.removeMany('attendance', sp.attendance.removeIds);
            }
            ui.toast('오늘(' + fmtShort(t) + ')부터 바뀐 설정으로 적용했어요. 지난 기록은 그대로예요.', { kind: 'ok', ms: 3600 });
            saved = [sp.ended, created].concat(extraLessons);
          }
        }
        if (how === 'all') {
          var upd = Object.assign({}, L, f, { weekday: primary, startDate: draft.startDate || L.startDate || t, endDate: draft.endDate || '' });
          await DA.store.putMany('lessons', [upd].concat(extraLessons));
          ui.toast(extraLessons.length ? '수업을 고치고 ' + extraLessons.length + '개를 더 만들었어요' : '수업을 고쳤어요', { kind: 'ok' });
          saved = [upd].concat(extraLessons);
        }
        return saved;
      }
    });
  };

  function deleteExtra(ex) {
    var occ = null;
    try { occ = SC.occurrence(data(), ex.date, ex.id); } catch (e) { occ = null; }
    if (occ && DA.actions && DA.actions.cancelOccurrence) return DA.actions.cancelOccurrence(occ);
    return ui.confirm('이 수업을 삭제할까요?', { title: '수업 삭제', ok: '삭제', danger: true }).then(function (ok) {
      if (!ok) return false;
      return DA.store.remove('exceptions', ex.id).then(function () { ui.toast('삭제했어요', { kind: 'ok' }); return true; });
    });
  }

  // 새 수업 기본 시작 시각: 그 요일 마지막 수업 끝, 없으면 오후 4시(운영 시간 안으로)
  function defaultStartFor(draft) {
    var s = settings();
    var open = U.isHm && U.isHm(s.openTime) ? U.hm2min(s.openTime) : 600;
    var close = U.isHm && U.isHm(s.closeTime) ? U.hm2min(s.closeTime) : 1320;
    var m = U.clamp(16 * 60, open, Math.max(open, close - 60));
    try {
      var ls = (data().lessons || []).filter(function (l) {
        return draft.weekdays.indexOf(+l.weekday) >= 0 && (!l.endDate || l.endDate >= today()) && (!draft.teacherId || l.teacherId === draft.teacherId);
      });
      if (ls.length) {
        var last = Math.max.apply(null, ls.map(function (l) { return U.hm2min(l.start) + (+l.duration || 0); }));
        if (last + (+s.defaultDuration || 50) <= close) m = last;
      }
    } catch (e) { /* 무시 */ }
    var step = 5;
    return hm(Math.round(m / step) * step);
  }

  TT.goto = function (ymd, mode) {
    if (ymd && U.isYmd(ymd)) st.date = ymd;
    if (mode === 'day' || mode === 'week') st.mode = mode;
    var cur = ui.current ? ui.current() : null;
    if (cur && cur.name === 'timetable') ui.refresh(); else ui.go('#/timetable');
  };

  /* ================================================================ */
  ui.registerView('timetable', {
    title: '시간표',
    module: 'timetable',   // v1.2: 더보기 안으로(하단 탭 5개 유지)
    render: render
  });
})(window.DA = window.DA || {});
