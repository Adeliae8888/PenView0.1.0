/* ==== proc-wire.js ==== 手順（SID/STAR/APP）と地図・データのつなぎ：描画する手順の選択、地点検索、注記のドラッグ */
import { state } from './state.js';
import { procedures } from './procedures.js';
import { drawProcedures } from './proc-render.js';
import { findPoint, resolvePoint } from './points.js';
import { setProcContext, editingProcId, moveLabel } from './ui-proc.js';
import { saveProcedures, findProcedure } from './procedures.js';
import { built } from './proc-render.js';
import { routes, activeRoute, saveRoutes } from './route.js';
import { syncRouteProcs, missedPoints } from './route-proc.js';
import { aipRunways } from './aip-import.js';

/* ==== findAirport ==== 飛行場（OpenAIP）。AIP AD2 を読み込んだ飛行場は滑走路を AIP のもの（L/R・THR・DER・標高）に置き換え */
function findAirport(icao) {
  const id = String(icao || '').toUpperCase();
  const ad = state.data.airports.find((a) => a.icao === id) || null;
  const rwy = aipRunways(id);
  if (!rwy) return ad;
  const arp = ad?.p || [rwy[0].thr.lon, rwy[0].thr.lat];
  return { ...(ad || { icao: id, elev: rwy[0].elev || 0 }), p: arp, rwy, aip: true };
}

let ctxVersion = 0;
const ctx = {
  findPoint: (name) => findPoint(name),
  resolvePoint: (text) => resolvePoint(text),
  findAirport,
  get version() { return ctxVersion; },
};
setProcContext(ctx);

/* ==== bumpProcContext ==== 地点データ（読み込みデータ・ユーザーポイント）が変わったら計算をやり直す */
export function bumpProcContext() {
  ctxVersion += 1;
}

const build = (proc) => built(proc, ctx);

/* ==== syncProcRoutes ==== 手順の点を作図に合わせて入れ直す。飛行中のルートは、利用者が選び直したとき（force）だけ。変わったら保存して true */
export function syncProcRoutes({ route = null, force = false } = {}) {
  let changed = false;
  (route ? [route] : routes()).forEach((r) => {
    if (!force && r.flight?.takeoffAt) return;
    if (syncRouteProcs(r, findProcedure, build)) changed = true;
  });
  if (changed) saveRoutes();
  return changed;
}

/* ==== routeMissedPoints ==== アクティブルートの APP の進入復行の点 */
export function routeMissedPoints(route) {
  return missedPoints(route, findProcedure, build);
}

/* ==== routeProcIds ==== アクティブルートで選んだ手順（レイヤー・表示の設定に関わらず NAV で描く） */
function routeProcIds() {
  const r = activeRoute();
  return new Set(Object.values(r?.procs || {}).filter(Boolean));
}

/* ==== procSvg ==== NAV モードで、ルートで選んだ手順・レイヤー ON の手順・編集中の手順を描く。航法中の区間は強調 */
export function procSvg(view) {
  const s = state.settings;
  const editing = editingProcId();
  if (s.mode !== 'NAV' && !editing) return '';
  const onRoute = s.mode === 'NAV' ? routeProcIds() : new Set();
  const list = procedures().filter((p) => p.id === editing || onRoute.has(p.id) || (s.layers.procedures !== false && p.visible !== false));
  const r = activeRoute();
  const activePart = r?.points[r.activeIdx]?.proc?.partId || null;
  return list.length ? drawProcedures(view, list, ctx, editing, activePart, onRoute) : '';
}

/* ==== bindLabelDrag ==== 編集中の手順の注記をドラッグで動かす（地図のパン・長押しより先に受ける） */
export function bindLabelDrag(mapEl, requestDraw) {
  mapEl.addEventListener('pointerdown', (e) => {
    const t = e.target.closest?.('[data-lbl]');
    const editing = editingProcId();
    if (!t || !editing || !t.dataset.lbl.startsWith(`${editing}|`)) return;
    e.stopPropagation();
    e.preventDefault();
    const key = t.dataset.lbl;
    let last = { x: e.clientX, y: e.clientY };
    const move = (ev) => {
      moveLabel(key, ev.clientX - last.x, ev.clientY - last.y);
      last = { x: ev.clientX, y: ev.clientY };
      requestDraw();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      saveProcedures();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, true);
}
