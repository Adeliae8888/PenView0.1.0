/* ==== main.js ==== 起動と全体の配線：設定読込 → データ読込 → 地図構築 → UI 結線 → Service Worker 登録 */
import { state, on, emit, loadSettings, currentVariation, updateSettings, SETTINGS_KEY } from './state.js';
import { setStoreErrorHandler, requestPersistence, saveLater } from './store.js';
import { createProjection } from './projection.js';
import { createView, attachGestures } from './map-view.js';
import { buildGeoLayer, applyGeoVisibility, drawOverlay, scaleBar, hitTest } from './map-render.js';
import { bindUi, renderDataPanel, renderTopBar, renderInfo, renderSettings, renderCursor, renderPickList, showBanner } from './ui.js';
import { setManualOwn } from './gps.js';
import { loadAircraft } from './aircraft.js';
import { loadRoutes, activeRoute } from './route.js';
import { loadUserPoints, setPointSources } from './points.js';
import { navContext, onOwnUpdate, validityWindow } from './nav.js';
import { loadNavData, navIndex, airacExpired, navItems as navItemsOf } from './navdata.js';
import { buildNavGeo, drawNavOverlay, navHits, navCatalogPoints, officialHides } from './nav-render.js';
import { now } from './clock.js';
import { bindNavUi, renderNavOverlays } from './ui-nav.js';
import { renderRouteTab, bindRouteTab, renderLogTab } from './ui-route.js';
import { renderAircraftTab, bindAircraftTab, renderPointsTab, bindPointsTab } from './ui-data.js';
import { renderProcTab, bindProcTab, fillFromMap } from './ui-proc.js';
import { loadProcedures } from './procedures.js';
import { procSvg, bindLabelDrag, bumpProcContext, syncProcRoutes } from './proc-wire.js';
import { initAndroid } from './android.js';

const $ = (id) => document.getElementById(id);
const DATA_FILES = ['land', 'airspace', 'airports', 'navaids', 'obstacles'];
let view;
let lastHits = null;
let drawPending = false;
let gestureActive = false;          // 指・ボタン操作中は地図を回さない（指の下で地図が回るのを防ぐ）
let openTab = 'route';
const TABS = {
  route: [renderRouteTab, bindRouteTab], log: [renderLogTab, null], aircraft: [renderAircraftTab, bindAircraftTab],
  points: [renderPointsTab, bindPointsTab], proc: [renderProcTab, bindProcTab],
};
const WIDE_SCALE = 1.0;              // px/km 未満を「広域」とする
const NAVGEO_REFRESH_MS = 60000;      // SUP/NOTAM の有効期間で区域を出し入れするため1分ごとに作り直す
let proj;
let win = { start: Date.now(), end: Date.now() };
let navGeoKey = '';

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
    $('navgeo').setAttribute('transform', view.transform());
    // 広域ではルート線（TACAN 以外）を隠す
    $('map').classList.toggle('zoom-wide', view.scale < WIDE_SCALE);
    const hides = officialHides(state.settings);
    drawOverlay($('overlay'), view, state, currentVariation().value, navContext(), { navSvg: drawNavOverlay(view, state, win) + procSvg(view), hideObstacles: hides.obstacles });
    const bar = scaleBar(view);
    $('scaleBar').style.width = `${bar.px}px`;
    $('scaleLabel').textContent = `${bar.nm} nm`;
    const c = view.center();
    $('compassNeedle').setAttribute('transform', `rotate(${view.screenAngle(c.lat, c.lon, 0).toFixed(1)})`);
  });
}

