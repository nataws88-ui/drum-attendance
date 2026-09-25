/* 드럼 출석부 — ui/stats-view.js (통계 담당)
 * 통계 화면: 기간·필터 → 핵심 지표 → 분류 탭(개요·학생별·요일·시간·강사/과정/레벨/방·월별·매출) → 내보내기.
 * 계산은 DA.stats.compute 한 번(store.version + 옵션으로 메모). 화면 상태는 모듈 변수에 두어 다시 그려도 유지된다.
 */
(function (DA) {
  'use strict';
  var ui = DA.ui;
  if (!ui || !ui.registerView) return;
  var h = ui.h;

  function U() { return DA.util; }
  function ic(name, size) { return ui.icon ? ui.icon(name, size || 18) : null; }
  function charts() { return DA.charts || {}; }
  function data() { return (DA.store && DA.store.data) || { settings: {}, students: [], lessons: [], exceptions: [], attendance: [], payments: [] }; }
  function settings() { return data().settings || {}; }
  function arr(v) { return Array.isArray(v) ? v : []; }

  // ── 화면 상태(다시 그려도 유지) ───────────────────────
  var PRESETS = [
    { key: 'thisWeek', label: '이번 주' }, { key: 'lastWeek', label: '지난 주' },
    { key: 'thisMonth', label: '이번 달' }, { key: 'lastMonth', label: '지난 달' },
    { key: 'last3m', label: '최근 3개월' }, { key: 'thisYear', label: '올해' },
    { key: 'all', label: '전체' }, { key: 'custom', label: '직접 지정' }
  ];
  var TABS = [
    { value: 'overview', label: '개요' }, { value: 'students', label: '학생별' },
    { value: 'time', label: '요일·시간' }, { value: 'groups', label: '강사·반·레벨·방' },
    { value: 'monthly', label: '월별 추이' }, { value: 'revenue', label: '금액' }
  ];
  function simple() { return settings().simpleMode !== false; }
  function absLabel() { return simple() ? '당일취소' : '결석'; }
  var DIMS = [
    { value: 'teacher', label: '강사', key: 'byTeacher' }, { value: 'course', label: '반', key: 'byCourse' },
    { value: 'level', label: '레벨', key: 'byLevel' }, { value: 'room', label: '방', key: 'byRoom' },
    { value: 'kind', label: '수업 종류', key: 'byKind' }
  ];
  var ST_SERIES = [
    { key: 'present', label: '출석', color: 'var(--st-present)' },
    { key: 'late', label: '지각', color: 'var(--st-late)' },
    { key: 'absent', get label() { return absLabel(); }, color: 'var(--st-absent)' },
    { key: 'unmarked', label: '미확인', color: 'var(--st-unmarked)' },
    { key: 'excused', label: '공결', color: 'var(--st-excused)' },
    { key: 'canceled', label: '휴강', color: 'var(--st-canceled)' }
  ];
  var METHOD_COLORS = { '카드': 'var(--pm-card)', '현금': 'var(--pm-cash)', '계좌이체': 'var(--pm-bank)', '기타': 'var(--pm-etc)' };

  var S = {
    preset: 'thisMonth', from: '', to: '',
    teacherId: '', courseId: '', levelId: '', roomId: '', kinds: [],
    tab: 'overview', dim: 'teacher',
    sortKey: 'name', sortDir: 1, q: '', stuAll: false,
    showFilters: false, riskAll: false
  };
  var PREF_KEY = 'da.stats';
  (function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
      if (!p) return;
      if (PRESETS.some(function (x) { return x.key === p.preset && x.key !== 'custom'; })) S.preset = p.preset;
      if (TABS.some(function (x) { return x.value === p.tab; })) S.tab = p.tab;
      if (DIMS.some(function (x) { return x.value === p.dim; })) S.dim = p.dim;
    } catch (e) { /* 무시 */ }
  })();
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ preset: S.preset === 'custom' ? 'thisMonth' : S.preset, tab: S.tab, dim: S.dim })); } catch (e) { /* 무시 */ }
  }

  var root = null, lastParams = null, lastQueryTab = null;

  // ── 기간·필터 ─────────────────────────────────────────
  function weekStart() { return Number(settings().weekStart) === 0 ? 0 : 1; }
  function currentRange(now) {
    var u = U();
    if (S.preset === 'custom') {
      var f = u.isYmd(S.from) ? S.from : u.monthStart(u.today(now));
      var t = u.isYmd(S.to) ? S.to : u.today(now);
      if (f > t) { var x = f; f = t; t = x; }
      return { from: f, to: t, label: '직접 지정' };
    }
    return DA.stats.presetRange(S.preset, now, weekStart(), data());
  }
  function prevRange(r) {
    var u = U();
    var f, t;
    switch (S.preset) {
      case 'thisMonth': case 'lastMonth':
        f = u.addMonths(u.monthStart(r.from), -1); t = u.monthEnd(f); break;
      case 'last3m':
        f = u.addMonths(r.from, -3); t = u.addDays(r.from, -1); break;
      case 'thisYear':
        f = (+r.from.slice(0, 4) - 1) + '-01-01'; t = (+r.from.slice(0, 4) - 1) + '-12-31'; break;
      case 'all':
        return null;
      default:
        var len = u.diffDays(r.from, r.to) + 1;
        t = u.addDays(r.from, -1); f = u.addDays(t, -(len - 1));
    }
    var first = DA.stats.earliestDate ? DA.stats.earliestDate(data(), u.today()) : f;
    if (first > t) return null;
    return { from: f, to: t };
  }
  function filterOpts() {
    return { teacherId: S.teacherId, courseId: S.courseId, levelId: S.levelId, roomId: S.roomId, kinds: S.kinds.slice() };
  }
  function activeFilterCount() {
    return (S.teacherId ? 1 : 0) + (S.courseId ? 1 : 0) + (S.levelId ? 1 : 0) + (S.roomId ? 1 : 0) + (S.kinds.length ? 1 : 0);
  }
  // 설정에서 지워진 항목을 가리키는 필터는 조용히 푼다
  function sanitizeFilters() {
    var st = settings();
    function has(list, id) { return !id || arr(list).some(function (x) { return x && x.id === id; }); }
    if (!has(st.teachers, S.teacherId)) S.teacherId = '';
    if (!has(st.courses, S.courseId)) S.courseId = '';
    if (!has(st.levels, S.levelId)) S.levelId = '';
    if (!has(st.rooms, S.roomId)) S.roomId = '';
  }

  // ── 계산 메모 ─────────────────────────────────────────
  var memo = { key: null, report: null, prev: null, range: null };
  function getReport() {
    var now = new Date();
    var r = currentRange(now);
    var f = filterOpts();
    var key = [DA.store ? DA.store.version : 0, U().today(now), Math.floor(now.getTime() / 300000), S.preset, r.from, r.to,
      f.teacherId, f.courseId, f.levelId, f.roomId, f.kinds.join(',')].join('|');
    if (memo.key === key) return memo;
    var opts = { from: r.from, to: r.to, teacherId: f.teacherId, courseId: f.courseId, levelId: f.levelId, roomId: f.roomId, kinds: f.kinds };
    var report = DA.stats.compute(data(), opts, now);
    var prev = null;
    var pr = prevRange(r);
    if (pr) {
      try {
        var po = assign(opts, { from: pr.from, to: pr.to });
        var p = DA.stats.compute(data(), po, now);
        if (p.totals && (p.totals.attended + p.totals.absent + p.totals.unmarked) > 0) prev = p;
      } catch (e) { prev = null; }
    }
    memo = { key: key, report: report, prev: prev, range: r };
    return memo;
  }
  function assign(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }

  // ── 표기 도우미 ───────────────────────────────────────
  function pct(r) { return U().pct(r); }
  function n(v) { return U().fmtNumber(v || 0); }
  function won(v) { return U().fmtMoney(v || 0); }
  function wonShort(v) {
    v = +v || 0;
    var a = Math.abs(v);
    if (a >= 100000000) return (Math.round(v / 10000000) / 10) + '억';
    if (a >= 10000) return (Math.round(v / 1000) / 10).toString().replace(/\.0$/, '') + '만';
    if (a === 0) return '0';
    return U().fmtNumber(v) + '원';
  }
  function denomOf(c) { return (c.present || 0) + (c.late || 0) + (c.absent || 0) + (c.unmarked || 0); }
  function dayMD(ymd) { return (+ymd.slice(5, 7)) + '/' + (+ymd.slice(8, 10)); }
  function rateTone(r) { return r == null ? '' : r >= 0.9 ? 'good' : r >= 0.75 ? 'mid' : 'bad'; }
  function signOffsetText(v) {
    if (v == null) return { value: '–', sub: '서명 기록이 없어요' };
    var m = Math.round(Math.abs(v));
    if (m === 0) return { value: '정시', sub: '수업 시작 무렵 서명' };
    return v < 0 ? { value: m + '분 일찍', sub: '수업 시작보다 먼저 서명' } : { value: m + '분 늦게', sub: '수업 시작 뒤에 서명' };
  }

  // ── 저장(설정 화면과 같은 경로) ───────────────────────
  function saveText(filename, mime, text) {
    if (ui.saveFile) return ui.saveFile(filename, mime, text);
    try {
      if (window.DrumNative && typeof window.DrumNative.saveFile === 'function') {
        window.DrumNative.saveFile(filename, mime, String(text));
        return Promise.resolve('native');
      }
    } catch (e) { /* 아래로 */ }
    var blob = new Blob([text], { type: mime });
    try {
      var file = new File([blob], filename, { type: mime });
      if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: filename }).then(function () { return 'share'; }, function (err) {
          if (err && err.name === 'AbortError') return 'cancel';
          download(blob, filename); return 'download';
        });
      }
    } catch (e) { /* 아래로 */ }
    download(blob, filename);
    return Promise.resolve('download');
  }
  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 4000);
  }
  function savedToast(res, what) {
    if (res === 'cancel') return;
    var msg = res === 'native' ? what + ' 파일을 저장했어요' : res === 'share' ? what + ' 공유 창으로 보냈어요' : what + ' 파일을 저장했어요';
    ui.toast(msg, { kind: 'ok' });
  }
  function exportAttendance() {
    var m = getReport();
    var r = m.report.range;
    var rows = DA.schedule.rows(data(), r.from, r.to, new Date(), filterOpts()).filter(function (row) {
      return row.status !== 'upcoming' && row.status !== 'pending';
    });
    if (!rows.length) { ui.toast('이 기간에는 내보낼 출석 기록이 없어요', { kind: 'warn' }); return; }
    var csv = DA.backup.attendanceCSV(data(), rows, { includeSignature: false });
    var name = 'drum-attendance-attendance-' + r.from + '_' + r.to + '.csv';
    saveText(name, 'text/csv;charset=utf-8', csv).then(function (res) { savedToast(res, '출석 기록 CSV'); }, function () {
      ui.toast('파일을 저장하지 못했어요', { kind: 'error' });
    });
  }
  function exportStudents() {
    var m = getReport();
    if (!m.report.byStudent.length) { ui.toast('이 기간에는 학생별 통계가 없어요', { kind: 'warn' }); return; }
    var r = m.report.range;
    var csv = DA.backup.studentStatsCSV(m.report);
    var name = 'drum-attendance-student-stats-' + r.from + '_' + r.to + '.csv';
    saveText(name, 'text/csv;charset=utf-8', csv).then(function (res) { savedToast(res, '학생별 통계 CSV'); }, function () {
      ui.toast('파일을 저장하지 못했어요', { kind: 'error' });
    });
  }
  function printStats() {
    var m = getReport();
    if (DA.print && typeof DA.print.stats === 'function') {
      try { DA.print.stats(m.report); } catch (e) { if (ui._logErr) ui._logErr(e, 'print.stats'); ui.toast('인쇄를 준비하지 못했어요', { kind: 'error' }); }
    } else {
      ui.toast('인쇄 기능을 아직 불러오지 못했어요', { kind: 'warn' });
    }
  }
  function openExportSheet() {
    var item = function (icon, title, sub, fn) {
      return h('button', { type: 'button', class: 'list-item', onClick: function () { sheet.close(); setTimeout(fn, 60); } },
        h('span', { class: 'li-ic' }, ic(icon, 20)),
        h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, title), h('div', { class: 'li-sub' }, sub)),
        h('span', { class: 'li-end' }, ic('chevR', 18)));
    };
    var r = getReport().report.range;
    var sheet = ui.sheet({
      title: '통계 내보내기',
      sub: r.label + (activeFilterCount() ? ' · 필터 적용' : ''),
      content: h('div', { class: 'list flat' },
        item('download', 'CSV 출석 기록', '회차별 출결·서명 시각·진도(엑셀에서 열림)', exportAttendance),
        item('users', 'CSV 학생별 통계', '학생마다 출석률·연속 출석·보강 필요·수강권', exportStudents),
        item('print', '인쇄', '핵심 지표와 학생별 표를 A4로', printStats))
    });
  }

  // ── 다시 그리기(뷰 안에서만) ──────────────────────────
  function redraw(keepScroll) {
    if (!root || !root.isConnected) return;
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    if (charts().hideTips) charts().hideTips();
    ui.clear(root);
    renderView(root, lastParams || { rest: [], query: {} });
    if (keepScroll !== false) window.scrollTo(0, y);
  }
  function setState(patch, opts) {
    for (var k in patch) S[k] = patch[k];
    savePrefs();
    redraw(!(opts && opts.top));
  }

  // ── 뷰 ────────────────────────────────────────────────
  function renderView(container, params) {
    root = container;
    lastParams = params || { rest: [], query: {} };
    var qTab = lastParams.query && lastParams.query.tab;
    if (qTab && qTab !== lastQueryTab && TABS.some(function (t) { return t.value === qTab; })) S.tab = qTab;
    lastQueryTab = qTab || null;
    sanitizeFilters();

    var wrap = h('div', { class: 'v-stats' });
    container.appendChild(wrap);
    var d = data();
    var hasAny = arr(d.students).length || arr(d.lessons).length || arr(d.attendance).length || arr(d.payments).length;

    var m = hasAny ? getReport() : null;
    var R = m ? m.report : null;

    var sub = R ? R.range.label + ' · ' + n(R.range.days) + '일' : '출석이 쌓이면 여기서 한눈에 봐요';
    wrap.appendChild(h('header', { class: 'topbar' },
      h('div', { class: 'topbar-row' },
        h('div', { class: 'grow' }, h('h1', { class: 'topbar-title' }, '통계'), h('div', { class: 'topbar-sub ellipsis' }, sub)),
        R ? h('div', { class: 'topbar-actions' },
          h('button', { type: 'button', class: 'btn btn-icon', attrs: { 'aria-label': '인쇄' }, onClick: printStats }, ic('print', 22)),
          h('button', { type: 'button', class: 'btn btn-icon', attrs: { 'aria-label': '내보내기' }, onClick: openExportSheet }, ic('download', 22))) : null)));

    var page = h('div', { class: 'page' });
    wrap.appendChild(page);

    if (!hasAny) { page.appendChild(h('div', { class: 'card' }, noDataEmpty())); return; }

    page.appendChild(controls(R));

    var t = R.totals;
    if (!t.scheduled && !R.revenue.count && !(R.money && R.money.totals.issuedAmount)) {
      var upcomingOnly = t.upcoming + t.pending > 0;
      page.appendChild(h('div', { class: 'card' }, ui.empty('calendar',
        upcomingOnly ? '아직 지나간 수업이 없어요' : '이 기간에는 수업이 없어요',
        upcomingOnly ? '예정된 수업 ' + n(t.upcoming + t.pending) + '회가 끝나면 통계가 쌓여요.'
          : activeFilterCount() ? '필터를 풀거나 기간을 넓혀 보세요.' : '다른 기간을 고르거나 전체 기간으로 볼 수 있어요.',
        activeFilterCount()
          ? { label: '필터 모두 풀기', icon: 'x', onClick: clearFilters }
          : { label: '전체 기간 보기', icon: 'calendar', onClick: function () { setState({ preset: 'all' }); } })));
      return;
    }

    page.appendChild(kpis(R, m.prev));

    var tabs = ui.segmented(TABS, S.tab, function (v) {
      S.tab = v; savePrefs();
      var y0 = tabsEl.getBoundingClientRect().top;
      renderPanel();
      // 탭 줄이 제자리에 머물도록
      var y1 = tabsEl.getBoundingClientRect().top;
      if (Math.abs(y1 - y0) > 1) window.scrollBy(0, y1 - y0);
    });
    tabs.classList.add('st-tabs');
    var tabsEl = h('div', { class: 'st-tabbar' }, tabs);
    page.appendChild(tabsEl);
    var panel = h('div', { class: 'st-panel' });
    page.appendChild(panel);
    function renderPanel() {
      if (charts().hideTips) charts().hideTips();
      ui.clear(panel);
      var fn = PANELS[S.tab] || PANELS.overview;
      try { fn(panel, R, m); } catch (e) {
        if (ui._logErr) ui._logErr(e, 'stats.' + S.tab);
        ui.clear(panel);
        panel.appendChild(h('div', { class: 'card' }, ui.empty('alert', '이 탭을 그리지 못했어요', String(e && e.message || e))));
      }
    }
    renderPanel();
    // 분류 탭 줄은 상단 막대 바로 아래에 붙는다(상단 막대 높이는 기기·글자 크기마다 다름)
    requestAnimationFrame(function () {
      var tb = wrap.querySelector('.topbar');
      if (tb && tb.offsetHeight) tabsEl.style.top = Math.max(0, tb.offsetHeight - 1) + 'px';
    });

    page.appendChild(h('div', { class: 'st-export' },
      h('div', { class: 'st-export-t' }, '내보내기'),
      h('div', { class: 'st-export-b' },
        h('button', { type: 'button', class: 'btn btn-sm', onClick: exportAttendance }, ic('download', 16), 'CSV 출석 기록'),
        h('button', { type: 'button', class: 'btn btn-sm', onClick: exportStudents }, ic('users', 16), 'CSV 학생별 통계'),
        h('button', { type: 'button', class: 'btn btn-sm', onClick: printStats }, ic('print', 16), '인쇄'))));
  }

  function noDataEmpty() {
    var box = h('div');
    box.appendChild(ui.empty('chart', '아직 통계가 없어요', '수강생과 수업을 등록하고 출석을 받으면\n출석률·지각·요일별 흐름이 여기에 쌓여요.', null));
    var acts = h('div', { class: 'st-empty-acts' },
      h('button', { type: 'button', class: 'btn btn-primary', onClick: function () { ui.go('#/timetable'); } }, ic('calendar', 18), '시간표에 수업 추가'),
      DA.demo && DA.demo.load ? h('button', {
        type: 'button', class: 'btn', onClick: function (e) {
          var b = e.currentTarget; b.disabled = true;
          DA.demo.load(new Date()).then(function () { ui.toast('예시 데이터를 불러왔어요', { kind: 'ok' }); }, function (err) {
            b.disabled = false; ui.toast((err && err.message) || '예시 데이터를 불러오지 못했어요', { kind: 'error' });
          });
        }
      }, ic('sparkle', 18), '예시 데이터로 둘러보기') : null);
    box.appendChild(acts);
    return box;
  }

  function clearFilters() {
    setState({ teacherId: '', courseId: '', levelId: '', roomId: '', kinds: [] });
  }

  // ── 기간·필터 조작부 ─────────────────────────────────
  function controls(R) {
    var box = h('div', { class: 'st-controls' });
    var chips = h('div', { class: 'hscroll bleed st-presets', attrs: { role: 'radiogroup', 'aria-label': '기간' } });
    PRESETS.forEach(function (p) {
      var on = S.preset === p.key;
      chips.appendChild(h('button', {
        type: 'button', class: 'chip' + (on ? ' on' : ''), attrs: { role: 'radio', 'aria-checked': on ? 'true' : 'false' },
        onClick: function () {
          if (S.preset === p.key) return;
          ui.haptic && ui.haptic('select');
          if (p.key === 'custom') {
            var cur = memo.range || currentRange(new Date());
            setState({ preset: 'custom', from: cur.from, to: cur.to > U().today() ? U().today() : cur.to });
          } else setState({ preset: p.key });
        }
      }, p.label));
    });
    box.appendChild(chips);
    setTimeout(function () {
      var on = chips.querySelector('.on');
      if (on && chips.scrollWidth > chips.clientWidth) chips.scrollLeft = Math.max(0, on.offsetLeft - 24);
    }, 0);

    if (S.preset === 'custom') {
      var fromI = ui.input({ type: 'date', value: R.range.from, onChange: function (v) { if (U().isYmd(v)) setState({ from: v }); } });
      var toI = ui.input({ type: 'date', value: R.range.to, onChange: function (v) { if (U().isYmd(v)) setState({ to: v }); } });
      fromI.setAttribute('aria-label', '시작일'); toI.setAttribute('aria-label', '종료일');
      box.appendChild(h('div', { class: 'st-custom' },
        h('label', { class: 'st-date' }, h('span', null, '시작'), fromI),
        h('span', { class: 'st-tilde', attrs: { 'aria-hidden': 'true' } }, '~'),
        h('label', { class: 'st-date' }, h('span', null, '끝'), toI)));
    }

    var cnt = activeFilterCount();
    var fRow = h('div', { class: 'st-frow' },
      h('button', {
        type: 'button', class: 'btn btn-sm st-fbtn' + (cnt ? ' on' : ''), attrs: { 'aria-expanded': S.showFilters ? 'true' : 'false' },
        onClick: function () { setState({ showFilters: !S.showFilters }); }
      }, ic('filter', 16), '필터', cnt ? h('span', { class: 'st-fcount' }, String(cnt)) : null, ic(S.showFilters ? 'chevU' : 'chevD', 16)));
    // 켜진 필터 요약 칩(탭하면 해제)
    var st = settings();
    function onChip(label, patch) {
      fRow.appendChild(h('button', { type: 'button', class: 'chip on st-fchip', attrs: { 'aria-label': label + ' 필터 해제' }, onClick: function () { setState(patch); } },
        label, ic('x', 14)));
    }
    if (S.teacherId) onChip(ui.nameOf('teachers', S.teacherId), { teacherId: '' });
    if (S.courseId) onChip(ui.nameOf('courses', S.courseId), { courseId: '' });
    if (S.levelId) onChip(ui.nameOf('levels', S.levelId), { levelId: '' });
    if (S.roomId) onChip(ui.nameOf('rooms', S.roomId), { roomId: '' });
    if (S.kinds.length) onChip(S.kinds.map(function (k) { return DA.C.KIND[k] || k; }).join('·'), { kinds: [] });
    box.appendChild(fRow);

    if (S.showFilters) {
      function opts(list, all) {
        return [{ value: '', label: all }].concat(arr(list).map(function (x) { return { value: x.id, label: x.name || '이름 없음' }; }));
      }
      var grid = h('div', { class: 'st-fgrid' },
        ui.field('강사', ui.select(opts(st.teachers, '전체 강사'), S.teacherId, function (v) { setState({ teacherId: v }); })),
        ui.field('반', ui.select(opts(st.courses, '전체 반'), S.courseId, function (v) { setState({ courseId: v }); })),
        ui.field('레벨', ui.select(opts(st.levels, '전체 레벨'), S.levelId, function (v) { setState({ levelId: v }); })),
        ui.field('방', ui.select(opts(st.rooms, '전체 방'), S.roomId, function (v) { setState({ roomId: v }); })));
      var kindChips = h('div', { class: 'chips' });
      (DA.C.KIND_ORDER || Object.keys(DA.C.KIND)).forEach(function (k) {
        var on = S.kinds.indexOf(k) >= 0;
        kindChips.appendChild(h('button', {
          type: 'button', class: 'chip' + (on ? ' on' : ''), attrs: { 'aria-pressed': on ? 'true' : 'false' },
          onClick: function () {
            var next = S.kinds.filter(function (x) { return x !== k; });
            if (!on) next.push(k);
            if (next.length === (DA.C.KIND_ORDER || []).length) next = [];
            setState({ kinds: next });
          }
        }, h('span', { class: 'swatch', style: { background: (DA.C.KIND_COLORS || {})[k] || 'var(--text-3)' } }), DA.C.KIND[k]));
      });
      box.appendChild(h('div', { class: 'card flat st-fpanel' },
        grid,
        ui.field('수업 종류', kindChips, S.kinds.length ? null : '아무것도 고르지 않으면 모든 종류를 봐요'),
        cnt ? h('div', { class: 'st-freset' }, h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: clearFilters }, ic('undo', 16), '필터 모두 풀기')) : null));
    }
    return box;
  }

  // ── 핵심 지표 ─────────────────────────────────────────
  function delta(cur, prev, goodUp, unit) {
    if (cur == null || prev == null) return null;
    var dv = Math.round((cur - prev) * 100);
    if (!dv) return h('span', { class: 'st-delta flat' }, '지난 기간과 같음');
    var good = goodUp ? dv > 0 : dv < 0;
    return h('span', { class: 'st-delta ' + (good ? 'up' : 'down') }, (dv > 0 ? '▲ ' : '▼ ') + Math.abs(dv) + (unit || '%p'));
  }
  function kpi(label, value, subNode, opts) {
    opts = opts || {};
    return h('div', { class: 'kpi' + (opts.cls ? ' ' + opts.cls : ''), attrs: { role: 'group', 'aria-label': label } },
      h('div', { class: 'kpi-label' }, opts.dot ? h('span', { class: 'dot ' + opts.dot }) : null, label),
      h('div', { class: 'kpi-value' }, value, opts.unit ? h('small', null, opts.unit) : null),
      subNode != null ? h('div', { class: 'kpi-sub' }, subNode) : null,
      opts.extra || null);
  }
  function kpis(R, P) {
    var t = R.totals, pt = P ? P.totals : null;
    var denom = denomOf(t);
    var grid = h('div', { class: 'kpi-grid st-kpis' });

    // 출석률(주인공)
    var trend = trendSeries(R);
    var spark = h('div', { class: 'st-spark' });
    var hero = kpi('출석률', pct(t.rate), null, {
      cls: 'hero st-hero',
      extra: h('div', { class: 'st-hero-foot' },
        h('span', null, '출석 ' + n(t.attended) + ' / 대상 ' + n(denom) + '회'),
        pt ? delta(t.rate, pt.rate, true) : null)
    });
    hero.appendChild(spark);
    grid.appendChild(hero);
    var sv = trend.data.map(function (x) { return x.line; });
    if (charts().spark && sv.filter(function (v) { return v != null; }).length >= 2) {
      charts().spark(spark, { values: sv, color: 'rgba(255,255,255,.92)', height: 30, yMin: 0, yMax: 1 });
    }

    if (simple()) {
      var mo = R.money || { totals: { issuedAmount: 0, usedAmount: 0, remainingValue: 0 }, byMonth: [] };
      var lastM = mo.byMonth.length ? mo.byMonth[mo.byMonth.length - 1] : null;
      grid.appendChild(kpi('출석', n(t.attended), '서명 ' + n(t.signed) + ' · 직접 입력 ' + n(t.manual), { unit: '회', dot: 'st-present' }));
      grid.appendChild(kpi('당일취소', n(t.absent), t.absentAuto ? '고정 수업 기록 없음 ' + n(t.absentAuto) + '회 포함' : '1회씩 차감·금액 포함', { unit: '회', dot: 'st-absent' }));
      grid.appendChild(kpi('사용 금액', wonShort(mo.totals.usedAmount), '출석·당일취소 × 회당 금액', { cls: 'st-rev-total' }));
      grid.appendChild(kpi('발급 금액', wonShort(mo.totals.issuedAmount), '이용권 매출(달 기준)'));
      grid.appendChild(kpi('남은 횟수 가치', wonShort(mo.totals.remainingValue), '발급했지만 아직 안 쓴 횟수'));
      grid.appendChild(kpi('미발급', lastM ? n(lastM.notIssued) : '0', lastM ? lastM.label + ' 재원생 중' : '', { unit: '명' }));
      grid.appendChild(kpi('활성 수강생', n(t.activeStudents), '기간 중 출석 기록 있는 학생', { unit: '명' }));
      grid.appendChild(kpi('신규 / 퇴원', h('span', null, h('span', { class: 'st-plus' }, '+' + n(t.newStudents)), h('span', { class: 'st-slash' }, ' / '), h('span', { class: 'st-minus' }, '−' + n(t.leftStudents))), '등록일·퇴원일 기준', { unit: '명' }));
      return grid;
    }
    grid.appendChild(kpi('출석', n(t.attended), '정시 ' + n(t.present) + ' · 지각 ' + n(t.late), { unit: '회', dot: 'st-present' }));
    grid.appendChild(kpi('지각률', pct(t.lateRate), h('span', null, '지각 ' + n(t.late) + '회 ', pt ? delta(t.lateRate, pt.lateRate, false) : null), { dot: 'st-late' }));
    var absSub = t.absentAuto ? '기록 없어 자동 ' + n(t.absentAuto) + '회 포함' : '직접 기록한 결석';
    if (t.unmarked) absSub += ' · 미확인 ' + n(t.unmarked);
    grid.appendChild(kpi('결석', n(t.absent), absSub, { unit: '회', dot: 'st-absent' }));
    grid.appendChild(kpi('공결', n(t.excused), '출석률 계산에서 빠져요', { unit: '회', dot: 'st-excused' }));
    grid.appendChild(kpi('휴강', n(t.canceled), '학생별 회차 기준', { unit: '회', dot: 'st-canceled' }));
    var extra = [];
    if (t.trialHeld) extra.push('체험 ' + n(t.trialHeld));
    if (t.walkin) extra.push('이용권 출석 ' + n(t.walkin));
    grid.appendChild(kpi('보강 진행', n(t.makeupHeld), extra.length ? extra.join(' · ') : '보강 수업 출석', { unit: '회', dot: 'st-makeup' }));
    grid.appendChild(kpi('활성 수강생', n(t.activeStudents), '수업 ' + n(t.lessonsHeld) + '회 진행', { unit: '명' }));
    grid.appendChild(kpi('신규 / 퇴원', h('span', null, h('span', { class: 'st-plus' }, '+' + n(t.newStudents)), h('span', { class: 'st-slash' }, ' / '), h('span', { class: 'st-minus' }, '−' + n(t.leftStudents))), '등록일·퇴원일 기준', { unit: '명' }));
    var so = signOffsetText(t.avgSignOffsetMin);
    grid.appendChild(kpi('평균 서명 시각', so.value, so.sub));
    var sm = t.signed + t.manual;
    grid.appendChild(kpi('서명 비율', sm ? pct(t.signed / sm) : '–', '서명 ' + n(t.signed) + ' · 직접 입력 ' + n(t.manual)));
    return grid;
  }

  // 추이 단위: 2주 이하 = 날, 약 6개월 이하 = 주, 그 이상 = 달. 오늘 이후 칸은 뺀다.
  function trendSeries(R) {
    var today = U().today();
    var days = R.range.days;
    var out = [], unit;
    if (days <= 14) {
      unit = 'day';
      R.byDay.forEach(function (x) {
        if (x.date > today || !x.scheduled) return;
        out.push({ label: dayMD(x.date), bar: x.scheduled, line: x.rate, title: U().fmtDate(x.date) + ' · 출석 ' + x.attended + '/' + denomOf(x) });
      });
    } else if (days <= 190) {
      unit = 'week';
      R.byWeek.forEach(function (x) {
        if (x.weekStart > today) return;
        out.push({ label: x.label.replace(/주$/, ''), bar: x.scheduled, line: x.rate, title: U().fmtDate(x.weekStart, { weekday: false }) + '부터 한 주 · 출석 ' + x.attended + '/' + denomOf(x) });
      });
    } else {
      unit = 'month';
      R.byMonth.forEach(function (x) {
        if (x.ym > today.slice(0, 7)) return;
        out.push({ label: x.label, bar: x.scheduled, line: x.rate, title: '출석 ' + x.attended + '/' + denomOf(x) });
      });
    }
    return { unit: unit, data: out };
  }

  // ── 공용 조각 ─────────────────────────────────────────
  function card(title, sub, body, opts) {
    opts = opts || {};
    return h('section', { class: 'card st-card' + (opts.cls ? ' ' + opts.cls : '') },
      h('div', { class: 'card-h' }, h('h2', null, title), sub ? h('span', { class: 'muted' }, sub) : null, opts.action || null),
      body, opts.foot ? h('div', { class: 'st-foot' }, opts.foot) : null);
  }
  // 차트 카드: [표] 단추로 같은 값을 표로도 볼 수 있다(값이 색·말풍선에만 갇히지 않게)
  function chartCard(parent, title, sub, drawChart, tableFn, opts) {
    var body = h('div', { class: 'st-chart' });
    var tableBox = h('div', { class: 'st-ctable', hidden: true });
    var btn = tableFn ? h('button', {
      type: 'button', class: 'btn btn-sm btn-ghost st-tbl-btn', attrs: { 'aria-pressed': 'false' },
      onClick: function () {
        var on = tableBox.hidden;
        tableBox.hidden = !on;
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.classList.toggle('on', on);
        if (on && !tableBox.firstChild) tableBox.appendChild(tableFn());
      }
    }, ic('list', 16), '표') : null;
    var c = card(title, sub, h('div', null, body, tableBox), assign(opts || {}, { action: btn }));
    parent.appendChild(c);
    drawChart(body);
    return c;
  }
  function simpleTable(head, rows, opts) {
    opts = opts || {};
    var thead = h('thead', null, h('tr', null, head.map(function (c, i) { return h('th', { class: i ? 'num' : '' }, c); })));
    var tbody = h('tbody', null, rows.map(function (r) {
      return h('tr', null, r.map(function (c, i) { return h('td', { class: i ? 'num' : '' }, c); }));
    }));
    return h('div', { class: 'table-wrap st-twrap' }, h('table', { class: 'table sticky' }, thead, tbody));
  }
  function rateBar(r) {
    var tone = rateTone(r);
    return h('div', { class: 'bar-cell st-ratecell' },
      h('div', { class: 'progress' }, r == null ? null : h('span', { class: 'st-rt-' + tone, style: { width: Math.round(r * 100) + '%' } })),
      h('span', { class: 'st-rt-v' }, pct(r)));
  }
  function statusValues(c) {
    // 간단 모드: 옛 지각 기록은 출석에 합친다
    if (simple()) return { present: (c.present || 0) + (c.late || 0), late: 0, absent: c.absent || 0, unmarked: c.unmarked || 0, excused: c.excused || 0, canceled: c.canceled || 0 };
    return { present: c.present || 0, late: c.late || 0, absent: c.absent || 0, unmarked: c.unmarked || 0, excused: c.excused || 0, canceled: c.canceled || 0 };
  }
  function seriesUsed(list) {
    return ST_SERIES.filter(function (sr) {
      if (simple() && sr.key === 'late') return false;
      return list.some(function (c) { return (c[sr.key] || 0) > 0; });
    });
  }
  function goStudent(id) { if (id && DA.store.get('students', id)) ui.go('#/students/' + encodeURIComponent(id)); }

  // ── 탭: 개요 ─────────────────────────────────────────
  var PANELS = {};
  PANELS.overview = function (panel, R) {
    var t = R.totals;
    var C = charts();
    // 상태 구성(100% 누적 막대)
    chartCard(panel, '출결 구성', '전체 ' + n(t.scheduled) + '회', function (el) {
      if (C.stacked) {
        C.stacked(el, {
          data: [{ label: '', values: statusValues(t) }],
          series: seriesUsed([t]), percent: true, horizontal: true, barHeight: 24,
          format: function (v) { return n(v) + '회'; },
          ariaLabel: '출결 구성: ' + ST_SERIES.map(function (sr) { return sr.label + ' ' + n(t[sr.key]) + '회'; }).join(', ')
        });
      }
    }, function () {
      return simpleTable(['상태', '회', '비율'], ST_SERIES.map(function (sr) {
        return [sr.label, n(t[sr.key]), t.scheduled ? pct(t[sr.key] / t.scheduled) : '–'];
      }));
    }, {
      foot: (simple() ? '출석률 = 출석 ÷ (출석+당일취소+미확인). 휴강은 빼고 계산해요.' : '출석률 = (출석+지각) ÷ (출석+지각+결석+미확인). 공결·휴강은 빼고 계산해요.') +
        (t.absentAuto ? ' ' + absLabel() + ' 중 ' + n(t.absentAuto) + '회는 기록이 없어 자동으로 처리됐어요.' : '')
    });

    // 추이(비율 선 + 회차 막대, 위아래 두 칸)
    var tr = trendSeries(R);
    var unitName = tr.unit === 'day' ? '일별' : tr.unit === 'week' ? '주별' : '월별';
    chartCard(panel, unitName + ' 추이', '출석률과 수업 회차', function (el) {
      if (C.combo) {
        C.combo(el, {
          data: tr.data, lineLabel: '출석률', barLabel: '수업 회차',
          lineFormat: pct, barFormat: function (v) { return n(v); }, height: 220,
          emptyText: '아직 지난 수업이 없어요'
        });
      }
    }, function () {
      return simpleTable([tr.unit === 'week' ? '주 시작' : tr.unit === 'day' ? '날짜' : '월', '회차', '출석률'],
        tr.data.map(function (x) { return [x.label, n(x.bar), pct(x.line)]; }));
    });

    // 주의 학생 / 칭찬 학생
    var two = h('div', { class: 'st-two' });
    panel.appendChild(two);
    var risk = R.atRisk;
    var riskList = h('div', { class: 'st-people' });
    var shown = S.riskAll ? risk : risk.slice(0, 6);
    shown.forEach(function (x) {
      var s = DA.store.get('students', x.studentId);
      riskList.appendChild(h('button', { type: 'button', class: 'st-person risk', onClick: function () { goStudent(x.studentId); } },
        ui.avatar(x.name, s ? ui.studentColor(s) : null),
        h('div', { class: 'st-pmain' },
          h('div', { class: 'st-pname' }, x.name),
          h('div', { class: 'st-reasons' }, x.reasons.map(function (r) { return h('span', { class: 'st-reason r-' + r.code }, r.text); }))),
        ic('chevR', 18)));
    });
    two.appendChild(card('주의가 필요한 학생', risk.length ? n(risk.length) + '명' : '',
      risk.length ? riskList : ui.empty('check', '걱정할 학생이 없어요', '연속 결석·낮은 출석률·수강권 부족이 생기면 여기에 알려 드려요.'),
      {
        cls: 'st-risk',
        foot: risk.length > 6 ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: function () { setState({ riskAll: !S.riskAll }); } },
          S.riskAll ? '접기' : '모두 보기 (' + n(risk.length) + '명)') : null
      }));

    var stars = R.stars;
    var starList = h('div', { class: 'st-people' });
    stars.forEach(function (x, i) {
      var s = DA.store.get('students', x.studentId);
      starList.appendChild(h('button', { type: 'button', class: 'st-person star', onClick: function () { goStudent(x.studentId); } },
        ui.avatar(x.name, s ? ui.studentColor(s) : null),
        h('div', { class: 'st-pmain' },
          h('div', { class: 'st-pname' }, x.name, i < 3 ? h('span', { class: 'st-medal m' + (i + 1), attrs: { 'aria-label': (i + 1) + '위' } }, String(i + 1)) : null),
          h('div', { class: 'st-psub' }, x.text)),
        h('span', { class: 'st-star-ic' }, ic('star', 18))));
    });
    two.appendChild(card('칭찬 학생', stars.length ? '연속 출석 순' : '',
      stars.length ? starList : ui.empty('star', '아직 칭찬 학생이 없어요', '5회 넘게 연속 출석하거나 이 기간 개근하면 여기에 올라와요.'),
      { cls: 'st-stars' }));
  };

  // ── 탭: 학생별 ───────────────────────────────────────
  var STU_COLS_FULL = [
    { key: 'name', label: '이름', type: 'str' },
    { key: 'scheduled', label: '예정' },
    { key: 'attended', label: '출석' },
    { key: 'late', label: '지각' },
    { key: 'absent', label: '결석' },
    { key: 'excused', label: '공결' },
    { key: 'rate', label: '출석률', cls: 'st-col-rate' },
    { key: 'streak', label: '연속' },
    { key: 'makeupOwed', label: '보강 필요' },
    { key: 'pass', label: '수강권', type: 'pass' },
    { key: 'lastAttended', label: '최근 출석', type: 'date' }
  ];
  // v1.1 간단 모드: 지각·공결·보강 없이, 반과 금액 열
  var STU_COLS_SIMPLE = [
    { key: 'name', label: '이름', type: 'str' },
    { key: 'courseName', label: '반', type: 'str' },
    { key: 'attended', label: '출석' },
    { key: 'absent', get label() { return absLabel(); } },
    { key: 'rate', label: '출석률', cls: 'st-col-rate' },
    { key: 'pass', label: '이번 달', type: 'pass' },
    { key: 'usedAmount', label: '사용 금액', type: 'won' },
    { key: 'issuedAmount', label: '발급 금액', type: 'won' },
    { key: 'lastAttended', label: '최근 출석', type: 'date' }
  ];
  function stuCols() { return simple() ? STU_COLS_SIMPLE : STU_COLS_FULL; }
  function sortVal(e, col) {
    if (col.key === 'name') return e.name || '';
    if (col.key === 'courseName') return e.courseName || '';
    if (col.key === 'pass') {
      var p = e.pass || {};
      if (p.type === 'month') return p.status === 'none' ? -1000 : p.remaining;
      if (p.type === 'count') return p.remaining == null ? null : p.remaining;
      if (p.type === 'monthly') return p.total ? (p.total - p.used) : null;
      return null;
    }
    if (col.key === 'lastAttended') return e.lastAttended || null;
    return e[col.key] == null ? null : e[col.key];
  }
  function stuCell(col, e, stu, tag) {
    var k = col.key, pass = e.pass || {};
    if (k === 'name') {
      return h('td', { class: 'st-name' },
        h('span', { class: 'st-sw', style: { background: stu ? ui.studentColor(stu) : 'var(--text-3)' } }),
        h('span', { class: 'st-nm' }, e.name),
        tag ? h('span', { class: 'st-tag' }, tag) : null);
    }
    if (k === 'courseName') return h('td', { class: 'st-course' }, e.courseName && e.courseName !== '미지정' ? e.courseName : h('span', { class: 'faint' }, '—'));
    if (k === 'rate') return h('td', { class: 'st-col-rate' }, rateBar(e.rate));
    if (k === 'absent') return h('td', { class: 'num' + (e.absent ? ' st-bad' : ' faint') }, n(e.absent), e.absentAuto ? h('small', { class: 'st-auto', attrs: { title: '자동 결석 포함' } }, '자동 ' + e.absentAuto) : null);
    if (k === 'streak') return h('td', { class: 'num' }, e.streak ? n(e.streak) + '회' : h('span', { class: 'faint' }, '0'));
    if (k === 'makeupOwed') return h('td', { class: 'num' + (e.makeupOwed ? ' st-warn' : ' faint') }, n(e.makeupOwed));
    if (k === 'pass') return h('td', { class: 'num' }, pass.type && pass.type !== 'none' ? h('span', { class: 'st-pass' + (pass.warn ? ' warn' : '') + (pass.status === 'over' ? ' over' : '') }, pass.label) : h('span', { class: 'faint' }, '—'));
    if (k === 'lastAttended') return h('td', { class: 'num' }, e.lastAttended ? U().fmtDate(e.lastAttended, { weekday: false, year: 'auto' }) : h('span', { class: 'faint' }, '—'));
    if (col.type === 'won') return h('td', { class: 'num' + (e[k] ? '' : ' faint') }, e[k] ? n(e[k]) : '0');
    var faint = (k === 'late' || k === 'excused') && !e[k];
    return h('td', { class: 'num' + (faint ? ' faint' : '') }, n(e[k]));
  }
  PANELS.students = function (panel, R) {
    var all = R.byStudent;
    var COLS = stuCols();
    var tools = h('div', { class: 'st-stools' });
    var search = ui.input({
      type: 'search', value: S.q, placeholder: '이름 검색 (초성 가능)',
      onInput: function (v) { S.q = v; fillBody(); }
    });
    search.id = 'st-search';
    search.setAttribute('aria-label', '학생 이름 검색');
    tools.appendChild(h('div', { class: 'input-group st-search' }, h('span', { class: 'ic' }, ic('search', 18)), search));
    tools.appendChild(ui.segmented([{ value: false, label: '재원생' }, { value: true, label: '전체' }], S.stuAll, function (v) { S.stuAll = v; fillBody(); }));
    panel.appendChild(tools);

    var countEl = h('div', { class: 'st-count muted small' });
    panel.appendChild(countEl);

    var headRow = h('tr');
    COLS.forEach(function (col) {
      var on = S.sortKey === col.key;
      var th = h('th', {
        class: 'sortable' + (col.type === 'str' ? '' : ' num') + (on ? (S.sortDir > 0 ? ' sort-asc' : ' sort-desc') : '') + (col.cls ? ' ' + col.cls : ''),
        attrs: { tabindex: '0', role: 'columnheader', 'aria-sort': on ? (S.sortDir > 0 ? 'ascending' : 'descending') : 'none' },
        onClick: function () { toggleSort(col); },
        onKeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSort(col); } }
      }, col.label);
      headRow.appendChild(th);
    });
    function toggleSort(col) {
      if (S.sortKey === col.key) S.sortDir = -S.sortDir;
      else { S.sortKey = col.key; S.sortDir = (col.type === 'str' || col.type === 'pass') ? 1 : -1; }
      var y = window.pageYOffset;
      ui.clear(panel);
      PANELS.students(panel, R);
      window.scrollTo(0, y);
    }
    var tbody = h('tbody');
    var tfoot = h('tfoot');
    var table = h('table', { class: 'table sticky st-stable' }, h('thead', null, headRow), tbody, tfoot);
    panel.appendChild(h('div', { class: 'table-wrap tall st-twrap' }, table));
    panel.appendChild(h('p', { class: 'st-note' }, simple()
      ? '행을 누르면 그 학생의 상세 화면으로 가요. 사용 금액 = 출석·당일취소 횟수 × 그 달 회당 금액. 금액은 기간에 걸친 달 기준이에요.'
      : '행을 누르면 그 학생의 상세 화면으로 가요. 연속 출석은 오늘까지의 전체 기록 기준이에요.'));

    function fillBody() {
      ui.clear(tbody); ui.clear(tfoot);
      var q = (S.q || '').trim();
      var list = all.filter(function (e) {
        if (!S.stuAll && e.status !== 'active') return false;
        if (q && !U().matchName(e.name, q)) return false;
        return true;
      });
      var col = COLS.filter(function (c) { return c.key === S.sortKey; })[0] || COLS[0];
      var dir = S.sortDir;
      list = list.slice().sort(function (a, b) {
        var va = sortVal(a, col), vb = sortVal(b, col);
        if (va == null && vb == null) return U().collate(a.name, b.name);
        if (va == null) return 1;
        if (vb == null) return -1;
        var c = typeof va === 'string' ? (col.type === 'str' ? U().collate(va, vb) : (va < vb ? -1 : va > vb ? 1 : 0)) : va - vb;
        return c * dir || U().collate(a.name, b.name);
      });
      countEl.textContent = list.length === all.length ? n(list.length) + '명' : n(list.length) + '명 / 전체 ' + n(all.length) + '명';
      if (!list.length) {
        tbody.appendChild(h('tr', null, h('td', { attrs: { colspan: COLS.length }, class: 'st-none' },
          q ? '‘' + q + '’에 맞는 학생이 없어요' : (S.stuAll ? '이 기간에 수업이 있던 학생이 없어요' : '재원생 기록이 없어요. ‘전체’를 눌러 보세요'))));
        return;
      }
      var frag = document.createDocumentFragment();
      var sum = { scheduled: 0, attended: 0, late: 0, absent: 0, excused: 0, unmarked: 0, makeupOwed: 0, usedAmount: 0, issuedAmount: 0 };
      list.forEach(function (e) {
        for (var k in sum) sum[k] += e[k] || 0;
        var stu = DA.store.get('students', e.studentId);
        var tag = e.status === 'paused' ? '휴원' : e.status === 'left' ? '퇴원' : e.status === 'deleted' ? '삭제됨' : '';
        var tr = h('tr', {
          class: stu ? 'tap' : 'st-deleted',
          attrs: stu ? { tabindex: '0', 'aria-label': e.name + ' 상세 보기' } : null,
          onClick: stu ? function () { goStudent(e.studentId); } : null,
          onKeydown: stu ? function (ev) { if (ev.key === 'Enter') goStudent(e.studentId); } : null
        }, COLS.map(function (c) { return stuCell(c, e, stu, tag); }));
        frag.appendChild(tr);
      });
      tbody.appendChild(frag);
      var denom = sum.attended + sum.absent + sum.unmarked;
      tfoot.appendChild(h('tr', null, COLS.map(function (c) {
        if (c.key === 'name') return h('td', { class: 'st-name' }, '합계');
        if (c.key === 'rate') return h('td', { class: 'st-col-rate' }, rateBar(denom ? sum.attended / denom : null));
        if (sum[c.key] != null) return h('td', { class: 'num' }, n(sum[c.key]));
        return h('td');
      })));
    }
    fillBody();
  };

  // ── 탭: 요일·시간 ────────────────────────────────────
  PANELS.time = function (panel, R) {
    var C = charts();
    var wd = R.byWeekday;
    var two = h('div', { class: 'st-two' });
    panel.appendChild(two);
    chartCard(two, '요일별 출석률', null, function (el) {
      if (C.bar) {
        C.bar(el, {
          data: wd.map(function (x) {
            var d = denomOf(x);
            return { label: x.label, value: x.rate, title: d ? '출석 ' + x.attended + ' / 대상 ' + d + '회' : '수업 없음' };
          }),
          max: 1, format: pct, height: 170, valueLabels: true, ariaLabel: '요일별 출석률: ' + wd.map(function (x) { return x.label + ' ' + pct(x.rate); }).join(', ')
        });
      }
    }, function () {
      return simpleTable(['요일', '대상', '출석', '지각', absLabel(), '출석률'], wd.map(function (x) {
        return [x.label, n(denomOf(x)), n(x.attended), n(x.late), n(x.absent + (x.unmarked || 0)), pct(x.rate)];
      }));
    });

    var hrs = R.byHour;
    chartCard(two, '시간대별 수업·출석', '시작 시각 기준', function (el) {
      if (C.stacked) {
        C.stacked(el, {
          data: hrs.map(function (x) { return { label: x.hour + '시', values: statusValues(x) }; }),
          series: seriesUsed(hrs), height: 170, format: function (v) { return n(v); },
          emptyText: '이 기간에 수업이 없어요'
        });
      }
    }, function () {
      return simpleTable(['시간', '대상', '출석', absLabel(), '출석률'], hrs.map(function (x) {
        return [x.label, n(denomOf(x)), n(x.attended), n(x.absent + (x.unmarked || 0)), pct(x.rate)];
      }));
    });

    // 요일 × 시간 히트맵
    var hm = R.heatmap;
    var rowsIdx = [];
    hm.cells.forEach(function (row, i) { if (row.some(function (c) { return c.scheduled > 0; })) rowsIdx.push(i); });
    var minRate = 1;
    hm.cells.forEach(function (row) { row.forEach(function (c) { if (c.rate != null && c.rate < minRate) minRate = c.rate; }); });
    var lo = Math.max(0, Math.min(0.5, Math.floor(minRate * 10) / 10));
    chartCard(panel, '요일 × 시간 출석률', '진할수록 잘 나와요', function (el) {
      if (C.heatmap) {
        C.heatmap(el, {
          rows: rowsIdx.map(function (i) { return hm.labels[i]; }),
          cols: hm.hours.map(function (x) { return x + '시'; }),
          cells: rowsIdx.map(function (i) {
            return hm.cells[i].map(function (c) {
              var d = c.scheduled;
              return { value: c.rate, title: d ? '출석 ' + c.attended + '회 · 예정 ' + d + '회' : '' };
            });
          }),
          format: pct, min: lo, max: 1, minLabel: pct(lo), maxLabel: '100%',
          ariaLabel: '요일과 시간대별 출석률 히트맵'
        });
      }
    }, function () {
      var head = ['요일'].concat(hm.hours.map(function (x) { return x + '시'; }));
      return simpleTable(head, rowsIdx.map(function (i) {
        return [hm.labels[i]].concat(hm.cells[i].map(function (c) { return c.scheduled ? pct(c.rate) : '·'; }));
      }));
    });
  };

  // ── 탭: 강사·과정·레벨·방·종류 ───────────────────────
  PANELS.groups = function (panel, R) {
    var C = charts();
    var dim = DIMS.filter(function (x) { return x.value === S.dim; })[0] || DIMS[0];
    var seg = ui.segmented(DIMS.map(function (x) { return { value: x.value, label: x.label }; }), dim.value, function (v) {
      S.dim = v; savePrefs();
      ui.clear(panel); PANELS.groups(panel, R);
    });
    seg.classList.add('st-dimseg');
    panel.appendChild(h('div', { class: 'st-dimbar' }, seg));

    var list = arr(R[dim.key]).filter(function (g) { return g.rows > 0; });
    function colorOf(g) {
      if (g.color) return g.color;
      if (dim.value === 'teacher' && g.id) return ui.teacherColor(g.id);
      if (dim.value === 'course' && g.id) return ui.courseColor(g.id);
      if (!g.id) return 'var(--st-unmarked)';
      return 'var(--accent)';
    }
    if (!list.length) {
      panel.appendChild(h('div', { class: 'card' }, ui.empty('users', dim.label + '별로 볼 기록이 없어요', '기간이나 필터를 바꿔 보세요.')));
      return;
    }
    var two = h('div', { class: 'st-two' });
    panel.appendChild(two);
    chartCard(two, dim.label + '별 출석률', null, function (el) {
      if (C.bar) {
        C.bar(el, {
          horizontal: true, track: true, max: 1, format: pct,
          data: list.map(function (g) { return { label: g.name, value: g.rate, color: colorOf(g), title: '출석 ' + g.attended + ' / 대상 ' + denomOf(g) + '회' }; })
        });
      }
    }, null);
    chartCard(two, dim.label + '별 출결 회차', null, function (el) {
      if (C.stacked) {
        C.stacked(el, {
          horizontal: true, format: function (v) { return n(v); },
          data: list.map(function (g) { return { label: g.name, values: statusValues(g) }; }),
          series: seriesUsed(list)
        });
      }
    }, null);

    var head = [dim.label, '학생', '수업', '대상', '출석', '지각', absLabel(), '공결', '휴강', '출석률'];
    var rows = list.map(function (g) {
      return [
        h('span', { class: 'st-gname' }, h('span', { class: 'st-sw', style: { background: colorOf(g) } }), g.name),
        n(g.students), n(g.lessons), n(denomOf(g)), n(g.attended), n(g.late), n(g.absent + (g.unmarked || 0)), n(g.excused), n(g.canceled),
        rateBar(g.rate)
      ];
    });
    panel.appendChild(card(dim.label + '별 자세히', n(list.length) + '개', simpleTable(head, rows), {
      cls: 'st-flush',
      foot: dim.value === 'course' || dim.value === 'level' ? '과정·레벨은 학생에게 지정된 값 기준이에요.' :
        dim.value === 'kind' ? '정규·보강·특강·체험·이용권 출석을 나눠 봐요.' : '수업에 지정된 ' + dim.label + ' 기준이에요.'
    }));
  };

  // ── 탭: 월별 추이 ────────────────────────────────────
  PANELS.monthly = function (panel, R) {
    var C = charts();
    var nowYm = U().today().slice(0, 7);
    var months = R.byMonth.filter(function (x) { return x.ym <= nowYm; });
    if (!months.length || !months.some(function (x) { return x.rows > 0; })) {
      panel.appendChild(h('div', { class: 'card' }, ui.empty('trend', '월별로 볼 기록이 없어요', '‘최근 3개월’이나 ‘올해’처럼 기간을 넓혀 보세요.')));
      return;
    }
    if (months.length === 1) {
      panel.appendChild(ui.banner('info', '한 달만 들어 있어요. ‘최근 3개월’·‘올해’·‘전체’를 고르면 흐름이 보여요.', {
        action: { label: '최근 3개월', onClick: function () { setState({ preset: 'last3m' }); } }
      }));
    }
    chartCard(panel, '월별 출결 구성', '학생별 수업 회차', function (el) {
      if (C.stacked) {
        C.stacked(el, {
          data: months.map(function (x) { return { label: x.label, values: statusValues(x) }; }),
          series: seriesUsed(months), height: 200, format: function (v) { return n(v); }
        });
      }
    }, null);
    var rates = months.map(function (x) { return x.rate; }).filter(function (v) { return v != null; });
    var minR = rates.length ? Math.min.apply(null, rates) : 0;
    var yMin = Math.max(0, Math.floor((minR - 0.05) * 10) / 10);
    chartCard(panel, '월별 출석률', null, function (el) {
      if (C.line) {
        C.line(el, {
          data: months.map(function (x) { return { label: x.label, value: x.rate, title: '출석 ' + x.attended + ' / 대상 ' + denomOf(x) + '회' }; }),
          format: pct, yMin: yMin, yMax: 1, height: 170, seriesLabel: '출석률'
        });
      }
    }, null);
    var head = simple() ? ['월', '대상', '출석', '당일취소', '출석률'] : ['월', '대상', '출석', '지각', '결석', '공결', '휴강', '수업', '출석률'];
    var rows = months.slice().reverse().map(function (x) {
      if (simple()) return [x.label, n(denomOf(x)), n(x.attended), n(x.absent + (x.unmarked || 0)), rateBar(x.rate)];
      return [x.label, n(denomOf(x)), n(x.attended), n(x.late), n(x.absent + (x.unmarked || 0)), n(x.excused), n(x.canceled), n(x.lessons), rateBar(x.rate)];
    });
    panel.appendChild(card('월별 표', '최근 달부터', simpleTable(head, rows), { cls: 'st-flush' }));
  };

  // ── 탭: 금액(v1.1: 이용권 발급 = 매출, 출석·당일취소 = 사용 금액) ──────────
  PANELS.revenue = function (panel, R) {
    var C = charts();
    var rv = R.revenue;
    var mo = R.money || { totals: { issuedAmount: 0, issuedCount: 0, usedAmount: 0, used: 0, remainingValue: 0 }, byMonth: [], byProduct: [] };
    var mt = mo.totals;
    if (S.roomId || S.kinds.length) {
      panel.appendChild(ui.banner('info', '금액은 이용권(달) 기준이라 방·수업 종류 필터는 적용되지 않아요.'));
    }
    if (!rv.count && !mt.issuedAmount && !mt.used) {
      panel.appendChild(h('div', { class: 'card' }, ui.empty('card', '이 기간에 이용권 발급 기록이 없어요', '수강생 화면의 [이용권 발급]으로 달마다 횟수를 충전하면 금액 합계가 보여요.',
        { label: '수강생으로 가기', icon: 'users', onClick: function () { ui.go('#/students'); } })));
      return;
    }
    panel.appendChild(h('div', { class: 'kpi-grid st-rev-kpis' },
      kpi('발급 금액 (매출)', wonShort(rv.total), won(rv.total), { cls: 'st-rev-total' }),
      kpi('사용 금액', wonShort(mt.usedAmount), won(mt.usedAmount) + ' · ' + n(mt.used) + '회'),
      kpi('남은 횟수 가치', wonShort(mt.remainingValue), '발급 ' + n(mt.issuedCount) + '회 중 안 쓴 몫'),
      kpi('결제', n(rv.count), '결제한 학생 ' + n(rv.payers) + '명', { unit: '건' })));
    if (R.range.days < 28) panel.appendChild(ui.banner('info', '금액은 달 단위로 모아요. 이 기간이 걸친 달 전체(' + mo.byMonth.map(function (x) { return x.label; }).join('·') + ') 금액이에요.'));

    var nowYm = U().today().slice(0, 7);
    var months = mo.byMonth.filter(function (x) { return x.ym <= nowYm; });
    var revByYm = {};
    rv.byMonth.forEach(function (x) { revByYm[x.ym] = x; });
    chartCard(panel, '월별 매출', '이용권 발급 기준(대상 월)', function (el) {
      if (C.bar) {
        C.bar(el, {
          data: months.map(function (x) { var r0 = revByYm[x.ym] || { amount: 0, count: 0 }; return { label: x.label, value: r0.amount, title: won(r0.amount) + ' · ' + (r0.count || 0) + '건' }; }),
          format: wonShort, height: 180, color: 'var(--accent)', integer: false
        });
      }
    }, null);
    chartCard(panel, '월별 사용 금액', '출석·당일취소 × 회당 금액', function (el) {
      if (C.bar) {
        C.bar(el, {
          data: months.map(function (x) { return { label: x.label, value: x.usedAmount, color: 'var(--st-present)', title: won(x.usedAmount) + ' · ' + x.used + '회' }; }),
          format: wonShort, height: 180, integer: false
        });
      }
    }, null);
    panel.appendChild(card('월별 금액 표', '최근 달부터', simpleTable(['월', '매출', '사용 금액', '사용', absLabel(), '남은 가치', '미발급'],
      months.slice().reverse().map(function (x) {
        var r0 = revByYm[x.ym] || { amount: 0 };
        return [x.label, won(r0.amount), won(x.usedAmount), n(x.used) + '회', n(x.absent) + '회', won(x.remainingValue), x.notIssued ? n(x.notIssued) + '명' : '—'];
      })), { cls: 'st-flush' }));

    var two = h('div', { class: 'st-two' });
    panel.appendChild(two);
    var prods = mo.byProduct.filter(function (x) { return x.issuedAmount || x.usedAmount; });
    chartCard(two, '반(이용권)별 합계', '발급 금액', function (el) {
      if (C.bar) {
        C.bar(el, {
          horizontal: true, format: wonShort,
          data: prods.map(function (x) {
            return { label: x.name, value: x.issuedAmount, color: x.color || (x.id ? ui.courseColor(x.id) : 'var(--st-unmarked)'), title: '발급 ' + won(x.issuedAmount) + ' · 사용 ' + won(x.usedAmount) };
          })
        });
      }
    }, function () {
      return simpleTable(['반', '학생', '발급 금액', '사용 금액'], prods.map(function (x) { return [x.name, n(x.students) + '명', won(x.issuedAmount), won(x.usedAmount)]; }));
    });
    chartCard(two, '결제 수단', null, function (el) {
      if (C.donut) {
        C.donut(el, {
          data: rv.byMethod.map(function (x) { return { label: x.name, value: x.amount, color: METHOD_COLORS[x.name] || 'var(--pm-etc)', title: x.count + '건' }; }),
          size: 150, centerText: wonShort(rv.total), centerSub: '총 매출', format: won
        });
      }
    }, function () {
      return simpleTable(['수단', '건수', '금액'], rv.byMethod.map(function (x) { return [x.name, n(x.count), won(x.amount)]; }));
    });
    if (prods.length) {
      panel.appendChild(card('반별 표', null, simpleTable(['반', '학생', '발급 횟수', '발급 금액', '사용', '사용 금액'],
        prods.map(function (x) { return [x.name, n(x.students) + '명', n(x.issuedCount) + '회', won(x.issuedAmount), n(x.used) + '회', won(x.usedAmount)]; })), { cls: 'st-flush' }));
    }
  };

  ui.registerView('stats', {
    title: '통계',
    tab: { label: '통계', icon: 'chart', order: 4 },
    owner: true,   // v1.2: 강사 모드에서는 숨김(금액 포함)
    render: function (container, params) {
      renderView(container, params);
      return function () { if (charts().hideTips) charts().hideTips(); };
    },
    onLeave: function () { if (charts().hideTips) charts().hideTips(); }
  });

  // 테스트·다른 화면용(선택)
  DA.statsView = { state: S, getReport: getReport, saveText: saveText };
})(window.DA = window.DA || {});
