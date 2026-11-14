/* ==== ruler.js ==== ルーラー：2点の磁方位／逆方位と距離（例 045° / 225°  32.4nm）。NAV・TAC 共通
 * ボタンで ON → 2回タップ（PC はクリック）で端点を置く → 端点はドラッグで動かせる → もう一度ボタンで消す
 * 端点は近くの点（NAVAID・WPT・STPT 等）に吸い付く（吸い付く範囲は設定 rulerSnapPx、吸い付けは呼び出し側が行う） */
import { distanceNm, bearingTrue, toMagnetic, formatBearing, norm360 } from './geo.js';

const GRAB_PX = 30;   // 端点をつかめる距離（画面 px）
const PREVIEW_MIN_PX = 12;   // 1点目を置いた直後（カーソルがほぼ同じ位置）は仮の線を出さない
const r = { on: false, a: null, b: null, drag: null };

export function rulerOn() { return r.on; }
export function rulerPoints() { return { a: r.a, b: r.b }; }
export function rulerDragging() { return !!r.drag; }

/* ==== toggleRuler ==== ON/OFF（OFF で線を消す）。戻り値は ON か */
export function toggleRuler() {
  Object.assign(r, { on: !r.on, a: null, b: null, drag: null });
  return r.on;
}

/* ==== rulerTap ==== 端点を置く途中なら置いて true（地点情報は開かない）。2点そろった後は false */
export function rulerTap(pt) {
  if (!r.on || r.b) return false;
  if (!r.a) r.a = pt;
  else r.b = pt;
  return true;
}

/* ==== rulerGrab ==== 画面座標の近くに端点があればつかむ（近いほう） */
export function rulerGrab(view, sx, sy) {
  if (!r.on) return false;
  let best = null;
  ['a', 'b'].forEach((k) => {
    if (!r[k]) return;
    const p = view.geoToScreen(r[k].lat, r[k].lon);
    const d = Math.hypot(p.x - sx, p.y - sy);
    if (d <= GRAB_PX && (!best || d < best.d)) best = { k, d };
  });
  r.drag = best?.k || null;
  return !!best;
}

export function rulerDrag(pt) { if (r.drag) r[r.drag] = pt; }
export function rulerDrop() { r.drag = null; }

/* ==== rulerMeasure ==== a→b の磁方位・逆方位（±180）・距離 nm */
export function rulerMeasure(a, b, variation) {
  const brg = toMagnetic(bearingTrue(a, b), variation);
  return { brg, rec: norm360(brg + 180), nm: distanceNm(a, b) };
}

/* ==== formatRuler ==== "045° / 225°  32.4nm"（100nm 以上は整数） */
export function formatRuler(m) {
  const nm = m.nm >= 100 ? Math.round(m.nm) : m.nm.toFixed(1);
  return `${formatBearing(m.brg)}° / ${formatBearing(m.rec)}°  ${nm}nm`;
}

/* ==== rulerSvg ==== 線・端点・読み。b が未設定のときはカーソルまで点線で仮表示 */
export function rulerSvg(view, variation, cursor) {
  if (!r.on || !r.a) return '';
  const b = r.b || cursor;
  const pa = view.geoToScreen(r.a.lat, r.a.lon);
  const end = (p, k) => `<g class="ruler-end${r.drag === k ? ' drag' : ''}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><circle r="9"/><circle class="dot" r="2.5"/></g>`;
  const pb = b && view.geoToScreen(b.lat, b.lon);
  if (!pb || (!r.b && Math.hypot(pb.x - pa.x, pb.y - pa.y) < PREVIEW_MIN_PX)) return `<g class="ruler">${end(pa, 'a')}</g>`;
  const line = `<path class="ruler-line${r.b ? '' : ' preview'}" d="M${pa.x.toFixed(1)} ${pa.y.toFixed(1)}L${pb.x.toFixed(1)} ${pb.y.toFixed(1)}"/>`;
  return `<g class="ruler">${line}${end(pa, 'a')}${r.b ? end(pb, 'b') : ''}${rulerLabel(pa, pb, formatRuler(rulerMeasure(r.a, b, variation)))}</g>`;
}

/* ==== rulerLabel ==== 線の中点の脇に読み（線に重ならないよう法線方向へずらす） */
function rulerLabel(pa, pb, text) {
  const mx = (pa.x + pb.x) / 2;
  const my = (pa.y + pb.y) / 2;
  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
  let nx = -(pb.y - pa.y) / len;
  let ny = (pb.x - pa.x) / len;
  if (ny > 0) { nx = -nx; ny = -ny; }   // 上側へ
  const x = mx + nx * 18;
  const y = my + ny * 18;
  const w = text.length * 7.6 + 12;
  return `<g class="ruler-lbl" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><rect x="${(-w / 2).toFixed(1)}" y="-11" width="${w.toFixed(1)}" height="22" rx="4"/><text text-anchor="middle" y="5">${text}</text></g>`;
}
