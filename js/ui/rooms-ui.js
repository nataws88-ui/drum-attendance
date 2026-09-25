/* 드럼 출석부 — 연습실 화면 (v1.2)
 * #/rooms[?date=YYYY-MM-DD]  날짜별 방 × 시간 격자. 빈 칸 = 예약(학생 고르기), 예약 = 체크인·취소·노쇼 처리.
 * 체크인 허용 시간(시작 N분 전 ~ 시작 M분 후)이 지나도 체크인이 없으면 자동 노쇼 → 화면을 열 때·앱을 켤 때 저장(finalize) + 벌점.
 * 연습실 QR(DRUMQR:1:<토큰>:room:<방>) → [QR 출석] 스캐너가 알아보면 qrCheckin(방) → 지금 예약에서 사람 고르기 → 체크인(서명 없이, 원하면 서명).
 * DA.roomsUI = { finalize({silent}) → Promise<n>, book(roomId, date, start), bookingSheet(b), qrCheckin(roomId), checkin(b, opts), studentCard(student), state }
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
  function R() { return DA.rooms; }
  function logErr(e, w) { if (ui._logErr) ui._logErr(e, 'rooms.' + (w || '')); }
  function stuName(id) { var s = DA.store.get('students', id); return s ? s.name : '(삭제된 수강생)'; }
  function roomName(id) { var r = R().room(S(), id); return r ? r.name : '(지워진 방)'; }
  function md(ymd) { return (+ymd.slice(5, 7)) + '/' + (+ymd.slice(8, 10)); }

  var st = { date: '' };
  var LBL = { booked: '예약', open: '체크인 가능', checkedin: '체크인', noshow: '노쇼', canceled: '취소' };

  /* ---------------- 자동 노쇼 저장 ---------------- */
  var finalizing = false;
  function finalize(opts) {
    opts = opts || {};
    if (finalizing || !DA.rooms || !DA.store || !DA.store.ready) return Promise.resolve(0);
    if (!ui.moduleOn('practice')) return Promise.resolve(0);
    var due = R().dueNoShows(D(), new Date());
    if (!due.length) return Promise.resolve(0);
    finalizing = true;
    var before = {};
    due.forEach(function (b) { before[b.studentId] = R().penalty(D(), b.studentId, new Date()).banned; });
    return DA.store.putMany('bookings', due).then(function () {
      finalizing = false;
      if (!opts.silent) {
        var banned = Object.keys(before).filter(function (sid) { return !before[sid] && R().penalty(D(), sid, new Date()).banned; });
        ui.toast('연습실 노쇼 ' + due.length + '건을 자동으로 처리했어요' + (banned.length ? ' · ' + banned.map(stuName).join(', ') + ' 예약 제한' : ''), { kind: 'warn', ms: 4200 });
      }
      return due.length;
    }, function (e) { finalizing = false; logErr(e, 'finalize'); return 0; });
  }

  /* ---------------- 예약 만들기 ---------------- */
  function pickBooker(title, date) {
    var now = new Date();
    return ui.pickStudent({
      title: title || '누가 예약하나요?',
      filter: function (s) { return s.status !== 'left'; },
      sub: function (s) {
        var pen = R().penalty(D(), s.id, now);
        return pen.total ? '노쇼 ' + pen.total + '회 · 벌점 ' + pen.points + '점' : '노쇼 없음';
      },
      badge: function (s) {
        var cb = R().canBook(D(), s.id, date || U.today(), now);
        return cb.ok ? null : h('span', { class: 'badge st-absent' }, '예약 제한');
      }
    });
  }

  function book(roomId, date, start) {
    var cfg = R().cfg(S());
    return pickBooker(roomName(roomId) + ' ' + md(date) + ' ' + start + ' 예약', date).then(function (sid) {
      if (!sid) return null;
      var cb = R().canBook(D(), sid, date, new Date());
      if (!cb.ok) { ui.toast(stuName(sid) + ' — ' + cb.reason, { kind: 'error', ms: 4200 }); return null; }
      var draft = { roomId: roomId, studentId: sid, date: date, start: start, duration: cfg.unit, status: 'booked', checkinAt: null, memo: '' };
      return new Promise(function (resolve) {
        var done = false;
        function fin(v) { if (!done) { done = true; resolve(v); } }
        var slots = R().slots(cfg);
        var idx = slots.indexOf(start);
        var maxLen = 1;
        while (idx >= 0 && idx + maxLen < slots.length && maxLen < 4) maxLen++;
        var lens = [];
        for (var k = 1; k <= maxLen; k++) lens.push({ value: k * cfg.unit, label: U.fmtDuration(k * cfg.unit) });
        var seg = ui.segmented(lens, draft.duration, function (v) { draft.duration = v; paintWarn(); });
        seg.classList.add('full');
        var memo = ui.input({ placeholder: '예: 합주 연습', maxLength: 40 });
        var warn = h('div', { class: 'rm-warn' });
        function paintWarn() {
          ui.clear(warn);
          R().conflicts(D(), draft).forEach(function (c) { warn.appendChild(ui.banner('warn', c.message)); });
        }
        paintWarn();
        ui.sheet({
          title: '연습실 예약', sub: stuName(sid) + ' · ' + roomName(roomId), autofocus: false, className: 'rm-book-sheet',
          content: h('div', null,
            h('div', { class: 'info-card' }, ic('door', 22), h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, U.fmtDate(date) + ' ' + start), h('div', { class: 'li-sub' }, '체크인: 시작 ' + cfg.checkinBefore + '분 전 ~ ' + cfg.checkinAfter + '분 후 · 없으면 노쇼 벌점 ' + cfg.penaltyPerNoShow + '점'))),
            ui.field('이용 시간', seg), ui.field('메모', memo), warn),
          actions: [
            { label: '취소', kind: 'ghost', onClick: function () { fin(null); } },
            { label: '예약', kind: 'primary', onClick: function () {
              var cf = R().conflicts(D(), draft);
              if (cf.some(function (c) { return c.type === 'room'; })) { ui.toast('이미 예약된 시간이에요', { kind: 'warn' }); return false; }
              draft.memo = memo.value.trim();
              return DA.store.put('bookings', draft).then(function (saved) {
                ui.haptic('success');
                ui.toast(stuName(sid) + ' ' + md(date) + ' ' + start + ' 예약했어요', { kind: 'ok' });
                fin(saved);
              });
            } }
          ],
          onClose: function () { fin(null); }
        });
      });
    });
  }

  /* ---------------- 체크인 ---------------- */
  // opts: {via:'qr'|'manual', sign: true(서명 받기), force}
  function checkin(b, opts) {
    opts = opts || {};
    var cur = DA.store.get('bookings', b.id) || b;
    var cfg = R().cfg(S());
    var can = R().canCheckin(cur, new Date(), cfg);
    var p = Promise.resolve(true);
    if (can === 'done') { ui.toast('이미 체크인했어요', { kind: 'ok' }); return Promise.resolve(cur); }
    if (can === 'early' || can === 'late' || can === 'noshow') {
      if (opts.via === 'qr' && !opts.force) {
        ui.toast(can === 'early' ? '아직 체크인 시간이 아니에요(시작 ' + cfg.checkinBefore + '분 전부터)' : '체크인 시간이 지났어요', { kind: 'warn' });
        return Promise.resolve(null);
      }
      p = ui.confirm((can === 'early' ? '아직 체크인 허용 시간이 아니에요.' : can === 'noshow' ? '노쇼로 처리된 예약이에요.' : '체크인 허용 시간이 지났어요.') + '\n그래도 체크인으로 기록할까요?' + (can === 'noshow' ? ' (노쇼 벌점이 빠져요)' : ''), { title: '체크인', ok: '체크인' });
    }
    return p.then(function (ok) {
      if (!ok) return null;
      var sigP = opts.sign ? signFor(cur) : Promise.resolve(undefined);
      return sigP.then(function (sig) {
        if (sig === null) return null;
        var rec = Object.assign({}, cur, { status: 'checkedin', checkinAt: new Date().toISOString(), via: opts.via || 'manual', auto: false });
        delete rec.noshowAt;
        if (sig) rec.signature = sig;
        return DA.store.put('bookings', rec).then(function (saved) {
          ui.haptic('success'); if (ui.chime) ui.chime();
          ui.toast(stuName(rec.studentId) + ' 연습실 체크인 ✓', { kind: 'ok' });
          return saved;
        });
      });
    });
  }
  // 서명 받기(선택) → Signature | null(취소)
  function signFor(b) {
    return new Promise(function (resolve) {
      var pad = null, done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var host = h('div', { class: 'rm-sig' });
      var sh = ui.sheet({
        title: stuName(b.studentId) + ' 님 서명', sub: roomName(b.roomId) + ' 체크인', autofocus: false, className: 'rm-sig-sheet',
        content: host,
        actions: [
          { label: '취소', kind: 'ghost', onClick: function () { fin(null); } },
          { label: '서명 완료', kind: 'primary', onClick: function () { if (!pad || pad.isEmpty()) { ui.toast('서명해 주세요', { kind: 'warn' }); return false; } fin(pad.value()); } }
        ],
        onClose: function () { if (pad) pad.destroy(); fin(null); }
      });
      setTimeout(function () { try { pad = DA.sig.pad(host, { height: 200 }); } catch (e) { logErr(e, 'sig'); } }, 80);
      return sh;
    });
  }

  function setStatus(b, status, memo) {
    var rec = Object.assign({}, DA.store.get('bookings', b.id) || b, { status: status, auto: false });
    if (memo != null) rec.memo = memo;
    if (status === 'noshow') rec.noshowAt = new Date().toISOString();
    return DA.store.put('bookings', rec);
  }

  function bookingSheet(b) {
    var cfg = R().cfg(S());
    var eff = R().effective(b, new Date(), cfg);
    var can = R().canCheckin(b, new Date(), cfg);
    var pen = R().penalty(D(), b.studentId, new Date());
    var sh = null;
    function later(fn) { return function () { if (sh) sh.close(); setTimeout(function () { Promise.resolve().then(fn).catch(function (e) { logErr(e, 'sheet'); ui.toast('처리하지 못했어요', { kind: 'error' }); }); }, 60); }; }
    function item(icon, title, sub, fn, cls) {
      return h('button', { class: 'list-item' + (cls ? ' ' + cls : ''), type: 'button', onClick: later(fn) },
        h('span', { class: 'li-ic' }, ic(icon, 19)), h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, title), sub ? h('div', { class: 'li-sub' }, sub) : null));
    }
    var past = R().startMs(b) < Date.now();
    var list = h('div', { class: 'list flat' },
      b.status === 'booked' || b.status === 'noshow' ? item('check', '체크인', can === 'ok' ? '지금 체크인할 수 있어요' : can === 'early' ? '아직 이르지만 기록할 수 있어요' : '허용 시간이 지났지만 기록할 수 있어요', function () { return checkin(b, { via: 'manual' }); }) : null,
      b.status === 'booked' ? item('pen', '서명 받고 체크인', '연습실 이용 서명을 함께 남겨요', function () { return checkin(b, { via: 'manual', sign: true }); }) : null,
      b.status === 'booked' && past ? item('alert', '노쇼 처리', '벌점 ' + cfg.penaltyPerNoShow + '점', function () { return setStatus(b, 'noshow').then(function () { ui.toast(stuName(b.studentId) + ' 노쇼 처리'); }); }, 'danger') : null,
      b.status === 'noshow' ? item('undo', '노쇼 면제', '사정이 있었다면 벌점에서 빼요', function () { return setStatus(b, 'canceled', '노쇼 면제').then(function () { ui.toast('노쇼를 면제했어요'); }); }) : null,
      b.status === 'booked' && !past ? item('calendar-x', '예약 취소', '미리 취소하면 벌점 없어요', function () { return setStatus(b, 'canceled', '예약 취소').then(function () { ui.toast('예약을 취소했어요'); }); }, 'danger') : null,
      item('user', '수강생 화면', '노쇼 ' + pen.total + '회 · 벌점 ' + pen.points + '점' + (pen.banned ? ' · 예약 제한' : ''), function () { ui.go('#/students/' + encodeURIComponent(b.studentId)); }));
    sh = ui.sheet({
      title: stuName(b.studentId), sub: roomName(b.roomId) + ' · ' + U.fmtDate(b.date) + ' ' + b.start + '–' + R().endHm(b),
      autofocus: false, className: 'rm-bk-sheet',
      content: h('div', null,
        h('div', { class: 'rm-bk-state' }, h('span', { class: 'badge rm-st-' + eff.status }, LBL[eff.status] + (eff.auto && eff.status === 'noshow' ? ' (자동)' : '')),
          b.checkinAt ? h('span', { class: 'muted small' }, U.fmtTime(new Date(b.checkinAt)) + ' 체크인' + (b.via === 'qr' ? ' · QR' : '')) : null,
          b.memo ? h('span', { class: 'muted small' }, b.memo) : null),
        b.signature && DA.sig ? h('div', { class: 'sig-view' }, DA.sig.el(b.signature, { height: 120 })) : null,
        list)
    });
    return sh;
  }

  /* ---------------- 연습실 QR 체크인 ---------------- */
  function qrCheckin(roomId, opts) {
    opts = opts || {};
    var room = R().room(S(), roomId);
    if (!room) { ui.toast('등록되지 않은 연습실이에요', { kind: 'error' }); return Promise.resolve(null); }
    return finalize({ silent: true }).then(function () {
      var list = R().nowBookings(D(), roomId, new Date());
      return new Promise(function (resolve) {
        var done = false, sh = null, picked = false;
        function fin(v) { if (!done) { done = true; resolve(v); } }
        var box = h('div', { class: 'list rm-qr-list' });
        if (!list.length) {
          box.appendChild(ui.empty('door', '지금 체크인할 예약이 없어요', '예약 시작 ' + R().cfg(S()).checkinBefore + '분 전부터 ' + R().cfg(S()).checkinAfter + '분 후까지 체크인할 수 있어요.'));
        }
        list.forEach(function (b) {
          box.appendChild(h('button', { class: 'list-item rm-qr-item', type: 'button', onClick: function () {
            picked = true;
            if (sh) sh.close();
            setTimeout(function () { checkin(b, { via: 'qr', sign: !!opts.sign }).then(fin, function () { fin(null); }); }, 60);
          } },
            ui.avatar(stuName(b.studentId), ui.studentColor(DA.store.get('students', b.studentId))),
            h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, stuName(b.studentId)), h('div', { class: 'li-sub' }, b.start + '–' + R().endHm(b) + ' 예약')),
            h('span', { class: 'li-end' }, ic('check', 18))));
        });
        sh = ui.sheet({
          title: room.name + ' 체크인', sub: 'QR 확인 · 지금 예약한 사람을 골라 주세요', className: 'rm-qr-sheet', autofocus: false,
          content: box,
          actions: [
            { label: '닫기', kind: 'ghost', onClick: function () { fin(null); } },
            { label: '지금 바로 예약하고 체크인', onClick: function () { picked = true; setTimeout(function () { walkIn(roomId).then(fin, function () { fin(null); }); }, 60); } }
          ],
          onClose: function () { if (!picked) fin(null); }
        });
      });
    });
  }
  // 예약 없이 온 사람: 지금 시각으로 예약을 만들고 바로 체크인
  function walkIn(roomId) {
    var cfg = R().cfg(S());
    var t = U.today(), nowD = new Date();
    var start = U.min2hm(Math.floor((nowD.getHours() * 60 + nowD.getMinutes()) / 5) * 5);
    return pickBooker(roomName(roomId) + ' · 지금 바로 이용', t).then(function (sid) {
      if (!sid) return null;
      var cb = R().canBook(D(), sid, t, nowD);
      if (!cb.ok) { ui.toast(stuName(sid) + ' — ' + cb.reason, { kind: 'error', ms: 4200 }); return null; }
      var draft = { roomId: roomId, studentId: sid, date: t, start: start, duration: cfg.unit, status: 'checkedin', checkinAt: nowD.toISOString(), via: 'qr', memo: '예약 없이 바로 이용' };
      var cf = R().conflicts(D(), draft).filter(function (c) { return c.type === 'room'; });
      if (cf.length) { ui.toast('이 시간엔 ' + stuName(cf[0].booking.studentId) + ' 님 예약이 있어요', { kind: 'warn' }); return null; }
      return DA.store.put('bookings', draft).then(function (saved) {
        ui.haptic('success');
        ui.toast(stuName(sid) + ' 연습실 체크인 ✓', { kind: 'ok' });
        return saved;
      });
    });
  }

  /* ---------------- 수강생 화면 카드 ---------------- */
  function studentCard(s) {
    var now = new Date();
    var pen = R().penalty(D(), s.id, now);
    var list = R().forStudent(D(), s.id);
    var t = U.today();
    var upcoming = list.filter(function (b) { return b.date >= t && b.status === 'booked'; }).reverse().slice(0, 3);
    var recent = list.filter(function (b) { return !(b.date >= t && b.status === 'booked'); }).slice(0, 5);
    var cfg = R().cfg(S());
    function line(b) {
      var eff = R().effective(b, now, cfg);
      return h('button', { class: 'rm-line', type: 'button', onClick: function () { bookingSheet(b); } },
        h('span', { class: 'num' }, md(b.date) + ' ' + b.start), h('span', { class: 'muted' }, roomName(b.roomId)),
        h('span', { class: 'badge rm-st-' + eff.status }, LBL[eff.status]));
    }
    return h('section', { class: 'card rm-stu', attrs: { 'aria-label': '연습실' } },
      h('div', { class: 'card-h' }, h('h3', null, ic('door', 18), ' 연습실'),
        h('button', { class: 'btn btn-sm btn-soft', type: 'button', onClick: function () { ui.go('#/rooms'); } }, '예약하기')),
      h('div', { class: 'rm-stu-sum' },
        h('span', null, '노쇼 ', h('b', { class: 'num' }, pen.total + '회')),
        h('span', null, '벌점 ', h('b', { class: 'num' + (pen.points ? ' warn' : '') }, pen.points + '점')),
        pen.banned ? h('span', { class: 'badge st-absent' }, U.fmtDate(pen.banUntil, { weekday: false }) + '까지 예약 제한') : null),
      upcoming.length ? h('div', { class: 'rm-lines' }, h('div', { class: 'muted small' }, '다가오는 예약'), upcoming.map(line)) : null,
      recent.length ? h('div', { class: 'rm-lines' }, h('div', { class: 'muted small' }, '지난 예약'), recent.map(line)) : h('div', { class: 'muted small' }, '연습실 예약 기록이 없어요.'),
      pen.points ? h('button', { class: 'btn btn-sm btn-ghost owner-only rm-reset', type: 'button', onClick: function () {
        ui.requireOwner('벌점 초기화는 원장님만 할 수 있어요.').then(function (ok) {
          if (!ok) return;
          return ui.confirm(s.name + ' 님 노쇼 벌점 ' + pen.points + '점을 0점으로 초기화할까요?\n예약 제한도 풀려요. 지난 기록은 남아요.', { title: '벌점 초기화', ok: '초기화' }).then(function (y) {
            if (!y) return;
            var cur = DA.store.get('students', s.id);
            return DA.store.put('students', Object.assign({}, cur, { practiceResetAt: new Date().toISOString() })).then(function () { ui.toast('벌점을 초기화했어요'); });
          });
        });
      } }, ic('undo', 16), '벌점 초기화') : null);
  }

  /* ---------------- 화면 ---------------- */
  function render(el, params) {
    var q = (params && params.query) || {};
    if (q.date && U.isYmd(q.date) && render._q !== params.hash) st.date = q.date;
    render._q = params && params.hash;
    var t = U.today();
    var date = st.date || t;
    finalize({});
    var day = R().day(D(), date);
    var now = new Date();
    var root = h('div', { class: 'v-rooms' });
    function go(n) { st.date = U.addDays(date, n); ui.haptic('select'); ui.refresh(); }
    root.appendChild(h('header', { class: 'topbar' },
      h('div', { class: 'topbar-row' },
        h('button', { class: 'btn btn-icon back', type: 'button', attrs: { 'aria-label': '뒤로' }, onClick: function () { window.appBack(); } }, ic('chevL', 24)),
        h('h1', { class: 'topbar-title' }, '연습실'),
        h('div', { class: 'topbar-actions' },
          h('button', { class: 'btn btn-sm btn-soft', type: 'button', onClick: function () { DA.actions.qrAttend({ roomOnly: true }); } }, ic('camera', 16), 'QR 체크인'))),
      h('div', { class: 'full td-datebar rm-datebar' },
        h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '전날' }, onClick: function () { go(-1); } }, ic('chevL', 22)),
        h('b', { class: 'rm-date' }, U.fmtDate(date, { year: 'auto' }) + (date === t ? ' · 오늘' : '')),
        h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '다음 날' }, onClick: function () { go(1); } }, ic('chevR', 22)),
        date !== t ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: function () { st.date = ''; ui.refresh(); } }, '오늘') : null)));
    var page = h('div', { class: 'page rm-page' });
    if (!day.rooms.length) {
      page.appendChild(h('div', { class: 'card' }, ui.empty('door', '연습실이 없어요', '설정 → 연습실에서 방을 ‘연습실’로 바꾸거나 새로 만들어 주세요.',
        ui.viewAllowed('settings') ? { label: '연습실 설정', icon: 'settings', onClick: function () { ui.go('#/settings?section=practice'); } } : null)));
      root.appendChild(page); el.appendChild(root); return;
    }
    var cfg = day.cfg;
    var sm = R().summary(D(), date, date, now);
    page.appendChild(h('div', { class: 'rm-legend muted small' },
      '예약 ' + day.list.length + '건 · 체크인 ' + sm.checkedin + ' · 노쇼 ' + sm.noshow +
      ' — 체크인은 시작 ' + cfg.checkinBefore + '분 전 ~ ' + cfg.checkinAfter + '분 후, 없으면 자동 노쇼(벌점 ' + cfg.penaltyPerNoShow + '점, ' + cfg.banThreshold + '점이면 ' + cfg.banDays + '일 예약 제한)'));
    var table = h('table', { class: 'table rm-grid' });
    table.appendChild(h('thead', null, h('tr', null, h('th', { class: 'rm-time-h' }, '시간'), day.rooms.map(function (r) { return h('th', null, r.name); }))));
    var tb = h('tbody');
    var nowMin = date === t ? now.getHours() * 60 + now.getMinutes() : -1;
    day.slots.forEach(function (hm) {
      var m = U.hm2min(hm);
      var isNow = nowMin >= m && nowMin < m + cfg.unit;
      var tr = h('tr', { class: isNow ? 'now' : '' }, h('td', { class: 'rm-time num' }, hm));
      day.rooms.forEach(function (r) {
        var b = day.cells[r.id + '|' + hm];
        var past = date < t || (date === t && m + cfg.unit <= nowMin);
        if (!b) {
          tr.appendChild(h('td', { class: 'rm-cell' }, past ? h('span', { class: 'rm-empty past' }) :
            h('button', { class: 'rm-empty', type: 'button', attrs: { 'aria-label': r.name + ' ' + hm + ' 예약하기' }, dataset: { room: r.id, hm: hm }, onClick: function () { book(r.id, date, hm); } }, ic('plus', 16))));
          return;
        }
        var si = day.slots.indexOf(hm);
        var first = si <= 0 || day.cells[r.id + '|' + day.slots[si - 1]] !== b;
        var eff = R().effective(b, now, cfg);
        tr.appendChild(h('td', { class: 'rm-cell' }, h('button', {
          class: 'rm-bk rm-st-' + eff.status + (first ? '' : ' cont'), type: 'button', dataset: { id: b.id },
          onClick: function () { bookingSheet(b); }
        }, first ? [h('span', { class: 'rm-bk-name' }, stuName(b.studentId)), h('span', { class: 'rm-bk-st' }, LBL[eff.status])] : h('span', { class: 'rm-bk-cont' }, '〃'))));
      });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    page.appendChild(h('div', { class: 'card rm-card' }, h('div', { class: 'table-wrap rm-wrap', attrs: { 'data-scroll': '' } }, table)));
    // 벌점·제한 현황
    var pens = (D().students || []).filter(function (s) { return s && s.status !== 'left'; }).map(function (s) { return { s: s, p: R().penalty(D(), s.id, now) }; })
      .filter(function (x) { return x.p.points > 0 || x.p.banned; }).sort(function (a, b) { return b.p.points - a.p.points; });
    if (pens.length) {
      page.appendChild(h('section', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', null, '노쇼 벌점')),
        h('div', { class: 'list flat' }, pens.map(function (x) {
          return h('button', { class: 'list-item', type: 'button', onClick: function () { ui.go('#/students/' + encodeURIComponent(x.s.id)); } },
            ui.avatar(x.s.name, ui.studentColor(x.s)),
            h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, x.s.name), h('div', { class: 'li-sub' }, '노쇼 ' + x.p.total + '회 · 벌점 ' + x.p.points + '점')),
            h('span', { class: 'li-end' }, x.p.banned ? h('span', { class: 'badge st-absent' }, md(x.p.banUntil) + '까지 제한') : null));
        }))));
    }
    page.appendChild(h('div', { class: 'btn-row owner-only' },
      h('button', { class: 'btn', type: 'button', onClick: function () { if (DA.print && DA.print.roomQr) DA.print.roomQr(); } }, ic('print', 18), '연습실 QR 인쇄'),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: function () {
        ui.saveFile(DA.backup.filename('practice', 'csv'), 'text/csv;charset=utf-8', DA.backup.bookingsCSV(D()));
      } }, ic('download', 18), '예약 CSV')));
    root.appendChild(page);
    el.appendChild(root);
    // 오늘이면 처음 열 때 지금 시간 줄이 보이게
    if (date === t && st.scrolledFor !== t) {
      st.scrolledFor = t;
      setTimeout(function () { var nr = table.querySelector('tr.now'); if (nr && nr.getBoundingClientRect().top > window.innerHeight * 0.6) { try { nr.scrollIntoView({ block: 'center' }); } catch (e) { /* 무시 */ } } }, 60);
    }
  }

  // 앱을 켤 때·돌아올 때 자동 노쇼 저장
  window.addEventListener('da:resume', function () { setTimeout(function () { finalize({}); }, 400); });

  DA.roomsUI = { finalize: finalize, book: book, bookingSheet: bookingSheet, qrCheckin: qrCheckin, checkin: checkin, walkIn: walkIn, studentCard: studentCard, state: st };

  ui.registerView('rooms', {
    title: '연습실',
    module: 'practice',
    render: render
  });
})(window.DA = window.DA || {});