/* ==== applyOrientation ==== ◎ ON は自機を中央に固定。向き：track＝航跡（Track）を上（針路不明・静止中は North-up）／north＝真北を上／free＝回さない */
function applyOrientation() {
  if (gestureActive) return;
  const own = state.own;
  const following = state.settings.follow && Number.isFinite(own.lat);
  const orient = state.settings.orient || (state.settings.follow ? 'track' : 'north');
  if (orient !== 'free') {
    const ref = following ? own : view.center();
    const upBearing = orient === 'track' && following && Number.isFinite(own.trk) ? own.trk : 0;
    // 画面上の向きを測って、その分だけ回す（図法の子午線収束も自動で吸収）
    const angle = view.screenAngle(ref.lat, ref.lon, upBearing);
    if (Math.abs(angle) > 0.05) view.setRotation(view.rot - angle);
  }
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

/* ==== refreshNavGeo ==== 読み込みデータの区域・線を、表示グループと有効期間の時間帯で作り直す */
function refreshNavGeo(force = false) {
  win = validityWindow();
  const minute = (t) => Math.floor(t / NAVGEO_REFRESH_MS);
  const key = JSON.stringify([navIndex().map((r) => r.group + r.importedAt), state.settings.mode, Object.entries(state.settings.layers).filter(([k]) => k.startsWith('nd:')), minute(win.start), minute(win.end)]);
  if (force || key !== navGeoKey) {
    navGeoKey = key;
    buildNavGeo($('navgeo'), proj, state.settings, win);
  }
  applyGeoVisibility($('geo'), state.settings, officialHides(state.settings).airspace);
  const t = now();
  const expired = navIndex().filter((r) => airacExpired(r, t));
  $('airacChip').classList.toggle('hidden', !expired.length);
  if (expired.length) $('airacChip').textContent = `AIRAC 期限切れ ${expired.length} 件`;
}

/* ==== mergeOfficialNavaids ==== 公式 NAVAID のチャンネルを OpenAIP の同じ局に補う（OpenAIP に無い場合） */
function mergeOfficialNavaids() {
  const byId = new Map(navItemsOf('aip-navaid').map((it) => [it.n, it]));
  state.data.navaids.forEach((n) => { const o = byId.get(n.ident); if (o && !n.ch && o.a.CH) n.ch = o.a.CH; });
}

function refreshCatalog() {
  mergeOfficialNavaids();
  const known = new Set([...state.data.navaids.map((n) => n.ident), ...state.data.airports.map((a) => a.icao)]);
  setPointSources({ waypoints: navCatalogPoints(known) });
  bumpProcContext();
}

function selectHit(hit, geo) {
  state.selection = hit ? { lat: hit.lat, lon: hit.lon, name: hit.name, pointId: hit.pointId, elev: hit.elev } : geo;
  state.cursor = { lat: state.selection.lat, lon: state.selection.lon };
  renderCursor();
  renderInfo(lastHits);
  requestDraw();
}

/* ==== handleTap ==== 地点カーソル＋オプション（PC はクリック、タッチは長押し）。近くに複数あればリストで選ぶ */
function handleTap(sx, sy) {
  const geo = view.screenToGeo(sx, sy);
  const nav = navContext();
  lastHits = hitTest(view, state, sx, sy, geo, nav);
  const extra = navHits(view, state, sx, sy, geo, win);
  const seen = new Set();
  lastHits.near = [...lastHits.near, ...extra.near].sort((a, b) => a.d - b.d).filter((h) => !seen.has(h.label) && seen.add(h.label));
  lastHits.airspaces = [...lastHits.airspaces, ...extra.areas];
  $('dataSheet').classList.remove('open');
  $('settingsSheet').classList.remove('open');
  if (lastHits.near.length >= 2) { renderPickList(lastHits.near.slice(0, 8), geo, (hit) => selectHit(hit, geo)); return; }
  selectHit(lastHits.near[0], geo);
}

function wireEvents() {
  view.onChange(() => { requestDraw(); rememberView(); });
  attachGestures($('map'), view, {
    onTap: handleTap,
    onLongPress: handleTap,
    // スワイプ：◎ の中央固定を外し、Track-up ならその時の向きのまま止める（◎ を押すまで戻らない）
    onUserMove: () => {
      gestureActive = true;
      if (state.settings.follow) updateSettings({ follow: false, orient: state.settings.orient === 'north' ? 'north' : 'free' });
    },
    // 2本指の回転：向きは手動に（◎ の中央固定は保つ）
    onUserRotate: () => { gestureActive = true; if (state.settings.orient !== 'free') updateSettings({ orient: 'free' }); },
    onGestureEnd: () => { if (gestureActive) { gestureActive = false; applyOrientation(); } },
    onPoint: (sx, sy) => { state.cursor = view.screenToGeo(sx, sy); renderCursor(); },
    zoomAnchor: followAnchor,
  });
  on('own', (own) => { onOwnUpdate(own); applyOrientation(); renderDataPanel(); requestDraw(); });
  on('route', () => { bumpProcContext(); syncProcRoutes(); renderDataPanel(); renderNavOverlays(); renderTab(); refreshNavGeo(); requestDraw(); });
  on('navdata', () => { refreshCatalog(); refreshNavGeo(true); if (syncProcRoutes()) emit('route'); requestDraw(); });
  on('proc', () => { if (syncProcRoutes()) emit('route'); requestDraw(); });   // 手順の作図を直したら、それを使うルートの点も直す
  on('toEditor', (text) => { if (fillFromMap(text)) openSheet('proc'); });
  bindLabelDrag($('map'), requestDraw);
  $('compass').addEventListener('click', () => updateSettings({ follow: false, orient: 'north' }));
  setInterval(() => { refreshNavGeo(); requestDraw(); }, NAVGEO_REFRESH_MS);
  on('alert', renderNavOverlays);
  setInterval(() => { renderNavOverlays(); renderDataPanel(); }, 1000);
  on('tick', () => { renderDataPanel(); requestDraw(); });
  on('gpsStatus', () => { renderTopBar(); renderDataPanel(); if ($('settingsSheet').classList.contains('open')) renderSettings(); });
  on('selection', () => { renderInfo(lastHits); requestDraw(); });
  on('settings', () => {
    renderTopBar();
    renderDataPanel();
    refreshNavGeo();
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
  await Promise.all([loadAircraft(), loadRoutes(), loadUserPoints(), loadNavData(), loadProcedures()]);
  const s = state.settings;
  proj = createProjection();
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
  refreshCatalog();
  refreshNavGeo(true);
  syncProcRoutes();
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
  initAndroid();
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
