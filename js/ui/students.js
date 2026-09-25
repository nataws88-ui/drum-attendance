/* 드럼 출석부 — 수강생 (SPEC §6.4)
 * 목록(초성 검색·필터 칩·정렬) · 편집기 · 상세(#/students/<id>): 출석 달력 / 기록 목록 / 진도 / 통계 / 결제 / 시간표
 * 상태 변경: 휴원 · 복귀 · 퇴원(정규 수업에서 빼기 — splitLesson으로 이전 기록 보존) · 재등록 · 삭제(2단계)
 * 공개: DA.students = { edit(id?, opts) → Promise<Student|null>, open(id), addLesson(id), addPayment(id) }
 */
(function (DA) {
  'use strict';
  var ui = DA.ui;
  if (!ui || !ui.registerView) return;
  var h = ui.h;

  /* ------------------------------------------------------------------
   * 도우미
   * ------------------------------------------------------------------ */
  var U = DA.util, SC = DA.schedule;
  var FALLBACK_STATUS = { present: '출석', late: '지각', absent: '결석', excused: '공결', canceled: '휴강', unmarked: '미확인', pending: '서명 대기', upcoming: '예정' };
  var STU_STATUS = { active: '재원', paused: '휴원', left: '퇴원' };
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  var PAY_METHODS = (DA.C && DA.C.PAY_METHODS) || ['카드', '현금', '계좌이체', '기타'];

  function D() { return DA.store.data; }
  function S() { return (DA.store.data && DA.store.data.settings) || {}; }
  function ic(n, s) { return ui.icon ? ui.icon(n, s) : h('span'); }
  function today() { return U.today(); }
  function stLabel(st) { return ((DA.C && DA.C.STATUS) || FALLBACK_STATUS)[st] || FALLBACK_STATUS[st] || st; }
  function logErr(e, w) { if (ui._logErr) ui._logErr(e, 'students.' + (w || '')); else if (window.console) console.error(e); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function num(v, d) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; }
  function collate(a, b) { return U.collate ? U.collate(a, b) : String(a).localeCompare(String(b), 'ko'); }
  function weekStart() { return Number(S().weekStart) === 0 ? 0 : 1; }
  function getStudent(id) { return id ? DA.store.get('students', id) : null; }
  function wdLabel(w) { return WD[Number(w)] || ''; }
  function endHm(start, dur) { return U.min2hm(U.hm2min(start) + (+dur || 0)); }
  function rateColor(r) {
    if (r == null) return 'var(--st-unmarked)';
    return r >= 0.9 ? 'var(--st-present)' : r >= 0.7 ? 'var(--st-late)' : 'var(--st-absent)';
  }
  function fail(e, what) {
    logErr(e, what);
    ui.toast((what ? what + ' 실패: ' : '') + (e && e.message ? e.message : '다시 시도해 주세요'), { kind: 'error' });
  }
  function fmtPhone(v) {
    var raw = String(v == null ? '' : v).trim();
    var d = raw.replace(/[^0-9]/g, '');
    if (!d) return raw;
    if (/^02/.test(d)) {
      if (d.length === 9) return d.replace(/^(02)(\d{3})(\d{4})$/, '$1-$2-$3');
      if (d.length === 10) return d.replace(/^(02)(\d{4})(\d{4})$/, '$1-$2-$3');
      return raw;
    }
    if (d.length === 11) return d.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3');
    if (d.length === 10) return d.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
    if (d.length === 8 && /^1[5-9]/.test(d)) return d.replace(/^(\d{4})(\d{4})$/, '$1-$2');
    return raw;
  }
  function ageOf(birth, t) {
    if (!U.isYmd(birth)) return null;
    var b = birth.split('-').map(Number), n = t.split('-').map(Number);
    var a = n[0] - b[0];
    if (n[1] < b[1] || (n[1] === b[1] && n[2] < b[2])) a--;
    return a >= 0 && a < 120 ? a : null;
  }
  function telHref(p) { return U.telHref ? U.telHref(p) : 'tel:' + String(p).replace(/[^0-9+]/g, ''); }
  function smsHref(p) { return U.smsHref ? U.smsHref(p, '') : 'sms:' + String(p).replace(/[^0-9+]/g, ''); }
  function nameOf(kind, id) { return id ? ui.nameOf(kind, id) : ''; }
  function studentSub(s) {
    var parts = [];
    if (s.courseId) parts.push(nameOf('course', s.courseId));
    if (s.levelId) parts.push(nameOf('level', s.levelId));
    if (s.teacherId) parts.push(nameOf('teacher', s.teacherId));
    return parts.join(' · ');
  }
  function openPause(s) {
    var p = arr(s && s.pauses);
    for (var i = p.length - 1; i >= 0; i--) if (p[i] && p[i].from && !p[i].to) return p[i];
    return null;
  }
  function statusBadge(s) {
    var st = (s && s.status) || 'active';
    if (st === 'paused') return h('span', { class: 'badge warn' }, '휴원');
    if (st === 'left') return h('span', { class: 'badge st-canceled stu-left-badge' }, '퇴원');
    return h('span', { class: 'badge st-present' }, '재원');
  }
  function passBadge(p, always) {
    if (!p || p.type === 'none' || !p.label || p.label === '—') return null;
    if (!p.warn && !always) return null;
    return h('span', { class: 'badge ' + (p.warn ? 'warn' : ''), attrs: { title: '수강권' } }, p.warn ? ic('alert', 12) : null, p.label);
  }
  function relOrDate(ymd, t) {
    if (!ymd) return '없음';
    var r = U.relDay ? U.relDay(ymd) : '';
    if (r) return r;
    var d = U.diffDays(ymd, t);
    if (d > 0 && d < 7) return d + '일 전';
    return U.fmtDate(ymd, { weekday: false, year: 'auto' });
  }
  function selectOpts(list, emptyLabel) {
    var out = [{ value: '', label: emptyLabel || '미지정' }];
    arr(list).forEach(function (x) { if (x && x.id) out.push({ value: x.id, label: x.name || '이름 없음' }); });
    return out;
  }

  /* ------------------------------------------------------------------
   * 메모이즈(스토어 version + 오늘 날짜가 바뀌면 전부 버림)
   * ------------------------------------------------------------------ */
  var memo = {}, memoKey = '';
  function cached(key, fn) {
    var k = DA.store.version + '|' + today();
    if (k !== memoKey) { memo = {}; memoKey = k; }
    if (Object.prototype.hasOwnProperty.call(memo, key)) return memo[key];
    var v = fn();
    memo[key] = v;
    return v;
  }
  function hasStats() { return !!(DA.stats && typeof DA.stats.compute === 'function'); }
  function simple() { return S().simpleMode !== false; }
  function PS() { return DA.pass; }
  function monthInfo(sid, ym) { try { return PS().month(D(), sid, ym || today().slice(0, 7)); } catch (e) { logErr(e, 'month'); return null; } }
  function prodName(s) { var p = s && PS() ? PS().product(S(), s.courseId) : null; return p ? p.name : (s && s.courseId ? nameOf('course', s.courseId) : ''); }

  // 목록용: 학생별 이번 달 출석률·최근 출석·수강권
  function listInfo() {
    return cached('list', function () {
      var data = D(), now = new Date(), t = U.today(now);
      var rep = null;
      if (hasStats()) {
        try { rep = DA.stats.compute(data, { from: U.monthStart(t), to: t }, now); } catch (e) { logErr(e, 'listInfo'); }
      }
      var month = new Map();
      if (rep) rep.byStudent.forEach(function (e) { month.set(e.studentId, e); });
      var attBy = SC.index.attendanceByStudent(data);
      var map = new Map();
      arr(data.students).forEach(function (s) {
        var recs = attBy.get(s.id) || [];
        var last = null;
        for (var i = recs.length - 1; i >= 0; i--) {
          var r = recs[i];
          if (r.date <= t && (r.status === 'present' || r.status === 'late')) { last = r.date; break; }
        }
        var m = month.get(s.id);
        var pass = null;
        try { pass = SC.passInfo(data, s, t, now); } catch (e) { pass = null; }
        map.set(s.id, {
          month: monthInfo(s.id, t.slice(0, 7)),
          rate: m ? m.rate : null,
          attended: m ? m.attended : 0,
          denom: m ? (m.present + m.late + m.absent + m.unmarked) : 0,
          pass: pass, last: last
        });
      });
      return { map: map, totals: rep ? rep.totals : null };
    });
  }

  // 학생의 통계 시작일: 등록일·첫 기록 중 이른 날(오늘을 넘지 않음)
  function studentFrom(s) {
    var t = today();
    var recs = SC.index.attendanceByStudent(D()).get(s.id) || [];
    var first = recs.length ? recs[0].date : '';
    var from = s.joinDate && U.isYmd(s.joinDate) ? s.joinDate : '';
    if (first && (!from || first < from)) from = first;
    if (!from) from = hasStats() && DA.stats.earliestDate ? DA.stats.earliestDate(D(), t) : U.addMonths(t, -3);
    if (from > t) from = t;
    return from;
  }
  function report(s, rangeKey) {
    return cached('rep:' + s.id + ':' + rangeKey, function () {
      if (!hasStats()) return null;
      var data = D(), now = new Date(), t = U.today(now);
      var from = studentFrom(s);
      if (rangeKey === 'month') from = U.monthStart(t) > from ? U.monthStart(t) : from;
      else if (rangeKey === 'year') { var y = t.slice(0, 4) + '-01-01'; if (y > from) from = y; }
      else if (rangeKey === 'last3m') { var m3 = U.monthStart(U.addMonths(t, -2)); if (m3 > from) from = m3; }
      try { return DA.stats.compute(data, { from: from, to: t, studentId: s.id }, now); } catch (e) { logErr(e, 'report'); return null; }
    });
  }
  function entryOf(rep, id) {
    if (!rep) return null;
    for (var i = 0; i < rep.byStudent.length; i++) if (rep.byStudent[i].studentId === id) return rep.byStudent[i];
    return null;
  }
  // 이 학생의 전체 행(시작일~오늘)
  function studentRows(s) {
    return cached('rows:' + s.id, function () {
      var t = today();
      try { return SC.rows(D(), studentFrom(s), t, new Date(), { studentId: s.id }); } catch (e) { logErr(e, 'rows'); return []; }
    });
  }

  /* ------------------------------------------------------------------
   * 뷰 상태(다시 그려도 유지)
   * ------------------------------------------------------------------ */
  var st = {
    q: '', status: 'active', course: '', teacher: '', sort: 'name', listScroll: 0,
    detailId: null, tab: 'cal', calYm: '', recFilter: 'all', recLimit: 40, statRange: 'all', openedNew: '', passYm: ''
  };
  var SORTS = [
    { value: 'name', label: '이름순' }, { value: 'recent', label: '최근 출석순' },
    { value: 'rate', label: '출석률순' }, { value: 'pass', label: '남은 횟수순' }
  ];
  var TABS = [
    { value: 'cal', label: '출석 달력' }, { value: 'records', label: '기록 목록' }, { value: 'pay', label: '이용권·결제' },
    { value: 'progress', label: '진도' }, { value: 'stats', label: '통계' }, { value: 'lessons', label: '시간표' }
  ];

  /* ==================================================================
   * 목록
   * ================================================================== */
  function renderList(el, params) {
    var data = D();
    var all = arr(data.students).filter(function (s) { return s && s.id; });
    var info = listInfo();
    var counts = { active: 0, paused: 0, left: 0, all: all.length };
    all.forEach(function (s) { var k = s.status || 'active'; counts[k] = (counts[k] || 0) + 1; });

    var root = h('div', { class: 'v-students v-stu-list' });
    el.appendChild(root);

    var addBtn = h('button', { class: 'btn btn-primary btn-sm hide-phone', type: 'button', onClick: function () { edit(null); } }, ic('user-plus', 18), '수강생 등록');
    root.appendChild(h('header', { class: 'topbar' },
      h('div', { class: 'topbar-row' },
        h('h1', { class: 'topbar-title' }, '수강생'),
        h('div', { class: 'topbar-actions' }, addBtn))));

    var page = h('div', { class: 'page' });
    root.appendChild(page);

    if (!all.length) {
      page.appendChild(h('div', { class: 'card' }, ui.empty('users', '아직 등록된 수강생이 없어요',
        '수강생을 등록하면 시간표에 넣고 QR로 출석을 받을 수 있어요.',
        h('div', { class: 'col center stu-empty-acts' },
          h('button', { class: 'btn btn-primary', type: 'button', onClick: function () { edit(null); } }, ic('user-plus', 18), '첫 수강생 등록'),
          DA.demo && DA.demo.load && !(DA.demo.has && DA.demo.has()) ? h('button', {
            class: 'btn btn-ghost', type: 'button',
            onClick: function () {
              ui.confirm('예시 수강생 14명과 지난 10주 출석 기록을 불러올까요?\n설정에서 언제든 지울 수 있어요.', { title: '예시 데이터로 둘러보기', ok: '불러오기' }).then(function (ok) {
                if (!ok) return;
                DA.demo.load(new Date()).then(function () { ui.toast('예시 데이터를 불러왔어요', { kind: 'ok' }); }, function (e) { fail(e, '불러오기'); });
              });
            }
          }, ic('sparkle', 18), '예시 데이터로 둘러보기') : null))));
      root.appendChild(fab());
      return;
    }

    // 맨 위: 출석 받기 큰 버튼(v1.1)
    page.appendChild(h('div', { class: 'pc-quick' },
      h('button', { class: 'btn btn-primary btn-lg pc-quick-qr', type: 'button', onClick: function () { DA.actions.qrAttend({}); } }, ic('camera', 22), 'QR 출석')));

    // 요약
    var warnCount = 0, activeRates = [], notIssued = 0, usedSum = 0, issuedSum = 0;
    all.forEach(function (s) {
      var i = info.map.get(s.id);
      var ss0 = s.status || 'active';
      if (ss0 !== 'left' && i && i.pass && i.pass.warn) warnCount++;
      if (ss0 === 'active' && i && i.rate != null) activeRates.push(i.rate);
      if (i && i.month) {
        if (ss0 === 'active' && i.month.status === 'none') notIssued++;
        usedSum += i.month.usedAmount; issuedSum += i.month.amount;
      }
    });
    var monthRate = info.totals ? info.totals.rate : null;
    page.appendChild(h('div', { class: 'stu-summary' },
      sumTile('재원', counts.active + '명', (counts.paused ? '휴원 ' + counts.paused + '명' : '') + (counts.paused && counts.left ? ' · ' : '') + (counts.left ? '퇴원 ' + counts.left + '명' : '') || '전체 ' + counts.all + '명', function () { st.status = 'active'; ui.refresh(); }),
      simple() ? sumTile('이번 달 사용', wonShort(usedSum), '발급 ' + wonShort(issuedSum), function () { ui.go('#/stats?tab=revenue'); }) :
        sumTile('이번 달 출석률', U.pct(monthRate), info.totals ? '출석 ' + info.totals.attended + '회' : '', null, rateColor(monthRate)),
      simple() ? sumTile('이번 달 미발급', notIssued + '명', notIssued ? '발급 필요' : '모두 발급', notIssued ? function () { st.sort = 'pass'; st.status = 'active'; ui.refresh(); } : null, notIssued ? 'var(--st-late)' : null) :
        sumTile('수강권 확인', warnCount + '명', warnCount ? '잔여 적음·소진' : '모두 여유 있어요', warnCount ? function () { st.sort = 'pass'; st.status = 'all'; ui.refresh(); } : null, warnCount ? 'var(--st-late)' : null)));

    // 검색 + 정렬
    var search = ui.input({
      type: 'search', value: st.q, placeholder: '이름·초성 검색', id: 'stu-search',
      onInput: function (v) { st.q = v; clearBtn.hidden = !v; drawRows(); }
    });
    search.setAttribute('enterkeyhint', 'search');
    search.setAttribute('aria-label', '수강생 검색');
    var clearBtn = h('button', { class: 'btn btn-icon input-clear', type: 'button', attrs: { 'aria-label': '검색어 지우기' }, onClick: function () { st.q = ''; search.value = ''; clearBtn.hidden = true; drawRows(); search.focus(); } }, ic('x', 18));
    clearBtn.hidden = !st.q;
    var sortSel = ui.select(SORTS, st.sort, function (v) { st.sort = v; drawRows(); });
    sortSel.classList.add('stu-sort');
    sortSel.setAttribute('aria-label', '정렬');
    page.appendChild(h('div', { class: 'stu-tools' },
      h('div', { class: 'input-group grow' }, ic('search', 20), search, clearBtn),
      sortSel));

    // 필터 칩
    var chipBar = h('div', { class: 'stu-chips' });
    page.appendChild(chipBar);
    var countEl = h('div', { class: 'stu-count' });
    page.appendChild(countEl);
    var listEl = h('div', { class: 'list stu-list' });
    page.appendChild(listEl);

    function chip(label, on, onClick, extra) {
      return h('button', { class: 'chip' + (on ? ' on' : ''), type: 'button', attrs: { 'aria-pressed': on ? 'true' : 'false' }, onClick: function () { ui.haptic('select'); onClick(); } }, extra || null, label);
    }
    function drawChips() {
      ui.clear(chipBar);
      var row1 = h('div', { class: 'hscroll stu-chip-row' });
      [['active', '재원'], ['paused', '휴원'], ['left', '퇴원'], ['all', '전체']].forEach(function (x) {
        if (x[0] !== 'active' && x[0] !== 'all' && !counts[x[0]] && st.status !== x[0]) return;
        row1.appendChild(chip(x[1], st.status === x[0], function () { st.status = x[0]; drawChips(); drawRows(); }, null));
        row1.lastChild.appendChild(h('span', { class: 'count' }, counts[x[0]] || 0));
      });
      chipBar.appendChild(row1);
      var used = { course: {}, teacher: {} };
      all.forEach(function (s) { if (s.courseId) used.course[s.courseId] = 1; if (s.teacherId) used.teacher[s.teacherId] = 1; });
      var courses = arr(S().courses).filter(function (c) { return used.course[c.id]; });
      var teachers = arr(S().teachers).filter(function (c) { return used.teacher[c.id]; });
      if (courses.length > 1 || teachers.length > 1 || st.course || st.teacher) {
        var row2 = h('div', { class: 'hscroll stu-chip-row' });
        if (courses.length > 1 || st.course) {
          row2.appendChild(h('span', { class: 'stu-chip-label' }, simple() ? '반' : '과정'));
          courses.forEach(function (c) {
            row2.appendChild(chip(c.name, st.course === c.id, function () { st.course = st.course === c.id ? '' : c.id; drawChips(); drawRows(); },
              h('span', { class: 'swatch', style: { background: ui.courseColor(c.id) } })));
          });
        }
        if (teachers.length > 1 || st.teacher) {
          row2.appendChild(h('span', { class: 'stu-chip-label' }, '강사'));
          teachers.forEach(function (c) {
            row2.appendChild(chip(c.name, st.teacher === c.id, function () { st.teacher = st.teacher === c.id ? '' : c.id; drawChips(); drawRows(); },
              h('span', { class: 'swatch', style: { background: ui.teacherColor(c.id) } })));
          });
        }
        chipBar.appendChild(row2);
      }
    }

    function visible() {
      var list = all.filter(function (s) {
        var ss = s.status || 'active';
        if (st.status !== 'all' && ss !== st.status) return false;
        if (st.course && s.courseId !== st.course) return false;
        if (st.teacher && s.teacherId !== st.teacher) return false;
        if (st.q) {
          var q = st.q.replace(/[\s-]/g, '');
          var hit = U.matchName(s.name, st.q) || (/^\d{3,}$/.test(q) && (String(s.phone || '').replace(/\D/g, '').indexOf(q) >= 0 || String(s.parentPhone || '').replace(/\D/g, '').indexOf(q) >= 0));
          if (!hit) return false;
        }
        return true;
      });
      var I = info.map;
      function passKey(s) {
        var mi = (I.get(s.id) || {}).month;
        if (simple() && mi) return mi.status === 'none' ? -1000 : mi.remaining;
        var p = (I.get(s.id) || {}).pass;
        if (!p || p.type === 'none') return 1e9;
        if (p.type === 'count') return p.remaining == null ? 1e8 : p.remaining;
        if (p.total) return p.total - p.used;
        return 1e8;
      }
      list.sort(function (a, b) {
        var ia = I.get(a.id) || {}, ib = I.get(b.id) || {};
        var r = 0;
        if (st.sort === 'recent') {
          r = (ib.last || '').localeCompare(ia.last || '');
        } else if (st.sort === 'rate') {
          var ra = ia.rate == null ? -1 : ia.rate, rb = ib.rate == null ? -1 : ib.rate;
          r = rb - ra;
        } else if (st.sort === 'pass') {
          r = passKey(a) - passKey(b);
        }
        return r || collate(a.name, b.name);
      });
      return list;
    }

    function drawRows() {
      ui.clear(listEl);
      var list = visible();
      var filtered = st.q || st.course || st.teacher;
      countEl.textContent = list.length + '명' + (filtered ? ' 찾음' : '') + (st.sort !== 'name' ? ' · ' + SORTS.filter(function (x) { return x.value === st.sort; })[0].label : '');
      if (!list.length) {
        listEl.appendChild(ui.empty('search', '찾는 수강생이 없어요',
          st.q ? '이름·초성·전화번호 뒷자리로 찾을 수 있어요.' : '다른 필터를 골라 보세요.',
          (st.status !== 'all' || st.course || st.teacher) ? { label: '필터 모두 풀기', kind: 'ghost', onClick: function () { st.status = 'all'; st.course = ''; st.teacher = ''; drawChips(); drawRows(); } } : null));
        return;
      }
      var frag = document.createDocumentFragment();
      list.forEach(function (s) { frag.appendChild(rowEl(s, info.map.get(s.id) || {})); });
      listEl.appendChild(frag);
    }

    function rowEl(s, i) {
      if (simple()) return rowElPass(s, i);
      var ss = s.status || 'active';
      var rate = i.rate;
      var sub = studentSub(s);
      var extra = st.sort === 'recent' ? '최근 출석 ' + relOrDate(i.last, today()) : '';
      return h('button', {
        class: 'list-item stu-row' + (ss !== 'active' ? ' is-' + ss : ''), type: 'button',
        onClick: function () { st.listScroll = window.pageYOffset || 0; ui.go('#/students/' + encodeURIComponent(s.id)); }
      },
        ui.avatar(s.name, ui.studentColor(s)),
        h('div', { class: 'li-main' },
          h('div', { class: 'li-title stu-name' }, h('span', { class: 'ellipsis' }, s.name), ss !== 'active' ? statusBadge(s) : null),
          h('div', { class: 'li-sub' }, extra || sub || (s.school || '과정 미지정'))),
        h('div', { class: 'stu-end' },
          h('div', { class: 'stu-rate', attrs: { title: '이번 달 출석률' } },
            h('span', { class: 'stu-rate-v', style: { color: rate == null ? 'var(--text-3)' : null } }, rate == null ? '–' : U.pct(rate)),
            h('span', { class: 'stu-mini' }, h('i', { style: { width: (rate == null ? 0 : Math.round(rate * 100)) + '%', background: rateColor(rate) } }))),
          passBadge(i.pass, st.sort === 'pass')));
    }

    // v1.1 행: 이름, 반, 이번 달 2/4회, 남은 횟수 배지(0 주황·초과 빨강·미발급)
    function rowElPass(s, i) {
      var ss = s.status || 'active';
      var m = i.month;
      var sub = [prodName(s) || '반 미지정'];
      if (st.sort === 'recent') sub.push('최근 출석 ' + relOrDate(i.last, today()));
      return h('button', {
        class: 'list-item stu-row pass' + (ss !== 'active' ? ' is-' + ss : ''), type: 'button',
        onClick: function () { st.listScroll = window.pageYOffset || 0; ui.go('#/students/' + encodeURIComponent(s.id)); }
      },
        ui.avatar(s.name, ui.studentColor(s)),
        h('div', { class: 'li-main' },
          h('div', { class: 'li-title stu-name' }, h('span', { class: 'ellipsis' }, s.name), ss !== 'active' ? statusBadge(s) : null),
          h('div', { class: 'li-sub' }, sub.join(' · '))),
        h('div', { class: 'stu-end pass' },
          m && m.status !== 'none' ? h('span', { class: 'stu-month num' }, '이번 달 ' + m.used + '/' + m.total + '회') : null,
          ss === 'left' && (!m || m.status === 'none') ? null : DA.passUI.statusBadge(m)));
    }

    drawChips();
    drawRows();
    root.appendChild(fab());

    if (st.listScroll) {
      var y = st.listScroll; st.listScroll = 0;
      requestAnimationFrame(function () { window.scrollTo(0, y); });
    }
    if (params && params.query && params.query['new'] === '1' && st.openedNew !== params.hash) {
      st.openedNew = params.hash;
      setTimeout(function () { edit(null); }, 50);
    }
  }
  function wonShort(v) {
    v = Math.round(v || 0);
    if (Math.abs(v) >= 10000) return (Math.round(v / 1000) / 10).toLocaleString('ko-KR') + '만원';
    return U.fmtMoney(v);
  }
  function sumTile(label, value, sub, onClick, color) {
    return h(onClick ? 'button' : 'div', { class: 'stu-sum' + (onClick ? ' tap' : ''), type: onClick ? 'button' : null, onClick: onClick || null },
      h('div', { class: 'stu-sum-l' }, label),
      h('div', { class: 'stu-sum-v', style: { color: color || null } }, value),
      sub ? h('div', { class: 'stu-sum-s' }, sub) : null);
  }
  function fab() {
    return h('button', { class: 'fab stu-fab hide-wide', type: 'button', attrs: { 'aria-label': '수강생 등록' }, onClick: function () { edit(null); } }, ic('plus', 22), '수강생');
  }

  /* ==================================================================
   * 편집기
   * ================================================================== */
  function edit(id, opts) {
    opts = opts || {};
    var prev = id ? getStudent(id) : null;
    if (id && !prev) { ui.toast('수강생 정보를 찾을 수 없어요', { kind: 'error' }); return Promise.resolve(null); }
    var s = S(), t = today();
    var isNew = !prev;
    var f = prev ? Object.assign({}, prev) : {
      name: opts.name || '', phone: '', parentName: '', parentPhone: '', birth: '', school: '',
      courseId: st.course || (simple() && PS() && PS().products(s)[0] ? PS().products(s)[0].id : ''), levelId: '',
      teacherId: st.teacher || (arr(s.teachers).length ? s.teachers[0].id : ''),
      status: 'active', joinDate: t, leftDate: '', pauses: [], pass: simple() ? { type: 'month' } : { type: 'monthly', monthlyCount: 4 }, memo: '', color: ''
    };
    var pass = Object.assign({ type: 'monthly', monthlyCount: 4 }, f.pass || {});
    if (pass.type === 'monthly' && pass.monthlyCount == null) pass.monthlyCount = 4;

    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }

      var nameIn = ui.input({ value: f.name, placeholder: '예: 김민수', maxLength: 30, attrs: { autocomplete: 'off', 'aria-required': 'true' }, onInput: function () { checkName(); } });
      if (isNew) nameIn.setAttribute('autofocus', '');
      var nameHint = h('div', { class: 'field-hint stu-name-hint' });
      function checkName() {
        var v = nameIn.value.trim();
        nameIn.classList.remove('invalid');
        var dup = v && arr(D().students).filter(function (x) { return x.name === v && (!prev || x.id !== prev.id); });
        nameHint.textContent = dup && dup.length ? '같은 이름의 수강생이 ' + dup.length + '명 있어요. 구분할 수 있게 메모나 색을 달리해 두면 좋아요.' : '';
      }
      function phoneInput(v, ph) {
        var el = ui.input({ type: 'tel', value: v || '', placeholder: ph, maxLength: 20, attrs: { autocomplete: 'off' } });
        el.addEventListener('blur', function () { el.value = fmtPhone(el.value); });
        return el;
      }
      var phoneIn = phoneInput(f.phone, '010-0000-0000');
      var pNameIn = ui.input({ value: f.parentName || '', placeholder: '예: 어머님', maxLength: 20 });
      var pPhoneIn = phoneInput(f.parentPhone, '010-0000-0000');
      var birthIn = ui.input({ type: 'date', value: f.birth || '', max: t });
      var schoolIn = ui.input({ value: f.school || '', placeholder: '예: 한빛초 4학년', maxLength: 30 });
      // v1.1: 반 = 이용권 상품. 옛 과정을 쓰던 학생은 그 과정도 목록에 남긴다.
      var classOpts = [{ value: '', label: '미지정' }];
      if (simple() && PS()) {
        PS().products(s).forEach(function (x) { classOpts.push({ value: x.id, label: x.name + ' (' + x.count + '회 · ' + U.fmtNumber(x.amount) + '원)' }); });
        if (f.courseId && !PS().product(s, f.courseId)) classOpts.push({ value: f.courseId, label: nameOf('course', f.courseId) + ' (옛 과정)' });
      } else classOpts = selectOpts(s.courses);
      var courseSel = ui.select(classOpts, f.courseId || '');
      var levelSel = ui.select(selectOpts(s.levels), f.levelId || '');
      var teacherSel = ui.select(selectOpts(s.teachers), f.teacherId || '');
      var joinIn = ui.input({ type: 'date', value: f.joinDate || t });
      var memoIn = ui.input({ type: 'textarea', value: f.memo || '', placeholder: '예: 왼손 스틱 그립 교정 중, 셔틀 이용', rows: 3 });

      // 수강권
      var passBox = h('div', { class: 'stu-pass-box' });
      var cntIn = ui.input({ type: 'number', value: pass.monthlyCount != null ? pass.monthlyCount : 4, min: 0, max: 31, step: 1, inputmode: 'numeric' });
      cntIn.setAttribute('aria-label', '월 수업 횟수');
      function stepCnt(d) { var v = Math.max(0, Math.min(31, Math.round(num(cntIn.value, 0)) + d)); cntIn.value = v; ui.haptic('select'); }
      var sinceIn = ui.input({ type: 'date', value: pass.since || '' });
      function drawPass() {
        ui.clear(passBox);
        if (pass.type === 'monthly') {
          passBox.appendChild(ui.field('한 달 수업 횟수', h('div', { class: 'stepper' },
            h('button', { class: 'btn', type: 'button', attrs: { 'aria-label': '줄이기' }, onClick: function () { stepCnt(-1); } }, ic('minus', 18)),
            cntIn,
            h('button', { class: 'btn', type: 'button', attrs: { 'aria-label': '늘리기' }, onClick: function () { stepCnt(1); } }, ic('plus', 18))),
            '주 1회면 4, 주 2회면 8. 0이면 횟수 제한 없이 출석 수만 셉니다.'));
        } else if (pass.type === 'count') {
          var pi = prev ? safePass(prev) : null;
          passBox.appendChild(h('div', { class: 'banner info' }, ic('info', 18), h('div', { class: 'banner-body' },
            '횟수는 ', h('b', null, '결제'), ' 탭에서 충전해요. 출석·지각할 때마다 1회씩 차감됩니다.' +
            (S().deductAbsentFromPass ? ' (결석도 차감 설정이 켜져 있어요)' : ''),
            pi && pi.type === 'count' ? h('div', { class: 'strong mt-8' }, '현재 ' + pi.label) : null)));
          passBox.appendChild(ui.field('계산 시작일 (선택)', sinceIn, '이 날짜 이전 결제·출석은 잔여 횟수 계산에서 빼요. 비워 두면 전체 기간.'));
        } else {
          passBox.appendChild(h('div', { class: 'field-hint' }, '수강권 없이 출석만 기록해요.'));
        }
      }
      var passSeg = ui.segmented([{ value: 'monthly', label: '월 N회' }, { value: 'count', label: '횟수권' }, { value: 'none', label: '없음' }], pass.type, function (v) { pass.type = v; drawPass(); });
      passSeg.classList.add('full');
      drawPass();

      // 색
      var colorVal = f.color || '';
      var colorRow = h('div', { class: 'stu-colors', attrs: { role: 'radiogroup', 'aria-label': '표시 색' } });
      function drawColors() {
        ui.clear(colorRow);
        var auto = h('button', { class: 'stu-color auto' + (!colorVal ? ' on' : ''), type: 'button', attrs: { 'aria-label': '자동(과정 색)', role: 'radio', 'aria-checked': !colorVal ? 'true' : 'false' }, onClick: function () { colorVal = ''; drawColors(); } }, '자동');
        colorRow.appendChild(auto);
        ((DA.C && DA.C.DEFAULT_COLORS) || []).forEach(function (c) {
          colorRow.appendChild(h('button', {
            class: 'stu-color' + (colorVal === c ? ' on' : ''), type: 'button', style: { background: c },
            attrs: { 'aria-label': '색 ' + c, role: 'radio', 'aria-checked': colorVal === c ? 'true' : 'false' },
            onClick: function () { colorVal = c; ui.haptic('select'); drawColors(); }
          }, colorVal === c ? ic('check', 16) : null));
        });
      }
      drawColors();

      var moreOpen = !isNew && !!(f.birth || f.school || f.parentName || f.parentPhone || f.levelId || f.color);
      var moreBox = h('div', { class: 'stu-more-box' },
        h('div', { class: 'field-row' }, ui.field('생년월일', birthIn), ui.field('레벨', levelSel)),
        arr(s.teachers).length > 1 ? ui.field('담당 강사', teacherSel) : null,
        h('div', { class: 'field-row' }, ui.field('학교 / 직장', schoolIn), ui.field('보호자·비상 연락', pNameIn)),
        ui.field('비상 연락처', pPhoneIn),
        ui.field('표시 색', colorRow, '아바타에 쓰는 색이에요. 자동이면 반 색을 따라요.'));
      moreBox.hidden = !moreOpen;
      var moreBtn = h('button', { class: 'btn btn-ghost btn-sm stu-more-btn', type: 'button', attrs: { 'aria-expanded': moreOpen ? 'true' : 'false' }, onClick: function () {
        moreBox.hidden = !moreBox.hidden;
        moreBtn.setAttribute('aria-expanded', moreBox.hidden ? 'false' : 'true');
        moreBtn.lastChild.textContent = moreBox.hidden ? '더보기 (생년월일·레벨·연락처 등)' : '접기';
      } }, ic('chevD', 16), h('span', null, moreOpen ? '접기' : '더보기 (생년월일·레벨·연락처 등)'));
      var simpleForm = h('form', { class: 'v-students stu-form', attrs: { novalidate: '' }, onSubmit: function (e) { e.preventDefault(); } },
        ui.field('이름 *', nameIn), nameHint,
        h('div', { class: 'field-row' }, ui.field('연락처', phoneIn), ui.field('등록일', joinIn)),
        ui.field('반 (이용권)', courseSel, '이용권은 수강생 화면의 [이용권 발급]에서 달마다 충전해요.'),
        ui.field('메모', memoIn),
        moreBtn, moreBox);
      var form = simple() ? simpleForm : h('form', { class: 'v-students stu-form', attrs: { novalidate: '' }, onSubmit: function (e) { e.preventDefault(); } },
        ui.field('이름 *', nameIn), nameHint,
        h('div', { class: 'field-row' }, ui.field('연락처', phoneIn), ui.field('학교 / 학년', schoolIn)),
        h('div', { class: 'field-row' }, ui.field('보호자', pNameIn), ui.field('보호자 연락처', pPhoneIn)),
        h('div', { class: 'field-row' }, ui.field('생년월일', birthIn), ui.field('등록일', joinIn, '이 날짜 이전 수업은 출결에서 빠져요')),
        h('div', { class: 'stu-form-sec' }, '수업'),
        h('div', { class: 'field-row' }, ui.field('과정', courseSel), ui.field('레벨', levelSel)),
        ui.field('담당 강사', teacherSel),
        h('div', { class: 'stu-form-sec' }, '수강권'),
        h('div', { class: 'field' }, passSeg), passBox,
        h('div', { class: 'stu-form-sec' }, '기타'),
        ui.field('메모', memoIn),
        ui.field('표시 색', colorRow, '아바타·시간표에 쓰는 색이에요. 자동이면 과정 색을 따라요.'));

      function save() {
        var name = nameIn.value.trim().replace(/\s+/g, ' ');
        if (!name) {
          nameIn.classList.add('invalid');
          nameHint.textContent = '이름을 입력해 주세요.';
          try { nameIn.focus(); } catch (e) { /* 무시 */ }
          ui.haptic('error');
          return false;
        }
        var join = U.isYmd(joinIn.value) ? joinIn.value : (prev && prev.joinDate) || t;
        var p;
        if (simple()) {
          // 간단 모드에서는 수강권 방식을 고치지 않는다(옛 데이터 호환: 있던 값 그대로, 새 학생은 월 이용권)
          p = prev && prev.pass ? prev.pass : { type: 'month' };
        } else {
          p = { type: pass.type };
          if (pass.type === 'monthly') p.monthlyCount = Math.max(0, Math.min(31, Math.round(num(cntIn.value, 4))));
          if (pass.type === 'count' && U.isYmd(sinceIn.value)) p.since = sinceIn.value;
          var oldPass = (prev && prev.pass) || {};
          Object.keys(oldPass).forEach(function (k) { if (!(k in p) && k !== 'type' && k !== 'monthlyCount' && k !== 'since') p[k] = oldPass[k]; });
        }
        var rec = Object.assign({}, prev || {}, {
          name: name,
          phone: fmtPhone(phoneIn.value), parentName: pNameIn.value.trim(), parentPhone: fmtPhone(pPhoneIn.value),
          birth: U.isYmd(birthIn.value) ? birthIn.value : '', school: schoolIn.value.trim(),
          courseId: courseSel.value, levelId: levelSel.value, teacherId: teacherSel.value,
          joinDate: join, pass: p, memo: memoIn.value.trim(), color: colorVal
        });
        if (isNew) {
          rec.status = 'active'; rec.leftDate = ''; rec.pauses = [];
          rec.history = [{ date: join, type: 'join', reason: '', at: U.nowIso() }];   // v1.2 입·퇴원 기록
        }
        else { rec.status = prev.status || 'active'; rec.pauses = arr(prev.pauses).slice(); rec.leftDate = prev.leftDate || ''; }
        return DA.store.put('students', rec).then(function (saved) {
          ui.haptic('success');
          fin(saved);
          if (isNew) {
            setTimeout(function () { afterCreate(saved, opts); }, 280);
          } else {
            ui.toast('저장했어요', { kind: 'ok' });
          }
          return true;
        });
      }

      ui.sheet({
        title: isNew ? '새 수강생' : '정보 수정',
        sub: isNew ? '이름만 넣어도 등록돼요' : prev.name,
        className: 'v-students stu-edit-sheet',
        size: 'wide',
        autofocus: isNew ? true : false,
        content: form,
        actions: [
          { label: '취소', kind: 'ghost', onClick: function () { fin(null); } },
          { label: isNew ? '등록' : '저장', kind: 'primary', onClick: function () { return save(); } }
        ],
        onClose: function () { fin(null); }
      });
      nameIn.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) e.preventDefault(); });
      checkName();
    });
  }
  function safePass(s) { try { return SC.passInfo(D(), s, today(), new Date()); } catch (e) { return null; } }

  function afterCreate(s, opts) {
    if (opts && opts.noOffer) return;
    var cur = ui.current && ui.current();
    var inDetail = cur && cur.name === 'students' && cur.params.rest[0] === s.id;
    if (simple() && DA.passUI) {
      var offer = function () {
        var sh2 = ui.sheet({
          title: s.name + ' 등록 완료',
          sub: '이번 달 이용권을 바로 발급할까요?',
          className: 'v-students', autofocus: false,
          content: function () {
            var box = DA.passUI.issueBanner(s, today().slice(0, 7));
            box.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.pc-issue-btn')) setTimeout(function () { if (sh2) sh2.close(); }, 0); }, true);
            return h('div', null, box, h('p', { class: 'muted small' }, '나중에 수강생 화면에서 발급해도 돼요. 시간표는 고정 시간이 있는 사람만 넣으면 돼요.'));
          },
          actions: [{ label: '나중에', kind: 'ghost' }]
        });
      };
      if (inDetail) offer();
      else { ui.go('#/students/' + encodeURIComponent(s.id)); setTimeout(offer, 380); }
      return;
    }
    ui.sheet({
      title: s.name + ' 등록 완료',
      sub: '다음으로 할 일을 골라 주세요',
      className: 'v-students',
      autofocus: false,
      content: h('div', null,
        h('div', { class: 'info-card' }, ui.avatar(s.name, ui.studentColor(s), 'lg'),
          h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, s.name), h('div', { class: 'li-sub' }, studentSub(s) || '과정 미지정'))),
        h('p', { class: 'muted small' }, '시간표에 정규 수업을 넣어야 오늘 화면에 나타나고 서명을 받을 수 있어요.')),
      actions: [
        { label: '나중에', kind: 'ghost', onClick: function () { if (!inDetail) ui.go('#/students/' + encodeURIComponent(s.id)); } },
        { label: '시간표에 수업 추가', kind: 'primary', onClick: function () {
          if (!inDetail) { st.tab = 'lessons'; ui.go('#/students/' + encodeURIComponent(s.id)); }
          setTimeout(function () { addLesson(s.id); }, 320);
        } }
      ]
    });
  }

  /* ==================================================================
   * 상세
   * ================================================================== */
  function renderDetail(el, id) {
    var s = getStudent(id);
    var root = h('div', { class: 'v-students v-stu-detail' });
    el.appendChild(root);
    var backBtn = h('button', { class: 'btn btn-icon back', type: 'button', attrs: { 'aria-label': '수강생 목록' }, onClick: goList }, ic('chevL', 24));
    if (!s) {
      root.appendChild(h('header', { class: 'topbar' }, h('div', { class: 'topbar-row' }, backBtn, h('h1', { class: 'topbar-title' }, '수강생'))));
      root.appendChild(h('div', { class: 'page' }, h('div', { class: 'card' },
        ui.empty('user-x', '수강생을 찾을 수 없어요', '삭제되었거나 다른 기기의 주소일 수 있어요.', { label: '목록으로', onClick: goList }))));
      return;
    }
    if (st.detailId !== id) {
      st.detailId = id; st.calYm = U.ym(today()); st.recFilter = 'all'; st.recLimit = 40; st.passYm = U.ym(today());
    }
    var jobs = [];     // 화면에 붙은 뒤 실행(차트 폭 측정)
    var t = today();
    var ss = s.status || 'active';

    root.appendChild(h('header', { class: 'topbar' },
      h('div', { class: 'topbar-row' },
        backBtn,
        h('h1', { class: 'topbar-title' }, s.name),
        h('div', { class: 'topbar-actions' },
          h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '정보 수정' }, onClick: function () { edit(s.id); } }, ic('edit', 21)),
          h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '더 보기' }, onClick: function () { moreMenu(s); } }, ic('more', 22))))));

    var page = h('div', { class: 'page stu-detail' });
    root.appendChild(page);

    // v1.1: 맨 위 = 이번 달 출석 카드(회차 칸) + 이용권 발급
    if (DA.passUI && DA.pass) {
      var pym = st.passYm || U.ym(t);
      try {
        page.appendChild(DA.passUI.monthCard(s, pym, { onMonth: function (v) { st.passYm = v; ui.refresh(); } }));
        if (ss !== 'left' && !ui.isTeacherLocked()) page.appendChild(DA.passUI.issueBanner(s, pym));
      } catch (e) {
        logErr(e, 'monthCard');
        page.appendChild(h('div', { class: 'card' }, ui.empty('alert', '이용권 카드를 그리지 못했어요', String(e && e.message || e))));
      }
    }

    // 머리 카드
    var li = listInfo().map.get(s.id) || {};
    var pass = li.pass || safePass(s);
    var next = null;
    if (ss !== 'left') { try { next = SC.nextOccurrence(D(), s.id, new Date()); } catch (e) { next = null; } }
    var contact = h('div', { class: 'stu-contact' });
    if (s.phone) {
      contact.appendChild(h('a', { class: 'btn btn-sm', href: telHref(s.phone), attrs: { 'aria-label': s.name + '에게 전화' } }, ic('phone', 17), '전화'));
      contact.appendChild(h('a', { class: 'btn btn-sm', href: smsHref(s.phone), attrs: { 'aria-label': s.name + '에게 문자' } }, ic('sms', 17), '문자'));
    }
    if (s.parentPhone) {
      var pl = s.parentName || '보호자';
      contact.appendChild(h('a', { class: 'btn btn-sm', href: telHref(s.parentPhone), attrs: { 'aria-label': pl + '에게 전화' } }, ic('phone', 17), pl + ' 전화'));
      contact.appendChild(h('a', { class: 'btn btn-sm', href: smsHref(s.parentPhone), attrs: { 'aria-label': pl + '에게 문자' } }, ic('sms', 17), pl + ' 문자'));
    }
    if (!s.phone && !s.parentPhone) {
      contact.appendChild(h('button', { class: 'btn btn-sm btn-soft', type: 'button', onClick: function () { edit(s.id); } }, ic('plus', 16), '연락처 추가'));
    }
    var statusNote = null;
    if (ss === 'paused') {
      var op = openPause(s);
      statusNote = ui.banner('warn', (op ? U.fmtDate(op.from, { year: 'auto' }) + '부터 휴원 중이에요.' : '휴원 중이에요.') + ' 휴원 기간 수업은 출결에서 빠져요.', { action: { label: '복귀', kind: 'primary', onClick: function () { resume(s); } } });
    } else if (ss === 'left') {
      statusNote = ui.banner('info', (s.leftDate ? U.fmtDate(s.leftDate, { year: 'auto' }) + ' 퇴원' : '퇴원한 수강생') + '. 지난 기록은 그대로 남아 있어요.', { action: { label: '재등록', onClick: function () { reenroll(s); } } });
    }
    page.appendChild(h('div', { class: 'card stu-head' },
      h('div', { class: 'stu-head-top' },
        ui.avatar(s.name, ui.studentColor(s), 'xl'),
        h('div', { class: 'grow' },
          h('div', { class: 'row wrap gap-sm' }, h('span', { class: 'stu-head-name' }, s.name), statusBadge(s)),
          h('div', { class: 'muted small' }, studentSub(s) || '과정·강사 미지정'),
          next ? h('div', { class: 'stu-next' }, ic('clock', 15), '다음 수업 ' + (U.relDay(next.date) || U.fmtDate(next.date)) + ' ' + next.start + (next.kind !== 'regular' ? ' · ' + ((DA.C && DA.C.KIND[next.kind]) || '') : '')) :
            (ss === 'active' && !simple() && !SC.studentLessons(D(), s.id).length ? h('button', { class: 'stu-next warn', type: 'button', onClick: function () { st.tab = 'lessons'; ui.refresh(); setTimeout(function () { addLesson(s.id); }, 60); } }, ic('alert', 15), '정규 수업이 없어요 · 수업 추가') : null))),
      contact,
      statusNote));

    // 요약 카드
    var all = report(s, 'all'), mon = report(s, 'month');
    var eAll = entryOf(all, s.id), eMon = entryOf(mon, s.id);
    var allRate = all ? all.totals.rate : null, monRate = mon ? mon.totals.rate : null;
    if (simple()) {
      var mNow = monthInfo(s.id, U.ym(t));
      var paidAll = 0, usedAll = 0;
      (SC.index.paymentsByStudent(D()).get(s.id) || []).forEach(function (p0) { if (!DA.pass.isAdjust(p0)) paidAll += num(p0.amount, 0); });
      (SC.index.attendanceByStudent(D()).get(s.id) || []).forEach(function (r0) { usedAll += DA.pass.useAmount(D(), r0); });
      var locked = ui.isTeacherLocked();
      page.appendChild(h('div', { class: 'kpi-grid stu-kpis' },
        locked ? null : kpi('이번 달 사용 금액', U.fmtMoney(mNow ? mNow.usedAmount : 0), mNow && mNow.status !== 'none' ? '발급 ' + U.fmtMoney(mNow.amount) : '이번 달 미발급', null, null, null),
        locked ? kpi('이번 달 남은 횟수', mNow && mNow.status !== 'none' ? DA.pass.remainText(mNow) : '미발급', '') : kpi('남은 횟수 가치', U.fmtMoney(mNow ? mNow.remainingValue : 0), mNow && mNow.status !== 'none' ? DA.pass.remainText(mNow) : '', mNow && mNow.status === 'over' ? 'var(--st-absent)' : null),
        kpi('누적 출석', (all ? all.totals.attended : 0) + '회', all && all.totals.absent ? '당일취소 ' + all.totals.absent + '회' : '당일취소 없음'),
        kpi('최근 출석', li.last ? relOrDate(li.last, t) : '없음', li.last ? U.fmtDate(li.last) : ''),
        locked ? null : kpi('누적 결제', U.fmtMoney(paidAll), '사용 ' + U.fmtMoney(Math.round(usedAll)), null, null, function () { st.tab = 'pay'; ui.refresh(); }),
        kpi('연속 출석', eAll ? eAll.streak + '회' : '0회', eAll && eAll.bestStreak ? '최고 ' + eAll.bestStreak + '회' : '', eAll && eAll.streak >= 5 ? 'var(--accent)' : null, eAll && eAll.streak >= 5 ? 'star' : null)));
    } else page.appendChild(h('div', { class: 'kpi-grid stu-kpis' },
      kpi('전체 출석률', U.pct(allRate), all ? '출석 ' + all.totals.attended + ' / ' + (all.totals.attended + all.totals.absent + all.totals.unmarked) + '회' : '', rateColor(allRate)),
      kpi('이번 달', U.pct(monRate), mon ? (mon.totals.scheduled + mon.totals.upcoming + mon.totals.pending ? '출석 ' + mon.totals.attended + '회' + (mon.totals.late ? ' · 지각 ' + mon.totals.late : '') : '이번 달 수업 없음') : '', rateColor(monRate)),
      kpi('연속 출석', eAll ? eAll.streak + '회' : '0회', eAll && eAll.bestStreak ? '최고 ' + eAll.bestStreak + '회' : '', eAll && eAll.streak >= 5 ? 'var(--accent)' : null, eAll && eAll.streak >= 5 ? 'star' : null),
      kpi('최근 출석', li.last ? relOrDate(li.last, t) : '없음', eAll && eAll.consecutiveAbsent >= 2 ? eAll.consecutiveAbsent + '회 연속 결석' : (li.last ? U.fmtDate(li.last) : ''), eAll && eAll.consecutiveAbsent >= 2 ? 'var(--st-absent)' : null),
      kpi('보강 필요', (eAll ? eAll.makeupOwed : 0) + '회', eAll && eAll.makeupOwed ? '결석·공결 ' + (eAll.absent + eAll.excused) + ' · 보강 ' + (eAll.makeups || 0) : '밀린 보강 없음', eAll && eAll.makeupOwed ? 'var(--st-makeup)' : null, null,
        eAll && eAll.makeupOwed && ss !== 'left' ? function () { DA.actions.makeup(s.id, {}); } : null),
      kpi('수강권', pass && pass.type !== 'none' ? pass.label : '없음', pass && pass.type === 'count' ? '충전 ' + pass.total + ' · 사용 ' + pass.used : (pass && pass.type === 'monthly' ? (pass.total ? '월 ' + pass.total + '회' : '월 횟수 제한 없음') : ''), pass && pass.warn ? 'var(--st-late)' : null, pass && pass.warn ? 'alert' : null,
        function () { st.tab = 'pay'; ui.refresh(); })));

    // v1.2 연습실(예약·노쇼·벌점·제한)
    if (DA.roomsUI && ui.moduleOn('practice') && DA.rooms && DA.rooms.practiceRooms(S()).length) {
      try { page.appendChild(DA.roomsUI.studentCard(s)); } catch (e) { logErr(e, 'roomsCard'); }
    }

    // 탭(v1.2: 강사 모드면 결제 탭 숨김, 꺼진 기능 탭 숨김)
    var tabs = TABS.filter(function (x) {
      if (x.value === 'pay') return !ui.isTeacherLocked();
      if (x.value === 'progress') return ui.moduleOn('progress');
      if (x.value === 'lessons') return ui.moduleOn('timetable');
      return true;
    });
    if (!tabs.some(function (x) { return x.value === st.tab; })) st.tab = 'cal';
    var tabSeg = ui.segmented(tabs, st.tab, function (v) { st.tab = v; ui.refresh(); });
    tabSeg.classList.add('stu-tabs');
    page.appendChild(h('div', { class: 'stu-tabbar' }, tabSeg));
    var body = h('div', { class: 'stu-tab-body' });
    page.appendChild(body);
    try {
      if (st.tab === 'cal') tabCalendar(body, s);
      else if (st.tab === 'records') tabRecords(body, s);
      else if (st.tab === 'progress') tabProgress(body, s, jobs);
      else if (st.tab === 'stats') tabStats(body, s, jobs);
      else if (st.tab === 'pay') tabPay(body, s);
      else tabLessons(body, s);
    } catch (e) {
      logErr(e, 'tab.' + st.tab);
      body.appendChild(h('div', { class: 'card' }, ui.empty('alert', '이 탭을 그리지 못했어요', String(e && e.message || e))));
    }

    // 정보 카드
    page.appendChild(infoCard(s));
    // v1.2 입·퇴원 기록
    page.appendChild(historyCard(s));

    jobs.forEach(function (fn) { try { fn(); } catch (e) { logErr(e, 'chart'); } });
  }
  function goList() { ui.go('#/students', { replace: true }); }

  function kpi(label, value, sub, color, icon, onClick) {
    return h(onClick ? 'button' : 'div', { class: 'kpi' + (onClick ? ' stu-kpi-tap' : ''), type: onClick ? 'button' : null, onClick: onClick || null },
      h('div', { class: 'kpi-label' }, icon ? h('span', { style: { color: color || null } }, ic(icon, 14)) : null, label),
      h('div', { class: 'kpi-value', style: { color: color || null } }, value),
      sub ? h('div', { class: 'kpi-sub' }, sub) : null);
  }

  function historyCard(s) {
    var O = DA.ops;
    var list = O ? O.historyOf(s) : [];
    var box = h('div', { class: 'list flat stu-hist' });
    list.slice().reverse().forEach(function (e, ri) {
      var idx = list.length - 1 - ri;
      var miss = O.missingReason(e);
      box.appendChild(h('button', { class: 'list-item stu-hist-row' + (miss ? ' warn' : ''), type: 'button', dataset: { type: e.type }, onClick: function () { DA.opsUI.editReason(s.id, idx); } },
        h('span', { class: 'op-hist-date num' }, U.fmtDate(e.date, { weekday: false, year: 'auto' })),
        h('span', { class: 'badge op-h-' + e.type }, O.HISTORY_TYPES[e.type]),
        h('div', { class: 'li-main' }, h('div', { class: 'li-sub' + (miss ? ' warn-text' : '') }, e.reason || (miss ? '퇴원 사유 없음 — 눌러서 적어 주세요' : '사유 없음') + (e.derived ? ' · 예전 기록에서 추정' : ''))),
        miss ? ic('alert', 18) : ic('edit', 16)));
    });
    return h('section', { class: 'card stu-hist-card' },
      h('div', { class: 'card-h' }, h('h3', null, '입·퇴원 기록'), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: function () { ui.go('#/history'); } }, '전체', ic('chevR', 16))),
      list.length ? box : h('div', { class: 'muted small' }, '기록이 없어요'));
  }

  function infoCard(s) {
    var t = today();
    var dl = h('dl', { class: 'kv stu-kv' });
    function row(k, v) { if (v == null || v === '') return; dl.appendChild(h('dt', null, k)); dl.appendChild(h('dd', null, v)); }
    row('연락처', s.phone ? h('a', { href: telHref(s.phone) }, s.phone) : null);
    row('보호자', (s.parentName || s.parentPhone) ? h('span', null, s.parentName || '보호자', s.parentPhone ? ' · ' : '', s.parentPhone ? h('a', { href: telHref(s.parentPhone) }, s.parentPhone) : null) : null);
    if (s.birth) { var a = ageOf(s.birth, t); row('생년월일', U.fmtDate(s.birth, { year: true, weekday: false }) + (a != null ? ' (만 ' + a + '세)' : '')); }
    row('학교 / 학년', s.school);
    row('과정', s.courseId ? nameOf('course', s.courseId) : '');
    row('레벨', s.levelId ? nameOf('level', s.levelId) : '');
    row('담당 강사', s.teacherId ? nameOf('teacher', s.teacherId) : '');
    row('등록일', s.joinDate ? U.fmtDate(s.joinDate, { year: true }) : '');
    var pauses = arr(s.pauses).filter(function (p) { return p && p.from; });
    if (pauses.length) {
      row('휴원 기간', h('span', null, pauses.map(function (p, i) {
        return h('span', { class: 'stu-pause' }, U.fmtDate(p.from, { weekday: false, year: 'auto' }) + ' ~ ' + (p.to ? U.fmtDate(p.to, { weekday: false, year: 'auto' }) : '진행 중'), i < pauses.length - 1 ? ', ' : '');
      })));
    }
    if (s.leftDate) row('퇴원일', U.fmtDate(s.leftDate, { year: true }));
    return h('div', { class: 'card stu-info' },
      h('div', { class: 'card-h' }, h('h3', null, '수강생 정보'), h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: function () { edit(s.id); } }, ic('edit', 16), '수정')),
      s.memo ? h('div', { class: 'stu-memo' }, ic('note', 16), h('div', null, s.memo)) : null,
      dl.children.length ? dl : h('p', { class: 'muted small' }, '연락처·학교 같은 정보를 넣어 두면 여기에 보여요.'));
  }

  /* ---------------- 탭: 출석 달력 ---------------- */
  function tabCalendar(body, s) {
    var t = today();
    var ym = st.calYm || U.ym(t);
    var mStart = ym + '-01', mEnd = U.monthEnd(mStart);
    var ws = weekStart();
    var gFrom = U.startOfWeek(mStart, ws);
    var gTo = U.addDays(U.startOfWeek(mEnd, ws), 6);
    var rows = cached('cal:' + s.id + ':' + ym, function () {
      try { return SC.rows(D(), mStart, mEnd, new Date(), { studentId: s.id }); } catch (e) { logErr(e, 'cal'); return []; }
    });
    var byDate = {};
    var cnt = { present: 0, late: 0, absent: 0, excused: 0, canceled: 0, unmarked: 0, upcoming: 0, pending: 0 };
    rows.forEach(function (r) {
      (byDate[r.date] = byDate[r.date] || []).push(r);
      if (cnt[r.status] != null) cnt[r.status]++;
    });
    var closed = {};
    arr(S().closedDays).forEach(function (d) { closed[d] = 1; });
    var firstYm = U.ym(studentFrom(s));
    var canPrev = ym > firstYm;

    function move(n) { st.calYm = U.ym(U.addMonths(mStart, n)); ui.haptic('select'); ui.refresh(); }
    var head = h('div', { class: 'stu-cal-head' },
      h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '이전 달' }, disabled: !canPrev, onClick: function () { move(-1); } }, ic('chevL', 22)),
      h('div', { class: 'stu-cal-title' }, U.fmtMonth(ym, { year: ym.slice(0, 4) !== t.slice(0, 4) })),
      h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '다음 달' }, disabled: ym >= U.ym(U.addMonths(t, 3)), onClick: function () { move(1); } }, ic('chevR', 22)),
      ym !== U.ym(t) ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: function () { st.calYm = U.ym(t); ui.refresh(); } }, '이번 달') : null);

    var grid = h('div', { class: 'stu-cal', attrs: { role: 'grid', 'aria-label': U.fmtMonth(ym, { year: true }) + ' 출석 달력' } });
    for (var i = 0; i < 7; i++) {
      var wd = (ws + i) % 7;
      grid.appendChild(h('div', { class: 'stu-cal-wd' + (wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''), attrs: { role: 'columnheader' } }, WD[wd]));
    }
    U.rangeDays(gFrom, gTo).forEach(function (d) {
      var inMonth = d >= mStart && d <= mEnd;
      var list = inMonth ? (byDate[d] || []) : [];
      var dots = h('span', { class: 'stu-cal-dots' });
      list.slice(0, 3).forEach(function (r) { dots.appendChild(h('span', { class: 'dot st-' + r.status + (r.auto ? ' auto' : '') })); });
      if (list.length > 3) dots.appendChild(h('span', { class: 'stu-cal-more' }, '+'));
      var main = list.length ? mainStatus(list) : '';
      var wdN = U.weekday(d);
      var label = U.fmtDate(d) + (list.length ? ' ' + list.map(function (r) { return stLabel(r.status); }).join(', ') : '') + (closed[d] ? ' 휴원일' : '');
      grid.appendChild(h('button', {
        class: ['stu-cal-day', inMonth ? '' : 'out', d === t ? 'today' : '', list.length ? 'has' : '', main ? 'm-' + main : '', closed[d] ? 'closed' : '', wdN === 0 ? 'sun' : wdN === 6 ? 'sat' : ''],
        type: 'button', disabled: !inMonth, attrs: { 'aria-label': label, role: 'gridcell' },
        onClick: inMonth ? function () { daySheet(s, d); } : null
      }, h('span', { class: 'stu-cal-n' }, String(+d.slice(8))), dots));
    });

    var denom = cnt.present + cnt.late + cnt.absent + cnt.unmarked;
    var legend = h('div', { class: 'stu-cal-sum' });
    ['present', 'late', 'absent', 'excused', 'canceled', 'unmarked', 'upcoming'].forEach(function (k) {
      if (!cnt[k] && k !== 'present' && k !== 'absent') return;
      legend.appendChild(h('span', { class: 'stu-cal-leg' }, h('span', { class: 'dot st-' + k }), stLabel(k), h('b', null, cnt[k])));
    });
    body.appendChild(h('div', { class: 'card stu-cal-card' }, head, grid,
      h('div', { class: 'stu-cal-foot' },
        h('div', { class: 'stu-cal-rate' }, '이 달 출석률 ', h('b', { style: { color: rateColor(denom ? (cnt.present + cnt.late) / denom : null) } }, U.pct(denom ? (cnt.present + cnt.late) / denom : null))),
        legend),
      !rows.length ? h('p', { class: 'muted small stu-cal-empty' }, '이 달에는 수업이 없었어요.') : null));
  }
  function mainStatus(list) {
    var order = ['absent', 'unmarked', 'late', 'present', 'excused', 'pending', 'upcoming', 'canceled'];
    for (var i = 0; i < order.length; i++) for (var j = 0; j < list.length; j++) if (list[j].status === order[i]) return order[i];
    return list[0].status;
  }

  function daySheet(s, d) {
    var rows = [];
    try { rows = SC.rows(D(), d, d, new Date(), { studentId: s.id }); } catch (e) { logErr(e, 'daySheet'); }
    var closed = arr(S().closedDays).indexOf(d) >= 0;
    var sh = ui.sheet({
      title: U.fmtDate(d, { year: 'auto' }),
      sub: s.name + (U.relDay(d) ? ' · ' + U.relDay(d) : ''),
      className: 'v-students stu-day-sheet',
      size: 'wide',
      autofocus: false,
      content: function () {
        var box = h('div', { class: 'stu-day' });
        if (closed) box.appendChild(ui.banner('info', '학원 휴원일이에요.'));
        if (!rows.length) {
          box.appendChild(ui.empty('calendar', '이 날은 수업이 없었어요', s.status === 'left' ? '' : '보강이나 명단 외 수업을 잡을 수 있어요.',
            s.status === 'left' ? null : { label: '이 날 보강 잡기', icon: 'repeat', onClick: function () { sh.close(); DA.actions.makeup(s.id, { date: d }); } }));
          return box;
        }
        rows.forEach(function (r) { box.appendChild(dayRowCard(s, r, function () { sh.close(); })); });
        return box;
      },
      actions: [{ label: '닫기', kind: 'ghost' }]
    });
  }
  function dayRowCard(s, r, closeSheet) {
    var occ = r.occ, rec = r.record;
    var label = SC.lessonLabel(D(), occ);
    var sig = rec && rec.signature && DA.sig && DA.sig.el ? h('button', { class: 'stu-day-sig', type: 'button', attrs: { 'aria-label': '서명 크게 보기' }, onClick: function () { DA.actions.showSignature(rec); } }, DA.sig.el(rec.signature, { height: 150 })) : null;
    var prog = rec && rec.progress;
    var progText = prog ? [prog.song, prog.book, prog.bpm ? prog.bpm + ' BPM' : ''].filter(Boolean).join(' · ') : '';
    return h('div', { class: 'stu-day-item' },
      h('div', { class: 'row between wrap' },
        h('div', { class: 'grow' },
          h('div', { class: 'strong' }, occ.start + '–' + occ.end + ' ', h('span', { class: 'muted' }, label)),
          h('div', { class: 'small muted' }, [occ.teacherId ? nameOf('teacher', occ.teacherId) : '', occ.roomId ? nameOf('room', occ.roomId) : ''].filter(Boolean).join(' · ') || ' ',
            occ.kind && occ.kind !== 'regular' ? ' ' : '', occ.kind && occ.kind !== 'regular' ? ui.kindBadge(occ.kind) : null)),
        ui.badge(r.status, { auto: r.auto, lg: true })),
      sig,
      rec && rec.signedAt ? h('div', { class: 'small muted' }, ic('pen', 14), ' ' + U.fmtTime(rec.signedAt) + ' 서명') : (rec && rec.method === 'manual' ? h('div', { class: 'small muted' }, '직접 입력') : null),
      rec && rec.note ? h('div', { class: 'stu-note' }, ic('note', 14), rec.note) : null,
      progText || (prog && prog.memo) ? h('div', { class: 'stu-note prog' }, ic('music', 14), h('span', null, progText, prog && prog.memo ? (progText ? ' — ' : '') + prog.memo : '')) : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-sm', type: 'button', onClick: function () { closeSheet(); setTimeout(function () { DA.actions.menu(occ, s.id, { date: r.date }); }, 40); } }, ic('edit', 16), '출결 처리'),
        h('button', { class: 'btn btn-sm', type: 'button', onClick: function () { closeSheet(); setTimeout(function () { DA.actions.editProgress(occ, s.id, { date: r.date }); }, 40); } }, ic('music', 16), '진도')));
  }

  /* ---------------- 탭: 기록 목록 ---------------- */
  function tabRecords(body, s) {
    var rows = studentRows(s).slice().reverse();
    var counts = { all: rows.length };
    rows.forEach(function (r) { counts[r.status] = (counts[r.status] || 0) + 1; });
    var filters = [['all', '전체'], ['present', '출석'], ['late', '지각'], ['absent', simple() ? '당일취소' : '결석'], ['excused', '공결'], ['canceled', '휴강'], ['unmarked', '미확인'], ['pending', '서명 대기'], ['signed', '서명']];
    counts.signed = rows.filter(function (r) { return r.record && r.record.signature; }).length;
    var chips = h('div', { class: 'hscroll stu-chip-row' });
    filters.forEach(function (f) {
      if (f[0] !== 'all' && !counts[f[0]]) return;
      chips.appendChild(h('button', { class: 'chip' + (st.recFilter === f[0] ? ' on' : ''), type: 'button', onClick: function () { st.recFilter = f[0]; st.recLimit = 40; ui.refresh(); } }, f[1], h('span', { class: 'count' }, counts[f[0]] || 0)));
    });
    body.appendChild(chips);
    var list = rows.filter(function (r) {
      if (st.recFilter === 'all') return true;
      if (st.recFilter === 'signed') return !!(r.record && r.record.signature);
      return r.status === st.recFilter;
    });
    if (!list.length) {
      body.appendChild(h('div', { class: 'card' }, ui.empty('list', rows.length ? '해당하는 기록이 없어요' : '아직 출결 기록이 없어요',
        rows.length ? '다른 칩을 골라 보세요.' : '시간표에 수업을 넣으면 여기에 쌓여요.')));
      return;
    }
    var box = h('div', { class: 'list stu-rec-list' });
    var lastYm = '';
    list.slice(0, st.recLimit).forEach(function (r) {
      var ym = U.ym(r.date);
      if (ym !== lastYm) {
        lastYm = ym;
        box.appendChild(h('div', { class: 'stu-rec-month' }, U.fmtMonth(ym, { year: ym.slice(0, 4) !== today().slice(0, 4) })));
      }
      box.appendChild(recRow(s, r));
    });
    body.appendChild(box);
    if (list.length > st.recLimit) {
      body.appendChild(h('button', { class: 'btn btn-block stu-more', type: 'button', onClick: function () { st.recLimit += 60; ui.refresh(); } }, '더 보기 (' + (list.length - st.recLimit) + '건 남음)'));
    }
  }
  function recRow(s, r) {
    var rec = r.record, occ = r.occ;
    var prog = rec && rec.progress;
    var progText = prog ? [prog.song, prog.book, prog.bpm ? prog.bpm + ' BPM' : ''].filter(Boolean).join(' · ') : '';
    var subParts = [occ.start + '–' + occ.end];
    if (occ.teacherId) subParts.push(nameOf('teacher', occ.teacherId));
    if (rec && rec.signedAt) subParts.push(U.fmtTime(rec.signedAt) + ' 서명');
    else if (rec && rec.method === 'manual') subParts.push('직접 입력');
    return h('button', {
      class: 'list-item stu-rec' + (r.orphan ? ' orphan' : ''), type: 'button',
      onClick: function () { DA.actions.menu(occ, s.id, { date: r.date }); }
    },
      h('div', { class: 'stu-rec-date' }, h('b', null, String(+r.date.slice(8))), h('span', null, WD[U.weekday(r.date)])),
      h('div', { class: 'li-main' },
        h('div', { class: 'li-title row gap-sm' }, h('span', { class: 'ellipsis' }, SC.lessonLabel(D(), occ)), occ.kind && occ.kind !== 'regular' ? ui.kindBadge(occ.kind) : null),
        h('div', { class: 'li-sub' }, subParts.join(' · ')),
        rec && rec.note ? h('div', { class: 'li-sub stu-rec-note' }, ic('note', 13), ' ' + rec.note) : null,
        progText ? h('div', { class: 'li-sub stu-rec-prog' }, ic('music', 13), ' ' + progText) : null),
      h('div', { class: 'li-end col stu-rec-end' },
        ui.badge(r.status, { auto: r.auto }),
        rec && rec.signature && DA.sig && DA.sig.el ? h('span', { class: 'sig-thumb' }, DA.sig.el(rec.signature, { width: 72, height: 32, strokeWidth: 1.4 })) : null));
  }

  /* ---------------- 탭: 진도 ---------------- */
  function tabProgress(body, s, jobs) {
    var recs = (SC.index.attendanceByStudent(D()).get(s.id) || []).filter(function (r) {
      var p = r.progress; return p && (p.song || p.book || p.memo || num(p.bpm, 0) > 0);
    });
    var target = progressTarget(s);
    var addBtn = target ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: function () { DA.actions.editProgress(target.occ, s.id, { date: target.date }); } },
      ic('plus', 16), (U.relDay(target.date) || U.fmtDate(target.date, { weekday: false })) + ' 수업 진도') : null;
    if (!recs.length) {
      body.appendChild(h('div', { class: 'card' }, ui.empty('music', '아직 진도 기록이 없어요',
        '수업마다 곡·교재·BPM을 남기면 실력이 느는 게 한눈에 보여요.', addBtn)));
      return;
    }
    var bpms = recs.filter(function (r) { return num(r.progress.bpm, 0) > 0; });
    var last = recs[recs.length - 1].progress;
    var firstB = bpms.length ? num(bpms[0].progress.bpm, 0) : null, lastB = bpms.length ? num(bpms[bpms.length - 1].progress.bpm, 0) : null;
    var delta = firstB != null && lastB != null ? lastB - firstB : null;
    body.appendChild(h('div', { class: 'card stu-prog-now' },
      h('div', { class: 'card-h' }, h('h3', null, '지금 하는 것'), addBtn),
      h('div', { class: 'stu-prog-grid' },
        progCell('곡', last.song || lastOf(recs, 'song') || '—'),
        progCell('교재', last.book || lastOf(recs, 'book') || '—'),
        progCell('BPM', lastB != null ? String(lastB) : '—', delta ? (delta > 0 ? '+' : '') + delta + ' (처음 ' + firstB + ')' : null, delta > 0 ? 'var(--st-present)' : null))));

    if (bpms.length >= 2) {
      var chartHost = h('div', { class: 'stu-chart' });
      body.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, 'BPM 추이'), h('span', { class: 'muted small' }, bpms.length + '회 기록')), chartHost));
      var pts = bpms.slice(-40).map(function (r) { return { label: (+r.date.slice(5, 7)) + '/' + (+r.date.slice(8)), value: num(r.progress.bpm, 0), title: U.fmtDate(r.date) + ' ' + r.progress.bpm + ' BPM' + (r.progress.song ? ' · ' + r.progress.song : '') }; });
      jobs.push(function () {
        if (DA.charts && DA.charts.line) {
          var vals = pts.map(function (p) { return p.value; });
          DA.charts.line(chartHost, {
            data: pts, height: 190, color: 'var(--accent)', area: true, points: true,
            yMin: Math.max(0, Math.floor((Math.min.apply(null, vals) - 10) / 10) * 10), yMax: Math.ceil((Math.max.apply(null, vals) + 10) / 10) * 10,
            format: function (v) { return Math.round(v) + ''; }
          });
        } else fallbackBars(chartHost, pts, function (v) { return v + ' BPM'; });
      });
    }

    var list = h('div', { class: 'stu-timeline' });
    recs.slice().reverse().slice(0, 80).forEach(function (r) {
      var p = r.progress;
      var occ = SC.occForRecord(D(), r);
      list.appendChild(h('button', { class: 'stu-tl-item', type: 'button', onClick: function () { DA.actions.editProgress(occ, s.id, { date: r.date }); } },
        h('span', { class: 'stu-tl-dot' }),
        h('div', { class: 'stu-tl-body' },
          h('div', { class: 'stu-tl-date' }, U.fmtDate(r.date, { year: 'auto' })),
          h('div', { class: 'stu-tl-main' },
            p.song ? h('span', { class: 'strong' }, p.song) : null,
            p.book ? h('span', { class: 'muted' }, (p.song ? ' · ' : '') + p.book) : null,
            num(p.bpm, 0) > 0 ? h('span', { class: 'badge stu-bpm' }, ic('metronome', 12), p.bpm + ' BPM') : null),
          p.memo ? h('div', { class: 'stu-tl-memo' }, p.memo) : null)));
    });
    body.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, '진도 기록'), h('span', { class: 'muted small' }, recs.length + '건')), list));
  }
  function lastOf(recs, k) { for (var i = recs.length - 1; i >= 0; i--) if (recs[i].progress[k]) return recs[i].progress[k]; return ''; }
  function progCell(k, v, sub, color) {
    return h('div', { class: 'stu-prog-cell' }, h('div', { class: 'muted small' }, k), h('div', { class: 'stu-prog-v' }, v), sub ? h('div', { class: 'small', style: { color: color || 'var(--text-3)' } }, sub) : null);
  }
  // 진도를 기록할 회차: 오늘 수업 → 가장 최근 지난 수업
  function progressTarget(s) {
    var rows = studentRows(s);
    var t = today();
    for (var i = rows.length - 1; i >= 0; i--) {
      if (rows[i].date === t && rows[i].status !== 'canceled') return rows[i];
    }
    for (var j = rows.length - 1; j >= 0; j--) {
      var st2 = rows[j].status;
      if (st2 === 'present' || st2 === 'late') return rows[j];
    }
    for (var k = rows.length - 1; k >= 0; k--) if (rows[k].status !== 'canceled') return rows[k];
    return null;
  }

  /* ---------------- 탭: 통계 ---------------- */
  function tabStats(body, s, jobs) {
    var seg = ui.segmented([{ value: 'last3m', label: '최근 3개월' }, { value: 'year', label: '올해' }, { value: 'all', label: '전체' }], st.statRange, function (v) { st.statRange = v; ui.refresh(); });
    body.appendChild(h('div', { class: 'stu-stat-seg' }, seg));
    var rep = report(s, st.statRange);
    if (!rep) { body.appendChild(h('div', { class: 'card' }, ui.empty('chart', '통계를 계산하지 못했어요', '잠시 후 다시 열어 주세요.'))); return; }
    var T = rep.totals, e = entryOf(rep, s.id);
    if (!T.scheduled) {
      body.appendChild(h('div', { class: 'card' }, ui.empty('chart', '이 기간에는 수업이 없었어요', rep.range.label)));
      return;
    }
    body.appendChild(h('div', { class: 'muted small stu-range' }, rep.range.label));
    if (simple()) body.appendChild(h('div', { class: 'kpi-grid' },
      kpi('출석률', U.pct(T.rate), '출석 ' + T.attended + ' / ' + (T.attended + T.absent + T.unmarked), rateColor(T.rate)),
      kpi('당일취소', T.absent + '회', T.absentAuto ? '고정 수업 기록 없음 ' + T.absentAuto + '회 포함' : '1회씩 차감', T.absent ? 'var(--st-absent)' : null),
      kpi('서명 출석', T.signed + '회', T.manual ? '직접 입력 ' + T.manual + '회' : ''),
      kpi('사용 금액', U.fmtMoney(e ? e.usedAmount || 0 : 0), '발급 ' + U.fmtMoney(e ? e.issuedAmount || 0 : 0))));
    else body.appendChild(h('div', { class: 'kpi-grid' },
      kpi('출석률', U.pct(T.rate), '출석 ' + T.attended + ' / ' + (T.attended + T.absent + T.unmarked), rateColor(T.rate)),
      kpi('지각률', U.pct(T.lateRate), '지각 ' + T.late + '회', T.late ? 'var(--st-late)' : null),
      kpi('결석', T.absent + '회', T.absentAuto ? '기록 없음 ' + T.absentAuto + '회 포함' : '', T.absent ? 'var(--st-absent)' : null),
      kpi('공결 · 휴강', T.excused + ' · ' + T.canceled, '출석률 계산에서 빠져요'),
      kpi('평균 서명 시각', T.avgSignOffsetMin == null ? '–' : offsetText(T.avgSignOffsetMin), '수업 시작 대비'),
      kpi('서명 출석', T.signed + '회', T.manual ? '직접 입력 ' + T.manual + '회' : '', null, null)));

    var mHost = h('div', { class: 'stu-chart' }), wHost = h('div', { class: 'stu-chart' }), dHost = h('div', { class: 'stu-chart donut' });
    var months = rep.byMonth.filter(function (m) { return m.present + m.late + m.absent + m.unmarked > 0; });
    var wds = rep.byWeekday.filter(function (w) { return w.scheduled > 0; });
    var mix = rep.statusMix.filter(function (x) { return x.count > 0; });
    body.appendChild(h('div', { class: 'stu-stat-grid' },
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, '월별 출석률')), mHost),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, '요일별 출석률')), wHost),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, '출결 구성')), dHost)));
    var pctFmt = function (v) { return Math.round(v) + '%'; };
    var mData = months.map(function (m) { return { label: m.label, value: Math.round(m.rate * 100), color: rateColor(m.rate), title: m.label + ' 출석 ' + m.attended + ' / ' + (m.attended + m.absent + m.unmarked) + '회' }; });
    var wData = wds.map(function (w) { var d = w.present + w.late + w.absent + w.unmarked; return { label: w.label, value: w.rate == null ? 0 : Math.round(w.rate * 100), color: rateColor(w.rate), title: w.label + '요일 ' + (d ? '출석 ' + w.attended + ' / ' + d + '회' : '휴강·공결만 있음') }; });
    var dData = mix.map(function (x) { return { label: x.label, value: x.count, color: 'var(--st-' + x.status + ')' }; });
    jobs.push(function () {
      if (DA.charts && DA.charts.bar) DA.charts.bar(mHost, { data: mData, height: 180, max: 100, format: pctFmt, valueLabels: true });
      else fallbackBars(mHost, mData, pctFmt, 100);
      if (DA.charts && DA.charts.bar) DA.charts.bar(wHost, { data: wData, height: 170, max: 100, format: pctFmt, valueLabels: true });
      else fallbackBars(wHost, wData, pctFmt, 100);
      if (DA.charts && DA.charts.donut) DA.charts.donut(dHost, { data: dData, size: 160, centerText: U.pct(T.rate), centerSub: '출석률' });
      else fallbackBars(dHost, dData, function (v) { return v + '회'; });
    });

    if (e) {
      body.appendChild(h('div', { class: 'card' },
        h('div', { class: 'card-h' }, h('h3', null, '기록 요약')),
        h('dl', { class: 'kv' },
          h('dt', null, simple() ? '기록' : '예정 수업'), h('dd', null, T.scheduled + '회' + (simple() ? '' : ' (휴강·공결 포함)')),
          h('dt', null, simple() ? '출석 / 당일취소' : '출석 / 지각'), h('dd', null, simple() ? T.attended + '회 / ' + T.absent + '회' : T.present + '회 / ' + T.late + '회'),
          h('dt', null, '연속 출석'), h('dd', null, e.streak + '회 (최고 ' + e.bestStreak + '회)'),
          simple() ? null : h('dt', null, '보강'), simple() ? null : h('dd', null, '진행 ' + (e.makeups || 0) + '회 · 필요 ' + e.makeupOwed + '회'),
          e.avgBpm ? h('dt', null, 'BPM') : null, e.avgBpm ? h('dd', null, (e.bpmFirst && e.bpmFirst !== e.avgBpm ? e.bpmFirst + ' → ' : '') + e.avgBpm) : null)));
    }
  }
  function offsetText(m) {
    var v = Math.round(m);
    if (v === 0) return '정시';
    return v < 0 ? (-v) + '분 일찍' : v + '분 늦게';
  }
  // charts.js가 없을 때 쓰는 간단한 막대
  function fallbackBars(host, data, fmt, max) {
    ui.clear(host);
    if (!data.length) { host.appendChild(h('p', { class: 'muted small' }, '데이터가 없어요')); return; }
    var mx = max || Math.max.apply(null, data.map(function (d) { return d.value; })) || 1;
    var box = h('div', { class: 'stu-fb' });
    data.forEach(function (d) {
      box.appendChild(h('div', { class: 'stu-fb-row', attrs: { title: d.title || '' } },
        h('span', { class: 'stu-fb-l' }, d.label),
        h('span', { class: 'progress' }, h('span', { style: { width: Math.max(0, Math.min(100, d.value / mx * 100)) + '%', background: d.color || 'var(--accent)' } })),
        h('span', { class: 'stu-fb-v' }, fmt(d.value))));
    });
    host.appendChild(box);
  }

  /* ---------------- 탭: 결제 ---------------- */
  // v1.1: 달마다 발급·사용 요약 + 발급·조정·결제 목록
  function tabPass(body, s) {
    var t = today(), nowYm = t.slice(0, 7);
    var pays = (SC.index.paymentsByStudent(D()).get(s.id) || []).slice().reverse();
    var recs = SC.index.attendanceByStudent(D()).get(s.id) || [];
    var yms = {};
    yms[nowYm] = 1;
    pays.forEach(function (p) { var y = DA.pass.revenueMonth(p); if (y) yms[y] = 1; });
    recs.forEach(function (r) { if (r.status === 'present' || r.status === 'late' || r.status === 'absent') yms[r.date.slice(0, 7)] = 1; });
    var months = Object.keys(yms).sort().reverse().slice(0, 12);
    var tbody = h('tbody');
    var tot = { amount: 0, used: 0, usedAmount: 0 };
    months.forEach(function (ym) {
      var m = monthInfo(s.id, ym);
      tot.amount += m.amount; tot.used += m.used; tot.usedAmount += m.usedAmount;
      tbody.appendChild(h('tr', { class: 'tap', onClick: function () { st.passYm = ym; window.scrollTo(0, 0); ui.refresh(); } },
        h('td', null, DA.pass.monthLabel(ym, nowYm)),
        h('td', { class: 'num' }, m.status === 'none' ? h('span', { class: 'faint' }, '미발급') : m.used + '/' + m.total + '회'),
        h('td', { class: 'num' }, m.amount ? U.fmtNumber(m.amount) : '—'),
        h('td', { class: 'num' }, m.usedAmount ? U.fmtNumber(m.usedAmount) : '—'),
        h('td', { class: 'num' }, m.status === 'none' ? '' : DA.passUI.statusBadge(m))));
    });
    body.appendChild(h('div', { class: 'card stu-pass-months' },
      h('div', { class: 'card-h' }, h('h3', null, '달별 이용권'), h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: function () { DA.passUI.issueSheet(s, { month: st.passYm || nowYm }); } }, ic('plus', 16), '이용권 발급')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, '달'), h('th', { class: 'num' }, '사용'), h('th', { class: 'num' }, '발급(원)'), h('th', { class: 'num' }, '사용(원)'), h('th', { class: 'num' }, '남은'))),
        tbody,
        h('tfoot', null, h('tr', null, h('td', null, '합계'), h('td', { class: 'num' }, tot.used + '회'), h('td', { class: 'num' }, U.fmtNumber(tot.amount)), h('td', { class: 'num' }, U.fmtNumber(tot.usedAmount)), h('td'))))),
      h('p', { class: 'muted small' }, '줄을 누르면 위 카드가 그 달로 바뀌어요. 회당 금액 = 그 달 발급 금액 ÷ 발급 횟수(조정 제외).')));

    if (!pays.length) {
      body.appendChild(h('div', { class: 'card' }, ui.empty('card', '발급·결제 기록이 없어요', '위의 [이용권 발급]으로 이번 달 횟수를 충전해 주세요.')));
      return;
    }
    var list = h('div', { class: 'list stu-pay-list' });
    pays.forEach(function (p) {
      var adj = DA.pass.isAdjust(p);
      var issue = !adj && (p.month || p.kind === 'issue');
      var ym = DA.pass.revenueMonth(p);
      var title = adj ? DA.pass.monthLabel(ym, nowYm) + ' 횟수 ' + (num(p.count, 0) > 0 ? '+' : '−') + Math.abs(num(p.count, 0)) + '회'
        : issue ? DA.pass.monthLabel(ym, nowYm) + ' ' + (p.productName || '이용권') + ' ' + num(p.count, 0) + '회'
          : U.fmtMoney(num(p.amount, 0));
      var sub = [U.fmtDate(p.date, { year: 'auto' })];
      if (!adj) sub.push(U.fmtMoney(num(p.amount, 0)));
      if (!adj && p.method) sub.push(p.method);
      if (!issue && !adj && num(p.count, 0) > 0) sub.push(p.count + '회 충전(옛 결제)');
      list.appendChild(h('button', {
        class: 'list-item', type: 'button', onClick: function () {
          if (adj) {
            ui.confirm(title + ' 조정을 지울까요?', { title: '횟수 조정 삭제', ok: '삭제', danger: true }).then(function (ok) {
              if (ok) DA.store.remove('payments', p.id).then(function () { ui.toast('조정을 지웠어요', { kind: 'ok' }); });
            });
          } else if (issue) DA.passUI.issueSheet(s, { payment: p });
          else payEditor(s, p);
        }
      },
        h('span', { class: 'li-ic' }, ic(adj ? (num(p.count, 0) > 0 ? 'plus' : 'minus') : issue ? 'card' : (p.method === '현금' ? 'money' : 'card'), 18)),
        h('div', { class: 'li-main' },
          h('div', { class: 'li-title num' }, title),
          h('div', { class: 'li-sub' }, sub.filter(Boolean).join(' · ') + (p.memo ? ' — ' + p.memo : ''))),
        ic('chevR', 18)));
    });
    body.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, '발급·결제 기록'), h('span', { class: 'muted small' }, pays.length + '건')), list));
  }

  function tabPay(body, s) {
    if (simple() && DA.pass && DA.passUI) { tabPass(body, s); return; }
    var t = today();
    var pays = (SC.index.paymentsByStudent(D()).get(s.id) || []).slice().reverse();
    var pass = safePass(s);
    var total = 0, yearTotal = 0, charged = 0;
    pays.forEach(function (p) { var a = num(p.amount, 0); total += a; if (p.date.slice(0, 4) === t.slice(0, 4)) yearTotal += a; charged += Math.max(0, Math.floor(num(p.count, 0))); });
    var addBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: function () { payEditor(s, null); } }, ic('plus', 16), '결제 추가');

    // 수강권 요약
    var passCard = h('div', { class: 'card stu-pass-card' }, h('div', { class: 'card-h' }, h('h3', null, '수강권'), addBtn));
    if (pass && pass.type === 'count') {
      var rem = pass.remaining;
      var ratio = pass.total ? Math.max(0, Math.min(1, pass.used / pass.total)) : 1;
      passCard.appendChild(h('div', { class: 'stu-pass-big', style: { color: pass.warn ? 'var(--st-late-ink)' : null } }, rem >= 0 ? '잔여 ' + rem + '회' : (-rem) + '회 초과'));
      passCard.appendChild(h('div', { class: 'progress lg' }, h('span', { style: { width: Math.round(ratio * 100) + '%', background: pass.warn ? 'var(--st-late)' : 'var(--accent)' } })));
      passCard.appendChild(h('div', { class: 'muted small mt-8' }, '충전 ' + pass.total + '회 · 사용 ' + pass.used + '회' + (s.pass && s.pass.since ? ' · ' + U.fmtDate(s.pass.since, { weekday: false }) + '부터 계산' : '')));
      if (pass.warn) passCard.appendChild(ui.banner('warn', rem > 0 ? '곧 소진돼요. 충전 안내를 해 주세요.' : rem === 0 ? '횟수를 모두 썼어요.' : '충전한 횟수보다 ' + (-rem) + '회 더 수업했어요.', { action: { label: '충전', kind: 'primary', onClick: function () { payEditor(s, null); } } }));
    } else if (pass && pass.type === 'monthly') {
      passCard.appendChild(h('div', { class: 'stu-pass-big' }, pass.label));
      if (pass.total) passCard.appendChild(h('div', { class: 'progress lg' }, h('span', { style: { width: Math.round(Math.min(1, pass.used / pass.total) * 100) + '%', background: pass.warn ? 'var(--st-late)' : 'var(--accent)' } })));
      var lastPay = pays[0];
      if (lastPay) {
        var due = U.addMonths(lastPay.date, Math.max(1, Math.floor(num(lastPay.months, 1))));
        var dd = U.diffDays(t, due);
        passCard.appendChild(h('div', { class: 'muted small mt-8' }, '마지막 결제 ' + U.fmtDate(lastPay.date, { weekday: false, year: 'auto' }) + ' · 다음 결제일 ' + U.fmtDate(due, { weekday: false, year: 'auto' })));
        if (dd <= 3 && s.status !== 'left') passCard.appendChild(ui.banner(dd < 0 ? 'warn' : 'info', dd < 0 ? '결제일이 ' + (-dd) + '일 지났어요.' : dd === 0 ? '오늘이 결제일이에요.' : '결제일이 ' + dd + '일 남았어요.'));
      } else {
        passCard.appendChild(h('div', { class: 'muted small mt-8' }, '월 정액 · 결제 기록이 아직 없어요'));
      }
    } else {
      passCard.appendChild(h('div', { class: 'muted' }, '수강권 없음 — 결제만 기록할 수 있어요.'));
    }
    body.appendChild(passCard);

    if (!pays.length) {
      body.appendChild(h('div', { class: 'card' }, ui.empty('card', '결제 기록이 없어요', '수강료를 받으면 기록해 두세요. 통계의 매출에 반영돼요.',
        { label: '결제 추가', icon: 'plus', onClick: function () { payEditor(s, null); } })));
      return;
    }
    body.appendChild(h('div', { class: 'stu-pay-sum' },
      sumTile('총 결제', U.fmtMoney(total), pays.length + '건', null),
      sumTile('올해', U.fmtMoney(yearTotal), '', null),
      charged ? sumTile('충전 횟수', charged + '회', '', null) : null));
    var list = h('div', { class: 'list stu-pay-list' });
    pays.forEach(function (p) {
      var sub = [U.fmtDate(p.date, { year: 'auto' }), p.method || ''];
      if (num(p.count, 0) > 0) sub.push(p.count + '회 충전');
      if (num(p.months, 0) > 0) sub.push(p.months + '개월');
      list.appendChild(h('button', { class: 'list-item', type: 'button', onClick: function () { payEditor(s, p); } },
        h('span', { class: 'li-ic' }, ic(p.method === '현금' ? 'money' : 'card', 18)),
        h('div', { class: 'li-main' },
          h('div', { class: 'li-title num' }, U.fmtMoney(num(p.amount, 0))),
          h('div', { class: 'li-sub' }, sub.filter(Boolean).join(' · ') + (p.memo ? ' — ' + p.memo : ''))),
        ic('chevR', 18)));
    });
    body.appendChild(list);
  }

  function payEditor(s, p) {
    var t = today();
    var isNew = !p;
    var prevPays = SC.index.paymentsByStudent(D()).get(s.id) || [];
    var lastP = prevPays[prevPays.length - 1];
    var isCount = s.pass && s.pass.type === 'count';
    var f = p ? Object.assign({}, p) : {
      date: t, amount: lastP ? num(lastP.amount, 0) : '', count: isCount ? (lastP && num(lastP.count, 0) > 0 ? num(lastP.count, 0) : 10) : 0,
      months: isCount ? 0 : 1, method: (lastP && lastP.method) || '카드', memo: ''
    };
    var method = f.method || '카드';
    var dateIn = ui.input({ type: 'date', value: f.date || t });
    var amtIn = ui.input({ type: 'text', id: 'stu-pay-amt', value: f.amount === '' || f.amount == null ? '' : U.fmtNumber(f.amount), placeholder: '예: 160,000', inputmode: 'numeric', maxLength: 13 });
    var amtHint = h('div', { class: 'field-hint' });
    function amtVal() { return parseInt(String(amtIn.value).replace(/[^0-9]/g, ''), 10) || 0; }
    amtIn.addEventListener('input', function () {
      var v = amtVal();
      var caret = amtIn.value.length - (amtIn.selectionStart || 0);
      amtIn.value = v ? U.fmtNumber(v) : '';
      try { var pos = Math.max(0, amtIn.value.length - caret); amtIn.setSelectionRange(pos, pos); } catch (e) { /* 무시 */ }
      amtHint.textContent = v ? U.fmtMoney(v) : '';
    });
    amtHint.textContent = amtVal() ? U.fmtMoney(amtVal()) : '';
    var quick = h('div', { class: 'suggest' });
    [50000, 100000, 10000].forEach(function (v) {
      quick.appendChild(h('button', { class: 'chip', type: 'button', onClick: function () { amtIn.value = U.fmtNumber(amtVal() + v); amtHint.textContent = U.fmtMoney(amtVal()); ui.haptic('select'); } }, '+' + (v >= 10000 ? (v / 10000) + '만' : U.fmtNumber(v))));
    });
    quick.appendChild(h('button', { class: 'chip', type: 'button', onClick: function () { amtIn.value = ''; amtHint.textContent = ''; } }, '지우기'));
    var cntIn = ui.input({ type: 'number', value: num(f.count, 0) || '', min: 0, max: 999, step: 1, inputmode: 'numeric', placeholder: '0' });
    var monIn = ui.input({ type: 'number', value: num(f.months, 0) || '', min: 0, max: 24, step: 1, inputmode: 'numeric', placeholder: '0' });
    var methodSeg = ui.segmented(PAY_METHODS.map(function (m) { return { value: m, label: m }; }), method, function (v) { method = v; });
    methodSeg.classList.add('full');
    var memoIn = ui.input({ value: f.memo || '', placeholder: '예: 10월분, 형제 할인', maxLength: 60 });

    var content = h('div', { class: 'v-students stu-pay-form' },
      h('div', { class: 'field-row' }, ui.field('결제일', dateIn), h('div', { class: 'field' }, h('label', { class: 'field-label', attrs: { for: 'stu-pay-amt' } }, '금액 (원)'), amtIn, amtHint)),
      quick,
      h('div', { class: 'field-row mt-12' },
        ui.field('충전 횟수', cntIn, isCount ? '횟수권 잔여에 더해져요' : '횟수권일 때만 써요'),
        ui.field('기간 (개월)', monIn, isCount ? '' : '월 정액 기간')),
      ui.field('결제 수단', methodSeg),
      ui.field('메모', memoIn));

    var actions = [{ label: '취소', kind: 'ghost' }];
    if (!isNew) actions.push({
      label: '삭제', kind: 'danger', onClick: function () {
        return ui.confirm(U.fmtDate(p.date) + ' ' + U.fmtMoney(num(p.amount, 0)) + ' 결제 기록을 지울까요?', { title: '결제 삭제', ok: '삭제', danger: true }).then(function (ok) {
          if (!ok) return false;
          return DA.store.remove('payments', p.id).then(function () { ui.toast('결제 기록을 지웠어요', { kind: 'ok' }); });
        });
      }
    });
    actions.push({
      label: isNew ? '추가' : '저장', kind: 'primary', onClick: function () {
        var amount = amtVal();
        var cnt = Math.max(0, Math.floor(num(cntIn.value, 0)));
        var months = Math.max(0, Math.floor(num(monIn.value, 0)));
        if (!amount && !cnt) { ui.toast('금액이나 충전 횟수를 입력해 주세요', { kind: 'warn' }); amtIn.focus(); return false; }
        var rec = Object.assign({}, p || {}, {
          studentId: s.id, date: U.isYmd(dateIn.value) ? dateIn.value : t, amount: amount, count: cnt, months: months,
          method: method, memo: memoIn.value.trim()
        });
        return DA.store.put('payments', rec).then(function () {
          ui.haptic('success');
          ui.toast(isNew ? U.fmtMoney(amount) + ' 결제를 기록했어요' + (cnt ? ' (' + cnt + '회 충전)' : '') : '결제 기록을 고쳤어요', { kind: 'ok' });
        });
      }
    });
    ui.sheet({ title: isNew ? '결제 추가' : '결제 수정', sub: s.name, className: 'v-students', content: content, actions: actions, autofocus: false });
  }

  /* ---------------- 탭: 시간표 ---------------- */
  function tabLessons(body, s) {
    var data = D(), t = today();
    var lessons = SC.studentLessons(data, s.id);
    var ended = (SC.index.lessonsByStudent(data).get(s.id) || []).filter(function (l) { return l.endDate && l.endDate < t; });
    var extras = arr(data.exceptions).filter(function (e) {
      return e && e.type === 'extra' && e.date >= t && arr(e.studentIds).indexOf(s.id) >= 0;
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : U.hm2min(a.start) - U.hm2min(b.start); });
    var canAdd = (s.status || 'active') !== 'left';

    var card = h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('h3', null, '정규 수업'), h('span', { class: 'muted small' }, lessons.length ? '주 ' + lessons.length + '회' : ''),
        canAdd ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onClick: function () { addLesson(s.id); } }, ic('plus', 16), '수업 추가') : null));
    if (!lessons.length) {
      card.appendChild(ui.empty('calendar', '정규 수업이 없어요', canAdd ? '매주 같은 요일·시각의 수업을 넣으면 오늘 화면에 자동으로 나타나요.' : '퇴원한 수강생이에요.', null));
    } else {
      var list = h('div', { class: 'list flat' });
      lessons.forEach(function (l) { list.appendChild(lessonRow(s, l)); });
      card.appendChild(list);
    }
    body.appendChild(card);

    var extraCard = h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('h3', null, '예정된 보강 · 특강'),
        canAdd ? h('button', { class: 'btn btn-sm', type: 'button', onClick: function () { DA.actions.makeup(s.id, {}); } }, ic('repeat', 16), '보강 잡기') : null));
    if (!extras.length) extraCard.appendChild(h('p', { class: 'muted small' }, '예정된 보강·특강이 없어요.'));
    else {
      var el2 = h('div', { class: 'list flat' });
      extras.forEach(function (e) {
        var occ = SC.occurrence(data, e.date, e.id);
        el2.appendChild(h('button', {
          class: 'list-item', type: 'button',
          onClick: function () { if (occ) DA.actions.menu(occ, s.id, { date: e.date }); }
        },
          h('span', { class: 'li-ic' }, ic(e.kind === 'makeup' ? 'repeat' : 'star', 18)),
          h('div', { class: 'li-main' },
            h('div', { class: 'li-title' }, (U.relDay(e.date) ? U.relDay(e.date) + ' · ' : '') + U.fmtDate(e.date) + ' ' + e.start),
            h('div', { class: 'li-sub' }, [e.teacherId ? nameOf('teacher', e.teacherId) : '', e.roomId ? nameOf('room', e.roomId) : '', e.makeupFor && e.makeupFor.date ? U.fmtDate(e.makeupFor.date, { weekday: false }) + ' 수업 보강' : ''].filter(Boolean).join(' · ') || SC.lessonLabel(data, e))),
          ui.kindBadge(e.kind)));
      });
      extraCard.appendChild(el2);
    }
    body.appendChild(extraCard);

    if (ended.length) {
      var endList = h('div', { class: 'list flat stu-ended' });
      ended.sort(function (a, b) { return a.endDate < b.endDate ? 1 : -1; }).slice(0, 12).forEach(function (l) {
        endList.appendChild(h('div', { class: 'list-item' },
          h('span', { class: 'li-ic' }, ic('calendar-x', 18)),
          h('div', { class: 'li-main' },
            h('div', { class: 'li-title' }, '매주 ' + wdLabel(l.weekday) + ' ' + l.start + '–' + endHm(l.start, l.duration)),
            h('div', { class: 'li-sub' }, (l.startDate ? U.fmtDate(l.startDate, { weekday: false, year: 'auto' }) : '') + ' ~ ' + U.fmtDate(l.endDate, { weekday: false, year: 'auto' }) + ' 종료'))));
      });
      body.appendChild(h('details', { class: 'card stu-ended-card' }, h('summary', null, '지난 수업 ' + ended.length + '개'), endList));
    }
  }
  function lessonRow(s, l) {
    var data = D();
    var others = arr(l.studentIds).filter(function (x) { return x !== s.id; });
    var sub = [];
    if (l.teacherId) sub.push(nameOf('teacher', l.teacherId));
    if (l.roomId) sub.push(nameOf('room', l.roomId));
    if (others.length) sub.push('그룹 ' + (others.length + 1) + '명');
    if (l.startDate && l.startDate > today()) sub.push(U.fmtDate(l.startDate, { weekday: false }) + '부터');
    if (l.endDate) sub.push(U.fmtDate(l.endDate, { weekday: false }) + '까지');
    return h('button', { class: 'list-item stu-lesson', type: 'button', onClick: function () { lessonSheet(s, l); } },
      h('span', { class: 'stu-lesson-wd', style: { background: ui.teacherColor(l.teacherId) } }, wdLabel(l.weekday)),
      h('div', { class: 'li-main' },
        h('div', { class: 'li-title' }, l.start + '–' + endHm(l.start, l.duration) + (l.title ? ' · ' + l.title : '')),
        h('div', { class: 'li-sub' }, sub.join(' · ') || SC.lessonLabel(data, l))),
      ic('chevR', 18));
  }
  function lessonSheet(s, l) {
    var data = D();
    var names = arr(l.studentIds).map(function (id) { var x = getStudent(id); return x ? x.name : null; }).filter(Boolean);
    ui.sheet({
      title: '매주 ' + wdLabel(l.weekday) + '요일 ' + l.start,
      sub: SC.lessonLabel(data, l),
      className: 'v-students',
      autofocus: false,
      content: h('div', null,
        h('dl', { class: 'kv' },
          h('dt', null, '시간'), h('dd', null, l.start + '–' + endHm(l.start, l.duration) + ' (' + U.fmtDuration(l.duration) + ')'),
          h('dt', null, '강사'), h('dd', null, nameOf('teacher', l.teacherId) || '미지정'),
          h('dt', null, '방'), h('dd', null, nameOf('room', l.roomId) || '미지정'),
          h('dt', null, '수강생'), h('dd', null, names.join(', ') || '없음'),
          h('dt', null, '기간'), h('dd', null, (l.startDate ? U.fmtDate(l.startDate, { weekday: false, year: 'auto' }) : '처음') + ' ~ ' + (l.endDate ? U.fmtDate(l.endDate, { weekday: false, year: 'auto' }) : '계속')),
          l.memo ? h('dt', null, '메모') : null, l.memo ? h('dd', null, l.memo) : null),
        h('p', { class: 'muted small mt-12' }, '시각·강사 변경은 시간표 화면에서 할 수 있어요.')),
      actions: [
        { label: '이 수업에서 빼기', kind: 'danger', onClick: function () { removeFromOne(s, l); } },
        { label: '시간표에서 보기', kind: 'primary', onClick: function () { ui.go('#/timetable'); } }
      ]
    });
  }
  function removeFromOne(s, l) {
    var t = today();
    var todayRec = DA.store.get('attendance', DA.store.attendanceKey(t, l.id, s.id));
    var from = todayRec ? U.addDays(t, 1) : t;
    var solo = arr(l.studentIds).length <= 1;
    setTimeout(function () {
      ui.confirm(s.name + ' 학생을 매주 ' + wdLabel(l.weekday) + '요일 ' + l.start + ' 수업에서 ' + (from === t ? '오늘' : '내일') + '부터 뺄까요?\n' +
        (solo ? '혼자 듣는 수업이라 수업이 종료돼요. ' : '') + '지난 출결 기록은 그대로 남아요.', { title: '수업에서 빼기', ok: '빼기', danger: true }).then(function (ok) {
        if (!ok) return;
        removeFromLessons(s.id, from, [l.id]).then(function (n) {
          ui.toast(n ? '수업에서 뺐어요' : '바꿀 수업이 없었어요', { kind: 'ok' });
        }, function (e) { fail(e, '수업 변경'); });
      });
    }, 300);
  }

  /* 수강생을 fromYmd부터 정규 수업·예정 extra에서 뺀다(이전 기록 보존: splitLesson).
   * onlyIds: 특정 수업만. 반환: 바뀐 수업 수 */
  function removeFromLessons(sid, fromYmd, onlyIds) {
    var data = D();
    var lessons = (SC.index.lessonsByStudent(data).get(sid) || []).filter(function (l) {
      if (onlyIds && onlyIds.indexOf(l.id) < 0) return false;
      return !l.endDate || l.endDate >= fromYmd;
    });
    var lessonPut = [], lessonDel = [], exPut = [], exDel = [], attPut = [], attDel = [];
    var yest = U.addDays(fromYmd, -1);
    function dropWhole(l) {
      lessonDel.push(l.id);
      arr(data.exceptions).forEach(function (e) { if (e && e.type === 'cancel' && e.lessonId === l.id) exDel.push(e.id); });
    }
    lessons.forEach(function (l) {
      var rest = arr(l.studentIds).filter(function (x) { return x !== sid; });
      var started = !l.startDate || l.startDate <= yest;
      if (!started) {
        if (rest.length) lessonPut.push(Object.assign({}, l, { studentIds: rest }));
        else {
          var hasRec = arr(data.attendance).some(function (r) { return r && r.srcId === l.id; });
          if (hasRec) lessonPut.push(Object.assign({}, l, { studentIds: rest }));
          else dropWhole(l);
        }
        return;
      }
      if (!rest.length) { lessonPut.push(Object.assign({}, l, { endDate: yest })); return; }
      var sp = SC.splitLesson(data, l, fromYmd);
      if (sp.emptyEnded) { lessonPut.push(Object.assign({}, l, { studentIds: rest })); return; }
      sp.created.studentIds = rest;
      lessonPut.push(sp.ended, sp.created);
      arr(sp.exceptions).forEach(function (e) { exPut.push(e); });
      if (sp.attendance) {
        arr(sp.attendance.put).forEach(function (r) { attPut.push(r); });
        arr(sp.attendance.removeIds).forEach(function (id) { attDel.push(id); });
      }
    });
    if (!onlyIds) {
      arr(data.exceptions).forEach(function (e) {
        if (!e || e.type !== 'extra' || e.date < fromYmd || arr(e.studentIds).indexOf(sid) < 0) return;
        var rest = arr(e.studentIds).filter(function (x) { return x !== sid; });
        var hasRec = arr(data.attendance).some(function (r) { return r && r.srcId === e.id; });
        if (rest.length || hasRec) exPut.push(Object.assign({}, e, { studentIds: rest }));
        else exDel.push(e.id);
      });
    }
    var n = lessons.length;
    var st2 = DA.store, p = Promise.resolve();
    if (lessonPut.length) p = p.then(function () { return st2.putMany('lessons', lessonPut); });
    if (exPut.length) p = p.then(function () { return st2.putMany('exceptions', exPut); });
    if (attPut.length) p = p.then(function () { return st2.putMany('attendance', attPut); });
    if (attDel.length) p = p.then(function () { return st2.removeMany('attendance', attDel); });
    if (exDel.length) p = p.then(function () { return st2.removeMany('exceptions', exDel); });
    if (lessonDel.length) p = p.then(function () { return st2.removeMany('lessons', lessonDel); });
    return p.then(function () { return n; });
  }

  /* ---------------- 수업 추가(간단 편집기) ---------------- */
  function addLesson(studentId) {
    var s = getStudent(studentId);
    if (!s) return Promise.resolve(null);
    if (DA.timetable && typeof DA.timetable.editLesson === 'function') {
      try { return Promise.resolve(DA.timetable.editLesson(null, { studentIds: [s.id], teacherId: s.teacherId || '' })); } catch (e) { logErr(e, 'timetable.editLesson'); }
    }
    var set = S(), t = today(), data = D();
    var mine = SC.studentLessons(data, s.id);
    var draft = {
      weekdays: [U.weekday(t)],
      start: mine.length ? mine[0].start : (U.hm2min(set.openTime || '10:00') > U.hm2min('17:00') ? set.openTime : '17:00'),
      duration: +set.defaultDuration || 50,
      teacherId: s.teacherId || (arr(set.teachers).length === 1 ? set.teachers[0].id : ''),
      roomId: '', studentIds: [s.id], title: '', startDate: t, endDate: '', memo: ''
    };
    return new Promise(function (resolve) {
      var done = false, sh = null;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var wdBox = h('div', { class: 'stu-wd-pick', attrs: { role: 'group', 'aria-label': '요일' } });
      function drawWd() {
        ui.clear(wdBox);
        for (var i = 0; i < 7; i++) {
          (function (wd) {
            var on = draft.weekdays.indexOf(wd) >= 0;
            wdBox.appendChild(h('button', {
              class: 'stu-wd' + (on ? ' on' : '') + (wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''), type: 'button', attrs: { 'aria-pressed': on ? 'true' : 'false' },
              onClick: function () {
                var k = draft.weekdays.indexOf(wd);
                if (k >= 0) { if (draft.weekdays.length > 1) draft.weekdays.splice(k, 1); } else draft.weekdays.push(wd);
                ui.haptic('select'); drawWd(); check();
              }
            }, WD[wd]));
          })((weekStart() + i) % 7);
        }
      }
      drawWd();
      var startIn = ui.input({ type: 'time', value: draft.start, step: 300, onInput: function (v) { draft.start = v; check(); }, onChange: function (v) { draft.start = v; check(); } });
      var durs = [30, 40, 50, 60, 90];
      if (durs.indexOf(draft.duration) < 0) { durs.push(draft.duration); durs.sort(function (a, b) { return a - b; }); }
      var durSeg = ui.segmented(durs.map(function (d) { return { value: d, label: d + '분' }; }), draft.duration, function (v) { draft.duration = v; check(); });
      durSeg.classList.add('full');
      var teacherSel = ui.select(selectOpts(set.teachers), draft.teacherId, function (v) { draft.teacherId = v; check(); });
      var roomSel = ui.select(selectOpts(set.rooms), draft.roomId, function (v) { draft.roomId = v; check(); });
      var titleIn = ui.input({ value: '', placeholder: '비우면 학생 이름으로 표시', maxLength: 30 });
      var startDateIn = ui.input({ type: 'date', value: draft.startDate, onChange: function (v) { draft.startDate = v; check(); } });
      var endDateIn = ui.input({ type: 'date', value: '', onChange: function (v) { draft.endDate = v; check(); } });
      var withEl = h('div', { class: 'stu-with' });
      function drawWith() {
        ui.clear(withEl);
        draft.studentIds.forEach(function (id) {
          var x = getStudent(id); if (!x) return;
          withEl.appendChild(h('span', { class: 'chip on stu-with-chip' }, x.name));
        });
        withEl.appendChild(h('button', { class: 'chip', type: 'button', onClick: function () {
          ui.pickStudent({ title: '함께 듣는 수강생', multiple: true, selected: draft.studentIds.slice(), filter: function (x) { return (x.status || 'active') !== 'left'; } }).then(function (ids) {
            if (!ids) return;
            if (ids.indexOf(s.id) < 0) ids.unshift(s.id);
            draft.studentIds = ids; drawWith(); check();
          });
        } }, ic('user-plus', 15), draft.studentIds.length > 1 ? '바꾸기' : '그룹 수업이면 추가'));
      }
      drawWith();
      var conflictsEl = h('div', { class: 'conflicts' });
      var conflictList = [];
      function check() {
        ui.clear(conflictsEl);
        conflictList = [];
        if (!U.isHm(draft.start)) return;
        try {
          conflictList = SC.conflicts(D(), {
            weekdays: draft.weekdays, start: draft.start, duration: draft.duration, teacherId: draft.teacherId, roomId: draft.roomId,
            studentIds: draft.studentIds, startDate: draft.startDate || t, endDate: draft.endDate
          }, {});
        } catch (e) { logErr(e, 'conflicts'); }
        conflictList.slice(0, 5).forEach(function (c) { conflictsEl.appendChild(ui.banner('warn', c.message)); });
        if (conflictList.length > 5) conflictsEl.appendChild(h('div', { class: 'small muted' }, '외 ' + (conflictList.length - 5) + '건 겹침'));
      }
      check();
      var content = h('div', { class: 'v-students stu-lesson-form' },
        ui.field('요일 (여러 개 고르면 요일마다 수업이 생겨요)', wdBox),
        h('div', { class: 'field-row' }, ui.field('시작', startIn), ui.field('강사', teacherSel)),
        ui.field('수업 길이', durSeg),
        conflictsEl,
        ui.field('함께 듣는 수강생', withEl),
        h('div', { class: 'field-row' }, ui.field('방', roomSel), ui.field('수업 이름 (선택)', titleIn)),
        h('div', { class: 'field-row' }, ui.field('시작일', startDateIn), ui.field('종료일 (선택)', endDateIn)));
      sh = ui.sheet({
        title: s.name + ' 수업 추가',
        sub: '매주 반복되는 정규 수업',
        className: 'v-students',
        size: 'wide',
        autofocus: false,
        content: content,
        actions: [
          { label: '취소', kind: 'ghost', onClick: function () { fin(null); } },
          { label: '추가', kind: 'primary', onClick: function () {
            if (!U.isHm(startIn.value)) { ui.toast('시작 시각을 입력해 주세요', { kind: 'warn' }); return false; }
            draft.start = startIn.value;
            draft.startDate = U.isYmd(startDateIn.value) ? startDateIn.value : t;
            draft.endDate = U.isYmd(endDateIn.value) ? endDateIn.value : '';
            if (draft.endDate && draft.endDate < draft.startDate) { ui.toast('종료일이 시작일보다 빨라요', { kind: 'warn' }); return false; }
            check();
            var go = conflictList.length
              ? ui.confirm('겹치는 수업이 ' + conflictList.length + '건 있어요.\n' + conflictList.slice(0, 3).map(function (c) { return '· ' + c.message; }).join('\n') + '\n그래도 추가할까요?', { title: '시간 겹침', ok: '그래도 추가' })
              : Promise.resolve(true);
            return go.then(function (ok) {
              if (!ok) return false;
              var recs = draft.weekdays.slice().sort().map(function (wd) {
                return {
                  weekday: wd, start: draft.start, duration: +draft.duration, studentIds: draft.studentIds.slice(),
                  teacherId: draft.teacherId, roomId: draft.roomId, title: titleIn.value.trim(),
                  startDate: draft.startDate, endDate: draft.endDate, memo: ''
                };
              });
              return DA.store.putMany('lessons', recs).then(function (saved) {
                ui.haptic('success');
                fin(saved);
                ui.toast('매주 ' + draft.weekdays.slice().sort(function (a, b) { return ((a - weekStart() + 7) % 7) - ((b - weekStart() + 7) % 7); }).map(wdLabel).join('·') + ' ' + draft.start + ' 수업을 추가했어요', {
                  kind: 'ok', action: { label: '시간표', onClick: function () { ui.go('#/timetable'); } }
                });
              });
            });
          } }
        ],
        onClose: function () { fin(null); }
      });
    });
  }

  /* ==================================================================
   * 상태 변경
   * ================================================================== */
  function moreMenu(s) {
    var ss = s.status || 'active';
    var locked = ui.isTeacherLocked();
    var sh = null;
    function later(fn) { return function () { if (sh) sh.close(); setTimeout(fn, 260); }; }
    function item(icon, title, sub, fn, cls) {
      return h('button', { class: 'list-item' + (cls ? ' ' + cls : ''), type: 'button', onClick: later(fn) },
        h('span', { class: 'li-ic' }, ic(icon, 19)),
        h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, title), sub ? h('div', { class: 'li-sub' }, sub) : null));
    }
    var list = h('div', { class: 'list flat' },
      item('edit', '정보 수정', '이름·연락처·과정·수강권', function () { edit(s.id); }),
      ss !== 'left' && ui.moduleOn('timetable') ? item('calendar', '수업 추가', '매주 반복되는 정규 수업', function () { addLesson(s.id); }) : null,
      ss !== 'left' && ui.moduleOn('timetable') ? item('repeat', '보강 잡기', '다른 날 한 번 수업', function () { DA.actions.makeup(s.id, {}); }) : null,
      locked ? null : simple() && DA.passUI ? item('card', '이용권 발급', '한 달 횟수 충전', function () { DA.passUI.issueSheet(s, { month: today().slice(0, 7) }); })
        : item('card', '결제 기록', '수강료·횟수 충전', function () { payEditor(s, null); }),
      ss === 'active' ? item('pause', '휴원 처리', '휴원 기간 수업은 출결에서 빠져요', function () { pause(s); }) : null,
      ss === 'paused' ? item('play', '복귀 처리', '오늘부터 다시 출결에 들어가요', function () { resume(s); }) : null,
      ss !== 'left' ? item('door', '퇴원 처리', '오늘까지 다닌 걸로 하고 수업에서 빼요', function () { leave(s); }) : null,
      ss === 'left' ? item('user-plus', '재등록', '다시 재원생으로', function () { reenroll(s); }) : null,
      locked ? null : item('trash', '수강생 삭제', '출결·결제 기록까지 모두 지워요', function () { remove(s); }, 'danger'),
      item('user-plus', '입·퇴원 기록', '입회·휴원·복귀·퇴원과 사유', function () { ui.go('#/history'); }));
    sh = ui.sheet({
      title: s.name, sub: STU_STATUS[ss] + (studentSub(s) ? ' · ' + studentSub(s) : ''),
      className: 'v-students', autofocus: false,
      content: list
    });
  }

  // 날짜 + 사유 시트 → Promise<{date, reason}|null>
  function askDateReason(o) {
    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var dateIn = ui.input({ type: 'date', value: o.date || today() });
      var reasonIn = ui.input({ placeholder: o.placeholder || '예: 부상, 출장', maxLength: 60, id: 'stu-reason' });
      var warn = h('div', { class: 'stu-reason-warn warn-text small', hidden: true }, o.warnEmpty || '');
      reasonIn.addEventListener('input', function () { warn.hidden = true; });
      ui.sheet({
        title: o.title, sub: o.sub, autofocus: false, className: 'v-students stu-reason-sheet',
        content: h('div', null, o.message ? h('p', { class: 'sheet-msg' }, o.message) : null,
          o.noDate ? null : ui.field(o.dateLabel || '날짜', dateIn), ui.field(o.reasonLabel || '사유', reasonIn, o.reasonHint), warn, o.extra || null),
        actions: [
          { label: '취소', kind: 'ghost', onClick: function () { fin(null); } },
          { label: o.ok || '확인', kind: o.danger ? 'danger' : 'primary', onClick: function () {
            if (!o.noDate && !U.isYmd(dateIn.value)) { ui.toast('날짜를 확인해 주세요', { kind: 'warn' }); return false; }
            var r = reasonIn.value.trim();
            if (!r && o.warnEmpty && warn.hidden) { warn.hidden = false; ui.haptic('warn'); return false; }   // 한 번 더 누르면 사유 없이 진행
            fin({ date: o.noDate ? today() : dateIn.value, reason: r });
          } }
        ],
        onClose: function () { fin(null); }
      });
    });
  }

  function pause(s) {
    var t = today();
    return askDateReason({
      title: '휴원 처리', sub: s.name, dateLabel: '휴원 시작일', date: t, ok: '휴원', reasonLabel: '휴원 사유',
      message: s.name + ' 학생을 휴원 처리할까요?\n휴원 기간 수업은 출결·통계에서 빠지고, 복귀하면 다시 들어가요.'
    }).then(function (r) {
      if (!r) return;
      var from = r.date;
      var cur = getStudent(s.id); if (!cur) return;
      var pauses = arr(cur.pauses).filter(function (p) { return p && p.from; }).map(function (p) { return Object.assign({}, p); });
      pauses.push({ from: from, to: '', reason: r.reason });
      pauses.sort(function (a, b) { return a.from < b.from ? -1 : 1; });
      var next = DA.ops.withHistory(cur, 'pause', from, r.reason);
      return DA.store.put('students', Object.assign({}, next, { status: 'paused', pauses: pauses })).then(function () {
        ui.haptic('success');
        ui.toast(s.name + ' 휴원 처리했어요', { kind: 'ok' });
      });
    }).catch(function (e) { fail(e, '휴원 처리'); });
  }

  function resume(s) {
    var t = today();
    var cur = getStudent(s.id); if (!cur) return Promise.resolve();
    var op = openPause(cur);
    var msg = s.name + ' 학생을 오늘부터 복귀 처리할까요?' + (op ? '\n휴원: ' + U.fmtDate(op.from, { weekday: false, year: 'auto' }) + ' ~ ' + U.fmtDate(U.addDays(t, -1), { weekday: false, year: 'auto' }) : '');
    return ui.confirm(msg, { title: '복귀 처리', ok: '복귀' }).then(function (ok) {
      if (!ok) return;
      cur = getStudent(s.id); if (!cur) return;
      var yest = U.addDays(t, -1);
      var pauses = [];
      arr(cur.pauses).forEach(function (p) {
        if (!p || !p.from) return;
        if (p.to) { pauses.push(Object.assign({}, p)); return; }
        if (p.from <= yest) pauses.push(Object.assign({}, p, { to: yest }));   // 오늘 시작한 휴원은 없던 것으로
      });
      return DA.store.put('students', Object.assign({}, DA.ops.withHistory(cur, 'resume', t, ''), { status: 'active', pauses: pauses })).then(function () {
        ui.haptic('success');
        ui.toast(s.name + ' 복귀했어요. 다시 신나게! 🥁', { kind: 'ok' });
      });
    }).catch(function (e) { fail(e, '복귀 처리'); });
  }

  function leave(s) {
    var t = today();
    var lessons = SC.studentLessons(D(), s.id).filter(function (l) { return !l.endDate || l.endDate >= t; });
    var extras = arr(D().exceptions).filter(function (e) { return e && e.type === 'extra' && e.date > t && arr(e.studentIds).indexOf(s.id) >= 0; });
    return new Promise(function (resolve) {
      var removeOpt = true;
      var tog = ui.toggle(true, function (v) { removeOpt = v; }, '수업에서 빼기');
      var hasLessons = lessons.length || extras.length;
      var reasonIn = ui.input({ placeholder: '예: 이사, 시간이 안 맞음, 비용', maxLength: 60, id: 'stu-leave-reason' });
      var reasonWarn = h('div', { class: 'stu-reason-warn warn-text small', hidden: true }, '퇴원 사유가 비어 있어요. 적어 두면 나중에 운영 리포트에서 이유를 볼 수 있어요. 그래도 퇴원하려면 한 번 더 눌러 주세요.');
      reasonIn.addEventListener('input', function () { reasonWarn.hidden = true; });
      ui.sheet({
        title: '퇴원 처리',
        sub: s.name,
        className: 'v-students',
        autofocus: false,
        content: h('div', null,
          h('p', { class: 'sheet-msg' }, '오늘(' + U.fmtDate(t) + ')까지 다닌 걸로 퇴원 처리해요.\n지난 출결·결제 기록은 그대로 남고, 내일부터 출결에서 빠져요.'),
          ui.field('퇴원 사유 (권장)', reasonIn), reasonWarn,
          hasLessons ? h('div', { class: 'switch-row stu-leave-opt' },
            h('div', { class: 'grow' },
              h('div', { class: 'strong' }, '정규 수업에서 빼기'),
              h('div', { class: 'muted small' }, lessons.map(function (l) { return wdLabel(l.weekday) + ' ' + l.start; }).join(', ') + (extras.length ? (lessons.length ? ' · ' : '') + '예정 보강 ' + extras.length + '건' : '') + '\n지난 기록은 보존돼요')),
            tog) : null),
        actions: [
          { label: '취소', kind: 'ghost', onClick: function () { resolve(false); } },
          { label: '퇴원', kind: 'danger', onClick: function () {
            var reason = reasonIn.value.trim();
            if (!reason && reasonWarn.hidden) { reasonWarn.hidden = false; ui.haptic('warn'); try { reasonIn.focus(); } catch (e) { /* 무시 */ } return false; }
            var cur = getStudent(s.id); if (!cur) return;
            var pauses = arr(cur.pauses).map(function (p) { return p && p.from && !p.to ? Object.assign({}, p, { to: p.from <= t ? t : p.from }) : p; }).filter(Boolean);
            var next = DA.ops.withHistory(cur, 'leave', t, reason);
            return DA.store.put('students', Object.assign({}, next, { status: 'left', leftDate: t, pauses: pauses })).then(function () {
              return removeOpt && hasLessons ? removeFromLessons(s.id, U.addDays(t, 1)) : 0;
            }).then(function (n) {
              ui.haptic('success');
              ui.toast(s.name + ' 퇴원 처리했어요' + (n ? ' · 수업 ' + n + '개에서 뺐어요' : '') + (reason ? '' : ' · 사유 없음'), { kind: reason ? 'ok' : 'warn' });
              resolve(true);
            });
          } }
        ],
        onClose: function () { resolve(false); }
      });
    }).catch(function (e) { fail(e, '퇴원 처리'); });
  }

  function reenroll(s) {
    var t = today();
    return ui.confirm(s.name + ' 학생을 오늘부터 다시 재원생으로 할까요?\n퇴원해 있던 기간은 휴원 기간으로 남겨 출결에서 빠지게 해요.', { title: '재등록', ok: '재등록' }).then(function (ok) {
      if (!ok) return;
      var cur = getStudent(s.id); if (!cur) return;
      var pauses = arr(cur.pauses).filter(function (p) { return p && p.from; }).map(function (p) { return Object.assign({}, p); });
      if (cur.leftDate) {
        var gapFrom = U.addDays(cur.leftDate, 1), gapTo = U.addDays(t, -1);
        if (gapFrom <= gapTo) pauses.push({ from: gapFrom, to: gapTo });
      }
      pauses.sort(function (a, b) { return a.from < b.from ? -1 : 1; });
      return DA.store.put('students', Object.assign({}, DA.ops.withHistory(cur, 'rejoin', t, ''), { status: 'active', leftDate: '', pauses: pauses })).then(function () {
        ui.haptic('success');
        ui.toast(s.name + ' 다시 등록했어요', { kind: 'ok', action: { label: '수업 추가', onClick: function () { addLesson(s.id); } } });
      });
    }).catch(function (e) { fail(e, '재등록'); });
  }

  function remove(s) {
    var data = D();
    var nAtt = (SC.index.attendanceByStudent(data).get(s.id) || []).length;
    var nPay = (SC.index.paymentsByStudent(data).get(s.id) || []).length;
    var nLes = (SC.index.lessonsByStudent(data).get(s.id) || []).length;
    return ui.confirm(s.name + ' 학생을 삭제할까요?\n출결 기록 ' + nAtt + '건 · 결제 ' + nPay + '건이 함께 지워지고, 수업 ' + nLes + '개에서 빠져요.\n그만둔 학생이라면 삭제 대신 ‘퇴원 처리’를 권해요 — 통계가 보존돼요.',
      { title: '수강생 삭제', ok: '계속', danger: true }).then(function (ok) {
      if (!ok) return false;
      return ui.promptText({
        title: '정말 삭제할까요?', label: '확인을 위해 이름을 입력해 주세요', placeholder: s.name, required: true, ok: '영구 삭제', danger: true,
        message: '되돌릴 수 없어요. 필요하면 먼저 설정에서 백업해 두세요.'
      }).then(function (v) {
        if (v == null) return false;
        if (v.replace(/\s+/g, '') !== String(s.name).replace(/\s+/g, '')) { ui.toast('이름이 달라 삭제하지 않았어요', { kind: 'warn' }); return false; }
        return purge(s.id).then(function () {
          ui.haptic('heavy');
          ui.toast(s.name + ' 학생을 삭제했어요', { kind: 'ok' });
          return true;
        });
      });
    }).catch(function (e) { fail(e, '삭제'); });
  }
  function purge(sid) {
    var data = D();
    var attIds = (SC.index.attendanceByStudent(data).get(sid) || []).map(function (r) { return r.id; });
    var payIds = (SC.index.paymentsByStudent(data).get(sid) || []).map(function (p) { return p.id; });
    var lessonPut = [], lessonDel = [], exPut = [], exDel = [];
    var attLeft = {};
    arr(data.attendance).forEach(function (r) { if (r && r.studentId !== sid) attLeft[r.srcId] = 1; });
    arr(data.lessons).forEach(function (l) {
      if (!l || arr(l.studentIds).indexOf(sid) < 0) return;
      var rest = arr(l.studentIds).filter(function (x) { return x !== sid; });
      if (rest.length || attLeft[l.id]) lessonPut.push(Object.assign({}, l, { studentIds: rest }));
      else {
        lessonDel.push(l.id);
        arr(data.exceptions).forEach(function (e) { if (e && e.type === 'cancel' && e.lessonId === l.id) exDel.push(e.id); });
      }
    });
    arr(data.exceptions).forEach(function (e) {
      if (!e || e.type !== 'extra' || arr(e.studentIds).indexOf(sid) < 0) return;
      var rest = arr(e.studentIds).filter(function (x) { return x !== sid; });
      if (rest.length || attLeft[e.id]) exPut.push(Object.assign({}, e, { studentIds: rest }));
      else exDel.push(e.id);
    });
    // 목록으로 먼저 이동(삭제 중 상세 화면이 '없음'으로 깜빡이지 않게)
    var cur = ui.current && ui.current();
    if (cur && cur.name === 'students' && cur.params.rest[0] === sid) goList();
    var S2 = DA.store, p = Promise.resolve();
    if (attIds.length) p = p.then(function () { return S2.removeMany('attendance', attIds); });
    if (payIds.length) p = p.then(function () { return S2.removeMany('payments', payIds); });
    if (lessonPut.length) p = p.then(function () { return S2.putMany('lessons', lessonPut); });
    if (exPut.length) p = p.then(function () { return S2.putMany('exceptions', exPut); });
    if (exDel.length) p = p.then(function () { return S2.removeMany('exceptions', exDel); });
    if (lessonDel.length) p = p.then(function () { return S2.removeMany('lessons', lessonDel); });
    return p.then(function () { return S2.remove('students', sid); });
  }

  /* ==================================================================
   * 등록
   * ================================================================== */
  DA.students = {
    edit: edit,
    open: function (id) { ui.go('#/students/' + encodeURIComponent(id)); },
    addLesson: addLesson,
    addPayment: function (id) { var s = getStudent(id); if (s) payEditor(s, null); },
    removeFromLessons: removeFromLessons
  };

  ui.registerView('students', {
    title: '수강생',
    tab: { label: '수강생', icon: 'users', order: 2 },
    render: function (el, params) {
      params = params || { rest: [], query: {} };
      var id = params.rest && params.rest[0];
      if (id) renderDetail(el, id);
      else { st.detailId = null; renderList(el, params); }
    }
  });
})(window.DA = window.DA || {});
