/* 드럼 출석부 — 운영 화면들 (v1.2)
 *   #/board    운영 현황판(재원·반별·강사별·신규·퇴원·미납·오늘 출석·연습실)
 *   #/history  입·퇴원 기록(기간별 목록, 퇴원 사유 누락 경고, 사유 고치기, CSV)
 *   #/report   주간 브리핑 · 월간 운영 리포트([공유] 카톡 등 / [인쇄])
 *   #/settle   강사 정산(월별, 당일취소 포함 여부, 강사별 정산 방식, CSV·인쇄)
 * DA.opsUI = { boardCard(), alertCards(), editReason(studentId, index), editPay(teacherId) }
 */
(function (DA) {
  'use strict';
  var ui = DA.ui;
  if (!ui || !ui.registerView) return;
  var h = ui.h;
  var U = DA.util;
  function ic(n, s) { return ui.icon ? ui.icon(n, s) : h('span'); }
  function D() { return DA.store.data; }
  function S() { return D().settings || {}; }
  function O() { return DA.ops; }
  function won(n) { return U.fmtMoney(Math.round(n || 0)); }
  function md(ymd) { return (+ymd.slice(5, 7)) + '/' + (+ymd.slice(8, 10)); }
  function mo(ym) { return (+ym.slice(5, 7)) + '월'; }
  function ymTitle(ym) { return ym.slice(0, 4) + '년 ' + (+ym.slice(5, 7)) + '월'; }
  function addYm(ym, n) { return U.ym(U.addMonths(ym + '-01', n)); }
  function ws() { return Number(S().weekStart) === 0 ? 0 : 1; }
  function back() { return h('button', { class: 'btn btn-icon back', type: 'button', attrs: { 'aria-label': '뒤로' }, onClick: function () { window.appBack(); } }, ic('chevL', 24)); }
  function topbar(title, actions, extra) {
    return h('header', { class: 'topbar' }, h('div', { class: 'topbar-row' }, back(), h('h1', { class: 'topbar-title' }, title), actions ? h('div', { class: 'topbar-actions' }, actions) : null), extra || null);
  }
  function kpi(label, value, sub, onClick, tone) {
    return h(onClick ? 'button' : 'div', { class: 'kpi' + (tone ? ' ' + tone : '') + (onClick ? ' tap' : ''), type: onClick ? 'button' : null, onClick: onClick || null },
      h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value), sub ? h('div', { class: 'kpi-sub' }, sub) : null);
  }
  function bars(list, total) {
    var max = Math.max(1, list.reduce(function (a, x) { return Math.max(a, x.count); }, 0));
    return h('div', { class: 'op-bars' }, list.map(function (x) {
      return h('div', { class: 'op-bar' },
        h('span', { class: 'op-bar-l' }, h('i', { class: 'op-dot', style: { background: x.color || 'var(--accent)' } }), x.name),
        h('span', { class: 'op-bar-track' }, h('span', { class: 'op-bar-fill', style: { width: Math.round(x.count / max * 100) + '%', background: x.color || 'var(--accent)' } })),
        h('b', { class: 'op-bar-v num' }, x.count + '명'));
    }), list.length ? null : h('div', { class: 'muted small' }, '재원생이 없어요'));
  }
  function saveCSV(name, text) {
    return ui.saveFile(DA.backup.filename(name, 'csv'), 'text/csv;charset=utf-8', text).then(function (r) {
      if (r === 'download') ui.toast('CSV 파일을 저장했어요');
    });
  }

  /* ================= 운영 현황판 ================= */
  function boardBody(b, compact) {
    var locked = ui.isTeacherLocked();
    var bill = b.billing;
    var grid = h('div', { class: 'kpi-grid op-kpis' },
      kpi('재원', b.active + '명', '휴원 ' + b.paused + ' · 퇴원 ' + b.left, function () { ui.go('#/students'); }),
      kpi('이번 달 신규', b.newThisMonth + '명', '퇴원 ' + b.leftThisMonth + '명' + (b.leftMissing ? ' · 사유 없음 ' + b.leftMissing : ''), function () { ui.go('#/history'); }, b.leftMissing ? 'warn' : ''),
      !locked && bill && ui.moduleOn('billing') ? kpi('이번 달 미납', bill.unpaidStudents + '명', won(bill.unpaidTotal), function () { ui.go('#/billing'); }, bill.unpaidStudents ? 'warn' : '') : null,
      kpi('오늘 출석', b.todayAttended + '명', (b.todayAbsent ? '당일취소 ' + b.todayAbsent + ' · ' : '') + (locked ? '' : won(b.todayAmount)), function () { ui.go('#/today'); }),
      !compact && b.practice && ui.moduleOn('practice') ? kpi('이번 달 연습실 노쇼', b.practice.noshow + '회', b.practice.rate != null ? '노쇼율 ' + U.pct(b.practice.rate) : '예약 ' + b.practice.booked + '건', function () { ui.go('#/rooms'); }, b.practice.noshow ? 'warn' : '') : null);
    return grid;
  }

  DA.opsUI = DA.opsUI || {};
  // 오늘 화면용 작은 현황판
  DA.opsUI.boardCard = function () {
    var b = O().board(D(), new Date());
    return h('section', { class: 'card op-board-card' },
      h('div', { class: 'card-h' }, h('h3', null, ic('grid', 18), ' 운영 현황'),
        ui.viewAllowed('board') ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: function () { ui.go('#/board'); } }, '자세히', ic('chevR', 16)) : null),
      boardBody(b, true),
      b.byCourse.length ? h('div', { class: 'op-mini muted small' }, '반별 ' + b.byCourse.map(function (x) { return x.name + ' ' + x.count; }).join(' · ')) : null);
  };

  function renderBoard(el) {
    var b = O().board(D(), new Date());
    var root = h('div', { class: 'v-ops' });
    root.appendChild(topbar('운영 현황판'));
    var page = h('div', { class: 'page narrow' });
    page.appendChild(h('div', { class: 'muted small' }, U.fmtDate(b.date) + ' 지금 기준 · 기록이 바뀌면 바로 반영돼요'));
    page.appendChild(boardBody(b, false));
    page.appendChild(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, '반별 재원 인원'), h('span', { class: 'muted small' }, b.active + '명')), bars(b.byCourse)));
    page.appendChild(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, '강사별 재원 인원'), h('span', { class: 'muted small' }, b.active + '명')), bars(b.byTeacher)));
    if (b.billing && ui.moduleOn('billing')) {
      var bl = b.billing;
      page.appendChild(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, '이번 달 수납')),
        h('dl', { class: 'kv' },
          h('dt', null, '받은 돈'), h('dd', { class: 'num' }, won(bl.received)),
          h('dt', null, '미납'), h('dd', { class: 'num' }, bl.unpaidStudents + '명 · ' + won(bl.unpaidTotal) + ' (미납 표시 ' + bl.unpaidMarked + '건 · 미발급 ' + bl.noIssue + '명)'),
          h('dt', null, '다음 달 예정'), h('dd', { class: 'num' }, bl.nextDueStudents + '명 · ' + won(bl.nextDueTotal)),
          h('dt', null, '선납 만료'), h('dd', null, bl.prepayExpiring + '명')),
        h('button', { class: 'btn btn-soft btn-block st-gap', type: 'button', onClick: function () { ui.go('#/billing'); } }, ic('money', 18), '수납 화면')));
    }
    root.appendChild(page);
    el.appendChild(root);
  }

  /* ================= 오늘 화면 알림 카드 ================= */
  var DISMISS_KEY = 'da.alerts.dismissed';
  function dismissed() { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function dismiss(id) { var m = dismissed(); m[id] = U.today(); try { localStorage.setItem(DISMISS_KEY, JSON.stringify(m)); } catch (e) { /* 무시 */ } }
  DA.opsUI.alertCards = function () {
    var list = O().alerts(D(), new Date(), ws());
    var gone = dismissed();
    var locked = ui.isTeacherLocked();
    return list.filter(function (a) { return !gone[a.id] && !(locked && a.route === '#/report'); }).map(function (a) {
      var b = ui.banner(a.kind === 'accent' ? 'accent' : a.kind, a.text, {
        title: a.title, icon: a.icon,
        action: { label: a.route === '#/report' ? '브리핑 보기' : '기록 보기', kind: 'primary', onClick: function () { if (a.route === '#/report') { st.report.tab = 'week'; st.report.weekOff = -1; } ui.go(a.route); } }
      });
      b.classList.add('op-alert');
      b.setAttribute('data-alert', a.id);
      b.appendChild(h('button', { class: 'btn btn-icon btn-sm td-banner-x', type: 'button', attrs: { 'aria-label': '알림 닫기' }, onClick: function () { dismiss(a.id); ui.refresh(); } }, ic('x', 18)));
      return b;
    });
  };

  /* ================= 입·퇴원 기록 ================= */
  var st = { hist: { range: 'thisMonth' }, report: { tab: 'week', weekOff: -1, ym: '' }, settle: { ym: '', includeAbsent: true } };
  var RANGES = [{ value: 'thisMonth', label: '이번 달' }, { value: 'lastMonth', label: '지난 달' }, { value: 'last3m', label: '최근 3개월' }, { value: 'thisYear', label: '올해' }, { value: 'all', label: '전체' }];
  function histRange(key) {
    if (key === 'all') return { from: '1900-01-01', to: '2999-12-31', label: '전체' };
    var p = DA.stats.presetRange(key, new Date(), ws(), D());
    return p;
  }

  DA.opsUI.editReason = function (sid, index) {
    var s = DA.store.get('students', sid);
    if (!s) return Promise.resolve(null);
    var e = O().historyOf(s)[index];
    if (!e) return Promise.resolve(null);
    return ui.promptText({
      title: O().HISTORY_TYPES[e.type] + ' 사유', sub: s.name + ' · ' + U.fmtDate(e.date, { year: 'auto' }), label: '사유', value: e.reason || '',
      placeholder: e.type === 'leave' ? '예: 이사, 시간이 안 맞음, 비용' : '예: 부상, 출장', maxLength: 60, ok: '저장'
    }).then(function (v) {
      if (v == null) return null;
      var cur = DA.store.get('students', sid);
      return DA.store.put('students', O().setHistoryReason(cur, index, v)).then(function (saved) { ui.toast('사유를 저장했어요'); return saved; });
    });
  };

  function renderHistory(el) {
    var r = histRange(st.hist.range);
    var hb = O().historyBetween(D(), r.from, r.to);
    var root = h('div', { class: 'v-ops' });
    root.appendChild(topbar('입·퇴원 기록', h('button', { class: 'btn btn-sm btn-soft owner-only', type: 'button', onClick: function () {
      saveCSV('history', O().historyCSV(D(), r.from, r.to));
    } }, ic('download', 16), 'CSV')));
    var page = h('div', { class: 'page narrow' });
    var seg = ui.segmented(RANGES, st.hist.range, function (v) { st.hist.range = v; ui.refresh(); });
    page.appendChild(h('div', { class: 'hscroll', attrs: { 'data-scroll': '' } }, seg));
    var c = hb.counts;
    page.appendChild(h('div', { class: 'kpi-grid op-kpis' },
      kpi('입회', (c.join + c.rejoin) + '명', c.rejoin ? '재등록 ' + c.rejoin + '명 포함' : r.label),
      kpi('퇴원', c.leave + '명', hb.missing.length ? '사유 없음 ' + hb.missing.length + '명' : '사유 모두 있음', null, hb.missing.length ? 'warn' : ''),
      kpi('휴원', c.pause + '명', '복귀 ' + c.resume + '명')));
    if (hb.missing.length) {
      page.appendChild(ui.banner('warn', hb.missing.map(function (e) { return e.name + '(' + md(e.date) + ')'; }).join(', ') + ' — 줄을 눌러 사유를 적어 주세요.', { title: '퇴원 사유가 비어 있어요. 확인이 필요해요.' }));
    }
    var list = h('section', { class: 'card list op-hist' });
    if (!hb.entries.length) list.appendChild(ui.empty('user-plus', r.label + ' 기록이 없어요', '수강생을 등록하거나 휴원·복귀·퇴원 처리하면 여기에 쌓여요.'));
    hb.entries.forEach(function (e) {
      list.appendChild(h('button', { class: 'list-item op-hist-row' + (e.missing ? ' warn' : ''), type: 'button', dataset: { sid: e.studentId, type: e.type }, onClick: function () {
        var sh = ui.sheet({
          title: e.name, sub: O().HISTORY_TYPES[e.type] + ' · ' + U.fmtDate(e.date, { year: 'auto' }), autofocus: false,
          content: h('div', { class: 'list flat' },
            h('button', { class: 'list-item', type: 'button', onClick: function () { sh.close(); setTimeout(function () { DA.opsUI.editReason(e.studentId, e.index); }, 60); } }, h('span', { class: 'li-ic' }, ic('edit', 19)), h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, '사유 ' + (e.reason ? '고치기' : '적기')), h('div', { class: 'li-sub' }, e.reason || '비어 있어요'))),
            h('button', { class: 'list-item', type: 'button', onClick: function () { sh.close(); ui.go('#/students/' + encodeURIComponent(e.studentId)); } }, h('span', { class: 'li-ic' }, ic('user', 19)), h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, '수강생 화면'))))
        });
      } },
        h('span', { class: 'op-hist-date num' }, md(e.date)),
        h('span', { class: 'badge op-h-' + e.type }, O().HISTORY_TYPES[e.type]),
        h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, e.name),
          h('div', { class: 'li-sub' + (e.missing ? ' warn-text' : '') }, e.reason || (e.missing ? '퇴원 사유 없음 — 확인이 필요해요' : '사유 없음') + (e.derived ? ' · 예전 기록에서 추정' : ''))),
        e.missing ? ic('alert', 18) : ic('chevR', 18)));
    });
    page.appendChild(list);
    page.appendChild(h('p', { class: 'muted small' }, '등록·휴원·복귀·퇴원·재등록을 하면 자동으로 남아요. v1.1 이전 학생은 등록일·휴원·퇴원일로 추정해 보여 줘요.'));
    root.appendChild(page);
    el.appendChild(root);
  }

  /* ================= 주간 브리핑 · 월간 리포트 ================= */
  function sec(title, rows) {
    return h('section', { class: 'card op-sec' }, h('div', { class: 'card-h' }, h('h3', null, title)), rows);
  }
  function nameList(items, fmt) {
    if (!items.length) return h('div', { class: 'muted small' }, '없어요');
    return h('div', { class: 'op-names' }, items.map(function (x) {
      return h('button', { class: 'chip', type: 'button', onClick: function () { ui.go('#/students/' + encodeURIComponent(x.studentId)); } }, fmt ? fmt(x) : x.name);
    }));
  }
  function shareBar(title, text, printFn) {
    return h('div', { class: 'btn-row op-share' },
      h('button', { class: 'btn btn-primary op-share-btn', type: 'button', onClick: function () { ui.shareText(title, text); } }, ic('share', 18), '카톡 등으로 공유'),
      h('button', { class: 'btn op-print-btn', type: 'button', onClick: printFn }, ic('print', 18), '인쇄'));
  }
  function weekBody(page, w) {
    var title = '주간 브리핑 ' + md(w.range.from) + '~' + md(w.range.to);
    page.appendChild(h('div', { class: 'kpi-grid op-kpis' },
      kpi('출석', w.attended + '회', '당일취소 ' + w.absent + '회'),
      kpi('사용 금액', won(w.usedAmount), '회당 금액 기준'),
      kpi('신규 · 퇴원', w.joined.length + ' · ' + w.left.length + '명', w.leftMissing.length ? '퇴원 사유 없음 ' + w.leftMissing.length : '', null, w.leftMissing.length ? 'warn' : ''),
      kpi('이번 달 미납', w.unpaid.students + '명', won(w.unpaid.total), function () { ui.go('#/billing'); }, w.unpaid.students ? 'warn' : '')));
    if (w.leftMissing.length) page.appendChild(ui.banner('warn', w.leftMissing.map(function (e) { return e.name; }).join(', '), { title: '퇴원 사유가 비어 있어요. 확인이 필요해요.', action: { label: '기록 보기', onClick: function () { ui.go('#/history'); } } }));
    page.appendChild(sec('신규 ' + w.joined.length + '명 · 퇴원 ' + w.left.length + '명', h('div', null,
      nameList(w.joined, function (x) { return x.name + ' ' + md(x.date); }),
      w.left.length ? nameList(w.left, function (x) { return x.name + ' — ' + (x.reason || '사유 없음'); }) : null)));
    page.appendChild(sec('선납 만료 ' + w.prepayExpiring.length + '명', nameList(w.prepayExpiring)));
    if (w.practice) page.appendChild(sec('연습실', h('div', { class: 'muted' }, '예약 ' + w.practice.booked + '건 · 체크인 ' + w.practice.checkedin + ' · 노쇼 ' + w.practice.noshow + (w.practice.rate != null ? ' (노쇼율 ' + U.pct(w.practice.rate) + ')' : ''))));
    var td = w.todo;
    page.appendChild(sec('이번 주 챙길 일', h('div', { class: 'op-todo' },
      h('div', { class: 'op-todo-h' }, ic('card', 16), ' 이용권 곧 소진 ' + td.lowRemaining.length + '명'), nameList(td.lowRemaining, function (x) { return x.name + ' ' + (x.remaining < 0 ? (-x.remaining) + '회 초과' : '남은 ' + x.remaining + '회'); }),
      h('div', { class: 'op-todo-h' }, ic('clock', 16), ' 3주 넘게 안 온 학생 ' + td.longAbsent.length + '명'), nameList(td.longAbsent, function (x) { return x.name + ' ' + x.days + '일'; }),
      h('div', { class: 'op-todo-h' }, ic('alert', 16), ' 연습실 노쇼 많은 사람 ' + td.noshowMany.length + '명'), nameList(td.noshowMany, function (x) { return x.name + ' ' + x.noshow + '회' + (x.banned ? ' · 제한' : ''); }))));
    page.appendChild(shareBar(title, w.text, function () { DA.print.textReport(title, w.text); }));
    page.appendChild(h('details', { class: 'card op-text' }, h('summary', null, '공유할 글 미리 보기'), h('pre', { class: 'op-pre' }, w.text)));
  }
  function monthBody(page, m) {
    var title = m.label + ' 운영 리포트';
    page.appendChild(h('div', { class: 'kpi-grid op-kpis' },
      kpi('매출(발급)', won(m.issuedAmount), m.issuedCount + '회분'),
      kpi('사용 금액', won(m.usedAmount), '출석 ' + m.attended + ' · 당일취소 ' + m.absent),
      kpi('받은 돈', won(m.received), '미납 ' + m.unpaid.students + '명 ' + won(m.unpaid.total)),
      kpi('재원 변화', m.people.start + ' → ' + m.people.end + '명', '신규 ' + m.people.joined + ' · 퇴원 ' + m.people.left + ' · 휴원 ' + m.people.paused, null, m.people.missing ? 'warn' : '')));
    if (m.people.missing) page.appendChild(ui.banner('warn', '퇴원 사유 없는 기록 ' + m.people.missing + '건', { title: '퇴원 사유가 비어 있어요. 확인이 필요해요.' }));
    var tb = h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, '반'), h('th', { class: 'num' }, '인원'), h('th', { class: 'num' }, '발급'), h('th', { class: 'num' }, '사용'))),
      h('tbody', null, m.byProduct.map(function (g) {
        return h('tr', null, h('td', null, g.name), h('td', { class: 'num' }, g.students), h('td', { class: 'num' }, U.fmtNumber(g.issuedAmount)), h('td', { class: 'num' }, U.fmtNumber(g.usedAmount)));
      })));
    page.appendChild(sec('반별', m.byProduct.length ? h('div', { class: 'table-wrap', attrs: { 'data-scroll': '' } }, tb) : h('div', { class: 'muted small' }, '이 달 발급 기록이 없어요')));
    if (m.practice) page.appendChild(sec('연습실', h('div', { class: 'muted' }, '예약 ' + m.practice.booked + '건 · 체크인 ' + m.practice.checkedin + ' · 노쇼 ' + m.practice.noshow + (m.practice.rate != null ? ' (노쇼율 ' + U.pct(m.practice.rate) + ')' : ''))));
    page.appendChild(shareBar(title, m.text, function () { DA.print.textReport(title, m.text); }));
    page.appendChild(h('details', { class: 'card op-text' }, h('summary', null, '공유할 글 미리 보기'), h('pre', { class: 'op-pre' }, m.text)));
  }
  function renderReport(el, params) {
    var q = (params && params.query) || {};
    if (q.tab && lastRq !== params.hash) { st.report.tab = q.tab === 'month' ? 'month' : 'week'; }
    lastRq = params && params.hash;
    var R = st.report, t = U.today();
    var root = h('div', { class: 'v-ops v-report' });
    var seg = ui.segmented([{ value: 'week', label: '주간 브리핑' }, { value: 'month', label: '월간 리포트' }], R.tab, function (v) { R.tab = v; ui.refresh(); });
    seg.classList.add('full');
    var nav;
    var rng = null;
    if (R.tab === 'week') {
      rng = O().weekRange(new Date(), ws(), R.weekOff);
      nav = h('div', { class: 'op-nav' },
        h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '이전 주' }, onClick: function () { R.weekOff--; ui.refresh(); } }, ic('chevL', 22)),
        h('b', null, U.fmtDate(rng.from, { weekday: false }) + ' ~ ' + U.fmtDate(rng.to, { weekday: false })),
        h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '다음 주' }, disabled: R.weekOff >= 0, onClick: function () { R.weekOff++; ui.refresh(); } }, ic('chevR', 22)));
    } else {
      var ym = R.ym || t.slice(0, 7);
      nav = h('div', { class: 'op-nav' },
        h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '이전 달' }, onClick: function () { R.ym = addYm(ym, -1); ui.refresh(); } }, ic('chevL', 22)),
        h('b', null, ymTitle(ym)),
        h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '다음 달' }, disabled: ym >= t.slice(0, 7), onClick: function () { R.ym = addYm(ym, 1); ui.refresh(); } }, ic('chevR', 22)));
    }
    root.appendChild(topbar('브리핑 · 리포트', null, h('div', { class: 'full' }, seg)));
    var page = h('div', { class: 'page narrow op-report' });
    page.appendChild(nav);
    if (R.tab === 'week') {
      // weekOff: -1 = 지난주(기본), 0 = 이번 주(지금까지), -2 … 그 전 주
      weekBody(page, O().weekly(D(), new Date(), ws(), rng));
      page.appendChild(h('p', { class: 'muted small' }, '서버가 없어 자동 발송은 못 해요. 매주 월요일 앱을 처음 열면 오늘 화면에 “이번 주 브리핑이 준비됐어요” 카드가 떠요.'));
    } else {
      monthBody(page, O().monthly(D(), R.ym || t.slice(0, 7), new Date()));
    }
    root.appendChild(page);
    el.appendChild(root);
  }
  var lastRq = null;

  /* ================= 강사 정산 ================= */
  DA.opsUI.editPay = function (tid) {
    var list = (S().teachers || []).slice();
    var tc = list.filter(function (x) { return x.id === tid; })[0];
    if (!tc) return Promise.resolve(null);
    var pay = Object.assign({ type: 'perLesson', amount: 0, percent: 0 }, tc.pay || {});
    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var amt = ui.input({ type: 'text', inputmode: 'numeric', value: pay.amount ? U.fmtNumber(pay.amount) : '', placeholder: '예: 25,000', maxLength: 10 });
      amt.addEventListener('input', function () { var v = parseInt(String(amt.value).replace(/[^0-9]/g, ''), 10) || 0; amt.value = v ? U.fmtNumber(v) : ''; });
      var pct = ui.input({ type: 'number', inputmode: 'decimal', value: pay.percent || '', placeholder: '예: 40', min: 0, max: 100, step: 1 });
      var fA = ui.field('회당 금액 (원)', amt, '출석(옵션: 당일취소 포함) 1회마다'), fP = ui.field('사용 금액의 % ', pct, '담당 학생 사용 금액(회당 금액 × 사용 횟수)의 몇 %');
      function sync() { fA.hidden = pay.type !== 'perLesson'; fP.hidden = pay.type !== 'percent'; }
      var seg = ui.segmented([{ value: 'perLesson', label: '회당 금액' }, { value: 'percent', label: '매출의 %' }, { value: 'none', label: '정산 안 함' }], tc.pay ? pay.type : 'none', function (v) { pay.type = v; sync(); });
      seg.classList.add('full');
      pay.type = tc.pay ? pay.type : 'none';
      sync();
      ui.sheet({
        title: '정산 방식', sub: tc.name, autofocus: false,
        content: h('div', null, ui.field('방식', seg), fA, fP),
        actions: [
          { label: '취소', kind: 'ghost', onClick: function () { fin(null); } },
          { label: '저장', kind: 'primary', onClick: function () {
            var np = pay.type === 'none' ? null : { type: pay.type, amount: parseInt(String(amt.value).replace(/[^0-9]/g, ''), 10) || 0, percent: Math.max(0, Math.min(100, parseFloat(pct.value) || 0)) };
            var next = list.map(function (x) { if (x.id !== tid) return x; var y = Object.assign({}, x); if (np) y.pay = np; else delete y.pay; return y; });
            return DA.store.saveSettings({ teachers: next }).then(function () { ui.toast(tc.name + ' 정산 방식을 저장했어요'); fin(np); });
          } }
        ],
        onClose: function () { fin(null); }
      });
    });
  };

  function renderSettle(el) {
    var t = U.today(), ym = st.settle.ym || t.slice(0, 7);
    var res = O().settle(D(), ym, { includeAbsent: st.settle.includeAbsent });
    var root = h('div', { class: 'v-ops v-settle' });
    root.appendChild(topbar('강사 정산', h('button', { class: 'btn btn-sm btn-soft', type: 'button', onClick: function () { saveCSV('settlement-' + ym, O().settleCSV(res)); } }, ic('download', 16), 'CSV')));
    var page = h('div', { class: 'page narrow' });
    page.appendChild(h('div', { class: 'op-nav' },
      h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '이전 달' }, onClick: function () { st.settle.ym = addYm(ym, -1); ui.refresh(); } }, ic('chevL', 22)),
      h('b', null, ymTitle(ym)),
      h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '다음 달' }, disabled: ym >= t.slice(0, 7), onClick: function () { st.settle.ym = addYm(ym, 1); ui.refresh(); } }, ic('chevR', 22))));
    var tog = ui.toggle(st.settle.includeAbsent, function (v) { st.settle.includeAbsent = v; ui.refresh(); }, '당일취소도 수업 수에 넣기');
    page.appendChild(h('div', { class: 'card switch-row op-switch' }, h('div', { class: 'grow' }, h('div', { class: 'strong' }, '당일취소도 수업 수에 넣기'), h('div', { class: 'muted small' }, '당일취소도 이용권 1회가 차감되고 금액에 들어가요.')), tog));
    if (res.owner) {
      page.appendChild(h('section', { class: 'card op-owner' }, h('div', { class: 'card-h' }, h('h3', null, '원장님 본인 — ' + mo(ym) + ' 요약')),
        h('div', { class: 'kpi-grid op-kpis' },
          kpi('수업', res.totals.lessons + '회', '출석 ' + res.totals.attended + ' · 당일취소 ' + res.totals.absent),
          kpi('사용 금액', won(res.totals.usedAmount), '회당 금액 × 사용 횟수'),
          kpi('발급(매출)', won(res.totals.issuedAmount), mo(ym) + ' 이용권')),
        h('p', { class: 'muted small' }, '강사가 한 명(원장님)이라 정산할 사람이 없어요. 강사를 뽑으면 설정 → 강사·레벨에서 추가하고 아래 [정산 방식]을 정해 주세요.')));
    }
    var tb = h('tbody');
    res.rows.forEach(function (e) {
      tb.appendChild(h('tr', { class: 'tap', dataset: { tid: e.teacherId }, onClick: function () { if (e.teacherId && (S().teachers || []).some(function (x) { return x.id === e.teacherId; })) DA.opsUI.editPay(e.teacherId); } },
        h('td', null, h('span', { class: 'op-dot', style: { background: e.color || 'var(--text-3)' } }), e.name),
        h('td', { class: 'num' }, e.lessons), h('td', { class: 'num' }, e.students),
        h('td', { class: 'num' }, U.fmtNumber(e.usedAmount)),
        h('td', { class: 'num strong' }, e.payout == null ? '—' : U.fmtNumber(e.payout)),
        h('td', { class: 'op-basis muted small' }, e.basis)));
    });
    tb.appendChild(h('tr', { class: 'op-total' }, h('td', null, '합계'), h('td', { class: 'num' }, res.totals.lessons), h('td'), h('td', { class: 'num' }, U.fmtNumber(res.totals.usedAmount)), h('td', { class: 'num strong' }, U.fmtNumber(res.totals.payout)), h('td')));
    page.appendChild(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, '강사별 정산'), h('span', { class: 'muted small' }, '줄을 누르면 정산 방식')),
      h('div', { class: 'table-wrap', attrs: { 'data-scroll': '' } }, h('table', { class: 'table sticky op-settle-t' },
        h('thead', null, h('tr', null, h('th', null, '강사'), h('th', { class: 'num' }, '수업'), h('th', { class: 'num' }, '학생'), h('th', { class: 'num' }, '사용 금액'), h('th', { class: 'num' }, '정산 금액'), h('th', null, '방식'))), tb))));
    page.appendChild(h('div', { class: 'btn-row' },
      h('button', { class: 'btn', type: 'button', onClick: function () { DA.print.settle(res); } }, ic('print', 18), '정산서 인쇄')));
    page.appendChild(h('p', { class: 'muted small' }, '수업 수 = 그 달 출석' + (st.settle.includeAbsent ? '·당일취소' : '') + ' 기록(기록한 강사, 없으면 학생 담당 강사). 사용 금액 = 회당 금액 × 수업 수. 매출의 % 는 사용 금액 기준이에요.'));
    root.appendChild(page);
    el.appendChild(root);
  }

  DA.opsUI.state = st;
  ui.registerView('board', { title: '운영 현황판', owner: true, render: renderBoard });
  ui.registerView('history', { title: '입·퇴원 기록', render: renderHistory });
  ui.registerView('report', { title: '브리핑 · 리포트', owner: true, render: renderReport });
  ui.registerView('settle', { title: '강사 정산', module: 'settle', owner: true, render: renderSettle });
})(window.DA = window.DA || {});
