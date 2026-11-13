/* ==== map-view.js ==== 地図の視点（中心・縮尺・回転）と座標変換、指・マウス操作
 * 世界座標 = 投影後の km（x 東, y 北）。画面 = px（y 下向き）。rot は画面上の回転（度, 時計回り正） */
import { destination } from './geo.js';

const MIN_SCALE = 0.08;     // px/km（日本全域が入る程度）
const MAX_SCALE = 60;       // px/km（約 1nm が 110px）
const TAP_MOVE_PX = 8;
const TAP_TIME_MS = 350;
const LONG_PRESS_MS = 550;
const WHEEL_ZOOM = 1.0015;
const PAN_RELEASE_PX = 30;  // ◎ 中、1本指でこれだけ動かしたら ◎ を外して移動
const ROTATE_START_DEG = 10; // 2本指でこれだけ回したら回転を始める（ピンチ中の小さなねじれでは回さない）

export function createView(svg, proj) {
  const v = { cx: 0, cy: 0, scale: 0.6, rot: 0, width: 1, height: 1, listeners: new Set(), proj };
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
  v.rotateAt = (deg, sx, sy) => {            // 画面上の点 (sx,sy) を中心に回す（時計回り正）
    const before = v.screenToWorld(sx, sy);
    v.rot += deg;
    const after = v.screenToWorld(sx, sy);
    v.cx += before.x - after.x; v.cy += before.y - after.y;
    changed();
  };
  v.onChange = (fn) => v.listeners.add(fn);

  function changed() { v.listeners.forEach((fn) => fn(v)); }
  return v;
}

/* ==== attachGestures ==== 1本指=移動、2本指=拡大縮小と回転、ホイール=拡大縮小、短いタップ=選択
 * onPoint：マウスの現在位置／シングルタッチした位置（カーソル座標表示用）。onGestureEnd：指・ボタンを離した
 * zoomAnchor()：拡大縮小・回転の中心を固定したいとき {x,y} を返す（◎ 中は自機）
 * onUserMove：1本指で PAN_RELEASE_PX 以上動かしたときだけ（◎ を外す）。2本指が触れた操作では、指を全部離すまで移動しない（ピンチで ◎ が外れない）
 * onUserRotate：2本指で ROTATE_START_DEG 以上回したとき（以後はその操作の間ずっと回る）
 * タッチ：シングルタップ＝onPoint のみ、長押し＝onLongPress。マウス：クリック＝onTap、右クリック＝onLongPress */
export function attachGestures(svg, view, handlers) {
  const { onTap, onLongPress, onPoint, onGestureEnd, zoomAnchor } = handlers;
  let pressTimer = null;
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
  const local = (e) => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const g = { pointers: new Map(), tapStart: null, pinch: null, multi: false, panned: 0, rotating: false, turned: 0 };
  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    g.tapStart = g.pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), moved: false } : null;
    if (g.pointers.size === 1) {
      const p = local(e);
      onPoint?.(p.x, p.y);
      if (e.pointerType !== 'mouse') pressTimer = setTimeout(() => { pressTimer = null; g.tapStart = null; onLongPress?.(p.x, p.y); }, LONG_PRESS_MS);
    } else cancelPress();
    if (g.pointers.size === 2) { g.pinch = pinchInfo(g.pointers); g.multi = true; }
  });
  svg.addEventListener('pointermove', (e) => {
    const prev = g.pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'mouse') { const p = local(e); onPoint?.(p.x, p.y); }
      return;
    }
    const cur = { x: e.clientX, y: e.clientY };
    g.pointers.set(e.pointerId, cur);
    if (g.tapStart && Math.hypot(cur.x - g.tapStart.x, cur.y - g.tapStart.y) > TAP_MOVE_PX) { g.tapStart.moved = true; cancelPress(); }
    if (g.pointers.size === 1 && !g.multi && (!g.tapStart || g.tapStart.moved)) panStep(view, g, prev, cur, handlers);
    else if (g.pointers.size === 2 && g.pinch) pinchStep(view, g, svg.getBoundingClientRect(), handlers);
  });
  const end = (e) => {
    const r = svg.getBoundingClientRect();
    cancelPress();
    if (e.pointerType === 'mouse' && g.tapStart && !g.tapStart.moved && g.pointers.size === 1 && performance.now() - g.tapStart.t < TAP_TIME_MS) {
      onTap?.(e.clientX - r.left, e.clientY - r.top);
    }
    g.pointers.delete(e.pointerId);
    g.pinch = g.pointers.size < 2 ? null : g.pinch;
    g.tapStart = null;
    if (g.pointers.size === 0) {
      Object.assign(g, { multi: false, panned: 0, rotating: false, turned: 0 });
      onGestureEnd?.();
    }
  };
  ['pointerup', 'pointercancel'].forEach((t) => svg.addEventListener(t, end));
  attachWheelAndMenu(svg, view, local, { onLongPress, zoomAnchor });
}

/* ==== panStep ==== 1本指の移動。◎ 中は PAN_RELEASE_PX までは動かさない（指の震え・2本目の指が遅れて触れる間に ◎ が外れないように） */
function panStep(view, g, prev, cur, { onUserMove, zoomAnchor }) {
  const before = g.panned;
  g.panned += Math.hypot(cur.x - prev.x, cur.y - prev.y);
  if (zoomAnchor?.() && g.panned < PAN_RELEASE_PX) return;
  if (before < PAN_RELEASE_PX && g.panned >= PAN_RELEASE_PX) onUserMove?.();
  view.panBy(cur.x - prev.x, cur.y - prev.y);
}

/* ==== pinchStep ==== 2本指：拡大縮小（◎ 中は自機中心、それ以外は指の中点）と回転（ROTATE_START_DEG を超えてから） */
function pinchStep(view, g, r, { zoomAnchor, onUserRotate }) {
  const next = pinchInfo(g.pointers);
  const anchor = zoomAnchor?.();
  const ax = anchor ? anchor.x : next.x - r.left;
  const ay = anchor ? anchor.y : next.y - r.top;
  view.zoomAt(next.dist / g.pinch.dist, ax, ay);
  const dAng = ((next.ang - g.pinch.ang + 540) % 360) - 180;
  g.turned += dAng;
  if (!g.rotating && Math.abs(g.turned) >= ROTATE_START_DEG) { g.rotating = true; onUserRotate?.(); view.rotateAt(g.turned, ax, ay); }
  else if (g.rotating) view.rotateAt(dAng, ax, ay);
  if (!anchor) view.panBy(next.x - g.pinch.x, next.y - g.pinch.y);
  g.pinch = next;
}

/* ==== attachWheelAndMenu ==== PC：ホイールで拡大縮小、右クリックで地点オプション（タッチの長押しと同じ） */
function attachWheelAndMenu(svg, view, local, { onLongPress, zoomAnchor }) {
  svg.addEventListener('contextmenu', (e) => { e.preventDefault(); const p = local(e); onLongPress?.(p.x, p.y); });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    const anchor = zoomAnchor?.() || p;
    view.zoomAt(WHEEL_ZOOM ** -e.deltaY, anchor.x, anchor.y);
  }, { passive: false });
}

function pinchInfo(pointers) {
  const [a, b] = [...pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), ang: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
}
