/* ==== ui-route.js ==== ルート編集（経路・代替経路・STPT 詳細）とフライトログ表 */
import { state, emit, currentVariation } from './state.js';
import { routes, activeRoute, setActiveRoute, newRoute, removeRoute, duplicateRoute, addPoint, removePoint, movePoint, resetFlight, saveRoutes, setActiveIdx, pointTag } from './route.js';
import { procedures } from './procedures.js';
import { procChoices, destPoint } from './route-proc.js';
import { syncProcRoutes } from './proc-wire.js';
import { aircraftList } from './aircraft.js';
import { resolvePoint, searchPoints } from './points.js';
import { navContext, etaTable } from './nav.js';
import { PHASES } from './flightplan.js';
import { convertSpeed, nextSpeedUnit, formatSpeed } from './aero.js';
import { gsiVariation, toMagnetic, formatBearing } from './geo.js';
import { esc } from './map-render.js';
import { formatClock, formatDuration } from './clock.js';

const PHASE_LABELS = { auto: '自動', climb: '上昇', cruise: '巡航', descent: '降下' };
const UNIT_LABEL = { TAS: 'KTAS', MACH: 'MACH', IAS: 'KIAS' };
const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
const val = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : v);
const lb = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '---');
let editing = null;               // 詳細を開いている STPT {list, i}
let selected = null;              // 編集で選択中の行 {list, i}（挿入の基準）
let insertMode = 'after';         // 'before' | 'after'
let editingRouteId = null;

export function editingRoute() {
  return routes().find((r) => r.id === editingRouteId) || activeRoute() || routes()[0] || null;
}

function configOptions(route) {
  const opts = ['<option value="">— 未選択 —</option>'];
  aircraftList().forEach((ac) => ac.configs.forEach((c) => {
    const v = `${ac.id}|${c.id}`;
    const sel = route.configRef && `${route.configRef.aircraftId}|${route.configRef.configId}` === v ? 'selected' : '';
    opts.push(`<option value="${esc(v)}" ${sel}>${esc(ac.name)} / ${esc(c.name)}</option>`);
  }));
  return opts.join('');
}

function routeFields(r) {
  const f = (key, label, ph = '', type = 'number') => `<label>${label}<input type="${type}" data-rf="${key}" value="${esc(val(r[key]))}" placeholder="${esc(ph)}" /></label>`;
  return `<div class="row wrap">${f('name', '名前', '', 'text')}
      <label class="grow">機体/形態<select data-rf="configRef">${configOptions(r)}</select></label></div>
    <div class="row wrap">${f('startFuel', '搭載燃料 lb', '形態の値')}${f('plannedTakeoff', `計画離陸 ${state.settings.timeZone === 'JST' ? 'L' : 'Z'}`, 'HHMM', 'text')}${f('cruiseAlt', '既定高度 ft')}${f('joker', 'JOKER lb（TAC）')}</div>
    <div class="row wrap">${f('bingo', 'BINGO lb')}<label class="grow">BINGO 地点<input type="text" data-rf="bingoPointText" value="${esc(r.bingoPoint?.name || '')}" placeholder="未設定＝現在の燃料で判定" list="ptSuggest" /></label></div>
    <div class="row wrap">${f('homeBingo', 'HOME BINGO lb')}<label class="grow">HOME 地点<select data-rf="homeBingoPointId"><option value="">目的地（接地時）</option>${r.points.slice(1, -1).map((p, i) => `<option value="${p.id}" ${p.id === r.homeBingoPointId ? 'selected' : ''}>${i + 1} ${esc(p.name)}</option>`).join('')}</select></label></div>
    <div class="row wrap"><label>予報風 °T<input type="number" data-rf="windDir" value="${esc(val(r.wind?.dir))}" /></label>
      <label>kt<input type="number" data-rf="windSpd" value="${esc(val(r.wind?.spd))}" /></label>${f('isaDev', 'ISA偏差 ℃')}</div>`;
}

/* ==== procPicker ==== DEP の行に SID → その TRANSITION、DST の行に STAR の TRANSITION → STAR・APP。
 * TRANSITION は選んだ SID（STAR）に属するものだけ出す。選ぶとフィックスが経路に入る */
