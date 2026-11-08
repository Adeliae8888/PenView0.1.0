/* ==== map-render.js ==== 地図の描画。陸地・空域は「世界座標の固定パス＋変換行列」、点記号と自機は「画面座標で毎回描画」 */
import { destination, distanceNm, pointInRing } from './geo.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// 縮尺（px/km）ごとの表示しきい値
const SHOW = { airport: 0.2, airportLabel: 0.7, airportName: 3, navaid: 0.25, navaidLabel: 0.5, navaidFreq: 2, obstacle: 4, obstacleLabel: 12 };
const BULL_RINGS_NM = [20, 40, 60, 80, 100];
const BULL_SPOKES_DEG = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const RING_SEGMENTS = 96;
const PREDICTOR_MIN = 2;           // 自機の予測線：何分先まで
const CULL_MARGIN_PX = 40;
const TAC_DECLUTTER = 3;          // TAC では施設記号を3倍拡大するまで出さない（脅威とブルズアイを優先）

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ringToPath(ring, proj) {
  let d = '';
  ring.forEach(([lon, lat], i) => {
    const p = proj.forward(lat, lon);
    d += `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  });
  return `${d}Z`;
}

/* ==== buildGeoLayer ==== 陸地と空域（種類ごとに1本のパス）を一度だけ作る */
export function buildGeoLayer(group, proj, data) {
  group.replaceChildren();
  const add = (cls, d, extra = {}) => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', cls);
    path.setAttribute('d', d);
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    Object.entries(extra).forEach(([k, val]) => path.setAttribute(k, val));
    group.appendChild(path);
  };
  if (data.land) add('land', data.land.rings.map((r) => ringToPath(r, proj)).join(''));
  const byClass = {};
  data.airspace.forEach((a) => { (byClass[a.c] ||= []).push(ringToPath(a.g, proj)); });
  Object.entries(byClass).forEach(([cls, paths]) => add(`as as-${cls}`, paths.join(''), { 'data-as': cls }));
}

/* ==== applyGeoVisibility ==== レイヤー・空域種別の表示切替 */
export function applyGeoVisibility(group, settings) {
  group.querySelector('.land')?.classList.toggle('off', !settings.layers.land);
  group.querySelectorAll('[data-as]').forEach((p) => {
    p.classList.toggle('off', !settings.layers.airspace || !settings.airspaceClasses[p.dataset.as]);
  });
}

function inView(p, view) {
  return p.x > -CULL_MARGIN_PX && p.y > -CULL_MARGIN_PX && p.x < view.width + CULL_MARGIN_PX && p.y < view.height + CULL_MARGIN_PX;
}

function drawAirports(view, items, show, k = 1) {
  if (!show || view.scale < SHOW.airport * k) return '';
  return items.map((a) => {
    const p = view.geoToScreen(a.p[1], a.p[0]);
    if (!inView(p, view)) return '';
    const mil = a.t === 'mil' || a.t === 'heli-mil';
    let label = '';
    if (view.scale >= SHOW.airportLabel * k) label = esc(a.icao || '');
    if (view.scale >= SHOW.airportName * k) label = `${label} ${esc(a.n)}`;
    return `<g class="apt${mil ? ' mil' : ''}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><circle r="5"/><path d="M-8 0H8M0-8V8"/>${label ? `<text x="9" y="4">${label}</text>` : ''}</g>`;
  }).join('');
}

function drawNavaids(view, items, show, k = 1) {
  if (!show || view.scale < SHOW.navaid * k) return '';
  return items.map((n) => {
    const p = view.geoToScreen(n.p[1], n.p[0]);
    if (!inView(p, view)) return '';
    let label = view.scale >= SHOW.navaidLabel * k ? esc(n.ident) : '';
    if (view.scale >= SHOW.navaidFreq * k) label += ` ${esc(n.t)} ${esc(n.f)}`;
    return `<g class="nav" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><path d="M-6 0L-3-5.2H3L6 0 3 5.2H-3Z"/><circle r="1.5"/>${label ? `<text x="8" y="-6">${label}</text>` : ''}</g>`;
  }).join('');
}

function drawObstacles(view, items, show) {
  if (!show || view.scale < SHOW.obstacle) return '';
  return items.map((o) => {
    const p = view.geoToScreen(o.p[1], o.p[0]);
    if (!inView(p, view)) return '';
    const label = view.scale >= SHOW.obstacleLabel ? `<text x="5" y="-4">${o.e}</text>` : '';
    return `<g class="obs" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><path d="M-4 3L0-6 4 3Z"/>${label}</g>`;
  }).join('');
}

