/* ==== main.js ==== 起動と全体の配線：設定読込 → データ読込 → 地図構築 → UI 結線 → Service Worker 登録 */
import { state, on, loadSettings, currentVariation, SETTINGS_KEY } from './state.js';
import { setStoreErrorHandler, requestPersistence, saveLater } from './store.js';
import { createProjection } from './projection.js';
import { createView, attachGestures } from './map-view.js';
import { buildGeoLayer, applyGeoVisibility, drawOverlay, scaleBar, hitTest } from './map-render.js';
import { bindUi, renderDataPanel, renderTopBar, renderInfo, renderSettings, renderCursor, showBanner } from './ui.js';
import { setManualOwn } from './gps.js';
import { loadAircraft } from './aircraft.js';
import { loadRoutes, activeRoute } from './route.js';
import { loadUserPoints, setPointSources } from './points.js';
import { navContext, onOwnUpdate } from './nav.js';
import { bindNavUi, renderNavOverlays } from './ui-nav.js';
import { renderRouteTab, bindRouteTab, renderLogTab } from './ui-route.js';
import { renderAircraftTab, bindAircraftTab, renderPointsTab, bindPointsTab, renderShareTab, bindShareTab } from './ui-data.js';

const $ = (id) => document.getElementById(id);
const DATA_FILES = ['land', 'airspace', 'airports', 'navaids', 'obstacles'];
let view;
let lastHits = null;
let drawPending = false;
let gestureActive = false;          // 指・ボタン操作中は地図を回さない（指の下で地図が回るのを防ぐ）
let openTab = 'route';
const TABS = {
  route: [renderRouteTab, bindRouteTab], log: [renderLogTab, null], aircraft: [renderAircraftTab, bindAircraftTab],
  points: [renderPointsTab, bindPointsTab], share: [renderShareTab, bindShareTab],
};

async function loadData() {
  const results = await Promise.all(DATA_FILES.map((name) => fetch(`data/${name}.json`).then((r) => {
    if (!r.ok) throw new Error(`${name}.json ${r.status}`);
    return r.json();
  })));
  DATA_FILES.forEach((name, i) => { state.data[name] = name === 'land' ? results[i] : results[i].items; });
}

/* ==== requestDraw ==== 描画は1フレームに1回へまとめる */
function requestDraw() {
  if (drawPending) return;
  drawPending = true;
  requestAnimationFrame(() => {
    drawPending = false;
    $('geo').setAttribute('transform', view.transform());
    drawOverlay($('overlay'), view, state, currentVariation().value, navContext());
    const bar = scaleBar(view);
    $('scaleBar').style.width = `${bar.px}px`;
    $('scaleLabel').textContent = `${bar.nm} nm`;
    const c = view.center();
    const northAngle = view.screenAngle(c.lat, c.lon, 0);
    $('northArrow').classList.toggle('hidden', Math.abs(northAngle) < 1);
    $('northArrow').style.transform = `rotate(${northAngle}deg)`;
  });
}

/* ==== applyOrientation ==== ◎ON：自機を中央に固定し航跡（Track）を上に／OFF：North-up（画面中心で真北が上） */
function applyOrientation() {
  if (gestureActive) return;
  const own = state.own;
  const following = state.settings.follow && Number.isFinite(own.lat);
  const ref = following ? own : view.center();
  // 針路が分からない間（静止・手動位置）は North-up
  const upBearing = following && Number.isFinite(own.trk) ? own.trk : 0;
  // 画面上の向きを測って、その分だけ回す（図法の子午線収束も自動で吸収）
  const angle = view.screenAngle(ref.lat, ref.lon, upBearing);
  if (Math.abs(angle) > 0.05) view.setRotation(view.rot - angle);
  if (following) view.centerOn(own.lat, own.lon);
}

/* ==== データシート（ルート・ログ・機体・ポイント・共有） ==== */
function renderTab() {
  if (!$('dataSheet').classList.contains('open')) return;
  document.querySelectorAll('#dataSheet [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === openTab)));
  Object.keys(TABS).forEach((k) => $(`tab-${k}`).classList.toggle('hidden', k !== openTab));
  TABS[openTab][0]($(`tab-${openTab}`));
}

function openSheet(tab = openTab) {
  openTab = tab;
  $('settingsSheet').classList.remove('open');
  $('infoSheet').classList.remove('open');
  $('dataSheet').classList.add('open');
  renderTab();
}

function bindDataSheet() {
  Object.entries(TABS).forEach(([k, [, bind]]) => bind?.($(`tab-${k}`), renderTab));
  document.querySelectorAll('#dataSheet [data-tab]').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.tab)));
  $('routeBtn').addEventListener('click', () => ($('dataSheet').classList.contains('open') ? $('dataSheet').classList.remove('open') : openSheet()));
}

