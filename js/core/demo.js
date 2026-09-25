/* 드럼 출석부 — core/demo.js
 * 예시(체험) 데이터. 같은 now면 항상 같은 결과(시드 PRNG). 모든 레코드는 demo:true, id는 'demo-' 접두어.
 * v1.1: 원장님 한 명, 성인 수강생 12명(휴원 1·퇴원 1), 이용권 3종(정규반 A·B·실속반),
 * 지난 두 달 + 이번 달의 월별 발급·횟수 조정·당일 취소 결석·초과·미발급, 시간표 고정 수업 1개(화 19:00),
 * 필기체 같은 서명, 진도(BPM 상승). 오늘 이후에는 기록을 만들지 않는다(직접 서명해 보도록).
 * v1.2: 입·퇴원 이력(사유), 미납 발급 1건, 선납 묶음 2개(이번 달 만료 1 · 다음 달 이후까지 1),
 *       연습실 2개와 지난 2주·다음 1주 예약(체크인·노쇼 — 한 명은 노쇼 3회로 예약 제한), 연습실 예약은 오늘 이후도 만든다.
 */
(function (DA) {
  'use strict';

  var U = DA.util;
  var C = DA.C;
  var D = DA.demo = {};

  var SEED = 20260923;
  var SIG_W = 600, SIG_H = 220;
  var EMPTY = [];

  // ── PRNG ──────────────────────────────────────────────
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function between(r, a, b) { return a + (b - a) * r(); }
  function int(r, a, b) { return a + Math.floor(r() * (b - a + 1)); }
  function pick(r, list) { return list[Math.floor(r() * list.length)]; }
  function weighted(r, weights) {
    var x = r(), acc = 0;
    for (var i = 0; i < weights.length; i++) { acc += weights[i]; if (x < acc) return i; }
    return weights.length - 1;
  }
  function r1(x) { return Math.round(x * 10) / 10; }
  function r2(x) { return Math.round(x * 100) / 100; }

  // ── 고정 자료(v1.1: 성인 수강생, 원장님 한 명, 이용권 3종) ──────────
  var PRODUCTS = [
    ['a', '정규반 A', 4, 220000, 50, '#D9480F'],
    ['b', '정규반 B', 3, 195000, 50, '#2563EB'],
    ['s', '실속반', 4, 180000, 30, '#0D9488']
  ];
  var DEMO_TEACHER = { id: 'demo-t1', name: '홍혜윤 원장님', color: '#D9480F' };

  // key, 이름, 이용권, 출생연도, 선호 요일(0=일), 선호 시각, 특징, 메모
  var STUDENTS = [
    { k: 's01', name: '김서준', prod: 'a', born: 1991, days: [2, 4], hour: 19, tend: 'steady', memo: '평일 저녁 선호', progress: true },
    { k: 's02', name: '이하윤', prod: 'b', born: 1988, days: [1, 3, 5], hour: 11, tend: 'normal', memo: '교대 근무 — 근무표 나오면 시간 조율' },
    { k: 's03', name: '박도윤', prod: 's', born: 1995, days: [3, 6], hour: 20, tend: 'normal' },
    { k: 's04', name: '최지우', prod: 'a', born: 1994, days: [1, 4], hour: 18, tend: 'steady', join: 'thisMonth', memo: '이번 달 둘째 주 등록' },
    { k: 's05', name: '정시우', prod: 'a', born: 1990, days: [2, 5], hour: 20, tend: 'normal', noIssueNow: true, memo: '이번 달 수강료 입금 전' },
    { k: 's06', name: '강서연', prod: 'b', born: 1997, days: [1, 3], hour: 19, tend: 'steady', allNow: true },
    { k: 's07', name: '조하준', prod: 's', born: 1986, days: [2, 4, 6], hour: 21, tend: 'normal', overNow: true, memo: '야근 많음 — 전날 연락 부탁' },
    { k: 's08', name: '윤지민', prod: 'a', born: 1993, days: [2], hour: 19, tend: 'steady', fixed: true, memo: '매주 화요일 19시 고정' },
    { k: 's09', name: '장예준', prod: 'a', born: 1989, days: [3, 5], hour: 20, tend: 'normal', paused: true, memo: '해외 출장으로 휴원' },
    { k: 's10', name: '한지호', prod: 'b', born: 1992, days: [1, 4], hour: 18, tend: 'normal', left: true, memo: '이사로 퇴원' },
    { k: 's11', name: '서민재', prod: 'b', born: 1985, days: [6], hour: 14, tend: 'steady', single: true, memo: '밴드 공연 준비 — 1회권으로 필요할 때만' },
    { k: 's12', name: '오채원', prod: 's', born: 1996, days: [2, 5], hour: 20, tend: 'flaky', join: 'lastMonth', memo: '지난달 중간 등록(첫 달 일할)' }
  ];

  var SONGS = ['기본 8비트', 'Billie Jean - Michael Jackson', '한 페이지가 될 수 있게 - DAY6', 'Back in Black - AC/DC',
    '주저하는 연인들을 위해 - 잔나비', 'Superstition - Stevie Wonder'];
  var PROGRESS_MEMOS = ['8비트 안정적으로 유지', '필인 뒤 박자 복귀 연습 필요', '하이햇 오픈 타이밍 좋아짐', '메트로놈 맞춰 끝까지 완주', ''];
  var ABSENT_NOTE = '당일 취소 · 보강 불가';

  // ── 서명 ──────────────────────────────────────────────
  // 학생마다 고유한 필체(루프 있는 필기 곡선)를 정하고, 기록마다 크기·위치·기울기를 조금씩 흔든다.
  function sigStyle(key) {
    var r = rng(hash('sig:' + key));
    var words = int(r, 2, 3);
    var parts = [];
    var x = between(r, 36, 70);
    var baseY = between(r, 112, 138);
    var total = between(r, 360, 450);
    for (var k = 0; k < words; k++) {
      var width = total / words * between(r, 0.72, 0.95);
      var L = int(r, 1, k === 0 ? 2 : 3);
      var rad = width / (2 * Math.PI * L);
      parts.push({
        x0: x, y0: baseY + between(r, -8, 8), rad: rad, d: rad * between(r, 1.25, 2.0),
        v: between(r, 0.55, 1.0) * (k === 0 ? 1.25 : 1), L: L, slant: between(r, 0.18, 0.4),
        rise: between(r, -14, 10)
      });
      x += width + between(r, 14, 30);
    }
    var flourish = r() < 0.65 ? {
      x0: between(r, 40, 110), x1: between(r, 430, 560), y: between(r, 172, 196), bow: between(r, -16, 8), wave: between(r, 2, 6)
    } : null;
    return { parts: parts, flourish: flourish };
  }

  function makeSignature(style, r) {
    var s = between(r, 0.94, 1.06), dx = between(r, -10, 10), dy = between(r, -7, 7), rot = between(r, -0.035, 0.035);
    var cos = Math.cos(rot), sin = Math.sin(rot), cx = SIG_W / 2, cy = SIG_H / 2;
    function put(out, x, y, p) {
      var X = (x - cx) * s, Y = (y - cy) * s;
      var tx = cx + dx + X * cos - Y * sin + between(r, -0.7, 0.7);
      var ty = cy + dy + X * sin + Y * cos + between(r, -0.7, 0.7);
      out.push(r1(U.clamp(tx, 6, SIG_W - 6)), r1(U.clamp(ty, 6, SIG_H - 6)), r2(U.clamp(p, 0.12, 0.95)));
    }
    var strokes = [];
    style.parts.forEach(function (pt) {
      var n = 14 + pt.L * 7, out = [];
      var span = 2 * Math.PI * pt.L;
      for (var i = 0; i <= n; i++) {
        var t = i / n, th = span * t;
        var env = 0.35 + 0.65 * Math.pow(Math.sin(Math.PI * t), 0.5);
        var bx = pt.x0 + pt.rad * th - pt.d * Math.sin(th);
        var lift = pt.v * (pt.rad - pt.d * Math.cos(th)) * env * 1.6;
        var by = pt.y0 - lift + pt.rise * (t - 0.5);
        bx += lift * pt.slant;
        put(out, bx, by, 0.34 + 0.42 * Math.sin(Math.PI * t) + between(r, -0.06, 0.06));
      }
      strokes.push(out);
    });
    if (style.flourish) {
      var f = style.flourish, out2 = [], m = 16;
      for (var j = 0; j <= m; j++) {
        var u = j / m;
        put(out2, f.x0 + (f.x1 - f.x0) * u, f.y + f.bow * Math.sin(Math.PI * u) + f.wave * Math.sin(3 * Math.PI * u),
          0.7 - 0.5 * u + between(r, -0.04, 0.04));
      }
      strokes.push(out2);
    }
    return { w: SIG_W, h: SIG_H, strokes: strokes };
  }

  // ── 설정 목록 합치기 ──────────────────────────────────
  // 같은 이름의 상품이 있으면 그대로 쓰고, 없으면 예시 상품(demo:true)을 덧붙인다
  function mergeProducts(existing) {
    var list = (existing || EMPTY).slice(), byKey = {};
    PRODUCTS.forEach(function (sp) {
      var hit = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].name || '').trim() === sp[1]) { hit = list[i]; break; }
      }
      if (!hit) {
        hit = { id: 'demo-prod-' + sp[0], name: sp[1], count: sp[2], amount: sp[3], minutes: sp[4], color: sp[5], demo: true };
        list.push(hit);
      }
      byKey[sp[0]] = hit;
    });
    return { list: list, byKey: byKey };
  }

  // ── build ─────────────────────────────────────────────
  D.build = function (now, settings) {
    var nowD = U.toDate(now);
    if (isNaN(nowD.getTime())) nowD = new Date();
    var today = U.ymd(nowD);
    var base = settings || (DA.store && DA.store.defaultSettings ? DA.store.defaultSettings() : {});
    var SC = DA.schedule;
    var r = rng(SEED);

    // 설정: 강사는 있는 그대로(없으면 예시 원장님), 이용권은 같은 이름이 있으면 그대로
    var teachers = (base.teachers || EMPTY).slice();
    if (!teachers.length) teachers.push(Object.assign({ demo: true }, DEMO_TEACHER));
    var teacherId = teachers[0].id;
    var prods = mergeProducts(base.passProducts && base.passProducts.length ? base.passProducts : (DA.pass ? DA.pass.defaultProducts() : EMPTY));
    var courses = (base.courses || EMPTY).slice();
    prods.list.forEach(function (p) {
      if (!courses.some(function (c) { return c && c.id === p.id; })) {
        var c = { id: p.id, name: p.name, color: p.color };
        if (p.demo) c.demo = true;
        courses.push(c);
      }
    });
    // v1.2 연습실: 있는 연습실을 쓰고 2개보다 적으면 예시 연습실을 붙인다
    var rooms = (base.rooms || EMPTY).slice();
    var practice = rooms.filter(function (x) { return x && x.type === 'practice'; });
    [['p1', '연습실 A'], ['p2', '연습실 B']].forEach(function (x) {
      if (practice.length >= 2) return;
      if (rooms.some(function (y) { return y && y.id === 'demo-room-' + x[0]; })) return;
      var rm = { id: 'demo-room-' + x[0], name: x[1], type: 'practice', demo: true };
      rooms.push(rm); practice.push(rm);
    });
    var settingsPatch = { teachers: teachers, passProducts: prods.list, courses: courses, rooms: rooms, onboarded: true };
    var mergedSettings = Object.assign({}, base, settingsPatch);

    var m0 = U.monthStart(today), m1 = U.addMonths(m0, -1), m2 = U.addMonths(m0, -2);
    var months = [m2, m1, m0];
    var yesterday = U.addDays(today, -1);
    var dayOfMonth = +today.slice(8, 10);
    var sid = function (k) { return 'demo-' + k; };

    // 수강생(모두 성인)
    var students = STUDENTS.map(function (sp, i) {
      var rs = rng(hash('stu:' + sp.k));
      var n = i + 1, nn = (n < 10 ? '0' : '') + n;
      var join = U.addDays(m2, -int(rs, 20, 400));
      if (sp.join === 'thisMonth') { join = U.addDays(m0, 7); if (join > today) join = today; }
      if (sp.join === 'lastMonth') join = U.addDays(m1, 12);
      var st = {
        id: sid(sp.k), name: sp.name,
        phone: '010-0000-20' + nn, parentName: '', parentPhone: '',
        birth: sp.born + '-' + U.pad2(int(rs, 1, 12)) + '-' + U.pad2(int(rs, 1, 28)), school: '',
        courseId: prods.byKey[sp.prod].id, levelId: '', teacherId: teacherId,
        status: 'active', joinDate: join, leftDate: '', pauses: [],
        pass: { type: 'month' }, memo: sp.memo || '', color: '', demo: true
      };
      if (sp.paused) { st.status = 'paused'; st.pauses = [{ from: U.addDays(m1, 15), to: '' }]; }
      if (sp.left) { st.status = 'left'; st.leftDate = U.addDays(m1, 19); }
      // v1.2 입·퇴원 이력(사유 포함)
      var at = function (d) { return d + 'T01:00:00.000Z'; };
      st.history = [{ date: st.joinDate, type: 'join', reason: sp.join ? '지인 소개' : '', at: at(st.joinDate) }];
      if (sp.paused) st.history.push({ date: st.pauses[0].from, type: 'pause', reason: '해외 출장', at: at(st.pauses[0].from) });
      if (sp.left) st.history.push({ date: st.leftDate, type: 'leave', reason: '이사', at: at(st.leftDate) });
      return st;
    });
    var stuByKey = {};
    STUDENTS.forEach(function (sp, i) { stuByKey[sp.k] = students[i]; });

    // 고정 시간 수강생 한 명만 시간표에 정규 수업(나머지는 시간표 없이 횟수로)
    var lessons = [{
      id: 'demo-l01', weekday: 2, start: '19:00', duration: 50, studentIds: [sid('s08')], teacherId: teacherId,
      roomId: '', title: '', startDate: m2, endDate: '', memo: '매주 화요일 고정 레슨', demo: true
    }];
    var tmp = { settings: mergedSettings, students: students, lessons: lessons, exceptions: [], attendance: [], payments: [] };

    var exceptions = [], attendance = [], payments = [];
    var methodW = [0.5, 0.15, 0.35, 0];   // 카드, 현금, 계좌이체, 기타
    var styles = {}, progN = {};
    function styleOf(id) { return styles[id] || (styles[id] = sigStyle(id)); }
    function clampDate(d, stu) { if (d < stu.joinDate) d = stu.joinDate; if (d > today) d = today; return d; }

    function addIssue(stu, ym, prod, count, amount, off, memo, key, extra) {
      var p = {
        id: 'demo-p-' + key, studentId: stu.id, date: clampDate(U.addDays(ym, off), stu), amount: amount, count: count, months: 0,
        month: ym.slice(0, 7), productId: prod ? prod.id : '', productName: prod ? prod.name : '직접 입력',
        method: C.PAY_METHODS[weighted(r, methodW)], memo: memo || '', kind: 'issue', demo: true
      };
      if (extra) Object.assign(p, extra);
      payments.push(p);
      return p;
    }
    function addAdjust(stu, ym, delta, memo, key) {
      payments.push({
        id: 'demo-p-' + key, studentId: stu.id, date: clampDate(U.addDays(ym, 1), stu), amount: 0, count: delta, months: 0,
        month: ym.slice(0, 7), kind: 'adjust', method: '', memo: memo || '횟수 조정', demo: true
      });
    }
    function record(stu, sp, d, occ, status) {
      var rec = {
        id: d + '|' + occ.srcId + '|' + stu.id, date: d, srcId: occ.srcId, studentId: stu.id,
        status: status, method: 'manual', signedAt: null, signature: null, note: '', progress: null,
        snap: { start: occ.start, duration: occ.duration, teacherId: occ.teacherId, roomId: '', kind: occ.kind }, demo: true
      };
      if (status === 'present') {
        if (r() < 0.9) {
          rec.method = 'sign';
          rec.signedAt = new Date(U.at(d, occ.start).getTime() + int(r, -8, 6) * 60000 + int(r, 0, 59) * 1000).toISOString();
          rec.signature = makeSignature(styleOf(stu.id), r);
        }
        if (sp.progress) {
          var n = progN[stu.id] = (progN[stu.id] || 0) + 1;
          rec.progress = {
            song: SONGS[Math.floor((n - 1) / 3) % SONGS.length], book: '드럼 교본 2권 p.' + (10 + n * 2),
            bpm: Math.round(72 + n * 2 + between(r, -1.5, 1.5)), memo: pick(r, PROGRESS_MEMOS)
          };
        }
      } else {
        rec.note = ABSENT_NOTE;
      }
      return rec;
    }
    // 시간표 없이 받은 출석(= walkin 수업 + 기록)
    function addUse(stu, sp, prod, d, status) {
      var rr = rng(hash('use:' + stu.id + d));
      var start = U.pad2(sp.hour) + ':' + U.pad2(pick(rr, [0, 0, 10, 30]));
      var dur = (prod && prod.minutes) || 50;
      var ex = {
        id: 'demo-x-' + sp.k + '-' + d.replace(/-/g, ''), date: d, type: 'extra', kind: 'walkin', start: start, duration: dur,
        studentIds: [stu.id], teacherId: teacherId, roomId: '', title: '', reason: '', makeupFor: null, passUse: true, demo: true
      };
      exceptions.push(ex);
      attendance.push(record(stu, sp, d, { srcId: ex.id, start: start, duration: dur, teacherId: teacherId, kind: 'walkin' }, status));
    }
    function availDays(stu, ym, days) {
      var end = U.monthEnd(ym);
      if (end > yesterday) end = yesterday;
      var from = ym > stu.joinDate ? ym : stu.joinDate;
      if (from > end) return [];
      return U.rangeDays(from, end).filter(function (d) {
        return SC.isStudentExpected(stu, d) && (!days || days.indexOf(U.weekday(d)) >= 0);
      });
    }
    function spread(list, n) {
      if (n >= list.length) return list.slice();
      var out = [];
      for (var i = 0; i < n; i++) {
        var idx = Math.min(list.length - 1, Math.floor((i + 0.25 + r() * 0.5) * list.length / n));
        if (out.indexOf(list[idx]) < 0) out.push(list[idx]);
      }
      return out;
    }
    var P_ABSENT = { steady: 0.06, normal: 0.14, flaky: 0.3 };

    STUDENTS.forEach(function (sp) {
      var stu = stuByKey[sp.k], prod = prods.byKey[sp.prod];
      months.forEach(function (ym, mi) {
        var isNow = mi === 2, ym7 = ym.slice(0, 7), key = sp.k + '-' + ym7;
        if (stu.joinDate > U.monthEnd(ym)) return;
        if (stu.leftDate && ym > stu.leftDate) return;
        if (sp.paused && isNow) return;
        if (sp.noIssueNow && isNow) return;

        var total;
        if (sp.single) {
          total = isNow ? 2 : 1;
          for (var j = 0; j < total; j++) addIssue(stu, ym, null, 1, 65000, 2 + j * 9, '1회권', key + '-' + j);
        } else if (sp.join === 'lastMonth' && mi === 1) {
          total = 2;
          addIssue(stu, ym, null, 2, 90000, 12, '첫 달 일할 (2회)', key);
        } else {
          total = prod.count;
          var extra = null;
          // v1.2 수납 예시: 김서준 = 3개월 선납(이번 달로 끝), 강서연 = 이번 달부터 3개월 선납, 박도윤 = 이번 달 미납
          if (sp.k === 's01') extra = { groupId: 'demo-grp-s01', memo: '선납 ' + (mi + 1) + '/3' };
          if (sp.k === 's06' && isNow) extra = { groupId: 'demo-grp-s06', memo: '선납 1/3' };
          if (sp.k === 's03' && isNow) extra = { paid: false, dueDate: U.addDays(ym, 9), memo: (+ym.slice(5, 7)) + '월 ' + prod.name + ' · 나중에 받기' };
          var iss = addIssue(stu, ym, prod, prod.count, prod.amount, int(r, 0, 4), (+ym.slice(5, 7)) + '월 ' + prod.name, key, extra);
          if (sp.k === 's01') iss.date = clampDate(U.addDays(m2, 1), stu);
          if (sp.k === 's06' && isNow) {
            [1, 2].forEach(function (k) {
              var nym = U.addMonths(ym, k);
              payments.push(Object.assign({}, iss, { id: 'demo-p-' + sp.k + '-' + nym.slice(0, 7), month: nym.slice(0, 7), memo: '선납 ' + (k + 1) + '/3' }));
            });
          }
          if (sp.join === 'thisMonth' && isNow) { addAdjust(stu, ym, -1, '둘째 주 시작이라 3회만', key + '-adj'); total -= 1; }
        }

        if (sp.fixed) {
          // 매주 화요일 정규 수업: 그 달 화요일 수만큼 쓴다(5번 있는 달은 +1 조정)
          var tues = U.rangeDays(ym, U.monthEnd(ym)).filter(function (d) { return U.weekday(d) === 2 && d >= lessons[0].startDate; });
          if (tues.length > total) addAdjust(stu, ym, tues.length - total, '화요일이 ' + tues.length + '번 있는 달', key + '-adj');
          tues.filter(function (d) { return d < today; }).forEach(function (d, k) {
            var occ = SC.occurrence(tmp, d, 'demo-l01');
            if (!occ) return;
            var status = (mi === 1 && k === 1) ? 'absent' : 'present';
            attendance.push(record(stu, sp, d, { srcId: occ.srcId, start: occ.start, duration: occ.duration, teacherId: teacherId, kind: 'regular' }, status));
          });
          return;
        }

        var want;
        if (!isNow) want = total - (sp.k === 's03' && mi === 1 ? 1 : 0);
        else {
          want = Math.round(total * (dayOfMonth - 1) / U.daysInMonth(+ym.slice(0, 4), +ym.slice(5, 7)));
          if (sp.allNow) want = total;
          if (sp.overNow) want = total + 1;
        }
        var avail = availDays(stu, ym, sp.days);
        if (avail.length < want) avail = availDays(stu, ym, null);
        var dates = spread(avail, Math.min(want, avail.length));
        var absentsLeft = sp.tend === 'flaky' ? 2 : 1;
        dates.forEach(function (d, k) {
          var status = 'present';
          if (absentsLeft > 0 && k > 0 && r() < P_ABSENT[sp.tend]) { status = 'absent'; absentsLeft--; }
          addUse(stu, sp, prod, d, status);
        });
      });
    });

    // v1.2 연습실 예약: 지난 14일 ~ 앞으로 7일
    var bookings = [];
    var nowMs = nowD.getTime();
    var prRooms = practice.slice(0, 2);
    var BOOKERS = [['s01', 20, 0], ['s03', 21, 1], ['s06', 18, 0], ['s07', 22, 1], ['s12', 19, 1], ['s04', 17, 0]];
    if (prRooms.length) {
      var s12NoShow = 0;
      for (var dd = -14; dd <= 7; dd++) {
        var day = U.addDays(today, dd);
        BOOKERS.forEach(function (bk, bi) {
          var stu = stuByKey[bk[0]];
          if (!SC.isStudentExpected(stu, day) || stu.status !== 'active') return;
          var rb = rng(hash('book:' + bk[0] + day));
          var every = bk[0] === 's12' ? 2 : 3;
          if ((dd + 14 + bi) % every !== 0) return;
          var hour = bk[1] + (rb() < 0.3 ? -1 : 0);
          var start = U.pad2(hour) + ':00';
          var room = prRooms[bk[2] % prRooms.length];
          var b = {
            id: 'demo-b-' + bk[0] + '-' + day.replace(/-/g, ''), roomId: room.id, studentId: stu.id, date: day, start: start, duration: 60,
            status: 'booked', checkinAt: null, memo: '', demo: true
          };
          var startMs = U.at(day, start).getTime();
          if (startMs + 15 * 60000 < nowMs) {
            var noshow = (bk[0] === 's12' && dd >= -8 && s12NoShow < 3) || (bk[0] === 's07' && dd === -5);
            if (noshow) {
              if (bk[0] === 's12') s12NoShow++;
              b.status = 'noshow'; b.auto = true; b.noshowAt = new Date(startMs + 15 * 60000).toISOString();
            } else if (rb() < 0.08) {
              b.status = 'canceled'; b.memo = '전날 취소';
            } else {
              b.status = 'checkedin'; b.checkinAt = new Date(startMs - int(rb, 1, 9) * 60000).toISOString();
            }
          }
          bookings.push(b);
        });
      }
    }

    function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
    bookings.sort(byId);
    exceptions.sort(byId);
    attendance.sort(byId);
    payments.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : byId(a, b); });

    return {
      students: students, lessons: lessons, exceptions: exceptions,
      attendance: attendance, payments: payments, bookings: bookings, settingsPatch: settingsPatch
    };
  };

  // ── 저장·삭제 ─────────────────────────────────────────
  var KINDS = ['students', 'lessons', 'exceptions', 'attendance', 'payments', 'bookings'];

  function removeDemoRecords(store) {
    var p = Promise.resolve();
    KINDS.forEach(function (k) {
      p = p.then(function () {
        var ids = (store.data[k] || EMPTY).filter(function (x) { return x && x.demo === true; }).map(function (x) { return x.id; });
        return ids.length ? store.removeMany(k, ids) : null;
      });
    });
    return p;
  }

  D.load = function (now) {
    var store = DA.store;
    return store.open().then(function () {
      return removeDemoRecords(store);
    }).then(function () {
      var b = D.build(now || new Date(), store.data.settings);
      return store.saveSettings(b.settingsPatch)
        .then(function () { return store.putMany('students', b.students); })
        .then(function () { return store.putMany('lessons', b.lessons); })
        .then(function () { return store.putMany('exceptions', b.exceptions); })
        .then(function () { return store.putMany('attendance', b.attendance); })
        .then(function () { return store.putMany('payments', b.payments); })
        .then(function () { return store.putMany('bookings', b.bookings); })
        .then(function () {
          return {
            students: b.students.length, lessons: b.lessons.length, exceptions: b.exceptions.length,
            attendance: b.attendance.length, payments: b.payments.length, bookings: b.bookings.length
          };
        });
    });
  };

  // 예시 레코드 전부 삭제. 설정의 예시 강사·과정·레벨·방은 남은 기록이 쓰지 않으면 지우고, 쓰면 남겨 둔다.
  D.clear = function () {
    var store = DA.store;
    return store.open().then(function () {
      return removeDemoRecords(store);
    }).then(function () {
      var d = store.data, s = d.settings || {};
      var used = { teachers: new Set(), courses: new Set(), levels: new Set(), rooms: new Set(), passProducts: new Set() };
      (d.students || EMPTY).forEach(function (x) {
        used.teachers.add(x.teacherId); used.courses.add(x.courseId); used.levels.add(x.levelId);
      });
      (d.lessons || EMPTY).concat(d.exceptions || EMPTY).forEach(function (x) {
        used.teachers.add(x.teacherId); used.rooms.add(x.roomId);
      });
      (d.attendance || EMPTY).forEach(function (x) {
        if (x.snap) { used.teachers.add(x.snap.teacherId); used.rooms.add(x.snap.roomId); }
      });
      (d.bookings || EMPTY).forEach(function (x) { used.rooms.add(x.roomId); });
      var patch = {}, changed = false;
      (d.payments || EMPTY).forEach(function (p) { if (p.productId) used.passProducts.add(p.productId); });
      (d.students || EMPTY).forEach(function (x) { used.passProducts.add(x.courseId); });
      ['teachers', 'courses', 'levels', 'rooms', 'passProducts'].forEach(function (k) {
        var list = s[k] || EMPTY;
        if (!list.some(function (x) { return x && x.demo === true; })) return;
        changed = true;
        patch[k] = list.filter(function (x) { return !(x && x.demo === true) || used[k].has(x.id); })
          .map(function (x) {
            if (x && x.demo === true) { var y = Object.assign({}, x); delete y.demo; return y; }
            return x;
          });
      });
      return changed ? store.saveSettings(patch) : null;
    }).then(function () { return true; });
  };

  D.has = function () {
    var store = DA.store;
    if (!store || !store.data) return false;
    var d = store.data;
    for (var i = 0; i < KINDS.length; i++) {
      var list = d[KINDS[i]] || EMPTY;
      for (var j = 0; j < list.length; j++) if (list[j] && list[j].demo === true) return true;
    }
    var s = d.settings || {};
    return ['teachers', 'courses', 'levels', 'rooms', 'passProducts'].some(function (k) {
      return (s[k] || EMPTY).some(function (x) { return x && x.demo === true; });
    });
  };
})(typeof window !== 'undefined' ? (window.DA = window.DA || {}) : (globalThis.DA = globalThis.DA || {}));