const ROLE_LABEL = { SID: 'SID', SID_TR: 'TRANSITION', STAR_TR: 'TRANSITION', STAR: 'STAR', APP: 'APP' };
function procPicker(r, roles) {
  const one = (role) => {
    const choices = procChoices(r, role, procedures());
    if (!choices.length) return '';
    const opts = choices.map((p) => `<option value="${esc(p.id)}" ${r.procs?.[role] === p.id ? 'selected' : ''}>${esc(p.name || '(名前なし)')}${p.type === 'SID' && p.rwy ? ` RWY${esc(p.rwy)}` : ''}</option>`).join('');
    return `<label>${ROLE_LABEL[role]}<select data-rf="proc:${role}"><option value="">なし</option>${opts}</select></label>`;
  };
  const html = roles.map(one).join('');
  return html ? `<tr class="proc-pick-row"><td></td><td colspan="3"><div class="row wrap proc-pick">${html}</div></td></tr>` : '';
}

function pointDetail(p, list, i) {
  const spd = p.speed || { unit: 'TAS', value: null };
  return `<tr class="pt-detail"><td colspan="6"><div class="row wrap">
    <label>区間高度 ft<input type="number" data-pf="legAlt" data-list="${list}" data-i="${i}" value="${esc(val(p.legAlt))}" placeholder="到着高度" /></label>
    <label>TOS<input type="text" data-pf="tos" data-list="${list}" data-i="${i}" value="${esc(val(p.tos))}" placeholder="HHMMSS" /></label>
    <label>風 °T<input type="number" data-pf="windDir" data-list="${list}" data-i="${i}" value="${esc(val(p.wind?.dir))}" /></label>
    <label>kt<input type="number" data-pf="windSpd" data-list="${list}" data-i="${i}" value="${esc(val(p.wind?.spd))}" /></label>
    <label>飛行段階<select data-pf="phase" data-list="${list}" data-i="${i}">${PHASES.map((ph) => `<option value="${ph}" ${p.phase === ph ? 'selected' : ''}>${PHASE_LABELS[ph]}</option>`).join('')}</select></label>
    <label>巡航速度<span class="spd"><input type="number" step="any" data-pf="speed" data-list="${list}" data-i="${i}" value="${esc(val(spd.value))}" placeholder="形態の値" /><button type="button" class="btn unit" data-punit data-list="${list}" data-i="${i}">${UNIT_LABEL[spd.unit]}</button></span></label>
  </div>${p.def ? `<p class="muted">定義：${esc(p.def)}</p>` : ''}</td></tr>`;
}

function pointRows(r, list) {
  const arr = r[list];
  return arr.map((p, i) => {
    const tag = list === 'alternate' ? (i === arr.length - 1 ? 'ALT' : `A${i + 1}`) : pointTag(arr, i);
    const isActive = list === 'points' && i === r.activeIdx;
    const isSel = selected && selected.list === list && selected.i === i;
    const cls = [isActive ? 'active' : '', isSel ? 'sel' : '', p.skipped ? 'skip' : ''].join(' ');
    const open = editing && editing.list === list && editing.i === i;
    const act = list === 'points' && i > 0 ? `<button type="button" class="btn sm act ${isActive ? 'on' : ''}" data-pact="active" data-list="${list}" data-i="${i}" title="アクティブにする">▶</button>` : '';
    return `<tr class="${cls}"><td>${tag}</td><td class="pick" data-pact="select" data-list="${list}" data-i="${i}"><b>${esc(p.name)}</b></td>
      <td><input type="number" class="alt" data-pf="alt" data-list="${list}" data-i="${i}" value="${esc(val(p.alt))}" /></td>
      <td class="nowrap">${act}<button type="button" class="btn sm" data-pact="detail" data-list="${list}" data-i="${i}">${open ? '閉' : '詳細'}</button>
      ${p.proc ? '<span class="muted">手順</span>' : `<button type="button" class="btn sm" data-pact="up" data-list="${list}" data-i="${i}">↑</button><button type="button" class="btn sm" data-pact="down" data-list="${list}" data-i="${i}">↓</button>
      <button type="button" class="btn sm danger" data-pact="del" data-list="${list}" data-i="${i}">×</button>`}</td></tr>${open ? pointDetail(p, list, i) : ''}${list === 'points' ? pickerAfter(r, arr, i) : ''}`;
  }).join('');
}

