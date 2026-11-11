/* ==== points.js ==== 全地点の検索（飛行場・NAVAID・ユーザーポイント・ルートの STPT・取り込んだウェイポイント）と
 * 「基準点 方位/距離」での地点定義。NAVAID 基準のラジアルは局の公表偏差で換算する */
import { destination, gsiVariation, toTrue } from './geo.js';
import { parseCoordinate } from './coords.js';
import { load, save } from './store.js';

export const USER_POINTS_KEY = 'userPoints';

const sources = { airports: [], navaids: [], waypoints: [], userPoints: [], routePoints: () => [] };

export function setPointSources(patch) {
  Object.assign(sources, patch);
}

export async function loadUserPoints() {
  sources.userPoints = await load(USER_POINTS_KEY, []);
  return sources.userPoints;
}

export function userPoints() {
  return sources.userPoints;
}

export function saveUserPoints() {
  return save(USER_POINTS_KEY, sources.userPoints);
}

export function addUserPoint(p) {
  const point = { id: `up-${Date.now().toString(36)}`, name: String(p.name).trim().toUpperCase().slice(0, 12), lat: p.lat, lon: p.lon, note: p.note || '' };
  sources.userPoints.push(point);
  saveUserPoints();
  return point;
}

export function removeUserPoint(id) {
  sources.userPoints = sources.userPoints.filter((p) => p.id !== id);
  saveUserPoints();
}

/* ==== allPoints ==== 名前で引ける全地点（優先順：ユーザー → STPT → NAVAID → 飛行場 → ウェイポイント）
 * 飛行場と同じ名前の STPT は除く（同じ基地へ戻るルートで、目的地が DEP の点として引かれ標高を失わないように） */
export function allPoints() {
  const icao = new Set(sources.airports.map((a) => a.icao).filter(Boolean));
  return [
    ...sources.userPoints.map((p) => ({ name: p.name, label: `${p.name}（ユーザー）`, lat: p.lat, lon: p.lon, kind: 'user' })),
    ...sources.routePoints().filter((p) => !icao.has(p.name)).map((p) => ({ name: p.name, label: `${p.name}（STPT）`, lat: p.lat, lon: p.lon, kind: 'stpt' })),
    ...sources.navaids.map((n) => ({ name: n.ident, label: `${n.ident} ${n.t}（${n.n}）`, lat: n.p[1], lon: n.p[0], kind: 'navaid', dec: n.dec })),
    ...sources.airports.filter((a) => a.icao).map((a) => ({ name: a.icao, label: `${a.icao}（${a.n}）`, lat: a.p[1], lon: a.p[0], kind: 'airport', elev: a.elev })),
    ...sources.waypoints.map((w) => ({ name: w.n, label: `${w.n}（${w.t || 'WPT'}）`, lat: w.p[1], lon: w.p[0], kind: 'waypoint' })),
  ];
}

export function findPoint(name) {
  const key = String(name || '').trim().toUpperCase();
  return key ? allPoints().find((p) => p.name.toUpperCase() === key) || null : null;
}

export function searchPoints(query, limit = 12) {
  const q = String(query || '').trim().toUpperCase();
  if (!q) return [];
  return allPoints().filter((p) => p.name.toUpperCase().startsWith(q) || p.label.toUpperCase().includes(q)).slice(0, limit);
}

/* ==== radialVariation ==== 基準点の方位を真方位にするための偏差。NAVAID は局の公表偏差、それ以外は地点の偏差 */
function radialVariation(base, fallbackVar) {
  if (base.kind === 'navaid' && Number.isFinite(base.dec)) return base.dec;
  const v = gsiVariation(base.lat, base.lon);
  return v === null ? fallbackVar : v;
}

/* ==== resolvePoint ==== 入力文字列 → 地点
 * 受け付ける例：HUC ／ HUC 270/25 ／ HUC270/25.5 ／ N3611.0 E14024.9 ／ MGRS ／ 045/30（ブルズアイ基準）
 * 戻り値：{name, lat, lon, def, kind, elev?} または null */
export function resolvePoint(text, ctx = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const m = raw.toUpperCase().match(/^([A-Z0-9_-]+?)\s*(\d{1,3}(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    const base = findPoint(m[1]);
    if (base) {
      const brgTrue = toTrue(Number(m[2]), radialVariation(base, ctx.variation || 0));
      const p = destination(base, brgTrue, Number(m[3]));
      return { name: `${base.name}${String(Math.round(Number(m[2]))).padStart(3, '0')}${String(Math.round(Number(m[3]))).padStart(3, '0')}`, ...p, def: raw.toUpperCase(), kind: 'fix' };
    }
  }
  const named = findPoint(raw);
  if (named) return { ...named, def: named.name };
  const c = parseCoordinate(raw, ctx);
  return c ? { name: '', ...c, def: raw, kind: 'coord' } : null;
}
