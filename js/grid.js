/* ==== grid.js ==== 縮尺に応じて間隔が変わるグリッド。DD/DDM/DMS は経緯線、MGRS は UTM 方眼。
 * 各線の画面の縁との交点に、選択中の座標系でラベルを付ける */
import { latLonToUtm, utmToLatLon, mgrsSquareLetters } from './coords.js';

const TARGET_PX = 90;              // 線の間隔がこの px 以上になる最小の刻みを選ぶ
const MAX_LINES = 60;              // 1方向あたりの上限（描きすぎ防止）
const PARALLEL_SAMPLES = 32;       // 緯線は円弧なので分割して描く
const UTM_SAMPLES = 12;
const KM_PER_DEG_LAT = 111.2;
const EDGE_PAD = 4;

const MIN = 1 / 60;
const SEC = 1 / 3600;
// 刻み（度）。小さい順
export const GRID_STEPS = {
  DD: [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
  DDM: [0.1 * MIN, 0.2 * MIN, 0.5 * MIN, MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, 1, 2, 5, 10],
  DMS: [5 * SEC, 10 * SEC, 15 * SEC, 30 * SEC, MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, 1, 2, 5, 10],
  MGRS: [100, 1000, 10000, 100000],          // m
};

export function pickStep(steps, pxPerUnit, target = TARGET_PX) {
  return steps.find((s) => s * pxPerUnit >= target) || steps.at(-1);
}

/* ==== formatGridLabel ==== 刻みに見合った桁で経緯度を表記 */
export function formatGridLabel(value, isLat, format, step) {
  const hemi = isLat ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E');
  const pad = isLat ? 2 : 3;
  if (format === 'DD') {
    const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
    return `${value.toFixed(digits)}°`;
  }
  const abs = Math.abs(value);
  if (step >= 1) return `${hemi}${String(Math.round(abs)).padStart(pad, '0')}°`;
  if (format === 'DMS' && step < MIN) {
    const total = Math.round(abs * 3600);
    const d = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `${hemi}${String(d).padStart(pad, '0')}°${String(m).padStart(2, '0')}′${String(total % 60).padStart(2, '0')}″`;
  }
  const tenths = Math.round(abs * 600);            // 0.1分単位
  const d = Math.floor(tenths / 600);
  const m = (tenths % 600) / 10;
  const mText = step < MIN ? m.toFixed(1).padStart(4, '0') : String(Math.round(m)).padStart(2, '0');
  return `${hemi}${String(d).padStart(pad, '0')}°${mText}′`;
}

/* ==== viewBounds ==== 画面の縁を経緯度にして範囲を取る（図法で縁は曲線になるため縁ごとに数点） */
function viewBorderGeo(view) {
  const pts = [];
  const n = 4;
  for (let i = 0; i <= n; i += 1) {
    const f = i / n;
    pts.push([f * view.width, 0], [f * view.width, view.height], [0, f * view.height], [view.width, f * view.height]);
  }
  return pts.map(([x, y]) => view.screenToGeo(x, y));
}

function toScreenPath(view, geoPoints) {
  return geoPoints.map((g, i) => { const p = view.geoToScreen(g.lat, g.lon); return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join('');
}

function toScreenPoints(view, geoPoints) {
  return geoPoints.map((g) => view.geoToScreen(g.lat, g.lon));
}

/* ==== edgeLabelPoint ==== 線（画面座標の折れ線）と縁の交点のうち、優先順の最初の縁を返す */
export function edgeLabelPoint(points, rect, order) {
  const hits = {};
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const cross = (edge, k, t) => { if (t >= 0 && t <= 1 && !hits[edge]) hits[edge] = k(t); };
    if (a.y !== b.y) {
      for (const [edge, y] of [['top', rect.t], ['bottom', rect.b]]) {
        cross(edge, (t) => ({ x: a.x + t * (b.x - a.x), y }), (y - a.y) / (b.y - a.y));
      }
    }
    if (a.x !== b.x) {
      for (const [edge, x] of [['left', rect.l], ['right', rect.r]]) {
        cross(edge, (t) => ({ x, y: a.y + t * (b.y - a.y) }), (x - a.x) / (b.x - a.x));
      }
    }
  }
  const valid = (e) => hits[e] && hits[e].x >= rect.l - 1 && hits[e].x <= rect.r + 1 && hits[e].y >= rect.t - 1 && hits[e].y <= rect.b + 1;
  const edge = order.find(valid);
  return edge ? { edge, ...hits[edge] } : null;
}

function labelSvg(hit, text) {
  if (!hit) return '';
  const anchor = { top: 'middle', bottom: 'middle', left: 'start', right: 'end' }[hit.edge];
  const dx = { left: 3, right: -3 }[hit.edge] || 0;
  const dy = { top: 12, bottom: -4 }[hit.edge] ?? 4;
  return `<text class="grid-lbl" text-anchor="${anchor}" x="${(hit.x + dx).toFixed(1)}" y="${(hit.y + dy).toFixed(1)}">${text}</text>`;
}

/* ==== latLonGrid ==== 経線（縁ラベルは上→下→左→右）と緯線（左→右→上→下） */
function latLonGrid(view, format, rect) {
  const geo = viewBorderGeo(view);
  const lats = geo.map((g) => g.lat);
  const lons = geo.map((g) => g.lon);
  const [lat0, lat1, lon0, lon1] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const step = pickStep(GRID_STEPS[format], KM_PER_DEG_LAT * view.scale);
  if ((lat1 - lat0) / step > MAX_LINES || (lon1 - lon0) / step > MAX_LINES) return { d: '', labels: '' };
  let d = '';
  let labels = '';
  for (let lon = Math.ceil(lon0 / step) * step; lon <= lon1; lon += step) {
    const line = [{ lat: lat0, lon }, { lat: lat1, lon }];        // ランベルト図法の経線は直線
    d += toScreenPath(view, line);
    labels += labelSvg(edgeLabelPoint(toScreenPoints(view, line), rect, ['top', 'bottom', 'left', 'right']), formatGridLabel(lon, false, format, step));
  }
  for (let lat = Math.ceil(lat0 / step) * step; lat <= lat1; lat += step) {
    const line = Array.from({ length: PARALLEL_SAMPLES + 1 }, (_, i) => ({ lat, lon: lon0 + ((lon1 - lon0) * i) / PARALLEL_SAMPLES }));
    d += toScreenPath(view, line);
    labels += labelSvg(edgeLabelPoint(toScreenPoints(view, line), rect, ['left', 'right', 'top', 'bottom']), formatGridLabel(lat, true, format, step));
  }
  return { d, labels };
}

/* ==== mgrsLabel ==== 100km 線は四方の文字、それ以下は 100km 内の主要桁（1km 刻みなら "82"） */
function mgrsLabel(valueM, step, letter) {
  if (step >= 100000) return letter;
  const inSquare = ((valueM % 100000) + 100000) % 100000;
  return step >= 1000 ? String(Math.floor(inSquare / 1000)).padStart(2, '0') : String(Math.floor(inSquare / 100)).padStart(3, '0');
}

/* ==== utmGrid ==== 画面中心の UTM ゾーンで方眼を描く（隣のゾーンにはそのまま延長） */
function utmGrid(view, rect) {
  const center = view.center();
  const zone = latLonToUtm(center.lat, center.lon).zone;
  const south = center.lat < 0;
  const utm = viewBorderGeo(view).map((g) => latLonToUtm(g.lat, g.lon, zone));
  const es = utm.map((u) => u.easting);
  const ns = utm.map((u) => u.northing);
  const [e0, e1, n0, n1] = [Math.min(...es), Math.max(...es), Math.min(...ns), Math.max(...ns)];
  const step = pickStep(GRID_STEPS.MGRS, view.scale / 1000);
  if ((e1 - e0) / step > MAX_LINES || (n1 - n0) / step > MAX_LINES) return { d: '', labels: '' };
  const toGeo = (e, n) => utmToLatLon(zone, e, n, south);
  let d = '';
  let labels = '';
  for (let e = Math.ceil(e0 / step) * step; e <= e1; e += step) {
    const line = Array.from({ length: UTM_SAMPLES + 1 }, (_, i) => toGeo(e, n0 + ((n1 - n0) * i) / UTM_SAMPLES));
    d += toScreenPath(view, line);
    const hit = edgeLabelPoint(toScreenPoints(view, line), rect, ['top', 'bottom', 'left', 'right']);
    labels += labelSvg(hit, mgrsLabel(e, step, mgrsSquareLetters(zone, e + 1, n0).col));
  }
  for (let n = Math.ceil(n0 / step) * step; n <= n1; n += step) {
    const line = Array.from({ length: UTM_SAMPLES + 1 }, (_, i) => toGeo(e0 + ((e1 - e0) * i) / UTM_SAMPLES, n));
    d += toScreenPath(view, line);
    const hit = edgeLabelPoint(toScreenPoints(view, line), rect, ['left', 'right', 'top', 'bottom']);
    labels += labelSvg(hit, mgrsLabel(n, step, mgrsSquareLetters(zone, 100000, n + 1).row));
  }
  return { d, labels };
}

/* ==== drawGrid ==== グリッドの SVG 文字列（線＋縁ラベル） */
export function drawGrid(view, format, insetTop = 0) {
  const rect = { l: EDGE_PAD, t: insetTop + EDGE_PAD, r: view.width - EDGE_PAD, b: view.height - EDGE_PAD };
  const { d, labels } = format === 'MGRS' ? utmGrid(view, rect) : latLonGrid(view, format, rect);
  return d ? `<path class="grid-line" d="${d}"/>${labels}` : '';
}
