/* ==== main.js ==== 起動と全体の配線：設定読込 → データ読込 → 地図構築 → UI 結線 → Service Worker 登録 */
import { state, on, loadSettings, currentVariation, SETTINGS_KEY } from './state.js';
import { setStoreErrorHandler, requestPersistence, saveLater } from './store.js';
import { createProjection } from './projection.js';
import { createView, attachGestures } from './map-view.js';
import { buildGeoLayer, applyGeoVisibility, drawOverlay, scaleBar, hitTest } from './map-render.js';
import { bindUi, renderDataPanel, renderTopBar, renderInfo, renderSettings, showBanner } from './ui.js';
import { setManualOwn } from './gps.js';

const $ = (id) => document.getElementById(id);
const DATA_FILES = ['land', 'airspace', 'airports', 'navaids', 'obstacles'];
const TRACK_UP_OWN_Y = 0.68;        // Track-up では自機を画面の下寄りに置く

let view;
let lastHits = null;
let drawPending = false;

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
    drawOverlay($('overlay'), view, state, currentVariation().value);
    const bar = scaleBar(view);
    $('scaleBar').style.width = `${bar.px}px`;
    $('scaleLabel').textContent = `${bar.nm} nm`;
    const c = view.center();
    const northAngle = view.screenAngle(c.lat, c.lon, 0);
    $('northArrow').classList.toggle('hidden', Math.abs(northAngle) < 1);
    $('northArrow').style.transform = `rotate(${northAngle}deg)`;
  });
}

/* ==== applyOrientation ==== 追従・North-up / Track-up を視点に反映 */
function applyOrientation() {
  const s = state.settings;
  const own = state.own;
  const trackUp = s.mode === 'NAV' && s.orientation === 'track' && Number.isFinite(own.trk);
  const ref = Number.isFinite(own.lat) && s.follow ? own : view.center();
  // 画面上の向きを測って、その分だけ回す（図法の子午線収束も自動で吸収）
  const angle = view.screenAngle(ref.lat, ref.lon, trackUp ? own.trk : 0);
  if (Math.abs(angle) > 0.05) view.setRotation(view.rot - angle);
  if (s.follow && Number.isFinite(own.lat)) view.centerOn(own.lat, own.lon, trackUp ? TRACK_UP_OWN_Y : 0.5);
}

function rememberView() {
  const c = view.center();
  state.settings.view = { lat: c.lat, lon: c.lon, scale: view.scale };
  saveLater(SETTINGS_KEY, () => state.settings, 1000);
}

function handleTap(sx, sy) {
  const geo = view.screenToGeo(sx, sy);
  state.selection = geo;
  lastHits = hitTest(view, state, sx, sy, geo);
  $('settingsSheet').classList.remove('open');
  renderInfo(lastHits);
  requestDraw();
}

function wireEvents() {
  view.onChange(() => { requestDraw(); rememberView(); });
  attachGestures($('map'), view, {
    onTap: handleTap,
    onUserMove: () => { if (state.settings.follow) { state.settings.follow = false; renderTopBar(); } },
  });
  on('own', () => { applyOrientation(); renderDataPanel(); requestDraw(); });
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
  window.addEventListener('resize', () => view.resize());
}

async function boot() {
  setStoreErrorHandler((what, error) => {
    console.error(what, error);
    showBanner(`保存に失敗しました（${what}）。設定は再起動で失われる可能性があります`);
  });
  requestPersistence();
  document.title = `${self.APP_NAME} ${self.APP_VERSION}`;
  await loadSettings();
  const s = state.settings;
  const proj = createProjection();
  view = createView($('map'), proj);
  view.resize();
  view.setScale(s.view.scale);
  view.centerOn(s.view.lat, s.view.lon);
  $('dataPanel').innerHTML = '<div class="dp-empty">地図データ読込中…</div>';
  try {
    await loadData();
  } catch (error) {
    showBanner(`地図データを読み込めませんでした（${error.message}）`);
  }
  buildGeoLayer($('geo'), proj, state.data);
  applyGeoVisibility($('geo'), s);
  bindUi({
    zoom: (f) => view.zoomAt(f, view.width / 2, view.height / 2),
    center: () => view.center(),
    goTo: (p) => { state.settings.follow = false; view.centerOn(p.lat, p.lon); renderTopBar(); },
    redraw: requestDraw,
  });
  wireEvents();
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
