/* 드럼 출석부 — 인쇄 (SPEC §6.6)
 * DA.print.monthSheet(ym, {teacherId})      월간 출석부 (A4 가로): 학생 행 × 날짜 열, 기호 ○출석 △지각 ×결석 ◇공결 -휴강
 * DA.print.signLog(from, to, {studentId})   서명 대장 (A4 세로): 날짜·시각·학생·수업·상태·서명
 * DA.print.stats(report)                    통계 요약 (A4 세로): KPI + 학생별 표 + 강사·과정별 요약
 * DA.print.roomQr(roomIds?)                  v1.2 연습실 체크인 QR (방마다 A4 한 장)
 * DA.print.textReport(title, text)           v1.2 주간 브리핑 · 월간 리포트
 * DA.print.settle(result)                    v1.2 강사 정산서
 * #print-root 에 그리고 body.printing 으로 앱을 숨긴 뒤 DrumNative.print(title) 또는 window.print().
 * 화면에는 미리보기(종이 모양)와 [인쇄][닫기] 막대가 보인다. 웹은 afterprint 뒤, 안드로이드는 인쇄 창에서 돌아오면 정리.
 */
(function (DA) {
  function absL() { var s = DA.store && DA.store.data && DA.store.data.settings; return s && s.simpleMode === false ? '결석' : '당일취소'; }
  'use strict';
  var P = DA.print = DA.print || {};

  var SYMBOL = { present: '○', late: '△', absent: '×', excused: '◇', canceled: '-', unmarked: '?' };
  var LEGEND = [
    ['○', '출석'], ['△', '지각'], ['×', ''], ['◇', '공결'], ['-', '휴강'], ['?', '미확인']
  ];
  var WD = ['일', '월', '화', '수', '목', '금', '토'];

  /* ---------------- 도우미 ---------------- */
  function U() { return DA.util; }
  function h() { return DA.ui.h.apply(null, arguments); }
  function data() { return (DA.store && DA.store.data) || { settings: {}, students: [], lessons: [], exceptions: [], attendance: [], payments: [] }; }
  function settings() { return data().settings || {}; }
  function logErr(e, w) { if (DA.ui && DA.ui._logErr) DA.ui._logErr(e, 'print.' + (w || '')); else if (window.console) console.error(e); }
  function toast(msg, kind) { if (DA.ui && DA.ui.toast) DA.ui.toast(msg, { kind: kind || 'warn' }); }
  function nameIn(list, id) {
    if (!id) return '';
    for (var i = 0; list && i < list.length; i++) if (list[i] && list[i].id === id) return list[i].name || '';
    return '';
  }
  function pct(r) { return U().pct ? U().pct(r) : (r == null ? '–' : Math.round(r * 100) + '%'); }
  function rate(att, den) { return den ? att / den : null; }
  function printDate() {
    var now = new Date();
    return U().fmtDate(U().today(now), { year: true }) + ' ' + U().fmtTime(now);
  }
  function studentName(id) {
    var s = DA.store && DA.store.get ? DA.store.get('students', id) : null;
    return s ? s.name : '(삭제된 수강생)';
  }
  function lessonLabel(occ) {
    try { return DA.schedule.lessonLabel(data(), occ); } catch (e) { return (occ && occ.title) || '수업'; }
  }
  function collate(a, b) { return U().collate ? U().collate(a, b) : String(a).localeCompare(String(b), 'ko'); }

  /* ---------------- 공통 머리 ---------------- */
  function docHead(title, subLines, opts) {
    opts = opts || {};
    var s = settings();
    return h('header', { class: 'pd-head' },
      h('div', { class: 'pd-head-main' },
        h('div', { class: 'pd-academy' }, s.academyName || '드럼 학원'),
        h('h1', { class: 'pd-title' }, title),
        (subLines || []).filter(Boolean).map(function (t) { return h('div', { class: 'pd-sub' }, t); })),
      h('div', { class: 'pd-head-side' },
        opts.approve ? h('table', { class: 'pd-approve' },
          h('tr', null, h('th', null, '담당'), h('th', null, '원장')),
          h('tr', null, h('td'), h('td'))) : null,
        h('div', { class: 'pd-printed' }, '출력 ' + printDate())));
  }
  function legend(extra) {
    return h('div', { class: 'pd-legend' },
      LEGEND.map(function (l) { return h('span', null, h('b', null, l[0]), ' ', l[0] === '×' ? absL() : l[1]); }),
      extra ? h('span', { class: 'pd-legend-note' }, extra) : null);
  }

  /* ---------------- 인쇄 실행·정리 ---------------- */
  var active = null;

  function rootEl() {
    var r = document.getElementById('print-root');
    if (!r) { r = document.createElement('div'); r.id = 'print-root'; document.body.appendChild(r); }
    return r;
  }
  function setPageStyle(orientation) {
    var st = document.getElementById('da-print-page');
    if (!st) { st = document.createElement('style'); st.id = 'da-print-page'; document.head.appendChild(st); }
    st.textContent = '@page { size: A4 ' + (orientation === 'landscape' ? 'landscape' : 'portrait') + '; margin: ' +
      (orientation === 'landscape' ? '8mm 8mm 9mm' : '10mm 10mm 11mm') + '; }';
  }
  function removePageStyle() {
    var st = document.getElementById('da-print-page');
    if (st && st.parentNode) st.parentNode.removeChild(st);
  }

  function finish() {
    if (!active) return;
    var a = active; active = null;
    clearTimeout(a.fallback);
    clearTimeout(a.afterTimer);
    window.removeEventListener('afterprint', a.onAfter);
    window.removeEventListener('da:pause', a.onPause);
    window.removeEventListener('da:resume', a.onResume);
    document.removeEventListener('keydown', a.onKey);
    document.body.classList.remove('printing', 'printing-landscape', 'printing-portrait');
    removePageStyle();
    var r = rootEl();
    while (r.firstChild) r.removeChild(r.firstChild);
    try { document.title = a.prevTitle; } catch (e) { /* 무시 */ }
    window.scrollTo(0, a.scrollY || 0);
  }
  P.close = finish;
  P.isOpen = function () { return !!active; };

  function doPrint() {
    if (!active) return;
    var a = active;
    a.printed = true;
    clearTimeout(a.fallback);
    try {
      if (window.DrumNative && typeof window.DrumNative.print === 'function') {
        a.native = true;
        window.DrumNative.print(a.title);
        // 인쇄 창(다른 화면)에서 돌아오면 정리. 안 돌아오는 경우 대비 10분 뒤 정리.
        a.fallback = setTimeout(finish, 10 * 60 * 1000);
        return;
      }
    } catch (e) { logErr(e, 'native'); }
    var hasAfter = 'onafterprint' in window;
    try { window.print(); } catch (e) { logErr(e, 'window.print'); toast('이 기기에선 인쇄를 열 수 없어요', 'error'); }
    // afterprint 가 없거나 오지 않는 브라우저 대비
    a.fallback = setTimeout(function () { if (active === a) finish(); }, hasAfter ? 90 * 1000 : 2500);
  }

  // content: Node, orientation: 'landscape'|'portrait'
  function begin(title, orientation, content) {
    if (active) finish();
    var prevTitle = document.title;
    var a = active = {
      title: title, prevTitle: prevTitle, scrollY: window.pageYOffset || document.documentElement.scrollTop || 0,
      printed: false, native: false, sawPause: false, fallback: null, afterTimer: null
    };
    a.onAfter = function () {
      // 웹: window.print() 직후, 안드로이드: 인쇄 창이 닫힐 때 네이티브가 보낸다
      if (active !== a) return;
      if (a.native && !a.printed) return;
      clearTimeout(a.afterTimer);
      a.afterTimer = setTimeout(function () { if (active === a) finish(); }, 350);
    };
    a.onPause = function () { if (active === a && a.printed) a.sawPause = true; };
    a.onResume = function () {
      if (active !== a || !a.native || !a.sawPause) return;
      clearTimeout(a.afterTimer);
      a.afterTimer = setTimeout(function () { if (active === a) finish(); }, 900);
    };
    a.onKey = function (e) { if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); finish(); } };
    window.addEventListener('afterprint', a.onAfter);
    window.addEventListener('da:pause', a.onPause);
    window.addEventListener('da:resume', a.onResume);
    document.addEventListener('keydown', a.onKey);

    var ui = DA.ui;
    var bar = h('div', { class: 'print-bar', attrs: { role: 'toolbar', 'aria-label': '인쇄 미리보기' } },
      h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '닫기' }, onClick: finish }, ui.icon ? ui.icon('x', 22) : '×'),
      h('div', { class: 'print-bar-title' }, h('b', null, title), h('span', null, orientation === 'landscape' ? 'A4 가로' : 'A4 세로')),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: doPrint }, ui.icon ? ui.icon('print', 18) : null, '인쇄'));
    var doc = h('div', { class: 'print-doc ' + orientation }, content);
    var root = rootEl();
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(bar);
    root.appendChild(h('div', { class: 'print-scroll', attrs: { 'data-scroll': '' } }, doc));

    setPageStyle(orientation);
    try { document.title = title; } catch (e) { /* 무시 */ }
    document.body.classList.add('printing', 'printing-' + orientation);
    window.scrollTo(0, 0);
    // 그림이 자리 잡은 뒤 인쇄 창
    setTimeout(function () {
      if (active !== a) return;
      requestAnimationFrame(function () { requestAnimationFrame(doPrint); });
    }, 250);
    return true;
  }
  P._begin = begin;

  // 안드로이드 뒤로가기: 미리보기가 열려 있으면 닫기
  (function wrapBack() {
    var orig = window.appBack;
    if (typeof orig !== 'function' || orig._daPrintWrapped) return;
    var wrapped = function () {
      if (active) { finish(); return true; }
      return orig.apply(this, arguments);
    };
    wrapped._daPrintWrapped = true;
    window.appBack = wrapped;
  })();

  /* =================================================================
   * v1.1 출석 QR (A4 세로 한 장, 레슨실 벽에 붙이는 용도)
   * ================================================================= */
  P.qrSheet = function () {
    var s = settings();
    if (!s.qrToken) { toast('먼저 설정 → QR 출석에서 학원 QR을 만들어 주세요'); return false; }
    var qr;
    try { qr = DA.qr.svg(DA.pass.qrText(s.qrToken), { label: '출석 QR' }); } catch (e) { logErr(e, 'qrSheet'); toast('QR을 그리지 못했어요', 'error'); return false; }
    var content = h('div', { class: 'pq-sheet' },
      h('div', { class: 'pq-academy' }, s.academyName || '드럼 학원'),
      h('h1', { class: 'pq-title' }, '출석 QR'),
      h('div', { class: 'pq-qr' }, qr),
      h('ol', { class: 'pq-steps' },
        h('li', null, '휴대폰에서 「드럼 출석부」 앱을 열어요'),
        h('li', null, h('b', null, '[QR 출석]'), ' 버튼을 눌러 이 QR을 찍어요'),
        h('li', null, '이름을 고르고 서명하면 출석 완료!')),
      h('p', { class: 'pq-note' }, '휴대폰 기본 카메라로 찍지 말고, 꼭 앱 안의 [QR 출석] 버튼으로 찍어 주세요.'),
      h('div', { class: 'pq-foot' }, '코드 ' + s.qrToken.slice(0, 4) + '…' + s.qrToken.slice(-4) + ' · 출력 ' + printDate()));
    var ok = begin((s.academyName || '드럼 학원') + ' 출석 QR', 'portrait', content);
    // 좁은 화면 미리보기: 한 장 전체가 보이게 줄인다(인쇄할 때는 print.css 가 원래 크기로)
    var doc = document.querySelector('#print-root .print-doc');
    if (doc) {
      doc.classList.add('pq-doc');
      var k = (window.innerWidth - 32) / doc.offsetWidth;
      if (k < 1) doc.style.zoom = String(Math.max(0.3, Math.round(k * 1000) / 1000));
    }
    return ok;
  };

  /* =================================================================
   * v1.2 연습실 QR (방마다 A4 한 장) · 브리핑/리포트 글 · 강사 정산서
   * ================================================================= */
  P.roomQr = function (roomIds) {
    var s = settings();
    if (!s.qrToken) { toast('먼저 설정 → QR 출석에서 학원 QR을 만들어 주세요'); return false; }
    var rooms = (DA.rooms ? DA.rooms.practiceRooms(s) : []).filter(function (r) { return !roomIds || roomIds.indexOf(r.id) >= 0; });
    if (!rooms.length) { toast('연습실이 없어요. 설정 → 연습실에서 만들어 주세요'); return false; }
    var cfg = DA.rooms.cfg(s);
    var pages = rooms.map(function (r) {
      var qr;
      try { qr = DA.qr.svg(DA.rooms.qrText(s.qrToken, r.id), { label: r.name + ' 체크인 QR' }); } catch (e) { logErr(e, 'roomQr'); qr = h('div', null, 'QR 오류'); }
      return h('div', { class: 'pq-sheet pq-room' },
        h('div', { class: 'pq-academy' }, s.academyName || '드럼 학원'),
        h('h1', { class: 'pq-title' }, r.name + ' 체크인'),
        h('div', { class: 'pq-qr' }, qr),
        h('ol', { class: 'pq-steps' },
          h('li', null, '「드럼 출석부」 앱의 ', h('b', null, '[QR 출석]'), '으로 이 QR을 찍어요'),
          h('li', null, '지금 예약한 이름을 고르면 체크인 완료!'),
          h('li', null, '예약 시작 ' + cfg.checkinBefore + '분 전 ~ ' + cfg.checkinAfter + '분 후까지 체크인하지 않으면 노쇼(벌점 ' + cfg.penaltyPerNoShow + '점)예요')),
        h('p', { class: 'pq-note' }, '벌점이 ' + cfg.banThreshold + '점이 되면 ' + cfg.banDays + '일 동안 예약할 수 없어요.'),
        h('div', { class: 'pq-foot' }, '연습실 QR · ' + r.name + ' · 출력 ' + printDate()));
    });
    var ok = begin((s.academyName || '드럼 학원') + ' 연습실 QR', 'portrait', h('div', { class: 'pq-many' }, pages));
    var doc = document.querySelector('#print-root .print-doc');
    if (doc) {
      doc.classList.add('pq-doc');
      var k = (window.innerWidth - 32) / doc.offsetWidth;
      if (k < 1) doc.style.zoom = String(Math.max(0.3, Math.round(k * 1000) / 1000));
    }
    return ok;
  };

  // 여러 줄 글(주간 브리핑·월간 리포트) 그대로 인쇄
  P.textReport = function (title, text) {
    var lines = String(text || '').split('\n');
    var body = h('div', { class: 'pr-text' }, lines.map(function (l) {
      if (!l.trim()) return h('div', { class: 'pr-gap' });
      if (/^\[.*\]/.test(l)) return null;
      if (/^[·⚠ ]/.test(l)) return h('div', { class: 'pr-li' + (l.indexOf('⚠') >= 0 ? ' warn' : '') }, l);
      return h('h2', { class: 'pr-h' }, l);
    }));
    return begin(title, 'portrait', h('div', { class: 'pr-doc' }, docHead(title, [], { approve: true }), body));
  };

  P.settle = function (res) {
    var ym = res.ym;
    var title = ym.slice(0, 4) + '년 ' + (+ym.slice(5, 7)) + '월 강사 정산서';
    var fmt = function (n) { return U().fmtNumber(n || 0); };
    var t = res.totals;
    var table = h('table', { class: 'pd-table' },
      h('thead', null, h('tr', null, ['강사', '출석', '당일취소', '정산 수업', '학생', '발급 금액', '사용 금액', '정산 방식', '정산 금액'].map(function (x) { return h('th', null, x); }))),
      h('tbody', null, res.rows.map(function (e) {
        return h('tr', null, h('td', null, e.name), h('td', { class: 'num' }, e.attended), h('td', { class: 'num' }, e.absent), h('td', { class: 'num' }, e.lessons),
          h('td', { class: 'num' }, e.students), h('td', { class: 'num' }, fmt(e.issuedAmount)), h('td', { class: 'num' }, fmt(e.usedAmount)), h('td', null, e.basis),
          h('td', { class: 'num' }, e.payout == null ? '—' : fmt(e.payout)));
      })),
      h('tfoot', null, h('tr', null, h('td', null, '합계'), h('td', { class: 'num' }, t.attended), h('td', { class: 'num' }, t.absent), h('td', { class: 'num' }, t.lessons), h('td'),
        h('td', { class: 'num' }, fmt(t.issuedAmount)), h('td', { class: 'num' }, fmt(t.usedAmount)), h('td'), h('td', { class: 'num' }, fmt(t.payout)))));
    return begin(title, 'portrait', h('div', { class: 'pr-doc' },
      docHead(title, [res.includeAbsent ? '수업 수에 당일취소 포함' : '수업 수에 당일취소 제외', '사용 금액 = 회당 금액 × 수업 수'], { approve: true }), table,
      res.owner ? h('p', { class: 'pd-sub' }, '원장님 본인: 사용 금액 ' + fmt(t.usedAmount) + '원 · 발급 ' + fmt(t.issuedAmount) + '원') : null));
  };

  /* =================================================================
   * 월간 출석부
   * ================================================================= */
  P.monthSheet = function (ym, opts) {
    opts = opts || {};
    try {
      var u = U();
      if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) ym = u.ym(u.today());
      var from = ym + '-01', to = u.monthEnd(from);
      var d = data(), s = settings();
      var teacherId = opts.teacherId || '';
      var rows = DA.schedule.rows(d, from, to, new Date(), teacherId ? { teacherId: teacherId } : null);
      var days = u.rangeDays(from, to);
      var dayIdx = {};
      days.forEach(function (x, i) { dayIdx[x] = i; });

      var byStu = new Map();
      rows.forEach(function (r) {
        var e = byStu.get(r.studentId);
        if (!e) {
          e = { id: r.studentId, name: studentName(r.studentId), cells: days.map(function () { return []; }), c: { present: 0, late: 0, absent: 0, excused: 0, canceled: 0, unmarked: 0, upcoming: 0 } };
          byStu.set(r.studentId, e);
        }
        var i = dayIdx[r.date];
        if (i == null) return;
        e.cells[i].push(r);
        var st = r.status === 'pending' ? 'upcoming' : r.status;
        if (e.c[st] != null) e.c[st]++;
      });
      var list = Array.from(byStu.values()).sort(function (a, b) { return collate(a.name, b.name); });

      var monthLabel = ym.slice(0, 4) + '년 ' + (+ym.slice(5, 7)) + '월';
      var tName = teacherId ? (nameIn(s.teachers, teacherId) || '미지정') : '';
      var title = monthLabel + ' 출석부' + (tName ? ' · ' + tName : '');
      var todayY = u.today();

      var dayTotals = days.map(function () { return 0; });
      var head1 = h('tr', null,
        h('th', { class: 'ms-no', attrs: { rowspan: 2 } }, '번호'),
        h('th', { class: 'ms-name', attrs: { rowspan: 2 } }, '이름'),
        days.map(function (x) {
          var wd = u.weekday(x);
          return h('th', { class: 'ms-day' + (wd === 0 ? ' sun' : wd === 6 ? ' sat' : '') + (x === todayY ? ' today' : '') + ((s.closedDays || []).indexOf(x) >= 0 ? ' closed' : '') }, String(+x.slice(8)));
        }),
        h('th', { class: 'ms-sum', attrs: { rowspan: 2 } }, '출석'),
        h('th', { class: 'ms-sum', attrs: { rowspan: 2 } }, '지각'),
        h('th', { class: 'ms-sum', attrs: { rowspan: 2 } }, absL()),
        h('th', { class: 'ms-sum', attrs: { rowspan: 2 } }, '공결'),
        h('th', { class: 'ms-sum', attrs: { rowspan: 2 } }, '휴강'),
        h('th', { class: 'ms-rate', attrs: { rowspan: 2 } }, '출석률'));
      var head2 = h('tr', null, days.map(function (x) {
        var wd = u.weekday(x);
        return h('th', { class: 'ms-wd' + (wd === 0 ? ' sun' : wd === 6 ? ' sat' : '') }, WD[wd]);
      }));

      var body = h('tbody');
      list.forEach(function (e, n) {
        var c = e.c;
        var attended = c.present + c.late;
        var den = attended + c.absent + c.unmarked;
        body.appendChild(h('tr', null,
          h('td', { class: 'ms-no' }, String(n + 1)),
          h('td', { class: 'ms-name' }, e.name),
          e.cells.map(function (cell, i) {
            if (!cell.length) return h('td', { class: 'ms-cell' });
            var sym = '', sched = false, cls = 'ms-cell';
            cell.forEach(function (r) {
              if (r.status === 'present' || r.status === 'late') dayTotals[i]++;
              if (r.status === 'upcoming' || r.status === 'pending') { sched = true; return; }
              sym += SYMBOL[r.status] || '';
              cls += ' s-' + r.status;
            });
            if (!sym && sched) cls += ' sched';
            return h('td', { class: cls, attrs: { title: u.fmtDate(cell[0].date) } }, sym);
          }),
          h('td', { class: 'ms-sum' }, String(attended)),
          h('td', { class: 'ms-sum' }, c.late ? String(c.late) : ''),
          h('td', { class: 'ms-sum' }, c.absent ? String(c.absent) : ''),
          h('td', { class: 'ms-sum' }, c.excused ? String(c.excused) : ''),
          h('td', { class: 'ms-sum' }, c.canceled ? String(c.canceled) : ''),
          h('td', { class: 'ms-rate' }, pct(rate(attended, den)))));
      });
      // 빈 줄(손으로 적을 수 있게) — 최소 3줄
      var blanks = Math.max(3, Math.min(8, 14 - list.length));
      for (var b = 0; b < blanks; b++) {
        body.appendChild(h('tr', { class: 'ms-blank' },
          h('td', { class: 'ms-no' }), h('td', { class: 'ms-name' }),
          days.map(function () { return h('td', { class: 'ms-cell' }); }),
          h('td', { class: 'ms-sum' }), h('td', { class: 'ms-sum' }), h('td', { class: 'ms-sum' }),
          h('td', { class: 'ms-sum' }), h('td', { class: 'ms-sum' }), h('td', { class: 'ms-rate' })));
      }
      var totP = 0, totL = 0, totA = 0, totE = 0, totC = 0, totU = 0;
      list.forEach(function (e) { totP += e.c.present; totL += e.c.late; totA += e.c.absent; totE += e.c.excused; totC += e.c.canceled; totU += e.c.unmarked; });
      var foot = h('tfoot', null, h('tr', null,
        h('td', { class: 'ms-foot-label', attrs: { colspan: 2 } }, '출석 인원'),
        dayTotals.map(function (v) { return h('td', { class: 'ms-cell ms-foot' }, v ? String(v) : ''); }),
        h('td', { class: 'ms-sum' }, String(totP + totL)),
        h('td', { class: 'ms-sum' }, totL ? String(totL) : ''),
        h('td', { class: 'ms-sum' }, totA ? String(totA) : ''),
        h('td', { class: 'ms-sum' }, totE ? String(totE) : ''),
        h('td', { class: 'ms-sum' }, totC ? String(totC) : ''),
        h('td', { class: 'ms-rate' }, pct(rate(totP + totL, totP + totL + totA + totU)))));

      var sub = [
        u.fmtRange(from, to) + ' · 수강생 ' + list.length + '명' + (tName ? ' · 담당 ' + tName : ' · 전체 강사'),
        list.length ? '' : '이 달에 해당하는 수업이 없어요. 빈 출석부로 인쇄돼요.'
      ];
      var content = h('div', { class: 'pd month-sheet' },
        docHead(title, sub, { approve: true }),
        h('table', { class: 'pd-table ms-table' },
          h('colgroup', null, h('col', { class: 'ms-no' }), h('col', { class: 'ms-name' }),
            days.map(function () { return h('col', { class: 'ms-day' }); }),
            h('col', { class: 'ms-sum' }), h('col', { class: 'ms-sum' }), h('col', { class: 'ms-sum' }),
            h('col', { class: 'ms-sum' }), h('col', { class: 'ms-sum' }), h('col', { class: 'ms-rate' })),
          h('thead', null, head1, head2), body, foot),
        legend('회색 칸 = 예정된 수업 · 빈칸 = 수업 없음 · 출석률 = (출석+지각) ÷ (출석+지각+'+absL()+'+미확인)'));
      return begin(title, 'landscape', content);
    } catch (e) {
      logErr(e, 'monthSheet');
      toast('출석부를 만들지 못했어요', 'error');
      return false;
    }
  };

  /* =================================================================
   * 서명 대장
   * ================================================================= */
  P.signLog = function (from, to, opts) {
    opts = opts || {};
    try {
      var u = U();
      var t = u.today();
      if (!u.isYmd(from)) from = u.monthStart(t);
      if (!u.isYmd(to)) to = t;
      if (from > to) { var tmp = from; from = to; to = tmp; }
      var d = data();
      var studentId = opts.studentId || '';
      var rows = DA.schedule.rows(d, from, to, new Date(), studentId ? { studentId: studentId } : null)
        .filter(function (r) {
          var rec = r.record;
          if (!rec) return false;
          return rec.method === 'sign' || r.status === 'present' || r.status === 'late';
        });
      rows.sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        var sa = (a.occ && a.occ.start) || '', sb = (b.occ && b.occ.start) || '';
        if (sa !== sb) return sa < sb ? -1 : 1;
        var ta = (a.record && a.record.signedAt) || '', tb = (b.record && b.record.signedAt) || '';
        if (ta !== tb) return ta < tb ? -1 : 1;
        return collate(studentName(a.studentId), studentName(b.studentId));
      });
      var sName = studentId ? studentName(studentId) : '';
      var title = '서명 대장' + (sName ? ' · ' + sName : '');
      if (!rows.length) {
        toast(u.fmtRange(from, to) + (sName ? ' ' + sName + ' 학생의' : '') + ' 출석 기록이 없어요');
        return false;
      }
      var signed = 0, manual = 0;
      var body = h('tbody');
      var lastDate = null;
      rows.forEach(function (r, n) {
        var rec = r.record, occ = r.occ || {};
        var hasSig = rec.signature && rec.signature.strokes && rec.signature.strokes.length;
        if (rec.method === 'sign' && hasSig) signed++; else manual++;
        var sigCell = h('td', { class: 'sl-sig' });
        if (hasSig && DA.sig && DA.sig.svgString) {
          sigCell.appendChild(h('span', { class: 'sl-sig-img', html: DA.sig.svgString(rec.signature, { color: '#000', height: 40 }) }));
        } else {
          sigCell.appendChild(h('span', { class: 'sl-manual' }, rec.method === 'sign' ? '(서명 없음)' : '직접 입력'));
        }
        var newDay = r.date !== lastDate; lastDate = r.date;
        var kind = occ.kind && occ.kind !== 'regular' && DA.C && DA.C.KIND ? ' [' + DA.C.KIND[occ.kind] + ']' : '';
        body.appendChild(h('tr', { class: newDay && n ? 'sl-newday' : '' },
          h('td', { class: 'sl-no' }, String(n + 1)),
          h('td', { class: 'sl-date' }, u.fmtDate(r.date)),
          h('td', { class: 'sl-lesson' }, h('b', null, occ.start || ''), ' ', lessonLabel(occ) + kind,
            occ.teacherId ? h('div', { class: 'sl-muted' }, nameIn(settings().teachers, occ.teacherId)) : null),
          h('td', { class: 'sl-name' }, studentName(r.studentId)),
          h('td', { class: 'sl-status s-' + r.status }, (DA.C && DA.C.STATUS && DA.C.STATUS[r.status]) || r.status),
          h('td', { class: 'sl-time' }, rec.signedAt ? u.fmtTime(new Date(rec.signedAt)) : '–'),
          sigCell));
      });
      var content = h('div', { class: 'pd sign-log' },
        docHead(title, [
          u.fmtRange(from, to) + (sName ? ' · ' + sName : ' · 전체 학생'),
          '총 ' + rows.length + '건 · 서명 ' + signed + '건' + (manual ? ' · 직접 입력 ' + manual + '건' : '')
        ], { approve: true }),
        h('table', { class: 'pd-table sl-table' },
          h('thead', null, h('tr', null,
            h('th', { class: 'sl-no' }, '번호'), h('th', { class: 'sl-date' }, '날짜'), h('th', { class: 'sl-lesson' }, '수업'),
            h('th', { class: 'sl-name' }, '학생'), h('th', { class: 'sl-status' }, '상태'), h('th', { class: 'sl-time' }, '서명 시각'),
            h('th', { class: 'sl-sig' }, '서명'))),
          body),
        h('div', { class: 'pd-note' }, '서명은 학생이 기기 화면에 직접 쓴 필적이에요. 직접 입력은 선생님이 출석을 표시한 기록이에요.'));
      return begin(title, 'portrait', content);
    } catch (e) {
      logErr(e, 'signLog');
      toast('서명 대장을 만들지 못했어요', 'error');
      return false;
    }
  };

  /* =================================================================
   * 통계 요약
   * ================================================================= */
  function filterText(report) {
    var f = (report && report.filter) || {}, s = settings(), parts = [];
    if (f.studentId) parts.push('학생 ' + studentName(f.studentId));
    if (f.teacherId) parts.push('강사 ' + (nameIn(s.teachers, f.teacherId) || '미지정'));
    if (f.courseId) parts.push('과정 ' + (nameIn(s.courses, f.courseId) || '미지정'));
    if (f.levelId) parts.push('레벨 ' + (nameIn(s.levels, f.levelId) || '미지정'));
    if (f.roomId) parts.push('방 ' + (nameIn(s.rooms, f.roomId) || '미지정'));
    if (f.kinds && f.kinds.length && DA.C && DA.C.KIND) parts.push('종류 ' + f.kinds.map(function (k) { return DA.C.KIND[k] || k; }).join('·'));
    return parts.length ? '조건: ' + parts.join(', ') : '조건: 전체';
  }
  function kpi(label, value, sub) {
    return h('div', { class: 'ps-kpi' }, h('div', { class: 'ps-kpi-label' }, label), h('div', { class: 'ps-kpi-value' }, value), sub ? h('div', { class: 'ps-kpi-sub' }, sub) : null);
  }
  function n0(v) { return v == null ? '' : String(v); }
  function groupTable(title, list) {
    list = (list || []).filter(function (g) { return g && (g.scheduled || g.attended || g.rows); });
    if (!list.length) return null;
    return h('section', { class: 'ps-sec' },
      h('h2', null, title),
      h('table', { class: 'pd-table ps-table' },
        h('thead', null, h('tr', null,
          h('th', { class: 'l' }, '이름'), h('th', null, '대상'), h('th', null, '출석'), h('th', null, '지각'),
          h('th', null, absL()), h('th', null, '공결'), h('th', null, '휴강'), h('th', null, '출석률'), h('th', null, '학생'))),
        h('tbody', null, list.map(function (g) {
          var stu = Array.isArray(g.students) ? g.students.length : g.students;
          return h('tr', null,
            h('td', { class: 'l' }, g.name || g.label || '미지정'), h('td', null, n0(g.scheduled)), h('td', null, n0(g.attended)),
            h('td', null, n0(g.late)), h('td', null, n0(g.absent)), h('td', null, n0(g.excused)), h('td', null, n0(g.canceled)),
            h('td', { class: 'b' }, pct(g.rate)), h('td', null, n0(stu)));
        }))));
  }
  P.stats = function (report) {
    try {
      var u = U();
      if (!report || !report.totals) {
        var s0 = settings();
        var pr = DA.stats.presetRange('thisMonth', new Date(), s0.weekStart, data());
        report = DA.stats.compute(data(), { from: pr.from, to: pr.to }, new Date());
      }
      var t = report.totals || {};
      var range = report.range || {};
      var rangeText = range.label || (range.from && range.to ? u.fmtRange(range.from, range.to) : '');
      var title = '출결 통계' + (rangeText ? ' · ' + rangeText : '');
      var avgOff = t.avgSignOffsetMin;
      var offText = avgOff == null ? '–' : (Math.round(avgOff) === 0 ? '정시' : (avgOff < 0 ? Math.abs(Math.round(avgOff)) + '분 일찍' : Math.round(avgOff) + '분 늦게'));
      var sigTotal = (t.signed || 0) + (t.manual || 0);
      var kpis = h('div', { class: 'ps-kpis' },
        kpi('출석률', pct(t.rate), '출석 ' + (t.attended || 0) + ' / 대상 ' + ((t.present || 0) + (t.late || 0) + (t.absent || 0) + (t.unmarked || 0))),
        kpi('출석', n0(t.attended || 0), '정시 ' + (t.present || 0) + ' · 지각 ' + (t.late || 0)),
        kpi('지각률', pct(t.lateRate), null),
        kpi(absL(), n0(t.absent || 0), t.absentAuto ? '기록 없어 자동 ' + t.absentAuto : null),
        kpi('공결 · 휴강', (t.excused || 0) + ' · ' + (t.canceled || 0), null),
        kpi('보강 진행', n0(t.makeupHeld || 0), t.trialHeld ? '체험 ' + t.trialHeld : null),
        kpi('활성 수강생', n0(t.activeStudents || 0) + '명', '신규 ' + (t.newStudents || 0) + ' · 퇴원 ' + (t.leftStudents || 0)),
        kpi('서명 비율', pct(sigTotal ? (t.signed || 0) / sigTotal : null), '평균 서명 ' + offText));

      var studs = (report.byStudent || []).filter(function (e) { return e && (e.rows || e.scheduled || e.present || e.late); })
        .slice().sort(function (a, b) { return collate(a.name, b.name); });
      var stuTable = studs.length ? h('section', { class: 'ps-sec' },
        h('h2', null, '학생별 (' + studs.length + '명)'),
        h('table', { class: 'pd-table ps-table ps-students' },
          h('thead', null, h('tr', null,
            h('th', { class: 'l' }, '이름'), h('th', { class: 'l' }, '과정'), h('th', null, '대상'), h('th', null, '출석'),
            h('th', null, '지각'), h('th', null, absL()), h('th', null, '공결'), h('th', null, '출석률'),
            h('th', null, '연속'), h('th', null, '보강 필요'), h('th', { class: 'l' }, '수강권'))),
          h('tbody', null, studs.map(function (e) {
            return h('tr', null,
              h('td', { class: 'l b' }, e.name), h('td', { class: 'l' }, e.courseName || ''),
              h('td', null, n0(e.scheduled)), h('td', null, n0((e.present || 0) + (e.late || 0))), h('td', null, n0(e.late)),
              h('td', null, n0(e.absent)), h('td', null, n0(e.excused)), h('td', { class: 'b' }, pct(e.rate)),
              h('td', null, e.streak ? String(e.streak) : ''), h('td', null, e.makeupOwed ? String(e.makeupOwed) : ''),
              h('td', { class: 'l' + (e.pass && e.pass.warn ? ' warn' : '') }, (e.pass && e.pass.label) || ''));
          })))) : h('p', { class: 'pd-note' }, '이 기간에 해당하는 출결 기록이 없어요.');

      var monthTable = (report.byMonth || []).length > 1 ? groupTable('월별', report.byMonth.map(function (m) {
        return { name: m.label, scheduled: m.scheduled, attended: m.attended, late: m.late, absent: m.absent, excused: m.excused, canceled: m.canceled, rate: m.rate, students: m.students, rows: m.scheduled };
      })) : null;
      var risk = (report.atRisk || []).slice(0, 10);
      var riskSec = risk.length ? h('section', { class: 'ps-sec ps-risk' },
        h('h2', null, '살펴볼 학생'),
        h('ul', null, risk.map(function (r) {
          return h('li', null, h('b', null, r.name), ' — ', (r.reasons || []).map(function (x) { return x.text; }).join(', '));
        }))) : null;

      var content = h('div', { class: 'pd stats-sheet' },
        docHead(title, [filterText(report), range.days ? '기간 ' + range.days + '일' : ''], {}),
        kpis,
        stuTable,
        h('div', { class: 'ps-groups' },
          groupTable('강사별', report.byTeacher),
          groupTable('과정별', report.byCourse),
          groupTable('레벨별', report.byLevel),
          monthTable),
        riskSec,
        h('div', { class: 'pd-note' }, '출석률 = (출석+지각) ÷ (출석+지각+'+absL()+'+미확인). 공결·휴강은 출석률 계산에서 빠져요.'));
      return begin(title, 'portrait', content);
    } catch (e) {
      logErr(e, 'stats');
      toast('통계 인쇄를 준비하지 못했어요', 'error');
      return false;
    }
  };
})(window.DA = window.DA || {});
