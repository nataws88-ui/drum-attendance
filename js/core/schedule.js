/* 드럼 출석부 — core/schedule.js
 * 반복 수업 전개(occurrence), 기대 출석 대상, 출결 상태 판정, 시간 겹침, 수강권 계산.
 * 모든 함수는 순수 함수(data를 읽기만 함). 색인은 배열 정체성을 키로 하는 WeakMap에 메모이즈한다.
 */
(function (DA) {
  'use strict';

  var U = DA.util;
  var SC = DA.schedule = {};

  var EMPTY = [];
  var EMPTY_SET = new Set();
  var REC_STATUS = { present: 1, late: 1, absent: 1, excused: 1, canceled: 1 };
  var EXTRA_KINDS = { makeup: 1, special: 1, trial: 1, walkin: 1 };
  var DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

  function arr(v) { return Array.isArray(v) ? v : EMPTY; }
  function numOr(v, d) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; }

  function memo(wm, key, build) {
    var k = Array.isArray(key) ? key : EMPTY;
    var v = wm.get(k);
    if (v === undefined) { v = build(k); wm.set(k, v); }
    return v;
  }

  // ── 색인 ──────────────────────────────────────────────
  var wmClosed = new WeakMap(), wmWd = new WeakMap(), wmExc = new WeakMap(), wmAtt = new WeakMap(),
    wmAttStu = new WeakMap(), wmStu = new WeakMap(), wmLes = new WeakMap(), wmExcId = new WeakMap(),
    wmPay = new WeakMap(), wmLesStu = new WeakMap();

  function closedSet(days) {
    if (!Array.isArray(days) || !days.length) return EMPTY_SET;
    return memo(wmClosed, days, function (a) { return new Set(a); });
  }
  function byIdOf(wm, list) {
    return memo(wm, list, function (a) {
      var m = new Map();
      for (var i = 0; i < a.length; i++) if (a[i]) m.set(a[i].id, a[i]);
      return m;
    });
  }
  function lessonsByWeekday(lessons) {
    return memo(wmWd, lessons, function (a) {
      var out = [[], [], [], [], [], [], []];
      a.forEach(function (l) {
        if (!l) return;
        var w = Number(l.weekday);
        if (w >= 0 && w <= 6 && Math.floor(w) === w) out[w].push(l);
      });
      out.forEach(function (list) {
        list.sort(function (x, y) { return U.hm2min(x.start) - U.hm2min(y.start); });
      });
      return out;
    });
  }
  function excIndex(exceptions) {
    return memo(wmExc, exceptions, function (a) {
      var m = new Map();
      a.forEach(function (e) {
        if (!e || !e.date) return;
        var slot = m.get(e.date);
        if (!slot) { slot = { cancel: new Map(), extras: [] }; m.set(e.date, slot); }
        if (e.type === 'cancel') { if (e.lessonId) slot.cancel.set(e.lessonId, e); }
        else if (e.type === 'extra') slot.extras.push(e);
      });
      return m;
    });
  }
  function attById(att) { return byIdOf(wmAtt, att); }
  function attByStudent(att) {
    return memo(wmAttStu, att, function (a) {
      var m = new Map();
      a.forEach(function (r) {
        if (!r || !r.studentId) return;
        var list = m.get(r.studentId);
        if (!list) { list = []; m.set(r.studentId, list); }
        list.push(r);
      });
      m.forEach(function (list) {
        list.sort(function (x, y) {
          if (x.date !== y.date) return x.date < y.date ? -1 : 1;
          return U.hm2min(x.snap && x.snap.start) - U.hm2min(y.snap && y.snap.start);
        });
      });
      return m;
    });
  }
  function paymentsByStudent(pays) {
    return memo(wmPay, pays, function (a) {
      var m = new Map();
      a.forEach(function (p) {
        if (!p || !p.studentId) return;
        var list = m.get(p.studentId);
        if (!list) { list = []; m.set(p.studentId, list); }
        list.push(p);
      });
      m.forEach(function (list) { list.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; }); });
      return m;
    });
  }
  function lessonsByStudent(lessons) {
    return memo(wmLesStu, lessons, function (a) {
      var m = new Map();
      a.forEach(function (l) {
        if (!l) return;
        arr(l.studentIds).forEach(function (sid) {
          var list = m.get(sid);
          if (!list) { list = []; m.set(sid, list); }
          if (list.indexOf(l) < 0) list.push(l);
        });
      });
      return m;
    });
  }

  function cfg(data) {
    var s = (data && data.settings) || {};
    return {
      weekStart: Number(s.weekStart) === 0 ? 0 : 1,
      lateGraceMin: numOr(s.lateGraceMin, 10),
      signWindowBeforeMin: numOr(s.signWindowBeforeMin, 60),
      autoAbsentPast: s.autoAbsentPast !== false,
      deductAbsentFromPass: !!s.deductAbsentFromPass,
      closed: closedSet(s.closedDays)
    };
  }

  function nowInfo(now) {
    var d = U.toDate(now);
    if (isNaN(d.getTime())) d = new Date();
    return { ms: d.getTime(), ymd: U.ymd(d), date: d };
  }

  // 다른 모듈에서도 쓰는 색인(추가 API) — 인자는 data
  SC.index = {
    studentsById: function (data) { return byIdOf(wmStu, data && data.students); },
    lessonsById: function (data) { return byIdOf(wmLes, data && data.lessons); },
    exceptionsById: function (data) { return byIdOf(wmExcId, data && data.exceptions); },
    attendanceById: function (data) { return attById(data && data.attendance); },
    attendanceByStudent: function (data) { return attByStudent(data && data.attendance); },
    paymentsByStudent: function (data) { return paymentsByStudent(data && data.payments); },
    lessonsByStudent: function (data) { return lessonsByStudent(data && data.lessons); },
    lessonsByWeekday: function (data) { return lessonsByWeekday(data && data.lessons); }
  };

  // ── occurrence ────────────────────────────────────────
  function endOf(start, dur) { return U.min2hm(U.hm2min(start) + dur); }

  // 수업·예외 객체는 바뀔 때 새 객체로 교체되므로 객체 정체성으로 시각 계산을 캐시한다
  var wmMeta = new WeakMap();
  function timeMeta(x) {
    var m = wmMeta.get(x);
    if (!m) {
      var dur = numOr(x.duration, 0);
      var start = x.start || '00:00';
      var sm = U.hm2min(start);
      m = { start: start, startMin: sm, endMin: sm + dur, end: U.min2hm(sm + dur), duration: dur };
      wmMeta.set(x, m);
    }
    return m;
  }

  function lessonOcc(l, date, cx, closed) {
    var t = timeMeta(l);
    var canceled = !!(closed || cx);
    var o = {
      key: date + '|' + l.id, date: date, srcId: l.id, srcType: 'lesson', kind: 'regular',
      start: t.start, end: t.end, duration: t.duration, startMin: t.startMin, endMin: t.endMin,
      teacherId: l.teacherId || '', roomId: l.roomId || '', title: l.title || '',
      studentIds: arr(l.studentIds),
      canceled: canceled,
      cancelReason: canceled ? ((cx && cx.reason) || (closed ? '휴원일' : '휴강')) : '',
      closedDay: !!closed,
      lessonId: l.id
    };
    if (cx) o.exceptionId = cx.id;
    return o;
  }

  function extraOcc(e, date) {
    var t = timeMeta(e);
    return {
      key: date + '|' + e.id, date: date, srcId: e.id, srcType: 'extra',
      kind: EXTRA_KINDS[e.kind] ? e.kind : 'special',
      start: t.start, end: t.end, duration: t.duration, startMin: t.startMin, endMin: t.endMin,
      teacherId: e.teacherId || '', roomId: e.roomId || '', title: e.title || '',
      studentIds: arr(e.studentIds),
      canceled: false, cancelReason: '', closedDay: false,
      exceptionId: e.id,
      makeupFor: e.makeupFor || null
    };
  }

  function startMinOf(o) { return o.startMin != null ? o.startMin : U.hm2min(o.start); }
  function cmpOcc(a, b) {
    var d = startMinOf(a) - startMinOf(b);
    if (d) return d;
    if (a.srcType !== b.srcType) return a.srcType === 'lesson' ? -1 : 1;
    return a.srcId < b.srcId ? -1 : a.srcId > b.srcId ? 1 : 0;
  }

  function buildDay(ymd, wd, c, byWd, exIdx) {
    var out = [];
    var closed = c.closed.has(ymd);
    var ex = exIdx.get(ymd);
    var list = byWd[wd];
    for (var i = 0; i < list.length; i++) {
      var l = list[i];
      if (l.startDate && ymd < l.startDate) continue;
      if (l.endDate && ymd > l.endDate) continue;
      out.push(lessonOcc(l, ymd, ex ? (ex.cancel.get(l.id) || null) : null, closed));
    }
    // extra(보강·특강·체험·명단 외)는 날짜를 콕 집어 만든 수업이라 휴원일이어도 휴강 처리하지 않는다
    if (ex) for (var j = 0; j < ex.extras.length; j++) out.push(extraOcc(ex.extras[j], ymd));
    if (out.length > 1) out.sort(cmpOcc);
    return out;
  }

  SC.occurrencesOn = function (data, ymd) {
    if (!U.isYmd(ymd)) return [];
    var c = cfg(data);
    return buildDay(ymd, U.weekday(ymd), c, lessonsByWeekday(data && data.lessons), excIndex(data && data.exceptions));
  };

  SC.occurrencesBetween = function (data, from, to) {
    if (!U.isYmd(from) || !U.isYmd(to) || from > to) return [];
    var c = cfg(data);
    var byWd = lessonsByWeekday(data && data.lessons), exIdx = excIndex(data && data.exceptions);
    var days = U.rangeDays(from, to);
    var wd = U.weekday(from), out = [];
    for (var i = 0; i < days.length; i++) {
      var d = buildDay(days[i], wd, c, byWd, exIdx);
      for (var j = 0; j < d.length; j++) out.push(d[j]);
      wd = (wd + 1) % 7;
    }
    return out;
  };

  // 특정 날짜·출처의 회차(없으면 null) — 추가 API
  SC.occurrence = function (data, date, srcId) {
    var list = SC.occurrencesOn(data, date);
    for (var i = 0; i < list.length; i++) if (list[i].srcId === srcId) return list[i];
    return null;
  };

  // 기록 시점 수업 정보(Attendance.snap) — 추가 API
  SC.snapOf = function (occ) {
    return {
      start: occ.start, duration: occ.duration, teacherId: occ.teacherId || '',
      roomId: occ.roomId || '', kind: occ.kind || 'regular'
    };
  };

  // 기록 → 회차(수업이 남아 있으면 실제 회차, 지워졌으면 snap으로 재구성) — 추가 API
  function snapOcc(data, rec) {
    var sn = rec.snap || {};
    var lesson = SC.index.lessonsById(data).get(rec.srcId);
    var ex = SC.index.exceptionsById(data).get(rec.srcId);
    var src = lesson || (ex && ex.type === 'extra' ? ex : null);
    var kind = sn.kind || (ex && ex.type === 'extra' ? (EXTRA_KINDS[ex.kind] ? ex.kind : 'special') : 'regular');
    if (kind !== 'regular' && !EXTRA_KINDS[kind]) kind = 'regular';
    var start = sn.start || (src && src.start) || '00:00';
    var dur = numOr(sn.duration, numOr(src && src.duration, 0));
    var sm = U.hm2min(start);
    var o = {
      key: rec.date + '|' + rec.srcId, date: rec.date, srcId: rec.srcId,
      srcType: kind === 'regular' ? 'lesson' : 'extra', kind: kind,
      start: start, end: U.min2hm(sm + dur), duration: dur, startMin: sm, endMin: sm + dur,
      teacherId: sn.teacherId != null ? sn.teacherId : ((src && src.teacherId) || ''),
      roomId: sn.roomId != null ? sn.roomId : ((src && src.roomId) || ''),
      title: (src && src.title) || '',
      studentIds: [rec.studentId],
      canceled: false, cancelReason: '', closedDay: false,
      missing: !src, reconstructed: true
    };
    if (lesson) o.lessonId = lesson.id;
    if (ex) o.exceptionId = ex.id;
    return o;
  }
  SC.occForRecord = function (data, rec) {
    if (!rec) return null;
    return SC.occurrence(data, rec.date, rec.srcId) || snapOcc(data, rec);
  };

  // ── 기대 출석 대상 ────────────────────────────────────
  SC.isStudentExpected = function (student, ymd) {
    if (!student || !ymd) return false;
    if (student.joinDate && ymd < student.joinDate) return false;
    if (student.leftDate && ymd > student.leftDate) return false;
    if (student.status === 'left' && !student.leftDate) return false;
    var pauses = arr(student.pauses), openPause = false;
    for (var i = 0; i < pauses.length; i++) {
      var p = pauses[i];
      if (!p || !p.from) continue;
      if (!p.to) openPause = true;
      if (ymd >= p.from && (!p.to || ymd <= p.to)) return false;
    }
    // 휴원 상태인데 진행 중인 휴원 구간이 없으면(구간 기록 누락) 기대 대상에서 뺀다
    if (student.status === 'paused' && !openPause) return false;
    return true;
  };

  SC.expectedStudents = function (data, occ) {
    var ids = arr(occ && occ.studentIds);
    if (!ids.length) return [];
    var byId = SC.index.studentsById(data);
    var out = [], seen = ids.length > 1 ? new Set() : null;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (seen) { if (seen.has(id)) continue; seen.add(id); }
      var s = byId.get(id);
      if (s && SC.isStudentExpected(s, occ.date)) out.push(id);
    }
    return out;
  };

  // ── 상태 판정 ─────────────────────────────────────────
  function statusOf(occ, rec, c, nw) {
    if (rec) return { status: REC_STATUS[rec.status] ? rec.status : 'unmarked', record: rec, auto: false };
    if (occ.canceled) return { status: 'canceled', record: null, auto: false };
    if (occ.date < nw.ymd) {
      return c.autoAbsentPast ? { status: 'absent', record: null, auto: true } : { status: 'unmarked', record: null, auto: false };
    }
    if (occ.date > nw.ymd) return { status: 'upcoming', record: null, auto: false };
    var openMs = U.at(occ.date, occ.start).getTime() - c.signWindowBeforeMin * 60000;
    return { status: nw.ms >= openMs ? 'pending' : 'upcoming', record: null, auto: false };
  }

  SC.effectiveStatus = function (data, occ, studentId, now) {
    var rec = attById(data && data.attendance).get(occ.date + '|' + occ.srcId + '|' + studentId) || null;
    return statusOf(occ, rec, cfg(data), nowInfo(now));
  };

  SC.statusForSign = function (occ, signedAt, settings) {
    var grace = numOr(settings && settings.lateGraceMin, 10);
    var t = U.toDate(signedAt).getTime();
    return t > U.at(occ.date, occ.start).getTime() + grace * 60000 ? 'late' : 'present';
  };

  SC.signWindowOpen = function (occ, now, settings) {
    if (!occ || occ.canceled) return false;
    var nw = nowInfo(now);
    if (nw.ymd !== occ.date) return false;
    var before = numOr(settings && settings.signWindowBeforeMin, 60);
    return nw.ms >= U.at(occ.date, occ.start).getTime() - before * 60000;
  };

  // ── 행(occurrence × 학생) ─────────────────────────────
  function normFilter(f) {
    if (!f) return null;
    var o = {}, any = false;
    ['studentId', 'teacherId', 'courseId', 'levelId', 'roomId'].forEach(function (k) {
      if (f[k] != null && f[k] !== '') { o[k] = String(f[k]); any = true; }
    });
    if (Array.isArray(f.kinds) && f.kinds.length) {
      o.kinds = {};
      f.kinds.forEach(function (k) { o.kinds[k] = true; });
      any = true;
    }
    return any ? o : null;
  }
  function occPass(f, occ) {
    if (f.teacherId && (occ.teacherId || '') !== f.teacherId) return false;
    if (f.roomId && (occ.roomId || '') !== f.roomId) return false;
    if (f.kinds && !f.kinds[occ.kind]) return false;
    return true;
  }
  function studentPass(f, sid, s) {
    if (f.studentId && sid !== f.studentId) return false;
    if (f.courseId && (!s || (s.courseId || '') !== f.courseId)) return false;
    if (f.levelId && (!s || (s.levelId || '') !== f.levelId)) return false;
    return true;
  }

  SC.rows = function (data, from, to, now, filter) {
    var out = [];
    if (!U.isYmd(from) || !U.isYmd(to) || from > to) return out;
    var f = normFilter(filter);
    var c = cfg(data), nw = nowInfo(now);
    var byId = SC.index.studentsById(data);
    var attIdx = attById(data && data.attendance);
    var occs = SC.occurrencesBetween(data, from, to);
    var matched = new Set(), occMap = null;
    var hasAtt = attIdx.size > 0;

    for (var i = 0; i < occs.length; i++) {
      var occ = occs[i];
      var ids = occ.studentIds;
      if (!ids.length) continue;
      var pass = !f || occPass(f, occ);
      var seen = ids.length > 1 ? new Set() : null;
      for (var j = 0; j < ids.length; j++) {
        var sid = ids[j];
        if (seen) { if (seen.has(sid)) continue; seen.add(sid); }
        var s = byId.get(sid);
        if (!s || !SC.isStudentExpected(s, occ.date)) continue;
        var key = occ.key + '|' + sid;
        var rec = hasAtt ? (attIdx.get(key) || null) : null;
        if (rec) matched.add(key);
        if (!pass || (f && !studentPass(f, sid, s))) continue;
        var status, auto = false;
        if (rec) status = REC_STATUS[rec.status] ? rec.status : 'unmarked';
        else if (occ.canceled) status = 'canceled';
        else if (occ.date < nw.ymd) { status = c.autoAbsentPast ? 'absent' : 'unmarked'; auto = c.autoAbsentPast; }
        else if (occ.date > nw.ymd) status = 'upcoming';
        else status = statusOf(occ, null, c, nw).status;
        out.push({ date: occ.date, occ: occ, studentId: sid, status: status, record: rec, auto: auto, orphan: false });
      }
    }

    // 기대 목록에 없는 기록(수업이 지워졌거나 학생이 빠진 경우)
    var orphans = 0;
    if (hasAtt) {
      var att = arr(data.attendance);
      for (var k = 0; k < att.length; k++) {
        var r = att[k];
        if (!r || !r.date || r.date < from || r.date > to) continue;
        if (matched.has(r.id)) continue;
        if (!occMap) {
          occMap = new Map();
          for (var q = 0; q < occs.length; q++) occMap.set(occs[q].key, occs[q]);
        }
        var o = occMap.get(r.date + '|' + r.srcId) || snapOcc(data, r);
        if (f && (!occPass(f, o) || !studentPass(f, r.studentId, byId.get(r.studentId)))) continue;
        out.push({
          date: r.date, occ: o, studentId: r.studentId,
          status: REC_STATUS[r.status] ? r.status : 'unmarked', record: r, auto: false, orphan: true
        });
        orphans++;
      }
    }
    if (orphans) {
      out.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return cmpOcc(a.occ, b.occ);
      });
    }
    return out;
  };

  // ── 시간 겹침 ─────────────────────────────────────────
  function nameIn(list, id) {
    var a = arr(list);
    for (var i = 0; i < a.length; i++) if (a[i] && a[i].id === id) return a[i].name || '미지정';
    return '미지정';
  }

  SC.conflicts = function (data, draft, opts) {
    var out = [];
    if (!draft) return out;
    var o = opts || {};
    var ignore = new Set();
    if (o.ignoreLessonId) ignore.add(o.ignoreLessonId);
    arr(o.ignoreIds).forEach(function (id) { ignore.add(id); });
    var s1 = U.hm2min(draft.start), e1 = s1 + numOr(draft.duration, 0);
    if (!(e1 > s1)) return out;
    var settings = (data && data.settings) || {};
    var stuById = SC.index.studentsById(data);
    var draftStudents = U.uniq(arr(draft.studentIds));

    function overlaps(start, dur) {
      var s2 = U.hm2min(start), e2 = s2 + numOr(dur, 0);
      return s1 < e2 && s2 < e1;
    }
    function check(other, withObj, when, studentIds) {
      var label = SC.lessonLabel(data, other);
      var tail = ' 수업이 있어요 (' + when + ')';
      if (draft.teacherId && draft.teacherId === other.teacherId) {
        out.push({ type: 'teacher', with: withObj, message: nameIn(settings.teachers, draft.teacherId) + ': 같은 시간에 ' + label + tail });
      }
      if (draft.roomId && draft.roomId === other.roomId) {
        out.push({ type: 'room', with: withObj, message: nameIn(settings.rooms, draft.roomId) + ': 같은 시간에 ' + label + tail });
      }
      if (draftStudents.length) {
        var set = new Set(studentIds);
        draftStudents.forEach(function (sid) {
          if (!set.has(sid)) return;
          var st = stuById.get(sid);
          out.push({
            type: 'student', with: withObj, studentId: sid,
            message: ((st && st.name) || '수강생') + ': 같은 시간에 ' + label + tail
          });
        });
      }
    }

    if (draft.date) {
      var lessonsById = SC.index.lessonsById(data), excById = SC.index.exceptionsById(data);
      SC.occurrencesOn(data, draft.date).forEach(function (occ) {
        if (occ.canceled || ignore.has(occ.srcId)) return;
        if (!overlaps(occ.start, occ.duration)) return;
        var withObj = occ.srcType === 'lesson' ? lessonsById.get(occ.srcId) : excById.get(occ.srcId);
        check(occ, withObj || occ, U.fmtDate(draft.date) + ' ' + occ.start + '–' + occ.end, SC.expectedStudents(data, occ));
      });
      return out;
    }

    var wds = Array.isArray(draft.weekdays) ? draft.weekdays : [draft.weekday];
    var from = draft.startDate || '0000-01-01';
    var to = draft.endDate || '9999-12-31';
    var byWd = lessonsByWeekday(data && data.lessons);
    var liveStudent = function (sid) { var st = stuById.get(sid); return !!st && st.status !== 'left'; };
    U.uniq(wds.map(Number)).forEach(function (wd) {
      if (!(wd >= 0 && wd <= 6)) return;
      byWd[wd].forEach(function (l) {
        if (ignore.has(l.id)) return;
        if ((l.startDate || '0000-01-01') > to || (l.endDate || '9999-12-31') < from) return;
        if (!overlaps(l.start, l.duration)) return;
        var end = endOf(l.start, numOr(l.duration, 0));
        check(l, l, '매주 ' + DAY_NAMES[wd] + '요일 ' + (l.start || '') + '–' + end, arr(l.studentIds).filter(liveStudent));
      });
      arr(data && data.exceptions).forEach(function (e) {
        if (!e || e.type !== 'extra' || ignore.has(e.id)) return;
        if (!e.date || e.date < from || e.date > to || U.weekday(e.date) !== wd) return;
        if (!overlaps(e.start, e.duration)) return;
        var end = endOf(e.start, numOr(e.duration, 0));
        check(e, e, U.fmtDate(e.date) + ' ' + (e.start || '') + '–' + end, arr(e.studentIds));
      });
    });
    return out;
  };

  // ── 수업 나누기(오늘부터 적용) ────────────────────────
  // 반환: {ended, created, exceptions, attendance:{put, removeIds}, emptyEnded}
  //   exceptions: fromYmd 이후 cancel 예외를 새 수업으로 옮긴 사본(저장 필요)
  //   attendance: fromYmd 이후 이 수업 기록을 새 수업 id로 옮긴 사본(put)과 지울 옛 id
  //   emptyEnded: ended의 기간이 비었으면 true(시작 전 수업 → 나누지 말고 통째 수정 권장)
  SC.splitLesson = function (data, lesson, fromYmd) {
    var ended = Object.assign({}, lesson, { endDate: U.addDays(fromYmd, -1) });
    ended.studentIds = arr(lesson.studentIds).slice();
    var created = Object.assign({}, lesson, {
      id: U.uid(), startDate: fromYmd, endDate: lesson.endDate || ''
    });
    created.studentIds = arr(lesson.studentIds).slice();
    delete created.createdAt;
    delete created.updatedAt;
    var exMoves = arr(data && data.exceptions).filter(function (e) {
      return e && e.type === 'cancel' && e.lessonId === lesson.id && e.date >= fromYmd;
    }).map(function (e) { return Object.assign({}, e, { lessonId: created.id }); });
    var recs = arr(data && data.attendance).filter(function (r) {
      return r && r.srcId === lesson.id && r.date >= fromYmd;
    });
    return {
      ended: ended,
      created: created,
      exceptions: exMoves,
      attendance: {
        put: recs.map(function (r) {
          var n = Object.assign({}, r, { srcId: created.id });
          n.id = n.date + '|' + created.id + '|' + n.studentId;
          delete n.createdAt;
          return n;
        }),
        removeIds: recs.map(function (r) { return r.id; })
      },
      emptyEnded: !!(lesson.startDate && ended.endDate < lesson.startDate)
    };
  };

  SC.lessonLabel = function (data, x) {
    if (!x) return '수업';
    if (x.title) return x.title;
    var byId = SC.index.studentsById(data);
    var names = [];
    arr(x.studentIds).forEach(function (id) {
      var s = byId.get(id);
      if (s && s.name && names.indexOf(s.name) < 0) names.push(s.name);
    });
    if (!names.length) return '수업';
    if (names.length <= 3) return names.join(', ');
    return names.slice(0, 2).join(', ') + ' 외 ' + (names.length - 2) + '명';
  };

  // 학생의 정규 수업(ymd에 유효한 것, ymd 없으면 끝나지 않은 것 전부) — 추가 API
  SC.studentLessons = function (data, studentId, ymd) {
    var list = lessonsByStudent(data && data.lessons).get(studentId) || [];
    return list.filter(function (l) {
      if (ymd) return (!l.startDate || l.startDate <= ymd) && (!l.endDate || l.endDate >= ymd);
      return !l.endDate || l.endDate >= U.today();
    }).sort(function (a, b) {
      var wa = (Number(a.weekday) + 6) % 7, wb = (Number(b.weekday) + 6) % 7;
      return wa - wb || U.hm2min(a.start) - U.hm2min(b.start);
    });
  };

  // 지금 이후 가장 가까운(휴강 아닌) 회차 — 추가 API
  SC.nextOccurrence = function (data, studentId, now, days) {
    var nw = nowInfo(now);
    var to = U.addDays(nw.ymd, days || 35);
    var occs = SC.occurrencesBetween(data, nw.ymd, to);
    var nowMin = nw.date.getHours() * 60 + nw.date.getMinutes();
    for (var i = 0; i < occs.length; i++) {
      var o = occs[i];
      if (o.canceled) continue;
      if (o.date === nw.ymd && U.hm2min(o.end) <= nowMin) continue;
      if (SC.expectedStudents(data, o).indexOf(studentId) >= 0) return o;
    }
    return null;
  };

  // ── 수강권 ────────────────────────────────────────────
  function isAttended(st) { return st === 'present' || st === 'late'; }

  // 기록 없이 지나간(자동 결석) 회차 수: [from, until] 사이
  function autoAbsentCount(data, student, from, until) {
    if (!until || (from && from > until)) return 0;
    var c = cfg(data);
    var att = attById(data && data.attendance);
    var exIdx = excIndex(data && data.exceptions);
    var sid = student.id, count = 0;
    var lower = from || '';
    if (student.joinDate && student.joinDate > lower) lower = student.joinDate;
    (lessonsByStudent(data && data.lessons).get(sid) || []).forEach(function (l) {
      var w = Number(l.weekday);
      if (!(w >= 0 && w <= 6)) return;
      var a = l.startDate || lower;
      if (lower && lower > a) a = lower;
      if (!a) return;
      var b = l.endDate && l.endDate < until ? l.endDate : until;
      if (a > b) return;
      var d = U.addDays(a, (w - U.weekday(a) + 7) % 7);
      for (; d <= b; d = U.addDays(d, 7)) {
        if (c.closed.has(d)) continue;
        var ex = exIdx.get(d);
        if (ex && ex.cancel.has(l.id)) continue;
        if (!SC.isStudentExpected(student, d)) continue;
        if (!att.has(d + '|' + l.id + '|' + sid)) count++;
      }
    });
    arr(data && data.exceptions).forEach(function (e) {
      if (!e || e.type !== 'extra' || !e.date || e.date > until || (lower && e.date < lower)) return;
      if (arr(e.studentIds).indexOf(sid) < 0) return;
      if (!SC.isStudentExpected(student, e.date)) return;
      if (!att.has(e.date + '|' + e.id + '|' + sid)) count++;
    });
    return count;
  }

  // v1.1: 이용권은 월 단위(DA.pass). 학생 화면·통계·카드는 모두 이 값을 쓴다.
  SC.passInfo = function (data, student, refYmd, now) {
    if (DA.pass && DA.pass.info && student && student.id) return DA.pass.info(data, student, refYmd, now);
    return SC.passInfoLegacy(data, student, refYmd, now);
  };

  // v1.0 방식(학생별 월 N회·횟수권) — 옛 기록 확인용으로 남겨 둔다
  SC.passInfoLegacy = function (data, student, refYmd, now) {
    var nw = nowInfo(now);
    var ref = U.isYmd(refYmd) ? refYmd : nw.ymd;
    var pass = (student && student.pass) || { type: 'none' };
    var recs = (student && attByStudent(data && data.attendance).get(student.id)) || EMPTY;
    var mon = U.ym(ref);
    var monthUsed = 0;
    for (var i = 0; i < recs.length; i++) {
      if (recs[i].date.slice(0, 7) === mon && isAttended(recs[i].status)) monthUsed++;
    }
    var prefix = mon === U.ym(nw.ymd) ? '이번 달' : (+mon.slice(5)) + '월';

    if (pass.type === 'monthly') {
      var total = Math.max(0, Math.floor(numOr(pass.monthlyCount, 0)));
      if (!total) {
        return { type: 'monthly', label: prefix + ' ' + monthUsed + '회', used: monthUsed, total: 0, remaining: null, warn: false };
      }
      return {
        type: 'monthly', label: prefix + ' ' + monthUsed + '/' + total + '회',
        used: monthUsed, total: total, remaining: total - monthUsed, warn: monthUsed >= total
      };
    }

    if (pass.type === 'count') {
      var c = cfg(data);
      var since = U.isYmd(pass.since) ? pass.since : '';
      var bought = 0;
      (paymentsByStudent(data && data.payments).get(student.id) || EMPTY).forEach(function (p) {
        if (since && p.date < since) return;
        bought += Math.max(0, Math.floor(numOr(p.count, 0)));
      });
      var used = 0;
      for (var j = 0; j < recs.length; j++) {
        var r = recs[j];
        if (since && r.date < since) continue;
        if (isAttended(r.status) || (c.deductAbsentFromPass && r.status === 'absent')) used++;
      }
      if (c.deductAbsentFromPass && c.autoAbsentPast) {
        used += autoAbsentCount(data, student, since, U.addDays(nw.ymd, -1));
      }
      var remaining = bought - used;
      return {
        type: 'count',
        label: remaining >= 0 ? '잔여 ' + remaining + '회' : (-remaining) + '회 초과',
        used: used, total: bought, remaining: remaining, warn: remaining <= 2
      };
    }

    return { type: 'none', label: '—', used: monthUsed, total: null, remaining: null, warn: false };
  };
})(typeof window !== 'undefined' ? (window.DA = window.DA || {}) : (globalThis.DA = globalThis.DA || {}));