/* ==== followAnchor ==== 追従中は自機の画面位置を拡大縮小の中心にする（追従が外れない） */
function followAnchor() {
  return state.settings.follow && Number.isFinite(state.own.lat) ? view.geoToScreen(state.own.lat, state.own.lon) : null;
}

/* ==== measureInsets ==== 上部バーの高さ（グリッドのラベルを隠さないため） */
function measureInsets() {
  view.insetTop = document.querySelector('.topbar').getBoundingClientRect().bottom;
}

function rememberView() {
  const c = view.center();
  state.settings.view = { lat: c.lat, lon: c.lon, scale: view.scale };
  saveLater(SETTINGS_KEY, () => state.settings, 1000);
}

/* ==== handleTap ==== 地点カーソル＋オプション（PC はクリック、タッチは長押し）。近くの地点にスナップ */
function handleTap(sx, sy) {
  const geo = view.screenToGeo(sx, sy);
  lastHits = hitTest(view, state, sx, sy, geo, navContext());
  const snap = lastHits.near[0];
  state.selection = snap ? { lat: snap.lat, lon: snap.lon, name: snap.name, pointId: snap.pointId, elev: snap.elev } : geo;
  state.cursor = { lat: state.selection.lat, lon: state.selection.lon };
  renderCursor();
  $('dataSheet').classList.remove('open');
  $('settingsSheet').classList.remove('open');
  renderInfo(lastHits);
  requestDraw();
}

function wireEvents() {
  view.onChange(() => { requestDraw(); rememberView(); });
  attachGestures($('map'), view, {
    onTap: handleTap,
    onLongPress: handleTap,
    onUserMove: () => {
      gestureActive = true;
      if (state.settings.follow) { state.settings.follow = false; renderTopBar(); }
    },
    onGestureEnd: () => { if (gestureActive) { gestureActive = false; applyOrientation(); } },
    onPoint: (sx, sy) => { state.cursor = view.screenToGeo(sx, sy); renderCursor(); },
    zoomAnchor: followAnchor,
  });
  on('own', (own) => { onOwnUpdate(own); applyOrientation(); renderDataPanel(); requestDraw(); });
  on('route', () => { renderDataPanel(); renderNavOverlays(); renderTab(); requestDraw(); });
  on('alert', renderNavOverlays);
  setInterval(() => { renderNavOverlays(); renderDataPanel(); }, 1000);
  on('tick', () => { renderDataPanel(); requestDraw(); });
  on('gpsStatus', () => { renderTopBar(); renderDataPanel(); if ($('settingsSheet').classList.contains('open')) renderSettings(); });
  on('selection', () => { renderInfo(lastHits); requestDraw(); });
  on('settings', () => {
    renderTopBar();
    renderDataPanel();
    applyGeoVisibility($('geo'), state.settings);
    applyOrientation();
    if (state.selection) renderInfo(lastHits);
    requestDraw();
  });
  window.addEventListener('resize', () => { measureInsets(); view.resize(); });
}

async function boot() {
  setStoreErrorHandler((what, error) => {
    console.error(what, error);
    showBanner(`保存に失敗しました（${what}）。設定は再起動で失われる可能性があります`);
  });
  requestPersistence();
  document.title = `${self.APP_NAME} ${self.APP_VERSION}`;
  await loadSettings();
  await Promise.all([loadAircraft(), loadRoutes(), loadUserPoints()]);
  const s = state.settings;
  const proj = createProjection();
  view = createView($('map'), proj);
  measureInsets();
  view.resize();
  view.setScale(s.view.scale);
  view.centerOn(s.view.lat, s.view.lon);
  $('dataPanel').innerHTML = '<div class="dp-empty">地図データ読込中…</div>';
  try {
    await loadData();
  } catch (error) {
    showBanner(`地図データを読み込めませんでした（${error.message}）`);
  }
  setPointSources({ airports: state.data.airports, navaids: state.data.navaids, routePoints: () => activeRoute()?.points || [] });
  buildGeoLayer($('geo'), proj, state.data);
  applyGeoVisibility($('geo'), s);
  bindUi({
    zoom: (f) => {
      const a = followAnchor() || { x: view.width / 2, y: view.height / 2 };
      view.zoomAt(f, a.x, a.y);
    },
    center: () => view.center(),
    goTo: (p) => { state.settings.follow = false; view.centerOn(p.lat, p.lon); renderTopBar(); },
    redraw: requestDraw,
  });
  bindNavUi({ openSheet });
  bindDataSheet();
  wireEvents();
  renderNavOverlays();
  if (s.manualOwn) setManualOwn(s.manualOwn.lat, s.manualOwn.lon);
  renderTopBar();
  renderDataPanel();
  applyOrientation();
  requestDraw();
  document.body.dataset.ready = 'true';
}

boot();

/* ==== Service Worker ==== オフライン起動の要 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch((error) => {
      showBanner(`オフライン機能を有効にできませんでした（${error.message}）`);
    });
  });
}
