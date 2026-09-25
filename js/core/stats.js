/* 드럼 출석부 — core/stats.js
 * 통계(순수 함수). DA.schedule.rows() 결과 위에서 한 번 훑어 모든 분류를 만든다.
 * 출석률 = (출석+지각) / (출석+지각+결석+미확인). 공결·휴강·예정·서명 대기는 분모에서 뺀다. 분모 0이면 null.
 */
(function (DA) {
  'use strict';

  var U = DA.util;
  var SC = DA.schedule;
  var C = DA.C;
  var ST = DA.stats = {};

  var EMPTY = [];
  var SCHED = ['present', 'late', 'absent', 'excused', 'canceled', 'unmarked'];
  var ALL = SCHED.concat(['upcoming', 'pending']);
  var UNASSIGNED = '미지정';

  function arr(v) { return Array.isArray(v) ? v : EMPTY; }
  function numOr(v, d) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; }
  function isAttended(st) { return st === 'present' || st === 'late'; }

  function counter() {
    return {
      rows: 0, scheduled: 0, present: 0, late: 0, absent: 0, absentAuto: 0, excused: 0, canceled: 0,
      unmarked: 0, upcoming: 0, pending: 0, attended: 0, rate: null, lateRate: null, absentRate: null
    };
  }
  function add(c, row) {
    c.rows++;
    var st = row.status;
    if (c[st] === undefined || ALL.indexOf(st) < 0) st = 'unmarked';
    c[st]++;
    if (st === 'absent' && row.auto) c.absentAuto++;
  }
  function finish(c) {
    c.scheduled = c.present + c.late + c.absent + c.excused + c.canceled + c.unmarked;
    c.attended = c.present + c.late;
    var denom = c.attended + c.absent + c.unmarked;
    c.rate = denom ? c.attended / denom : null;
    c.lateRate = c.attended ? c.late / c.attended : null;
    c.absentRate = denom ? (c.absent + c.unmarked) / denom : null;
    return c;
  }
  function denomOf(c) { return c.present + c.late + c.absent + c.unmarked; }

  function listIndex(list) {
    var m = new Map();
    arr(list).forEach(function (x, i) { if (x && x.id != null) m.set(x.id, { item: x, order: i }); });
    return m;
  }

  // ── 데이터 전체의 가장 이른 날짜(없으면 fallback) — 추가 API ──
  ST.earliestDate = function (data, fallback) {
    var fb = U.isYmd(fallback) ? fallback : U.today();
    var min = null;
    function take(d) { if (U.isYmd(d) && (min === null || d < min)) min = d; }
    var stuById = SC.index.studentsById(data);
    arr(data && data.attendance).forEach(function (r) { if (r) take(r.date); });
    arr(data && data.exceptions).forEach(function (e) { if (e && e.type === 'extra') take(e.date); });
    arr(data && data.payments).forEach(function (p) { if (p) take(p.date); });
    arr(data && data.lessons).forEach(function (l) {
      if (!l) return;
      if (l.startDate) { take(l.startDate); return; }
      // 시작일 없는 수업: 학생 등록일을 하한으로
      arr(l.studentIds).forEach(function (sid) { var s = stuById.get(sid); if (s) take(s.joinDate); });
    });
    if (min === null || min > fb) min = fb;
    var floor = U.addDays(fb, -3660);
    if (min < floor) min = floor;
    return min;
  };

  // ── 기간 프리셋 ───────────────────────────────────────
  ST.presetRange = function (key, now, weekStart, data) {
    var t = U.today(now);
    var ws = Number(weekStart) === 0 ? 0 : 1;
    var from, to, label;
    switch (key) {
      case 'thisWeek':
        from = U.startOfWeek(t, ws); to = U.addDays(from, 6); label = '이번 주'; break;
      case 'lastWeek':
        from = U.addDays(U.startOfWeek(t, ws), -7); to = U.addDays(from, 6); label = '지난 주'; break;
      case 'lastMonth':
        from = U.addMonths(U.monthStart(t), -1); to = U.monthEnd(from); label = '지난 달'; break;
      case 'last3m':
        from = U.monthStart(U.addMonths(t, -2)); to = t; label = '최근 3개월'; break;
      case 'thisYear':
        from = t.slice(0, 4) + '-01-01'; to = t.slice(0, 4) + '-12-31'; label = '올해'; break;
      case 'all':
        from = data ? ST.earliestDate(data, t) : ''; to = t; label = '전체'; break;
      default:
        from = U.monthStart(t); to = U.monthEnd(t); label = '이번 달';
    }
    return { from: from, to: to, label: label };
  };

  // ── 학생별 전체 이력(연속 출석 등 "현재" 지표용) ─────────
  var histMemo = null;
  // rangeRows: 필터 없이 이력 전체를 덮는 기간의 행이면 다시 계산하지 않고 재사용
  function historyByStudent(data, now, todayY, rangeRows, rangeFrom, rangeTo, filtered) {
    var refs = [data.students, data.lessons, data.exceptions, data.attendance, data.settings];
    if (histMemo && histMemo.today === todayY && histMemo.refs.every(function (r, i) { return r === refs[i]; })) {
      return histMemo.map;
    }
    var from = ST.earliestDate(data, todayY);
    var rows = (!filtered && rangeFrom <= from && rangeTo >= todayY) ? rangeRows : SC.rows(data, from, todayY, now);
    var map = new Map();
    rows.forEach(function (r) {
      if (r.date > todayY) return;
      var l = map.get(r.studentId);
      if (!l) { l = []; map.set(r.studentId, l); }
      l.push(r);
    });
    histMemo = { refs: refs, today: todayY, map: map };
    return map;
  }

  function streakInfo(list) {
    var best = 0, run = 0, last = null, i, st;
    for (i = 0; i < list.length; i++) {
      st = list[i].status;
      if (isAttended(st)) { run++; if (run > best) best = run; last = list[i].date; }
      else if (st === 'absent' || st === 'unmarked') run = 0;
    }
    var streak = 0;
    for (i = list.length - 1; i >= 0; i--) {
      st = list[i].status;
      if (isAttended(st)) streak++;
      else if (st === 'absent' || st === 'unmarked') break;
    }
    var consec = 0;
    for (i = list.length - 1; i >= 0; i--) {
      st = list[i].status;
      if (st === 'absent' || st === 'unmarked') consec++;
      else if (isAttended(st)) break;
    }
    return { streak: streak, best: best, last: last, consecutiveAbsent: consec };
  }

  function noShowInfo(list, student, todayY) {
    var since = U.addDays(todayY, -29);
    if (student && student.joinDate && student.joinDate > U.addDays(todayY, -30)) return null;
    var due = 0, came = 0;
    for (var i = list.length - 1; i >= 0; i--) {
      var r = list[i];
      if (r.date < since) break;
      if (isAttended(r.status)) came++;
      else if (r.status === 'absent' || r.status === 'unmarked') due++;
    }
    return (due >= 2 && came === 0) ? due : null;
  }

  // ── 본 계산 ───────────────────────────────────────────
  ST.compute = function (data, opts, now) {
    var o = opts || {};
    var d0 = U.toDate(now);
    if (isNaN(d0.getTime())) d0 = new Date();
    var nw = d0;
    var todayY = U.ymd(nw);
    var settings = (data && data.settings) || {};
    var weekStart = Number(settings.weekStart) === 0 ? 0 : 1;
    var from = U.isYmd(o.from) ? o.from : ST.earliestDate(data, todayY);
    var to = U.isYmd(o.to) ? o.to : todayY;
    if (from > to) { var tmp = from; from = to; to = tmp; }

    var filter = {
      studentId: o.studentId || '', teacherId: o.teacherId || '', courseId: o.courseId || '',
      levelId: o.levelId || '', roomId: o.roomId || '', kinds: Array.isArray(o.kinds) ? o.kinds.slice() : []
    };
    var rows = SC.rows(data, from, to, nw, filter);

    var stuById = SC.index.studentsById(data);
    var teachers = listIndex(settings.teachers), courses = listIndex(settings.courses),
      levels = listIndex(settings.levels), rooms = listIndex(settings.rooms);
    var multiYear = from.slice(0, 4) !== to.slice(0, 4);

    // 기간 안 모든 달·주·날을 미리 만든다
    var monthMap = new Map(), weekMap = new Map(), dayMap = new Map();
    for (var m = U.monthStart(from); m <= to; m = U.addMonths(m, 1)) {
      var mc = counter();
      mc.ym = m.slice(0, 7);
      mc.label = multiYear ? m.slice(2, 4) + '년 ' + (+m.slice(5, 7)) + '월' : (+m.slice(5, 7)) + '월';
      mc.lessons = 0; mc._occ = new Set();
      monthMap.set(mc.ym, mc);
    }
    for (var w = U.startOfWeek(from, weekStart); w <= to; w = U.addDays(w, 7)) {
      var wc = counter();
      wc.weekStart = w;
      wc.label = (+w.slice(5, 7)) + '/' + (+w.slice(8, 10)) + '주';
      weekMap.set(w, wc);
    }
    U.rangeDays(from, to).forEach(function (d) { var dc = counter(); dc.date = d; dayMap.set(d, dc); });

    var totals = counter();
    totals.signed = 0; totals.manual = 0; totals.makeupHeld = 0; totals.trialHeld = 0; totals.walkin = 0;
    var wdC = [0, 1, 2, 3, 4, 5, 6].map(function (i) { var c = counter(); c.weekday = i; c.label = C.WEEKDAYS[i]; return c; });
    var hourMap = new Map(), heat = new Map();
    var gT = new Map(), gC = new Map(), gL = new Map(), gR = new Map(), gK = new Map();
    var stu = new Map();
    var held = new Set(), active = new Set(), offsets = [];
    var dayInfo = new Map();   // 날짜별 요일·주 시작 캐시(행마다 날짜 계산을 반복하지 않도록)
    function infoOf(d) {
      var x = dayInfo.get(d);
      if (!x) {
        var wdd = U.weekday(d);
        x = { wd: wdd, week: U.addDays(d, -((wdd - weekStart + 7) % 7)), ym: d.slice(0, 7) };
        dayInfo.set(d, x);
      }
      return x;
    }

    function group(map, id, name, color, order) {
      var g = map.get(id);
      if (!g) {
        g = counter();
        g.id = id; g.name = name;
        if (color) g.color = color;
        g.students = 0; g.lessons = 0;
        g._stu = new Set(); g._occ = new Set(); g._order = order;
        map.set(id, g);
      }
      return g;
    }
    function known(idx, id, fallbackOrder) {
      var hit = id ? idx.get(id) : null;
      return hit ? { id: id, name: hit.item.name || UNASSIGNED, color: hit.item.color || '', order: hit.order }
        : { id: '', name: UNASSIGNED, color: '', order: fallbackOrder };
    }
    function addGroup(map, info, row, isHeld) {
      var g = group(map, info.id, info.name, info.color, info.order);
      add(g, row);
      g._stu.add(row.studentId);
      if (isHeld) g._occ.add(row.occ.key);
    }

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], occ = row.occ, st = row.status, sid = row.studentId;
      var s = stuById.get(sid);
      var att = isAttended(st);
      add(totals, row);

      var rec = row.record;
      if (rec) {
        if (rec.method === 'sign') totals.signed++;
        else if (rec.method === 'manual') totals.manual++;
        if (rec.method === 'sign' && rec.signedAt && att) {
          var sd = U.toDate(rec.signedAt);
          if (!isNaN(sd.getTime()) && U.ymd(sd) === row.date) {
            offsets.push((sd.getTime() - U.at(row.date, occ.start).getTime()) / 60000);   // 서명 기록만
          }
        }
      }
      if (att) {
        held.add(occ.key);
        if (occ.kind === 'makeup') totals.makeupHeld++;
        else if (occ.kind === 'trial') totals.trialHeld++;
        else if (occ.kind === 'walkin') totals.walkin++;
      }
      if (!row.orphan || att) active.add(sid);

      // 학생별
      var e = stu.get(sid);
      if (!e) { e = counter(); e._makeups = 0; e._signed = 0; e._manual = 0; stu.set(sid, e); }
      add(e, row);
      if (att && occ.kind === 'makeup') e._makeups++;
      if (rec && rec.method === 'sign') e._signed++;
      if (rec && rec.method === 'manual') e._manual++;

      // 요일·시간
      var di = infoOf(row.date);
      var wd = di.wd;
      add(wdC[wd], row);
      var hour = Math.floor((occ.startMin != null ? occ.startMin : U.hm2min(occ.start)) / 60);
      var hc = hourMap.get(hour);
      if (!hc) { hc = counter(); hc.hour = hour; hc.label = hour + '시'; hourMap.set(hour, hc); }
      add(hc, row);
      var hk = wd * 100 + hour;
      var cell = heat.get(hk);
      if (!cell) { cell = counter(); heat.set(hk, cell); }
      add(cell, row);

      // 강사·과정·레벨·방·종류
      addGroup(gT, known(teachers, occ.teacherId, 1e6), row, att);
      addGroup(gC, known(courses, s ? s.courseId : '', 1e6), row, att);
      addGroup(gL, known(levels, s ? s.levelId : '', 1e6), row, att);
      addGroup(gR, known(rooms, occ.roomId, 1e6), row, att);
      var kind = C.KIND[occ.kind] ? occ.kind : 'regular';
      addGroup(gK, { id: kind, name: C.KIND[kind], color: C.KIND_COLORS[kind], order: C.KIND_ORDER.indexOf(kind) }, row, att);

      // 달·주·날
      var mcell = monthMap.get(di.ym);
      if (mcell) { add(mcell, row); if (att) mcell._occ.add(occ.key); }
      var wcell = weekMap.get(di.week);
      if (wcell) add(wcell, row);
      var dcell = dayMap.get(row.date);
      if (dcell) add(dcell, row);
    }

    // ── totals ──
    finish(totals);
    totals.avgSignOffsetMin = offsets.length ? U.round1(U.avg(offsets)) : null;
    totals.onTimeRate = totals.attended ? totals.present / totals.attended : null;
    totals.activeStudents = active.size;
    totals.lessonsHeld = held.size;
    var studentFilterPass = function (s) {
      if (filter.studentId && s.id !== filter.studentId) return false;
      if (filter.courseId && (s.courseId || '') !== filter.courseId) return false;
      if (filter.levelId && (s.levelId || '') !== filter.levelId) return false;
      if (filter.teacherId && (s.teacherId || '') !== filter.teacherId) return false;
      return true;
    };
    totals.newStudents = 0;
    totals.leftStudents = 0;
    arr(data && data.students).forEach(function (s) {
      if (!s || !studentFilterPass(s)) return;
      if (s.joinDate && s.joinDate >= from && s.joinDate <= to) totals.newStudents++;
      if (s.leftDate && s.leftDate >= from && s.leftDate <= to) totals.leftStudents++;
    });

    // ── byStudent ──
    var filtered = !!(filter.studentId || filter.teacherId || filter.courseId || filter.levelId || filter.roomId || filter.kinds.length);
    var hist = historyByStudent(data, nw, todayY, rows, from, to, filtered);
    var attByStu = SC.index.attendanceByStudent(data);
    var makeupsFor = new Map();
    arr(data && data.exceptions).forEach(function (ex) {
      if (!ex || ex.type !== 'extra' || ex.kind !== 'makeup') return;
      var inRange = (ex.date >= from && ex.date <= to) ||
        (ex.makeupFor && ex.makeupFor.date && ex.makeupFor.date >= from && ex.makeupFor.date <= to);
      if (!inRange) return;
      U.uniq(arr(ex.studentIds)).forEach(function (id) { makeupsFor.set(id, (makeupsFor.get(id) || 0) + 1); });
    });

    var byStudent = [];
    stu.forEach(function (c, sid) {
      finish(c);
      var s = stuById.get(sid);
      var h = streakInfo(hist.get(sid) || EMPTY);
      var recs = attByStu.get(sid) || EMPTY;
      var lastProgress = null, bpmFirst = null, bpmLast = null;
      for (var k = 0; k < recs.length; k++) {
        var r = recs[k];
        if (r.date > to) break;
        var p = r.progress;
        if (!p) continue;
        if (p.song || p.book || p.memo || p.bpm) lastProgress = { date: r.date, song: p.song || '', book: p.book || '', bpm: numOr(p.bpm, null), memo: p.memo || '' };
        var bpm = numOr(p.bpm, 0);
        if (bpm > 0) {
          bpmLast = bpm;
          if (r.date >= from && bpmFirst === null) bpmFirst = bpm;
        }
      }
      var courseI = known(courses, s ? s.courseId : '', 0), levelI = known(levels, s ? s.levelId : '', 0),
        teacherI = known(teachers, s ? s.teacherId : '', 0);
      var e = {
        studentId: sid,
        name: s ? s.name : '(삭제된 수강생)',
        courseId: s ? (s.courseId || '') : '', levelId: s ? (s.levelId || '') : '', teacherId: s ? (s.teacherId || '') : '',
        courseName: courseI.name, levelName: levelI.name, teacherName: teacherI.name,
        status: s ? (s.status || 'active') : 'deleted',
        color: (s && s.color) || '',
        rows: c.rows, scheduled: c.scheduled, present: c.present, late: c.late, absent: c.absent, absentAuto: c.absentAuto,
        excused: c.excused, canceled: c.canceled, unmarked: c.unmarked, upcoming: c.upcoming, pending: c.pending,
        attended: c.attended, rate: c.rate, lateRate: c.lateRate, absentRate: c.absentRate,
        signed: c._signed, manual: c._manual, makeups: c._makeups,
        streak: h.streak, bestStreak: h.best, lastAttended: h.last, consecutiveAbsent: h.consecutiveAbsent,
        makeupOwed: Math.max(0, c.absent + c.excused - (makeupsFor.get(sid) || 0)),
        pass: s ? SC.passInfo(data, s, todayY, nw) : { type: 'none', label: '—', used: 0, total: null, remaining: null, warn: false },
        avgBpm: bpmLast,
        bpmFirst: bpmFirst,
        lastProgress: lastProgress
      };
      e._noShow = s ? noShowInfo(hist.get(sid) || EMPTY, s, todayY) : null;
      byStudent.push(e);
    });
    byStudent.sort(function (a, b) { return U.collate(a.name, b.name) || (a.studentId < b.studentId ? -1 : 1); });

    // ── 주의 학생 / 칭찬 학생 ──
    var atRisk = [], stars = [];
    byStudent.forEach(function (e) {
      var noShow = e._noShow;
      delete e._noShow;
      if (e.status !== 'active') return;
      var reasons = [], score = 0;
      if (e.consecutiveAbsent >= 2) {
        reasons.push({ code: 'consecutiveAbsent', text: e.consecutiveAbsent + '회 연속 결석' });
        score += 20 + 10 * e.consecutiveAbsent;
      }
      if (noShow) {
        var daysSince = e.lastAttended ? U.diffDays(e.lastAttended, todayY) : null;
        reasons.push({ code: 'noShow30', text: daysSince != null ? daysSince + '일째 출석 없음' : '30일 넘게 출석 없음' });
        score += 30;
      }
      var denom = e.attended + e.absent + e.unmarked;
      if (e.rate !== null && denom >= 4 && e.rate < 0.7) {
        reasons.push({ code: 'lowRate', text: '출석률 ' + U.pct(e.rate) });
        score += Math.round((0.7 - e.rate) * 100) + 10;
      }
      if (e.pass && e.pass.type === 'month' && e.pass.warn) {
        var pst = e.pass.status;
        reasons.push({
          code: 'passLow',
          text: pst === 'none' ? '이번 달 이용권 미발급' : pst === 'over' ? '이번 달 ' + e.pass.over + '회 초과' : '이번 달 횟수 모두 사용'
        });
        score += pst === 'over' ? 25 : pst === 'none' ? 15 : 8;
      } else if (e.pass && e.pass.type === 'count' && e.pass.warn) {
        var rem = e.pass.remaining;
        reasons.push({
          code: 'passLow',
          text: rem > 0 ? '수강권 ' + rem + '회 남음' : rem === 0 ? '수강권 모두 사용' : '수강권 ' + (-rem) + '회 초과'
        });
        score += rem <= 0 ? 25 : 12;
      }
      if (e.makeupOwed >= 2) {
        reasons.push({ code: 'makeupOwed', text: '보강 ' + e.makeupOwed + '회 필요' });
        score += Math.min(20, 5 * e.makeupOwed);
      }
      if (reasons.length) atRisk.push({ studentId: e.studentId, name: e.name, reasons: reasons, score: score });

      var perfect = denom >= 4 && e.rate === 1;
      var parts = [];
      if (e.streak >= 5) parts.push(e.streak + '회 연속 출석');
      if (perfect) parts.push('개근 (' + e.attended + '회)');
      if (parts.length) stars.push({ studentId: e.studentId, name: e.name, text: parts.join(' · '), streak: e.streak, perfect: perfect });
    });
    atRisk.sort(function (a, b) { return b.score - a.score || U.collate(a.name, b.name); });
    stars.sort(function (a, b) {
      return b.streak - a.streak || (b.perfect ? 1 : 0) - (a.perfect ? 1 : 0) || U.collate(a.name, b.name);
    });
    if (stars.length > 10) stars.length = 10;

    // ── 분류 마무리 ──
    function groups(map) {
      var out = [];
      map.forEach(function (g) {
        finish(g);
        g.students = g._stu.size;
        g.lessons = g._occ.size;
        out.push(g);
      });
      out.sort(function (a, b) { return a._order - b._order || U.collate(a.name, b.name); });
      out.forEach(function (g) { delete g._stu; delete g._occ; delete g._order; });
      return out;
    }

    var wdOrder = [];
    for (var q = 0; q < 7; q++) wdOrder.push((weekStart + q) % 7);
    var byWeekday = wdOrder.map(function (x) { return finish(wdC[x]); });

    var hours = Array.from(hourMap.keys()).sort(function (a, b) { return a - b; });
    var byHour = hours.map(function (h) { return finish(hourMap.get(h)); });

    var heatmap = {
      weekdays: wdOrder,
      labels: wdOrder.map(function (x) { return C.WEEKDAYS[x]; }),
      hours: hours,
      cells: wdOrder.map(function (x) {
        return hours.map(function (h) {
          var cc = heat.get(x * 100 + h);
          if (!cc) return { scheduled: 0, attended: 0, rate: null };
          finish(cc);
          return { scheduled: cc.scheduled, attended: cc.attended, rate: cc.rate };
        });
      })
    };

    var byMonth = [];
    monthMap.forEach(function (mc) { finish(mc); mc.lessons = mc._occ.size; delete mc._occ; byMonth.push(mc); });
    var byWeek = [];
    weekMap.forEach(function (wc) { byWeek.push(finish(wc)); });
    var byDay = [];
    dayMap.forEach(function (dc) { byDay.push(finish(dc)); });

    // ── 매출(결제일 기준) ──
    var revenue = { total: 0, count: 0, payers: 0, byMonth: [], byMethod: [], byCourse: [] };
    var revMonth = new Map();
    monthMap.forEach(function (mc, ym) {
      revMonth.set(ym, { ym: ym, label: mc.label, amount: 0, count: 0 });
    });
    var byMethod = new Map(), byCourseRev = new Map(), payers = new Set();
    // v1.1: 매출은 발급 기준 — 이용권의 대상 월(없으면 결제일의 달)이 기간의 달에 들면 넣는다. 횟수 조정은 매출 아님.
    var P = DA.pass;
    arr(data && data.payments).forEach(function (p) {
      if (!p || !U.isYmd(p.date)) return;
      if (P && P.isAdjust(p)) return;
      var rym = P ? P.revenueMonth(p) : p.date.slice(0, 7);
      if (P ? !revMonth.has(rym) : (p.date < from || p.date > to)) return;
      var s = stuById.get(p.studentId);
      if (filter.studentId && p.studentId !== filter.studentId) return;
      if ((filter.courseId || filter.levelId || filter.teacherId) && (!s || !studentFilterPass(s))) return;
      var amt = numOr(p.amount, 0);
      revenue.total += amt;
      revenue.count++;
      payers.add(p.studentId);
      var rm = revMonth.get(rym);
      if (rm) { rm.amount += amt; rm.count++; }
      var mName = p.method && String(p.method) ? String(p.method) : '기타';
      var mm = byMethod.get(mName);
      if (!mm) { mm = { name: mName, amount: 0, count: 0 }; byMethod.set(mName, mm); }
      mm.amount += amt; mm.count++;
      var ci = known(courses, s ? s.courseId : '', 1e6);
      var cr = byCourseRev.get(ci.id);
      if (!cr) { cr = { id: ci.id, name: ci.name, color: ci.color, amount: 0, count: 0, _order: ci.order }; byCourseRev.set(ci.id, cr); }
      cr.amount += amt; cr.count++;
    });
    revenue.payers = payers.size;
    revMonth.forEach(function (v) { revenue.byMonth.push(v); });
    revenue.byMethod = Array.from(byMethod.values()).sort(function (a, b) {
      var ia = C.PAY_METHODS.indexOf(a.name), ib = C.PAY_METHODS.indexOf(b.name);
      if (ia < 0) ia = 99;
      if (ib < 0) ib = 99;
      return ia - ib || b.amount - a.amount;
    });
    revenue.byCourse = Array.from(byCourseRev.values()).sort(function (a, b) { return a._order - b._order; });
    revenue.byCourse.forEach(function (x) { delete x._order; });

    // ── 이용권 금액(v1.1): 기간의 달마다 발급·사용·남은 가치 ──
    var money = null;
    if (P && P.summary) {
      var yms = [];
      monthMap.forEach(function (mc, ym) { yms.push(ym); });
      money = P.summary(data, yms, function (s0, sid) {
        if (filter.studentId && sid !== filter.studentId) return false;
        if (filter.courseId || filter.levelId || filter.teacherId) return !!s0 && studentFilterPass(s0);
        return true;
      });
      money.byMonth.forEach(function (x) { var mc = monthMap.get(x.ym); if (mc) x.label = mc.label; });
      byStudent.forEach(function (e) {
        var mm = money.byStudent[e.studentId];
        e.issuedAmount = mm ? mm.issuedAmount : 0;
        e.usedAmount = mm ? mm.usedAmount : 0;
        e.remainingValue = mm ? mm.remainingValue : 0;
        e.passUsed = mm ? mm.used : 0;
      });
    }

    var statusMix = SCHED.map(function (s) {
      return { status: s, label: C.STATUS[s], count: totals[s], ratio: totals.scheduled ? totals[s] / totals.scheduled : null };
    });

    return {
      range: { from: from, to: to, days: U.diffDays(from, to) + 1, label: U.fmtRange(from, to) },
      filter: filter,
      weekStart: weekStart,
      generatedAt: nw.toISOString(),
      totals: totals,
      byStudent: byStudent,
      byWeekday: byWeekday,
      byHour: byHour,
      byTeacher: groups(gT),
      byCourse: groups(gC),
      byLevel: groups(gL),
      byRoom: groups(gR),
      byKind: groups(gK),
      byMonth: byMonth,
      byWeek: byWeek,
      byDay: byDay,
      heatmap: heatmap,
      atRisk: atRisk,
      stars: stars,
      revenue: revenue,
      money: money,
      practice: DA.rooms && DA.rooms.summary ? DA.rooms.summary(data, from, to, nw) : null,   // v1.2 연습실 노쇼
      statusMix: statusMix
    };
  };
})(typeof window !== 'undefined' ? (window.DA = window.DA || {}) : (globalThis.DA = globalThis.DA || {}));
