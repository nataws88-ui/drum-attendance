/* 드럼 출석부 — 오늘 화면 (SPEC §6.1)
 * 머리(학원 이름·날짜 이동·진행 막대·키오스크/명단 외 출석) + 시간순 수업 묶음 + 학생 카드(탭=서명, 길게/⋯=메뉴).
 * 첫 실행 환영 카드, 휴원일·백업·임시 저장 배너, 지금 진행 중/다음 수업 안내.
 */
(function (DA) {
  'use strict';
  var ui = DA.ui;
  if (!ui || !ui.registerView) return;
  var h = ui.h;

  /* ---------------- 보기 상태(다시 그려도 유지) ---------------- */
  var state = {
    date: null,            // null = 항상 오늘을 따라감
    lastQueryHash: null,   // #/today?date=… 를 한 번만 적용
    scrolledFor: null,     // 진행 중 수업으로 자동 스크롤한 날짜
    demoLoading: false
  };
  var SNOOZE_KEY = 'da.backupSnooze';
  var LONG_MS = 500;

  /* ---------------- 도우미 ---------------- */
  function U() { return DA.util; }
  function SC() { return DA.schedule; }
  function data() { return (DA.store && DA.store.data) || { settings: {}, students: [], lessons: [], exceptions: [], attendance: [], payments: [] }; }
  function settings() { return data().settings || {}; }
  function ic(n, s) { return ui.icon ? ui.icon(n, s) : h('span'); }
  function logErr(e, w) { if (ui._logErr) ui._logErr(e, 'today.' + (w || '')); }
  function todayYmd() { return U().today(); }
  function simple() { return settings().simpleMode !== false; }
  // v1.1: 이용권 출석용 walkin 수업은 '오늘 출석' 목록에서 보여 주고 수업 묶음에서는 뺀다
  function isPassUse(occ) {
    if (!occ || occ.srcType !== 'extra' || occ.kind !== 'walkin') return false;
    var ex = DA.store.get('exceptions', occ.srcId);
    return !ex || !!ex.passUse;
  }
  function curDate() { return state.date || todayYmd(); }
  function nowMinOf(d) { return d.getHours() * 60 + d.getMinutes(); }
  function startMin(o) { return o.startMin != null ? o.startMin : U().hm2min(o.start); }
  function endMin(o) { return o.endMin != null ? o.endMin : startMin(o) + (+o.duration || 0); }
  function fmtLeft(min) {
    min = Math.max(0, Math.round(min));
    if (min < 1) return '곧';
    return U().fmtDuration ? U().fmtDuration(min) : min + '분';
  }
  function ls(get, k, v) {
    try {
      if (get) return window.localStorage.getItem(k);
      if (v == null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v);
    } catch (e) { /* 저장소 막힘: 무시 */ }
    return null;
  }
  function studentSub(s) {
    var p = [];
    if (s.courseId) p.push(ui.nameOf('course', s.courseId));
    if (s.levelId) p.push(ui.nameOf('level', s.levelId));
    return p.join(' · ');
  }
  function occTitle(occ) {
    try { return SC().lessonLabel(data(), occ); } catch (e) { return occ.title || '수업'; }
  }
  function toastErr(e, fallback) {
    logErr(e);
    ui.toast((e && e.message) || fallback || '처리하지 못했어요', { kind: 'error' });
  }
  function hasRealData() {
    var d = data();
    function real(list) { return (list || []).some(function (x) { return x && !x.demo; }); }
    return real(d.students) || real(d.attendance) || real(d.lessons);
  }

  /* ---------------- 하루 계산 ---------------- */
  function buildDay(date, now) {
    var d = data();
    var occs = [], rows = [];
    try { occs = (SC().occurrencesOn(d, date) || []).filter(function (o) { return !isPassUse(o); }); } catch (e) { logErr(e, 'occurrencesOn'); }
    try { rows = (SC().rows(d, date, date, now) || []).filter(function (r) { return !isPassUse(r.occ); }); } catch (e2) { logErr(e2, 'rows'); }
    var groups = [], byKey = new Map();
    occs.forEach(function (o) { var g = { occ: o, rows: [] }; groups.push(g); byKey.set(o.key, g); });
    rows.forEach(function (r) {
      var g = byKey.get(r.occ.key);
      if (!g) { g = { occ: r.occ, rows: [], orphanGroup: true }; groups.push(g); byKey.set(r.occ.key, g); }
      g.rows.push(r);
    });
    groups.sort(function (a, b) {
      var x = startMin(a.occ) - startMin(b.occ);
      if (x) return x;
      if (a.occ.srcType !== b.occ.srcType) return a.occ.srcType === 'lesson' ? -1 : 1;
      return a.occ.srcId < b.occ.srcId ? -1 : a.occ.srcId > b.occ.srcId ? 1 : 0;
    });
    var c = { total: 0, attended: 0, present: 0, late: 0, absent: 0, excused: 0, pending: 0, upcoming: 0, unmarked: 0, canceled: 0 };
    rows.forEach(function (r) {
      if (r.status === 'canceled') { c.canceled++; return; }
      c.total++;
      if (c[r.status] != null) c[r.status]++;
    });
    c.attended = c.present + c.late;
    return { groups: groups, counts: c, occs: occs };
  }

  function nowInfo(groups, now) {
    var nm = nowMinOf(now), running = [], next = null, remaining = 0;
    groups.forEach(function (g) {
      var o = g.occ;
      if (o.canceled || g.orphanGroup) return;
      var s = startMin(o), e = endMin(o);
      if (s <= nm && nm < e) running.push(g);
      else if (s > nm) { remaining++; if (!next || s < startMin(next.occ)) next = g; }
    });
    return { nowMin: nm, running: running, next: next, remaining: remaining };
  }

  // 오늘 이후 가장 가까운 수업이 있는 날(최대 21일)
  function nextDayWithLessons(from) {
    try {
      var to = U().addDays(from, 21);
      var list = SC().occurrencesBetween(data(), U().addDays(from, 1), to) || [];
      for (var i = 0; i < list.length; i++) if (!list[i].canceled) return list[i];
    } catch (e) { logErr(e, 'nextDay'); }
    return null;
  }

  /* ---------------- 날짜 바꾸기 ---------------- */
  function setDate(ymd) {
    if (!ymd || !U().isYmd(ymd)) return;
    state.date = ymd === todayYmd() ? null : ymd;
    state.scrolledFor = null;
    var cur = ui.current();
    // 주소에 ?date= 가 붙어 있으면 떼어 내 다시 그릴 때 덮어쓰지 않게 한다
    if (cur && cur.params && cur.params.query && cur.params.query.date) {
      ui.go('#/today', { replace: true });
      return;
    }
    ui.refresh();
    try { window.scrollTo(0, 0); } catch (e) { /* 무시 */ }
  }
  function shiftDate(n) { ui.haptic('select'); setDate(U().addDays(curDate(), n)); }

  /* ---------------- 머리 ---------------- */
  function renderHeader(date, isToday, counts) {
    var s = settings();
    var rel = U().relDay ? U().relDay(date) : (isToday ? '오늘' : '');

    var dateInput = h('input', {
      class: 'td-date-input', type: 'date', value: date,
      attrs: { 'aria-label': '날짜 고르기' },
      onChange: function () { if (dateInput.value) setDate(dateInput.value); },
      onClick: function () { try { if (dateInput.showPicker) dateInput.showPicker(); } catch (e) { /* 지원 안 함: 기본 동작 */ } }
    });
    var dateBtn = h('label', { class: 'td-date' + (isToday ? ' is-today' : '') },
      h('span', { class: 'td-date-main' }, U().fmtDate(date, { weekday: true, year: 'auto' })),
      rel ? h('span', { class: 'td-rel' + (isToday ? ' on' : '') }, rel) : null,
      h('span', { class: 'td-date-ic' }, ic('chevD', 16)),
      dateInput);

    var datebar = h('div', { class: 'td-datebar' },
      h('button', { class: 'btn btn-icon td-nav', type: 'button', attrs: { 'aria-label': '전날' }, onClick: function () { shiftDate(-1); } }, ic('chevL', 22)),
      dateBtn,
      h('button', { class: 'btn btn-icon td-nav', type: 'button', attrs: { 'aria-label': '다음 날' }, onClick: function () { shiftDate(1); } }, ic('chevR', 22)),
      !isToday ? h('button', { class: 'btn btn-sm btn-soft td-today-btn', type: 'button', onClick: function () { ui.haptic('select'); setDate(todayYmd()); } }, '오늘') : null);

    var actions = h('div', { class: 'topbar-actions' },
      simple() ? null : h('button', {
        class: 'btn btn-sm td-act', type: 'button', attrs: { 'aria-label': '명단 외 출석' },
        onClick: function () { runWalkin(); }
      }, ic('user-plus', 18), h('span', { class: 'td-act-lbl' }, '명단 외')),
      ui.moduleOn('kiosk') ? h('button', {
        class: 'btn btn-sm btn-soft td-act', type: 'button', attrs: { 'aria-label': '키오스크 모드' },
        onClick: function () { ui.haptic('light'); ui.go('#/kiosk'); }
      }, ic('kiosk', 18), h('span', { class: 'td-act-lbl' }, '키오스크')) : null);

    var title = h('div', { class: 'grow td-title-wrap' },
      h('h1', { class: 'topbar-title' }, s.academyName || '드럼 학원'),
      h('div', { class: 'topbar-sub' }, isToday ? '오늘의 출석부' : (date < todayYmd() ? '지난 날 출석부' : '앞으로의 수업')));

    var head = h('header', { class: 'topbar td-top' },
      h('div', { class: 'topbar-row' }, title, actions),
      h('div', { class: 'full' }, datebar));

    if (counts.total > 0 || counts.canceled > 0) head.appendChild(h('div', { class: 'full' }, renderProgress(counts)));
    return head;
  }

  function renderProgress(c) {
    var tot = c.total;
    function seg(cls, n) { return n > 0 && tot > 0 ? h('span', { class: cls, style: { width: (n / tot * 100) + '%' } }) : null; }
    var done = tot > 0 && c.attended + c.absent + c.excused + c.unmarked >= tot;
    var bits = [];
    if (c.late && !simple()) bits.push(h('span', { class: 'td-pc' }, h('i', { class: 'dot st-late' }), '지각 ' + c.late));
    if (c.absent) bits.push(h('span', { class: 'td-pc' }, h('i', { class: 'dot st-absent' }), (simple() ? '당일취소 ' : '결석 ') + c.absent));
    if (c.excused) bits.push(h('span', { class: 'td-pc' }, h('i', { class: 'dot st-excused' }), '공결 ' + c.excused));
    if (c.pending) bits.push(h('span', { class: 'td-pc' }, h('i', { class: 'dot st-pending' }), '대기 ' + c.pending));
    if (c.canceled) bits.push(h('span', { class: 'td-pc' }, h('i', { class: 'dot st-canceled' }), '휴강 ' + c.canceled));
    return h('div', { class: 'td-progress' + (done ? ' done' : '') },
      h('div', { class: 'td-prog-row' },
        h('div', { class: 'td-prog-main' },
          h('span', { class: 'td-prog-lbl' }, '출석 '), h('b', { class: 'num' }, c.attended),
          h('span', { class: 'td-prog-sep' }, ' / '),
          h('span', { class: 'td-prog-lbl' }, '예정 '), h('b', { class: 'num' }, tot),
          done ? h('span', { class: 'td-prog-done' }, ic('check', 14), '마감') : null),
        h('div', { class: 'td-prog-bits' }, bits)),
      h('div', { class: 'progress', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(tot), 'aria-valuenow': String(c.attended), 'aria-label': '출석 ' + c.attended + '명 / 예정 ' + tot + '명' } },
        seg('st-present', c.present), seg('st-late', c.late), seg('st-absent', c.absent), seg('st-excused', c.excused), seg('st-unmarked', c.unmarked)));
  }

  /* ---------------- 배너들 ---------------- */
  function renderBanners(page, date, isToday) {
    var s = settings();
    if (DA.store && DA.store.fallback) {
      page.appendChild(ui.banner('error', DA.store.fallback === 'memory'
        ? '이 기기에서 저장소를 열지 못해 지금 기록은 앱을 닫으면 사라져요. 설정에서 백업 파일을 꼭 저장해 주세요.'
        : '기본 저장소 대신 임시 저장소를 쓰고 있어요. 용량이 작으니 백업 파일을 자주 저장해 주세요.',
        { title: '저장소 주의', action: { label: '백업', onClick: function () { ui.go('#/settings?section=data'); } } }));
    }
    if ((s.closedDays || []).indexOf(date) >= 0) {
      page.appendChild(ui.banner('info', '이날 정규 수업은 모두 휴강으로 처리돼요. 보강·특강은 그대로 열려요.', {
        title: '휴원일', icon: 'calendar-x',
        action: { label: '휴원 해제', onClick: function () { unsetClosedDay(date); } }
      }));
    }
    if (isToday && s.onboarded && hasRealData()) {
      var last = s.lastBackupAt ? new Date(s.lastBackupAt).getTime() : 0;
      var stale = !last || isNaN(last) || (Date.now() - last) > 7 * 86400000;
      if (stale && ls(true, SNOOZE_KEY) !== todayYmd()) {
        var days = last && !isNaN(last) ? Math.floor((Date.now() - last) / 86400000) : null;
        var b = ui.banner('warn',
          days != null ? '마지막 백업이 ' + days + '일 전이에요. 폰을 바꾸거나 잃어버려도 기록을 지킬 수 있게 백업 파일을 저장해 두세요.'
            : '아직 백업한 적이 없어요. 기록은 이 기기에만 저장되니 백업 파일을 한 번 저장해 두세요.',
          { title: '백업할 때가 됐어요', icon: 'download', action: { label: '백업하기', kind: 'primary', onClick: function () { ui.go('#/settings?section=data'); } } });
        b.appendChild(h('button', {
          class: 'btn btn-icon btn-sm td-banner-x', type: 'button', attrs: { 'aria-label': '오늘은 그만 보기' },
          onClick: function () { ls(false, SNOOZE_KEY, todayYmd()); ui.refresh(); }
        }, ic('x', 18)));
        page.appendChild(b);
      }
    }
  }

  async function unsetClosedDay(date) {
    var ok = await ui.confirm(U().fmtDate(date) + '을 휴원일에서 뺄까요?\n정규 수업이 다시 열려요.', { title: '휴원 해제', ok: '휴원 해제' });
    if (!ok) return;
    try {
      var list = (settings().closedDays || []).filter(function (d) { return d !== date; });
      await DA.store.saveSettings({ closedDays: list });
      ui.toast('휴원일을 해제했어요', { kind: 'ok' });
    } catch (e) { toastErr(e, '저장하지 못했어요'); }
  }

  /* ---------------- 첫 실행 ---------------- */
  function renderOnboarding() {
    var ios = U().isIOS && U().isIOS() && !(U().isStandalone && U().isStandalone());
    var demoBtn = h('button', {
      class: 'btn btn-primary btn-lg td-ob-btn', type: 'button', disabled: state.demoLoading,
      onClick: function () { loadDemo(demoBtn); }
    }, ic('sparkle', 20), state.demoLoading ? '불러오는 중…' : '예시 데이터로 둘러보기');
    var startBtn = h('button', {
      class: 'btn btn-lg td-ob-btn', type: 'button',
      onClick: function () { startFresh(); }
    }, ic('pen', 20), '직접 시작');
    return h('section', { class: 'card td-onboard' },
      h('div', { class: 'td-ob-hero' },
        h('div', { class: 'td-ob-logo', attrs: { 'aria-hidden': 'true' } }, ic('drum', 34)),
        h('div', { class: 'grow' },
          h('h2', { class: 'td-ob-title' }, '드럼 출석부에 오신 걸 환영해요!'),
          h('p', { class: 'muted' }, '레슨실 QR을 찍고 서명하면 출석 끝. 이용권·수납·연습실·통계까지 한 번에 챙겨 드려요.'))),
      simple() ? h('ul', { class: 'td-ob-points' },
        h('li', null, ic('card', 18), h('span', null, '이용권으로 한 달 횟수 충전, 출석할 때마다 1회')),
        h('li', null, ic('qr', 18), h('span', null, '레슨실 QR을 찍고 서명하면 출석 끝')),
        h('li', null, ic('chart', 18), h('span', null, '학생별·반별·월별 사용 금액 합계'))) :
      h('ul', { class: 'td-ob-points' },
        h('li', null, ic('qr', 18), h('span', null, '레슨실 QR을 찍고 손가락 서명으로 출석')),
        h('li', null, ic('calendar', 18), h('span', null, '매주 반복되는 시간표와 보강·휴강 관리')),
        h('li', null, ic('chart', 18), h('span', null, '학생별·강사별 출석률과 월별 추이'))),
      h('div', { class: 'td-ob-actions' }, demoBtn, startBtn),
      h('p', { class: 'td-ob-note faint' }, '예시 데이터는 설정에서 언제든 지울 수 있어요. 모든 기록은 이 기기에만 저장돼요.'),
      ios ? renderA2HS() : null);
  }

  function renderA2HS() {
    return h('div', { class: 'td-a2hs' },
      h('div', { class: 'td-a2hs-h' }, ic('home', 20), h('b', null, '아이폰에서는 홈 화면에 추가해서 쓰세요')),
      h('ol', { class: 'td-a2hs-steps' },
        h('li', null, '사파리 아래쪽 ', h('span', { class: 'td-kbd' }, ic('share', 15), '공유'), ' 버튼을 눌러요'),
        h('li', null, '목록에서 ', h('span', { class: 'td-kbd' }, ic('plus', 15), '홈 화면에 추가'), '를 골라요'),
        h('li', null, '오른쪽 위 ', h('b', null, '추가'), '를 누르면 앱처럼 열려요')),
      h('p', { class: 'small muted' }, '홈 화면 앱으로 쓰면 사파리가 기록을 지우지 않고, 전체 화면으로 더 넓게 써요.'));
  }

  async function loadDemo(btn) {
    if (state.demoLoading) return;
    if (!DA.demo || !DA.demo.load) { ui.toast('예시 데이터를 불러올 수 없어요', { kind: 'error' }); return; }
    state.demoLoading = true;
    if (btn) { btn.disabled = true; btn.lastChild.textContent = '불러오는 중…'; }
    try {
      var counts = await DA.demo.load(new Date());
      await DA.store.saveSettings({ onboarded: true });
      ui.haptic('success');
      ui.toast('예시 데이터를 불러왔어요' + (counts && counts.students ? ' (수강생 ' + counts.students + '명)' : '') + ' — 카드를 눌러 서명해 보세요', { kind: 'ok', ms: 4200 });
    } catch (e) {
      toastErr(e, '예시 데이터를 불러오지 못했어요');
    } finally {
      state.demoLoading = false;
      ui.refresh();
    }
  }

  async function startFresh() {
    var s = settings();
    var name = await ui.promptText({
      title: '직접 시작하기', message: '출석부 맨 위와 보호자 문자에 쓰일 이름이에요.',
      label: '학원 이름', value: s.academyName && s.academyName !== '드럼 학원' ? s.academyName : '',
      placeholder: '예: 쿵짝 드럼 학원', required: true, ok: '시작하기', maxLength: 30
    });
    if (name == null) return;
    try {
      await DA.store.saveSettings({ academyName: name, onboarded: true });
      ui.haptic('success');
      ui.toast('환영해요! 먼저 수강생과 수업을 등록해 볼까요?', { kind: 'ok', ms: 4500, action: { label: '수강생 등록', onClick: function () { ui.go('#/students'); } } });
    } catch (e) { toastErr(e, '저장하지 못했어요'); }
  }

  /* ---------------- 지금 안내 ---------------- */
  function renderNow(info, groups, counts, refs) {
    var parts = [];
    if (info.running.length) {
      info.running.forEach(function (g) {
        var o = g.occ, left = endMin(o) - info.nowMin;
        parts.push(h('button', { class: 'td-now-item running', type: 'button', onClick: function () { scrollToGroup(refs, o.key); } },
          h('span', { class: 'td-live', attrs: { 'aria-hidden': 'true' } }),
          h('span', { class: 'td-now-lbl' }, '지금 수업 중'),
          h('span', { class: 'td-now-what ellipsis' }, U().fmtTime(o.start) + ' ' + occTitle(o)),
          h('span', { class: 'td-now-time' }, fmtLeft(left) + ' 남음')));
      });
    }
    if (info.next) {
      var n = info.next.occ, wait = startMin(n) - info.nowMin;
      parts.push(h('button', { class: 'td-now-item', type: 'button', onClick: function () { scrollToGroup(refs, n.key); } },
        ic('clock', 18),
        h('span', { class: 'td-now-lbl' }, '다음 수업'),
        h('span', { class: 'td-now-what ellipsis' }, U().fmtTime(n.start) + ' ' + occTitle(n)),
        h('span', { class: 'td-now-time' }, wait < 1 ? '곧 시작' : fmtLeft(wait) + ' 뒤')));
    }
    if (!parts.length) {
      var any = groups.some(function (g) { return !g.occ.canceled && !g.orphanGroup; });
      if (!any) return null;
      var left = counts.pending;
      parts.push(h('div', { class: 'td-now-item done' },
        ic('check', 18),
        h('span', { class: 'td-now-lbl' }, '오늘 수업 끝'),
        h('span', { class: 'td-now-what ellipsis' }, left ? '서명 안 한 학생 ' + left + '명이 남았어요' : '수고하셨어요! 출석 ' + counts.attended + '명 👏')));
    }
    return h('div', { class: 'td-now' }, parts);
  }

  function scrollToGroup(refs, key) {
    var el = refs[key];
    if (!el) return;
    ui.haptic('light');
    var top = el.getBoundingClientRect().top + (window.pageYOffset || 0);
    var bar = document.querySelector('.td-top');
    var off = bar ? bar.getBoundingClientRect().height + 8 : 120;
    try { window.scrollTo({ top: Math.max(0, top - off), behavior: 'smooth' }); } catch (e) { window.scrollTo(0, Math.max(0, top - off)); }
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  /* ---------------- 수업 묶음 ---------------- */
  function renderGroup(g, date, isToday, info) {
    var o = g.occ;
    var tColor = ui.teacherColor(o.teacherId);
    var running = isToday && !o.canceled && !g.orphanGroup && startMin(o) <= info.nowMin && info.nowMin < endMin(o);
    var past = isToday ? endMin(o) <= info.nowMin : date < todayYmd();
    var isNext = isToday && info.next && info.next.occ.key === o.key;
    var attended = 0, recorded = 0;
    g.rows.forEach(function (r) {
      if (r.status === 'present' || r.status === 'late') attended++;
      if (r.record) recorded++;
    });
    var meta = [];
    if (o.teacherId) meta.push(h('span', { class: 'td-meta' }, h('i', { class: 'dot', style: { background: tColor } }), ui.nameOf('teacher', o.teacherId)));
    if (o.roomId) meta.push(h('span', { class: 'td-meta' }, ic('door', 14), ui.nameOf('room', o.roomId)));
    if (o.kind && o.kind !== 'regular') meta.push(ui.kindBadge(o.kind));
    if (o.canceled) meta.push(h('span', { class: 'badge st-canceled' }, o.cancelReason || '휴강'));
    if (o.missing) meta.push(h('span', { class: 'badge warn' }, '지워진 수업'));
    if (running) meta.push(h('span', { class: 'badge td-live-badge' }, h('span', { class: 'td-live' }), '진행 중'));
    else if (isNext) {
      var wait = startMin(o) - info.nowMin;
      meta.push(h('span', { class: 'badge st-pending' }, wait < 1 ? '곧 시작' : fmtLeft(wait) + ' 뒤'));
    }

    var head = h('div', { class: 'td-g-head' },
      h('div', { class: 'td-g-time' },
        h('div', { class: 'td-g-start num' }, U().fmtTime(o.start)),
        h('div', { class: 'td-g-dur' }, (U().fmtDuration ? U().fmtDuration(+o.duration || 0) : o.duration + '분'))),
      h('div', { class: 'td-g-info' },
        h('div', { class: 'td-g-title ellipsis' }, occTitle(o)),
        h('div', { class: 'td-g-meta' }, meta)),
      g.rows.length ? h('div', { class: 'td-g-count num', attrs: { 'aria-label': '출석 ' + attended + '명 / ' + g.rows.length + '명' } }, attended + '/' + g.rows.length) : null,
      g.orphanGroup ? null : h('button', {
        class: 'btn btn-icon td-g-more', type: 'button', attrs: { 'aria-label': '수업 메뉴' },
        onClick: function (e) { e.stopPropagation(); groupMenu(g, date); }
      }, ic('more', 20)));

    var body = h('div', { class: 'td-cards' });
    if (!g.rows.length) {
      body.appendChild(h('div', { class: 'td-g-empty' },
        (o.studentIds || []).length ? '이날 출석할 학생이 없어요 (휴원·퇴원·등록 전)' : '배정된 학생이 없어요',
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: function () { ui.go('#/timetable?date=' + date + '&mode=day'); } }, '시간표에서 보기')));
    }
    g.rows.forEach(function (r) { body.appendChild(renderCard(r, o, date)); });

    var el = h('section', {
      class: ['td-group', o.canceled ? 'is-canceled' : '', running ? 'is-now' : '', isNext ? 'is-next' : '', past && !running ? 'is-past' : ''],
      style: { '--tc': tColor },
      attrs: { 'aria-label': U().fmtTime(o.start) + ' ' + occTitle(o) }
    }, head, body);
    return el;
  }

  function groupMenu(g, date) {
    var o = g.occ;
    var sh = null;
    var unrecorded = o.canceled || date > todayYmd() ? [] : g.rows.filter(function (r) { return !r.record; });
    function later(fn) {
      return function () {
        if (sh) sh.close();
        setTimeout(function () { Promise.resolve().then(fn).catch(function (e) { toastErr(e); }); }, 30);
      };
    }
    function item(icon, title, sub, fn, cls) {
      return h('button', { class: 'list-item' + (cls ? ' ' + cls : ''), type: 'button', onClick: later(fn) },
        h('span', { class: 'li-ic' }, ic(icon, 20)),
        h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, title), sub ? h('div', { class: 'li-sub' }, sub) : null),
        ic('chevR', 18));
    }
    var list = h('div', { class: 'list flat' },
      unrecorded.length ? item('check', '남은 학생 모두 출석', unrecorded.length + '명을 서명 없이 출석으로 기록', function () { return markAll(g, date, unrecorded); }) : null,
      DA.actions && DA.actions.walkin && !o.canceled && !simple() ? item('user-plus', '명단 외 학생 출석', '이 시간에 온 다른 학생 받기', function () { return runWalkin(); }) : null,
      o.srcType === 'lesson' && !o.canceled ? item('calendar-x', '이 수업 휴강', '이날만 쉬어요 (기록은 남아요)', function () { return DA.actions.cancelOccurrence(o); }) : null,
      o.srcType === 'lesson' && o.canceled && !o.closedDay ? item('undo', '휴강 취소', '수업을 다시 열어요', function () { return DA.actions.uncancel ? DA.actions.uncancel(o) : DA.actions.cancelOccurrence(o); }) : null,
      o.srcType === 'lesson' && o.closedDay ? item('calendar-x', '휴원일 해제', '이날 모든 수업을 다시 열어요', function () { return unsetClosedDay(date); }) : null,
      o.srcType === 'extra' ? item('trash', '이 ' + ((DA.C && DA.C.KIND && DA.C.KIND[o.kind]) || '') + ' 수업 삭제', '출석 기록도 함께 지워져요', function () { return DA.actions.cancelOccurrence(o); }, 'danger') : null,
      item('calendar', '시간표에서 보기', '수업 편집 · 보강 추가', function () { ui.go('#/timetable?date=' + date + '&mode=day'); }));
    sh = ui.sheet({
      title: U().fmtTime(o.start) + '–' + U().fmtTime(o.end) + ' ' + occTitle(o),
      sub: U().fmtDate(date) + (o.teacherId ? ' · ' + ui.nameOf('teacher', o.teacherId) : '') + (o.roomId ? ' · ' + ui.nameOf('room', o.roomId) : ''),
      content: list
    });
  }

  async function markAll(g, date, rows) {
    var names = rows.map(function (r) { return ui.nameOf('student', r.studentId); });
    var ok = await ui.confirm(names.join(', ') + '\n' + rows.length + '명을 출석(직접 입력)으로 기록할까요?', { title: '모두 출석', ok: '출석 처리' });
    if (!ok) return;
    var snap = SC().snapOf ? SC().snapOf(g.occ) : { start: g.occ.start, duration: g.occ.duration, teacherId: g.occ.teacherId || '', roomId: g.occ.roomId || '', kind: g.occ.kind || 'regular' };
    var recs = rows.map(function (r) {
      return {
        id: DA.store.attendanceKey(date, g.occ.srcId, r.studentId), date: date, srcId: g.occ.srcId, studentId: r.studentId,
        status: 'present', method: 'manual', signedAt: null, signature: null, note: '', progress: null, snap: snap
      };
    });
    try {
      await DA.store.putMany('attendance', recs);
      ui.haptic('success');
      ui.toast(rows.length + '명 출석 처리했어요', {
        kind: 'ok',
        action: {
          label: '되돌리기', onClick: function () {
            DA.store.removeMany('attendance', recs.map(function (x) { return x.id; }))
              .then(function () { ui.toast('되돌렸어요', { kind: 'ok', ms: 1600 }); }, function (e) { toastErr(e, '되돌리지 못했어요'); });
          }
        }
      });
    } catch (e) { toastErr(e, '저장하지 못했어요'); }
  }

  /* ---------------- 학생 카드 ---------------- */
  function renderCard(r, occ, date) {
    var st = DA.store.get('students', r.studentId);
    var name = st ? st.name : '(삭제된 수강생)';
    var rec = r.record;
    var pass = null;
    if (st && st.pass && st.pass.type && st.pass.type !== 'none') {
      try { pass = SC().passInfo(data(), st, date, new Date()); } catch (e) { pass = null; }
    }
    var sub = [];
    var subText = st ? studentSub(st) : '';
    if (subText) sub.push(h('span', { class: 'td-c-course ellipsis' }, subText));
    if (pass && pass.label && pass.label !== '—') {
      sub.push(h('span', { class: 'td-pass' + (pass.warn ? ' warn' : '') }, pass.warn ? ic('alert', 12) : null, pass.label));
    }
    if (r.orphan) sub.push(h('span', { class: 'td-pass' }, '명단 밖 기록'));
    if (st && st.status === 'paused') sub.push(h('span', { class: 'td-pass warn' }, '휴원'));

    var endBits = [];
    if (rec && rec.signature && rec.method === 'sign' && DA.sig && DA.sig.el) {
      endBits.push(h('span', { class: 'sig-thumb td-sig' }, DA.sig.el(rec.signature, { width: 72, height: 32, strokeWidth: 1.6, label: name + ' 서명' })));
    }
    var when = '';
    if (rec && rec.signedAt) when = U().fmtTime(new Date(rec.signedAt));
    else if (rec && rec.method === 'manual' && (rec.status === 'present' || rec.status === 'late')) when = '직접 입력';
    var hasProg = rec && rec.progress && (rec.progress.song || rec.progress.book || rec.progress.bpm);
    var hasNote = rec && rec.note;

    var card = h('div', {
      class: ['td-card', 'st-' + r.status, r.auto ? 'auto' : ''],
      attrs: { role: 'button', tabindex: '0', 'aria-label': name + ' ' + ((DA.C && DA.C.STATUS && DA.C.STATUS[r.status]) || r.status) + ', 눌러서 서명' }
    },
      ui.avatar(name, ui.studentColor(st)),
      h('div', { class: 'td-c-main' },
        h('div', { class: 'td-c-name' },
          h('span', { class: 'ellipsis' }, name),
          hasNote ? h('span', { class: 'td-c-flag', attrs: { title: rec.note } }, ic('note', 14)) : null,
          hasProg ? h('span', { class: 'td-c-flag', attrs: { title: '진도 기록 있음' } }, ic('music', 14)) : null),
        sub.length ? h('div', { class: 'td-c-sub' }, sub) : null),
      h('div', { class: 'td-c-end' },
        h('div', { class: 'td-c-status' },
          ui.badge(r.status, { auto: r.auto }),
          when ? h('span', { class: 'td-c-when num' }, when) : null),
        endBits),
      h('button', {
        class: 'btn btn-icon td-c-more', type: 'button', attrs: { 'aria-label': name + ' 출결 메뉴' },
        onClick: function (e) { e.stopPropagation(); openMenu(occ, r.studentId, date); }
      }, ic('more', 20)));

    bindPress(card, function () {
      if (!st) { openMenu(occ, r.studentId, date); return; }
      ui.haptic('light');
      DA.actions.sign(occ, r.studentId, { date: date, confirmOtherDay: true });
    }, function () { openMenu(occ, r.studentId, date); });
    return card;
  }

  function openMenu(occ, sid, date) {
    if (DA.actions && DA.actions.menu) DA.actions.menu(occ, sid, { date: date });
  }

  // 탭 = onTap, 500ms 길게 누르기 = onLong(뒤따르는 click 무시)
  function bindPress(el, onTap, onLong) {
    var timer = null, sx = 0, sy = 0, fired = false, pid = null;
    function clear() { if (timer) { clearTimeout(timer); timer = null; } el.classList.remove('pressing'); }
    el.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      if (e.target.closest && e.target.closest('.td-c-more')) return;
      fired = false; pid = e.pointerId; sx = e.clientX; sy = e.clientY;
      clear();
      el.classList.add('pressing');
      timer = setTimeout(function () {
        timer = null; fired = true; el.classList.remove('pressing');
        ui.haptic('heavy');
        onLong();
      }, LONG_MS);
    });
    el.addEventListener('pointermove', function (e) {
      if (!timer || e.pointerId !== pid) return;
      if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) clear();
    });
    el.addEventListener('pointerup', clear);
    el.addEventListener('pointercancel', clear);
    el.addEventListener('pointerleave', clear);
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (!fired) { clear(); fired = true; onLong(); }
    });
    el.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.td-c-more')) return;
      if (fired) { fired = false; e.preventDefault(); return; }
      onTap();
    });
    el.addEventListener('keydown', function (e) {
      if (e.target !== el) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(); }
      else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); onLong(); }
    });
  }

  /* ---------------- 명단 외 ---------------- */
  function runWalkin() {
    if (!DA.actions || !DA.actions.walkin) return;
    if (!(data().students || []).some(function (s) { return s.status !== 'left'; })) {
      ui.toast('먼저 수강생을 등록해 주세요', { kind: 'warn', action: { label: '수강생 탭', onClick: function () { ui.go('#/students'); } } });
      return;
    }
    DA.actions.walkin({ date: curDate() }).catch(function (e) { toastErr(e); });
  }

  /* ---------------- 빈 날 ---------------- */
  function renderEmptyDay(date, isToday) {
    var d = data();
    var hasLessons = (d.lessons || []).length > 0;
    var box = h('div', { class: 'card td-empty' });
    if (!hasLessons) {
      var acts = h('div', { class: 'td-empty-acts' },
        h('button', { class: 'btn btn-primary', type: 'button', onClick: function () { ui.go('#/timetable?new=1'); } }, ic('plus', 18), '시간표에서 수업 추가'),
        DA.demo && DA.demo.load && !(DA.demo.has && DA.demo.has()) && !hasRealData()
          ? h('button', { class: 'btn', type: 'button', onClick: function (e) { loadDemo(null); e.currentTarget.disabled = true; } }, ic('sparkle', 18), '예시 데이터로 체험') : null);
      box.appendChild(ui.empty('calendar', '아직 수업이 없어요', '시간표에 매주 반복되는 수업을 넣으면\n여기에 그날 수업과 학생이 나와요.', acts));
      return box;
    }
    var nx = nextDayWithLessons(date);
    var text = isToday ? '오늘은 예정된 수업이 없어요.' : '이날은 예정된 수업이 없어요.';
    if (nx) text += '\n다음 수업: ' + U().fmtDate(nx.date) + ' ' + U().fmtTime(nx.start) + ' ' + occTitle(nx);
    var acts2 = h('div', { class: 'td-empty-acts' },
      nx ? h('button', { class: 'btn btn-primary', type: 'button', onClick: function () { setDate(nx.date); } }, ic('chevR', 18), U().fmtDate(nx.date, { weekday: true }) + ' 보기') : null,
      h('button', { class: 'btn', type: 'button', onClick: function () { runWalkin(); } }, ic('user-plus', 18), '명단 외 출석'));
    box.appendChild(ui.empty(isToday ? 'drum' : 'calendar', isToday ? '오늘은 쉬는 날!' : '수업이 없는 날', text, acts2));
    return box;
  }

  /* ---------------- v1.1 오늘 출석(이용권) ---------------- */
  function renderAskBar() {
    var input = ui.input({ type: 'search', placeholder: '스마트 검색 — 예: 이번 달 미납자', id: 'td-ask', maxLength: 120 });
    input.setAttribute('enterkeyhint', 'search');
    return h('form', { class: 'td-ask', onSubmit: function (e) {
      e.preventDefault();
      var q = String(input.value || '').trim();
      ui.go('#/ask' + (q ? '?q=' + encodeURIComponent(q) : ''));
    } },
      h('span', { class: 'td-ask-ic' }, ic('sms', 18)), input,
      h('button', { class: 'btn btn-sm btn-primary', type: 'submit' }, '묻기'));
  }

  function renderQuick() {
    return h('div', { class: 'pc-quick td-quick' },
      h('button', { class: 'btn btn-primary btn-lg pc-quick-qr', type: 'button', onClick: function () { DA.actions.qrAttend({}).catch(function (e) { toastErr(e); }); } },
        ic('camera', 24), h('span', null, 'QR 출석')),
      null);
  }

  function renderAttended(date, isToday) {
    var P = DA.pass, day;
    try { day = P.day(data(), date); } catch (e) { logErr(e, 'pass.day'); day = { attended: 0, absent: 0, amount: 0, records: [] }; }
    var people = {};
    day.records.forEach(function (r) { if (r.status !== 'absent') people[r.studentId] = 1; });
    var nPeople = Object.keys(people).length;
    var summary = h('div', { class: 'td-att-sum' },
      h('span', null, '출석 ', h('b', { class: 'num' }, nPeople), '명'),
      day.absent ? h('span', null, (simple() ? ' · 당일취소 ' : ' · 결석 '), h('b', { class: 'num' }, day.absent)) : null,
      ui.isTeacherLocked() ? null : h('span', null, ' · 사용 금액 ', h('b', { class: 'num' }, U().fmtMoney(day.amount))));
    var list = h('div', { class: 'list td-att-list' });
    var ym = date.slice(0, 7);
    day.records.forEach(function (r) {
      var st = DA.store.get('students', r.studentId);
      var name = st ? st.name : '(삭제된 수강생)';
      var m = P.month(data(), r.studentId, ym);
      var n = m.uses.indexOf(r) + 1;
      var prod = st ? P.product(settings(), st.courseId) : null;
      var absent = r.status === 'absent';
      var when = r.signedAt ? U().fmtTime(new Date(r.signedAt)) : ((r.snap && r.snap.start) || '');
      list.appendChild(h('button', {
        class: 'list-item td-att-row' + (absent ? ' is-absent' : ''), type: 'button',
        onClick: function () { if (st && DA.passUI) DA.passUI.slotSheet(st, r, n || 1); }
      },
        ui.avatar(name, ui.studentColor(st)),
        h('div', { class: 'li-main' },
          h('div', { class: 'li-title' }, h('span', { class: 'ellipsis' }, name), h('span', { class: 'td-att-n' }, (n || '?') + '회')),
          h('div', { class: 'li-sub' }, [when, prod ? prod.name : '', absent ? '당일 취소' : (r.method === 'sign' ? '서명' : '직접 입력')].filter(Boolean).join(' · '))),
        h('div', { class: 'li-end td-att-end' },
          r.signature && DA.sig && DA.sig.el ? h('span', { class: 'sig-thumb' }, DA.sig.el(r.signature, { width: 64, height: 28, strokeWidth: 1.4 })) : null,
          ui.badge(r.status))));
    });
    if (!day.records.length) {
      list.appendChild(h('div', { class: 'td-att-empty muted' }, isToday ? '아직 오늘 출석한 사람이 없어요. 위 버튼으로 출석을 받아 보세요.' : '이날 출석 기록이 없어요.'));
    }
    return h('section', { class: 'card td-att' },
      h('div', { class: 'card-h' }, h('h2', null, isToday ? '오늘 출석' : U().fmtDate(date, { weekday: false }) + ' 출석'), summary),
      list);
  }

  /* ---------------- 그리기 ---------------- */
  function render(el, params) {
    params = params || { rest: [], query: {} };
    // ?date=YYYY-MM-DD (다른 화면에서 넘어올 때) — 같은 주소로 다시 그릴 땐 다시 적용하지 않는다
    var q = params.query || {};
    if (q.date && params.hash !== state.lastQueryHash) {
      state.lastQueryHash = params.hash;
      if (U().isYmd(q.date)) { state.date = q.date === todayYmd() ? null : q.date; state.scrolledFor = null; }
    }
    if (!q.date) state.lastQueryHash = null;

    var now = new Date();
    var date = curDate();
    var isToday = date === todayYmd();
    var s = settings();
    var day = buildDay(date, now);
    var info = isToday ? nowInfo(day.groups, now) : { nowMin: -1, running: [], next: null, remaining: 0 };

    el.classList.add('v-today');
    el.appendChild(renderHeader(date, isToday, day.counts));

    var page = h('div', { class: 'page td-page' });
    el.appendChild(page);

    var showOnboard = !s.onboarded && !hasRealData() && !(DA.demo && DA.demo.has && DA.demo.has());
    // v1.2: 맨 위 '스마트 검색'
    if (isToday && !showOnboard && ui.viewAllowed('ask')) page.appendChild(renderAskBar());
    if (showOnboard) page.appendChild(renderOnboarding());
    renderBanners(page, date, isToday);
    // v1.2: 앱 안 알림(이번 주 퇴원·사유 없음, 월요일 브리핑)
    if (isToday && DA.opsUI && DA.opsUI.alertCards) {
      try { DA.opsUI.alertCards().forEach(function (b) { page.appendChild(b); }); } catch (e) { logErr(e, 'alerts'); }
    }

    if (simple()) {
      if (isToday) page.appendChild(renderQuick());
      page.appendChild(renderAttended(date, isToday));
    }
    // v1.2: 운영 현황판(재원·반별·미납·오늘 출석)
    if (isToday && !showOnboard && DA.opsUI && DA.opsUI.boardCard && (hasRealData() || (DA.demo && DA.demo.has && DA.demo.has()))) {
      try { page.appendChild(DA.opsUI.boardCard()); } catch (e) { logErr(e, 'board'); }
    }

    var refs = {};
    if (simple() && !ui.moduleOn('timetable')) {
      // 시간표 기능을 끄면 오늘 화면의 시간표 수업 목록도 숨긴다(기록은 그대로)
    } else if (!day.groups.length) {
      if (!showOnboard && !simple()) page.appendChild(renderEmptyDay(date, isToday));
    } else {
      if (simple()) page.appendChild(h('h2', { class: 'td-sec-title' }, ic('calendar', 18), isToday ? '오늘 시간표 수업' : '이날 시간표 수업'));
      if (isToday) {
        var nowEl = renderNow(info, day.groups, day.counts, refs);
        if (nowEl) page.appendChild(nowEl);
      }
      var list = h('div', { class: 'td-list' });
      day.groups.forEach(function (g) {
        var gEl = renderGroup(g, date, isToday, info);
        refs[g.occ.key] = gEl;
        list.appendChild(gEl);
      });
      page.appendChild(list);
      page.appendChild(h('div', { class: 'td-foot' },
        simple() ? null : h('button', { class: 'btn btn-ghost', type: 'button', onClick: function () { runWalkin(); } }, ic('user-plus', 18), '명단에 없는 학생 출석'),
        h('span', { class: 'faint small' }, simple() ? '카드를 누르면 서명 · 길게 누르면 당일취소·진도' : '카드를 누르면 서명 · 길게 누르면 지각·결석·진도')));
    }

    // 처음 들어왔을 때 진행 중(또는 다음) 수업이 화면 아래쪽이면 그쪽으로
    if (isToday && state.scrolledFor !== date && day.groups.length) {
      state.scrolledFor = date;
      var target = info.running[0] || info.next;
      if (target && refs[target.occ.key] && day.groups.indexOf(target) > 1) {
        var tEl = refs[target.occ.key];
        setTimeout(function () {
          if (!document.contains(tEl) || (window.pageYOffset || 0) > 40) return;
          var r = tEl.getBoundingClientRect();
          if (r.top > window.innerHeight * 0.55) scrollToGroup(refs, target.occ.key);
        }, 350);
      }
    }

    // 1분마다 '지금' 표시 갱신(오늘일 때만), 방향키로 날짜 이동
    function onTick() { if (curDate() === todayYmd() && !(DA.actions && DA.actions.isSigning && DA.actions.isSigning())) ui.refresh(); }
    function onKey(e) {
      if (ui.sheetCount && ui.sheetCount()) return;
      var t = e.target && e.target.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); shiftDate(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); shiftDate(1); }
      else if (e.key === 't' || e.key === 'T') { setDate(todayYmd()); }
    }
    if (isToday) window.addEventListener('da:tick', onTick);
    document.addEventListener('keydown', onKey);
    return function () {
      window.removeEventListener('da:tick', onTick);
      document.removeEventListener('keydown', onKey);
    };
  }

  ui.registerView('today', {
    title: '오늘',
    tab: { label: '오늘', icon: 'today', order: 1 },
    render: render,
    onBack: function () {
      // 다른 날짜를 보고 있으면 뒤로가기 = 오늘로
      if (state.date && state.date !== todayYmd()) { setDate(todayYmd()); return true; }
      return false;
    }
  });

  // 날짜가 넘어가면 '오늘 따라가기' 상태는 그대로 두고, 지난 오늘을 보고 있던 경우도 새 오늘로
  window.addEventListener('da:daychange', function (e) {
    if (state.date && e && e.detail && state.date === e.detail.to) state.date = null;
    state.scrolledFor = null;
  });

  DA.today = { setDate: setDate, date: curDate };
})(window.DA = window.DA || {});
