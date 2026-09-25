/* 드럼 출석부 — 더보기 (v1.2)
 * 하단 탭은 오늘·수강생·수납·통계·더보기 5개로 두고, 나머지 화면(스마트 검색·현황판·브리핑·시간표·연습실·입퇴원·정산·키오스크·설정)은 여기서 연다.
 * 맨 위에 권한 카드: 원장 PIN · 강사 모드 잠금/해제.
 */
(function (DA) {
  'use strict';
  var ui = DA.ui;
  if (!ui || !ui.registerView) return;
  var h = ui.h;
  function ic(n, s) { return ui.icon ? ui.icon(n, s) : h('span'); }
  function S() { return (DA.store && DA.store.data && DA.store.data.settings) || {}; }

  var ITEMS = [
    { view: 'ask', icon: 'sms', title: '스마트 검색', sub: '“이번 달 미납자 누구야?”처럼 물어보기' },
    { view: 'board', icon: 'grid', title: '운영 현황판', sub: '재원·반별·강사별 인원, 미납, 오늘 출석' },
    { view: 'report', icon: 'bell', title: '주간 브리핑 · 월간 리포트', sub: '지난주 요약과 이번 주 챙길 일, 달마다 운영 리포트' },
    { view: 'timetable', icon: 'calendar', title: '시간표', sub: '고정 시간 수업 · 보강' },
    { view: 'rooms', icon: 'door', title: '연습실', sub: '예약 · QR 체크인 · 노쇼 벌점' },
    { view: 'history', icon: 'user-plus', title: '입·퇴원 기록', sub: '입회·휴원·복귀·퇴원과 사유' },
    { view: 'settle', icon: 'money', title: '강사 정산', sub: '강사별 수업 수 · 정산 금액' },
    { view: 'kiosk', icon: 'kiosk', title: '키오스크', sub: '접수대용 전체 화면' },
    { view: 'settings', icon: 'settings', title: '설정', sub: '학원 · 이용권 · QR · 기능 켜기 · 백업' }
  ];

  function roleCard() {
    var s = S();
    var locked = ui.isTeacherLocked();
    if (!s.ownerPin) {
      return h('section', { class: 'card more-role' },
        h('div', { class: 'more-role-row' }, h('span', { class: 'more-role-ic' }, ic('user', 22)),
          h('div', { class: 'grow' }, h('div', { class: 'strong' }, '원장 모드'), h('div', { class: 'muted small' }, '원장 PIN을 정하면 강사에게 폰을 맡길 때 금액·수납·설정을 숨길 수 있어요.'))),
        h('button', { class: 'btn btn-soft btn-block', type: 'button', onClick: function () { ui.go('#/settings?section=role'); } }, ic('lock', 18), '원장 PIN 정하기'));
    }
    if (locked) {
      return h('section', { class: 'card more-role locked' },
        h('div', { class: 'more-role-row' }, h('span', { class: 'more-role-ic' }, ic('lock', 22)),
          h('div', { class: 'grow' }, h('div', { class: 'strong' }, '강사 모드'), h('div', { class: 'muted small' }, '출석(QR)·진도·시간표·연습실만 쓸 수 있어요. 금액·수납·통계·설정은 숨겨져 있어요.'))),
        h('button', { class: 'btn btn-primary btn-block more-unlock', type: 'button', onClick: function () { ui.unlockOwner(); } }, ic('unlock', 18), '원장 PIN으로 풀기'));
    }
    if (s.teacherMode) {
      var min = Math.ceil(ui.ownerUnlockedFor() / 60000);
      return h('section', { class: 'card more-role open' },
        h('div', { class: 'more-role-row' }, h('span', { class: 'more-role-ic' }, ic('unlock', 22)),
          h('div', { class: 'grow' }, h('div', { class: 'strong' }, '원장 모드 · ' + min + '분 뒤 다시 잠겨요'), h('div', { class: 'muted small' }, '이 기기는 평소 강사 모드예요.'))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onClick: function () { ui.lockOwner(); ui.toast('강사 모드로 잠갔어요'); } }, ic('lock', 18), '지금 잠그기'),
          h('button', { class: 'btn btn-ghost', type: 'button', onClick: function () {
            DA.store.saveSettings({ teacherMode: false }).then(function () { ui.toast('강사 모드를 껐어요. 이제 늘 원장 모드예요.'); });
          } }, '강사 모드 끄기')));
    }
    return h('section', { class: 'card more-role' },
      h('div', { class: 'more-role-row' }, h('span', { class: 'more-role-ic' }, ic('user', 22)),
        h('div', { class: 'grow' }, h('div', { class: 'strong' }, '원장 모드'), h('div', { class: 'muted small' }, '강사에게 폰을 맡길 때 강사 모드로 잠가 두세요. 원장 PIN으로 풀어요.'))),
      h('button', { class: 'btn btn-soft btn-block more-lock', type: 'button', onClick: function () {
        DA.store.saveSettings({ teacherMode: true }).then(function () { ui.lockOwner(); ui.toast('강사 모드로 잠갔어요'); });
      } }, ic('lock', 18), '강사 모드로 잠그기'));
  }

  function render(el) {
    var root = h('div', { class: 'v-more' });
    root.appendChild(h('header', { class: 'topbar' }, h('div', { class: 'topbar-row' }, h('h1', { class: 'topbar-title' }, '더보기'))));
    var page = h('div', { class: 'page narrow' });
    page.appendChild(roleCard());
    var list = h('div', { class: 'card list more-list' });
    ITEMS.forEach(function (it) {
      var v = ui.views[it.view];
      if (!v) return;
      if (v.module && !ui.moduleOn(v.module)) return;
      var locked = v.owner && ui.isTeacherLocked();
      list.appendChild(h('button', {
        class: 'list-item more-item' + (locked ? ' locked' : ''), type: 'button', dataset: { view: it.view },
        onClick: function () {
          ui.haptic('light');
          if (locked) { ui.unlockOwner(it.title + ' 화면은 원장님만 볼 수 있어요.').then(function (ok) { if (ok) ui.go('#/' + it.view); }); return; }
          ui.go('#/' + it.view);
        }
      },
        h('span', { class: 'li-ic' }, ic(it.icon, 20)),
        h('div', { class: 'li-main' }, h('div', { class: 'li-title' }, it.title), h('div', { class: 'li-sub' }, it.sub)),
        h('span', { class: 'li-end' }, locked ? ic('lock', 18) : ic('chevR', 18))));
    });
    page.appendChild(list);
    page.appendChild(h('p', { class: 'muted small more-foot' }, '안 쓰는 기능은 설정 → 기능 켜기에서 끌 수 있어요(기록은 그대로 남아요).'));
    root.appendChild(page);
    el.appendChild(root);
  }

  ui.registerView('more', {
    title: '더보기',
    tab: { label: '더보기', icon: 'grid', order: 5 },
    render: render
  });
})(window.DA = window.DA || {});
