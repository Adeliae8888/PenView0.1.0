/* ==== coords.js ==== 座標系の表示と入力解析：DDM（F-16形式）／DMS／DD／MGRS／B/E */
import { bearingTrue, distanceNm, destination, toMagnetic, toTrue, formatBearing } from './geo.js';

export const COORD_FORMATS = ['DDM', 'DMS', 'DD', 'MGRS'];
export const COORD_FORMAT_LABELS = { DDM: 'DD°MM.MMM', DMS: 'DD°MM\'SS"', DD: 'DD.DDDDD', MGRS: 'MGRS' };

/* ==== WGS84 / UTM 定数 ==== */
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const RAD = Math.PI / 180;
const BAND_LETTERS = 'CDEFGHJKLMNPQRSTUVWXX';
const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

/* ==== 緯度経度の文字列化 ==== */
function splitDeg(value) {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  return { abs, deg, minutes: (abs - deg) * 60 };
}

function formatDdm(value, isLat) {
  const hemi = isLat ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E');
  let { deg, minutes } = splitDeg(value);
  let m = Number(minutes.toFixed(3));
  if (m >= 60) { deg += 1; m = 0; }
  return `${hemi}${String(deg).padStart(isLat ? 2 : 3, '0')}°${m.toFixed(3).padStart(6, '0')}′`;
}

function formatDms(value, isLat) {
  const hemi = isLat ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E');
  let { deg, minutes } = splitDeg(value);
  let min = Math.floor(minutes);
  let sec = Number(((minutes - min) * 60).toFixed(1));
  if (sec >= 60) { sec = 0; min += 1; }
  if (min >= 60) { min = 0; deg += 1; }
  return `${hemi}${String(deg).padStart(isLat ? 2 : 3, '0')}°${String(min).padStart(2, '0')}′${sec.toFixed(1).padStart(4, '0')}″`;
}

/* ==== formatLatLon ==== 指定形式で "緯度 経度" を返す */
export function formatLatLon(lat, lon, format = 'DDM') {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '---';
  if (format === 'MGRS') return toMgrs(lat, lon);
  if (format === 'DMS') return `${formatDms(lat, true)} ${formatDms(lon, false)}`;
  if (format === 'DD') return `${lat.toFixed(5)}° ${lon.toFixed(5)}°`;
  return `${formatDdm(lat, true)} ${formatDdm(lon, false)}`;
}

/* ==== formatBe ==== ブルズアイ基準 "045/32"（磁方位/nm） */
export function formatBe(point, bullseye, variation) {
  if (!point || !bullseye) return '---/--';
  const brg = toMagnetic(bearingTrue(bullseye, point), variation);
  return `${formatBearing(brg)}/${Math.round(distanceNm(bullseye, point))}`;
}

/* ==== UTM 変換（Snyder の級数） ==== */
function utmZone(lat, lon) {
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (zone > 60) zone = 60;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  return zone;
}

function meridianArc(phi) {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
    - (35 * e6 / 3072) * Math.sin(6 * phi));
}

