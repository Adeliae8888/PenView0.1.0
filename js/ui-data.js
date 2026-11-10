/* ==== ui-data.js ==== 機体（機種・形態の性能登録）／ユーザーポイント（書き出し・読込は設定画面 ui-settings-data.js） */
import { state, emit, currentVariation } from './state.js';
import { aircraftList, addAircraft, removeAircraft, saveAircraft, blankConfig } from './aircraft.js';
import { userPoints, addUserPoint, removeUserPoint, resolvePoint } from './points.js';
import { convertSpeed, nextSpeedUnit } from './aero.js';
import { formatLatLon } from './coords.js';
import { esc } from './map-render.js';

const UNIT_LABEL = { TAS: 'KTAS', MACH: 'MACH', IAS: 'KIAS' };
const val = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : v);
let selAc = null;
let selCfg = null;

function current() {
  const list = aircraftList();
  const ac = list.find((a) => a.id === selAc) || list[0] || null;
  const cfg = ac?.configs.find((c) => c.id === selCfg) || ac?.configs[0] || null;
  return { ac, cfg };
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

function numField(cfg, path, label) {
  return `<label>${label}<input type="number" step="any" data-cf="${path}" value="${esc(val(getPath(cfg, path)))}" /></label>`;
}

function speedField(cfg, path) {
  const s = getPath(cfg, path) || { unit: 'TAS', value: null };
  return `<label>速度<span class="spd"><input type="number" step="any" data-cf="${path}" value="${esc(val(s.value))}" /><button type="button" class="btn unit" data-cunit="${path}">${UNIT_LABEL[s.unit]}</button></span></label>`;
}

/* ==== renderAircraftTab ==== 機種・形態の選択と性能値 */
export function renderAircraftTab(el) {
  const { ac, cfg } = current();
  const acOpts = aircraftList().map((a) => `<option value="${a.id}" ${a.id === ac?.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  const cfgOpts = (ac?.configs || []).map((c) => `<option value="${c.id}" ${c.id === cfg?.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  el.innerHTML = `<div class="row wrap"><select id="acSel" class="grow">${acOpts || '<option>機種なし</option>'}</select>
      <button type="button" class="btn" data-aact="newAc">新規機種</button>${ac ? '<button type="button" class="btn danger" data-aact="delAc">削除</button>' : ''}</div>
    ${ac ? `<div class="row"><label class="grow">機種名<input type="text" data-acname value="${esc(ac.name)}" /></label></div>
    <div class="row wrap"><select id="cfgSel" class="grow">${cfgOpts}</select><button type="button" class="btn" data-aact="newCfg">新規形態</button>
      <button type="button" class="btn" data-aact="dupCfg">複製</button><button type="button" class="btn danger" data-aact="delCfg">削除</button></div>` : '<p class="muted">「新規機種」から登録してください</p>'}
    ${cfg ? `<div class="row"><label class="grow">形態名<input type="text" data-cf="name" value="${esc(cfg.name)}" placeholder="例 CL+2TK" /></label></div>
    <h3>燃料 lb</h3><div class="row wrap">${numField(cfg, 'fuelCap', '搭載')}${numField(cfg, 'taxiTakeoff', 'タキシー/離陸')}${numField(cfg, 'approachLanding', '進入・着陸')}${numField(cfg, 'missedApproach', '進入・復行・上昇')}${numField(cfg, 'reserve', '予備')}</div>
    <h3>上昇</h3><div class="row wrap">${speedField(cfg, 'climb.speed')}${numField(cfg, 'climb.roc', '上昇率 ft/min')}${numField(cfg, 'climb.ff', 'FF lb/hr')}</div>
    <h3>巡航</h3><div class="row wrap">${speedField(cfg, 'cruise.speed')}${numField(cfg, 'cruise.ff', 'FF lb/hr')}</div>
    <h3>降下</h3><div class="row wrap">${speedField(cfg, 'descent.speed')}${numField(cfg, 'descent.rod', '降下率 ft/min')}${numField(cfg, 'descent.ff', 'FF lb/hr')}</div>
    <div class="row">${numField(cfg, 'refAlt', '単位切替の換算高度 ft')}</div>
    <p class="muted">速度の単位はボタンで KTAS → MACH → KIAS と切り替わり、数値は換算高度・標準大気で自動換算します。計算ではルートの各高度で TAS に直します。性能値は同梱していません。</p>` : ''}`;
}

/* ==== bindAircraftTab ==== 機体タブの操作 */
export function bindAircraftTab(el, rerender) {
  el.addEventListener('change', (e) => {
    const t = e.target;
    const { ac, cfg } = current();
    if (t.id === 'acSel') { selAc = t.value; selCfg = null; rerender(); return; }
    if (t.id === 'cfgSel') { selCfg = t.value; rerender(); return; }
    if (t.hasAttribute('data-acname') && ac) ac.name = t.value;
    else if (t.dataset.cf && cfg) {
      const path = t.dataset.cf;
      const v = t.value === '' ? null : Number(t.value);
      if (path === 'name') cfg.name = t.value;
      else if (path.endsWith('.speed')) getPath(cfg, path).value = v;
      else setPath(cfg, path, v);
    } else return;
    saveAircraft();
    emit('route');
  });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const { ac, cfg } = current();
    const act = t.dataset.aact;
    if (act === 'newAc') { const n = addAircraft(); selAc = n.id; selCfg = null; }
    if (act === 'delAc' && ac && confirm(`${ac.name} を削除しますか？`)) { removeAircraft(ac.id); selAc = null; }
    if (act === 'newCfg' && ac) { const c = blankConfig(); ac.configs.push(c); selCfg = c.id; }
    if (act === 'dupCfg' && cfg) { const c = { ...structuredClone(cfg), id: blankConfig().id, name: `${cfg.name} コピー` }; ac.configs.push(c); selCfg = c.id; }
    if (act === 'delCfg' && cfg && ac.configs.length > 1) { ac.configs = ac.configs.filter((c) => c.id !== cfg.id); selCfg = null; }
    if (t.dataset.cunit && cfg) {
      const s = getPath(cfg, t.dataset.cunit);
      const next = nextSpeedUnit(s.unit);
      setPath(cfg, t.dataset.cunit, Number.isFinite(s.value) ? convertSpeed(s, next, cfg.refAlt || 0) : { unit: next, value: null });
    }
    if (act || t.dataset.cunit) { saveAircraft(); emit('route'); rerender(); }
  });
}

/* ==== renderPointsTab ==== ユーザーポイント一覧と登録 */
export function renderPointsTab(el) {
  const f = state.settings.coordFormat;
  el.innerHTML = `<div class="row wrap"><input type="text" id="upName" placeholder="名前" maxlength="12" />
      <input type="text" id="upCoord" class="grow" placeholder="座標 / HUC 270/25 / MGRS" autocomplete="off" /><button type="button" class="btn primary" data-upact="add">登録</button></div>
    <p id="upStatus" class="muted">地図の長押し（PC は右クリック）からも登録できます</p>
    <table class="pts">${userPoints().map((u) => `<tr><td><b>${esc(u.name)}</b></td><td class="mono">${esc(formatLatLon(u.lat, u.lon, f))}</td>
      <td><button type="button" class="btn sm danger" data-updel="${u.id}">×</button></td></tr>`).join('') || '<tr><td class="muted">登録なし</td></tr>'}</table>`;
}

export function bindPointsTab(el, rerender) {
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.upact === 'add') {
      const name = el.querySelector('#upName').value.trim();
      const p = resolvePoint(el.querySelector('#upCoord').value, { bullseye: state.settings.bullseye, variation: currentVariation().value });
      if (!name || !p) { el.querySelector('#upStatus').textContent = '名前と座標を入れてください'; return; }
      addUserPoint({ name, lat: p.lat, lon: p.lon });
    }
    if (t.dataset.updel) removeUserPoint(t.dataset.updel);
    emit('route');
    rerender();
  });
}
