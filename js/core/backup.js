/* 드럼 출석부 — core/backup.js
 * 백업 파일(JSON) 만들기·검증, CSV 내보내기(UTF-8 BOM, 엑셀 호환), 파일 이름.
 */
(function (DA) {
  'use strict';

  var U = DA.util;
  var C = DA.C;
  var B = DA.backup = {};

  var APP = 'drum-attendance';
  var SCHEMA = 1;
  var KINDS = ['students', 'lessons', 'exceptions', 'attendance', 'payments', 'bookings'];   // v1.2: 연습실 예약
  var KIND_LABEL = { students: '수강생', lessons: '수업', exceptions: '수업 변경', attendance: '출석 기록', payments: '결제', bookings: '연습실 예약' };
  var BOOK_STATUS = { booked: 1, checkedin: 1, noshow: 1, canceled: 1 };
  var REC_STATUS = { present: 1, late: 1, absent: 1, excused: 1, canceled: 1 };
  var EXTRA_KINDS = { makeup: 1, special: 1, trial: 1, walkin: 1 };
  var EMPTY = [];

  function arr(v) { return Array.isArray(v) ? v : EMPTY; }
  function isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return v == null ? '' : String(v); }
  function idOf(v) { return (typeof v === 'string' && v) || (typeof v === 'number' && isFinite(v)) ? String(v) : ''; }
  function numOr(v, d) {
    if (typeof v === 'string') v = v.replace(/,/g, '');
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : d;
  }
  function ymdOr(v) { return U.isYmd(v) ? v : ''; }
  function nameIn(list, id) {
    if (!id) return '';
    var a = arr(list);
    for (var i = 0; i < a.length; i++) if (a[i] && a[i].id === id) return a[i].name || '';
    return '';
  }

  // ── 내보내기 ──────────────────────────────────────────
  B.exportJSON = function (data) {
    var d = data || {};
    var out = {
      app: APP,
      schema: SCHEMA,
      exportedAt: new Date().toISOString(),
      counts: {},
      data: { settings: d.settings || null }
    };
    KINDS.forEach(function (k) {
      out.data[k] = arr(d[k]);
      out.counts[k] = out.data[k].length;
    });
    return JSON.stringify(out);
  };

  // ── 검증 ──────────────────────────────────────────────
  function cleanSignature(sig) {
    if (!isObj(sig)) return null;
    var w = numOr(sig.w, 0), h = numOr(sig.h, 0);
    if (!(w > 0) || !(h > 0) || !Array.isArray(sig.strokes)) return null;
    var strokes = [];
    for (var i = 0; i < sig.strokes.length; i++) {
      var s = sig.strokes[i];
      if (!Array.isArray(s)) return null;
      for (var j = 0; j < s.length; j++) if (typeof s[j] !== 'number' || !isFinite(s[j])) return null;
      if (s.length >= 3) strokes.push(s);
    }
    var out = Object.assign({}, sig);
    out.w = w; out.h = h; out.strokes = strokes;
    return out;
  }

  var CHECK = {
    students: function (r, warn) {
      r.name = str(r.name).trim();
      if (!r.name) return '이름 없음';
      if (['active', 'paused', 'left'].indexOf(r.status) < 0) r.status = 'active';
      ['phone', 'parentName', 'parentPhone', 'birth', 'school', 'courseId', 'levelId', 'teacherId', 'memo', 'color'].forEach(function (k) {
        r[k] = str(r[k]);
      });
      r.joinDate = ymdOr(r.joinDate);
      r.leftDate = ymdOr(r.leftDate);
      r.pauses = arr(r.pauses).filter(function (p) { return isObj(p) && U.isYmd(p.from); })
        .map(function (p) { var q = Object.assign({}, p); q.to = ymdOr(q.to); return q; });
      if (!isObj(r.pass) || ['month', 'monthly', 'count', 'none'].indexOf(r.pass.type) < 0) r.pass = { type: 'none' };
      else {
        r.pass = Object.assign({}, r.pass);
        if (r.pass.type === 'monthly') r.pass.monthlyCount = Math.max(0, Math.floor(numOr(r.pass.monthlyCount, 4)));
      }
      return null;
    },
    lessons: function (r) {
      var wd = Number(r.weekday);
      if (!(wd >= 0 && wd <= 6) || Math.floor(wd) !== wd) return '요일 오류';
      r.weekday = wd;
      if (!U.isHm(r.start)) return '시작 시각 오류';
      r.duration = numOr(r.duration, 0);
      if (!(r.duration > 0)) return '수업 길이 오류';
      r.studentIds = arr(r.studentIds).map(idOf).filter(Boolean);
      r.teacherId = str(r.teacherId); r.roomId = str(r.roomId); r.title = str(r.title); r.memo = str(r.memo);
      r.startDate = ymdOr(r.startDate);
      r.endDate = ymdOr(r.endDate);
      return null;
    },
    exceptions: function (r) {
      if (!U.isYmd(r.date)) return '날짜 오류';
      if (r.type === 'cancel') {
        r.lessonId = idOf(r.lessonId);
        if (!r.lessonId) return '휴강 대상 수업 없음';
        r.reason = str(r.reason);
        return null;
      }
      if (r.type !== 'extra') return '종류 오류';
      if (!U.isHm(r.start)) return '시작 시각 오류';
      r.duration = numOr(r.duration, 0);
      if (!(r.duration > 0)) return '수업 길이 오류';
      if (!EXTRA_KINDS[r.kind]) r.kind = 'special';
      r.studentIds = arr(r.studentIds).map(idOf).filter(Boolean);
      r.teacherId = str(r.teacherId); r.roomId = str(r.roomId); r.title = str(r.title); r.reason = str(r.reason);
      if (!isObj(r.makeupFor)) r.makeupFor = null;
      return null;
    },
    attendance: function (r, warn) {
      if (!U.isYmd(r.date)) return '날짜 오류';
      r.srcId = idOf(r.srcId);
      r.studentId = idOf(r.studentId);
      if (!r.srcId || !r.studentId) return '수업·학생 정보 없음';
      if (!REC_STATUS[r.status]) return '상태 오류';
      r.id = r.date + '|' + r.srcId + '|' + r.studentId;
      if (r.method !== 'sign' && r.method !== 'manual') r.method = 'manual';
      if (r.signedAt != null && (typeof r.signedAt !== 'string' || isNaN(new Date(r.signedAt).getTime()))) r.signedAt = null;
      if (r.signedAt === undefined) r.signedAt = null;
      if (r.signature != null) {
        var sig = cleanSignature(r.signature);
        if (!sig) warn('서명 그림이 손상된 기록이 있어 서명 그림만 뺐습니다');
        r.signature = sig;
      } else r.signature = null;
      r.note = str(r.note);
      if (r.progress != null && !isObj(r.progress)) r.progress = null;
      if (r.progress) {
        var p = Object.assign({}, r.progress);
        p.song = str(p.song); p.book = str(p.book); p.memo = str(p.memo);
        p.bpm = p.bpm == null || p.bpm === '' ? null : numOr(p.bpm, null);
        r.progress = p;
      }
      if (!isObj(r.snap)) r.snap = null;
      return null;
    },
    payments: function (r) {
      r.studentId = idOf(r.studentId);
      if (!r.studentId) return '학생 정보 없음';
      if (!U.isYmd(r.date)) return '날짜 오류';
      r.amount = numOr(r.amount, NaN);
      if (!isFinite(r.amount)) return '금액 오류';
      // v1.1: 횟수 조정(kind 'adjust')은 −1 같은 음수 횟수를 쓴다
      if (r.kind === 'adjust') r.count = Math.round(numOr(r.count, 0));
      else r.count = Math.max(0, Math.floor(numOr(r.count, 0)));
      r.months = Math.max(0, numOr(r.months, 0));
      if (r.month != null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(r.month))) delete r.month;
      r.method = str(r.method) || (r.kind === 'adjust' ? '' : '기타');
      r.memo = str(r.memo);
      // v1.2 수납: paid:false(미납)·dueDate·paidDate·groupId(선납 묶음). 없으면 결제 완료로 읽는다.
      if (r.paid != null && typeof r.paid !== 'boolean') r.paid = !(r.paid === 'false' || r.paid === 0);
      if (r.dueDate != null && !U.isYmd(r.dueDate)) delete r.dueDate;
      if (r.paidDate != null && !U.isYmd(r.paidDate)) delete r.paidDate;
      if (r.groupId != null) r.groupId = str(r.groupId);
      return null;
    },
    bookings: function (r) {
      r.roomId = idOf(r.roomId);
      r.studentId = idOf(r.studentId);
      if (!r.roomId || !r.studentId) return '방·학생 정보 없음';
      if (!U.isYmd(r.date)) return '날짜 오류';
      if (!U.isHm(r.start)) return '시작 시각 오류';
      r.duration = numOr(r.duration, 60);
      if (!(r.duration > 0)) return '예약 길이 오류';
      if (!BOOK_STATUS[r.status]) r.status = 'booked';
      if (r.checkinAt != null && (typeof r.checkinAt !== 'string' || isNaN(new Date(r.checkinAt).getTime()))) r.checkinAt = null;
      r.memo = str(r.memo);
      return null;
    }
  };

  B.parseJSON = function (text) {
    var counts = { students: 0, lessons: 0, exceptions: 0, attendance: 0, payments: 0, bookings: 0, skipped: 0 };
    function fail(msg) { return { ok: false, error: msg, counts: counts, warnings: [] }; }
    var src = typeof text === 'string' ? text.replace(/^﻿/, '').trim() : '';
    if (!src) return fail('파일이 비어 있습니다.');
    var obj;
    try { obj = JSON.parse(src); } catch (e) { return fail('백업 파일을 읽을 수 없습니다. JSON 형식이 아닙니다.'); }
    if (!isObj(obj)) return fail('드럼 출석부 백업 파일이 아닙니다.');

    var payload;
    if (obj.app != null) {
      if (obj.app !== APP) return fail('다른 앱의 파일입니다(' + str(obj.app).slice(0, 40) + '). 드럼 출석부 백업 파일을 골라 주세요.');
      var schema = numOr(obj.schema, 1);
      if (schema > SCHEMA) return fail('더 새 버전의 앱에서 만든 백업입니다. 앱을 업데이트한 뒤 다시 불러와 주세요.');
      payload = obj.data;
      if (!isObj(payload)) return fail('백업 파일에 데이터가 없습니다.');
    } else if (KINDS.some(function (k) { return Array.isArray(obj[k]); }) && (obj.settings === undefined || isObj(obj.settings))) {
      payload = obj; // 감싸지 않은 데이터 묶음도 받아 준다
    } else {
      return fail('드럼 출석부 백업 파일이 아닙니다.');
    }

    var warnings = [], warnSeen = {};
    function warn(msg) { if (!warnSeen[msg]) { warnSeen[msg] = true; warnings.push(msg); } }

    var out = {};
    for (var i = 0; i < KINDS.length; i++) {
      var k = KINDS[i];
      var list = payload[k];
      if (list == null) list = [];
      if (!Array.isArray(list)) return fail(KIND_LABEL[k] + ' 목록 형식이 올바르지 않습니다.');
      var byId = new Map(), dropped = 0, dup = 0;
      list.forEach(function (raw) {
        if (!isObj(raw)) { dropped++; return; }
        var r = Object.assign({}, raw);           // 알 수 없는 필드는 그대로 보존
        if (k !== 'attendance') {
          r.id = idOf(r.id);
          if (!r.id) { dropped++; return; }
        }
        var problem = CHECK[k](r, warn);
        if (problem) { dropped++; return; }
        if (byId.has(r.id)) {
          dup++;
          var prev = byId.get(r.id);
          if (String(r.updatedAt || '') < String(prev.updatedAt || '')) return;
        }
        byId.set(r.id, r);
      });
      if (dropped) warn(KIND_LABEL[k] + ' ' + dropped + '건은 형식이 맞지 않아 뺐습니다');
      if (dup) warn(KIND_LABEL[k] + ' ' + dup + '건은 중복이라 최신 것만 남겼습니다');
      counts.skipped += dropped;
      out[k] = Array.from(byId.values());
      counts[k] = out[k].length;
    }

    var settings = payload.settings;
    if (settings != null && !isObj(settings)) return fail('설정 형식이 올바르지 않습니다.');
    if (DA.store && typeof DA.store.normalizeSettings === 'function') {
      settings = DA.store.normalizeSettings(settings || null);
    } else {
      settings = settings ? Object.assign({}, settings, { id: 'settings' }) : null;
    }
    out.settings = settings;

    return {
      ok: true, data: out, counts: counts, warnings: warnings,
      exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : null
    };
  };

  // ── CSV ───────────────────────────────────────────────
  function cell(v) {
    if (v == null) return '';
    var s = typeof v === 'number' ? (isFinite(v) ? String(v) : '') : String(v);
    // 엑셀 수식 주입 방지: =, @, 탭/CR, 숫자가 아닌 +/-로 시작하면 앞에 ' 를 붙인다
    if (/^[=@\t\r]/.test(s) || /^[+\-](?![\d.])/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCSV(lines) {
    return '﻿' + lines.map(function (r) { return r.map(cell).join(','); }).join('\r\n') + '\r\n';
  }
  B.csvCell = cell;
  B.toCSV = toCSV;

  function dateTime(iso) {
    if (!iso) return '';
    var d = U.toDate(iso);
    if (isNaN(d.getTime())) return '';
    return U.ymd(d) + ' ' + U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
  }

  // 서명 → 독립 SVG 문자열(인쇄·CSV용). DA.sig가 있으면 그쪽을 쓴다.
  function sigText(sig) {
    if (!sig) return '';
    if (DA.sig && typeof DA.sig.svgString === 'function') {
      try { return DA.sig.svgString(sig, {}); } catch (e) { /* 아래 기본 방식 */ }
    }
    var d = arr(sig.strokes).map(function (s) {
      var p = [];
      for (var i = 0; i + 1 < s.length; i += 3) p.push((i ? 'L' : 'M') + s[i] + ' ' + s[i + 1]);
      return p.join('');
    }).join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + sig.w + ' ' + sig.h + '"><path d="' + d +
      '" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  B.attendanceCSV = function (data, rows, opts) {
    var o = opts || {};
    var d = data || {};
    var s = d.settings || {};
    var list = rows;
    if (!Array.isArray(list)) {
      var t = U.today();
      var from = DA.stats && DA.stats.earliestDate ? DA.stats.earliestDate(d, t) : t;
      list = DA.schedule.rows(d, from, t, new Date());
    }
    var stuById = DA.schedule.index.studentsById(d);
    var head = ['날짜', '요일', '시작', '종료', '수업', '종류', '강사', '방', '학생', '과정', '상태', '방법', '서명시각', '메모', '곡', '교재', 'BPM'];
    if (o.includeSignature) head.push('서명');
    var lines = [head];
    list.forEach(function (row) {
      var occ = row.occ || {};
      var st = stuById.get(row.studentId);
      var rec = row.record;
      var prog = (rec && rec.progress) || {};
      var status = (C.STATUS[row.status] || row.status) + (row.auto ? '(자동)' : '');
      var line = [
        row.date,
        C.WEEKDAYS[U.weekday(row.date)],
        occ.start || '',
        occ.end || '',
        DA.schedule.lessonLabel(d, occ),
        C.KIND[occ.kind] || '',
        nameIn(s.teachers, occ.teacherId),
        nameIn(s.rooms, occ.roomId),
        st ? st.name : '(삭제된 수강생)',
        st ? nameIn(s.courses, st.courseId) : '',
        status,
        rec ? (rec.method === 'sign' ? '서명' : '직접') : '',
        rec ? dateTime(rec.signedAt) : '',
        rec ? (rec.note || '') : (occ.canceled ? occ.cancelReason || '' : ''),
        prog.song || '',
        prog.book || '',
        prog.bpm != null && prog.bpm !== '' ? prog.bpm : ''
      ];
      if (o.includeSignature) line.push(rec && rec.signature ? sigText(rec.signature) : '');
      lines.push(line);
    });
    return toCSV(lines);
  };

  B.studentStatsCSV = function (report) {
    var r = report || {};
    var lines = [[
      '이름', '상태', '과정', '레벨', '담당 강사', '예정', '출석', '지각', (DA.C.STATUS.absent || '결석'), (DA.C.STATUS.absent || '결석') + '(자동)', '공결', '휴강', '미확인',
      '출석률', '지각률', '연속 출석', '최고 연속', '최근 출석', '연속 결석', '보강 필요', '수강권', '최근 BPM',
      '발급 금액', '사용 금액', '남은 횟수 가치'
    ]];
    arr(r.byStudent).forEach(function (e) {
      lines.push([
        e.name,
        C.STUDENT_STATUS[e.status] || (e.status === 'deleted' ? '삭제됨' : ''),
        e.courseName || '', e.levelName || '', e.teacherName || '',
        e.scheduled, e.present, e.late, e.absent, e.absentAuto, e.excused, e.canceled, e.unmarked,
        U.pct(e.rate), U.pct(e.lateRate),
        e.streak, e.bestStreak, e.lastAttended || '', e.consecutiveAbsent, e.makeupOwed,
        (e.pass && e.pass.label) || '',
        e.avgBpm == null ? '' : e.avgBpm,
        e.issuedAmount || 0, e.usedAmount || 0, e.remainingValue || 0
      ]);
    });
    if (r.totals) {
      var t = r.totals;
      lines.push([
        '합계', '', '', '', '', t.scheduled, t.present, t.late, t.absent, t.absentAuto, t.excused, t.canceled, t.unmarked,
        U.pct(t.rate), U.pct(t.lateRate), '', '', '', '', '', '', '',
        r.money ? r.money.totals.issuedAmount : '', r.money ? r.money.totals.usedAmount : '', r.money ? r.money.totals.remainingValue : ''
      ]);
    }
    return toCSV(lines);
  };

  function passLabel(p) {
    if (p && p.type === 'month') return '월 이용권';
    if (!p || !p.type || p.type === 'none') return '없음';
    if (p.type === 'monthly') return '월 ' + (p.monthlyCount || 0) + '회';
    if (p.type === 'count') return '횟수권';
    return '';
  }

  B.studentsCSV = function (data) {
    var d = data || {};
    var s = d.settings || {};
    var lines = [[
      '이름', '상태', '연락처', '보호자', '보호자 연락처', '생년월일', '학교/학년', '과정', '레벨', '담당 강사',
      '등록일', '퇴원일', '수강권', '메모'
    ]];
    arr(d.students).slice().sort(function (a, b) { return U.collate(a.name, b.name); }).forEach(function (st) {
      lines.push([
        st.name, C.STUDENT_STATUS[st.status] || '재원', st.phone || '', st.parentName || '', st.parentPhone || '',
        st.birth || '', st.school || '', nameIn(s.courses, st.courseId), nameIn(s.levels, st.levelId),
        nameIn(s.teachers, st.teacherId), st.joinDate || '', st.leftDate || '', passLabel(st.pass), st.memo || ''
      ]);
    });
    return toCSV(lines);
  };

  B.paymentsCSV = function (data) {
    var d = data || {};
    var s = d.settings || {};
    var stuById = DA.schedule.index.studentsById(d);
    var lines = [['날짜', '학생', '과정', '금액', '충전 횟수', '개월', '결제 수단', '메모', '대상 월', '종류', '이용권', '결제 상태', '납부 기한', '결제일']];
    arr(d.payments).slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    }).forEach(function (p) {
      var st = stuById.get(p.studentId);
      lines.push([
        p.date, st ? st.name : '(삭제된 수강생)', st ? nameIn(s.courses, st.courseId) : '',
        numOr(p.amount, 0), numOr(p.count, 0), numOr(p.months, 0), p.method || '', p.memo || '',
        DA.pass ? DA.pass.revenueMonth(p) : (p.month || ''), p.kind === 'adjust' ? '횟수 조정' : (p.month || p.kind === 'issue' ? '이용권 발급' : '결제'),
        p.productName || '',
        p.kind === 'adjust' ? '' : (p.paid === false ? '미납' : '결제 완료'), p.dueDate || '', p.paid === false ? '' : (p.paidDate || '')
      ]);
    });
    return toCSV(lines);
  };

  // v1.2 연습실 예약 CSV
  B.bookingsCSV = function (data) {
    var d = data || {};
    var s = d.settings || {};
    var stuById = DA.schedule.index.studentsById(d);
    var LBL = { booked: '예약', checkedin: '체크인', noshow: '노쇼', canceled: '취소' };
    var lines = [['날짜', '시작', '끝', '방', '학생', '상태', '체크인 시각', '자동 노쇼', '메모']];
    arr(d.bookings).slice().sort(function (a, b) { return (a.date + a.start) < (b.date + b.start) ? -1 : 1; }).forEach(function (b) {
      var st = stuById.get(b.studentId);
      lines.push([b.date, b.start, U.min2hm(U.hm2min(b.start) + numOr(b.duration, 60)), nameIn(s.rooms, b.roomId), st ? st.name : '(삭제된 수강생)',
        LBL[b.status] || b.status, b.checkinAt ? dateTime(b.checkinAt) : '', b.auto ? '예' : '', b.memo || '']);
    });
    return toCSV(lines);
  };

  // filename('backup','json', now) → 'drum-attendance-backup-2026-09-23.json'
  B.filename = function (prefix, ext, now) {
    var p = str(prefix).trim().replace(/^drum-attendance-?/, '').replace(/[^0-9A-Za-z가-힣_-]+/g, '-').replace(/^-+|-+$/g, '');
    var e = str(ext || 'json').replace(/^\./, '') || 'json';
    return APP + (p ? '-' + p : '') + '-' + U.today(now) + '.' + e;
  };
})(typeof window !== 'undefined' ? (window.DA = window.DA || {}) : (globalThis.DA = globalThis.DA || {}));
