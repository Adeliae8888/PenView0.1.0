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
    plannedTakeoff: null, wind: null, isaDev: 0, cruiseAlt: DEFAULT_CRUISE_ALT, bingoPoint: null, homeBingo: null, homeBingoPointId: null, procs: { SID: null, STAR: null, APP: null }, flight: { takeoffAt: null, checks: [], directOrigin: null },
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

/* ==== addPoint ==== index 指定があればその位置に。無ければ、2点以上あれば目的地の手前、未満なら末尾。list='alternate' で代替経路へ */
export function addPoint(route, src, list = 'points', index = null) {
  const arr = route[list];
  const p = makePoint(src, route);
  if (Number.isInteger(index)) {
    const i = Math.max(0, Math.min(arr.length, index));
    arr.splice(i, 0, p);
    if (list === 'points' && i <= route.activeIdx && arr.length > 2) route.activeIdx += 1;   // アクティブの点は変えない
  } else if (list === 'points' && arr.length >= 2) {
    const arrival = arr.findIndex((q) => q.proc && q.proc.role !== 'SID');   // STAR・APP があればその手前
    arr.splice(arrival > 0 ? arrival : arr.length - 1, 0, p);
  } else arr.push(p);
  saveRoutes();
  return p;
}

/* ==== setActiveIdx ==== アクティブ STPT を直接選ぶ（DEP は選べない） */
export function setActiveIdx(route, i) {
  if (i < 1 || i >= route.points.length) return;
  route.points.forEach((p, k) => { if (k >= i) p.skipped = false; });
  route.activeIdx = i;
  route.flight.directOrigin = null;
  saveRoutes();
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

/* ==== executeMissed ==== MISSED APP：復行の点を目的地の後ろに足してアクティブにする。目的地と未通過の点は飛ばす
 * 代替飛行場へは向けない（DIVERT を押したときだけ）。元の計画は flight.planned に取っておき、リセットで戻す */
export function executeMissed(route, missedPts) {
  if (!missedPts.length || route.flight.missed) return false;
  route.flight.planned = structuredClone({ points: route.points, alternate: route.alternate, activeIdx: route.activeIdx });
  const dst = route.points.length - 1;
  route.points[dst].role = 'dst';
  route.points.forEach((p, i) => { if (i >= route.activeIdx) p.skipped = true; });
  route.points.push(...missedPts.map((p) => ({ ...structuredClone(p), skipped: false })));
  route.activeIdx = dst + 1;
  route.flight.directOrigin = null;
  route.flight.missed = { at: Date.now() };
  saveRoutes();
  return true;
}

/* ==== executeDivert ==== DIVERT：現在位置から代替経路（A1 … ALT）へ。代替経路の点を主経路の後ろに移し、代替飛行場が新しい行き先になる */
export function executeDivert(route, own) {
  if (!route.alternate?.length || route.flight.diverted || !Number.isFinite(own?.lat)) return false;
  if (!route.flight.planned) route.flight.planned = structuredClone({ points: route.points, alternate: route.alternate, activeIdx: route.activeIdx });
  const start = route.points.length;
  route.points.forEach((p, i) => { if (i >= route.activeIdx) p.skipped = true; });
  route.alternate.forEach((p, i, arr) => route.points.push({ ...structuredClone(p), id: uid('pt'), mark: i === arr.length - 1 ? 'ALT' : 'A', skipped: false }));
  route.alternate = [];
  route.activeIdx = start;
  route.flight.directOrigin = { lat: own.lat, lon: own.lon, name: 'DIV' };
  route.flight.diverted = { at: Date.now() };
  saveRoutes();
  return true;
}

/* ==== pointTag ==== 経路の点の表示名：DEP／DST／ALT／番号（手順の点は「2 SID」のように印つき） */
export function pointTag(points, i) {
  const p = points[i];
  if (i === 0) return 'DEP';
  if (p?.role === 'dst') return 'DST';
  if (p?.mark === 'ALT') return 'ALT';
  if (i === points.length - 1 && !p?.mark) return 'DST';
  return p?.mark ? `${i} ${p.mark}` : String(i);
}

/* ==== resetFlight ==== 実績（離陸時刻・燃料チェック・DIRECT・復行・DIVERT）を消して計画に戻す */
export function resetFlight(route) {
  if (route.flight?.planned) Object.assign(route, route.flight.planned);
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