function geoPolyline(view, points) {
  return points.map((g, i) => { const p = view.geoToScreen(g.lat, g.lon); return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join('');
}

/* ==== drawBullseye ==== TAC ではレンジリングと放射線（磁方位基準）も描く */
function drawBullseye(view, bull, variation, rings) {
  if (!bull) return '';
  const c = view.geoToScreen(bull.lat, bull.lon);
  let out = '';
  if (rings) {
    out += BULL_RINGS_NM.map((r) => {
      const pts = Array.from({ length: RING_SEGMENTS + 1 }, (_, i) => destination(bull, (i * 360) / RING_SEGMENTS, r));
      return `<path class="bull-ring" d="${geoPolyline(view, pts)}"/>`;
    }).join('');
    out += BULL_SPOKES_DEG.map((m) => {
      const brg = m + variation;   // 磁方位 → 真方位
      const end = destination(bull, brg, BULL_RINGS_NM.at(-1));
      const e = view.geoToScreen(end.lat, end.lon);
      const lbl = m % 90 === 0 ? `<text class="bull-lbl" x="${e.x.toFixed(1)}" y="${e.y.toFixed(1)}">${String(m).padStart(3, '0')}</text>` : '';
      return `<path class="bull-spoke" d="M${c.x.toFixed(1)} ${c.y.toFixed(1)}L${e.x.toFixed(1)} ${e.y.toFixed(1)}"/>${lbl}`;
    }).join('');
  }
  out += `<g class="bull" transform="translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})"><circle r="9"/><circle r="4"/><path d="M0-14V14M-14 0H14"/><text x="12" y="-10">${esc(bull.name || 'BULL')}</text></g>`;
  return out;
}

function drawSelection(view, sel) {
  if (!sel) return '';
  const p = view.geoToScreen(sel.lat, sel.lon);
  return `<g class="sel" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><circle r="10"/><path d="M-16 0H-6M6 0H16M0-16V-6M0 6V16"/></g>`;
}

/* ==== drawOwnship ==== 自機（三角）＋ 予測線（GS × 2分） */
function drawOwnship(view, own) {
  if (!Number.isFinite(own.lat)) return '';
  const p = view.geoToScreen(own.lat, own.lon);
  const hasTrack = Number.isFinite(own.trk);
  const angle = hasTrack ? view.screenAngle(own.lat, own.lon, own.trk) : 0;
  let predictor = '';
  if (hasTrack && own.gs > 30) {
    const ahead = destination(own, own.trk, (own.gs * PREDICTOR_MIN) / 60);
    const q = view.geoToScreen(ahead.lat, ahead.lon);
    predictor = `<path class="own-pred" d="M${p.x.toFixed(1)} ${p.y.toFixed(1)}L${q.x.toFixed(1)} ${q.y.toFixed(1)}"/>`;
  }
  const stale = own.source === 'gps' && Date.now() - own.time > 5000 ? ' stale' : '';
  return `${predictor}<g class="own${stale}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${angle.toFixed(1)})"><path d="M0-13L9 10 0 5-9 10Z"/></g>`;
}

/* ==== drawOverlay ==== 画面座標の記号層を丸ごと描き直す（毎フレーム最大1回） */
export function drawOverlay(el, view, state, variation) {
  const s = state.settings;
  const tac = s.mode === 'TAC';
  const k = tac ? TAC_DECLUTTER : 1;
  el.innerHTML = [
    drawObstacles(view, state.data.obstacles, s.layers.obstacles && !tac),
    drawAirports(view, state.data.airports, s.layers.airports, k),
    drawNavaids(view, state.data.navaids, s.layers.navaids, k),
    drawBullseye(view, s.bullseye, variation, tac),
    drawSelection(view, state.selection),
    drawOwnship(view, state.own),
  ].join('');
}

/* ==== scaleBarNm ==== 縮尺バーに使うきりの良い nm と px 長 */
export function scaleBar(view) {
  const a = view.screenToGeo(view.width / 2 - 50, view.height / 2);
  const b = view.screenToGeo(view.width / 2 + 50, view.height / 2);
  const nmPer100 = distanceNm(a, b);
  const nice = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find((n) => n >= nmPer100 * 0.8) || 500;
  return { nm: nice, px: (nice / nmPer100) * 100 };
}

/* ==== hitTest ==== タップ位置の近くの空港・NAVAID と、その点を含む空域 */
export function hitTest(view, state, sx, sy, geo) {
  const near = [];
  const pick = (items, kind, label) => items.forEach((it) => {
    const p = view.geoToScreen(it.p[1], it.p[0]);
    const d = Math.hypot(p.x - sx, p.y - sy);
    if (d < 22) near.push({ kind, d, label: label(it), lat: it.p[1], lon: it.p[0] });
  });
  if (state.settings.layers.airports) pick(state.data.airports, 'apt', (a) => `${a.icao ? `${a.icao} ` : ''}${a.n}（標高 ${a.elev}m）`);
  if (state.settings.layers.navaids) pick(state.data.navaids, 'nav', (n) => `${n.ident} ${n.t} ${n.f}（${n.n}）`);
  near.sort((x, y) => x.d - y.d);
  return { near: near.slice(0, 3), airspaces: airspacesAt(state, geo) };
}

function airspacesAt(state, geo) {
  const s = state.settings;
  if (!s.layers.airspace) return [];
  return state.data.airspace
    .filter((a) => s.airspaceClasses[a.c] && pointInBox(geo, a) && pointInRing(geo.lon, geo.lat, a.g))
    .map((a) => `${a.n}  ${fmtLimit(a.lo)}–${fmtLimit(a.up)}`)
    .slice(0, 8);
}

function pointInBox(geo, a) {
  if (!a.box) {
    const xs = a.g.map((q) => q[0]);
    const ys = a.g.map((q) => q[1]);
    a.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  return geo.lon >= a.box[0] && geo.lon <= a.box[2] && geo.lat >= a.box[1] && geo.lat <= a.box[3];
}

export function fmtLimit(l) {
  if (!l) return '?';
  if (l.u === 'FL') return `FL${String(l.v).padStart(3, '0')}`;
  if (l.d === 'GND' && l.v === 0) return 'SFC';
  return `${l.v}${l.u === 'm' ? 'm' : 'ft'}${l.d === 'GND' ? ' AGL' : ''}`;
}
