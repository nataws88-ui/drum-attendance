/* 드럼 출석부 — 설정 화면 (SPEC §6.6)
 * 학원 정보 · 수업 시간 · 출결 규칙 · 강사/과정/레벨/방 · 휴원일 · 키오스크 PIN · 보호자 문자 · 효과음/테마 ·
 * 인쇄 · 데이터(백업/복원/CSV/예시/초기화) · 저장 공간 · 설치 안내 · 앱 정보.
 * 공개 도우미(없을 때만 정의): DA.ui.saveText(filename, mime, text) → Promise<bool>,
 *                              DA.ui.openTextFile(accept) → Promise<{text, name}|null>
 */
(function (DA) {
  'use strict';
  var ui = DA.ui;
  if (!ui || !ui.registerView) return;
  var h = ui.h;

  /* =================================================================
   * 파일 저장·열기 도우미
   * ================================================================= */
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 4000);
  }
  // → Promise<'native'|'share'|'download'|'cancel'>
  function saveFileKind(filename, mime, text) {
    if (typeof ui.saveFile === 'function') return Promise.resolve(ui.saveFile(filename, mime, text));
    mime = mime || 'application/octet-stream';
    try {
      if (window.DrumNative && typeof window.DrumNative.saveFile === 'function') {
        window.DrumNative.saveFile(filename, mime, String(text));
        return Promise.resolve('native');
      }
    } catch (e) { /* 아래로 */ }
    var blob = new Blob([text], { type: mime });
    try {
      var file = new File([blob], filename, { type: mime });
      if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: filename }).then(function () { return 'share'; }, function (err) {
          if (err && err.name === 'AbortError') return 'cancel';
          downloadBlob(blob, filename); return 'download';
        });
      }
    } catch (e) { /* 아래로 */ }
    downloadBlob(blob, filename);
    return Promise.resolve('download');
  }
  if (typeof ui.saveText !== 'function') {
    ui.saveText = function (filename, mime, text) {
      return saveFileKind(filename, mime, text).then(function (r) { return r !== 'cancel'; }, function () { return false; });
    };
  }
  function openTextFallback(accept) {
    return new Promise(function (resolve) {
      var settled = false;
      function fin(v) { if (!settled) { settled = true; resolve(v); } }
      if (window.DrumNative && typeof window.DrumNative.openFile === 'function') {
        var prev = window.DA_onNativeFile;
        window.DA_onNativeFile = function (text, name) {
          window.DA_onNativeFile = prev;
          fin({ text: String(text == null ? '' : text), name: name || '' });
        };
        try { window.DrumNative.openFile(accept || '*/*'); return; } catch (e) { window.DA_onNativeFile = prev; }
      }
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      if (accept) inp.setAttribute('accept', accept);
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        if (inp.parentNode) inp.parentNode.removeChild(inp);
        if (!f) { fin(null); return; }
        var rd = new FileReader();
        rd.onload = function () { fin({ text: String(rd.result || ''), name: f.name }); };
        rd.onerror = function () { fin(null); };
        rd.readAsText(f, 'utf-8');
      });
      inp.addEventListener('cancel', function () { if (inp.parentNode) inp.parentNode.removeChild(inp); fin(null); });
      document.body.appendChild(inp);
      inp.click();
    });
  }
  if (typeof ui.openTextFile !== 'function') {
    ui.openTextFile = function (accept) {
      return typeof ui.openFile === 'function' ? ui.openFile(accept) : openTextFallback(accept);
    };
  }

  /* =================================================================
   * 상태(다시 그려도 유지)
   * ================================================================= */
  var S = {
    listTab: 'teachers',
    reorder: false,
    calYm: null,
    showPastClosed: false,
    storage: null,           // {estimate, persisted, loaded}
    storageLoading: false,
    printYm: null,
    printTeacher: '',
    logPreset: 'thisMonth',
    logFrom: null,
    logTo: null,
    logStudent: '',
    busy: '',
    jumpedFor: null
  };

  var LISTS = {
    teachers: { label: '강사', unit: '명', color: true, hint: '시간표 블록과 통계의 강사 색으로 쓰여요.' },
    courses: { label: '과정', unit: '개', color: true, hint: '수강생 분류와 과정별 통계·매출에 쓰여요.' },
    levels: { label: '레벨', unit: '개', color: false, hint: '위에서부터 입문 → 전문 순으로 두면 보기 좋아요.' },
    rooms: { label: '방', unit: '개', color: false, hint: '같은 시간에 한 방에 수업이 겹치면 알려 드려요.' }
  };
  var DEFAULT_SMS = '[{학원}] {이름} 학생이 {시각}에 출석했습니다.';

  /* =================================================================
   * 도우미
   * ================================================================= */
  function U() { return DA.util; }
  function data() { return (DA.store && DA.store.data) || { settings: {}, students: [], lessons: [], exceptions: [], attendance: [], payments: [] }; }
  function settings() { return data().settings || {}; }
  function ic(n, s) { return ui.icon ? ui.icon(n, s) : h('span'); }
  function logErr(e, w) { if (ui._logErr) ui._logErr(e, 'settings.' + (w || '')); }
  function toastErr(e, fallback) {
    logErr(e);
    ui.toast((e && e.message) || fallback || '처리하지 못했어요', { kind: 'error' });
  }
  function save(patch) {
    return DA.store.saveSettings(patch).catch(function (e) { toastErr(e, '설정을 저장하지 못했어요'); throw e; });
  }
  function quietSave(patch) { save(patch).catch(function () { /* 토스트로 알림 */ }); }
  function clampNum(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) n = dflt;
    return Math.max(lo, Math.min(hi, n));
  }
  function fmtBytes(n) {
    if (n == null || !isFinite(n)) return '–';
    if (n < 1024) return n + 'B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + 'KB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + 'MB';
    return (n / 1073741824).toFixed(1) + 'GB';
  }
  function isIOS() { return U().isIOS ? U().isIOS() : /iPad|iPhone|iPod/.test(navigator.userAgent || ''); }
  function isStandalone() { return U().isStandalone ? U().isStandalone() : false; }
  function isAndroidApp() { return !!window.DrumNative; }
  function nativeVersion() {
    try { return window.DrumNative && typeof window.DrumNative.version === 'function' ? String(window.DrumNative.version()) : ''; } catch (e) { return ''; }
  }
  function appVersion() { return (DA.app && DA.app.version) || DA.VERSION || '1.2.1'; }
  function simple() { return settings().simpleMode !== false; }
  function monthLabel(ym) { return ym.slice(0, 4) + '년 ' + (+ym.slice(5, 7)) + '월'; }
  function addYm(ym, n) { return U().ym(U().addMonths(ym + '-01', n)); }
  function relAgo(iso) {
    var t = new Date(iso).getTime();
    if (!iso || isNaN(t)) return '';
    var diff = Date.now() - t;
    if (diff < 60000) return '방금';
    if (diff < 3600000) return Math.floor(diff / 60000) + '분 전';
    var d0 = U().diffDays(U().ymdOfIso(iso), U().today());
    if (d0 <= 0) return '오늘 ' + U().fmtTime(new Date(iso));
    if (d0 === 1) return '어제';
    return d0 + '일 전';
  }
  function hasRealData() {
    var d = data();
    return ['students', 'lessons', 'exceptions', 'attendance', 'payments'].some(function (k) {
      return (d[k] || []).some(function (x) { return x && !x.demo; });
    });
  }
  function countsText(c) {
    return '수강생 ' + (c.students || 0) + '명 · 정규 수업 ' + (c.lessons || 0) + '개 · 출석 기록 ' + (c.attendance || 0) + '건 · 결제 ' + (c.payments || 0) + '건';
  }
  function curCounts() {
    var d = data();
    return { students: (d.students || []).length, lessons: (d.lessons || []).length, exceptions: (d.exceptions || []).length, attendance: (d.attendance || []).length, payments: (d.payments || []).length };
  }
  function busy(key, fn) {
    if (S.busy) return;
    S.busy = key;
    var done = function () { S.busy = ''; };
    try {
      var p = fn();
      if (p && typeof p.then === 'function') p.then(done, done); else done();
    } catch (e) { done(); toastErr(e); }
  }

  /* ---------- 공용 부품 ---------- */
  function card(id, icon, title, sub) {
    var children = Array.prototype.slice.call(arguments, 4);
    return h('section', { class: 'card st-card', id: 'set-' + id, attrs: { 'aria-labelledby': 'set-' + id + '-t' } },
      h('div', { class: 'card-h' },
        h('span', { class: 'st-ic', attrs: { 'aria-hidden': 'true' } }, ic(icon, 20)),
        h('h2', { id: 'set-' + id + '-t' }, title),
        sub ? h('small', { class: 'muted' }, sub) : null),
      children);
  }
  function row(label, desc, control, opts) {
    opts = opts || {};
    return h('div', { class: 'st-row' + (opts.stack ? ' stack' : '') },
      h('div', { class: 'st-row-main' },
        h('div', { class: 'st-row-label' }, label),
        desc ? h('div', { class: 'st-row-desc', ref: opts.descRef }, desc) : null),
      control ? h('div', { class: 'st-row-ctl' }, control) : null);
  }
  var switchSeq = 0;
  function switchRow(label, desc, checked, onChange) {
    var t = ui.toggle(checked, onChange, label);
    var id = 'set-sw-' + (++switchSeq);
    t.input.id = id;
    return h('div', { class: 'st-row st-switch' },
      h('label', { class: 'st-row-main st-row-labelwrap', attrs: { for: id } },
        h('div', { class: 'st-row-label' }, label),
        desc ? h('div', { class: 'st-row-desc' }, desc) : null),
      h('div', { class: 'st-row-ctl' }, t));
  }
  // [−][숫자][+] 단위  — 변경은 onSave(v)
  function stepper(id, value, o, onSave) {
    var timer = null;
    var input = ui.input({
      type: 'number', value: value, id: id, min: o.min, max: o.max, step: o.step, inputmode: 'numeric',
      attrs: { 'aria-label': o.label || '' },
      onChange: function (v) { commit(v); },
      onEnter: function (v, el) { el.blur(); }
    });
    function commit(v) {
      clearTimeout(timer);
      var n = clampNum(v, o.min, o.max, value);
      input.value = n;
      if (o.onPreview) o.onPreview(n);
      if (n !== value) onSave(n);
    }
    function bump(d) {
      var cur = clampNum(input.value, o.min, o.max, value);
      var n = Math.max(o.min, Math.min(o.max, cur + d));
      input.value = n;
      if (o.onPreview) o.onPreview(n);
      ui.haptic('select');
      clearTimeout(timer);
      timer = setTimeout(function () { if (n !== value) onSave(n); }, 450);
    }
    return h('div', { class: 'stepper st-stepper' },
      h('button', { class: 'btn', type: 'button', attrs: { 'aria-label': '줄이기' }, onClick: function () { bump(-o.step); } }, ic('minus', 18)),
      input,
      h('button', { class: 'btn', type: 'button', attrs: { 'aria-label': '늘리기' }, onClick: function () { bump(o.step); } }, ic('plus', 18)),
      o.unit ? h('span', { class: 'st-unit' }, o.unit) : null);
  }

  /* =================================================================
   * v1.1 이용권 상품
   * ================================================================= */
  function productUsage() {
    var m = {};
    (data().students || []).forEach(function (x) { if (x.courseId) { var u = m[x.courseId] || (m[x.courseId] = { students: 0, issues: 0 }); u.students++; } });
    (data().payments || []).forEach(function (p) { if (p.productId) { var u = m[p.productId] || (m[p.productId] = { students: 0, issues: 0 }); u.issues++; } });
    return m;
  }
  function editProduct(item) {
    var isNew = !item;
    var list = (settings().passProducts || []).slice();
    var f = item ? Object.assign({}, item) : { name: '', count: 4, amount: 0, minutes: 50, color: nextColor(list) };
    var nameIn = ui.input({ value: f.name, placeholder: '예: 주말반', maxLength: 20 });
    var cntIn = ui.input({ type: 'number', value: f.count, min: 1, max: 99, step: 1, inputmode: 'numeric' });
    var amtIn = ui.input({ type: 'text', value: f.amount ? U().fmtNumber(f.amount) : '', placeholder: '예: 220,000', inputmode: 'numeric', maxLength: 13 });
    var minIn = ui.input({ type: 'number', value: f.minutes, min: 10, max: 240, step: 5, inputmode: 'numeric' });
    var unit = h('div', { class: 'st-hint' });
    function amt() { return parseInt(String(amtIn.value).replace(/[^0-9]/g, ''), 10) || 0; }
    function paint() {
      var c = clampNum(cntIn.value, 1, 99, 1);
      unit.textContent = '회당 ' + (c ? U().fmtMoney(Math.round(amt() / c)) : '—') + ' · 발급할 때 횟수·금액은 바꿀 수 있어요.';
    }
    amtIn.addEventListener('input', function () { var v = amt(); amtIn.value = v ? U().fmtNumber(v) : ''; paint(); });
    cntIn.addEventListener('input', paint);
    var color = f.color || '#D9480F';
    var sw = h('div', { class: 'st-swatches' });
    function paintSw() {
      ui.clear(sw);
      palette().forEach(function (c) {
        sw.appendChild(h('button', { class: 'st-swatch' + (c.toUpperCase() === String(color).toUpperCase() ? ' on' : ''), type: 'button', style: { background: c }, attrs: { 'aria-label': c }, onClick: function () { color = c; paintSw(); } }));
      });
    }
    paintSw(); paint();
    var usage = productUsage()[f.id] || { students: 0, issues: 0 };
    var actions = [{ label: '취소', kind: 'ghost' }];
    if (!isNew) actions.push({
      label: '삭제', kind: 'danger', onClick: function () {
        var msg = '‘' + f.name + '’ 상품을 목록에서 지울까요?' + (usage.students || usage.issues ? '\n이미 발급한 ' + usage.issues + '건과 이 반 학생 ' + usage.students + '명의 기록은 그대로 남아요.' : '');
        return ui.confirm(msg, { title: '이용권 상품 삭제', ok: '삭제', danger: true }).then(function (ok) {
          if (!ok) return false;
          return save({ passProducts: (settings().passProducts || []).filter(function (x) { return x.id !== f.id; }) }).then(function () { ui.toast(f.name + ' 삭제했어요'); });
        });
      }
    });
    actions.push({
      label: isNew ? '추가' : '저장', kind: 'primary', onClick: function () {
        var name = nameIn.value.trim();
        if (!name) { ui.toast('이름을 입력해 주세요', { kind: 'warn' }); nameIn.focus(); return false; }
        var cur = (settings().passProducts || []).slice();
        if (cur.some(function (x) { return x.name === name && x.id !== f.id; })) { ui.toast('같은 이름의 상품이 이미 있어요', { kind: 'warn' }); return false; }
        var rec = Object.assign({}, f, { name: name, count: clampNum(cntIn.value, 1, 99, 4), amount: amt(), minutes: clampNum(minIn.value, 10, 240, 50), color: color });
        if (isNew) { rec.id = U().uid(); cur.push(rec); } else cur = cur.map(function (x) { return x.id === f.id ? rec : x; });
        return save({ passProducts: cur }).then(function () { ui.haptic('success'); ui.toast(name + (isNew ? ' 추가했어요' : ' 저장했어요')); });
      }
    });
    ui.sheet({
      title: isNew ? '이용권 상품 추가' : '이용권 상품 수정', autofocus: false,
      content: h('div', { class: 'v-settings' },
        ui.field('이름', nameIn),
        h('div', { class: 'field-row' }, ui.field('한 달 횟수', cntIn), ui.field('수업 길이(분)', minIn)),
        ui.field('한 달 금액 (원)', amtIn),
        unit,
        ui.field('색', sw)),
      actions: actions
    });
  }
  function passCard(s) {
    var list = s.passProducts || [];
    var usage = productUsage();
    var items = h('div', { class: 'list flat st-items' });
    list.forEach(function (p) {
      var u = usage[p.id] || { students: 0, issues: 0 };
      items.appendChild(h('button', { class: 'list-item st-item st-prod', type: 'button', onClick: function () { editProduct(p); } },
        h('span', { class: 'st-color', style: { background: p.color || 'var(--accent)' }, attrs: { 'aria-hidden': 'true' } }),
        h('div', { class: 'li-main' },
          h('div', { class: 'li-title' }, p.name, ic('edit', 14)),
          h('div', { class: 'li-sub num' }, '월 ' + p.count + '회 · ' + U().fmtNumber(p.amount) + '원 · 회당 ' + U().fmtNumber(p.count ? Math.round(p.amount / p.count) : 0) + '원 · ' + p.minutes + '분'),
          h('div', { class: 'li-sub' }, '학생 ' + u.students + '명 · 발급 ' + u.issues + '건')),
        ic('chevR', 18)));
    });
    if (!list.length) items.appendChild(h('div', { class: 'st-hint' }, '상품이 없어요. 발급할 때는 ‘직접 입력’으로 횟수·금액을 넣을 수 있어요.'));
    return card('pass', 'card', '이용권 상품', list.length + '개',
      h('div', { class: 'st-hint' }, '모든 이용권은 한 달 단위(매달 1일 기준)예요. 수강생의 ‘반’이 곧 이용권 상품이고, 발급할 때 횟수·금액을 바꾸거나 [직접 입력]으로 첫 달 일할 등을 넣을 수 있어요.'),
      items,
      h('div', { class: 'st-list-actions st-gap' },
        h('button', { class: 'btn btn-soft', type: 'button', onClick: function () { editProduct(null); } }, ic('plus', 18), '상품 추가')));
  }

  /* =================================================================
   * v1.1 QR 출석
   * ================================================================= */
  function newQr(confirmFirst) {
    function go() {
      var tok = DA.pass.newToken();
      return save({ qrToken: tok }).then(function () { ui.haptic('success'); ui.toast(confirmFirst ? '새 QR을 만들었어요. 새로 인쇄해 붙여 주세요.' : '학원 출석 QR을 만들었어요'); });
    }
    if (!confirmFirst) return go();
    ui.confirm('새 QR을 만들면 지금 붙어 있는 QR은 더 이상 쓸 수 없어요.\n새 QR을 인쇄해 바꿔 붙여야 해요. 계속할까요?', { title: 'QR 새로 만들기', ok: '새로 만들기', danger: true })
      .then(function (ok) { if (ok) go().catch(function () {}); });
  }
  function qrCard(s) {
    var tok = s.qrToken;
    var body;
    if (!tok) {
      body = h('div', { class: 'st-qr-empty' },
        h('p', null, '레슨실 벽에 붙일 학원 전용 QR을 만들어요. 앱의 [QR 출석]으로 이 QR을 찍어야 서명할 수 있어서, 원장님이 레슨실에 있을 때만 출석을 받을 수 있어요.'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: function () { newQr(false).catch(function () {}); } }, ic('qr', 18), '학원 QR 만들기'));
    } else {
      var box = h('div', { class: 'st-qr-box' });
      try { box.appendChild(DA.qr.svg(DA.pass.qrText(tok), { label: (s.academyName || '학원') + ' 출석 QR' })); } catch (e) { logErr(e, 'qr.svg'); box.appendChild(h('div', { class: 'st-hint' }, 'QR을 그리지 못했어요: ' + (e && e.message))); }
      body = h('div', null,
        h('div', { class: 'st-qr-wrap' }, box,
          h('div', { class: 'st-qr-side' },
            h('div', { class: 'st-row-label' }, (s.academyName || '드럼 학원') + ' 출석 QR'),
            h('div', { class: 'st-row-desc num' }, '코드 ' + tok.slice(0, 4) + '…' + tok.slice(-4)),
            h('div', { class: 'st-qr-btns' },
              h('button', { class: 'btn btn-primary', type: 'button', onClick: function () { if (DA.print && DA.print.qrSheet) DA.print.qrSheet(); } }, ic('print', 18), 'QR 인쇄'),
              h('button', { class: 'btn', type: 'button', onClick: function () { DA.actions.qrAttend({}); } }, ic('camera', 18), '찍어 보기'),
              h('button', { class: 'btn btn-ghost', type: 'button', onClick: function () { newQr(true); } }, ic('refresh', 18), 'QR 새로 만들기')))));
    }
    return card('qr', 'qr', 'QR 출석', tok ? '사용 중' : null,
      body,
      h('div', { class: 'banner st-gap' }, ic('lock', 18), h('div', { class: 'banner-body' },
        h('b', null, '출석은 무조건 QR로만 받아요. '),
        '레슨실 QR을 찍어야 서명란이 나와요. 당일취소 처리·기록 수정은 QR 없이 할 수 있어요.')),
      h('div', { class: 'banner info st-gap' }, ic('info', 18), h('div', { class: 'banner-body' },
        h('b', null, '아이폰은 꼭 앱 안의 [QR 출석] 버튼으로 찍어 주세요. '),
        '아이폰 기본 카메라로 찍으면 사파리가 열리는데, 사파리와 홈 화면 앱은 저장소가 따로라 기록이 보이지 않아요. 처음 한 번 카메라 권한을 ‘허용’해 주세요.')));
  }

  /* =================================================================
   * 학원 정보 · 수업 시간
   * ================================================================= */
  function academyCard(s) {
    var name = ui.input({
      id: 'set-academy-name', value: s.academyName || '', placeholder: '예: 쿵짝 드럼 학원', maxLength: 30,
      onChange: function (v, el) {
        var n = String(v || '').trim();
        if (!n) { el.value = s.academyName || '드럼 학원'; ui.toast('학원 이름을 비울 수는 없어요', { kind: 'warn' }); return; }
        if (n !== s.academyName) save({ academyName: n }).then(function () { ui.toast('학원 이름을 바꿨어요'); }, function () {});
      },
      onEnter: function (v, el) { el.blur(); }
    });
    return card('academy', 'drum', '학원 정보', null,
      ui.field('학원 이름', name, '오늘 화면 머리, 키오스크 인사말, 보호자 문자, 인쇄물에 쓰여요.'));
  }

  function timeCard(s) {
    function timeInput(id, key, value) {
      return ui.input({
        type: 'time', id: id, value: value, step: 300,
        onChange: function (v, el) {
          if (!U().isHm(v)) { el.value = value; return; }
          var open = key === 'openTime' ? v : s.openTime, close = key === 'closeTime' ? v : s.closeTime;
          if (U().hm2min(open) >= U().hm2min(close)) {
            el.value = value;
            ui.toast('문 닫는 시각은 여는 시각보다 늦어야 해요', { kind: 'warn' });
            return;
          }
          var p = {}; p[key] = v; quietSave(p);
        }
      });
    }
    var slots = [10, 15, 20, 30, 60];
    if (slots.indexOf(s.slotMinutes) < 0) { slots.push(s.slotMinutes); slots.sort(function (a, b) { return a - b; }); }
    return card('time', 'clock', '수업 시간', null,
      h('div', { class: 'st-two' },
        ui.field('여는 시각', timeInput('set-open', 'openTime', s.openTime || '10:00')),
        ui.field('닫는 시각', timeInput('set-close', 'closeTime', s.closeTime || '22:00'))),
      h('div', { class: 'st-hint' }, '시간표 격자가 이 시간대로 그려져요. 이 밖의 수업도 저장은 돼요.'),
      row('격자 간격', '시간표 한 칸의 길이예요.', ui.segmented(slots.map(function (m) { return { value: m, label: m + '분' }; }), s.slotMinutes, function (v) { quietSave({ slotMinutes: v }); }), { stack: true }),
      row('기본 수업 길이', '새 수업을 만들 때 처음 채워지는 길이예요.',
        stepper('set-duration', s.defaultDuration, { min: 10, max: 240, step: 5, unit: '분', label: '기본 수업 길이(분)' }, function (v) { quietSave({ defaultDuration: v }); })),
      row('주 시작 요일', '시간표·통계의 한 주를 어느 요일부터 볼지 정해요.',
        ui.segmented([{ value: 1, label: '월요일' }, { value: 0, label: '일요일' }], s.weekStart === 0 ? 0 : 1, function (v) { quietSave({ weekStart: v }); })));
  }

  /* =================================================================
   * 출결 규칙
   * ================================================================= */
  function rulesCard(s) {
    var lateDesc = null, winDesc = null;
    function lateText(n) { return n === 0 ? '수업 시작 시각이 지나서 서명하면 바로 지각이에요.' : '수업 시작 ' + n + '분이 지나서 서명하면 지각으로 기록해요.'; }
    function winText(n) { return n === 0 ? '수업 시작 시각부터 키오스크 목록에 나와요.' : '수업 시작 ' + n + '분 전부터 키오스크 목록에 나와 서명할 수 있어요.'; }
    var simpleOn = s.simpleMode !== false;
    return card('rules', 'check', '출결 규칙', null,
      switchRow('간단 모드 (출석 O/X)', simpleOn
        ? '지각·공결 없이 출석과 당일취소만 써요. 서명하면 늘 출석이에요.'
        : '꺼 두면 v1.0처럼 지각 판정·공결·보강을 써요.',
        simpleOn, function (v) { quietSave({ simpleMode: v }); }),
      simpleOn ? h('div', { class: 'st-hint' }, '당일취소: 이용권 1회가 차감되고 사용 금액에 들어가요(보강 없음). 미리 빠지는 날은 아무것도 기록하지 않으면 돼요.') : null,
      simpleOn ? null : row('지각 기준', lateText(s.lateGraceMin),
        stepper('set-late', s.lateGraceMin, { min: 0, max: 60, step: 5, unit: '분', label: '지각 기준(분)', onPreview: function (n) { if (lateDesc) lateDesc.textContent = lateText(n); } },
          function (v) { quietSave({ lateGraceMin: v }); }), { descRef: function (el) { lateDesc = el; } }),
      row('서명 가능 시작', winText(s.signWindowBeforeMin),
        stepper('set-window', s.signWindowBeforeMin, { min: 0, max: 180, step: 10, unit: '분 전', label: '서명 가능 시작(분 전)', onPreview: function (n) { if (winDesc) winDesc.textContent = winText(n); } },
          function (v) { quietSave({ signWindowBeforeMin: v }); }), { descRef: function (el) { winDesc = el; } }),
      switchRow(simpleOn ? '지난 수업 자동 당일취소' : '지난 수업 자동 결석', s.autoAbsentPast
        ? (simpleOn ? '시간표 고정 수업에 기록 없이 지나가면 당일취소로 셉니다(‘자동’ 표시).' : '기록 없이 지난 수업은 결석으로 셉니다(‘자동’ 표시).')
        : (simpleOn ? '기록 없이 지난 수업은 ‘미확인’으로 남겨요.' : '기록 없이 지난 수업은 ‘미확인’으로 남겨요. 출석률에는 결석처럼 들어가요.'),
        s.autoAbsentPast, function (v) { quietSave({ autoAbsentPast: v }); }),
      simpleOn ? null : switchRow('횟수권 결석 차감', s.deductAbsentFromPass
        ? '결석해도 횟수권 1회를 차감해요.'
        : '출석·지각만 횟수권에서 차감해요.',
        s.deductAbsentFromPass, function (v) { quietSave({ deductAbsentFromPass: v }); }));
  }

  /* =================================================================
   * 강사 · 과정 · 레벨 · 방
   * ================================================================= */
  function usageMap(kind) {
    var d = data(), m = {};
    function inc(id, key) { if (!id) return; var u = m[id] || (m[id] = { students: 0, lessons: 0, extras: 0, records: 0 }); u[key]++; }
    var sField = { teachers: 'teacherId', courses: 'courseId', levels: 'levelId' }[kind];
    var oField = { teachers: 'teacherId', rooms: 'roomId' }[kind];
    if (sField) (d.students || []).forEach(function (s) { inc(s[sField], 'students'); });
    if (oField) {
      (d.lessons || []).forEach(function (l) { inc(l[oField], 'lessons'); });
      (d.exceptions || []).forEach(function (x) { if (x.type === 'extra') inc(x[oField], 'extras'); });
      (d.attendance || []).forEach(function (a) { if (a.snap) inc(a.snap[oField], 'records'); });
    }
    return m;
  }
  function usageText(u) {
    if (!u) return '아직 쓰는 곳 없음';
    var p = [];
    if (u.students) p.push('수강생 ' + u.students + '명');
    if (u.lessons) p.push('정규 수업 ' + u.lessons + '개');
    if (u.extras) p.push('보강·특강 ' + u.extras + '개');
    if (u.records) p.push('출석 기록 ' + u.records + '건');
    return p.length ? p.join(' · ') : '아직 쓰는 곳 없음';
  }
  function palette() { return (DA.C && DA.C.DEFAULT_COLORS) || ['#D9480F', '#2563EB', '#0D9488', '#9333EA', '#DB2777', '#CA8A04']; }
  function nextColor(list) {
    var used = {}; (list || []).forEach(function (x) { if (x.color) used[String(x.color).toUpperCase()] = true; });
    var p = palette();
    for (var i = 0; i < p.length; i++) if (!used[p[i].toUpperCase()]) return p[i];
    return p[(list || []).length % p.length];
  }
  function listOf(kind) { return (settings()[kind] || []).slice(); }
  function saveList(kind, list) { var p = {}; p[kind] = list; return save(p); }

  function addItem(kind) {
    var L = LISTS[kind];
    ui.promptText({ title: L.label + ' 추가', label: L.label + ' 이름', placeholder: kind === 'teachers' ? '예: 김 선생님' : kind === 'rooms' ? '예: 4번 방' : '', required: true, maxLength: 20, ok: '추가' })
      .then(function (name) {
        if (!name) return;
        var list = listOf(kind);
        if (list.some(function (x) { return x.name === name; })) { ui.toast('같은 이름의 ' + L.label + '이(가) 이미 있어요', { kind: 'warn' }); return; }
        var item = { id: U().uid(), name: name };
        if (L.color) item.color = nextColor(list);
        list.push(item);
        return saveList(kind, list).then(function () { ui.toast(name + ' 추가했어요'); ui.haptic('success'); });
      }).catch(function () { /* 토스트로 알림 */ });
  }
  function renameItem(kind, item) {
    var L = LISTS[kind];
    ui.promptText({ title: L.label + ' 이름 바꾸기', label: '새 이름', value: item.name, required: true, maxLength: 20, ok: '바꾸기' })
      .then(function (name) {
        if (!name || name === item.name) return;
        var list = listOf(kind);
        if (list.some(function (x) { return x.id !== item.id && x.name === name; })) { ui.toast('같은 이름이 이미 있어요', { kind: 'warn' }); return; }
        list = list.map(function (x) { return x.id === item.id ? Object.assign({}, x, { name: name }) : x; });
        return saveList(kind, list);
      }).catch(function () {});
  }
  function moveItem(kind, idx, dir) {
    var list = listOf(kind), j = idx + dir;
    if (j < 0 || j >= list.length) return;
    var t = list[idx]; list[idx] = list[j]; list[j] = t;
    ui.haptic('select');
    saveList(kind, list).catch(function () {});
  }
  function pickColor(kind, item) {
    var sh = null;
    function choose(c) {
      var list = listOf(kind).map(function (x) { return x.id === item.id ? Object.assign({}, x, { color: c }) : x; });
      saveList(kind, list).catch(function () {});
      ui.haptic('select');
      if (sh) sh.close();
    }
    var cur = String(item.color || '').toUpperCase();
    var custom = h('input', { type: 'color', class: 'st-color-input', value: /^#[0-9a-f]{6}$/i.test(item.color || '') ? item.color : '#D9480F', attrs: { 'aria-label': '직접 고르기' } });
    custom.addEventListener('change', function () { choose(custom.value.toUpperCase()); });
    sh = ui.sheet({
      title: item.name + ' 색',
      content: h('div', { class: 'v-settings' },
        h('div', { class: 'st-swatches' }, palette().map(function (c) {
          return h('button', {
            class: 'st-swatch' + (c.toUpperCase() === cur ? ' on' : ''), type: 'button', style: { background: c },
            attrs: { 'aria-label': c, 'aria-pressed': c.toUpperCase() === cur ? 'true' : 'false' }, onClick: function () { choose(c); }
          }, c.toUpperCase() === cur ? ic('check', 20) : null);
        })),
        h('label', { class: 'st-custom-color' }, custom, h('span', null, '다른 색 직접 고르기')))
    });
  }
  function deleteItem(kind, item, usage) {
    var L = LISTS[kind];
    var total = usage ? usage.students + usage.lessons + usage.extras + usage.records : 0;
    if (!total) {
      ui.confirm('‘' + item.name + '’을(를) 목록에서 지울까요?', { title: L.label + ' 삭제', ok: '삭제', danger: true }).then(function (ok) {
        if (!ok) return;
        saveList(kind, listOf(kind).filter(function (x) { return x.id !== item.id; }))
          .then(function () { ui.toast(item.name + ' 삭제했어요'); }, function () {});
      });
      return;
    }
    var others = listOf(kind).filter(function (x) { return x.id !== item.id; });
    var target = '';
    var sel = ui.select([{ value: '', label: '미지정으로 두기' }].concat(others.map(function (x) { return { value: x.id, label: x.name + '(으)로 옮기기' }; })), '', function (v) { target = v; });
    ui.sheet({
      title: '‘' + item.name + '’ 삭제',
      content: h('div', { class: 'v-settings' },
        ui.banner('warn', usageText(usage) + '에서 쓰고 있어요.', { title: '사용 중인 ' + L.label + '예요' }),
        h('p', { class: 'sheet-msg st-gap' }, '지우면 이 ' + L.label + '을(를) 쓰던 곳을 어떻게 할지 골라 주세요. 지난 출석 기록 자체는 지워지지 않아요.'),
        ui.field('쓰던 곳은', sel)),
      actions: [
        { label: '취소', kind: 'ghost' },
        { label: '삭제', kind: 'danger', onClick: function () { return doDelete(kind, item, target); } }
      ]
    });
  }
  function doDelete(kind, item, target) {
    var d = data(), st = DA.store, jobs = [];
    var sField = { teachers: 'teacherId', courses: 'courseId', levels: 'levelId' }[kind];
    var oField = { teachers: 'teacherId', rooms: 'roomId' }[kind];
    if (sField) {
      var studs = (d.students || []).filter(function (s) { return s[sField] === item.id; }).map(function (s) {
        var n = Object.assign({}, s); n[sField] = target; return n;
      });
      if (studs.length) jobs.push(function () { return st.putMany('students', studs); });
    }
    if (oField) {
      var ls = (d.lessons || []).filter(function (l) { return l[oField] === item.id; }).map(function (l) {
        var n = Object.assign({}, l); n[oField] = target; return n;
      });
      var xs = (d.exceptions || []).filter(function (x) { return x[oField] === item.id; }).map(function (x) {
        var n = Object.assign({}, x); n[oField] = target; return n;
      });
      if (ls.length) jobs.push(function () { return st.putMany('lessons', ls); });
      if (xs.length) jobs.push(function () { return st.putMany('exceptions', xs); });
      if (target) {
        var as = (d.attendance || []).filter(function (a) { return a.snap && a.snap[oField] === item.id; }).map(function (a) {
          var n = Object.assign({}, a); n.snap = Object.assign({}, a.snap); n.snap[oField] = target; return n;
        });
        if (as.length) jobs.push(function () { return st.putMany('attendance', as); });
      }
    }
    var p = Promise.resolve();
    jobs.forEach(function (j) { p = p.then(j); });
    return p.then(function () {
      return saveList(kind, listOf(kind).filter(function (x) { return x.id !== item.id; }));
    }).then(function () {
      ui.toast(item.name + ' 삭제했어요' + (target ? ' · ' + ui.nameOf(kind, target) + '(으)로 옮김' : ''));
    }, function (e) { toastErr(e, '삭제하지 못했어요'); return false; });
  }

  function listsCard(s) {
    var LISTS_ALL = LISTS;
    if (s.simpleMode !== false) {
      // 간단 모드: 반(과정)은 이용권 상품에서 관리
      LISTS = {}; Object.keys(LISTS_ALL).forEach(function (k) { if (k !== 'courses') LISTS[k] = LISTS_ALL[k]; });
    }
    try { return listsCardInner(s); } finally { LISTS = LISTS_ALL; }
  }
  function listsCardInner(s) {
    var kind = LISTS[S.listTab] ? S.listTab : 'teachers';
    var L = LISTS[kind];
    var list = s[kind] || [];
    var usage = usageMap(kind);
    var seg = ui.segmented(Object.keys(LISTS).map(function (k) {
      return { value: k, label: LISTS[k].label + ' ' + (s[k] || []).length };
    }), kind, function (v) { S.listTab = v; ui.refresh(); });
    seg.classList.add('full');
    var items = h('div', { class: 'list flat st-items' });
    if (!list.length) {
      items.appendChild(ui.empty(null, L.label + '이(가) 없어요', '아래 버튼으로 추가해 주세요.'));
      items.firstChild.classList.add('sm');
    }
    list.forEach(function (item, i) {
      var u = usage[item.id];
      items.appendChild(h('div', { class: 'list-item st-item' },
        L.color
          ? h('button', { class: 'st-color', type: 'button', style: { background: item.color || ui.teacherColor(item.id) }, attrs: { 'aria-label': item.name + ' 색 바꾸기' }, onClick: function () { pickColor(kind, item); } })
          : h('span', { class: 'st-order', attrs: { 'aria-hidden': 'true' } }, String(i + 1)),
        h('button', { class: 'li-main st-name', type: 'button', attrs: { 'aria-label': item.name + ' 이름 바꾸기' }, onClick: function () { renameItem(kind, item); } },
          h('div', { class: 'li-title' }, item.name || '(이름 없음)', ic('edit', 14)),
          h('div', { class: 'li-sub' }, usageText(u))),
        S.reorder
          ? h('div', { class: 'li-end st-item-btns' },
            h('button', { class: 'btn btn-icon', type: 'button', disabled: i === 0, attrs: { 'aria-label': item.name + ' 위로' }, onClick: function () { moveItem(kind, i, -1); } }, ic('chevU', 20)),
            h('button', { class: 'btn btn-icon', type: 'button', disabled: i === list.length - 1, attrs: { 'aria-label': item.name + ' 아래로' }, onClick: function () { moveItem(kind, i, 1); } }, ic('chevD', 20)))
          : h('div', { class: 'li-end st-item-btns' },
            h('button', { class: 'btn btn-icon st-del', type: 'button', attrs: { 'aria-label': item.name + ' 삭제' }, onClick: function () { deleteItem(kind, item, u); } }, ic('trash', 19)))));
    });
    return card('lists', 'users', s.simpleMode !== false ? '강사 · 레벨 · 방' : '강사 · 과정 · 레벨 · 방', null,
      seg,
      h('div', { class: 'st-hint' }, L.hint + (L.color ? ' 색 동그라미를 눌러 색을 바꿔요.' : '')),
      items,
      h('div', { class: 'st-list-actions st-gap' },
        h('button', { class: 'btn btn-soft', type: 'button', onClick: function () { addItem(kind); } }, ic('plus', 18), L.label + ' 추가'),
        list.length > 1 ? h('button', { class: 'btn' + (S.reorder ? ' btn-primary' : ''), type: 'button', attrs: { 'aria-pressed': S.reorder ? 'true' : 'false' }, onClick: function () { S.reorder = !S.reorder; ui.refresh(); } },
          ic(S.reorder ? 'check' : 'list', 18), S.reorder ? '순서 정하기 끝' : '순서 바꾸기') : null));
  }

  /* =================================================================
   * 휴원일
   * ================================================================= */
  function toggleClosed(ymd) {
    var s = settings();
    var list = (s.closedDays || []).slice();
    var i = list.indexOf(ymd);
    var label = U().fmtDate(ymd);
    if (i >= 0) {
      list.splice(i, 1);
      save({ closedDays: list }).then(function () {
        ui.toast(label + ' 휴원 해제', { action: { label: '되돌리기', onClick: function () { quietSave({ closedDays: (settings().closedDays || []).concat([ymd]) }); } } });
      }, function () {});
      return;
    }
    var n = 0, recs = 0;
    try {
      n = DA.schedule.occurrencesOn(data(), ymd).filter(function (o) { return o.srcType === 'lesson' && !o.canceled; }).length;
      recs = (data().attendance || []).filter(function (a) { return a.date === ymd; }).length;
    } catch (e) { logErr(e, 'closedCount'); }
    function go() {
      list.push(ymd);
      save({ closedDays: list }).then(function () {
        ui.haptic('success');
        ui.toast(label + ' 휴원일' + (n ? ' · 정규 수업 ' + n + '개 휴강' : ''), {
          action: { label: '되돌리기', onClick: function () { quietSave({ closedDays: (settings().closedDays || []).filter(function (x) { return x !== ymd; }) }); } }
        });
      }, function () {});
    }
    if (recs) {
      ui.confirm('이날 이미 출석 기록이 ' + recs + '건 있어요. 휴원일로 정해도 기록은 남고, 기록 없는 정규 수업만 휴강으로 바뀌어요.', { title: label + ' 휴원일로', ok: '휴원일로 정하기' })
        .then(function (ok) { if (ok) go(); });
    } else go();
  }

  function closedCard(s) {
    var u = U();
    var t = u.today();
    if (!S.calYm) S.calYm = u.ym(t);
    var ym = S.calYm;
    var first = ym + '-01', last = u.monthEnd(first);
    var closed = {};
    (s.closedDays || []).forEach(function (d0) { closed[d0] = true; });
    var perDay = {};
    try {
      DA.schedule.occurrencesBetween(data(), first, last).forEach(function (o) {
        if (o.srcType === 'lesson') perDay[o.date] = (perDay[o.date] || 0) + 1;
      });
    } catch (e) { logErr(e, 'calOcc'); }
    var ws = s.weekStart === 0 ? 0 : 1;
    var head = [];
    for (var k = 0; k < 7; k++) {
      var wd = (ws + k) % 7;
      head.push(h('div', { class: 'st-cal-wd' + (wd === 0 ? ' sun' : wd === 6 ? ' sat' : '') }, DA.C.WEEKDAYS[wd]));
    }
    var cells = [];
    var lead = (u.weekday(first) - ws + 7) % 7;
    for (var b = 0; b < lead; b++) cells.push(h('div', { class: 'st-cal-blank' }));
    u.rangeDays(first, last).forEach(function (d0) {
      var wd = u.weekday(d0);
      var isC = !!closed[d0];
      var cnt = perDay[d0] || 0;
      cells.push(h('button', {
        class: 'st-cal-day' + (isC ? ' closed' : '') + (d0 === t ? ' today' : '') + (d0 < t ? ' past' : '') + (wd === 0 ? ' sun' : wd === 6 ? ' sat' : ''),
        type: 'button',
        attrs: { 'aria-pressed': isC ? 'true' : 'false', 'aria-label': u.fmtDate(d0) + (isC ? ' 휴원일' : '') + (cnt ? ' 수업 ' + cnt + '개' : '') },
        onClick: function () { toggleClosed(d0); }
      },
        h('span', { class: 'n' }, String(+d0.slice(8))),
        isC ? h('span', { class: 'tag' }, '휴원') : (cnt ? h('span', { class: 'cnt' }, cnt + '') : null)));
    });

    var upcoming = (s.closedDays || []).filter(function (d0) { return d0 >= t; }).sort();
    var past = (s.closedDays || []).filter(function (d0) { return d0 < t; }).sort().reverse();
    function item(d0) {
      var rel = u.relDay ? u.relDay(d0) : '';
      var diff = u.diffDays(t, d0);
      return h('div', { class: 'list-item st-closed-item' },
        h('span', { class: 'li-ic' }, ic('calendar-x', 18)),
        h('div', { class: 'li-main' },
          h('div', { class: 'li-title' }, u.fmtDate(d0, { year: 'auto' })),
          h('div', { class: 'li-sub' }, rel || (diff > 0 ? diff + '일 뒤' : Math.abs(diff) + '일 전'))),
        h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': u.fmtDate(d0) + ' 휴원 해제' }, onClick: function () { toggleClosed(d0); } }, ic('trash', 19)));
    }
    return card('closed', 'calendar-x', '휴원일', upcoming.length ? '앞으로 ' + upcoming.length + '일' : null,
      h('div', { class: 'st-hint' }, '날짜를 누르면 휴원일로 정하거나 풀어요. 휴원일엔 정규 수업이 모두 휴강 처리되고, 보강·특강은 그대로예요.'),
      h('div', { class: 'st-cal' },
        h('div', { class: 'st-cal-nav' },
          h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '이전 달' }, onClick: function () { S.calYm = addYm(ym, -1); ui.refresh(); } }, ic('chevL', 22)),
          h('div', { class: 'st-cal-title' }, monthLabel(ym)),
          ym !== u.ym(t) ? h('button', { class: 'btn btn-sm btn-ghost', type: 'button', onClick: function () { S.calYm = u.ym(t); ui.refresh(); } }, '이번 달') : null,
          h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '다음 달' }, onClick: function () { S.calYm = addYm(ym, 1); ui.refresh(); } }, ic('chevR', 22))),
        h('div', { class: 'st-cal-grid' }, head, cells),
        h('div', { class: 'st-cal-legend' }, h('span', null, h('i', { class: 'lg-closed' }), '휴원일'), h('span', null, h('i', { class: 'lg-cnt' }), '정규 수업 수'))),
      h('div', { class: 'section-title st-sub-title' }, '다가오는 휴원일'),
      upcoming.length
        ? h('div', { class: 'list flat' }, upcoming.map(item))
        : h('div', { class: 'st-hint' }, '정해진 휴원일이 없어요.'),
      past.length ? h('button', { class: 'btn btn-ghost btn-sm st-gap', type: 'button', onClick: function () { S.showPastClosed = !S.showPastClosed; ui.refresh(); } },
        ic(S.showPastClosed ? 'chevU' : 'chevD', 16), '지난 휴원일 ' + past.length + '일 ' + (S.showPastClosed ? '접기' : '보기')) : null,
      past.length && S.showPastClosed ? h('div', { class: 'list flat st-gap' }, past.map(item)) : null);
  }

  /* =================================================================
   * 키오스크 PIN
   * ================================================================= */
  // 4자리 번호를 두 번 받아 확인 → Promise<string|null>
  function askNewPin() {
    return new Promise(function (resolve) {
      var step = 1, first = '', cur = '', done = false, sh = null;
      function fin(v) { if (!done) { done = true; resolve(v); } }
      var titleEl = h('div', { class: 'st-pin-title' });
      var subEl = h('div', { class: 'st-pin-sub' });
      var dots = h('div', { class: 'st-pin-dots', attrs: { 'aria-live': 'polite' } });
      function paint() {
        titleEl.textContent = step === 1 ? '새 PIN 4자리' : '한 번 더 입력해 주세요';
        if (!subEl.classList.contains('err')) subEl.textContent = step === 1 ? '키오스크에서 나갈 때 쓰는 번호예요.' : '확인을 위해 같은 번호를 다시 눌러 주세요.';
        ui.clear(dots);
        for (var i = 0; i < 4; i++) dots.appendChild(h('span', { class: i < cur.length ? 'on' : '' }));
        dots.setAttribute('aria-label', cur.length + '자리 입력됨');
      }
      function press(dg) {
        if (done || cur.length >= 4) return;
        subEl.classList.remove('err');
        cur += dg;
        ui.haptic('light');
        paint();
        if (cur.length === 4) setTimeout(complete, 140);
      }
      function back() { if (cur.length) { cur = cur.slice(0, -1); ui.haptic('light'); paint(); } }
      function complete() {
        if (done) return;
        if (step === 1) { first = cur; cur = ''; step = 2; paint(); return; }
        if (cur === first) { ui.haptic('success'); fin(cur); if (sh) sh.close(); return; }
        ui.haptic('error');
        dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
        subEl.textContent = '두 번 입력한 번호가 달라요. 처음부터 다시 눌러 주세요.';
        subEl.classList.add('err');
        step = 1; first = ''; cur = '';
        paint();
      }
      var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
      var pad = h('div', { class: 'st-pin-pad' }, keys.map(function (k) {
        if (!k) return h('span');
        if (k === 'back') return h('button', { class: 'st-pin-key fn', type: 'button', attrs: { 'aria-label': '지우기' }, onClick: back }, ic('backspace', 24));
        return h('button', { class: 'st-pin-key', type: 'button', onClick: function () { press(k); } }, k);
      }));
      function onKey(e) {
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
        else if (e.key === 'Backspace') { e.preventDefault(); back(); }
      }
      document.addEventListener('keydown', onKey);
      sh = ui.sheet({
        title: '키오스크 PIN',
        className: 'st-pin-sheet',
        autofocus: false,
        content: h('div', { class: 'v-settings st-pin' }, titleEl, subEl, dots, pad),
        onClose: function () { document.removeEventListener('keydown', onKey); fin(null); }
      });
      paint();
    });
  }
  function kioskCard(s) {
    var has = /^\d{4}$/.test(String(s.kioskPin || ''));
    return card('kiosk', 'kiosk', '키오스크', null,
      h('div', { class: 'st-status' },
        h('span', { class: 'st-status-ic' + (has ? ' on' : '') }, ic(has ? 'lock' : 'unlock', 20)),
        h('div', { class: 'grow' },
          h('div', { class: 'strong' }, has ? 'PIN 잠금 켜짐 ••••' : '잠금 없음'),
          h('div', { class: 'st-row-desc' }, has ? '키오스크에서 나갈 때 PIN 4자리를 물어요.' : '키오스크 화면에서 누구나 바로 나갈 수 있어요.'))),
      h('div', { class: 'st-hint' }, '학생이 실수로 다른 화면을 만지지 않게 막는 번호예요. 보안 장치는 아니에요.'),
      h('div', { class: 'btn-row st-gap' },
        h('button', { class: 'btn ' + (has ? '' : 'btn-primary'), type: 'button', onClick: function () {
          askNewPin().then(function (pin) {
            if (!pin) return;
            save({ kioskPin: pin }).then(function () { ui.toast(has ? 'PIN을 바꿨어요' : 'PIN 잠금을 켰어요'); }, function () {});
          });
        } }, ic('lock', 18), has ? 'PIN 바꾸기' : 'PIN 설정'),
        has ? h('button', { class: 'btn', type: 'button', onClick: function () {
          ui.confirm('키오스크 PIN 잠금을 끌까요? 누구나 키오스크에서 나갈 수 있게 돼요.', { title: 'PIN 해제', ok: '해제', danger: true }).then(function (ok) {
            if (ok) save({ kioskPin: '' }).then(function () { ui.toast('PIN 잠금을 껐어요'); }, function () {});
          });
        } }, ic('unlock', 18), 'PIN 해제') : null,
        h('button', { class: 'btn btn-ghost', type: 'button', onClick: function () { ui.go('#/kiosk'); } }, ic('kiosk', 18), '키오스크 열기')));
  }

  /* =================================================================
   * 보호자 문자
   * ================================================================= */
  function sampleName() {
    var list = (data().students || []).filter(function (x) { return x && x.status !== 'left' && x.name; });
    return list.length ? list[0].name : '김민수';
  }
  function smsCard(s) {
    var tpl = s.smsTemplate || DEFAULT_SMS;
    var preview = h('div', { class: 'st-bubble' });
    var lenEl = h('span', { class: 'st-len' });
    var area = ui.input({
      type: 'textarea', id: 'set-sms', value: tpl, rows: 3, maxLength: 300,
      onInput: function () { paint(); },
      onChange: function (v) {
        var n = String(v || '').trim() || DEFAULT_SMS;
        if (n !== s.smsTemplate) quietSave({ smsTemplate: n });
      }
    });
    function paint() {
      var now = new Date();
      var text = U().fillTemplate(area.value || DEFAULT_SMS, {
        '학원': s.academyName || '드럼 학원', '이름': sampleName(),
        '시각': U().fmtTime(now, { ampm: true }), '날짜': U().fmtDate(U().today())
      });
      preview.textContent = text;
      var bytes = 0;
      for (var i = 0; i < text.length; i++) bytes += text.charCodeAt(i) > 127 ? 2 : 1;
      lenEl.textContent = bytes > 90 ? '장문(LMS) 길이 ' + bytes + '바이트' : '단문 ' + bytes + '/90바이트';
      lenEl.className = 'st-len' + (bytes > 90 ? ' warn' : '');
    }
    function insert(token) {
      var v = area.value, a0 = area.selectionStart, b0 = area.selectionEnd;
      if (a0 == null || document.activeElement !== area) { a0 = b0 = v.length; }
      area.value = v.slice(0, a0) + token + v.slice(b0);
      try { area.focus({ preventScroll: true }); area.setSelectionRange(a0 + token.length, a0 + token.length); } catch (e) { /* 무시 */ }
      paint();
      var n = area.value.trim() || DEFAULT_SMS;
      if (n !== s.smsTemplate) quietSave({ smsTemplate: n });
    }
    paint();
    var tokens = ['{학원}', '{이름}', '{시각}', '{날짜}'];
    return card('sms', 'sms', '보호자 문자', null,
      switchRow('출석하면 문자 보내기 버튼', '서명을 마친 화면에 ‘보호자에게 문자’ 버튼이 나와요. 보호자 연락처가 있는 학생만요.', !!s.smsEnabled, function (v) { quietSave({ smsEnabled: v }); }),
      h('div', { class: 'st-sms' + (s.smsEnabled ? '' : ' off') },
        ui.field('문구', area),
        h('div', { class: 'st-tokens' },
          tokens.map(function (tk) {
            return h('button', { class: 'chip', type: 'button', onMousedown: function (e) { e.preventDefault(); }, onClick: function () { insert(tk); } }, tk);
          }),
          h('button', { class: 'chip', type: 'button', onClick: function () { area.value = DEFAULT_SMS; paint(); quietSave({ smsTemplate: DEFAULT_SMS }); } }, ic('undo', 14), '기본 문구')),
        h('div', { class: 'st-preview' },
          h('div', { class: 'st-preview-h' }, h('span', null, '미리보기'), lenEl),
          preview),
        h('div', { class: 'st-hint' }, '문자는 이 폰의 문자 앱으로 열려요. 보내기 전에 한 번 더 확인할 수 있어요.')));
  }

  /* =================================================================
   * v1.2 기능 켜기 · 권한(원장 PIN / 강사 모드) · 수납 문자 · 연습실
   * ================================================================= */
  var MODULES = [
    ['billing', '수납', '미납·선납·다음 달 예정·받은 돈, 안내 문자'],
    ['ask', '스마트 검색', '“이번 달 미납자 누구야?”처럼 묻고 답 받기'],
    ['practice', '연습실', '연습실 예약 · QR 체크인 · 노쇼 벌점'],
    ['settle', '정산', '강사별 수업 수 · 정산 금액'],
    ['timetable', '시간표', '고정 시간 수업 · 보강 (끄면 오늘 화면의 시간표 수업도 숨어요)'],
    ['kiosk', '키오스크', '접수대용 전체 화면'],
    ['progress', '진도(BPM)', '곡 · 교재 · BPM 기록']
  ];
  function modulesCard(s) {
    var mods = s.modules || {};
    return card('modules', 'grid', '기능 켜기', null,
      h('div', { class: 'st-hint' }, '안 쓰는 기능을 끄면 탭·버튼이 숨어요. 기록은 지우지 않으니 다시 켜면 그대로 보여요.'),
      MODULES.map(function (m) {
        var el = switchRow(m[1], m[2], mods[m[0]] !== false, function (v) {
          var next = Object.assign({}, settings().modules || {}); next[m[0]] = v;
          save({ modules: next }).then(function () { ui.toast(m[1] + (v ? ' 켰어요' : ' 껐어요')); }, function () {});
        });
        el.setAttribute('data-module', m[0]);
        return el;
      }));
  }

  function roleCard(s) {
    var has = !!s.ownerPin;
    function setPin() {
      ui.pinPad({ title: '새 원장 PIN', sub: '4~6자리 숫자를 누르고 [확인]', min: 4, max: 6 }).then(function (p1) {
        if (!p1) return;
        ui.pinPad({ title: '한 번 더', sub: '확인을 위해 같은 PIN을 다시 눌러 주세요', min: p1.length, max: p1.length, check: function (v) { return v === p1 ? true : '처음 누른 PIN과 달라요'; } }).then(function (p2) {
          if (!p2) return;
          save({ ownerPin: p2 }).then(function () { ui.toast(has ? '원장 PIN을 바꿨어요' : '원장 PIN을 정했어요. 이제 강사 모드를 쓸 수 있어요.'); }, function () {});
        });
      });
    }
    return card('role', 'lock', '권한 (원장 · 강사)', null,
      h('div', { class: 'st-status' },
        h('span', { class: 'st-status-ic' + (has ? ' on' : '') }, ic(has ? 'lock' : 'unlock', 20)),
        h('div', { class: 'grow' },
          h('div', { class: 'strong' }, has ? '원장 PIN 있음 ••••' : '원장 PIN 없음'),
          h('div', { class: 'st-row-desc' }, has ? (s.teacherMode ? '이 기기는 강사 모드예요. 원장 PIN을 넣으면 5분 동안 열려요.' : '지금은 원장 모드예요. 강사에게 폰을 맡길 땐 강사 모드로 잠그세요.') : 'PIN을 정하면 강사 모드를 쓸 수 있어요.'))),
      has ? switchRow('강사 모드', '금액·수납·통계·설정·백업·기록 삭제·이용권 발급을 숨기고 출석(QR)·진도·시간표·연습실만 쓰게 해요. 원장 PIN을 넣으면 5분 뒤 자동으로 다시 잠겨요.', !!s.teacherMode, function (v) {
        save({ teacherMode: v }).then(function () { if (v) { ui.lockOwner(); ui.toast('강사 모드로 잠갔어요'); ui.go('#/today'); } else ui.toast('강사 모드를 껐어요'); }, function () {});
      }) : null,
      h('div', { class: 'st-hint' }, '보안 장치가 아니라 오조작·열람을 막는 장치예요. 폰을 가진 사람이 마음먹으면 풀 수 있으니 중요한 기록은 백업해 두세요.'),
      h('div', { class: 'btn-row st-gap' },
        h('button', { class: 'btn ' + (has ? '' : 'btn-primary'), type: 'button', onClick: setPin }, ic('lock', 18), has ? 'PIN 바꾸기' : '원장 PIN 정하기'),
        has ? h('button', { class: 'btn', type: 'button', onClick: function () {
          ui.confirm('원장 PIN을 지울까요? 강사 모드도 함께 꺼져요.', { title: 'PIN 지우기', ok: '지우기', danger: true }).then(function (ok) {
            if (ok) save({ ownerPin: '', teacherMode: false }).then(function () { ui.toast('원장 PIN을 지웠어요'); }, function () {});
          });
        } }, ic('unlock', 18), 'PIN 지우기') : null));
  }

  var BILL_TOKENS = ['{학원}', '{이름}', '{월}', '{금액}', '{반}'];
  function billingSmsCard(s) {
    var def = (DA.store && DA.store.DEFAULT_BILLING_SMS) || '';
    var preview = h('div', { class: 'st-bubble' });
    var area = ui.input({
      type: 'textarea', id: 'set-bill-sms', value: s.billingSmsTemplate || def, rows: 3, maxLength: 300,
      onInput: function () { paint(); },
      onChange: function (v) { var n = String(v || '').trim() || def; if (n !== s.billingSmsTemplate) quietSave({ billingSmsTemplate: n }); }
    });
    function paint() {
      var p = (DA.pass.products(s) || [])[0];
      preview.textContent = U().fillTemplate(area.value || def, {
        '학원': s.academyName || '드럼 학원', '이름': sampleName(), '월': (+U().today().slice(5, 7)) + '월',
        '금액': U().fmtMoney(p ? p.amount : 220000), '반': p ? p.name : '정규반 A'
      });
    }
    function insert(tk) {
      var v = area.value, a0 = area.selectionStart, b0 = area.selectionEnd;
      if (a0 == null || document.activeElement !== area) { a0 = b0 = v.length; }
      area.value = v.slice(0, a0) + tk + v.slice(b0);
      paint();
      quietSave({ billingSmsTemplate: area.value.trim() || def });
    }
    paint();
    return card('billing', 'money', '수납 안내 문자', null,
      ui.field('문구', area),
      h('div', { class: 'st-tokens' }, BILL_TOKENS.map(function (tk) {
        return h('button', { class: 'chip', type: 'button', onMousedown: function (e) { e.preventDefault(); }, onClick: function () { insert(tk); } }, tk);
      }), h('button', { class: 'chip', type: 'button', onClick: function () { area.value = def; paint(); quietSave({ billingSmsTemplate: def }); } }, ic('undo', 14), '기본 문구')),
      h('div', { class: 'st-preview' }, h('div', { class: 'st-preview-h' }, h('span', null, '미리보기')), preview),
      h('div', { class: 'st-hint' }, '수납 화면의 [안내 문자]가 이 문구로 문자 앱을 열어요. 보내기는 원장님이 직접 눌러요.'));
  }

  function practiceCard(s) {
    var P = DA.store.defaultPractice ? Object.assign(DA.store.defaultPractice(), s.practice || {}) : (s.practice || {});
    function setP(k, v) { var n = Object.assign({}, settings().practice || {}); n[k] = v; quietSave({ practice: n }); }
    var rooms = (s.rooms || []);
    function setType(r, practice) {
      var list = (settings().rooms || []).map(function (x) { return x.id === r.id ? Object.assign({}, x, { type: practice ? 'practice' : 'lesson' }) : x; });
      save({ rooms: list }).then(function () { ui.toast(r.name + (practice ? ' → 연습실' : ' → 레슨실')); }, function () {});
    }
    function timeIn(key, val) {
      return ui.input({ type: 'time', value: val, step: 1800, onChange: function (v) { if (U().isHm(v)) setP(key, v); } });
    }
    var list = h('div', { class: 'list flat st-rooms' }, rooms.map(function (r) {
      var t = ui.toggle(r.type === 'practice', function (v) { setType(r, v); }, r.name + ' 연습실');
      return h('div', { class: 'list-item st-room', dataset: { room: r.id } },
        h('span', { class: 'li-ic' }, ic(r.type === 'practice' ? 'door' : 'drum', 19)),
        h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, r.name), h('div', { class: 'li-sub' }, r.type === 'practice' ? '연습실(예약·체크인)' : '레슨실')), t);
    }));
    return card('practice', 'door', '연습실', null,
      h('div', { class: 'st-hint' }, '방마다 ‘연습실’로 켜면 연습실 화면에서 예약을 받아요. 방 이름·추가·삭제는 아래 ‘강사·레벨·방’에서 해요.'),
      list,
      h('div', { class: 'btn-row st-gap' },
        h('button', { class: 'btn btn-soft', type: 'button', onClick: function () {
          ui.promptText({ title: '연습실 추가', label: '이름', placeholder: '예: 연습실 B', required: true, maxLength: 20, ok: '추가' }).then(function (name) {
            if (!name) return;
            var cur = (settings().rooms || []).slice();
            if (cur.some(function (x) { return x.name === name; })) { ui.toast('같은 이름의 방이 이미 있어요', { kind: 'warn' }); return; }
            cur.push({ id: U().uid(), name: name, type: 'practice' });
            save({ rooms: cur }).then(function () { ui.toast(name + ' 추가했어요'); }, function () {});
          });
        } }, ic('plus', 18), '연습실 추가'),
        h('button', { class: 'btn', type: 'button', onClick: function () { if (DA.print && DA.print.roomQr) DA.print.roomQr(); } }, ic('print', 18), '연습실 QR 인쇄')),
      h('div', { class: 'field-row st-gap' },
        ui.field('예약 시작', timeIn('openTime', P.openTime)),
        ui.field('예약 끝', timeIn('closeTime', P.closeTime))),
      row('예약 단위', '한 칸의 길이예요.', ui.segmented([{ value: 30, label: '30분' }, { value: 60, label: '60분' }], P.unit, function (v) { setP('unit', v); }), { stack: true }),
      row('체크인 허용 — 시작 전', '예약 시작 몇 분 전부터 체크인할 수 있는지', stepper('set-ci-before', P.checkinBefore, { min: 0, max: 60, step: 5, unit: '분 전', label: '체크인 시작(분 전)' }, function (v) { setP('checkinBefore', v); })),
      row('체크인 허용 — 시작 후', '이 시간까지 체크인이 없으면 노쇼', stepper('set-ci-after', P.checkinAfter, { min: 0, max: 60, step: 5, unit: '분 후', label: '체크인 마감(분 후)' }, function (v) { setP('checkinAfter', v); })),
      row('노쇼 벌점', '노쇼 1회마다', stepper('set-pen', P.penaltyPerNoShow, { min: 0, max: 5, step: 1, unit: '점', label: '노쇼 1회 벌점' }, function (v) { setP('penaltyPerNoShow', v); })),
      row('예약 제한 기준', '벌점이 이만큼 쌓이면', stepper('set-ban-th', P.banThreshold, { min: 1, max: 20, step: 1, unit: '점', label: '예약 제한 벌점' }, function (v) { setP('banThreshold', v); })),
      row('예약 제한 기간', '그날부터 예약할 수 없는 날 수', stepper('set-ban-days', P.banDays, { min: 0, max: 60, step: 1, unit: '일', label: '예약 제한 일수' }, function (v) { setP('banDays', v); })),
      h('div', { class: 'st-hint' }, '연습실 QR은 학원 출석 QR과 달라요(방마다 따로). 앱의 [QR 출석]으로 찍으면 그 방의 지금 예약에서 사람을 골라 체크인해요.'));
  }

  /* =================================================================
   * 소리 · 화면
   * ================================================================= */
  function applyTheme(theme) {
    if (DA.app && typeof DA.app.applyTheme === 'function') { DA.app.applyTheme(theme); return; }
    var root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme; else delete root.dataset.theme;
    try { localStorage.setItem('da.theme', theme); } catch (e) { /* 무시 */ }
  }
  function lookCard(s) {
    return card('look', 'sun', '소리 · 화면', null,
      h('div', { class: 'st-row' },
        h('label', { class: 'st-row-main st-row-labelwrap', attrs: { for: 'set-sound' } },
          h('div', { class: 'st-row-label' }, '효과음'),
          h('div', { class: 'st-row-desc' }, '서명을 마치면 짧은 ‘딩동’ 소리가 나요.')),
        h('div', { class: 'st-row-ctl row' },
          h('button', { class: 'btn btn-sm btn-ghost', type: 'button', disabled: s.soundEnabled === false, onClick: function () { if (ui.chime) ui.chime(); } }, ic('play', 16), '들어 보기'),
          (function () { var t = ui.toggle(s.soundEnabled !== false, function (v) { quietSave({ soundEnabled: v }); if (v && ui.chime) setTimeout(function () { ui.chime(); }, 120); }, '효과음'); t.input.id = 'set-sound'; return t; })())),
      row('화면 모드', '자동은 폰 설정(다크 모드)을 따라가요.',
        ui.segmented([
          { value: 'auto', label: '자동' }, { value: 'light', label: '밝게', icon: 'sun' }, { value: 'dark', label: '어둡게', icon: 'moon' }
        ], s.theme || 'auto', function (v) { applyTheme(v); quietSave({ theme: v }); }), { stack: true }));
  }

  /* =================================================================
   * 인쇄
   * ================================================================= */
  function logRangeFor(preset) {
    var s = settings(), now = new Date();
    if (DA.stats && DA.stats.presetRange) {
      var r = DA.stats.presetRange(preset, now, s.weekStart, data());
      return { from: r.from, to: r.to };
    }
    var t = U().today();
    return { from: U().monthStart(t), to: t };
  }
  function printCard(s) {
    var u = U();
    var t = u.today();
    if (!S.printYm) S.printYm = u.ym(t);
    if (!S.logFrom || !S.logTo) { var r0 = logRangeFor(S.logPreset); S.logFrom = r0.from; S.logTo = r0.to; }
    var teachers = s.teachers || [];
    if (S.printTeacher && !teachers.some(function (x) { return x.id === S.printTeacher; })) S.printTeacher = '';
    var tSel = ui.select([{ value: '', label: '전체 강사' }].concat(teachers.map(function (x) { return { value: x.id, label: x.name }; })), S.printTeacher, function (v) { S.printTeacher = v; });
    tSel.id = 'set-print-teacher';

    var from = ui.input({ type: 'date', id: 'set-log-from', value: S.logFrom, onChange: function (v) { if (u.isYmd(v)) { S.logFrom = v; S.logPreset = 'custom'; ui.refresh(); } } });
    var to = ui.input({ type: 'date', id: 'set-log-to', value: S.logTo, onChange: function (v) { if (u.isYmd(v)) { S.logTo = v; S.logPreset = 'custom'; ui.refresh(); } } });
    var stu = S.logStudent && DA.store.get ? DA.store.get('students', S.logStudent) : null;
    if (S.logStudent && !stu) S.logStudent = '';

    return card('print', 'print', '인쇄', null,
      h('div', { class: 'st-print-block' },
        h('div', { class: 'st-print-h' }, h('b', null, '월간 출석부'), h('span', { class: 'muted small' }, 'A4 가로 · 학생 × 날짜 표')),
        h('div', { class: 'st-month' },
          h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '이전 달' }, onClick: function () { S.printYm = addYm(S.printYm, -1); ui.refresh(); } }, ic('chevL', 22)),
          h('div', { class: 'st-month-label' }, monthLabel(S.printYm)),
          h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '다음 달' }, onClick: function () { S.printYm = addYm(S.printYm, 1); ui.refresh(); } }, ic('chevR', 22)),
          h('div', { class: 'grow' }, tSel)),
        h('div', { class: 'st-hint' }, (simple() ? '○출석 ×당일취소 -휴강.' : '○출석 △지각 ×결석 ◇공결 -휴강.') + ' 앞으로 있을 수업 칸은 회색으로 비워 둬서 손으로 적어도 돼요.'),
        h('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: function () {
          if (DA.print && DA.print.monthSheet) DA.print.monthSheet(S.printYm, { teacherId: S.printTeacher });
          else ui.toast('인쇄 기능을 불러오지 못했어요', { kind: 'error' });
        } }, ic('print', 18), monthLabel(S.printYm) + ' 출석부 인쇄')),
      h('div', { class: 'st-print-block' },
        h('div', { class: 'st-print-h' }, h('b', null, '서명 대장'), h('span', { class: 'muted small' }, 'A4 세로 · 날짜·시각·서명')),
        ui.segmented([
          { value: 'thisWeek', label: '이번 주' }, { value: 'thisMonth', label: '이번 달' }, { value: 'lastMonth', label: '지난 달' }, { value: 'custom', label: '직접' }
        ], S.logPreset, function (v) {
          S.logPreset = v;
          if (v !== 'custom') { var r = logRangeFor(v); S.logFrom = r.from; S.logTo = r.to; }
          ui.refresh();
        }),
        h('div', { class: 'st-two st-gap' }, ui.field('시작', from), ui.field('끝', to)),
        h('div', { class: 'st-pick-student' },
          h('button', { class: 'btn btn-block st-student-btn', type: 'button', onClick: function () {
            ui.pickStudent({ title: '서명 대장 — 학생 고르기', status: 'all' }).then(function (id) { if (id) { S.logStudent = id; ui.refresh(); } });
          } }, stu ? ui.avatar(stu.name, ui.studentColor(stu), 'sm') : ic('users', 18), h('span', { class: 'grow ellipsis' }, stu ? stu.name + ' 학생만' : '전체 학생'), ic('chevR', 18)),
          stu ? h('button', { class: 'btn btn-icon', type: 'button', attrs: { 'aria-label': '전체 학생으로' }, onClick: function () { S.logStudent = ''; ui.refresh(); } }, ic('x', 20)) : null),
        h('button', { class: 'btn btn-primary btn-block st-gap', type: 'button', onClick: function () {
          if (DA.print && DA.print.signLog) DA.print.signLog(S.logFrom, S.logTo, { studentId: S.logStudent });
          else ui.toast('인쇄 기능을 불러오지 못했어요', { kind: 'error' });
        } }, ic('print', 18), '서명 대장 인쇄')),
      h('div', { class: 'st-hint' }, '인쇄 창에서 ‘PDF로 저장’을 고르면 파일로도 남길 수 있어요. 통계 요약 인쇄는 통계 탭에 있어요.'));
  }

  /* =================================================================
   * 데이터: 백업 · 복원 · CSV · 예시 · 초기화
   * ================================================================= */
  function savedToast(res, what) {
    if (res === 'cancel') return;
    ui.toast(res === 'native' ? what + ' 파일을 저장했어요' : res === 'share' ? what + ' — 공유 창으로 보냈어요' : what + ' 파일을 저장했어요');
  }
  function doBackup() {
    return busy('backup', function () {
      var text;
      try { text = DA.backup.exportJSON(data()); } catch (e) { toastErr(e, '백업 파일을 만들지 못했어요'); return; }
      var name = DA.backup.filename('backup', 'json');
      return saveFileKind(name, 'application/json', text).then(function (res) {
        if (res === 'cancel') return;
        savedToast(res, '백업');
        ui.haptic('success');
        return DA.store.saveSettings({ lastBackupAt: new Date().toISOString() }).catch(function (e) { logErr(e, 'lastBackupAt'); });
      }, function (e) { toastErr(e, '백업 파일을 저장하지 못했어요'); });
    });
  }
  function doRestore() {
    return busy('restore', function () {
      return ui.openTextFile('.json,application/json,text/plain').then(function (file) {
        if (!file) return;
        var res;
        try { res = DA.backup.parseJSON(file.text); } catch (e) { toastErr(e, '백업 파일을 읽지 못했어요'); return; }
        if (!res || !res.ok) {
          ui.sheet({
            title: '불러올 수 없는 파일이에요',
            content: h('div', { class: 'v-settings' },
              ui.banner('error', (res && res.error) || '드럼 출석부 백업 파일이 아니에요.', { title: file.name || '선택한 파일' }),
              h('p', { class: 'sheet-msg st-gap' }, '설정 → 백업 파일 저장으로 만든 .json 파일을 골라 주세요.')),
            actions: [{ label: '확인', kind: 'primary' }]
          });
          return;
        }
        showRestoreSheet(file, res);
      });
    });
  }
  function showRestoreSheet(file, res) {
    var c = res.counts || {};
    var now = curCounts();
    var s2 = (res.data && res.data.settings) || {};
    var exported = res.exportedAt ? U().fmtDate(U().ymdOfIso(res.exportedAt), { year: 'auto' }) + ' ' + U().fmtTime(new Date(res.exportedAt)) : '알 수 없음';
    function line(label, a, b) {
      return h('tr', null, h('th', null, label), h('td', { class: 'num' }, String(b || 0)), h('td', { class: 'num st-arrow' }, '→'), h('td', { class: 'num strong' }, String(a || 0)));
    }
    ui.sheet({
      title: '백업 불러오기',
      sub: file.name || '',
      content: h('div', { class: 'v-settings' },
        h('div', { class: 'info-card' },
          h('span', { class: 'li-ic' }, ic('upload', 20)),
          h('div', null,
            h('div', { class: 'li-title' }, s2.academyName || '드럼 학원'),
            h('div', { class: 'li-sub' }, '백업한 때: ' + exported))),
        h('table', { class: 'st-compare' },
          h('thead', null, h('tr', null, h('th'), h('th', { class: 'num' }, '지금'), h('th'), h('th', { class: 'num' }, '불러온 뒤'))),
          h('tbody', null,
            line('수강생', c.students, now.students),
            line('정규 수업', c.lessons, now.lessons),
            line('보강·휴강 등', c.exceptions, now.exceptions),
            line('출석 기록', c.attendance, now.attendance),
            line('결제', c.payments, now.payments))),
        (res.warnings && res.warnings.length) ? ui.banner('info', h('ul', { class: 'st-warn-list' }, res.warnings.slice(0, 6).map(function (w) { return h('li', null, w); })), { title: '참고' }) : null,
        c.skipped ? h('div', { class: 'st-hint' }, '형식이 맞지 않는 항목 ' + c.skipped + '개는 건너뛰어요.') : null,
        ui.banner('warn', '지금 이 기기에 있는 기록은 모두 지워지고 백업 파일 내용으로 바뀌어요. 되돌릴 수 없어요.', { title: '덮어쓰기 주의' }),
        hasRealData() ? h('button', { class: 'btn btn-block st-gap', type: 'button', onClick: function () { doBackup(); } }, ic('download', 18), '지금 데이터 먼저 백업하기') : null),
      actions: [
        { label: '취소', kind: 'ghost' },
        { label: '불러오기', kind: 'danger', onClick: function () {
          return DA.store.replaceAll(res.data).then(function () {
            ui.haptic('success');
            ui.toast('백업을 불러왔어요 · ' + countsText(c));
            if (DA.app && DA.app.applyTheme) DA.app.applyTheme(settings().theme);
          }, function (e) { toastErr(e, '불러오지 못했어요'); return false; });
        } }
      ]
    });
  }
  function exportCSV(kind) {
    return busy('csv-' + kind, function () {
      var text, name, what;
      try {
        if (kind === 'attendance') { text = DA.backup.attendanceCSV(data()); name = DA.backup.filename('attendance', 'csv'); what = '출석 기록 CSV'; }
        else if (kind === 'students') { text = DA.backup.studentsCSV(data()); name = DA.backup.filename('students', 'csv'); what = '수강생 CSV'; }
        else { text = DA.backup.paymentsCSV(data()); name = DA.backup.filename('payments', 'csv'); what = '결제 CSV'; }
      } catch (e) { toastErr(e, 'CSV를 만들지 못했어요'); return; }
      return saveFileKind(name, 'text/csv;charset=utf-8', text).then(function (res) { savedToast(res, what); }, function (e) { toastErr(e, '저장하지 못했어요'); });
    });
  }
  function demoLoad() {
    function go() {
      return busy('demo', function () {
        var tt = ui.toast('예시 데이터를 만드는 중…', { ms: 0 });
        return DA.demo.load(new Date()).then(function (c) {
          tt.close();
          ui.haptic('success');
          ui.toast('예시 데이터를 불러왔어요 · 수강생 ' + c.students + '명, 출석 기록 ' + c.attendance + '건', {
            action: { label: '오늘 보기', onClick: function () { ui.go('#/today'); } }
          });
        }, function (e) { tt.close(); toastErr(e, '예시 데이터를 불러오지 못했어요'); });
      });
    }
    var msg = hasRealData()
      ? '직접 입력한 기록은 그대로 두고 예시 수강생·수업·출석 기록을 더해요. 나중에 ‘예시 데이터 지우기’로 예시만 깔끔히 지울 수 있어요.'
      : '가상의 수강생 14명과 10주치 출석 기록을 넣어 앱을 둘러볼 수 있어요. 나중에 예시만 깔끔히 지울 수 있어요.';
    ui.confirm(msg, { title: '예시 데이터 불러오기', ok: '불러오기' }).then(function (ok) { if (ok) go(); });
  }
  function demoClear() {
    ui.confirm('예시로 만든 수강생·수업·출석·결제 기록을 모두 지워요. 직접 입력한 기록은 그대로예요.', { title: '예시 데이터 지우기', ok: '지우기', danger: true }).then(function (ok) {
      if (!ok) return;
      busy('demo', function () {
        return DA.demo.clear().then(function () { ui.toast('예시 데이터를 지웠어요'); }, function (e) { toastErr(e, '지우지 못했어요'); });
      });
    });
  }
  function resetAll() {
    var c = curCounts();
    ui.sheet({
      title: '전체 초기화',
      content: h('div', { class: 'v-settings' },
        ui.banner('error', '수강생·시간표·출석 기록·결제·설정이 모두 지워지고 처음 상태로 돌아가요. 되돌릴 수 없어요.', { title: '정말 모두 지울까요?' }),
        h('p', { class: 'sheet-msg st-gap' }, '지금 기록: ' + countsText(c)),
        h('button', { class: 'btn btn-block st-gap', type: 'button', onClick: function () { doBackup(); } }, ic('download', 18), '먼저 백업 파일 저장하기')),
      actions: [
        { label: '취소', kind: 'ghost' },
        { label: '계속', kind: 'danger', onClick: function () { setTimeout(resetStep2, 320); } }
      ]
    });
  }
  function resetStep2() {
    ui.promptText({
      title: '마지막 확인', message: '정말 초기화하려면 아래 칸에 ‘초기화’라고 입력해 주세요.', label: '확인 문구',
      placeholder: '초기화', ok: '모두 지우기', danger: true, required: true
    }).then(function (v) {
      if (v == null) return;
      if (String(v).replace(/\s+/g, '') !== '초기화') { ui.toast('‘초기화’라고 정확히 입력해야 지워져요', { kind: 'warn' }); return; }
      busy('reset', function () {
        return DA.store.clearAll().then(function () {
          applyTheme('auto');
          S.logStudent = ''; S.printTeacher = '';
          ui.toast('모든 데이터를 지웠어요. 처음부터 시작해요.');
          ui.go('#/today', { replace: true, resetStack: true });
        }, function (e) { toastErr(e, '초기화하지 못했어요'); });
      });
    });
  }
  function dataCard(s) {
    var last = s.lastBackupAt;
    var lastT = last ? new Date(last).getTime() : NaN;
    var stale = !last || isNaN(lastT) || Date.now() - lastT > 7 * 86400000;
    var c = curCounts();
    var demoHas = DA.demo && DA.demo.has ? DA.demo.has() : false;
    var status = last && !isNaN(lastT)
      ? h('div', { class: 'st-status' },
        h('span', { class: 'st-status-ic' + (stale ? ' warn' : ' on') }, ic(stale ? 'alert' : 'check', 20)),
        h('div', { class: 'grow' },
          h('div', { class: 'strong' }, '마지막 백업 ' + relAgo(last)),
          h('div', { class: 'st-row-desc' }, U().fmtDate(U().ymdOfIso(last), { year: 'auto' }) + ' ' + U().fmtTime(new Date(last)) + (stale ? ' · 일주일이 지났어요. 새로 저장해 두세요.' : ''))))
      : h('div', { class: 'st-status' },
        h('span', { class: 'st-status-ic warn' }, ic('alert', 20)),
        h('div', { class: 'grow' },
          h('div', { class: 'strong' }, '아직 백업한 적이 없어요'),
          h('div', { class: 'st-row-desc' }, '기록은 이 기기에만 있어요. 폰을 바꾸거나 잃어버려도 괜찮게 백업 파일을 저장해 두세요.')));
    return card('data', 'download', '백업 · 데이터', null,
      status,
      h('div', { class: 'st-counts' },
        [['수강생', c.students], ['정규 수업', c.lessons], ['출석 기록', c.attendance], ['결제', c.payments]].map(function (x) {
          return h('div', { class: 'st-count' }, h('b', { class: 'num' }, U().fmtNumber ? U().fmtNumber(x[1]) : x[1]), h('span', null, x[0]));
        })),
      h('div', { class: 'btn-row st-gap' },
        h('button', { class: 'btn btn-primary', type: 'button', disabled: S.busy === 'backup', onClick: doBackup }, ic('download', 18), '백업 파일 저장'),
        h('button', { class: 'btn', type: 'button', onClick: doRestore }, ic('upload', 18), '백업 불러오기')),
      h('div', { class: 'st-hint' }, isAndroidApp()
        ? '저장할 곳(예: 구글 드라이브, 다운로드 폴더)을 고르는 창이 열려요.'
        : isIOS() ? '공유 창이 열리면 ‘파일에 저장’을 눌러 iCloud Drive 등에 보관하세요.' : '파일이 다운로드 폴더에 저장돼요.'),

      h('div', { class: 'section-title st-sub-title' }, 'CSV 내보내기 (엑셀에서 열기)'),
      h('div', { class: 'st-csv' },
        h('button', { class: 'btn', type: 'button', onClick: function () { exportCSV('attendance'); } }, ic('list', 18), '출석 기록'),
        h('button', { class: 'btn', type: 'button', onClick: function () { exportCSV('students'); } }, ic('users', 18), '수강생'),
        h('button', { class: 'btn', type: 'button', onClick: function () { exportCSV('payments'); } }, ic('card', 18), '결제')),

      h('div', { class: 'section-title st-sub-title' }, '예시 데이터'),
      demoHas
        ? h('div', { class: 'st-demo' },
          h('div', { class: 'st-row-desc grow' }, '지금 예시(체험) 데이터가 섞여 있어요. 실제로 쓰기 전에 지워 주세요.'),
          h('button', { class: 'btn', type: 'button', disabled: S.busy === 'demo', onClick: demoClear }, ic('eraser', 18), '예시 데이터 지우기'))
        : h('div', { class: 'st-demo' },
          h('div', { class: 'st-row-desc grow' }, '가상의 수강생과 출석 기록으로 화면을 미리 둘러볼 수 있어요.'),
          h('button', { class: 'btn', type: 'button', disabled: S.busy === 'demo', onClick: demoLoad }, ic('sparkle', 18), '예시 데이터 불러오기')),

      h('div', { class: 'st-danger' },
        h('div', { class: 'grow' },
          h('div', { class: 'strong' }, '전체 초기화'),
          h('div', { class: 'st-row-desc' }, '모든 기록과 설정을 지우고 처음으로 돌아가요.')),
        h('button', { class: 'btn btn-danger', type: 'button', onClick: resetAll }, ic('trash', 18), '초기화')));
  }

  /* =================================================================
   * 저장 공간
   * ================================================================= */
  function loadStorage() {
    if (S.storageLoading || S.storage) return;
    S.storageLoading = true;
    var st = DA.store;
    var persistedP = (navigator.storage && typeof navigator.storage.persisted === 'function')
      ? Promise.resolve().then(function () { return navigator.storage.persisted(); }).catch(function () { return null; })
      : Promise.resolve(st && st.persisted != null ? st.persisted : null);
    var estP = st && typeof st.estimate === 'function' ? st.estimate().catch(function () { return null; }) : Promise.resolve(null);
    Promise.all([persistedP, estP]).then(function (r) {
      S.storage = { persisted: r[0], estimate: r[1] };
      S.storageLoading = false;
      var c = ui.current && ui.current();
      if (c && c.name === 'settings') ui.refresh();
    });
  }
  function storageCard() {
    var st = DA.store || {};
    loadStorage();
    var info = S.storage || {};
    var est = info.estimate;
    var mode = st.fallback === 'memory' ? 'memory' : st.fallback ? 'local' : 'idb';
    var modeRow = mode === 'idb'
      ? h('div', { class: 'st-status' }, h('span', { class: 'st-status-ic on' }, ic('check', 20)),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, '기기 안 데이터베이스에 저장 중'), h('div', { class: 'st-row-desc' }, '인터넷 없이도 모든 기록이 이 기기에 저장돼요.')))
      : ui.banner('error', mode === 'memory'
        ? '이 브라우저에선 저장소를 열지 못해 앱을 닫으면 기록이 사라져요. 개인정보 보호(시크릿) 모드를 끄고 다시 열고, 지금 바로 백업 파일을 저장해 주세요.'
        : '기본 저장소를 열지 못해 임시 저장소(용량 약 5MB)를 쓰고 있어요. 백업 파일을 자주 저장해 주세요.',
        { title: mode === 'memory' ? '기록이 저장되지 않아요' : '임시 저장소 사용 중', action: { label: '백업', kind: 'primary', onClick: doBackup } });

    var persistText, persistCls;
    if (info.persisted === true || st.persisted === true) { persistText = '보호됨 — 기기 공간이 부족해도 브라우저가 지우지 않아요.'; persistCls = 'on'; }
    else if (!navigator.storage || typeof navigator.storage.persist !== 'function') { persistText = '이 브라우저는 영구 저장 요청을 지원하지 않아요.'; persistCls = ''; }
    else if (S.storage) { persistText = '아직 보호되지 않았어요. 아래 버튼으로 요청해 보세요.'; persistCls = 'warn'; }
    else { persistText = '확인하는 중…'; persistCls = ''; }
    var canPersist = navigator.storage && typeof navigator.storage.persist === 'function' && info.persisted !== true;

    var usage = null;
    if (est && est.quota) {
      var ratio = Math.min(1, est.usage / est.quota);
      usage = h('div', { class: 'st-usage' },
        h('div', { class: 'between row' }, h('span', { class: 'strong num' }, fmtBytes(est.usage) + ' 사용'), h('span', { class: 'muted small num' }, '여유 ' + fmtBytes(Math.max(0, est.quota - est.usage)))),
        h('div', { class: 'progress' }, h('span', { style: { width: Math.max(1, Math.round(ratio * 1000) / 10) + '%', background: ratio > 0.8 ? 'var(--st-absent)' : 'var(--accent)' } })));
    } else if (S.storage) {
      usage = h('div', { class: 'st-row-desc' }, '이 브라우저는 사용량을 알려 주지 않아요.');
    }
    var ios = isIOS() && !isAndroidApp();
    return card('storage', 'hash', '저장 공간', null,
      modeRow,
      row('영구 저장', persistText, canPersist ? h('button', { class: 'btn btn-sm', type: 'button', onClick: function () {
        busy('persist', function () {
          return DA.store.requestPersist().then(function (ok) {
            S.storage = Object.assign({}, S.storage || {}, { persisted: !!ok });
            ui.toast(ok ? '영구 저장이 켜졌어요' : (ios ? '사파리는 홈 화면 앱으로 쓸 때 기록을 더 잘 지켜 줘요' : '브라우저가 요청을 받아 주지 않았어요. 앱처럼 자주 쓰면 나중에 허용되기도 해요'), { kind: ok ? 'ok' : 'warn', ms: 4200 });
            ui.refresh();
          });
        });
      } }, '요청') : (persistCls === 'on' ? h('span', { class: 'badge st-present' }, '보호됨') : null)),
      usage,
      ui.banner(ios && !isStandalone() ? 'warn' : 'info',
        '홈 화면에 추가해서 쓰면 사파리가 데이터를 지우지 않아요(사파리에서 7일 동안 안 열면 사이트 데이터를 지우는 정책을 피해요). 그래도 정기 백업을 권장해요.',
        { title: '아이폰 사용자 안내', icon: 'info' }));
  }

  /* =================================================================
   * 설치 안내 · 앱 정보
   * ================================================================= */
  function installCard() {
    var ios = isIOS(), android = isAndroidApp(), standalone = isStandalone();
    var now = android ? '안드로이드 앱으로 실행 중이에요.' : standalone ? '홈 화면 앱으로 실행 중이에요. 잘 설치됐어요!' : ios ? '지금은 사파리에서 열려 있어요. 홈 화면에 추가해 주세요.' : '지금은 브라우저에서 열려 있어요.';
    var iphone = h('div', { class: 'st-install' },
      h('div', { class: 'st-install-h' }, ic('phone', 18), h('b', null, '아이폰 · 아이패드')),
      h('ol', { class: 'st-steps' },
        h('li', null, h('b', null, '사파리'), '로 이 앱 주소를 열어요.'),
        h('li', null, '아래쪽 ', h('b', null, '공유'), ' 버튼(', ic('share', 15), ')을 눌러요.'),
        h('li', null, '목록을 내려 ', h('b', null, '홈 화면에 추가'), '를 눌러요.'),
        h('li', null, '오른쪽 위 ', h('b', null, '추가'), '를 누르면 홈 화면에 ‘드럼출석’ 아이콘이 생겨요.')),
      h('div', { class: 'st-hint' }, '이후엔 꼭 홈 화면 아이콘으로 여세요. 사파리 탭과 홈 화면 앱은 기록을 따로 저장해요.'));
    var andro = h('div', { class: 'st-install' },
      h('div', { class: 'st-install-h' }, ic('download', 18), h('b', null, '안드로이드')),
      h('ol', { class: 'st-steps' },
        h('li', null, h('b', null, 'drum-attendance.apk'), ' 파일을 폰에 받아요.'),
        h('li', null, '파일을 열고 ', h('b', null, '설치'), '를 눌러요. ‘출처를 알 수 없는 앱’ 허용을 물으면 허용해요.'),
        h('li', null, '앱 서랍의 ', h('b', null, '드럼 출석부'), '로 열어요.')),
      h('div', { class: 'st-hint' }, '다른 기기의 기록은 백업 파일로 옮겨요: 기존 기기에서 백업 파일 저장 → 새 기기에서 백업 불러오기.'));
    return card('install', 'phone', '설치 안내', null,
      h('div', { class: 'banner ' + (standalone || android ? 'ok' : 'info') }, ic(standalone || android ? 'check' : 'info', 20), h('div', { class: 'banner-body' }, now)),
      h('div', { class: 'st-install-grid' }, ios || !android ? [iphone, andro] : [andro, iphone]));
  }
  function aboutCard(s) {
    var nv = nativeVersion();
    var st = DA.store || {};
    var errs = (DA.errors || []).length;
    return card('about', 'info', '앱 정보', null,
      h('div', { class: 'st-about' },
        h('img', { class: 'st-logo', src: 'icons/icon.svg', alt: '', width: 56, height: 56 }),
        h('div', null,
          h('div', { class: 'st-app-name' }, '드럼 출석부'),
          h('div', { class: 'st-row-desc' }, '이용권 출석 · QR 출석 · 서명 · 금액 합계'))),
      h('dl', { class: 'kv' },
        h('dt', null, '버전'), h('dd', { class: 'num' }, appVersion()),
        nv ? h('dt', null, '안드로이드 앱') : null, nv ? h('dd', { class: 'num' }, nv) : null,
        h('dt', null, '실행 환경'), h('dd', null, isAndroidApp() ? '안드로이드 앱' : isStandalone() ? '홈 화면 앱' : '브라우저'),
        h('dt', null, '저장 방식'), h('dd', null, st.fallback === 'memory' ? '임시 메모리(저장 안 됨)' : st.fallback ? '브라우저 임시 저장소' : 'IndexedDB (기기 안)'),
        s.createdAt ? h('dt', null, '처음 설정') : null, s.createdAt ? h('dd', null, U().fmtDate(U().ymdOfIso(s.createdAt), { year: true })) : null),
      h('div', { class: 'st-hint' }, '모든 기록은 이 기기 안에만 저장되고 어디로도 보내지 않아요. 인터넷이 없어도 돼요.'),
      errs ? h('div', { class: 'st-errors' },
        h('span', { class: 'st-row-desc grow' }, '문제 기록 ' + errs + '건이 있어요. 오류를 알릴 때 복사해서 보내 주세요.'),
        h('button', { class: 'btn btn-sm', type: 'button', onClick: function () {
          var text = JSON.stringify({ version: appVersion(), native: nv, ua: navigator.userAgent, errors: (DA.errors || []).slice(-20) }, null, 1);
          var p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard'));
          p.then(function () { ui.toast('문제 기록을 복사했어요'); }, function () {
            saveFileKind(DA.backup.filename('errors', 'txt'), 'text/plain', text).then(function (r) { savedToast(r, '문제 기록'); });
          });
        } }, ic('copy', 16), '복사')) : null);
  }

  /* =================================================================
   * 화면
   * ================================================================= */
  var SECTIONS = [
    ['academy', '학원'], ['modules', '기능 켜기'], ['role', '권한'], ['pass', '이용권'], ['qr', 'QR 출석'], ['billing', '수납 문자'], ['practice', '연습실'],
    ['rules', '출결 규칙'], ['time', '수업 시간'], ['lists', '강사·레벨'], ['closed', '휴원일'],
    ['kiosk', '키오스크'], ['sms', '보호자 문자'], ['look', '소리·화면'], ['print', '인쇄'], ['data', '백업'],
    ['storage', '저장 공간'], ['install', '설치'], ['about', '앱 정보']
  ];
  function jumpTo(id, smooth) {
    var el = document.getElementById('set-' + id);
    if (!el) return;
    var bar = document.querySelector('.v-settings .topbar');
    var off = (bar ? bar.getBoundingClientRect().height : 100) + 8;
    var y = el.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop || 0) - off;
    try { window.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { window.scrollTo(0, Math.max(0, y)); }
  }

  function render(el, params) {
    var s = settings();
    var root = h('div', { class: 'v-settings' });
    var jump = h('div', { class: 'full st-jump hscroll', attrs: { 'data-scroll': '', role: 'navigation', 'aria-label': '설정 바로가기' } },
      SECTIONS.filter(function (x) { return (x[0] !== 'billing' || ui.moduleOn('billing')) && (x[0] !== 'practice' || ui.moduleOn('practice')); }).map(function (x) {
        return h('button', { class: 'chip', type: 'button', onClick: function () { ui.haptic('light'); jumpTo(x[0], true); } }, x[1]);
      }));
    root.appendChild(h('header', { class: 'topbar' },
      h('div', { class: 'topbar-row' },
        h('h1', { class: 'topbar-title' }, '설정'),
        h('div', { class: 'topbar-actions' },
          h('button', { class: 'btn btn-sm btn-soft', type: 'button', disabled: S.busy === 'backup', onClick: doBackup }, ic('download', 16), '백업'))),
      jump));

    var page = h('div', { class: 'page narrow st-page' });
    var builders = [
      function () { return academyCard(s); },
      function () { return modulesCard(s); },
      function () { return roleCard(s); },
      function () { return passCard(s); },
      function () { return qrCard(s); },
      function () { return ui.moduleOn('billing') ? billingSmsCard(s) : null; },
      function () { return ui.moduleOn('practice') ? practiceCard(s) : null; },
      function () { return rulesCard(s); },
      function () { return timeCard(s); },
      function () { return listsCard(s); },
      function () { return closedCard(s); },
      function () { return kioskCard(s); },
      function () { return smsCard(s); },
      function () { return lookCard(s); },
      function () { return printCard(s); },
      function () { return dataCard(s); },
      function () { return storageCard(); },
      function () { return installCard(); },
      function () { return aboutCard(s); }
    ];
    builders.forEach(function (b, i) {
      try { var c = b(); if (c) page.appendChild(c); } catch (e) {
        logErr(e, 'card' + i);
        page.appendChild(h('div', { class: 'card' }, ui.empty('alert', '이 칸을 그리지 못했어요', String(e && e.message || e))));
      }
    });
    page.appendChild(h('div', { class: 'st-foot' }, '드럼 출석부 ' + appVersion() + ' · 오늘도 신나게 🥁'));
    root.appendChild(page);
    el.appendChild(root);

    // #/settings?section=data 또는 #/settings/data 로 들어오면 그 칸으로
    var want = (params && ((params.query && params.query.section) || (params.rest && params.rest[0]))) || '';
    var hash = params && params.hash;
    if (want && S.jumpedFor !== hash) {
      S.jumpedFor = hash;
      setTimeout(function () { jumpTo(want, false); }, 30);
    }
  }

  ui.registerView('settings', {
    title: '설정',
    owner: true,   // v1.2: 더보기 안으로 · 강사 모드에서는 원장 PIN 필요
    render: render,
    onLeave: function () {
      S.storage = null; S.storageLoading = false; S.jumpedFor = null; S.reorder = false;
    }
  });
})(window.DA = window.DA || {});
