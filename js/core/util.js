/* 드럼 출석부 — core/util.js
 * 날짜·시각·금액·문자열 도우미와 상수. DOM을 건드리지 않는다(node vm에서도 동작).
 * 날짜는 항상 로컬 'YYYY-MM-DD' 문자열로 다룬다. new Date('YYYY-MM-DD')(UTC 해석)는 쓰지 않는다.
 */
(function (DA) {
  'use strict';

  var C = DA.C = DA.C || {};

  C.STATUS = {
    present: '출석', late: '지각', absent: '결석', excused: '공결', canceled: '휴강',
    unmarked: '미확인', pending: '서명 대기', upcoming: '예정'
  };
  // 화면·표에서 쓰는 상태 순서
  C.STATUS_ORDER = ['present', 'late', 'absent', 'excused', 'canceled', 'unmarked', 'pending', 'upcoming'];
  // 기록(Attendance.status)으로 저장 가능한 상태
  C.RECORD_STATUSES = ['present', 'late', 'absent', 'excused', 'canceled'];
  C.WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  // v1.1: 시간표 밖에서 받은 출석(이용권 사용)은 walkin 으로 저장한다
  C.KIND = { regular: '정규', makeup: '보강', special: '특강', trial: '체험', walkin: '이용권' };
  C.KIND_ORDER = ['regular', 'makeup', 'special', 'trial', 'walkin'];
  C.KIND_COLORS = { regular: '#D9480F', makeup: '#2563EB', special: '#9333EA', trial: '#0D9488', walkin: '#CA8A04' };
  C.DEFAULT_COLORS = [
    '#D9480F', '#2563EB', '#0D9488', '#9333EA', '#DB2777',
    '#CA8A04', '#4F46E5', '#059669', '#0891B2', '#E11D48', '#65A30D', '#7C2D12'
  ];
  C.PAY_METHODS = ['카드', '현금', '계좌이체', '기타'];
  C.PASS_TYPES = { month: '월 이용권', monthly: '월 정액', count: '횟수권', none: '없음' };
  C.STUDENT_STATUS = { active: '재원', paused: '휴원', left: '퇴원' };
  C.METHOD = { sign: '서명', manual: '직접 입력' };

  var U = DA.util = DA.util || {};

  var YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var HM_RE = /^(\d{1,2}):(\d{2})$/;
  var DAY_MS = 86400000;

  function pad2(n) { n = Math.floor(Math.abs(n)); return (n < 10 ? '0' : '') + n; }
  function pad4(n) { var s = String(Math.abs(n)); while (s.length < 4) s = '0' + s; return s; }
  function isDateObj(d) {
    return d != null && typeof d === 'object' && typeof d.getTime === 'function' && typeof d.getFullYear === 'function';
  }
  function parts(s) {
    var m = YMD_RE.exec(String(s == null ? '' : s).slice(0, 10));
    if (!m) return null;
    return [+m[1], +m[2], +m[3]];
  }
  function fromParts(y, m, d) { return pad4(y) + '-' + pad2(m) + '-' + pad2(d); }

  U.pad2 = pad2;

  // ── 식별자 ────────────────────────────────────────────
  U.uid = function () {
    var c = (typeof crypto !== 'undefined' && crypto) ? crypto : null;
    try {
      if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    } catch (e) { /* 보안 컨텍스트가 아니면 randomUUID가 없거나 예외 */ }
    var b = new Array(16), i;
    var got = false;
    try {
      if (c && typeof c.getRandomValues === 'function') {
        var arr = new Uint8Array(16);
        c.getRandomValues(arr);
        for (i = 0; i < 16; i++) b[i] = arr[i];
        got = true;
      }
    } catch (e2) { got = false; }
    if (!got) {
      var t = Date.now();
      for (i = 0; i < 16; i++) {
        b[i] = (Math.floor(Math.random() * 256) ^ (t & 0xff)) & 0xff;
        t = Math.floor(t / 7) + i * 31;
      }
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = '';
    for (i = 0; i < 16; i++) {
      hex += (b[i] < 16 ? '0' : '') + b[i].toString(16);
      if (i === 3 || i === 5 || i === 7 || i === 9) hex += '-';
    }
    return hex;
  };

  // ── 날짜 ──────────────────────────────────────────────
  // Date | number(ms) | ISO 문자열 | 'YYYY-MM-DD' → Date (없으면 지금)
  U.toDate = function (v) {
    if (v == null || v === '') return new Date();
    if (isDateObj(v)) return new Date(v.getTime());
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') {
      if (YMD_RE.test(v)) return U.parseYmd(v);
      return new Date(v);
    }
    return new Date(NaN);
  };

  U.ymd = function (date) {
    if (typeof date === 'string' && YMD_RE.test(date)) return date;
    var d = isDateObj(date) ? date : U.toDate(date);
    if (isNaN(d.getTime())) return '';
    return fromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
  };

  U.today = function (now) { return U.ymd(now == null ? new Date() : U.toDate(now)); };

  U.parseYmd = function (s) {
    if (isDateObj(s)) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
    var p = parts(s);
    if (!p) return new Date(NaN);
    var d = new Date(p[0], p[1] - 1, p[2]);
    if (p[0] < 100) d.setFullYear(p[0]);
    return d;
  };

  U.isYmd = function (s) {
    if (typeof s !== 'string') return false;
    var p = parts(s);
    if (!p || s.length !== 10) return false;
    return p[1] >= 1 && p[1] <= 12 && p[2] >= 1 && p[2] <= U.daysInMonth(p[0], p[1]);
  };

  U.daysInMonth = function (y, m) { // m: 1..12
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  };

  function utcMs(s) {
    var p = parts(s);
    return p ? Date.UTC(p[0], p[1] - 1, p[2]) : NaN;
  }

  U.addDays = function (ymd, n) {
    var p = parts(ymd);
    if (!p) return '';
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + (n | 0)));
    return fromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  };

  U.diffDays = function (a, b) { return Math.round((utcMs(b) - utcMs(a)) / DAY_MS); };

  U.weekday = function (ymd) {
    var t = utcMs(ymd);
    return isNaN(t) ? NaN : new Date(t).getUTCDay();
  };

  U.startOfWeek = function (ymd, weekStart) {
    var ws = weekStart === 0 ? 0 : (weekStart == null ? 1 : (weekStart | 0) % 7);
    var wd = U.weekday(ymd);
    return U.addDays(ymd, -((wd - ws + 7) % 7));
  };

  U.monthStart = function (ymd) { var p = parts(ymd); return p ? fromParts(p[0], p[1], 1) : ''; };
  U.monthEnd = function (ymd) { var p = parts(ymd); return p ? fromParts(p[0], p[1], U.daysInMonth(p[0], p[1])) : ''; };
  U.addMonths = function (ymd, n) {
    var p = parts(ymd);
    if (!p) return '';
    var total = p[0] * 12 + (p[1] - 1) + (n | 0);
    var y = Math.floor(total / 12), m = total - y * 12 + 1;
    return fromParts(y, m, Math.min(p[2], U.daysInMonth(y, m)));
  };
  U.ym = function (ymd) { return String(ymd || '').slice(0, 7); };

  U.rangeDays = function (from, to) {
    var out = [];
    var a = utcMs(from), b = utcMs(to);
    if (isNaN(a) || isNaN(b) || a > b) return out;
    var d = new Date(a);
    while (d.getTime() <= b) {
      out.push(fromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  };

  // ── 시각 ──────────────────────────────────────────────
  var HM_CACHE = Object.create(null);
  U.isHm = function (s) {
    var m = HM_RE.exec(String(s == null ? '' : s).trim());
    return !!m && +m[1] <= 23 && +m[2] < 60;
  };
  // 'HH:MM' → 분. 형식이 틀리면 0.
  U.hm2min = function (s) {
    if (typeof s === 'number') return isFinite(s) ? s : 0;
    var k = String(s == null ? '' : s);
    var v = HM_CACHE[k];
    if (v !== undefined) return v;
    var m = HM_RE.exec(k.trim());
    v = m ? (+m[1]) * 60 + (+m[2]) : 0;
    HM_CACHE[k] = v;
    return v;
  };
  // 분 → 'HH:MM' (24:00 이상은 그대로 표기)
  U.min2hm = function (min) {
    var m = Math.max(0, Math.round(+min || 0));
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  };
  U.at = function (ymd, hm) {
    var p = parts(ymd);
    if (!p) return new Date(NaN);
    return new Date(p[0], p[1] - 1, p[2], 0, U.hm2min(hm), 0, 0);
  };
  U.hmOf = function (date) {
    var d = U.toDate(date);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };
  U.nowIso = function () { return new Date().toISOString(); };
  // ISO 시각 → 로컬 날짜
  U.ymdOfIso = function (iso) { return iso ? U.ymd(U.toDate(iso)) : ''; };

  // ── 표시 ──────────────────────────────────────────────
  // opts: {weekday:true, year:false|true|'auto', now}
  U.fmtDate = function (ymd, opts) {
    var o = opts || {};
    var p = parts(typeof ymd === 'string' ? ymd : U.ymd(ymd));
    if (!p) return '';
    var showYear = o.year === true || (o.year === 'auto' && p[0] !== U.toDate(o.now).getFullYear());
    var s = (showYear ? p[0] + '년 ' : '') + p[1] + '월 ' + p[2] + '일';
    if (o.weekday !== false) s += ' (' + C.WEEKDAYS[U.weekday(fromParts(p[0], p[1], p[2]))] + ')';
    return s;
  };
  // 'YYYY-MM' → '9월' | '2026년 9월'
  U.fmtMonth = function (ym, opts) {
    var m = /^(\d{4})-(\d{2})/.exec(String(ym || ''));
    if (!m) return '';
    return ((opts && opts.year) ? (+m[1]) + '년 ' : '') + (+m[2]) + '월';
  };
  U.fmtTime = function (v, opts) {
    var h, mi;
    if (isDateObj(v) || typeof v === 'number' || (typeof v === 'string' && !HM_RE.test(v.trim()) && v.length > 5)) {
      var d = U.toDate(v);
      if (isNaN(d.getTime())) return '';
      h = d.getHours(); mi = d.getMinutes();
    } else {
      var t = U.hm2min(v);
      h = Math.floor(t / 60); mi = t % 60;
    }
    if (opts && opts.ampm) {
      var hh = h % 24;
      var ap = hh < 12 ? '오전' : '오후';
      var h12 = hh % 12 === 0 ? 12 : hh % 12;
      return ap + ' ' + h12 + ':' + pad2(mi);
    }
    return pad2(h) + ':' + pad2(mi);
  };
  U.fmtDuration = function (min) {
    var m = Math.max(0, Math.round(+min || 0));
    var h = Math.floor(m / 60), r = m % 60;
    if (!h) return r + '분';
    return h + '시간' + (r ? ' ' + r + '분' : '');
  };
  U.fmtNumber = function (n) {
    var v = Math.round(+n || 0);
    var s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (v < 0 ? '-' : '') + s;
  };
  U.fmtMoney = function (n) { return U.fmtNumber(n) + '원'; };
  U.pct = function (r, digits) {
    if (r == null || typeof r !== 'number' || !isFinite(r)) return '–';
    var f = Math.pow(10, digits || 0);
    return (Math.round(r * 100 * f) / f) + '%';
  };
  U.fmtRange = function (from, to) {
    if (!from && !to) return '';
    if (from === to) return U.fmtDate(from, { weekday: false });
    var pf = parts(from), pt = parts(to);
    if (!pf || !pt) return (from || '') + ' ~ ' + (to || '');
    var left = (pf[0] !== pt[0] ? pf[0] + '년 ' : '') + pf[1] + '월 ' + pf[2] + '일';
    var right = (pf[0] !== pt[0] ? pt[0] + '년 ' : '') + pt[1] + '월 ' + pt[2] + '일';
    return left + ' ~ ' + right;
  };
  // 오늘/어제/내일(그 외 '')
  U.relDay = function (ymd, now) {
    var d = U.diffDays(U.today(now), ymd);
    return d === 0 ? '오늘' : d === -1 ? '어제' : d === 1 ? '내일' : '';
  };

  // ── 한글 검색 ─────────────────────────────────────────
  var CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  var CHO_SET = {};
  CHO.forEach(function (c) { CHO_SET[c] = true; });
  function isSyl(code) { return code >= 0xAC00 && code <= 0xD7A3; }
  function choOf(ch) {
    var c = ch.charCodeAt(0);
    return isSyl(c) ? CHO[Math.floor((c - 0xAC00) / 588)] : ch;
  }
  U.chosung = function (str) {
    var s = String(str == null ? '' : str), out = '';
    for (var i = 0; i < s.length; i++) out += choOf(s.charAt(i));
    return out;
  };
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase(); }
  // 입력 중인 마지막 글자: 받침 없는 글자('미')가 받침 있는 글자('민')의 앞부분이면 일치로 본다
  function syllablePrefix(q, ch) {
    var a = q.charCodeAt(0), b = ch.charCodeAt(0);
    if (!isSyl(a) || !isSyl(b)) return false;
    var ai = a - 0xAC00, bi = b - 0xAC00;
    return ai % 28 === 0 && Math.floor(ai / 28) === Math.floor(bi / 28);
  }
  U.matchName = function (name, query) {
    var n = norm(name), q = norm(query);
    if (!q) return true;
    if (!n) return false;
    if (n.indexOf(q) >= 0) return true;
    var ql = q.length;
    for (var i = 0; i + ql <= n.length; i++) {
      var ok = true;
      for (var j = 0; j < ql; j++) {
        var qc = q.charAt(j), ch = n.charAt(i + j);
        if (qc === ch) continue;
        if (CHO_SET[qc] && choOf(ch) === qc) continue;
        if (j === ql - 1 && syllablePrefix(qc, ch)) continue;
        ok = false;
        break;
      }
      if (ok) return true;
    }
    return false;
  };

  var collator = null;
  U.collate = function (a, b) {
    if (collator === null) {
      try { collator = new Intl.Collator('ko'); } catch (e) { collator = false; }
    }
    var x = String(a == null ? '' : a), y = String(b == null ? '' : b);
    return collator ? collator.compare(x, y) : (x < y ? -1 : x > y ? 1 : 0);
  };

  // ── 환경 ──────────────────────────────────────────────
  function nav() { return typeof navigator !== 'undefined' ? navigator : null; }
  function win() { return typeof window !== 'undefined' ? window : null; }
  U.isIOS = function () {
    var n = nav();
    if (!n) return false;
    var ua = n.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (n.platform === 'MacIntel' && n.maxTouchPoints > 1);
  };
  U.isStandalone = function () {
    var w = win(), n = nav();
    try {
      if (w && w.matchMedia && w.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) { /* 무시 */ }
    return !!(n && n.standalone === true);
  };
  U.isAndroidApp = function () { var w = win(); return !!(w && w.DrumNative); };

  U.smsHref = function (phone, body) {
    var num = String(phone == null ? '' : phone).replace(/[^0-9+]/g, '');
    var href = 'sms:' + num;
    if (body) href += (U.isIOS() ? '&' : '?') + 'body=' + encodeURIComponent(body);
    return href;
  };
  U.telHref = function (phone) { return 'tel:' + String(phone == null ? '' : phone).replace(/[^0-9+]/g, ''); };

  // '{학원} {이름}' 같은 자리표시를 채운다. 모르는 자리표시는 그대로 둔다.
  U.fillTemplate = function (tpl, vars) {
    var v = vars || {};
    return String(tpl == null ? '' : tpl).replace(/\{([^{}\s]+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(v, k) && v[k] != null ? String(v[k]) : m;
    });
  };

  U.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // ── 숫자 ──────────────────────────────────────────────
  U.clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  U.sum = function (arr, fn) {
    var s = 0;
    if (!arr) return 0;
    for (var i = 0; i < arr.length; i++) {
      var x = fn ? fn(arr[i], i) : arr[i];
      if (typeof x === 'number' && isFinite(x)) s += x;
    }
    return s;
  };
  U.avg = function (arr, fn) {
    var s = 0, n = 0;
    if (!arr) return null;
    for (var i = 0; i < arr.length; i++) {
      var x = fn ? fn(arr[i], i) : arr[i];
      if (typeof x === 'number' && isFinite(x)) { s += x; n++; }
    }
    return n ? s / n : null;
  };
  U.round1 = function (x) {
    if (x == null || typeof x !== 'number' || !isFinite(x)) return x == null ? null : x;
    return Math.round(x * 10) / 10;
  };
  U.uniq = function (arr) {
    var seen = new Set(), out = [];
    (arr || []).forEach(function (x) { if (!seen.has(x)) { seen.add(x); out.push(x); } });
    return out;
  };
  U.clone = function (obj) {
    if (obj == null || typeof obj !== 'object') return obj;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(obj); } catch (e) { /* 함수 등 복제 불가 → JSON */ }
    }
    return JSON.parse(JSON.stringify(obj));
  };
})(typeof window !== 'undefined' ? (window.DA = window.DA || {}) : (globalThis.DA = globalThis.DA || {}));
