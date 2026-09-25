/* 드럼 출석부 — core/store.js
 * 기기 안 저장소. IndexedDB('drum-attendance' v2)가 기본이고, 안 되면 localStorage, 그것도 없으면 메모리.
 * 모든 데이터를 open() 때 DA.store.data 로 읽어 두고, 변경은 트랜잭션 완료(oncomplete) 뒤에 캐시에 반영한다.
 * 변경 때마다 해당 배열(설정은 객체)을 새것으로 바꾼다 — 제자리 수정 금지(WeakMap 메모이즈 키가 배열 정체성).
 * v1.2: DB 버전 2 — 연습실 예약 'bookings' 스토어 추가. v1 DB는 열 때 스토어만 더하고 기존 기록은 그대로 둔다.
 */
(function (DA) {
  'use strict';

  var U = DA.util;
  var G = typeof window !== 'undefined' ? window : globalThis;

  var DB_NAME = 'drum-attendance';
  var DB_VERSION = 2;          // v1.2: bookings 스토어 추가(v1 → v2 이전: 스토어만 추가)
  var LS_KEY = 'drum-attendance-fallback';
  var KINDS = ['students', 'lessons', 'exceptions', 'attendance', 'payments', 'bookings'];
  var STORES = KINDS.concat(['meta']);
  var KIND_SET = {};
  KINDS.forEach(function (k) { KIND_SET[k] = true; });

  var LIST_KEYS = ['teachers', 'courses', 'levels', 'rooms'];

  var db = null;            // IDBDatabase (IndexedDB 모드)
  var ls = null;            // localStorage (대체 모드)
  var openPromise = null;
  var queue = Promise.resolve();
  var persistAsked = false;
  var listeners = {};
  var byIdCache = new WeakMap();

  function noop() { }

  function emptyData(settings) {
    return {
      settings: settings || defaultSettings(),
      students: [], lessons: [], exceptions: [], attendance: [], payments: [], bookings: []
    };
  }

  // ── 기본 설정 ─────────────────────────────────────────
  function baseDefaults() {
    return {
      id: 'settings',
      academyName: '드럼 학원',
      weekStart: 1,
      openTime: '10:00', closeTime: '22:00',
      slotMinutes: 30,
      defaultDuration: 50,
      lateGraceMin: 10,
      signWindowBeforeMin: 60,
      autoAbsentPast: true,
      deductAbsentFromPass: false,
      kioskPin: '',
      smsTemplate: '[{학원}] {이름} 학생이 {시각}에 출석했습니다.',
      smsEnabled: false,
      soundEnabled: true,
      closedDays: [],
      lastBackupAt: null,
      theme: 'auto',
      onboarded: false,
      simpleMode: true,          // v1.1: 지각·공결 없이 출석 O/X, 결석 = 당일 취소
      qrToken: '',               // v1.1: 학원 출석 QR 토큰(내용 DRUMQR:1:<token>)
      qrOnly: false,             // v1.1: 서명 출석 전에 QR 스캔 요구
      // v1.2
      modules: defaultModules(),  // 기능 켜기/끄기(끄면 탭·버튼만 숨고 데이터는 그대로)
      ownerPin: '',               // 원장 PIN(4~6자리). 있으면 강사 모드를 쓸 수 있다
      teacherMode: false,         // 이 기기를 강사 모드로(금액·수납·설정 숨김)
      billingSmsTemplate: DEFAULT_BILLING_SMS,
      practice: defaultPractice() // 연습실 예약 규칙
    };
  }

  var DEFAULT_BILLING_SMS = '[{학원}] {이름}님, {월} 수강료 {금액}이 아직 확인되지 않았어요. 확인 부탁드려요. ({반})';
  var MODULE_KEYS = ['timetable', 'kiosk', 'practice', 'settle', 'ask', 'progress', 'billing'];
  function defaultModules() {
    var m = {};
    MODULE_KEYS.forEach(function (k) { m[k] = true; });
    return m;
  }
  function defaultPractice() {
    return {
      openTime: '10:00', closeTime: '22:00', unit: 60,
      checkinBefore: 10, checkinAfter: 15,
      penaltyPerNoShow: 1, banThreshold: 3, banDays: 7
    };
  }
  function normalizePractice(src) {
    var d = defaultPractice(), o = Object.assign({}, d, (src && typeof src === 'object') ? src : {});
    if (!U.isHm(o.openTime)) o.openTime = d.openTime;
    if (!U.isHm(o.closeTime)) o.closeTime = d.closeTime;
    o.unit = [30, 60].indexOf(Number(o.unit)) >= 0 ? Number(o.unit) : 60;
    o.checkinBefore = num(o.checkinBefore, 10, 0, 120);
    o.checkinAfter = num(o.checkinAfter, 15, 0, 120);
    o.penaltyPerNoShow = num(o.penaltyPerNoShow, 1, 0, 10);
    o.banThreshold = num(o.banThreshold, 3, 1, 50);
    o.banDays = num(o.banDays, 7, 0, 90);
    return o;
  }

  function defaultList(key) {
    var col = (DA.C && DA.C.DEFAULT_COLORS) || ['#D9480F', '#2563EB', '#0D9488', '#9333EA', '#DB2777', '#CA8A04'];
    if (key === 'teachers') return [{ id: U.uid(), name: '홍혜윤 원장님', color: col[0] }];
    if (key === 'courses') {
      // v1.1: 과정(반) = 이용권 상품. 같은 id로 둔다.
      return defaultProducts().map(function (p) { return { id: p.id, name: p.name, color: p.color }; });
    }
    if (key === 'levels') {
      return ['입문', '초급', '중급', '고급', '전문'].map(function (n) { return { id: U.uid(), name: n }; });
    }
    if (key === 'rooms') {
      // v1.2: 방마다 종류(레슨실 lesson / 연습실 practice). 새 설치는 연습실 하나를 같이 만든다.
      return ['1번 방', '2번 방', '3번 방'].map(function (n) { return { id: U.uid(), name: n, type: 'lesson' }; })
        .concat([{ id: U.uid(), name: '연습실', type: 'practice' }]);
    }
    return [];
  }

  function defaultProducts() {
    if (DA.pass && DA.pass.defaultProducts) return DA.pass.defaultProducts();
    return [
      { id: 'prod-a', name: '정규반 A', count: 4, amount: 220000, minutes: 50, color: '#D9480F' },
      { id: 'prod-b', name: '정규반 B', count: 3, amount: 195000, minutes: 50, color: '#2563EB' },
      { id: 'prod-s', name: '실속반', count: 4, amount: 180000, minutes: 30, color: '#0D9488' }
    ];
  }

  function defaultSettings() {
    var s = baseDefaults();
    LIST_KEYS.forEach(function (k) { s[k] = defaultList(k); });
    s.passProducts = defaultProducts();
    return s;
  }

  // 이용권 상품마다 같은 id의 과정(반)이 있게 한다(이름·색은 상품을 따른다). 옛 과정은 그대로 둔다.
  function syncCourses(out) {
    var courses = out.courses.slice(), changed = false;
    out.passProducts.forEach(function (p) {
      var idx = -1;
      for (var i = 0; i < courses.length; i++) if (courses[i].id === p.id) { idx = i; break; }
      if (idx < 0) { courses.push({ id: p.id, name: p.name, color: p.color || '' }); changed = true; return; }
      var c = courses[idx];
      if (c.name !== p.name || (p.color && c.color !== p.color)) {
        courses[idx] = Object.assign({}, c, { name: p.name, color: p.color || c.color });
        changed = true;
      }
    });
    if (changed) out.courses = courses;
  }

  function num(v, def, lo, hi) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return def;
    if (lo != null && n < lo) n = lo;
    if (hi != null && n > hi) n = hi;
    return n;
  }

  // 저장된(또는 가져온) 설정을 현재 형식으로 맞춘다. 알 수 없는 필드는 그대로 둔다.
  function normalizeSettings(s) {
    var src = (s && typeof s === 'object') ? s : {};
    var out = Object.assign(baseDefaults(), src);
    out.id = 'settings';
    LIST_KEYS.forEach(function (k) {
      if (!Array.isArray(src[k])) { out[k] = defaultList(k); return; }
      var seen = {};
      out[k] = src[k].filter(function (x) { return x && typeof x === 'object'; })
        .map(function (x) {
          var y = Object.assign({}, x);
          y.id = (y.id == null || y.id === '') ? U.uid() : String(y.id);   // id 없이 추가된 항목은 id를 붙인다
          y.name = y.name == null ? '' : String(y.name);
          return y;
        })
        .filter(function (y) { if (seen[y.id]) return false; seen[y.id] = true; return true; });
    });
    out.closedDays = Array.isArray(src.closedDays)
      ? U.uniq(src.closedDays.filter(function (d) { return U.isYmd(d); })).sort()
      : [];
    out.weekStart = Number(out.weekStart) === 0 ? 0 : 1;
    out.slotMinutes = num(out.slotMinutes, 30, 5, 120);
    out.defaultDuration = num(out.defaultDuration, 50, 5, 600);
    out.lateGraceMin = num(out.lateGraceMin, 10, 0, 600);
    out.signWindowBeforeMin = num(out.signWindowBeforeMin, 60, 0, 1440);
    if (!U.isHm(out.openTime)) out.openTime = '10:00';
    if (!U.isHm(out.closeTime)) out.closeTime = '22:00';
    ['autoAbsentPast', 'deductAbsentFromPass', 'smsEnabled', 'soundEnabled', 'onboarded'].forEach(function (k) {
      out[k] = !!out[k];
    });
    out.kioskPin = out.kioskPin == null ? '' : String(out.kioskPin);
    // v1.1 이용권·QR·간단 모드(없으면 기본값 — v1.0 설정·백업도 그대로 읽는다)
    out.passProducts = Array.isArray(src.passProducts)
      ? (DA.pass && DA.pass.normalizeProducts ? DA.pass.normalizeProducts(src.passProducts) : src.passProducts.slice())
      : defaultProducts();
    syncCourses(out);
    out.simpleMode = src.simpleMode === undefined ? true : !!src.simpleMode;
    out.qrOnly = true;          // v1.1.2: 출석은 무조건 QR(원장님 요청) — 끌 수 없음
    out.qrToken = out.qrToken == null ? '' : String(out.qrToken);
    if (['auto', 'light', 'dark'].indexOf(out.theme) < 0) out.theme = 'auto';
    // v1.2 기능 켜기·권한·수납 문자·연습실(없으면 기본값 — v1.0/v1.1 설정·백업도 그대로 읽는다)
    var mods = defaultModules(), srcMods = (src.modules && typeof src.modules === 'object') ? src.modules : {};
    MODULE_KEYS.forEach(function (k) { if (srcMods[k] !== undefined) mods[k] = !!srcMods[k]; });
    Object.keys(srcMods).forEach(function (k) { if (!(k in mods)) mods[k] = srcMods[k]; });
    out.modules = mods;
    out.ownerPin = /^\d{4,6}$/.test(String(out.ownerPin == null ? '' : out.ownerPin)) ? String(out.ownerPin) : '';
    out.teacherMode = !!out.teacherMode && !!out.ownerPin;
    out.billingSmsTemplate = typeof out.billingSmsTemplate === 'string' && out.billingSmsTemplate.trim() ? out.billingSmsTemplate : DEFAULT_BILLING_SMS;
    out.practice = normalizePractice(src.practice);
    out.rooms = out.rooms.map(function (r) {
      return r.type === 'practice' || r.type === 'lesson' ? r : Object.assign({}, r, { type: 'lesson' });
    });
    out.teachers = out.teachers.map(function (t) {
      if (!t.pay || typeof t.pay !== 'object') return t;
      var pay = Object.assign({}, t.pay);
      pay.type = pay.type === 'percent' ? 'percent' : 'perLesson';
      pay.amount = Math.max(0, Math.round(num(pay.amount, 0)));
      pay.percent = num(pay.percent, 0, 0, 100);
      return Object.assign({}, t, { pay: pay });
    });
    return out;
  }

  // ── 이벤트 ────────────────────────────────────────────
  function emit(evt, payload) {
    var fns = (listeners[evt] || []).slice();
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](payload); } catch (e) {
        if (typeof console !== 'undefined' && console.error) console.error('[store] ' + evt + ' 처리 중 오류', e);
      }
    }
  }

  // ── 오류 ──────────────────────────────────────────────
  function wrapErr(e) {
    if (e && e._da) return e;
    var name = (e && e.name) || '';
    var msg;
    if (name === 'QuotaExceededError' || /quota/i.test((e && e.message) || '')) {
      msg = '저장 공간이 부족해 저장하지 못했습니다. 백업 후 오래된 기록을 정리하거나 기기 저장 공간을 확보해 주세요.';
    } else if (name === 'VersionError') {
      msg = '더 새 버전의 앱이 데이터를 사용 중입니다. 앱을 새로 고쳐 주세요.';
    } else if (name === 'InvalidStateError') {
      msg = '저장소 연결이 끊겼습니다. 앱을 다시 열어 주세요.';
    } else {
      msg = '저장하지 못했습니다' + ((e && e.message) ? ': ' + e.message : '.');
    }
    var err = new Error(msg);
    err.code = name || 'Error';
    err.cause = e;
    err._da = true;
    return err;
  }

  // ── IndexedDB ─────────────────────────────────────────
  function idbFactory() {
    try { return G.indexedDB || null; } catch (e) { return null; }
  }

  function openIDB() {
    return new Promise(function (resolve, reject) {
      var idb = idbFactory();
      if (!idb || typeof idb.open !== 'function') { reject(new Error('IndexedDB를 쓸 수 없습니다')); return; }
      var settled = false, req;
      var ms = S.OPEN_TIMEOUT_MS;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        var e = new Error('IndexedDB 열기 시간 초과');
        e.name = 'TimeoutError';
        reject(e);
      }, ms);
      try {
        req = idb.open(DB_NAME, DB_VERSION);
      } catch (e) {
        settled = true; clearTimeout(timer); reject(e); return;
      }
      req.onupgradeneeded = function (ev) {
        // v1 → v2: 없는 스토어(bookings)만 만든다. 기존 스토어·기록은 건드리지 않는다.
        var d = req.result;
        var created = [];
        STORES.forEach(function (name) {
          if (!d.objectStoreNames.contains(name)) { d.createObjectStore(name, { keyPath: 'id' }); created.push(name); }
        });
        S.upgrade = { from: (ev && typeof ev.oldVersion === 'number') ? ev.oldVersion : null, to: DB_VERSION, created: created };
      };
      req.onsuccess = function () {
        var d = req.result;
        if (settled) { try { d.close(); } catch (e) { /* 무시 */ } return; }
        settled = true;
        clearTimeout(timer);
        d.onversionchange = function () {
          // 다른 창이 DB를 지우거나 올리려 한다 → 연결을 닫아 막지 않는다. 다음 쓰기 때 다시 연다.
          try { d.close(); } catch (e) { /* 무시 */ }
          if (db === d) db = null;
          emit('versionchange', {});
        };
        d.onclose = function () { if (db === d) db = null; };
        resolve(d);
      };
      req.onerror = function (ev) {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(req.error || new Error('IndexedDB 열기 실패'));
      };
      req.onblocked = function () { emit('blocked', {}); };
    });
  }

  function getDB() {
    if (db) return Promise.resolve(db);
    return openIDB().then(function (d) { db = d; return d; });
  }

  // work(tx)는 요청을 동기적으로만 건다(트랜잭션 안에서 다른 비동기 작업을 기다리지 않는다 — 사파리 자동 커밋).
  function runTx(storeNames, mode, work, retried) {
    return getDB().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx;
        try {
          tx = d.transaction(storeNames, mode);
        } catch (e) {
          // iOS: 백그라운드 뒤 "connection is closing" → 다시 열고 한 번 더
          if (!retried && e && (e.name === 'InvalidStateError' || e.name === 'TransactionInactiveError')) {
            if (db === d) db = null;
            try { d.close(); } catch (e2) { /* 무시 */ }
            runTx(storeNames, mode, work, true).then(resolve, reject);
            return;
          }
          reject(e);
          return;
        }
        var result;
        tx.oncomplete = function () { resolve(result); };
        // 요청 오류는 기본 동작대로 트랜잭션 전체를 되돌린다(부분 저장 금지) → onabort에서 거절
        tx.onabort = function () { reject(tx.error || new Error('저장이 취소되었습니다')); };
        try {
          result = work(tx);
        } catch (e) {
          try { tx.abort(); } catch (e2) { /* 무시 */ }
          reject(e);
        }
      });
    });
  }

  function loadIDB() {
    return runTx(STORES, 'readonly', function (tx) {
      var out = {};
      STORES.forEach(function (name) {
        var r = tx.objectStore(name).getAll();
        r.onsuccess = function () { out[name] = r.result || []; };
      });
      return out;
    });
  }

  // ── localStorage ──────────────────────────────────────
  function lsProbe() {
    try {
      var s = G.localStorage;
      if (!s) return null;
      var k = '__drum_probe__';
      s.setItem(k, '1');
      s.removeItem(k);
      return s;
    } catch (e) { return null; }
  }

  function lsRead(store) {
    try {
      var raw = store.getItem(LS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return o && typeof o === 'object' ? (o.data && typeof o.data === 'object' ? o.data : o) : null;
    } catch (e) { return null; }
  }

  function lsWrite(data) {
    if (!ls) return;
    var blob = { app: 'drum-attendance', schema: 1, savedAt: U.nowIso(), data: data };
    try {
      ls.setItem(LS_KEY, JSON.stringify(blob));
    } catch (e) {
      var err = wrapErr(e);
      if (err.code !== 'QuotaExceededError' && /quota|exceed/i.test(String(e && (e.name + ' ' + e.message)))) err.code = 'QuotaExceededError';
      throw err;
    }
  }

  // ── 내부 도우미 ───────────────────────────────────────
  function checkKind(kind) {
    if (!KIND_SET[kind]) throw new Error('알 수 없는 종류: ' + kind);
  }

  function arrOf(v) { return Array.isArray(v) ? v : []; }

  function normalizeLoaded(src) {
    var o = src || {};
    var out = { settings: null };
    KINDS.forEach(function (k) {
      out[k] = arrOf(o[k]).filter(function (r) { return r && typeof r === 'object' && r.id != null && r.id !== ''; });
    });
    return out;
  }

  function prepare(kind, obj, now, keepStamps) {
    if (!obj || typeof obj !== 'object') throw new Error('저장할 내용이 없습니다');
    var rec = U.clone(obj);
    if (kind === 'attendance' && (rec.id == null || rec.id === '') && rec.date && rec.srcId && rec.studentId) {
      rec.id = S.attendanceKey(rec.date, rec.srcId, rec.studentId);
    }
    if (rec.id == null || rec.id === '') rec.id = U.uid();
    rec.id = String(rec.id);
    if (keepStamps) {
      rec.createdAt = rec.createdAt || now;
      rec.updatedAt = rec.updatedAt || now;
    } else {
      var prev = S.byId(kind).get(rec.id);
      rec.createdAt = (prev && prev.createdAt) || rec.createdAt || now;
      rec.updatedAt = now;
    }
    return rec;
  }

  // 배열을 새로 만들어 put/delete를 반영
  function applyChanges(arr, puts, dels) {
    var next = arr.slice();
    if (puts.length) {
      var idx = new Map();
      for (var i = 0; i < next.length; i++) idx.set(next[i].id, i);
      puts.forEach(function (r) {
        if (idx.has(r.id)) next[idx.get(r.id)] = r;
        else { idx.set(r.id, next.length); next.push(r); }
      });
    }
    if (dels.length) {
      var del = new Set(dels);
      next = next.filter(function (r) { return !del.has(r.id); });
    }
    return next;
  }

  function snapshotData() {
    var d = S.data, o = { settings: d.settings };
    KINDS.forEach(function (k) { o[k] = d[k]; });
    return o;
  }

  function commit(change, isUserWrite) {
    S.version++;
    emit('change', change);
    if (isUserWrite && !persistAsked) {
      persistAsked = true;
      S.requestPersist().then(noop, noop);
    }
  }

  function enqueue(fn) {
    var p = queue.then(function () { return S.open(); }).then(fn);
    queue = p.then(noop, noop);
    return p;
  }

  // 한 종류에 put/delete 묶음 쓰기 (큐 안에서만 호출)
  function writeKind(kind, puts, dels) {
    if (!puts.length && !dels.length) return Promise.resolve();
    var ids = puts.map(function (r) { return r.id; }).concat(dels);
    if (S.fallback) {
      var next = applyChanges(S.data[kind], puts, dels);
      if (ls) {
        var snap = snapshotData();
        snap[kind] = next;
        lsWrite(snap);
      }
      S.data[kind] = next;
      commit({ kind: kind, ids: ids }, true);
      return Promise.resolve();
    }
    return runTx([kind], 'readwrite', function (tx) {
      var st = tx.objectStore(kind);
      puts.forEach(function (r) { st.put(r); });
      dels.forEach(function (id) { st['delete'](id); });
    }).then(function () {
      S.data[kind] = applyChanges(S.data[kind], puts, dels);
      commit({ kind: kind, ids: ids }, true);
    }, function (e) { throw wrapErr(e); });
  }

  function writeSettings(next, isUserWrite) {
    if (S.fallback) {
      if (ls) {
        var snap = snapshotData();
        snap.settings = next;
        lsWrite(snap);
      }
      S.data.settings = next;
      commit({ kind: 'settings', ids: ['settings'] }, isUserWrite);
      return Promise.resolve(next);
    }
    return runTx(['meta'], 'readwrite', function (tx) {
      tx.objectStore('meta').put(next);
    }).then(function () {
      S.data.settings = next;
      commit({ kind: 'settings', ids: ['settings'] }, isUserWrite);
      return next;
    }, function (e) { throw wrapErr(e); });
  }

  // 전부 교체(가져오기·초기화)
  function writeAll(next) {
    if (S.fallback) {
      if (ls) lsWrite(next);
      assignAll(next);
      commit({ kind: 'all', ids: [] }, true);
      return Promise.resolve();
    }
    return runTx(STORES, 'readwrite', function (tx) {
      STORES.forEach(function (name) { tx.objectStore(name).clear(); });
      tx.objectStore('meta').put(next.settings);
      KINDS.forEach(function (k) {
        var st = tx.objectStore(k);
        next[k].forEach(function (r) { st.put(r); });
      });
    }).then(function () {
      assignAll(next);
      commit({ kind: 'all', ids: [] }, true);
    }, function (e) { throw wrapErr(e); });
  }

  function assignAll(next) {
    S.data.settings = next.settings;
    KINDS.forEach(function (k) { S.data[k] = next[k]; });
  }

  // 이전에 IndexedDB가 안 돼서 localStorage에 쌓인 기록이 있으면 IndexedDB로 옮긴다(최신 updatedAt 우선).
  function migrateFallback(loaded) {
    var store = lsProbe();
    if (!store) return Promise.resolve();
    var blob = lsRead(store);
    if (!blob) return Promise.resolve();
    var puts = {}, any = false;
    KINDS.forEach(function (k) {
      var cur = new Map();
      loaded[k].forEach(function (r) { cur.set(r.id, r); });
      arrOf(blob[k]).forEach(function (r) {
        if (!r || typeof r !== 'object' || r.id == null || r.id === '') return;
        var c = cur.get(r.id);
        if (!c || String(r.updatedAt || '') > String(c.updatedAt || '')) {
          (puts[k] = puts[k] || []).push(r);
          any = true;
        }
      });
    });
    var newSettings = null;
    if (blob.settings && typeof blob.settings === 'object' &&
      String(blob.settings.updatedAt || '') > String((loaded.settings && loaded.settings.updatedAt) || '')) {
      newSettings = normalizeSettings(blob.settings);
      any = true;
    }
    if (!any) {
      try { store.removeItem(LS_KEY); } catch (e) { /* 무시 */ }
      return Promise.resolve();
    }
    return runTx(STORES, 'readwrite', function (tx) {
      Object.keys(puts).forEach(function (k) {
        var st = tx.objectStore(k);
        puts[k].forEach(function (r) { st.put(r); });
      });
      if (newSettings) tx.objectStore('meta').put(newSettings);
    }).then(function () {
      Object.keys(puts).forEach(function (k) { loaded[k] = applyChanges(loaded[k], puts[k], []); });
      if (newSettings) loaded.settings = newSettings;
      try { store.removeItem(LS_KEY); } catch (e) { /* 무시 */ }
      S.migrated = true;
    }, function () { /* 옮기기 실패: 대체 기록은 남겨 두고 다음에 다시 시도 */ });
  }

  function openWithIDB() {
    return getDB().then(function () { return loadIDB(); }).then(function (raw) {
      var loaded = normalizeLoaded(raw);
      var metaRows = arrOf(raw.meta);
      var sRow = null;
      for (var i = 0; i < metaRows.length; i++) if (metaRows[i] && metaRows[i].id === 'settings') sRow = metaRows[i];
      var p;
      if (sRow) {
        loaded.settings = normalizeSettings(sRow);
        p = Promise.resolve();
      } else {
        // 기본 설정을 바로 저장해 둔다(기본 강사 id가 실행마다 바뀌지 않도록)
        var s = defaultSettings();
        var now = U.nowIso();
        s.createdAt = now; s.updatedAt = now;
        loaded.settings = s;
        p = runTx(['meta'], 'readwrite', function (tx) { tx.objectStore('meta').put(s); });
      }
      return p.then(function () { return migrateFallback(loaded); }).then(function () {
        S.fallback = false;
        assignAll(loaded);
      });
    });
  }

  function openWithFallback() {
    ls = lsProbe();
    var loaded;
    if (ls) {
      S.fallback = 'localStorage';
      var blob = lsRead(ls);
      loaded = normalizeLoaded(blob);
      var needSave = !(blob && blob.settings && typeof blob.settings === 'object');
      loaded.settings = normalizeSettings(needSave ? null : blob.settings);
      if (needSave) {
        var now = U.nowIso();
        loaded.settings.createdAt = now; loaded.settings.updatedAt = now;
        try { lsWrite(loaded); } catch (e) { /* 용량 부족이어도 읽기는 계속 */ }
      }
    } else {
      S.fallback = 'memory';
      loaded = normalizeLoaded(null);
      loaded.settings = normalizeSettings(null);
    }
    assignAll(loaded);
  }

  // ── 공개 API ──────────────────────────────────────────
  var S = DA.store = {
    data: emptyData(),
    version: 0,
    fallback: false,     // false(IndexedDB) | 'localStorage' | 'memory'
    ready: false,
    persisted: null,
    migrated: false,
    idbError: null,
    KINDS: KINDS.slice(),
    DB_VERSION: DB_VERSION,
    upgrade: null,       // 이번 열기에서 DB를 올렸으면 {from, to, created:[스토어]}
    OPEN_TIMEOUT_MS: 10000
  };

  S.open = function () {
    if (openPromise) return openPromise;
    openPromise = openWithIDB().catch(function (e) {
      if (db) { try { db.close(); } catch (e2) { /* 무시 */ } db = null; }
      S.idbError = (e && (e.name || e.message)) || 'IndexedDB 오류';
      openWithFallback();
    }).then(function () {
      S.ready = true;
      S.version++;
      return S;
    });
    return openPromise;
  };

  S.get = function (kind, id) {
    if (kind === 'settings') return S.data.settings;
    if (!KIND_SET[kind] || id == null) return undefined;
    return S.byId(kind).get(String(id));
  };

  S.byId = function (kind) {
    checkKind(kind);
    var arr = S.data[kind];
    var m = byIdCache.get(arr);
    if (!m) {
      m = new Map();
      for (var i = 0; i < arr.length; i++) m.set(arr[i].id, arr[i]);
      byIdCache.set(arr, m);
    }
    return m;
  };

  // 통째로 교체 저장(없는 필드는 지워짐). createdAt/updatedAt 자동.
  S.put = function (kind, obj) {
    try { checkKind(kind); } catch (e) { return Promise.reject(e); }
    return enqueue(function () {
      var rec = prepare(kind, obj, U.nowIso());
      return writeKind(kind, [rec], []).then(function () { return rec; });
    });
  };

  // 기존 기록에 일부 필드만 합쳐 저장(추가 API)
  S.patch = function (kind, id, patch) {
    try { checkKind(kind); } catch (e) { return Promise.reject(e); }
    return enqueue(function () {
      var prev = S.byId(kind).get(String(id));
      if (!prev) throw new Error('기록을 찾을 수 없습니다');
      var rec = prepare(kind, Object.assign({}, prev, patch || {}, { id: prev.id }), U.nowIso());
      return writeKind(kind, [rec], []).then(function () { return rec; });
    });
  };

  S.putMany = function (kind, objs) {
    try { checkKind(kind); } catch (e) { return Promise.reject(e); }
    return enqueue(function () {
      var now = U.nowIso();
      var recs = arrOf(objs).map(function (o) { return prepare(kind, o, now); });
      return writeKind(kind, recs, []).then(function () { return recs; });
    });
  };

  S.remove = function (kind, id) {
    try { checkKind(kind); } catch (e) { return Promise.reject(e); }
    return enqueue(function () {
      if (id == null || !S.byId(kind).has(String(id))) return;
      return writeKind(kind, [], [String(id)]);
    });
  };

  S.removeMany = function (kind, ids) {
    try { checkKind(kind); } catch (e) { return Promise.reject(e); }
    return enqueue(function () {
      var m = S.byId(kind);
      var list = U.uniq(arrOf(ids).map(String)).filter(function (id) { return m.has(id); });
      return writeKind(kind, [], list);
    });
  };

  S.saveSettings = function (patch) {
    return enqueue(function () {
      var cur = S.data.settings || {};
      var p = U.clone(patch || {});
      var next = normalizeSettings(Object.assign({}, cur, p));
      var now = U.nowIso();
      next.createdAt = cur.createdAt || now;
      next.updatedAt = now;
      return writeSettings(next, true);
    });
  };

  // 백업 복원: 전부 지우고 교체(한 트랜잭션). 기록의 createdAt/updatedAt은 유지.
  S.replaceAll = function (dataObj) {
    return enqueue(function () {
      var src = dataObj || {};
      var now = U.nowIso();
      var next = { settings: normalizeSettings(src.settings) };
      next.settings.createdAt = next.settings.createdAt || now;
      next.settings.updatedAt = now;
      KINDS.forEach(function (k) {
        var seen = new Map();
        arrOf(src[k]).forEach(function (o) {
          if (!o || typeof o !== 'object') return;
          var rec = prepare(k, o, now, true);
          seen.set(rec.id, rec);
        });
        next[k] = Array.from(seen.values());
      });
      return writeAll(next);
    });
  };

  S.clearAll = function () {
    return enqueue(function () {
      var now = U.nowIso();
      var next = emptyData(defaultSettings());
      next.settings.createdAt = now;
      next.settings.updatedAt = now;
      return writeAll(next);
    });
  };

  // 대기 중인 쓰기가 모두 끝나면 풀리는 약속(추가 API)
  S.flush = function () { return queue; };

  S.on = function (evt, fn) {
    if (typeof fn !== 'function') return;
    (listeners[evt] = listeners[evt] || []).push(fn);
  };
  S.off = function (evt, fn) {
    var arr = listeners[evt];
    if (!arr) return;
    var i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };

  S.requestPersist = function () {
    var n = G.navigator;
    var st = n && n.storage;
    if (!st || typeof st.persist !== 'function') return Promise.resolve(false);
    return Promise.resolve().then(function () {
      return typeof st.persisted === 'function' ? st.persisted() : false;
    }).then(function (already) {
      return already ? true : st.persist();
    }).then(function (r) {
      S.persisted = !!r;
      return !!r;
    }, function () { return false; });
  };

  S.estimate = function () {
    var n = G.navigator;
    var st = n && n.storage;
    if (!st || typeof st.estimate !== 'function') return Promise.resolve(null);
    return Promise.resolve().then(function () { return st.estimate(); }).then(function (r) {
      return r ? { usage: r.usage || 0, quota: r.quota || 0 } : null;
    }, function () { return null; });
  };

  S.attendanceKey = function (date, srcId, studentId) { return date + '|' + srcId + '|' + studentId; };
  S.defaultSettings = defaultSettings;
  S.normalizeSettings = normalizeSettings;
  S.defaultPractice = defaultPractice;
  S.MODULE_KEYS = MODULE_KEYS.slice();
  S.DEFAULT_BILLING_SMS = DEFAULT_BILLING_SMS;
})(typeof window !== 'undefined' ? (window.DA = window.DA || {}) : (globalThis.DA = globalThis.DA || {}));
