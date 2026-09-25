/* 드럼 출석부 — 공용 출석 흐름 (SPEC §5 DA.actions)
 * 이름 누르기 → 서명 → 저장, 출결 메뉴, 상태 바꾸기, 진도, 명단 외 출석, 보강, 휴강.
 */
(function (DA) {
  'use strict';
  var A = DA.actions = DA.actions || {};
  var ui = DA.ui;
  var h = ui.h;
  var U = ui._u;

  /* ---------------- 도우미 ---------------- */
  function ic(n, s) { return ui.icon(n, s); }
  function data() { return DA.store.data; }
  function settings() { return (DA.store.data && DA.store.data.settings) || {}; }
  function today() { return U.today(); }
  function simple() { return settings().simpleMode !== false; }
  function logErr(e, w) { if (ui._logErr) ui._logErr(e, w); }
  function hm2min(s) {
    if (DA.util && DA.util.hm2min) return DA.util.hm2min(s);
    var p = String(s || '0:0').split(':'); return (+p[0]) * 60 + (+p[1] || 0);
  }
  function min2hm(m) {
    if (DA.util && DA.util.min2hm) return DA.util.min2hm(m);
    m = Math.round(m); return U.pad2(Math.floor(m / 60)) + ':' + U.pad2(m % 60);
  }
  function key(date, srcId, sid) {
    return DA.store.attendanceKey ? DA.store.attendanceKey(date, srcId, sid) : date + '|' + srcId + '|' + sid;
  }
  function getRec(date, srcId, sid) { return DA.store.get('attendance', key(date, srcId, sid)); }
  function clone(o) {
    if (o == null) return o;
    try { if (typeof structuredClone === 'function') return structuredClone(o); } catch (e) { /* 대체 */ }
    return JSON.parse(JSON.stringify(o));
  }
  function stLabel(st) {
    var L = (DA.C && DA.C.STATUS) || {};
    return L[st] || ({ present: '출석', late: '지각', absent: '결석', excused: '공결', canceled: '휴강', unmarked: '미확인', pending: '서명 대기', upcoming: '예정' })[st] || st;
  }
  function kindLabel(k) {
    var K = (DA.C && DA.C.KIND) || {};
    return K[k] || ({ regular: '정규', makeup: '보강', special: '특강', trial: '체험', walkin: '명단 외' })[k] || '수업';
  }
  function endOf(occ) { return occ.end || min2hm(hm2min(occ.start) + (+occ.duration || 0)); }
  function occTime(occ) { return U.fmtTime(occ.start) + '–' + U.fmtTime(endOf(occ)); }
  function snapOf(occ) {
    return { start: occ.start, duration: +occ.duration || 0, teacherId: occ.teacherId || '', roomId: occ.roomId || '', kind: occ.kind || 'regular' };
  }
  function withDate(occ, date) {
    if (!date || occ.date === date) return occ;
    var o = {}; for (var k in occ) o[k] = occ[k];
    o.date = date; o.key = date + '|' + occ.srcId;
    return o;
  }
  function passInfo(student, date) {
    try { return DA.schedule.passInfo(data(), student, date || today(), new Date()); } catch (e) { logErr(e, 'passInfo'); return null; }
  }
  function effective(occ, sid) {
    try { return DA.schedule.effectiveStatus(data(), occ, sid, new Date()) || { status: 'upcoming', record: null, auto: false }; } catch (e) {
      logErr(e, 'effectiveStatus');
      var r = getRec(occ.date, occ.srcId, sid);
      return { status: r ? r.status : 'upcoming', record: r || null, auto: false };
    }
  }
  function studentSub(st) {
    var p = [];
    if (st.courseId) p.push(ui.nameOf('course', st.courseId));
    if (st.levelId) p.push(ui.nameOf('level', st.levelId));
    return p.join(' · ');
  }
  function fmtClock(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return U.fmtTime(d, { ampm: true });
  }
  function nowFloor5() {
    var d = new Date(), m = d.getHours() * 60 + d.getMinutes();
    return min2hm(m - (m % 5));
  }
  function fillTemplate(tpl, vars) {
    if (DA.util && DA.util.fillTemplate) return DA.util.fillTemplate(tpl, vars);
    return String(tpl || '').replace(/\{([^}]+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  }
  function smsHref(phone, body) {
    if (DA.util && DA.util.smsHref) return DA.util.smsHref(phone, body);
    var p = String(phone || '').replace(/[^0-9+]/g, '');
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent || '');
    return 'sms:' + p + (ios ? '&' : '?') + 'body=' + encodeURIComponent(body);
  }
  function metaChip(icon, text, cls, color) {
    return h('span', { class: 'meta-chip' + (cls ? ' ' + cls : '') },
      color ? h('span', { class: 'dot', style: { background: color } }) : icon ? ic(icon, 16) : null, text);
  }
  function findOcc(date, srcId) {
    try {
      var list = DA.schedule.occurrencesOn(data(), date) || [];
      for (var i = 0; i < list.length; i++) if (list[i].srcId === srcId) return list[i];
    } catch (e) { logErr(e, 'occurrencesOn'); }
    return null;
  }
  function occFromExtra(ex) {
    return {
      key: ex.date + '|' + ex.id, date: ex.date, srcId: ex.id, srcType: 'extra', kind: ex.kind || 'walkin',
      start: ex.start, end: min2hm(hm2min(ex.start) + (+ex.duration || 0)), duration: +ex.duration || 0,
      teacherId: ex.teacherId || '', roomId: ex.roomId || '', title: ex.title || '',
      studentIds: (ex.studentIds || []).slice(), canceled: false, cancelReason: '', exceptionId: ex.id
    };
  }
  function greeting() {
    var hr = new Date().getHours();
    if (hr < 11) return '좋은 아침이에요!';
    if (hr < 17) return '안녕하세요!';
    return '오늘도 반가워요!';
  }
  A.statusLabel = stLabel;
  A.occTime = occTime;

  /* ------------------------------------------------------------------
   * 서명 출석
   * DA.actions.sign(occ, studentId, {date, confirmOtherDay:true, kiosk:false, allowCanceled:false}) → Promise<Attendance|null>
   * ------------------------------------------------------------------ */
  var signing = false;
  A.isSigning = function () { return signing; };

  A.sign = async function (occ, studentId, opts) {
    opts = opts || {};
    if (signing || !occ || !studentId) return null;
    var student = DA.store.get('students', studentId);
    if (!student) { ui.toast('수강생 정보를 찾을 수 없어요', { kind: 'error' }); return null; }
    // v1.1.2: 출석 서명은 무조건 레슨실 QR을 먼저 찍어야 한다
    if (!opts.viaQr) {
      if (!(await A.requireQr(student.name + ' 님 QR 출석'))) return null;
      opts = Object.assign({}, opts, { viaQr: true });
    }
    var date = opts.date || occ.date || today();
    occ = withDate(occ, date);
    var kiosk = !!opts.kiosk;
    signing = true;
    try {
      var existing = getRec(date, occ.srcId, studentId);
      var attended = existing && (existing.status === 'present' || existing.status === 'late');
      if (kiosk && attended) {
        ui.haptic('light');
        ui.toast(student.name + '님은 이미 출석했어요 ✓', { kind: 'ok' });
        return null;
      }
      var t = today();
      if (date !== t && opts.confirmOtherDay !== false && !kiosk) {
        var future = date > t;
        var ok = await ui.confirm(
          U.fmtDate(date) + ' ' + U.fmtTime(occ.start) + ' 수업이에요.\n' +
          (future ? '아직 오지 않은 날짜예요. 그래도 출석 서명을 받을까요?' : '지난 날짜의 출석으로 서명을 받을까요?'),
          { title: '오늘이 아닌 날짜', ok: '서명 받기' });
        if (!ok) return null;
      }
      if (occ.canceled && !opts.allowCanceled) {
        var ok2 = await ui.confirm('휴강으로 표시된 수업이에요' + (occ.cancelReason ? ' (' + occ.cancelReason + ')' : '') + '.\n그래도 출석 서명을 받을까요?', { title: '휴강 수업', ok: '서명 받기' });
        if (!ok2) return null;
      }
      if (!kiosk && attended && existing.signature) {
        var when = fmtClock(existing.signedAt);
        var ok3 = await ui.confirm(student.name + ' 학생은 ' + (when ? when + '에 ' : '') + '이미 서명했어요.\n다시 서명하면 기존 서명을 바꿔요.', { title: '이미 출석했어요', ok: '다시 서명' });
        if (!ok3) return null;
      }
      return await openSignSheet(occ, student, date, existing, opts);
    } catch (e) {
      logErr(e, 'actions.sign');
      ui.toast('서명 화면을 열지 못했어요', { kind: 'error' });
      return null;
    } finally {
      signing = false;
    }
  };

  function checkSvg(late) {
    return h('div', { class: 'done-check' + (late ? ' late' : '') },
      h('svg', { viewBox: '0 0 100 100', attrs: { 'aria-hidden': 'true' } },
        h('circle', { class: 'ring', cx: 50, cy: 50, r: 46 }),
        h('path', { class: 'tick', d: 'M30 51 L44 65 L71 37' })),
      burst());
  }
  function burst() {
    var colors = ['#FF7A45', '#16A34A', '#F59E0B', '#2563EB', '#DB2777', '#FACC15'];
    var el = h('div', { class: 'burst', attrs: { 'aria-hidden': 'true' } });
    for (var i = 0; i < 14; i++) {
      el.appendChild(h('i', { style: { '--a': (i * 360 / 14 + (i % 2) * 9) + 'deg', '--c': colors[i % colors.length], '--d': (78 + (i % 3) * 18) + 'px' } }));
    }
    return el;
  }

  function openSignSheet(occ, student, date, existing, opts) {
    return new Promise(function (resolve) {
      var kiosk = !!opts.kiosk;
      var s = settings();
      var isToday = date === today();
      var saved = null, finished = false, padApi = null, sh = null, saving = false, overlayTimer = null;
      function fin() { if (!finished) { finished = true; resolve(saved); } }

      var nowStatus = 'present';
      if (isToday && !simple()) { try { nowStatus = DA.schedule.statusForSign(occ, new Date(), s) || 'present'; } catch (e) { nowStatus = 'present'; } }
      var pass = passInfo(student, date);
      var lateBy = isToday ? Math.round((Date.now() - (U.parseYmd(date).getTime() + hm2min(occ.start) * 60000)) / 60000) : 0;

      var who = h('div', { class: 'sign-who' },
        kiosk ? h('div', { class: 'sign-hello' }, greeting()) : null,
        h('div', { class: 'sign-name' }, student.name),
        studentSub(student) ? h('div', { class: 'sign-sub' }, studentSub(student)) : null);
      var closeBtn = h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '닫기' }, onClick: function () { close(); } }, ic('x', 26));
      var meta = h('div', { class: 'sign-meta' },
        metaChip('clock', occTime(occ)),
        occ.teacherId ? metaChip(null, ui.nameOf('teacher', occ.teacherId), '', ui.teacherColor(occ.teacherId)) : null,
        occ.roomId && !kiosk ? metaChip('door', ui.nameOf('room', occ.roomId)) : null,
        occ.kind && occ.kind !== 'regular' && !opts.pass ? metaChip('tag', kindLabel(occ.kind), 'accent') : null,
        !isToday ? metaChip('calendar', U.fmtDate(date) + ' 기록', 'warn') : null,
        pass && pass.type && pass.type !== 'none' && pass.label && pass.label !== '—' && !kiosk ? metaChip('card', (pass.productName ? pass.productName + ' · ' : '') + pass.label, pass.warn ? 'warn' : '') : null,
        opts.overNote && !kiosk ? metaChip('alert', opts.overNote, 'warn') : null,
        isToday && nowStatus === 'late' && !kiosk ? metaChip('alert', '지금 서명하면 지각 (' + (lateBy > 0 ? '+' + lateBy + '분' : '시작 후') + ')', 'warn') : null,
        existing && !kiosk ? metaChip(null, '지금 기록: ' + stLabel(existing.status), '', 'var(--st-' + existing.status + ')') : null);
      var prompt = h('div', { class: 'sign-prompt' }, kiosk ? '아래 칸에 손가락으로 이름을 써 주세요 ✍️' : '아래 칸에 서명해 주세요');
      var host = h('div', { class: 'sign-pad-host' });
      var btnClear = h('button', { class: 'btn btn-ghost btn-tool', type: 'button', disabled: true, onClick: function () { if (padApi) { padApi.clear(); ui.haptic('light'); } } }, ic('eraser', 20), h('span', { class: 'lbl' }, '지우기'));
      var btnUndo = h('button', { class: 'btn btn-ghost btn-tool', type: 'button', disabled: true, onClick: function () { if (padApi) { padApi.undo(); ui.haptic('light'); } } }, ic('undo', 20), h('span', { class: 'lbl' }, '되돌리기'));
      var btnCancel = h('button', { class: 'btn btn-cancel', type: 'button', onClick: function () { close(); } }, '취소');
      var btnDone = h('button', { class: 'btn btn-primary btn-done', type: 'button', disabled: true, onClick: function () { save(); } }, ic('check', 22), '서명 완료');
      var overlay = h('div', { class: 'sign-done', attrs: { 'aria-live': 'assertive' } });
      var root = h('div', { class: 'sign' + (kiosk ? ' kiosk' : '') },
        h('div', { class: 'sign-top' }, who, closeBtn), meta, prompt, host,
        h('div', { class: 'sign-actions' }, btnClear, btnUndo, h('div', { class: 'spacer' }), btnCancel, btnDone),
        overlay);

      function close() { if (sh) sh.close(); }

      sh = ui.sheet({
        size: 'full', header: false, autofocus: false,
        className: 'sign-sheet' + (kiosk ? ' kiosk' : ''),
        content: root,
        onClose: function () {
          clearTimeout(overlayTimer);
          if (padApi) { try { padApi.destroy(); } catch (e) { /* 무시 */ } padApi = null; }
          fin();
        }
      });

      padApi = DA.sig.pad(host, {
        placeholder: kiosk ? '여기에 서명하세요' : '여기에 서명하세요',
        onChange: function (p) {
          var n = p.count();
          btnDone.disabled = saving || p.isEmpty();
          btnUndo.disabled = !n; btnClear.disabled = !n;
        }
      });

      async function save() {
        if (saving || !padApi || padApi.isEmpty()) return;
        saving = true; btnDone.disabled = true;
        var signedAt = new Date();
        var status = 'present';
        // v1.1 간단 모드: 서명 = 항상 출석(지각 판정 없음)
        if (date === today() && !simple()) { try { status = DA.schedule.statusForSign(occ, signedAt, settings()) || 'present'; } catch (e) { status = 'present'; } }
        var base = getRec(date, occ.srcId, student.id);
        var prev = base ? clone(base) : null;
        var rec = Object.assign({}, base ? clone(base) : {}, {
          id: key(date, occ.srcId, student.id), date: date, srcId: occ.srcId, studentId: student.id,
          status: status, method: 'sign', signedAt: signedAt.toISOString(), signature: padApi.value(), snap: snapOf(occ)
        });
        if (rec.note == null) rec.note = '';
        if (rec.progress === undefined) rec.progress = null;
        try {
          saved = (await DA.store.put('attendance', rec)) || rec;
        } catch (e) {
          logErr(e, 'sign.save');
          saving = false; btnDone.disabled = false;
          ui.haptic('error');
          ui.toast('저장하지 못했어요. 다시 눌러 주세요.', { kind: 'error' });
          return;
        }
        ui.haptic('success');
        ui.chime(status === 'late' ? 'late' : 'ok');
        showDone(status, signedAt, prev);
      }

      function showDone(status, signedAt, prev) {
        var late = status === 'late';
        ui.clear(overlay);
        if (kiosk) {
          overlay.appendChild(checkSvg(false));
          overlay.appendChild(h('h2', null, student.name + '님 출석 완료!'));
          overlay.appendChild(h('p', null, '오늘도 신나게 🥁'));
          overlay.addEventListener('click', close);
          overlayTimer = setTimeout(close, 2500);
        } else {
          overlay.appendChild(checkSvg(late));
          overlay.appendChild(h('h2', null, student.name + (late ? ' 지각 처리' : ' 출석 완료')));
          overlay.appendChild(h('p', null, fmtClock(signedAt.toISOString()) + ' 서명' + (isToday ? '' : ' · ' + U.fmtDate(date) + ' 기록')));
          if (DA.pass && settings().simpleMode !== false) {
            try {
              var pm = DA.pass.month(data(), student.id, date.slice(0, 7));
              overlay.appendChild(h('p', { class: 'sign-done-pass' }, DA.pass.label(pm, today().slice(0, 7)) + ' · ' + DA.pass.remainText(pm)));
            } catch (e) { logErr(e, 'done.pass'); }
          }
          ui.toast(student.name + (late ? ' 지각 처리' : ' 출석 ✓'), {
            kind: late ? 'warn' : 'ok',
            action: { label: '되돌리기', onClick: function () { restore(prev, saved, student.name); } }
          });
          var st = settings();
          if (st.smsEnabled && student.parentPhone) {
            var body = fillTemplate(st.smsTemplate || '[{학원}] {이름} 학생이 {시각}에 출석했습니다.', {
              '학원': st.academyName || '드럼 학원', '이름': student.name,
              '시각': fmtClock(signedAt.toISOString()), '날짜': U.fmtDate(date)
            });
            overlay.appendChild(h('div', { class: 'sms-offer' },
              h('div', { class: 'strong' }, '보호자에게 알릴까요?'),
              h('div', { class: 'sms-preview' }, (student.parentName ? student.parentName + ' · ' : '') + student.parentPhone + '\n' + body),
              h('div', { class: 'btn-row' },
                h('a', { class: 'btn btn-primary', href: smsHref(student.parentPhone, body), onClick: function () { setTimeout(close, 600); } }, ic('sms', 18), '보호자에게 문자'),
                h('button', { class: 'btn', type: 'button', onClick: function () { close(); } }, '닫기'))));
          } else {
            overlayTimer = setTimeout(close, 1100);
            overlay.addEventListener('click', close);
          }
        }
        requestAnimationFrame(function () { overlay.classList.add('show'); });
      }
    });
  }

  function restore(prev, now, name) {
    var p = prev ? DA.store.put('attendance', prev) : (now ? DA.store.remove('attendance', now.id) : Promise.resolve());
    return Promise.resolve(p).then(function () {
      ui.toast((name ? name + ' ' : '') + '되돌렸어요', { kind: 'ok', ms: 1600 });
    }, function (e) { logErr(e, 'restore'); ui.toast('되돌리지 못했어요', { kind: 'error' }); });
  }

  /* ------------------------------------------------------------------
   * 상태 바꾸기 / 지우기
   * ------------------------------------------------------------------ */
  var DONE_TEXT = { present: '출석 처리', late: '지각 처리', absent: '결석 처리', excused: '공결 처리', canceled: '휴강 처리' };
  var ABSENT_NOTE = '당일 취소 · 보강 불가';
  A.ABSENT_NOTE = ABSENT_NOTE;

  A.setStatus = async function (occ, studentId, status, opts) {
    opts = opts || {};
    var date = opts.date || occ.date;
    occ = withDate(occ, date);
    var student = DA.store.get('students', studentId);
    var id = key(date, occ.srcId, studentId);
    var base = DA.store.get('attendance', id);
    var prev = base ? clone(base) : null;
    var rec = Object.assign({}, base ? clone(base) : {}, {
      id: id, date: date, srcId: occ.srcId, studentId: studentId, status: status, snap: snapOf(occ)
    });
    var keepSig = base && base.signature && base.method === 'sign' && (status === 'present' || status === 'late');
    if (!keepSig) { rec.method = 'manual'; rec.signedAt = null; rec.signature = null; }
    if (opts.note != null) rec.note = String(opts.note);
    else if (rec.note == null) rec.note = '';
    if (rec.progress === undefined) rec.progress = null;
    var saved = (await DA.store.put('attendance', rec)) || rec;
    if (!opts.silent) {
      ui.haptic(status === 'absent' ? 'warn' : 'light');
      ui.toast((student ? student.name + ' ' : '') + (status === 'absent' && simple() ? '당일취소 · 1회 차감' : (DONE_TEXT[status] || stLabel(status))), {
        kind: status === 'absent' ? 'warn' : 'ok',
        action: { label: '되돌리기', onClick: function () { restore(prev, saved, student && student.name); } }
      });
    }
    return saved;
  };

  A.clear = async function (occ, studentId, opts) {
    opts = opts || {};
    var date = opts.date || occ.date;
    var rec = getRec(date, occ.srcId, studentId);
    if (!rec) return false;
    var student = DA.store.get('students', studentId);
    if (rec.signature && opts.confirm !== false) {
      var ok = await ui.confirm('서명까지 함께 지워져요. 이 기록을 지울까요?', { title: '기록 지우기', ok: '지우기', danger: true });
      if (!ok) return false;
    }
    var prev = clone(rec);
    await DA.store.remove('attendance', rec.id);
    // v1.1: 이용권 출석용으로 만든 수업(walkin)은 기록이 없어지면 함께 지운다(빈 수업이 자동 결석으로 남지 않게)
    var ex = DA.store.get('exceptions', rec.srcId), prevEx = null;
    if (ex && ex.type === 'extra' && ex.passUse && !(data().attendance || []).some(function (r) { return r.srcId === ex.id; })) {
      prevEx = clone(ex);
      try { await DA.store.remove('exceptions', ex.id); } catch (e) { logErr(e, 'clear.extra'); }
    }
    ui.haptic('light');
    ui.toast((student ? student.name + ' ' : '') + '기록을 지웠어요', {
      kind: 'ok',
      action: {
        label: '되돌리기', onClick: function () {
          (prevEx ? DA.store.put('exceptions', prevEx) : Promise.resolve()).then(function () { restore(prev, null, student && student.name); });
        }
      }
    });
    return true;
  };

  /* ------------------------------------------------------------------
   * 서명 보기
   * ------------------------------------------------------------------ */
  A.showSignature = function (rec) {
    if (!rec || !rec.signature) { ui.toast('저장된 서명이 없어요', { kind: 'warn' }); return null; }
    var student = DA.store.get('students', rec.studentId);
    var snap = rec.snap || {};
    var occ = findOcc(rec.date, rec.srcId);
    var start = (occ && occ.start) || snap.start;
    var dur = (occ && occ.duration) || snap.duration;
    var teacher = (occ && occ.teacherId) || snap.teacherId;
    return ui.sheet({
      title: (student ? student.name : '수강생') + ' 서명',
      sub: U.fmtDate(rec.date),
      size: 'wide',
      autofocus: false,
      content: h('div', null,
        h('div', { class: 'sig-view' }, DA.sig.el(rec.signature, { height: 220 })),
        h('dl', { class: 'kv' },
          h('dt', null, '상태'), h('dd', null, ui.badge(rec.status)),
          h('dt', null, '서명 시각'), h('dd', null, rec.signedAt ? fmtClock(rec.signedAt) : '—'),
          start ? h('dt', null, '수업') : null,
          start ? h('dd', null, U.fmtTime(start) + (dur ? '–' + U.fmtTime(min2hm(hm2min(start) + (+dur))) : '') + (teacher ? ' · ' + ui.nameOf('teacher', teacher) : '')) : null,
          rec.note ? h('dt', null, '메모') : null, rec.note ? h('dd', null, rec.note) : null)),
      actions: [{ label: '닫기', kind: 'primary' }]
    });
  };

  /* ------------------------------------------------------------------
   * 출결 메뉴
   * DA.actions.menu(occ, studentId, {date}) → 시트
   * ------------------------------------------------------------------ */
  var lastMenuAt = 0;
  A.menu = function (occ, studentId, opts) {
    opts = opts || {};
    if (!occ || !studentId) return null;
    if (Date.now() - lastMenuAt < 350) return null;
    lastMenuAt = Date.now();
    var date = opts.date || occ.date;
    occ = withDate(occ, date);
    var student = DA.store.get('students', studentId);
    if (!student) { ui.toast('수강생 정보를 찾을 수 없어요', { kind: 'error' }); return null; }
    var eff = effective(occ, studentId);
    var rec = getRec(date, occ.srcId, studentId);
    var pass = passInfo(student, date);
    var sh = null;
    ui.haptic('light');

    function later(fn) { return function () { if (sh) sh.close(); setTimeout(function () { Promise.resolve().then(fn).catch(function (e) { logErr(e, 'menu'); ui.toast('처리하지 못했어요', { kind: 'error' }); }); }, 30); }; }
    function tile(status, icon, label, fn) {
      var isCur = rec && rec.status === status;
      return h('button', { class: 'menu-tile st-' + status + (isCur ? ' cur' : ''), type: 'button', onClick: later(fn) },
        icon ? ic(icon, 20) : h('span', { class: 'dot st-' + status }), h('span', { class: 'lbl' }, label));
    }
    function item(icon, title, sub, fn, cls) {
      return h('button', { class: 'list-item' + (cls ? ' ' + cls : ''), type: 'button', onClick: fn ? later(fn) : null, disabled: !fn },
        h('span', { class: 'li-ic' }, ic(icon, 19)),
        h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, title), sub ? h('div', { class: 'li-sub' }, sub) : null),
        fn ? ic('chevR', 18) : null);
    }
    function setSt(st) { return function () { return A.setStatus(occ, studentId, st, { date: date }); }; }
    var prog = rec && rec.progress;
    var progText = prog ? [prog.song, prog.book, prog.bpm ? prog.bpm + ' BPM' : ''].filter(Boolean).join(' · ') : '';
    var absentish = eff.status === 'absent' || eff.status === 'excused' || eff.status === 'unmarked';

    var head = h('div', { class: 'menu-head' },
      ui.avatar(student.name, ui.studentColor(student), 'lg'),
      h('div', { class: 'li-main grow' },
        h('div', { class: 'li-title' }, student.name),
        h('div', { class: 'li-sub muted small' }, U.fmtDate(date) + ' · ' + occTime(occ) + (occ.teacherId ? ' · ' + ui.nameOf('teacher', occ.teacherId) : '')),
        pass && pass.type !== 'none' && pass.label && pass.label !== '—' ? h('div', { class: 'small', style: { color: pass.warn ? 'var(--st-late-ink)' : 'var(--text-3)', marginTop: '2px' } }, (pass.type === 'month' ? '이용권 ' : '수강권 ') + pass.label) : null),
      ui.badge(eff.status, { auto: eff.auto, lg: true }));

    var isSimple = simple();
    var grid = h('div', { class: 'menu-grid' + (isSimple ? ' simple' : '') },
      h('button', { class: 'menu-tile primary', type: 'button', onClick: later(function () { return A.sign(occ, studentId, { date: date }); }) }, ic('qr', 20), 'QR 찍고 서명'),
      // v1.1.2: QR 없이 바로 '출석' 처리하는 칸은 없앴다(출석은 무조건 QR)
      isSimple ? null : tile('late', null, '지각', setSt('late')),
      isSimple ? tile('absent', null, '당일취소', function () {
        return A.setStatus(occ, studentId, 'absent', { date: date, note: (rec && rec.note) || ABSENT_NOTE });
      }) : tile('absent', null, '결석', setSt('absent')),
      isSimple ? null : tile('excused', null, '공결', async function () {
        var reason = await ui.promptText({ title: '공결 사유', label: '사유', placeholder: '예: 학교 행사, 병원 진료', value: rec && rec.status === 'excused' ? rec.note : '', ok: '공결 처리' });
        if (reason == null) return;
        return A.setStatus(occ, studentId, 'excused', { date: date, note: reason });
      }),
      isSimple ? null : tile('canceled', null, '이 학생만 휴강', setSt('canceled')),
      ui.moduleOn('progress') ? h('button', { class: 'menu-tile', type: 'button', onClick: later(function () { return A.editProgress(occ, studentId, { date: date }); }) }, ic('music', 20), h('span', { class: 'lbl' }, '진도')) : null);

    // 기록이 없어도 지난 수업(자동 결석)·휴강 수업은 그 상태로 메모를 남길 수 있다
    var memoStatus = rec ? rec.status : ((eff.status === 'absent' && eff.auto) || eff.status === 'canceled' ? eff.status : null);
    var list = h('div', { class: 'list flat' },
      memoStatus ? item('note', '출결 메모', (rec && rec.note) || '사유·특이사항 남기기', async function () {
        var cur = getRec(date, occ.srcId, studentId);
        var note = await ui.promptText({ title: '출결 메모', type: 'textarea', value: (cur && cur.note) || '', placeholder: '예: 10분 늦게 옴, 스틱 두고 감', ok: '저장' });
        if (note == null) return;
        cur = getRec(date, occ.srcId, studentId);
        if (cur) {
          await DA.store.put('attendance', Object.assign({}, clone(cur), { note: note }));
        } else {
          await A.setStatus(occ, studentId, memoStatus, { date: date, note: note, silent: true });
        }
        ui.toast('메모를 저장했어요', { kind: 'ok' });
      }) : item('note', '출결 메모', '출결을 먼저 기록하면 쓸 수 있어요', null),
      ui.moduleOn('progress') ? item('music', '진도 기록', progText || '곡 · 교재 · BPM · 메모', function () { return A.editProgress(occ, studentId, { date: date }); }) : null,
      rec && rec.signature ? item('pen', '서명 보기', (rec.signedAt ? fmtClock(rec.signedAt) + ' 서명' : '저장된 서명'), function () { A.showSignature(getRec(date, occ.srcId, studentId) || rec); }) : null,
      absentish && !isSimple ? item('repeat', '보강 잡기', '이 수업 대신 다른 날 보강', function () { return A.makeup(studentId, { forDate: date, forSrcId: occ.srcId }); }) : null,
      item('user', '수강생 정보', studentSub(student) || '연락처 · 출석 기록 · 결제', function () { ui.go('#/students/' + encodeURIComponent(studentId)); }),
      rec && !ui.isTeacherLocked() ? item('trash', '기록 지우기', rec.signature ? '서명도 함께 지워져요' : '기록 전 상태로 되돌려요', function () { return A.clear(occ, studentId, { date: date }); }, 'danger') : null);   // v1.2: 강사 모드에선 기록 삭제 숨김

    sh = ui.sheet({
      title: '출결 처리',
      autofocus: false,
      className: 'menu-sheet',
      content: h('div', null, head, grid, list)
    });
    return sh;
  };

  /* ------------------------------------------------------------------
   * 진도 기록
   * ------------------------------------------------------------------ */
  function progressHistory(studentId, excludeId) {
    var out = [];
    (data().attendance || []).forEach(function (r) {
      if (r.studentId === studentId && r.progress && r.id !== excludeId && (r.progress.song || r.progress.book || r.progress.bpm)) out.push(r);
    });
    out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return out;
  }
  function uniqueValues(field, studentId) {
    var seen = {}, mine = [], others = [];
    var list = (data().attendance || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    list.forEach(function (r) {
      var v = r.progress && r.progress[field];
      v = v ? String(v).trim() : '';
      if (!v || seen[v]) return;
      seen[v] = 1;
      (r.studentId === studentId ? mine : others).push(v);
    });
    return mine.concat(others).slice(0, 40);
  }
  var dlSeq = 0;
  function datalist(values) {
    var id = 'dl-' + (++dlSeq) + '-' + Date.now().toString(36);
    return { id: id, el: h('datalist', { id: id }, values.map(function (v) { return h('option', { value: v }); })) };
  }

  A.editProgress = function (occ, studentId, opts) {
    opts = opts || {};
    var date = opts.date || occ.date;
    occ = withDate(occ, date);
    var student = DA.store.get('students', studentId);
    if (!student) { ui.toast('수강생 정보를 찾을 수 없어요', { kind: 'error' }); return Promise.resolve(null); }
    var id = key(date, occ.srcId, studentId);
    var rec = DA.store.get('attendance', id);
    var hist = progressHistory(studentId, id);
    var last = hist[0] || null;
    var cur = (rec && rec.progress) || null;
    var init = cur || (last ? { song: last.progress.song || '', book: last.progress.book || '', bpm: last.progress.bpm || null, memo: '' } : { song: '', book: '', bpm: null, memo: '' });

    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var dlSong = datalist(uniqueValues('song', studentId));
      var dlBook = datalist(uniqueValues('book', studentId));
      var song = ui.input({ value: init.song || '', placeholder: '예: Billie Jean, 8비트 기본', list: dlSong.id });
      var book = ui.input({ value: init.book || '', placeholder: '예: 드럼 교본 1권 p.24', list: dlBook.id });
      var bpm = ui.input({ type: 'number', value: init.bpm != null ? init.bpm : '', placeholder: 'BPM', min: 20, max: 400, step: 1, inputmode: 'numeric' });
      var memo = ui.input({ type: 'textarea', value: (cur && cur.memo) || '', placeholder: '예: 필인 연습, 하이햇 오픈 타이밍 보완', rows: 3 });
      function bump(d) {
        var v = parseInt(bpm.value, 10);
        if (!isFinite(v)) v = (last && last.progress.bpm) || 80;
        bpm.value = String(Math.max(20, Math.min(400, v + d)));
        ui.haptic('select');
      }
      var stepper = h('div', { class: 'stepper' },
        h('button', { class: 'btn', type: 'button', attrs: { 'aria-label': 'BPM 5 내리기' }, onClick: function () { bump(-5); } }, '−5'),
        bpm,
        h('button', { class: 'btn', type: 'button', attrs: { 'aria-label': 'BPM 5 올리기' }, onClick: function () { bump(5); } }, '+5'));
      var lastCard = last ? h('div', { class: 'info-card' },
        h('span', { class: 'li-ic' }, ic('music', 19)),
        h('div', { class: 'li-main' },
          h('div', { class: 'li-title' }, '지난 진도 · ' + U.fmtDate(last.date)),
          h('div', { class: 'li-sub' }, [last.progress.song, last.progress.book, last.progress.bpm ? last.progress.bpm + ' BPM' : ''].filter(Boolean).join(' · ') + (last.progress.memo ? ' — ' + last.progress.memo : '')))) : null;

      ui.sheet({
        title: '진도 기록',
        sub: student.name + ' · ' + U.fmtDate(date) + ' ' + U.fmtTime(occ.start),
        autofocus: false,
        content: h('div', null,
          lastCard,
          !rec ? ui.banner('info', '아직 출결 기록이 없어요. 저장하면 출석으로 함께 기록돼요.') : null,
          h('div', { class: rec ? '' : 'mt-12' },
            ui.field('곡', song),
            ui.field('교재', book),
            ui.field('BPM', stepper, last && last.progress.bpm ? '지난번 ' + last.progress.bpm + ' BPM' : null),
            ui.field('메모', memo)),
          dlSong.el, dlBook.el),
        actions: [
          { label: '취소', kind: 'ghost', onClick: function () { fin(null); } },
          {
            label: '저장', kind: 'primary', onClick: async function () {
              var b = parseInt(bpm.value, 10);
              var progress = { song: song.value.trim(), book: book.value.trim(), bpm: isFinite(b) && b > 0 ? Math.max(20, Math.min(400, b)) : null, memo: memo.value.trim() };
              if (!progress.song && !progress.book && progress.bpm == null && !progress.memo) progress = null;
              var base = DA.store.get('attendance', id);
              var r2 = base ? Object.assign({}, clone(base), { progress: progress }) : {
                id: id, date: date, srcId: occ.srcId, studentId: studentId, status: 'present', method: 'manual',
                signedAt: null, signature: null, note: '', progress: progress, snap: snapOf(occ)
              };
              var saved = (await DA.store.put('attendance', r2)) || r2;
              ui.haptic('success');
              ui.toast(base ? '진도를 저장했어요' : student.name + ' 출석 처리 + 진도 저장', { kind: 'ok' });
              fin(saved);
            }
          }
        ],
        onClose: function () { fin(null); }
      });
    });
  };

  /* ------------------------------------------------------------------
   * 명단 외 출석(walk-in)
   * DA.actions.walkin({date, studentId?, kiosk?}) → Promise<Attendance|null>
   * ------------------------------------------------------------------ */
  function lessonStartFor(studentId, date) {
    var wd = U.parseYmd(date).getDay(), any = null;
    var list = data().lessons || [];
    for (var i = 0; i < list.length; i++) {
      var l = list[i];
      if ((l.studentIds || []).indexOf(studentId) < 0) continue;
      if (l.weekday === wd) return l.start;
      if (!any) any = l.start;
    }
    return any;
  }

  A.walkin = async function (opts) {
    opts = opts || {};
    var date = opts.date || today();
    var t = today();
    var kiosk = !!opts.kiosk;
    var sid = opts.studentId || await ui.pickStudent({
      title: '누가 왔나요? (명단 외 출석)',
      filter: function (s) { return s.status !== 'left'; }
    });
    if (!sid) return null;
    var student = DA.store.get('students', sid);
    if (!student) return null;

    // 그날 이 학생의 수업이 이미 있으면 그 수업으로 받는다
    var occs = [];
    try { occs = (DA.schedule.occurrencesOn(data(), date) || []).filter(function (o) { return !o.canceled && (o.studentIds || []).indexOf(sid) >= 0; }); } catch (e) { logErr(e, 'walkin.occ'); }
    var attendedOcc = null, open = [];
    occs.forEach(function (o) {
      var r = getRec(date, o.srcId, sid);
      if (r && (r.status === 'present' || r.status === 'late')) attendedOcc = o; else open.push(o);
    });
    if (open.length) {
      var nowMin = date === t ? new Date().getHours() * 60 + new Date().getMinutes() : 0;
      open.sort(function (a, b) { return Math.abs(hm2min(a.start) - nowMin) - Math.abs(hm2min(b.start) - nowMin); });
      var target = open[0];
      if (kiosk) return A.sign(target, sid, { date: date, confirmOtherDay: false, kiosk: true });
      var use = await ui.confirm(student.name + ' 학생은 ' + (date === t ? '오늘 ' : U.fmtDate(date) + ' ') + U.fmtTime(target.start) + ' 수업이 있어요.\n그 수업으로 출석할까요?', { title: '정규 수업이 있어요', ok: '그 수업으로 출석', cancel: '명단 외로 추가' });
      if (use) return A.sign(target, sid, { date: date, confirmOtherDay: date !== t });
    } else if (attendedOcc) {
      if (kiosk) { ui.toast(student.name + '님은 오늘 이미 출석했어요 ✓', { kind: 'ok' }); return null; }
      var more = await ui.confirm(student.name + ' 학생은 ' + U.fmtTime(attendedOcc.start) + ' 수업에 이미 출석했어요.\n명단 외 수업을 하나 더 추가할까요?', { title: '이미 출석했어요', ok: '추가하기' });
      if (!more) return null;
    }

    var start;
    if (date === t) start = nowFloor5();
    else {
      start = await ui.promptText({ title: '수업 시각', label: U.fmtDate(date) + ' 몇 시 수업인가요?', type: 'time', value: lessonStartFor(sid, date) || settings().openTime || '17:00', ok: '다음' });
      if (!start) return null;
      if (!/^\d{1,2}:\d{2}$/.test(start)) { ui.toast('시각을 다시 확인해 주세요', { kind: 'warn' }); return null; }
      if (start.length === 4) start = '0' + start;
    }
    var ex = {
      date: date, type: 'extra', kind: 'walkin', start: start, duration: +settings().defaultDuration || 50,
      studentIds: [sid], teacherId: student.teacherId || '', roomId: '', title: '', lessonId: '', reason: '', makeupFor: null, passUse: true
    };
    if (DA.util && DA.util.uid) ex.id = DA.util.uid();
    var savedEx;
    try { savedEx = (await DA.store.put('exceptions', ex)) || ex; } catch (e) { logErr(e, 'walkin.put'); ui.toast('수업을 만들지 못했어요', { kind: 'error' }); return null; }
    var occ = findOcc(date, savedEx.id) || occFromExtra(savedEx);
    var rec = await A.sign(occ, sid, { date: date, confirmOtherDay: false, kiosk: kiosk, allowCanceled: true });
    if (!rec) {
      // 서명을 취소하면 빈 명단 외 수업을 남기지 않는다
      var still = DA.store.get('exceptions', savedEx.id);
      var hasRec = (data().attendance || []).some(function (r) { return r.srcId === savedEx.id; });
      if (still && !hasRec) { try { await DA.store.remove('exceptions', savedEx.id); } catch (e) { logErr(e, 'walkin.cleanup'); } }
    }
    return rec;
  };

  /* ------------------------------------------------------------------
   * 보강 잡기
   * DA.actions.makeup(studentId, {forDate, forSrcId, date}) → Promise<Exception|null>
   * ------------------------------------------------------------------ */
  A.makeup = async function (studentId, opts) {
    opts = opts || {};
    if (!studentId) {
      studentId = await ui.pickStudent({ title: '보강할 수강생' });
      if (!studentId) return null;
    }
    var student = DA.store.get('students', studentId);
    if (!student) { ui.toast('수강생 정보를 찾을 수 없어요', { kind: 'error' }); return null; }
    var s = settings();
    var src = opts.forSrcId ? (DA.store.get('lessons', opts.forSrcId) || DA.store.get('exceptions', opts.forSrcId)) : null;
    var srcRec = opts.forDate && opts.forSrcId ? getRec(opts.forDate, opts.forSrcId, studentId) : null;
    var t = today();
    var draft = {
      date: opts.date || t,
      start: (src && src.start) || lessonStartFor(studentId, opts.date || t) || '17:00',
      duration: +((src && src.duration) || s.defaultDuration || 50),
      teacherId: (src && src.teacherId) || student.teacherId || '',
      roomId: (src && src.roomId) || '',
      title: ''
    };

    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var teachers = (s.teachers || []).map(function (x) { return { value: x.id, label: x.name }; });
      var rooms = (s.rooms || []).map(function (x) { return { value: x.id, label: x.name }; });
      var durs = [30, 40, 50, 60, 80, 90];
      if (durs.indexOf(draft.duration) < 0) { durs.push(draft.duration); durs.sort(function (a, b) { return a - b; }); }

      var dateIn = ui.input({ type: 'date', value: draft.date, onChange: function (v) { draft.date = v; check(); }, onInput: function (v) { draft.date = v; check(); } });
      var timeIn = ui.input({ type: 'time', value: draft.start, step: 300, onChange: function (v) { draft.start = v; check(); }, onInput: function (v) { draft.start = v; check(); } });
      var durSel = ui.select(durs.map(function (d) { return { value: d, label: d + '분' }; }), draft.duration, function (v) { draft.duration = +v; check(); });
      var tSel = ui.select([{ value: '', label: '미지정' }].concat(teachers), draft.teacherId, function (v) { draft.teacherId = v; check(); });
      var rSel = ui.select([{ value: '', label: '미지정' }].concat(rooms), draft.roomId, function (v) { draft.roomId = v; check(); });
      var titleIn = ui.input({ value: '', placeholder: '비워 두면 학생 이름으로 표시돼요', onInput: function (v) { draft.title = v; } });
      var conflictBox = h('div', { class: 'conflicts' });

      function check() {
        ui.clear(conflictBox);
        if (!draft.date || !draft.start || !DA.schedule || !DA.schedule.conflicts) return;
        try {
          var list = DA.schedule.conflicts(data(), {
            date: draft.date, start: draft.start, duration: draft.duration, teacherId: draft.teacherId,
            roomId: draft.roomId, studentIds: [studentId], startDate: draft.date, endDate: draft.date
          }, {}) || [];
          list.slice(0, 4).forEach(function (c) { conflictBox.appendChild(ui.banner('warn', c.message || '시간이 겹치는 수업이 있어요')); });
          if (list.length > 4) conflictBox.appendChild(h('div', { class: 'small muted' }, '외 ' + (list.length - 4) + '건 더 겹쳐요'));
        } catch (e) { logErr(e, 'makeup.conflicts'); }
      }

      var origin = opts.forDate ? (U.fmtDate(opts.forDate) + (src && src.start ? ' ' + U.fmtTime(src.start) : '') + ' 수업' + (srcRec ? ' · ' + stLabel(srcRec.status) : '')) : '보강 수업을 새로 잡아요';
      ui.sheet({
        title: '보강 잡기',
        autofocus: false,
        content: h('div', null,
          h('div', { class: 'info-card' },
            ui.avatar(student.name, ui.studentColor(student)),
            h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, student.name), h('div', { class: 'li-sub' }, opts.forDate ? '원 수업: ' + origin : origin))),
          conflictBox,
          ui.field('날짜', dateIn),
          h('div', { class: 'field-row' }, ui.field('시작', timeIn), ui.field('길이', durSel)),
          h('div', { class: 'field-row' }, ui.field('강사', tSel), ui.field('방', rSel)),
          ui.field('제목 (선택)', titleIn)),
        actions: [
          { label: '취소', kind: 'ghost', onClick: function () { fin(null); } },
          {
            label: '보강 저장', kind: 'primary', onClick: async function () {
              if (!draft.date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) { ui.toast('날짜를 골라 주세요', { kind: 'warn' }); return false; }
              if (!draft.start || !/^\d{1,2}:\d{2}/.test(draft.start)) { ui.toast('시작 시각을 골라 주세요', { kind: 'warn' }); return false; }
              var ex = {
                date: draft.date, type: 'extra', kind: 'makeup', start: draft.start.slice(0, 5), duration: +draft.duration || 50,
                studentIds: [studentId], teacherId: draft.teacherId, roomId: draft.roomId, title: (draft.title || '').trim(),
                lessonId: '', reason: '',
                makeupFor: opts.forDate && opts.forSrcId ? { date: opts.forDate, srcId: opts.forSrcId } : null
              };
              if (DA.util && DA.util.uid) ex.id = DA.util.uid();
              var saved = (await DA.store.put('exceptions', ex)) || ex;
              ui.haptic('success');
              ui.toast('보강 수업을 잡았어요 · ' + U.fmtDate(saved.date) + ' ' + U.fmtTime(saved.start), { kind: 'ok' });
              fin(saved);
            }
          }
        ],
        onClose: function () { fin(null); }
      });
      check();
    });
  };

  /* ------------------------------------------------------------------
   * 휴강 / 휴강 취소 / extra 삭제
   * DA.actions.cancelOccurrence(occ, {reason}) → Promise<bool>
   * ------------------------------------------------------------------ */
  A.uncancel = async function (occ) {
    var list = (data().exceptions || []).filter(function (e) { return e.type === 'cancel' && e.date === occ.date && e.lessonId === occ.srcId; });
    if (!list.length) {
      var closed = (settings().closedDays || []).indexOf(occ.date) >= 0;
      ui.toast(closed ? '휴원일로 지정된 날이에요. 설정 → 휴원일에서 바꿀 수 있어요.' : '되살릴 휴강 기록이 없어요', { kind: 'warn', ms: 3600 });
      return false;
    }
    var ok = await ui.confirm(U.fmtDate(occ.date) + ' ' + U.fmtTime(occ.start) + ' 수업의 휴강을 취소할까요?', { title: '휴강 취소', ok: '수업 되살리기' });
    if (!ok) return false;
    var ids = list.map(function (e) { return e.id; });
    if (DA.store.removeMany) await DA.store.removeMany('exceptions', ids);
    else for (var i = 0; i < ids.length; i++) await DA.store.remove('exceptions', ids[i]);
    ui.toast('수업을 되살렸어요', { kind: 'ok' });
    return true;
  };

  A.cancelOccurrence = async function (occ, opts) {
    opts = opts || {};
    if (!occ) return false;
    var label = U.fmtDate(occ.date) + ' ' + U.fmtTime(occ.start);
    if (occ.srcType === 'extra') {
      var recs = (data().attendance || []).filter(function (r) { return r.srcId === occ.srcId && r.date === occ.date; });
      var ok = await ui.confirm(label + ' ' + kindLabel(occ.kind) + ' 수업을 삭제할까요?' + (recs.length ? '\n출석 기록 ' + recs.length + '건도 함께 지워져요.' : ''), { title: kindLabel(occ.kind) + ' 수업 삭제', ok: '삭제', danger: true });
      if (!ok) return false;
      if (recs.length) {
        var rids = recs.map(function (r) { return r.id; });
        if (DA.store.removeMany) await DA.store.removeMany('attendance', rids);
        else for (var i = 0; i < rids.length; i++) await DA.store.remove('attendance', rids[i]);
      }
      await DA.store.remove('exceptions', occ.exceptionId || occ.srcId);
      ui.toast(kindLabel(occ.kind) + ' 수업을 삭제했어요', { kind: 'ok' });
      return true;
    }
    if (occ.canceled) return A.uncancel(occ);
    var reason = opts.reason;
    if (reason == null) {
      var recCount = (data().attendance || []).filter(function (r) { return r.srcId === occ.srcId && r.date === occ.date; }).length;
      reason = await ui.promptText({
        title: label + ' 휴강',
        message: recCount ? '이 수업에 이미 출결 기록이 ' + recCount + '건 있어요. 휴강으로 바꿔도 기록은 남아요.' : null,
        label: '휴강 사유 (선택)', placeholder: '예: 강사 개인 사정, 공휴일', ok: '휴강 처리'
      });
      if (reason == null) return false;
    }
    var ex = { date: occ.date, type: 'cancel', lessonId: occ.lessonId || occ.srcId, reason: String(reason || '') };
    if (DA.util && DA.util.uid) ex.id = DA.util.uid();
    var saved = (await DA.store.put('exceptions', ex)) || ex;
    ui.haptic('light');
    ui.toast(label + ' 휴강 처리했어요', {
      kind: 'ok',
      action: { label: '되돌리기', onClick: function () { DA.store.remove('exceptions', saved.id).then(function () { ui.toast('휴강을 취소했어요', { kind: 'ok', ms: 1600 }); }); } }
    });
    return true;
  };
  /* ------------------------------------------------------------------
   * v1.1 이용권 출석 — 시간표와 무관하게 언제든(학생 페이지·오늘 화면·QR)
   * 기록 방식: 그날 그 시각의 walkin 수업(passUse:true)을 만들고 그 수업에 서명·결석을 기록한다
   *            → 통계·백업·시간표와 그대로 호환. 기록을 지우면 수업도 함께 지운다(A.clear).
   * ------------------------------------------------------------------ */
  function P() { return DA.pass; }
  function monthOf(sid, date) { return P().month(data(), sid, String(date || today()).slice(0, 7)); }
  function monthWord(date) { return String(date).slice(0, 7) === today().slice(0, 7) ? '이번 달' : (+String(date).slice(5, 7)) + '월'; }
  function productOf(student) { return student ? P().product(settings(), student.courseId) : null; }

  // 남은 횟수가 없을 때 알릴 말(없으면 null)
  function overText(student, date) {
    var m = monthOf(student.id, date);
    if (m.status === 'none') return monthWord(date) + ' 이용권이 아직 없어요';
    if (m.remaining <= 0) return monthWord(date) + ' 횟수를 다 썼어요' + (m.remaining < 0 ? ' (이미 ' + (-m.remaining) + '회 초과)' : '');
    return null;
  }
  function overChip(student, date) {
    var m = monthOf(student.id, date);
    if (m.status === 'none') return '이용권 미발급 — 초과로 기록';
    if (m.remaining <= 0) return (1 - m.remaining) + '회 초과로 기록';
    return null;
  }
  function useExtra(student, date, start, title) {
    var prod = productOf(student);
    var ex = {
      date: date, type: 'extra', kind: 'walkin', start: start,
      duration: (prod && prod.minutes) || +settings().defaultDuration || 50,
      studentIds: [student.id], teacherId: student.teacherId || ((settings().teachers || [])[0] || {}).id || '',
      roomId: '', title: title || '', lessonId: '', reason: '', makeupFor: null, passUse: true
    };
    if (DA.util && DA.util.uid) ex.id = DA.util.uid();
    return ex;
  }
  async function dropExtraIfEmpty(exId) {
    var still = DA.store.get('exceptions', exId);
    var hasRec = (data().attendance || []).some(function (r) { return r.srcId === exId; });
    if (still && !hasRec) { try { await DA.store.remove('exceptions', exId); } catch (e) { logErr(e, 'pass.cleanup'); } }
  }

  // 이용권 출석: 서명 시트 → 저장 = 1회 사용. opts: {viaQr, date}
  A.passSign = async function (studentId, opts) {
    opts = opts || {};
    var student = DA.store.get('students', studentId);
    if (!student) { ui.toast('수강생 정보를 찾을 수 없어요', { kind: 'error' }); return null; }
    if (signing) return null;
    if (!opts.viaQr) {
      // v1.1.2: 출석은 무조건 레슨실 QR을 먼저 찍어야 서명할 수 있다
      return A.qrAttend({ studentId: studentId });
    }
    var date = today();
    var mine = (data().attendance || []).filter(function (r) { return r.studentId === studentId && r.date === date && (r.status === 'present' || r.status === 'late'); });
    if (mine.length && !opts.again) {
      var last = mine[mine.length - 1];
      var ok0 = await ui.confirm(student.name + ' 님은 오늘' + (last.signedAt ? ' ' + fmtClock(last.signedAt) + '에' : '') + ' 이미 출석했어요.\n한 번 더 출석으로 기록할까요? (1회 더 차감돼요)', { title: '오늘 이미 출석', ok: '한 번 더 출석' });
      if (!ok0) return null;
    }
    var warn = overText(student, date);
    if (warn) {
      var ok = await ui.confirm(warn + '.\n그래도 출석할까요? (초과로 기록돼요)', { title: '남은 횟수 없음', ok: '그래도 출석' });
      if (!ok) return null;
    }
    var ex = useExtra(student, date, nowFloor5(), '');
    var savedEx;
    try { savedEx = (await DA.store.put('exceptions', ex)) || ex; } catch (e) { logErr(e, 'passSign.put'); ui.toast('출석을 기록하지 못했어요', { kind: 'error' }); return null; }
    var occ = findOcc(date, savedEx.id) || occFromExtra(savedEx);
    var rec = await A.sign(occ, studentId, { date: date, confirmOtherDay: false, allowCanceled: true, pass: true, viaQr: true, overNote: warn ? overChip(student, date) : null });
    if (!rec) await dropExtraIfEmpty(savedEx.id);
    return rec;
  };

  // 결석 = 당일 취소: 1회 차감·금액 포함, 보강 없음
  A.passAbsent = async function (studentId, opts) {
    opts = opts || {};
    var student = DA.store.get('students', studentId);
    if (!student) { ui.toast('수강생 정보를 찾을 수 없어요', { kind: 'error' }); return null; }
    var date = opts.date || today();
    var warn = overText(student, date);
    var m = monthOf(studentId, date);
    var unit = m.issued > 0 ? Math.round(m.amount / m.issued) : 0;
    var ok = await ui.confirm(student.name + ' 님 ' + (date === today() ? '오늘' : U.fmtDate(date)) + ' 수업을 당일취소로 기록할까요?\n' +
      '이용권 1회가 차감되고' + (unit ? ' ' + DA.util.fmtMoney(unit) + '이' : '') + ' 사용 금액에 들어가요. 보강은 없어요.' + (warn ? '\n※ ' + warn + ' — 초과로 기록돼요.' : ''),
      { title: '당일취소', ok: '당일취소 처리', danger: true });
    if (!ok) return null;
    var ex = useExtra(student, date, opts.start || nowFloor5(), '');
    try {
      var savedEx = (await DA.store.put('exceptions', ex)) || ex;
      var occ = findOcc(date, savedEx.id) || occFromExtra(savedEx);
      var rec = {
        id: key(date, savedEx.id, studentId), date: date, srcId: savedEx.id, studentId: studentId, status: 'absent', method: 'manual',
        signedAt: null, signature: null, note: ABSENT_NOTE, progress: null, snap: snapOf(occ)
      };
      var saved = (await DA.store.put('attendance', rec)) || rec;
      ui.haptic('warn');
      ui.toast(student.name + ' 당일취소 · 1회 차감', {
        kind: 'warn',
        action: {
          label: '되돌리기', onClick: function () {
            DA.store.remove('attendance', saved.id).then(function () { return DA.store.remove('exceptions', savedEx.id); })
              .then(function () { ui.toast('되돌렸어요', { kind: 'ok', ms: 1600 }); }, function (e) { logErr(e, 'passAbsent.undo'); });
          }
        }
      });
      return saved;
    } catch (e) {
      logErr(e, 'passAbsent');
      ui.toast('기록하지 못했어요', { kind: 'error' });
      return null;
    }
  };

  // 지난 날짜로 기록(깜빡한 출석·당일취소를 나중에 넣기): 날짜·시각·출석/결석
  A.passRecord = function (studentId, opts) {
    opts = opts || {};
    var student = DA.store.get('students', studentId);
    if (!student) return Promise.resolve(null);
    var t = today();
    var draft = { date: opts.date && opts.date <= t ? opts.date : t, start: '19:00', status: 'present' };
    return new Promise(function (resolve) {
      var done = false;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var dateIn = ui.input({ type: 'date', value: draft.date, max: t, onChange: function (v) { draft.date = v; paint(); }, onInput: function (v) { draft.date = v; paint(); } });
      var timeIn = ui.input({ type: 'time', value: draft.start, step: 300, onChange: function (v) { draft.start = v; }, onInput: function (v) { draft.start = v; } });
      // v1.1.2: 지난 날짜로는 당일취소만 넣는다(출석은 무조건 QR)
      draft.status = 'absent';
      var seg = ui.segmented([{ value: 'absent', label: '당일취소' }], draft.status, function (v) { draft.status = v; paint(); });
      seg.classList.add('full');
      var info = h('div', { class: 'small muted mt-8' });
      function paint() {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '')) { info.textContent = ''; return; }
        var m = monthOf(studentId, draft.date);
        info.textContent = P().label(m, t.slice(0, 7)) + ' · ' + P().remainText(m) + (draft.status === 'absent' ? ' · 당일취소도 1회 차감돼요' : '');
      }
      paint();
      ui.sheet({
        title: '지난 날짜로 기록', sub: student.name, autofocus: false,
        content: h('div', null,
          h('div', { class: 'field-row' }, ui.field('날짜', dateIn), ui.field('시각', timeIn)),
          ui.field('기록', seg), info,
          h('p', { class: 'small muted' }, '서명 없이 ‘직접 입력’으로 남아요. 출석은 [QR 찍고 서명]을 써 주세요.')),
        actions: [
          { label: '취소', kind: 'ghost', onClick: function () { fin(null); } },
          {
            label: '기록', kind: 'primary', onClick: async function () {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '') || draft.date > t) { ui.toast('오늘이나 지난 날짜를 골라 주세요', { kind: 'warn' }); return false; }
              if (!/^\d{1,2}:\d{2}/.test(draft.start || '')) { ui.toast('시각을 골라 주세요', { kind: 'warn' }); return false; }
              var start = draft.start.slice(0, 5); if (start.length === 4) start = '0' + start;
              var ex = useExtra(student, draft.date, start, '');
              var savedEx = (await DA.store.put('exceptions', ex)) || ex;
              var occ = findOcc(draft.date, savedEx.id) || occFromExtra(savedEx);
              var rec = {
                id: key(draft.date, savedEx.id, studentId), date: draft.date, srcId: savedEx.id, studentId: studentId,
                status: draft.status, method: 'manual', signedAt: null, signature: null,
                note: draft.status === 'absent' ? ABSENT_NOTE : '', progress: null, snap: snapOf(occ)
              };
              var saved = (await DA.store.put('attendance', rec)) || rec;
              ui.haptic('success');
              ui.toast(student.name + ' ' + U.fmtDate(draft.date) + ' ' + (draft.status === 'absent' ? '당일취소' : '출석') + ' 기록', { kind: 'ok' });
              fin(saved);
            }
          }
        ],
        onClose: function () { fin(null); }
      });
    });
  };

  // 학생 고르기: 이번 달 이용권이 남은 재원생 → 재원생 → 나머지
  A.pickPassStudent = function (title) {
    var t = today(), ym = t.slice(0, 7);
    function rank(s) {
      if ((s.status || 'active') !== 'active') return 3;
      var m = P().month(data(), s.id, ym);
      if (m.status === 'ok') return 0;
      if (m.status === 'empty' || m.status === 'over') return 1;
      return 2;
    }
    return ui.pickStudent({
      title: title || '누가 출석하나요?',
      filter: function (s) { return s.status !== 'left'; },
      sort: function (a, b) { return rank(a) - rank(b); },
      sub: function (s) {
        var m = P().month(data(), s.id, ym), prod = productOf(s);
        return (prod ? prod.name + ' · ' : '') + P().label(m, ym);
      },
      badge: function (s) {
        var m = P().month(data(), s.id, ym);
        if (m.status === 'none') return h('span', { class: 'badge pass-none' }, '미발급');
        return h('span', { class: 'badge pass-' + m.status }, P().remainText(m));
      }
    });
  };

  // [QR 출석]: 앱 안 카메라로 학원 QR 확인 → 학생 고르기 → 서명 → 출석 완료
  // QR만 찍어 확인(학원 QR이면 true). 출석 서명 전 공통 관문
  A.requireQr = async function (title) {
    if (DA.__testQrPass === true) return true;   // 기기 자동 시험 전용(CDP에서만 켤 수 있음)
    if (!DA.qr || !DA.qr.scan) { ui.toast('QR 기능을 불러오지 못했어요', { kind: 'error' }); return false; }
    if (!settings().qrToken) {
      var go = await ui.confirm('아직 학원 출석 QR을 만들지 않았어요.\n설정 → QR 출석에서 만들고 인쇄해 레슨실에 붙여 주세요.', { title: 'QR 출석', ok: 'QR 만들러 가기' });
      if (go) ui.go('#/settings?section=qr');
      return false;
    }
    var text = await DA.qr.scan({
      title: title || 'QR 출석',
      hint: '레슨실 벽의 출석 QR을 네모 칸에 맞춰 주세요',
      check: function (t2) {
        var v = P().checkQr(settings(), t2);
        if (v === 'other' && DA.rooms && DA.rooms.parseQr(t2)) return 'room';   // 연습실 QR로는 레슨 출석 안 됨
        return v;
      }
    });
    return !!text;
  };

  // v1.2: [QR 출석] 스캐너는 학원 출석 QR과 연습실 QR을 둘 다 알아본다.
  //   학원 QR → 학생 고르기 → 서명 → 출석 / 연습실 QR → 그 방의 지금 예약에서 사람 고르기 → 체크인
  function practiceOn() { return !!(DA.rooms && DA.roomsUI && ui.moduleOn('practice')); }
  A.qrAttend = async function (opts) {
    opts = opts || {};
    var student = opts.studentId ? DA.store.get('students', opts.studentId) : null;
    if (student || !practiceOn()) {
      if (opts.roomOnly) { ui.toast('연습실 기능이 꺼져 있어요', { kind: 'warn' }); return null; }
      if (!(await A.requireQr(student ? student.name + ' 님 QR 출석' : 'QR 출석'))) return null;
      var sid0 = opts.studentId || await A.pickPassStudent('QR 확인 · 누가 출석하나요?');
      if (!sid0) return null;
      return A.passSign(sid0, { viaQr: true });
    }
    var roomId = '';
    if (DA.__testQrPass === true && !opts.roomOnly) {
      // 기기 자동 시험 전용: 학원 QR 을 찍은 것으로
    } else {
      if (!DA.qr || !DA.qr.scan) { ui.toast('QR 기능을 불러오지 못했어요', { kind: 'error' }); return null; }
      if (!settings().qrToken) {
        var go = await ui.confirm('아직 학원 출석 QR을 만들지 않았어요.\n설정 → QR 출석에서 만들고 인쇄해 레슨실에 붙여 주세요.', { title: 'QR 출석', ok: 'QR 만들러 가기' });
        if (go) ui.go('#/settings?section=qr');
        return null;
      }
      var text = await DA.qr.scan({
        title: opts.roomOnly ? '연습실 QR 체크인' : 'QR 출석',
        hint: opts.roomOnly ? '연습실 문 옆의 QR을 네모 칸에 맞춰 주세요' : '레슨실 출석 QR 또는 연습실 QR을 네모 칸에 맞춰 주세요',
        check: function (t2) {
          if (!opts.roomOnly) { var v = P().checkQr(settings(), t2); if (v === 'ok' || v === 'noToken') return v; }
          var r = DA.rooms.checkQr(settings(), t2);
          if (r.verdict === 'ok') return 'ok';
          if (r.verdict === 'noRoom') return 'noRoom';
          if (opts.roomOnly && P().checkQr(settings(), t2) === 'ok') return 'lessonQr';
          return r.verdict === 'noToken' ? 'noToken' : 'other';
        }
      });
      if (!text) return null;
      var rq = DA.rooms.checkQr(settings(), text);
      if (rq.verdict === 'ok') roomId = rq.roomId;
    }
    if (roomId) return DA.roomsUI.qrCheckin(roomId);
    var sid = await A.pickPassStudent('QR 확인 · 누가 출석하나요?');
    if (!sid) return null;
    return A.passSign(sid, { viaQr: true });
  };

  // [이름으로 출석]: 학생 고르기 → 서명(‘QR로만 출석’이면 QR 먼저)
  A.nameAttend = async function () {
    return A.qrAttend({});   // v1.1.2: 이름으로 출석 없음 — 무조건 QR
    if (!(data().students || []).some(function (s) { return s.status !== 'left'; })) {
      ui.toast('먼저 수강생을 등록해 주세요', { kind: 'warn', action: { label: '수강생 탭', onClick: function () { ui.go('#/students'); } } });
      return null;
    }
    var sid = await A.pickPassStudent('누가 출석하나요?');
    if (!sid) return null;
    return A.passSign(sid, {});
  };
})(window.DA = window.DA || {});
