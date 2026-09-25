/* 드럼 출석부 — core/rooms.js (v1.2 연습실)
 * 연습실 예약 · QR 체크인 · 노쇼 벌점 · 예약 제한. DOM 없음(node vm 테스트 가능).
 *   방: settings.rooms 의 type:'practice' (레슨실은 type:'lesson')
 *   규칙: settings.practice = {openTime, closeTime, unit(30|60), checkinBefore, checkinAfter, penaltyPerNoShow, banThreshold, banDays}
 *   예약(bookings 스토어): {id, roomId, studentId, date, start, duration, status:'booked'|'checkedin'|'noshow'|'canceled', checkinAt, noshowAt, auto, memo}
 * 체크인 허용 시간 = 시작 checkinBefore분 전 ~ 시작 checkinAfter분 후. 그때까지 체크인이 없으면 노쇼(파생 상태 → 화면을 열 때·앱을 켤 때 저장).
 * 벌점 = 노쇼 1회당 penaltyPerNoShow점(원장이 초기화한 뒤의 노쇼만). 누적이 banThreshold점에 닿으면 그 노쇼 날부터 banDays일 예약 제한(닿은 점수는 소진).
 * 연습실 QR 내용: 'DRUMQR:1:<학원 토큰>:room:<방 id>' — 학원 출석 QR과 다르다(방마다 인쇄).
 */
