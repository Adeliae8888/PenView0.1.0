/* ==== geo.js ==== 測地計算（大圏距離・方位・到達点）と磁気偏差。距離は nm、方位は度（真方位） */

export const EARTH_RADIUS_NM = 3440.065;
export const KM_PER_NM = 1.852;
export const FT_PER_M = 3.28084;
export const KT_PER_MPS = 1.943844;

const RAD = Math.PI / 180;

export function norm360(deg) {
  return ((deg % 360) + 360) % 360;
}

/* ==== distanceNm ==== 2点間の大圏距離（haversine） */
export function distanceNm(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ==== bearingTrue ==== a から b への初期真方位 */
export function bearingTrue(a, b) {
  const p1 = a.lat * RAD;
  const p2 = b.lat * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return norm360(Math.atan2(y, x) / RAD);
}

/* ==== destination ==== 起点から真方位・距離(nm)進んだ点 */
export function destination(origin, bearingDeg, distNm) {
  const d = distNm / EARTH_RADIUS_NM;
  const t = bearingDeg * RAD;
  const p1 = origin.lat * RAD;
  const l1 = origin.lon * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / RAD, lon: ((l2 / RAD + 540) % 360) - 180 };
}

/* ==== 磁気偏差 ====
 * 規約：偏差は E を正・W を負（8°W = -8）。磁方位 = 真方位 - 偏差
 * 国土地理院 磁気図2020.0年値の近似式（西偏を正, 分単位）。Δφ=φ-37°, Δλ=λ-138°
 * https://vldb.gsi.go.jp/sokuchi/geomag/menu_04/index.html */
const GSI_2020 = { lat0: 37, lon0: 138, c0: 8 * 60 + 15.822, cPhi: 18.462, cLam: -7.726, cPhi2: 0.007, cPhiLam: -0.007, cLam2: -0.655 };
const GSI_BOUNDS = { minLat: 20, maxLat: 46, minLon: 122, maxLon: 154 };

export function gsiVariation(lat, lon) {
  const b = GSI_BOUNDS;
  if (!(lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon)) return null;
  const k = GSI_2020;
  const p = lat - k.lat0;
  const l = lon - k.lon0;
  const westMinutes = k.c0 + k.cPhi * p + k.cLam * l + k.cPhi2 * p * p + k.cPhiLam * p * l + k.cLam2 * l * l;
  return -westMinutes / 60;
}

export function toMagnetic(trueDeg, variation) {
  return norm360(trueDeg - variation);
}

export function toTrue(magneticDeg, variation) {
  return norm360(magneticDeg + variation);
}

/* ==== formatVariation ==== -7.6 → "7.6°W" */
export function formatVariation(variation) {
  if (!Number.isFinite(variation)) return '---';
  const side = variation < 0 ? 'W' : variation > 0 ? 'E' : '';
  return `${Math.abs(variation).toFixed(1)}°${side}`;
}

/* ==== formatBearing ==== 3桁表記（000〜359） */
export function formatBearing(deg) {
  if (!Number.isFinite(deg)) return '---';
  return String(Math.round(norm360(deg)) % 360).padStart(3, '0');
}

/* ==== crossTrackNm ==== 大圏コース a→b に対する p の横ずれ（nm）。正＝コースの右 */
export function crossTrackNm(a, b, p) {
  const d13 = distanceNm(a, p) / EARTH_RADIUS_NM;
  const t13 = bearingTrue(a, p) * RAD;
  const t12 = bearingTrue(a, b) * RAD;
  return Math.asin(Math.sin(d13) * Math.sin(t13 - t12)) * EARTH_RADIUS_NM;
}

/* ==== pointInRing ==== 経緯度の多角形内判定（ring は [lon, lat] 配列） */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
