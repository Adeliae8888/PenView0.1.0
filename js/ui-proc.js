/* ==== ui-proc.js ==== SID/STAR/APP エディター（手順タブ）：一覧 → 編集。パーツを追加してつなぐ（パズル型）
 * 入力のたびに地図のプレビューが更新される。フィックスは文字で入れるか、地図の長押し →「エディターへ」 */
import { state, emit } from './state.js';
import { procedures, findProcedure, newProcedure, removeProcedure, duplicateProcedure, saveProcedures, newPart, PROC_TYPES, PART_TYPES, procLabel } from './procedures.js';
import { searchPoints } from './points.js';
import { built } from './proc-render.js';
import { esc } from './map-render.js';
import { DEFAULT_GRADIENT_PCT, DEFAULT_BANK_DEG, turnRadiusNm } from './procgeo.js';

const ALT_TYPES = { '': '高度制限なし', at: '指定（上下線）', above: '以上（下線）', below: '以下（上線）', between: '範囲' };
const val = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : v);
let editingId = null;
let lastFixPath = null;            // 地図から「エディターへ」で値を入れる先（入力欄の道筋）
let procCtx = null;                // procgeo 用の地点検索（main から設定）

export function setProcContext(ctx) { procCtx = ctx; }
export function editingProcId() { return editingId; }

function fld(path, label, value, opts = {}) {
  const type = opts.type || 'number';
  const extra = opts.fix ? ' list="procSuggest" data-fix="1" autocomplete="off"' : '';
  return `<label class="${opts.grow ? 'grow' : ''}">${label}<input type="${type}" step="any" data-pp="${path}" value="${esc(val(value))}" placeholder="${esc(opts.ph || '')}"${extra} /></label>`;
}