(function (DA) {
  'use strict';

  var U = DA.util;
  var R = DA.rooms = {};
  var EMPTY = [];
  var ROOM_MARK = ':room:';

  function arr(v) { return Array.isArray(v) ? v : EMPTY; }
  function num(v, d) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; }
  function nowMs(now) { var d = U.toDate(now); return isNaN(d.getTime()) ? Date.now() : d.getTime(); }
  function stuName(data, sid) { var s = DA.schedule.index.studentsById(data).get(sid); return s ? s.name : '(삭제된 수강생)'; }

  R.STATUS = { booked: '예약', checkedin: '체크인', noshow: '노쇼', canceled: '취소', open: '체크인 가능' };

  R.cfg = function (settings) {
    var d = DA.store && DA.store.defaultPractice ? DA.store.defaultPractice() : { openTime: '10:00', closeTime: '22:00', unit: 60, checkinBefore: 10, checkinAfter: 15, penaltyPerNoShow: 1, banThreshold: 3, banDays: 7 };
    return Object.assign(d, (settings && settings.practice) || {});
  };
  R.practiceRooms = function (settings) {
    return arr(settings && settings.rooms).filter(function (r) { return r && r.type === 'practice'; });
  };
  R.room = function (settings, id) {
    var list = arr(settings && settings.rooms);
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  };
  // 예약 칸 시각 목록
  R.slots = function (cfg) {
    var c = cfg || R.cfg(null), out = [];
    var a = U.hm2min(c.openTime), b = U.hm2min(c.closeTime), step = num(c.unit, 60) || 60;
    if (b <= a) b = a + step;
    for (var m = a; m + step <= b; m += step) out.push(U.min2hm(m));
    return out;
  };

  R.startMs = function (b) { return U.at(b.date, b.start).getTime(); };
  R.endMs = function (b) { return R.startMs(b) + num(b.duration, 60) * 60000; };
  R.endHm = function (b) { return U.min2hm(U.hm2min(b.start) + num(b.duration, 60)); };
  R.window = function (b, cfg) {
    var s = R.startMs(b), c = cfg || R.cfg(null);
    return { from: s - num(c.checkinBefore, 10) * 60000, to: s + num(c.checkinAfter, 15) * 60000 };
  };

  // 지금 보이는 상태: {status, auto} — 저장된 노쇼·체크인·취소는 그대로, 예약은 시간에 따라 open/noshow(auto)
  R.effective = function (b, now, cfg) {
    if (!b) return { status: 'canceled', auto: false };
    if (b.status === 'canceled' || b.status === 'checkedin' || b.status === 'noshow') return { status: b.status, auto: !!b.auto };
    var w = R.window(b, cfg), t = nowMs(now);
    if (t > w.to) return { status: 'noshow', auto: true };
    if (t >= w.from) return { status: 'open', auto: false };
    return { status: 'booked', auto: false };
  };
  // 체크인 가능? 'ok' | 'early' | 'late' | 'done' | 'canceled' | 'noshow'
  R.canCheckin = function (b, now, cfg) {
    if (!b) return 'canceled';
    if (b.status === 'checkedin') return 'done';
    if (b.status === 'canceled') return 'canceled';
    if (b.status === 'noshow') return 'noshow';
    var w = R.window(b, cfg), t = nowMs(now);
    if (t < w.from) return 'early';
    if (t > w.to) return 'late';
    return 'ok';
  };

  // 저장해야 할 자동 노쇼(체크인 허용 시간이 지난 예약) → 바뀐 기록 목록
  R.dueNoShows = function (data, now) {
    var cfg = R.cfg(data && data.settings), t = nowMs(now), out = [];
    arr(data && data.bookings).forEach(function (b) {
      if (!b || b.status !== 'booked') return;
      var w = R.window(b, cfg);
      if (t > w.to) out.push(Object.assign({}, b, { status: 'noshow', auto: true, noshowAt: new Date(w.to).toISOString() }));
    });
    return out;
  };

  function overlap(a, b) { return R.startMs(a) < R.endMs(b) && R.startMs(b) < R.endMs(a); }
  function live(b) { return b && b.status !== 'canceled'; }
  // 겹치는 예약: 같은 방 같은 시간 / 같은 학생 같은 시간
  R.conflicts = function (data, draft) {
    var out = [];
    arr(data && data.bookings).forEach(function (b) {
      if (!live(b) || b.id === draft.id || b.date !== draft.date) return;
      if (!overlap(b, draft)) return;
      if (b.roomId === draft.roomId) out.push({ type: 'room', booking: b, message: stuName(data, b.studentId) + ' 님이 이미 예약한 시간이에요' });
      else if (b.studentId === draft.studentId) out.push({ type: 'student', booking: b, message: '같은 시간에 다른 방을 예약했어요' });
    });
    return out;
  };

  // 벌점·예약 제한: {points(초기화 뒤 누적), total(노쇼 수), noshows:[], banUntil, banned, current(소진 뒤 남은 점수)}
  R.penalty = function (data, sid, now) {
    var cfg = R.cfg(data && data.settings);
    var stu = DA.schedule.index.studentsById(data).get(sid);
    var reset = stu && stu.practiceResetAt ? new Date(stu.practiceResetAt).getTime() : 0;
    var list = arr(data && data.bookings).filter(function (b) {
      return b && b.studentId === sid && R.effective(b, now, cfg).status === 'noshow' && R.startMs(b) > reset;
    }).sort(function (a, b) { return R.startMs(a) - R.startMs(b); });
    var per = num(cfg.penaltyPerNoShow, 1), th = num(cfg.banThreshold, 3), days = num(cfg.banDays, 7);
    var acc = 0, banUntil = '', points = 0;
    list.forEach(function (b) {
      acc += per; points += per;
      if (per > 0 && acc >= th) {
        var until = U.addDays(b.date, days);
        if (days > 0 && (!banUntil || until > banUntil)) banUntil = until;
        acc = 0;
      }
    });
    var today = U.today(now);
    return { points: points, current: acc, total: list.length, noshows: list, banUntil: banUntil, banned: !!banUntil && today <= banUntil, threshold: th };
  };

  // 예약 가능? {ok, reason, banUntil}
  R.canBook = function (data, sid, date, now) {
    var stu = DA.schedule.index.studentsById(data).get(sid);
    if (!stu) return { ok: false, reason: '수강생을 찾을 수 없어요' };
    if (stu.status === 'left') return { ok: false, reason: '퇴원한 수강생이에요' };
    var pen = R.penalty(data, sid, now);
    if (pen.banUntil && date <= pen.banUntil && U.today(now) <= pen.banUntil) {
      return { ok: false, reason: '노쇼 벌점 ' + pen.points + '점 — ' + U.fmtDate(pen.banUntil, { weekday: false }) + '까지 예약할 수 없어요', banUntil: pen.banUntil };
    }
    return { ok: true, reason: '', banUntil: '' };
  };

  // 하루 격자: {rooms, slots, cells: {roomId|HH:MM → booking}, list}
  R.day = function (data, date) {
    var s = (data && data.settings) || {};
    var cfg = R.cfg(s);
    var rooms = R.practiceRooms(s);
    var list = arr(data && data.bookings).filter(function (b) { return b && b.date === date && live(b); })
      .sort(function (a, b) { return U.hm2min(a.start) - U.hm2min(b.start); });
    var cells = {};
    list.forEach(function (b) {
      var a = U.hm2min(b.start), e = a + num(b.duration, cfg.unit);
      var unit = num(cfg.unit, 60);
      R.slots(cfg).forEach(function (hm) { var m = U.hm2min(hm); if (m < e && m + unit > a && !cells[b.roomId + '|' + hm]) cells[b.roomId + '|' + hm] = b; });
    });
    return { rooms: rooms, slots: R.slots(cfg), cells: cells, list: list, cfg: cfg };
  };

  R.forStudent = function (data, sid) {
    return arr(data && data.bookings).filter(function (b) { return b && b.studentId === sid; })
      .sort(function (a, b) { return R.startMs(b) - R.startMs(a); });
  };

  // QR로 체크인할 수 있는 지금 예약(그 방, 체크인 허용 시간 안, 아직 예약 상태)
  R.nowBookings = function (data, roomId, now) {
    var cfg = R.cfg(data && data.settings), t = nowMs(now);
    return arr(data && data.bookings).filter(function (b) {
      if (!b || b.roomId !== roomId || b.status !== 'booked') return false;
      var w = R.window(b, cfg);
      return t >= w.from && t <= w.to;
    }).sort(function (a, b) { return R.startMs(a) - R.startMs(b); });
  };

  // 기간 요약(통계·브리핑): 끝난(또는 체크인한) 예약 중 노쇼 수·노쇼율
  R.summary = function (data, from, to, now) {
    var cfg = R.cfg(data && data.settings), t = nowMs(now);
    var total = 0, checkedin = 0, noshow = 0, canceled = 0, booked = 0, per = {};
    arr(data && data.bookings).forEach(function (b) {
      if (!b || b.date < from || b.date > to) return;
      if (b.status === 'canceled') { canceled++; return; }
      booked++;
      var st = R.effective(b, t, cfg).status;
      if (st === 'checkedin') { total++; checkedin++; }
      else if (st === 'noshow') {
        total++; noshow++;
        var e = per[b.studentId] || (per[b.studentId] = { studentId: b.studentId, name: stuName(data, b.studentId), noshow: 0 });
        e.noshow++;
      }
    });
    var byStudent = Object.keys(per).map(function (k) { return per[k]; }).sort(function (a, b) { return b.noshow - a.noshow || U.collate(a.name, b.name); });
    return { from: from, to: to, booked: booked, total: total, checkedin: checkedin, noshow: noshow, canceled: canceled, rate: total ? noshow / total : null, byStudent: byStudent };
  };

  // ── QR ────────────────────────────────────────────────
  R.qrText = function (token, roomId) { return (DA.pass ? DA.pass.QR_PREFIX : 'DRUMQR:1:') + String(token || '') + ROOM_MARK + String(roomId || ''); };
  R.parseQr = function (text) {
    var t = String(text == null ? '' : text).trim();
    var pre = DA.pass ? DA.pass.QR_PREFIX : 'DRUMQR:1:';
    if (t.indexOf(pre) !== 0) return null;
    var rest = t.slice(pre.length), i = rest.indexOf(ROOM_MARK);
    if (i < 0) return null;
    var tok = rest.slice(0, i), room = rest.slice(i + ROOM_MARK.length);
    if (!/^[0-9A-Za-z_-]{6,64}$/.test(tok) || !/^[0-9A-Za-z_.:-]{1,80}$/.test(room)) return null;
    return { token: tok, roomId: room };
  };
  // {verdict:'ok'|'other'|'noToken'|'noRoom', roomId}
  R.checkQr = function (settings, text) {
    var want = settings && settings.qrToken;
    if (!want) return { verdict: 'noToken', roomId: '' };
    var q = R.parseQr(text);
    if (!q || q.token !== want) return { verdict: 'other', roomId: '' };
    var room = R.room(settings, q.roomId);
    if (!room || room.type !== 'practice') return { verdict: 'noRoom', roomId: q.roomId };
    return { verdict: 'ok', roomId: q.roomId };
  };
})(typeof window !== 'undefined' ? (window.DA = window.DA || {}) : (globalThis.DA = globalThis.DA || {}));