/* ==== pickerAfter ==== DEP の行の下に SID・TRANSITION、目的地（DST）の行の下に TRANSITION・STAR・APP */
function pickerAfter(r, arr, i) {
  if (arr.length < 2) return '';
  if (i === 0) return procPicker(r, ['SID', 'SID_TR']);
  if (arr[i] === destPoint(r)) return procPicker(r, ['STAR', 'STAR_TR', 'APP']);
  return '';
}

function addRow(list) {
  const sel = selected && selected.list === list;
  const mode = sel ? `<div class="row wrap seg-mini"><span class="muted">選択中の行の</span>
    <label><input type="radio" name="ins-${list}" data-insmode="before" ${insertMode === 'before' ? 'checked' : ''}/>前に挿入</label>
    <label><input type="radio" name="ins-${list}" data-insmode="after" ${insertMode === 'after' ? 'checked' : ''}/>後に挿入</label></div>` : '';
  return `${mode}<div class="row"><input type="text" class="grow" list="ptSuggest" data-add-input="${list}" placeholder="HUC / RJAH / HUC 270/25 / 座標" autocomplete="off" />
    <input type="number" class="alt" data-add-alt="${list}" placeholder="高度" /><button type="button" class="btn primary" data-add="${list}">追加</button></div><p class="muted" data-add-status="${list}"></p>`;
}

/* ==== renderRouteTab ==== ルート編集タブ */
export function renderRouteTab(el) {
  const r = editingRoute();
  const list = routes().map((x) => `<option value="${x.id}" ${x.id === r?.id ? 'selected' : ''}>${esc(x.name)}${x.id === activeRoute()?.id ? ' ★' : ''}</option>`).join('');
  el.innerHTML = `<div class="row wrap"><select id="routeSel" class="grow">${list || '<option>ルートなし</option>'}</select>
      <button type="button" class="btn" data-ract="new">新規</button>${r ? '<button type="button" class="btn" data-ract="dup">複製</button><button type="button" class="btn danger" data-ract="del">削除</button>' : ''}</div>
    ${r ? `<div class="row"><button type="button" class="btn ${r.id === activeRoute()?.id ? 'active' : ''}" data-ract="activate">${r.id === activeRoute()?.id ? '★ アクティブ' : 'アクティブにする'}</button>
      <button type="button" class="btn" data-ract="reset">飛行実績をリセット</button></div>
    ${routeFields(r)}<h3>経路（DEP → STPT → DST）</h3><p class="muted legend">▶ 紫＝航法中のアクティブ STPT（▶ で変更）／ 枠＝編集で選択中の行（名前をタップ。追加は選択行の前後に入る）</p><table class="pts">${pointRows(r, 'points')}</table>${addRow('points')}
    <h3>代替経路（DST → ALT）任意</h3><table class="pts">${pointRows(r, 'alternate')}</table>${addRow('alternate')}` : '<p class="muted">「新規」でルートを作成してください</p>'}
    <datalist id="ptSuggest"></datalist>`;
}

function setRouteField(r, key, value) {
  if (key === 'bingoPointText') {
    const p = value.trim() ? resolvePoint(value, { bullseye: state.settings.bullseye, variation: currentVariation().value }) : null;
    r.bingoPoint = p ? { name: p.name || value.trim().toUpperCase(), lat: p.lat, lon: p.lon } : null;
    return;
  }
  if (key === 'homeBingoPointId') { r.homeBingoPointId = value || null; return; }
  if (key.startsWith('proc:')) {
    r.procs = { ...r.procs, [key.slice(5)]: value || null };
    syncProcRoutes({ route: r, force: true });
    return;
  }
  if (key === 'configRef') { const [aircraftId, configId] = value.split('|'); r.configRef = value ? { aircraftId, configId } : null; return; }
  if (key === 'windDir' || key === 'windSpd') { r.wind = { dir: 0, spd: 0, ...r.wind, [key === 'windDir' ? 'dir' : 'spd']: num(value) || 0 }; return; }
  r[key] = ['name', 'plannedTakeoff'].includes(key) ? value : num(value);
}