function sel(path, label, value, options) {
  return `<label>${label}<select data-pp="${path}">${Object.entries(options).map(([k, v]) => `<option value="${esc(k)}" ${String(value ?? '') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
}

/* ==== partFields ==== パーツの種類ごとの入力欄 */
function partFields(pt, base) {
  if (pt.type === 'tf') return fld(`${base}.to`, '→ フィックス', pt.to, { type: 'text', fix: true, grow: true, ph: 'MENOU / HUC R-300 / GOT R-210 / HUC R-270 D15' });
  if (pt.type === 'arc') {
    return fld(`${base}.station`, '局', pt.station, { type: 'text', fix: true, ph: 'HUC' }) + fld(`${base}.dme`, 'DME', pt.dme)
      + fld(`${base}.to`, '→ ラジアル', pt.to) + sel(`${base}.dir`, '向き', pt.dir, { R: '右回り', L: '左回り' });
  }
  const head = pt.type === 'radial'
    ? fld(`${base}.station`, '局', pt.station, { type: 'text', fix: true, ph: 'HUC' }) + fld(`${base}.radial`, 'R-', pt.radial) + sel(`${base}.inbound`, '', pt.inbound ? '1' : '', { '': '外向き', 1: '局へ向かう' })
    : fld(`${base}.hdg`, '針路 °M', pt.hdg);
  const e = pt.end || {};
  const endSel = sel(`${base}.end.type`, '終わり', e.type, { dme: 'DME', fix: 'フィックス/ラジアル', alt: '高度' });
  let endFld = '';
  if (e.type === 'dme') endFld = (pt.type === 'heading' ? fld(`${base}.end.station`, '局', e.station, { type: 'text', fix: true }) : '') + fld(`${base}.end.dist`, 'D', e.dist);
  if (e.type === 'fix') endFld = fld(`${base}.end.to`, 'フィックス', e.to, { type: 'text', fix: true, grow: true, ph: 'HUC R-300 / MENOU' });
  if (e.type === 'alt') endFld = fld(`${base}.end.alt`, '高度 ft', e.alt) + fld(`${base}.end.grad`, '上昇勾配 %', e.grad, { ph: String(DEFAULT_GRADIENT_PCT) });
  return head + endSel + endFld;
}

/* ==== turnFields ==== 前のパーツとの角を旋回でつなぐ：半径を直接、または KIAS・高度・バンク */
function turnFields(pt, base) {
  const t = pt.turn || {};
  const mode = sel(`${base}.turn.mode`, '旋回', t.mode || '', { '': 'なし', radius: '半径', perf: 'KIAS・バンク' });
  if (t.mode === 'radius') return mode + fld(`${base}.turn.radius`, '半径 nm', t.radius);
  if (t.mode === 'perf') {
    const r = turnRadiusNm(t);
    return mode + fld(`${base}.turn.kias`, 'KIAS', t.kias) + fld(`${base}.turn.alt`, '高度 ft', t.alt) + fld(`${base}.turn.bank`, 'バンク°', t.bank, { ph: String(DEFAULT_BANK_DEG) })
      + `<span class="muted">半径 ${r > 0 ? r.toFixed(2) : '-'} nm</span>`;
  }
  return mode;
}

function partCard(pt, i, list, n) {
  const base = `${list}.${i}`;
  const a = pt.alt || {};
  return `<div class="part-card"><div class="part-head"><b>${i + 1}. ${esc(PART_TYPES[pt.type])}</b>
      <span class="grow"></span><button type="button" class="btn sm" data-pa="up" data-list="${list}" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="btn sm" data-pa="down" data-list="${list}" data-i="${i}" ${i === n - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" class="btn sm" data-pa="lbl" data-list="${list}" data-i="${i}" title="注記の位置を戻す">注記↺</button>
      <button type="button" class="btn sm danger" data-pa="del" data-list="${list}" data-i="${i}">×</button></div>
    <div class="row wrap">${partFields(pt, base)}</div>
    <div class="row wrap">${i > 0 && pt.type !== 'arc' ? turnFields(pt, base) : ''}${fld(`${base}.name`, '終点の名前', pt.name, { type: 'text', ph: '自動' })}</div>
    <div class="row wrap">${sel(`${base}.alt.type`, '高度制限', a.type || '', ALT_TYPES)}${a.type ? fld(`${base}.alt.v`, a.type === 'between' ? '上限' : 'ft', a.v) : ''}${a.type === 'between' ? fld(`${base}.alt.v2`, '下限', a.v2) : ''}${fld(`${base}.speed`, '速度制限 KT', pt.speed)}</div></div>`;
}

function palette(list) {
  return `<div class="row wrap palette">${Object.entries(PART_TYPES).map(([k, v]) => `<button type="button" class="btn sm primary" data-add-part="${k}" data-list="${list}">＋${esc(v)}</button>`).join('')}</div>`;
}

/* ==== headerFields ==== 手順の基本：飛行場・種別・名前・開始点 */
function headerFields(p) {
  const ad = procCtx?.findAirport(p.ad);
  const rwys = Object.fromEntries([['', '—'], ...(ad?.rwy || []).map((r) => [r.d, `RWY${r.d}（${r.hdg}°T）`])]);
  const start = p.type === 'SID'
    ? sel('rwy', '滑走路', p.rwy, rwys) + fld('derText', '滑走路端の座標（AIP AD 2.12）', p.derText, { type: 'text', grow: true, ph: '空欄＝標点・方位・長さから推定' })
    : fld('startFix', '開始フィックス', p.startFix, { type: 'text', fix: true, grow: true }) + fld('startAlt', '開始高度 ft', p.startAlt);
  return `<div class="row wrap">${fld('ad', '飛行場', p.ad, { type: 'text', ph: 'RJAH' })}${sel('type', '種別', p.type, Object.fromEntries(PROC_TYPES.map((t) => [t, t])))}${fld('name', '名前', p.name, { type: 'text', grow: true, ph: 'TOPAZ1' })}
    <label><input type="checkbox" data-pp="visible" ${p.visible !== false ? 'checked' : ''}/> 表示</label></div><div class="row wrap">${start}</div>`;
}

/* ==== renderProcTab ==== 一覧、または編集中の手順 */
export function renderProcTab(el) {
  const p = findProcedure(editingId);
  if (!p) { el.innerHTML = listHtml(); return; }
  const r = procCtx ? built(p, procCtx) : { warnings: [] };
  el.innerHTML = `<div class="row"><button type="button" class="btn" data-pr="back">← 一覧</button><b class="grow">${esc(procLabel(p))}</b>
      <button type="button" class="btn" data-pr="dup">複製</button></div>${headerFields(p)}
    ${r.warnings.length ? `<ul class="warn">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <h3>パーツ（つなぐ順）</h3>${p.parts.map((pt, i) => partCard(pt, i, 'parts', p.parts.length)).join('')}${palette('parts')}
    ${p.type === 'APP' ? `<h3>進入復行（破線）</h3>${p.missed.map((pt, i) => partCard(pt, i, 'missed', p.missed.length)).join('')}${palette('missed')}` : ''}
    <p class="muted">フィックスは「MENOU」「HUC R-270 D15」「HUC R-300 / GOT R-210」「HUC R-270 / GOT D15」や座標で。地図を長押し →「エディターへ」でも入ります。地図の注記はドラッグで動かせます。</p>
    <datalist id="procSuggest"></datalist>`;
}

function listHtml() {
  const rows = procedures().map((p) => `<tr><td><input type="checkbox" data-pvis="${p.id}" ${p.visible !== false ? 'checked' : ''}/></td>
    <td class="pick" data-pr="edit" data-id="${p.id}"><b>${esc(procLabel(p))}</b></td><td><button type="button" class="btn sm danger" data-pr="del" data-id="${p.id}">×</button></td></tr>`).join('');
  return `<div class="row"><button type="button" class="btn primary" data-pr="new">新規の手順</button></div>
    <table class="pts">${rows || '<tr><td class="muted">まだありません</td></tr>'}</table><p class="muted">手順は NAV モードで表示。書き出し・読込は設定から。</p>`;
}

/* ==== setPath ==== "parts.2.end.dist" のような道筋に値を入れる（数値欄は数値に） */
function setPath(obj, path, raw, isNum) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  let v = raw;
  if (last === 'inbound') v = raw === '1';
  else if (last === 'visible') v = raw;
  else if (isNum) v = raw === '' ? null : Number(raw);
  else if (['ad', 'to', 'station', 'startFix', 'name', 'derText'].includes(last) && typeof raw === 'string') v = raw.toUpperCase();
  target[last] = v;
}

function cleanup(p) {
  [...p.parts, ...p.missed].forEach((pt) => {
    if (pt.alt && !pt.alt.type) pt.alt = null;
    if (pt.turn && !pt.turn.mode) pt.turn = null;
  });
}

/* ==== bindProcTab ==== 入力・ボタン（イベント委譲） */
export function bindProcTab(el, rerender) {
  el.addEventListener('focusin', (e) => { if (e.target.dataset?.fix) lastFixPath = e.target.dataset.pp; });
  el.addEventListener('input', (e) => {
    if (!e.target.dataset?.fix) return;
    el.querySelector('#procSuggest').innerHTML = searchPoints(e.target.value.split(/[ /]/).pop()).map((p) => `<option value="${esc(p.name)}">${esc(p.label)}</option>`).join('');
  });
  el.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.pvis) { const p = findProcedure(t.dataset.pvis); if (p) { p.visible = t.checked; saveProcedures(); emit('proc'); } return; }
    const p = findProcedure(editingId);
    if (!p || !t.dataset.pp) return;
    setPath(p, t.dataset.pp, t.type === 'checkbox' ? t.checked : t.value, t.type === 'number');
    cleanup(p);
    saveProcedures();
    emit('proc');
    rerender();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button, [data-pr="edit"]');
    if (!b) return;
    handleClick(b);
    rerender();
    emit('proc');
  });
}

function handleClick(b) {
  const act = b.dataset.pr;
  if (act === 'new') editingId = newProcedure('', 'SID').id;
  if (act === 'edit') editingId = b.dataset.id;
  if (act === 'back') editingId = null;
  if (act === 'del' && confirm('この手順を削除しますか？')) removeProcedure(b.dataset.id);
  const p = findProcedure(editingId);
  if (!p) return;
  if (act === 'dup') editingId = duplicateProcedure(p).id;
  if (b.dataset.addPart) p[b.dataset.list].push(newPart(b.dataset.addPart));
  const arr = b.dataset.list && p[b.dataset.list];
  const i = Number(b.dataset.i);
  if (b.dataset.pa === 'del') arr.splice(i, 1);
  if (b.dataset.pa === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
  if (b.dataset.pa === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
  if (b.dataset.pa === 'lbl') { delete arr[i].lbl; delete arr[i].lbl2; }
  saveProcedures();
}

/* ==== fillFromMap ==== 地図の長押し →「エディターへ」：最後に触ったフィックス欄に地点名（無ければ座標）を入れる */
export function fillFromMap(text) {
  const p = findProcedure(editingId);
  if (!p || !lastFixPath) return false;
  setPath(p, lastFixPath, text, false);
  saveProcedures();
  emit('proc');
  return true;
}

/* ==== moveLabel ==== 地図上で注記をドラッグしたとき（procId|partId|which） */
export function moveLabel(key, dx, dy) {
  const [procId, partId, which] = key.split('|');
  const p = findProcedure(procId);
  const pt = p && [...p.parts, ...p.missed].find((x) => x.id === partId);
  if (!pt) return;
  const prop = which === 'course' ? 'lbl2' : 'lbl';
  const cur = pt[prop] || { dx: which === 'fix' ? 10 : 0, dy: which === 'fix' ? -8 : -6 };
  pt[prop] = { dx: cur.dx + dx, dy: cur.dy + dy };
}

export function editingOpen() {
  return !!editingId;
}
