/* ==== map-view.js ==== 地図の視点（中心・縮尺・回転）と座標変換、指・マウス操作
 * 世界座標 = 投影後の km（x 東, y 北）。画面 = px（y 下向き）。rot は画面上の回転（度, 時計回り正） */
import { destination } from './geo.js';

const MIN_SCALE = 0.08;     // px/km（日本全域が入る程度）
const MAX_SCALE = 60;       // px/km（約 1nm が 110px）
const TAP_MOVE_PX = 8;
const TAP_TIME_MS = 350;
const WHEEL_ZOOM = 1.0015;

export function createView(svg, proj) {
  const v = { cx: 0, cy: 0, scale: 0.6, rot: 0, width: 1, height: 1, listeners: new Set() };
  const RAD = Math.PI / 180;

  v.resize = () => {
    const r = svg.getBoundingClientRect();
    v.width = Math.max(1, r.width);
    v.height = Math.max(1, r.height);
    changed();
  };
  v.worldToScreen = (x, y) => {
    const px = (x - v.cx) * v.scale;
    const py = -(y - v.cy) * v.scale;
    const c = Math.cos(v.rot * RAD);
    const s = Math.sin(v.rot * RAD);
    return { x: v.width / 2 + px * c - py * s, y: v.height / 2 + px * s + py * c };
  };
  v.screenToWorld = (sx, sy) => {
    const dx = sx - v.width / 2;
    const dy = sy - v.height / 2;
    const c = Math.cos(-v.rot * RAD);
    const s = Math.sin(-v.rot * RAD);
    return { x: v.cx + (dx * c - dy * s) / v.scale, y: v.cy - (dx * s + dy * c) / v.scale };
  };
  v.geoToScreen = (lat, lon) => { const w = proj.forward(lat, lon); return v.worldToScreen(w.x, w.y); };
  v.screenToGeo = (sx, sy) => { const w = v.screenToWorld(sx, sy); return proj.inverse(w.x, w.y); };
  // 真方位 brg の向きが画面上で何度か（上=0, 時計回り）
  v.screenAngle = (lat, lon, brg) => {
    const a = v.geoToScreen(lat, lon);
    const ahead = destination({ lat, lon }, brg, 1);
    const b = v.geoToScreen(ahead.lat, ahead.lon);
    return Math.atan2(b.x - a.x, a.y - b.y) / RAD;
  };
  // SVG transform（世界 km → 画面 px）
  v.transform = () => `translate(${v.width / 2} ${v.height / 2}) rotate(${v.rot}) scale(${v.scale} ${-v.scale}) translate(${-v.cx} ${-v.cy})`;

  v.centerOn = (lat, lon, screenFracY = 0.5) => {
    const w = proj.forward(lat, lon);
    v.cx = w.x; v.cy = w.y;
    if (screenFracY !== 0.5) {           // 自機を画面下寄りに置く（Track-up 用）
      const c = v.screenToWorld(v.width / 2, v.height / 2 - (screenFracY - 0.5) * v.height);
      v.cx = c.x; v.cy = c.y;
    }
    changed();
  };
  v.center = () => v.screenToGeo(v.width / 2, v.height / 2);
  v.setScale = (scale) => { v.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)); changed(); };
  v.zoomAt = (factor, sx, sy) => {
    const before = v.screenToWorld(sx, sy);
    v.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
    const after = v.screenToWorld(sx, sy);
    v.cx += before.x - after.x; v.cy += before.y - after.y;
    changed();
  };
  v.panBy = (dx, dy) => {
    const a = v.screenToWorld(0, 0);
    const b = v.screenToWorld(dx, dy);
    v.cx -= b.x - a.x; v.cy -= b.y - a.y;
    changed();
  };
  v.setRotation = (deg) => { v.rot = deg; changed(); };
  v.onChange = (fn) => v.listeners.add(fn);

  function changed() { v.listeners.forEach((fn) => fn(v)); }
  return v;
}

/* ==== attachGestures ==== 1本指=移動、2本指=拡大縮小、ホイール=拡大縮小、短いタップ=選択 */
export function attachGestures(svg, view, { onTap, onUserMove }) {
  const pointers = new Map();
  let tapStart = null;
  let pinch = null;

  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tapStart = pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), moved: false } : null;
    if (pointers.size === 2) pinch = pinchInfo(pointers);
  });

  svg.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    if (tapStart && Math.hypot(cur.x - tapStart.x, cur.y - tapStart.y) > TAP_MOVE_PX) tapStart.moved = true;
    if (pointers.size === 1 && (!tapStart || tapStart.moved)) {
      view.panBy(cur.x - prev.x, cur.y - prev.y);
      onUserMove?.();
    } else if (pointers.size === 2 && pinch) {
      const next = pinchInfo(pointers);
      const r = svg.getBoundingClientRect();
      view.zoomAt(next.dist / pinch.dist, next.x - r.left, next.y - r.top);
      view.panBy(next.x - pinch.x, next.y - pinch.y);
      pinch = next;
      onUserMove?.();
    }
  });

  const end = (e) => {
    const r = svg.getBoundingClientRect();
    if (tapStart && !tapStart.moved && pointers.size === 1 && performance.now() - tapStart.t < TAP_TIME_MS) {
      onTap?.(e.clientX - r.left, e.clientY - r.top);
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    tapStart = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    view.zoomAt(WHEEL_ZOOM ** -e.deltaY, e.clientX - r.left, e.clientY - r.top);
    onUserMove?.();
  }, { passive: false });
}

function pinchInfo(pointers) {
  const [a, b] = [...pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
}
