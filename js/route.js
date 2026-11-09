/* ==== route.js ==== ルートの保持と編集、アクティブ STPT、自動送り、DIRECT（実行待ち → EXECUTE）
 * 並び：points[0]=離陸飛行場、points[末尾]=目的飛行場。alternate=目的地から代替飛行場までの点（任意） */
import { load, save } from './store.js';
import { distanceNm, bearingTrue, norm360 } from './geo.js';

export const ROUTES_KEY = 'routes';
const SEQUENCE_NM = 2;              // この距離以内で次の STPT へ
const ABEAM_MAX_NM = 15;            // 真横通過の判定はこの距離以内に限る（遠くの「背後」で誤判定しない）
export const DEFAULT_CRUISE_ALT = 20000;

const store = { routes: [], activeId: null };
const uid = (p) => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export async function loadRoutes() {
  const saved = await load(ROUTES_KEY, null);
  if (saved) Object.assign(store, saved);
  return store;
}

export function saveRoutes() {
  return save(ROUTES_KEY, store);
}

export function routes() {
  return store.routes;
}

export function activeRoute() {
  return store.routes.find((r) => r.id === store.activeId) || null;
}

export function setActiveRoute(id) {
  store.activeId = id;
  saveRoutes();
}

export function newRoute(name = `ROUTE ${store.routes.length + 1}`) {
  const r = {
    id: uid('rt'), name, points: [], alternate: [], activeIdx: 1, configRef: null, startFuel: null, joker: null, bingo: null,
    plannedTakeoff: null, wind: null, isaDev: 0, cruiseAlt: DEFAULT_CRUISE_ALT, flight: { takeoffAt: null, checks: [], directOrigin: null },
  };
  store.routes.push(r);
  if (!store.activeId) store.activeId = r.id;
  saveRoutes();
  return r;
}

export function removeRoute(id) {
  store.routes = store.routes.filter((r) => r.id !== id);
  if (store.activeId === id) store.activeId = store.routes[0]?.id || null;
  saveRoutes();
}

export function duplicateRoute(route) {
  const copy = { ...structuredClone(route), id: uid('rt'), name: `${route.name} コピー`, flight: { takeoffAt: null, checks: [], directOrigin: null } };
  store.routes.push(copy);
  saveRoutes();
  return copy;
}

/* ==== makePoint ==== STPT の形。高度の既定：飛行場は標高、それ以外は巡航高度 */
export function makePoint(src, route) {
  return {
    id: uid('pt'), name: (src.name || 'STPT').toUpperCase().slice(0, 14), lat: src.lat, lon: src.lon,
    alt: Number.isFinite(src.alt) ? src.alt : Number.isFinite(src.elev) ? src.elev : route?.cruiseAlt ?? DEFAULT_CRUISE_ALT,
    // 飛行場（標高あり）への区間は既定高度で巡航してから降下する
    legAlt: Number.isFinite(src.elev) ? route?.cruiseAlt ?? DEFAULT_CRUISE_ALT : null,
    def: src.def || '', tos: null, wind: null, phase: 'auto', speed: null, skipped: false,
  };
}

/* ==== addPoint ==== 2点以上あれば目的地の手前に、未満なら末尾に入れる。list='alternate' で代替経路へ */
export function addPoint(route, src, list = 'points') {
  const arr = route[list];
  const p = makePoint(src, route);
  if (list === 'points' && arr.length >= 2) arr.splice(arr.length - 1, 0, p); else arr.push(p);
  saveRoutes();
  return p;
}

export function removePoint(route, index, list = 'points') {
  route[list].splice(index, 1);
  if (list === 'points') route.activeIdx = Math.min(Math.max(1, route.activeIdx), Math.max(1, route.points.length - 1));
  saveRoutes();
}

export function movePoint(route, index, delta, list = 'points') {
  const arr = route[list];
  const j = index + delta;
  if (j < 0 || j >= arr.length) return;
  [arr[index], arr[j]] = [arr[j], arr[index]];
  saveRoutes();
}

/* ==== stepActive ==== ▲▼：飛ばした点を避けて前後の STPT へ。手動で動かしたら DIRECT の起点は解除 */
export function stepActive(route, delta) {
  let i = route.activeIdx;
  do { i += delta; } while (route.points[i]?.skipped);
  if (i < 1 || i >= route.points.length) return false;
  route.activeIdx = i;
  route.flight.directOrigin = null;
  saveRoutes();
  return true;
}

/* ==== passedActive ==== 自動送りの判定：2nm 以内、または区間コースに対して STPT が背後（真横を過ぎた） */
export function passedActive(route, own) {
  const target = route.points[route.activeIdx];
  if (!target || !Number.isFinite(own?.lat)) return false;
  const dist = distanceNm(own, target);
  if (dist <= SEQUENCE_NM) return true;
  if (dist > ABEAM_MAX_NM) return false;
  const from = route.flight.directOrigin || route.points[route.activeIdx - 1];
  if (!from) return false;
  const course = bearingTrue(from, target);
  const rel = norm360(bearingTrue(own, target) - course);
  return rel > 90 && rel < 270;
}

/* ==== autoSequence ==== 通過したら次へ。最後（目的地）では送らない。送った STPT の番号を返す */
export function autoSequence(route, own) {
  if (route.activeIdx >= route.points.length - 1 || !passedActive(route, own)) return null;
  const passed = route.activeIdx;
  stepActive(route, 1);
  return passed;
}

/* ==== executeDirect ==== DIRECT 実行。ルート内の点なら途中を飛ばす。ルート外なら現在のアクティブの手前に挿入（その後は元のルートへ） */
export function executeDirect(route, target, own) {
  let idx = route.points.findIndex((p) => p.id === target.pointId);
  if (idx < 0) {
    idx = Math.max(1, route.activeIdx);
    route.points.splice(idx, 0, makePoint({ ...target, alt: route.points[idx]?.alt }, route));
  }
  route.points.forEach((p, i) => { if (i < idx && i >= route.activeIdx) p.skipped = true; });
  route.points[idx].skipped = false;
  route.activeIdx = idx;
  route.flight.directOrigin = { lat: own.lat, lon: own.lon, name: 'DIR' };
  saveRoutes();
  return idx;
}

/* ==== recordFuelCheck / recordTakeoff ==== 実績の記録 */
export function recordFuelCheck(route, idx, fuel, at) {
  route.flight.checks.push({ idx, fuel, at });
  saveRoutes();
}

export function recordTakeoff(route, at) {
  if (route.flight.takeoffAt) return false;
  route.flight.takeoffAt = at;
  saveRoutes();
  return true;
}

/* ==== resetFlight ==== 実績（離陸時刻・燃料チェック・DIRECT）を消して計画に戻す */
export function resetFlight(route) {
  route.flight = { takeoffAt: null, checks: [], directOrigin: null };
  route.points.forEach((p) => { p.skipped = false; });
  route.activeIdx = 1;
  saveRoutes();
}

/* ==== mergeRoutes ==== 共有ファイルの取り込み（同じ id は上書き） */
export function mergeRoutes(list) {
  (list || []).forEach((r) => {
    const i = store.routes.findIndex((x) => x.id === r.id);
    if (i >= 0) store.routes[i] = r; else store.routes.push(r);
  });
  if (!store.activeId && store.routes.length) store.activeId = store.routes[0].id;
  saveRoutes();
}
