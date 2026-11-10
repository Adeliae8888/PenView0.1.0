/* ==== proc-wire.js ==== 手順（SID/STAR/APP）と地図・データのつなぎ：描画する手順の選択、地点検索、注記のドラッグ */
import { state } from './state.js';
import { procedures } from './procedures.js';
import { drawProcedures } from './proc-render.js';
import { findPoint, resolvePoint } from './points.js';
import { setProcContext, editingProcId, moveLabel } from './ui-proc.js';
import { saveProcedures } from './procedures.js';

let ctxVersion = 0;
const ctx = {
  findPoint: (name) => findPoint(name),
  resolvePoint: (text) => resolvePoint(text),
  findAirport: (icao) => state.data.airports.find((a) => a.icao === String(icao || '').toUpperCase()) || null,
  get version() { return ctxVersion; },
};
setProcContext(ctx);

/* ==== bumpProcContext ==== 地点データ（読み込みデータ・ユーザーポイント）が変わったら計算をやり直す */
export function bumpProcContext() {
  ctxVersion += 1;
}

/* ==== procSvg ==== NAV モードで、レイヤー ON の手順と編集中の手順を描く */
export function procSvg(view) {
  const s = state.settings;
  const editing = editingProcId();
  if (s.mode !== 'NAV' && !editing) return '';
  const list = procedures().filter((p) => p.id === editing || (s.layers.procedures !== false && p.visible !== false));
  return list.length ? drawProcedures(view, list, ctx, editing) : '';
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