function setPointField(p, key, value) {
  if (key === 'windDir' || key === 'windSpd') {
    const w = { dir: 0, spd: 0, ...p.wind, [key === 'windDir' ? 'dir' : 'spd']: num(value) || 0 };
    p.wind = w.spd > 0 ? w : null;
  } else if (key === 'speed') p.speed = value === '' ? null : { unit: p.speed?.unit || 'TAS', value: Number(value) };
  else p[key] = key === 'phase' || key === 'tos' ? value || null : num(value);
}

function handleAdd(r, list, root) {
  const input = root.querySelector(`[data-add-input="${list}"]`);
  const altIn = root.querySelector(`[data-add-alt="${list}"]`);
  const status = root.querySelector(`[data-add-status="${list}"]`);
  const p = resolvePoint(input.value, { bullseye: state.settings.bullseye, variation: currentVariation().value });
  if (!p) { status.textContent = '地点を特定できません'; return; }
  addPoint(r, { ...p, name: p.name || `STPT${r[list].length + 1}`, alt: altIn.value === '' ? undefined : Number(altIn.value) }, list, insertIndex(list));
  if (selected && selected.list === list && insertMode === 'after') selected.i += 1;
  emit('route');
}

/* ==== bindRouteTab ==== ルート編集の操作（イベント委譲） */
export function bindRouteTab(el, rerender) {
  el.addEventListener('change', (e) => {
    const t = e.target;
    const r = editingRoute();
    if (t.id === 'routeSel') { editingRouteId = t.value; editing = null; selected = null; rerender(); return; }
    if (t.dataset.insmode) { insertMode = t.dataset.insmode; return; }
    if (!r) return;
    if (t.dataset.rf) setRouteField(r, t.dataset.rf, t.value);
    else if (t.dataset.pf) setPointField(r[t.dataset.list][Number(t.dataset.i)], t.dataset.pf, t.value);
    else return;
    saveRoutes();
    emit('route');
  });
  el.addEventListener('input', (e) => {
    const list = e.target.dataset.addInput;
    if (!list) return;
    el.querySelector('#ptSuggest').innerHTML = searchPoints(e.target.value).map((p) => `<option value="${esc(p.name)}">${esc(p.label)}</option>`).join('');
  });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button, [data-pact="select"]');
    if (!t) return;
    let r = editingRoute();
    const act = t.dataset.ract;
    if (act === 'new') { r = newRoute(); editingRouteId = r.id; }
    if (act === 'dup' && r) editingRouteId = duplicateRoute(r).id;
    if (act === 'del' && r && confirm(`${r.name} を削除しますか？`)) { removeRoute(r.id); editingRouteId = null; }
    if (act === 'activate' && r) setActiveRoute(r.id);
    if (act === 'reset' && r) resetFlight(r);
    if (t.dataset.add && r) { handleAdd(r, t.dataset.add, el); return; }
    if (t.dataset.pact && r) pointAction(r, t.dataset.pact, t.dataset.list, Number(t.dataset.i));
    if (t.hasAttribute('data-punit') && r) togglePointUnit(r[t.dataset.list][Number(t.dataset.i)], r);
    if (act || t.dataset.pact || t.hasAttribute('data-punit')) emit('route');
  });
}

/* ==== insertIndex ==== 選択行があれば、その前/後の位置。無ければ null（既定：目的地の手前） */
export function insertIndex(list = 'points') {
  if (!selected || selected.list !== list) return null;
  return insertMode === 'before' ? selected.i : selected.i + 1;
}

function pointAction(r, act, list, i) {
  if (act === 'select') selected = selected && selected.list === list && selected.i === i ? null : { list, i };
  if (act === 'active') setActiveIdx(r, i);
  if (act === 'detail') editing = editing && editing.list === list && editing.i === i ? null : { list, i };
  if (act === 'up' || act === 'down') { movePoint(r, i, act === 'up' ? -1 : 1, list); editing = null; }
  if (act === 'del') { removePoint(r, i, list); editing = null; selected = null; }
}

/* ==== togglePointUnit ==== 速度の単位をタップで切替（その STPT の高度・ISA偏差で換算） */
function togglePointUnit(p, r) {
  const cur = p.speed || { unit: 'TAS', value: null };
  p.speed = Number.isFinite(cur.value) ? convertSpeed(cur, nextSpeedUnit(cur.unit), p.alt || 0, r.isaDev || 0) : { unit: nextSpeedUnit(cur.unit), value: null };
  saveRoutes();
}

