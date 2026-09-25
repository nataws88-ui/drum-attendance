/* 드럼 출석부 — 부트스트랩 (store.open → 테마 → 라우터 시작 → 서비스워커)
 * DA.app = {version, start, applyTheme, isIOS, isStandalone, isAndroidApp, needsInstallHint, errors}
 */
(function (DA) {
  'use strict';
  var app = DA.app = DA.app || {};
  app.version = DA.VERSION = '1.2.1';

  /* ---------------- 오류 수집(최근 50건) ---------------- */
  DA.errors = DA.errors || [];
  function pushErr(entry) {
    try {
      entry.at = entry.at || new Date().toISOString();
      DA.errors.push(entry);
      if (DA.errors.length > 50) DA.errors.splice(0, DA.errors.length - 50);
    } catch (e) { /* 무시 */ }
  }
  app.pushError = pushErr;
  if (!DA._errHooked) {
    DA._errHooked = true;
    window.addEventListener('error', function (ev) {
      if (ev && ev.target && ev.target !== window && (ev.target.src || ev.target.href)) {
        pushErr({ type: 'resource', message: '불러오기 실패: ' + (ev.target.src || ev.target.href) });
        return;
      }
      pushErr({
        type: 'error', message: String(ev && ev.message || 'unknown'),
        source: ev && ev.filename || '', line: ev && ev.lineno || 0, col: ev && ev.colno || 0,
        stack: ev && ev.error && ev.error.stack ? String(ev.error.stack).slice(0, 2000) : ''
      });
    }, true);
    window.addEventListener('unhandledrejection', function (ev) {
      var r = ev && ev.reason;
      pushErr({ type: 'unhandledrejection', message: String(r && r.message || r), stack: r && r.stack ? String(r.stack).slice(0, 2000) : '' });
    });
  }

  /* ---------------- 환경 판별 ---------------- */
  app.isIOS = function () {
    if (DA.util && DA.util.isIOS) return DA.util.isIOS();
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  };
  app.isStandalone = function () {
    if (DA.util && DA.util.isStandalone) return DA.util.isStandalone();
    return window.navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  };
  app.isAndroidApp = function () {
    if (DA.util && DA.util.isAndroidApp) return DA.util.isAndroidApp();
    return !!window.DrumNative;
  };
  // 오늘 화면 환영 카드: 아이폰 사파리에서 홈 화면 앱이 아니면 '홈 화면에 추가' 안내
  app.needsInstallHint = function () {
    return app.isIOS() && !app.isStandalone() && !app.isAndroidApp();
  };

  /* ---------------- 테마 ---------------- */
  var THEME_COLORS = { light: '#F6F5F2', dark: '#121212' };
  var lastTheme = null;
  app.applyTheme = function (theme) {
    theme = theme === 'light' || theme === 'dark' ? theme : 'auto';
    if (theme === lastTheme) return;
    lastTheme = theme;
    var root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
    try { localStorage.setItem('da.theme', theme); } catch (e) { /* 개인정보 보호 모드 등 */ }
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    Array.prototype.forEach.call(metas, function (m) {
      var media = m.getAttribute('media') || '';
      var natural = media.indexOf('dark') >= 0 ? THEME_COLORS.dark : THEME_COLORS.light;
      m.setAttribute('content', theme === 'auto' ? natural : THEME_COLORS[theme]);
    });
  };
  function syncTheme() {
    var s = DA.store && DA.store.data && DA.store.data.settings;
    app.applyTheme(s && s.theme);
    // v1.1.1: 간단 모드에서는 결석을 '당일취소'라고 부른다(원장님 요청)
    if (DA.C && DA.C.STATUS) DA.C.STATUS.absent = (s && s.simpleMode === false) ? '결석' : '당일취소';
  }

  /* ---------------- 부팅 화면 · 치명 오류 ---------------- */
  function hideBoot() {
    var b = document.getElementById('boot');
    if (!b) return;
    b.classList.add('done');
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 400);
  }
  function fatal(title, text, detail) {
    var b = document.getElementById('boot');
    if (!b) { b = document.createElement('div'); b.id = 'boot'; b.className = 'boot'; document.body.appendChild(b); }
    b.classList.remove('done', 'slow');
    while (b.firstChild) b.removeChild(b.firstChild);
    var box = document.createElement('div'); box.className = 'fatal';
    var img = document.createElement('img'); img.src = 'icons/icon.svg'; img.alt = ''; img.width = 72; img.height = 72; img.className = 'boot-logo';
    var h1 = document.createElement('h1'); h1.textContent = title;
    var p = document.createElement('p'); p.textContent = text;
    var btn = document.createElement('button'); btn.className = 'btn btn-primary btn-lg'; btn.type = 'button'; btn.textContent = '다시 시도';
    btn.addEventListener('click', function () { location.reload(); });
    box.appendChild(img); box.appendChild(h1); box.appendChild(p); box.appendChild(btn);
    if (detail) {
      var d = document.createElement('details'); var s = document.createElement('summary'); s.textContent = '자세한 오류';
      var pre = document.createElement('pre'); pre.textContent = String(detail);
      d.appendChild(s); d.appendChild(pre); box.appendChild(d);
    }
    b.appendChild(box);
  }
  app.fatal = fatal;

  /* ---------------- 서비스 워커 + 업데이트 배너 ---------------- */
  var reloading = false;
  function showUpdate(worker) {
    if (document.querySelector('.update-banner')) return;
    var ui = DA.ui, h = ui.h;
    var el = h('div', { class: 'update-banner', attrs: { role: 'status' } },
      ui.icon('refresh', 20),
      h('span', null, '새 버전이 있어요'),
      h('button', {
        class: 'btn btn-primary btn-sm', type: 'button',
        onClick: function () {
          reloading = true;
          try { worker.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { /* 무시 */ }
          setTimeout(function () { location.reload(); }, 1500);
        }
      }, '다시 열기'),
      h('button', { class: 'btn btn-icon btn-sm', type: 'button', attrs: { 'aria-label': '나중에' }, onClick: function () { if (el.parentNode) el.parentNode.removeChild(el); } }, ui.icon('x', 18)));
    document.body.appendChild(el);
  }
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' || location.hostname === 'drum.local') return;
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
        });
      });
      var lastCheck = Date.now();
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && Date.now() - lastCheck > 3600 * 1000) {
          lastCheck = Date.now();
          reg.update().catch(function () { /* 오프라인 */ });
        }
      });
    }).catch(function (e) { pushErr({ type: 'sw', message: String(e && e.message || e) }); });
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!reloading) return;
      reloading = false;
      location.reload();
    });
  }

  /* ---------------- 안드로이드 껍데기 훅 ---------------- */
  window.DA_onPause = function () {
    try { window.dispatchEvent(new CustomEvent('da:pause')); } catch (e) { /* 무시 */ }
  };
  window.DA_onResume = function () {
    try {
      if (DA.ui && DA.ui.checkDay) DA.ui.checkDay();
      window.dispatchEvent(new CustomEvent('da:resume'));
    } catch (e) { /* 무시 */ }
  };

  /* ---------------- 시작 ---------------- */
  var booted = false;
  app.start = async function () {
    if (booted) return;
    booted = true;
    var missing = [];
    if (!DA.util) missing.push('util.js');
    if (!DA.store || typeof DA.store.open !== 'function') missing.push('store.js');
    if (!DA.schedule) missing.push('schedule.js');
    if (!DA.ui || typeof DA.ui.start !== 'function') missing.push('shell.js');
    if (missing.length) {
      fatal('앱 파일을 불러오지 못했어요', '일부 파일이 빠졌거나 손상됐어요. 앱을 다시 열어 보세요.', '누락: ' + missing.join(', ') + '\n' + JSON.stringify(DA.errors.slice(-5), null, 1));
      return;
    }
    try {
      await DA.store.open();
    } catch (e) {
      pushErr({ type: 'store.open', message: String(e && e.message || e), stack: e && e.stack ? String(e.stack).slice(0, 2000) : '' });
      fatal('저장 공간을 열 수 없어요',
        '이 기기의 브라우저 저장소를 열지 못했어요. 사파리의 개인정보 보호 브라우징을 끄거나, 저장 공간을 확보한 뒤 다시 열어 주세요. 백업 파일이 있다면 데이터는 안전해요.',
        String(e && e.message || e));
      return;
    }
    syncTheme();
    if (typeof DA.store.on === 'function') DA.store.on('change', function () { syncTheme(); });
    try {
      DA.ui.start();
    } catch (e) {
      pushErr({ type: 'ui.start', message: String(e && e.message || e), stack: e && e.stack ? String(e.stack).slice(0, 2000) : '' });
      fatal('화면을 시작하지 못했어요', '앱을 다시 열어 주세요. 계속 이러면 설정의 백업 파일로 옮겨 주세요.', String(e && e.stack || e));
      return;
    }
    DA.booted = true;
    hideBoot();
    // v1.2: 체크인 없이 지난 연습실 예약을 노쇼로 확정(벌점)
    if (DA.roomsUI && DA.roomsUI.finalize) setTimeout(function () { DA.roomsUI.finalize({}); }, 600);
    if (DA.store.fallback === 'memory') {
      DA.ui.toast('이 브라우저에선 기록이 저장되지 않아요. 개인정보 보호 모드를 끄고 다시 열어 주세요.', { kind: 'error', ms: 8000 });
    } else if (DA.store.fallback) {
      DA.ui.toast('이 브라우저에선 저장 공간이 작아요. 백업을 자주 해 주세요.', { kind: 'warn', ms: 6000 });
    }
    if (app.isStandalone() && typeof DA.store.requestPersist === 'function') {
      try { DA.store.requestPersist().catch(function () { /* 무시 */ }); } catch (e) { /* 무시 */ }
    }
    registerSW();
  };

  function boot() { app.start(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.DA = window.DA || {});
