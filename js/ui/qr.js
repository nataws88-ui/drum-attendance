/* 드럼 출석부 — QR (v1.1)
 * 만들기: vendor/qrcode.js(qrcode-generator, MIT) → SVG
 * 읽기:   vendor/jsQR.js(jsQR, Apache-2.0) → 앱 안 카메라(getUserMedia 후면) 또는 사진 한 장
 * DA.qr = {
 *   svg(text, {size, margin, label}) → SVGElement(흰 바탕 검은 칸)
 *   canvas(text, {scale, margin}) → HTMLCanvasElement
 *   decode(source, {invert}) → 글자|null     // source: canvas·img·video·ImageData
 *   scan({title, hint, check(text) → 'ok'|'other'|'noToken'|'room'|'noRoom'|'lessonQr'}) → Promise<글자|null>
 *   scanner() → 열려 있는 스캐너 {state, feed(source) → 결과, error} (테스트·진단용)
 * }
 * 카메라 프레임과 사진·테스트 그림은 모두 같은 handle(decode(…)) 길을 지난다.
 */
(function (DA) {
  'use strict';
  var ui = DA.ui;
  var h = ui.h;
  var Q = DA.qr = {};
  var SVGNS = 'http://www.w3.org/2000/svg';

  function logErr(e, w) { if (ui._logErr) ui._logErr(e, 'qr.' + (w || '')); }
  function ic(n, s) { return ui.icon ? ui.icon(n, s) : h('span'); }
  function U() { return DA.util; }

  /* ---------------- 만들기 ---------------- */
  function matrix(text) {
    if (typeof window.qrcode !== 'function') throw new Error('QR 만들기 부품(qrcode.js)을 불러오지 못했어요');
    var qr = window.qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();
    return qr;
  }
  Q.available = function () { return typeof window.qrcode === 'function' && typeof window.jsQR === 'function'; };

  Q.svg = function (text, o) {
    o = o || {};
    var qr = matrix(text);
    var n = qr.getModuleCount(), m = o.margin == null ? 4 : o.margin, full = n + m * 2;
    var d = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        // 같은 줄에서 이어지는 칸은 한 번에(파일을 작게)
        var len = 1;
        while (c + len < n && qr.isDark(r, c + len)) len++;
        d += 'M' + (c + m) + ' ' + (r + m) + 'h' + len + 'v1h-' + len + 'z';
        c += len - 1;
      }
    }
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + full + ' ' + full);
    svg.setAttribute('class', 'qr-svg');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', o.label || '출석 QR 코드');
    if (o.size) { svg.setAttribute('width', o.size); svg.setAttribute('height', o.size); }
    var bg = document.createElementNS(SVGNS, 'rect');
    bg.setAttribute('width', full); bg.setAttribute('height', full); bg.setAttribute('fill', '#FFFFFF');
    var path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', d); path.setAttribute('fill', '#000000');
    svg.appendChild(bg); svg.appendChild(path);
    return svg;
  };

  Q.canvas = function (text, o) {
    o = o || {};
    var qr = matrix(text);
    var n = qr.getModuleCount(), m = o.margin == null ? 4 : o.margin, sc = o.scale || 6;
    var size = (n + m * 2) * sc;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var g = cv.getContext('2d');
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, size, size);
    g.fillStyle = '#000000';
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + m) * sc, (r + m) * sc, sc, sc);
    return cv;
  };

  /* ---------------- 읽기 ---------------- */
  var work = null;
  function workCanvas() {
    if (!work) { work = document.createElement('canvas'); }
    return work;
  }
  // source 를 긴 변 maxSide 이하로 줄여 픽셀을 읽는다
  function pixels(source, maxSide) {
    if (source && source.data && source.width && source.height && !source.getContext) return source;   // ImageData
    var w = source.videoWidth || source.naturalWidth || source.width;
    var hh = source.videoHeight || source.naturalHeight || source.height;
    if (!w || !hh) return null;
    var k = Math.min(1, (maxSide || 720) / Math.max(w, hh));
    var cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(hh * k));
    var cv = workCanvas();
    if (cv.width !== cw) cv.width = cw;
    if (cv.height !== ch) cv.height = ch;
    var g = cv.getContext('2d', { willReadFrequently: true }) || cv.getContext('2d');
    g.drawImage(source, 0, 0, cw, ch);
    return g.getImageData(0, 0, cw, ch);
  }
  Q.decode = function (source, o) {
    o = o || {};
    if (typeof window.jsQR !== 'function') throw new Error('QR 읽기 부품(jsQR.js)을 불러오지 못했어요');
    var img = pixels(source, o.maxSide);
    if (!img) return null;
    var res = window.jsQR(img.data, img.width, img.height, { inversionAttempts: o.invert ? 'attemptBoth' : 'dontInvert' });
    return res && res.data ? res.data : null;
  };

  /* ---------------- 스캐너 ---------------- */
  var current = null;
  Q.scanner = function () { return current; };

  function cameraErrorText(err) {
    var name = err && err.name;
    var ios = U().isIOS && U().isIOS();
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      if (DA.util.isAndroidApp && DA.util.isAndroidApp()) return '카메라 권한이 꺼져 있어요. 휴대폰 설정 → 애플리케이션 → 드럼 출석부 → 권한에서 카메라를 허용해 주세요.';
      if (ios) return '카메라 권한이 꺼져 있어요. 아이폰 설정 → 사파리(또는 홈 화면 앱) → 카메라를 ‘허용’으로 바꾼 뒤 다시 눌러 주세요.';
      return '카메라 권한이 꺼져 있어요. 브라우저 주소창의 권한 설정에서 카메라를 허용해 주세요.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return '이 기기에서 카메라를 찾지 못했어요. 아래 ‘사진으로 찍기’를 써 보세요.';
    if (name === 'NotReadableError' || name === 'TrackStartError') return '다른 앱이 카메라를 쓰고 있어요. 그 앱을 닫고 다시 시도해 주세요.';
    return '카메라를 켜지 못했어요' + (err && err.message ? ' (' + err.message + ')' : '') + '. 아래 ‘사진으로 찍기’를 써 보세요.';
  }

  Q.scan = function (opts) {
    opts = opts || {};
    if (current) { try { current.close(); } catch (e) { /* 무시 */ } }
    return new Promise(function (resolve) {
      var done = false, stream = null, timer = null, sh = null, lastMsgAt = 0;
      var api = { state: 'starting', error: null, frames: 0, result: null };
      current = api;

      var video = h('video', { class: 'qr-video', attrs: { playsinline: '', 'webkit-playsinline': '', muted: '', autoplay: '' } });
      video.muted = true; video.playsInline = true; video.autoplay = true;
      var status = h('div', { class: 'qr-status', attrs: { 'aria-live': 'polite' } }, '카메라를 켜는 중…');
      var frame = h('div', { class: 'qr-frame', attrs: { 'aria-hidden': 'true' } }, h('i'), h('i'), h('i'), h('i'));
      var stage = h('div', { class: 'qr-stage' }, video, frame);
      var fileIn = h('input', { type: 'file', attrs: { accept: 'image/*', capture: 'environment' }, style: 'display:none' });
      var photoBtn = h('button', { class: 'btn', type: 'button', onClick: function () { fileIn.click(); } }, ic('camera', 18), '사진으로 찍기');
      var root = h('div', { class: 'qr-scan' },
        h('div', { class: 'qr-top' },
          h('div', { class: 'grow' }, h('div', { class: 'qr-title' }, opts.title || 'QR 출석'),
            h('div', { class: 'qr-sub' }, opts.hint || '레슨실 벽의 출석 QR을 네모 칸에 맞춰 주세요')),
          h('button', { class: 'btn btn-icon qr-close', type: 'button', attrs: { 'aria-label': '닫기' }, onClick: function () { close(); } }, ic('x', 24))),
        stage, status,
        h('div', { class: 'qr-actions' }, photoBtn,
          h('button', { class: 'btn btn-ghost', type: 'button', onClick: function () { close(); } }, '취소')),
        h('p', { class: 'qr-note' }, '휴대폰 기본 카메라 말고 꼭 이 화면으로 찍어 주세요. 기본 카메라로 찍으면 다른 브라우저가 열려 기록이 보이지 않아요.'),
        fileIn);

      function say(text, kind) {
        status.textContent = text;
        status.className = 'qr-status' + (kind ? ' ' + kind : '');
      }
      function stop() {
        clearTimeout(timer); timer = null;
        if (stream) { try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* 무시 */ } stream = null; }
        try { video.pause(); video.srcObject = null; } catch (e) { /* 무시 */ }
      }
      // 앱이 뒤로 가면 카메라를 바로 놓는다(배터리·다른 앱 카메라)
      // (카메라 권한 대화상자가 떠 있는 동안에도 hidden 이 되므로, 카메라가 이미 켜진 뒤에만 닫는다)
      function onVis() { if (document.hidden && api.state === 'live') close(); }
      document.addEventListener('visibilitychange', onVis);
      function fin(v) {
        if (done) return;
        done = true;
        document.removeEventListener('visibilitychange', onVis);
        stop();
        if (current === api) current = null;
        resolve(v);
      }
      function close() { if (sh) sh.close(); else fin(null); }
      api.close = close;

      // 모든 입력(카메라 프레임·사진·테스트 그림)이 지나는 곳
      function handle(text) {
        if (!text || done) return null;
        var verdict = opts.check ? opts.check(text) : 'ok';
        api.lastText = text; api.lastVerdict = verdict;
        if (verdict === 'ok') {
          api.state = 'found'; api.result = text;
          say('확인됐어요!', 'ok');
          stage.classList.add('found');
          ui.haptic('success');
          setTimeout(function () { fin(text); if (sh) sh.close(); }, 350);
          return 'ok';
        }
        var now = Date.now();
        if (now - lastMsgAt > 1500) {
          lastMsgAt = now;
          ui.haptic('warn');
          var MSG = {
            noToken: '아직 학원 QR을 만들지 않았어요. 설정 → QR 출석에서 만들어 주세요.',
            room: '연습실 QR이에요. 레슨실 출석 QR을 찍어 주세요.',          // v1.2
            noRoom: '등록되지 않은 연습실 QR이에요. 설정 → 연습실을 확인해 주세요.',
            lessonQr: '레슨실 출석 QR이에요. 연습실 문 옆의 QR을 찍어 주세요.'
          };
          say(MSG[verdict] || '이 학원 QR이 아니에요', 'warn');
        }
        return verdict;
      }
      api.feed = function (source, o) {
        var text = null;
        try { text = Q.decode(source, o || { invert: true, maxSide: 1024 }); } catch (e) { logErr(e, 'feed'); api.error = String(e && e.message || e); return null; }
        api.lastDecoded = text;
        if (!text) return null;
        return handle(text);
      };

      function tick() {
        timer = null;
        if (done) return;
        if (!document.hidden && video.readyState >= 2 && video.videoWidth) {
          api.frames++;
          var text = null;
          try { text = Q.decode(video, { maxSide: 720 }); } catch (e) { logErr(e, 'decode'); }
          if (text && handle(text) === 'ok') return;
        }
        timer = setTimeout(tick, 160);
      }

      fileIn.addEventListener('change', function () {
        var f = fileIn.files && fileIn.files[0];
        fileIn.value = '';
        if (!f) return;
        var url = URL.createObjectURL(f);
        var img = new Image();
        img.onload = function () {
          var r = api.feed(img, { invert: true, maxSide: 1400 });
          URL.revokeObjectURL(url);
          if (!r) say('사진에서 QR을 찾지 못했어요. QR이 크게 나오게 다시 찍어 주세요.', 'warn');
        };
        img.onerror = function () { URL.revokeObjectURL(url); say('사진을 열지 못했어요', 'warn'); };
        img.src = url;
      });

      sh = ui.sheet({
        size: 'full', header: false, autofocus: false, className: 'qr-sheet',
        content: root,
        onClose: function () { fin(null); }
      });

      // 카메라 켜기
      var md = navigator.mediaDevices;
      if (!Q.available()) {
        api.state = 'error'; api.error = 'QR 부품 없음';
        say('QR 부품을 불러오지 못했어요. 앱을 다시 열어 주세요.', 'warn');
        return;
      }
      if (!md || typeof md.getUserMedia !== 'function') {
        api.state = 'error'; api.error = 'getUserMedia 없음';
        stage.classList.add('off');
        say(window.isSecureContext === false ? '보안 연결(https)이 아니라 카메라를 쓸 수 없어요. ‘사진으로 찍기’를 써 주세요.' : '이 기기에서는 앱 안 카메라를 쓸 수 없어요. ‘사진으로 찍기’를 써 주세요.', 'warn');
        return;
      }
      function start(constraints, retry) {
        md.getUserMedia(constraints).then(function (s) {
          if (done) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
          stream = s;
          api.state = 'live';
          var tr = s.getVideoTracks()[0];
          api.track = tr ? { label: tr.label, settings: tr.getSettings ? tr.getSettings() : null } : null;
          video.srcObject = s;
          var p = video.play();
          if (p && p.catch) p.catch(function (e) { if (!(e && e.name === 'AbortError') && !done) logErr(e, 'play'); });   // 바로 닫으면 play() 가 끊기는 건 정상
          say('QR을 네모 칸 안에 맞춰 주세요');
          timer = setTimeout(tick, 250);
        }, function (err) {
          if (done) return;
          if (retry && err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) { start({ video: true, audio: false }, false); return; }
          api.state = 'error'; api.error = (err && err.name) || String(err);
          stage.classList.add('off');
          say(cameraErrorText(err), 'warn');
        });
      }
      start({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } }, true);
    });
  };
})(window.DA = window.DA || {});