/* ==== renderLogTab ==== フライトログ表（計画・ETA・燃料・実績との差） */
export function renderLogTab(el) {
  const nav = navContext();
  const { route: r, plan } = nav;
  if (!r) { el.innerHTML = '<p class="muted">アクティブなルートがありません</p>'; return; }
  if (!plan?.ok) { el.innerHTML = `<p class="warn">計算できません：${esc((plan?.missing || ['2点以上必要']).join(', '))}</p><p class="muted">機体タブで性能を登録し、ルートで機体/形態を選んでください。</p>`; return; }
  const etas = etaTable(nav, state.own);
  const checks = r.flight.checks || [];
  const row = (l, alt = false) => {
    const ref = alt ? r.alternate[l.toIndex] : r.points[l.fromIndex];
    const v = (ref && gsiVariation(ref.lat, ref.lon)) ?? currentVariation().value;
    const act = alt ? null : checks.filter((c) => c.idx === l.toIndex).at(-1);
    const cruise = l.segs.find((s) => s.phase === 'cruise') || l.segs[0];
    const phases = l.segs.map((s) => ({ climb: 'C', cruise: 'R', descent: 'D' }[s.phase])).join('');
    const cls = alt ? 'alt' : l.toIndex < r.activeIdx ? 'flown' : l.toIndex === r.activeIdx ? 'active' : '';
    const mark = alt ? '' : r.points[l.toIndex]?.mark;
    return `<tr class="${cls}"><td>${esc(l.name)}${mark ? ` <small>${esc(mark)}</small>` : ''}${l.direct ? ' <small>DIR</small>' : ''}</td><td>${formatBearing(toMagnetic(l.course, v))}</td><td>${l.dist.toFixed(1)}</td>
      <td>${Math.round(l.cruiseAlt ?? l.alt)}</td><td>${Math.round(cruise.tas)} <small>${phases}</small></td><td>${Math.round(l.gs)}</td><td>${formatDuration(l.time)}</td>
      <td>${alt ? '' : formatClock(etas[l.toIndex], false)}</td><td>${lb(l.fuel)}</td><td>${lb(l.fuelRem)}</td>
      <td>${act ? lb(act.fuel) : ''}</td><td class="${act && act.fuel < l.fuelRem ? 'neg' : ''}">${act ? `${act.fuel >= l.fuelRem ? '+' : ''}${lb(act.fuel - l.fuelRem)}` : ''}</td></tr>`;
  };
  const head = '<tr><th>STPT</th><th>MC°</th><th>NM</th><th>ALT</th><th>TAS</th><th>GS</th><th>ETE</th><th>ETA</th><th>使用</th><th>残</th><th>実績</th><th>差</th></tr>';
  el.innerHTML = `<div class="log-wrap"><table class="log">${head}${plan.legs.map((l) => row(l)).join('')}
      ${plan.altLegs.length ? `<tr class="sep"><td colspan="12">代替経路（復行 ${lb(nav.cfg.missedApproach)} lb 後）</td></tr>${plan.altLegs.map((l) => row(l, true)).join('')}` : ''}</table></div>
    <table class="kv totals"><tr><th>搭載 / 離陸</th><td>${lb(plan.startFuel)} / ${lb(plan.takeoffFuel)} lb</td></tr>
      <tr><th>目的地 到着 / 接地</th><td>${lb(plan.destArrival)} / <b>${lb(plan.destLanding)}</b> lb（${formatDuration(plan.time)}）</td></tr>
      ${plan.altLegs.length ? `<tr><th>代替 接地</th><td><b class="${plan.altLanding < plan.reserve ? 'neg' : ''}">${lb(plan.altLanding)}</b> lb（予備 ${lb(plan.reserve)}）</td></tr>` : ''}
      <tr><th>JOKER / BINGO</th><td>${lb(r.joker)} / ${lb(r.bingo)} lb</td></tr>
      <tr><th>離陸</th><td>${r.flight.takeoffAt ? `実績 ${formatClock(r.flight.takeoffAt)}` : `計画 ${esc(r.plannedTakeoff || '未設定')}`}</td></tr></table>
    <p class="muted">飛行段階 C=上昇 R=巡航 D=降下。上昇は区間の始め、降下は区間の終わりと仮定。速度 ${formatSpeed(nav.cfg.cruise.speed)}（巡航）。</p>`;
}