export function latLonToUtm(lat, lon, forceZone) {
  const zone = forceZone || utmZone(lat, lon);
  const phi = lat * RAD;
  const lam0 = ((zone - 1) * 6 - 180 + 3) * RAD;
  const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2;
  const c = EP2 * Math.cos(phi) ** 2;
  const a = Math.cos(phi) * (lon * RAD - lam0);
  const easting = K0 * n * (a + (1 - t + c) * a ** 3 / 6 + (5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5 / 120) + 500000;
  let northing = K0 * (meridianArc(phi) + n * Math.tan(phi) * (a * a / 2 + (5 - t + 9 * c + 4 * c * c) * a ** 4 / 24
    + (61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6 / 720));
  if (lat < 0) northing += 10000000;
  return { zone, easting, northing, south: lat < 0 };
}

export function utmToLatLon(zone, easting, northing, south) {
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const x = easting - 500000;
  const y = south ? northing - 10000000 : northing;
  const mu = y / K0 / (A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(phi1);
  const c1 = EP2 * Math.cos(phi1) ** 2;
  const t1 = Math.tan(phi1) ** 2;
  const n1 = A / Math.sqrt(1 - E2 * s * s);
  const r1 = A * (1 - E2) / (1 - E2 * s * s) ** 1.5;
  const d = x / (n1 * K0);
  const lat = phi1 - (n1 * Math.tan(phi1) / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6 / 720);
  const lon = (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5 / 120) / Math.cos(phi1);
  return { lat: lat / RAD, lon: (zone - 1) * 6 - 180 + 3 + lon / RAD };
}

/* ==== toMgrs ==== "54S UE 12345 67890"（precision=5 で 1m） */
export function toMgrs(lat, lon, precision = 5) {
  if (lat < -80 || lat > 84) return 'MGRS範囲外';
  const { zone, easting, northing } = latLonToUtm(lat, lon);
  const band = BAND_LETTERS[Math.floor((lat + 80) / 8)];
  const col = COL_SETS[(zone - 1) % 3][Math.floor(easting / 100000) - 1];
  const row = ROW_LETTERS[(Math.floor(northing / 100000) + (zone % 2 === 0 ? 5 : 0)) % 20];
  const div = 10 ** (5 - precision);
  const e = String(Math.floor((easting % 100000) / div)).padStart(precision, '0');
  const n = String(Math.floor((northing % 100000) / div)).padStart(precision, '0');
  return `${zone}${band} ${col}${row} ${e} ${n}`;
}

/* ==== fromMgrs ==== MGRS 文字列 → {lat, lon}。桁数は 1〜5 桁、マス目の中心を返す */
export function fromMgrs(text) {
  const m = String(text).toUpperCase().replace(/\s+/g, '').match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/);
  if (!m || m[5].length % 2 !== 0 || m[5].length > 10) return null;
  const zone = Number(m[1]);
  const bandIdx = BAND_LETTERS.indexOf(m[2]);
  const colIdx = COL_SETS[(zone - 1) % 3].indexOf(m[3]);
  const rowIdx = ROW_LETTERS.indexOf(m[4]);
  if (zone < 1 || zone > 60 || colIdx < 0) return null;
  const half = m[5].length / 2;
  const scale = 10 ** (5 - half);
  const e5 = half ? Number(m[5].slice(0, half)) * scale : 0;
  const n5 = half ? Number(m[5].slice(half)) * scale : 0;
  const easting = (colIdx + 1) * 100000 + e5 + scale / 2;
  const rowNorthing = (((rowIdx - (zone % 2 === 0 ? 5 : 0)) % 20 + 20) % 20) * 100000 + n5 + scale / 2;
  const bandLat = -80 + 8 * bandIdx;
  const south = bandLat < 0;
  const minNorthing = latLonToUtm(bandLat, (zone - 1) * 6 - 180 + 3, zone).northing;
  let northing = rowNorthing;
  while (northing < minNorthing - 1) northing += 2000000;
  return utmToLatLon(zone, easting, northing, south);
}

/* ==== 入力解析 ==== */
function parseAngle(raw, isLat) {
  let s = raw.trim().toUpperCase();
  let sign = 1;
  const hemi = s.match(/[NSEW]/);
  if (hemi) {
    if (hemi[0] === 'S' || hemi[0] === 'W') sign = -1;
    if ((isLat && /[EW]/.test(hemi[0])) || (!isLat && /[NS]/.test(hemi[0]))) return null;
    s = s.replace(/[NSEW]/g, ' ');
  }
  if (s.trim().startsWith('-')) { sign = -sign; s = s.replace('-', ' '); }
  const parts = s.replace(/[°º'′"″:]/g, ' ').trim().split(/\s+/).filter(Boolean).map(Number);
  if (!parts.length || parts.some((p) => !Number.isFinite(p))) return null;
  let value;
  if (parts.length === 1) {
    const digits = s.trim().split('.')[0].replace(/\D/g, '');
    const degDigits = isLat ? 2 : 3;
    // "3541.370"（DDMM.MMM 連結）と "35.6895"（10進度）を桁数で区別
    value = digits.length > degDigits ? Math.floor(parts[0] / 100) + (parts[0] % 100) / 60 : parts[0];
  } else {
    value = parts[0] + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
  }
  const limit = isLat ? 90 : 180;
  return value <= limit ? sign * value : null;
}

/* ==== parseCoordinate ====
 * 受け付ける例：N35°41.370′ E139°41.502′ ／ N3541.370 E13941.502 ／ 35 41 22.2N 139 41 30.1E
 *               35.6895 139.6917 ／ 54SUE1234567890 ／ B/E "045/32"（ctx に bullseye と variation が必要）
 * 戻り値：{lat, lon} または null */
export function parseCoordinate(text, ctx = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const be = raw.match(/^(\d{1,3}(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (be && ctx.bullseye) {
    const brgTrue = toTrue(Number(be[1]), ctx.variation || 0);
    return destination(ctx.bullseye, brgTrue, Number(be[2]));
  }
  const mgrs = fromMgrs(raw);
  if (mgrs) return mgrs;
  const upper = raw.toUpperCase();
  let latPart;
  let lonPart;
  const ns = upper.search(/[NS]/);
  const ew = upper.search(/[EW]/);
  if (ns >= 0 && ew >= 0) {
    // 前置き（N35.. E139..）は E/W の位置で、後置き（35..N 139..E）は N/S の直後で分ける
    const cut = upper.trim().startsWith(upper[ns]) && ns < ew ? ew : ns + 1;
    latPart = upper.slice(0, cut).replace(/,\s*$/, '');
    lonPart = upper.slice(cut).replace(/^\s*,/, '');
  } else {
    const tokens = upper.split(/[,\s]+/).filter(Boolean);
    if (tokens.length === 2) [latPart, lonPart] = tokens;
    else if (tokens.length % 2 === 0) {
      latPart = tokens.slice(0, tokens.length / 2).join(' ');
      lonPart = tokens.slice(tokens.length / 2).join(' ');
    } else return null;
  }
  const lat = parseAngle(latPart, true);
  const lon = parseAngle(lonPart, false);
  return lat === null || lon === null ? null : { lat, lon };
}
