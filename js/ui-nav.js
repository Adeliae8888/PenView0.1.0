/* ==== ui-nav.js ==== NAV の航法表示：アクティブ STPT ブロック（▲▼・LOG・FUEL）、DIRECT 実行待ちバー、燃料入力の催促、Joker/Bingo 警告 */
import { state, emit } from './state.js';
import { formatBearing } from './geo.js';
import { esc } from './map-render.js';
import { navContext, liveNav, XTK_WARN_NM, XTK_ALERT_NM } from './nav.js';
import { stepActive, executeDirect, recordFuelCheck } from './route.js';
import { now, formatClock, formatDuration } from './clock.js';
import { openKeypad } from './keypad.js';

const $ = (id) => document.getElementById(id);
const lb = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '---');

function fmtTos(sec) {
  if (sec === null || !Number.isFinite(sec)) return '';
  const a = Math.abs(Math.round(sec));
  const txt = `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
  return a < 5 ? '<span class="tos ok">TOS ON</span>' : `<span class="tos ${sec > 0 ? 'late' : 'early'}">TOS ${sec > 0 ? '+' : '−'}${txt} ${sec > 0 ? 'LATE' : 'EARLY'}</span>`;
}

/* ==== xtkHtml ==== DTK と横ずれ。2nm 以上で黄、3.5nm 以上で赤（R＝コースの右にいる） */
function xtkHtml(live) {
  if (!Number.isFinite(live.xtk)) return '';
  const a = Math.abs(live.xtk);
  const cls = a >= XTK_ALERT_NM ? 'bad' : a >= XTK_WARN_NM ? 'warn' : '';
  return `<div class="dp-row small"><span><b>DTK</b>${formatBearing(live.dtk)}°</span><span class="xtk ${cls}"><b>XTK</b>${a.toFixed(1)}${a < 0.05 ? '' : live.xtk > 0 ? 'R' : 'L'}</span></div>`;
}

/* ==== gatesHtml ==== BINGO（地点）と HOME BINGO の見込み／最低値 */
function gatesHtml(gates) {
  const one = (label, g) => {
    if (!g) return '';
    if (g.passed) return `<span class="gate passed"><b>${label}</b>${esc(g.name)} 通過</span>`;
    const bad = Number.isFinite(g.proj) && g.proj < g.min;
    return `<span class="gate ${bad ? 'bad' : ''}"><b>${label}</b>${lb(g.proj)}<small>/${lb(g.min)} @${esc(g.name)}</small></span>`;
  };
  const html = one('BINGO', gates?.bingo) + one('HOME', gates?.home);
  return html ? `<div class="dp-gates">${html}</div>` : '';
}

/* ==== navBlockHtml ==== データパネル上段（ルートがアクティブなとき） */
export function navBlockHtml() {
  const nav = navContext();
  const live = liveNav(nav, state.own);
  if (!live) return '';
  const r = nav.route;
  const label = live.last ? 'DST' : live.idx;
  const fuel = nav.plan?.ok
    ? `<div class="dp-fuel"><span><b>EST</b>${lb(live.est)}</span><span><b>LAND</b>${lb(live.proj?.dest ?? nav.plan.destLanding)}</span>${nav.plan.altLegs.length ? `<span><b>ALT</b>${lb(live.proj?.alt ?? nav.plan.altLanding)}</span>` : ''}</div>`
    : `<div class="dp-sub warn">燃料計算不可：${esc((nav.plan?.missing || []).slice(0, 2).join(', ') || '2点以上必要')}</div>`;
  return `<div class="dp-stpt"><span class="dp-idx">${esc(label)}</span><span class="dp-name">${esc(live.target?.name || '')}</span>${r.flight.directOrigin ? '<span class="dp-dir">DIR</span>' : ''}</div>
    <div class="dp-row"><span><b>BRG</b>${formatBearing(live.brg)}°</span><span><b>DIST</b>${Number.isFinite(live.dist) ? live.dist.toFixed(1) : '---'}</span><span><b>ETE</b>${formatDuration(live.ete)}</span></div>
    ${xtkHtml(live)}<div class="dp-sub"><b>ETA</b> ${formatClock(live.eta)} ${fmtTos(live.tosDelta)}</div>${fuel}${gatesHtml(live.gates)}
    <div class="dp-actions"><button type="button" class="btn" data-nav="prev" aria-label="前の STPT">▲</button><button type="button" class="btn" data-nav="next" aria-label="次の STPT">▼</button><button type="button" class="btn" data-nav="log">LOG</button><button type="button" class="btn" data-nav="fuel">FUEL</button></div>`;
}

/* ==== askFuel ==== テンキーで実燃料を入れて記録（STPT 番号つき） */
export async function askFuel(idx, name) {
  const route = navContext().route;
  if (!route) return;
  const v = await openKeypad({ title: `FUEL CHECK ${name ? `— ${name}` : ''}`, unit: 'lb' });
  if (v !== null) { recordFuelCheck(route, idx, v, now()); emit('route'); }
}

/* ==== renderNavOverlays ==== DIRECT 実行待ち・燃料催促・警告の表示更新 */
export function renderNavOverlays() {
  const arm = state.directArm;
  $('directBar').classList.toggle('hidden', !arm);
  if (arm) $('directName').textContent = arm.name || 'POINT';
  const fp = state.fuelPrompt;
  $('fuelPrompt').classList.toggle('hidden', !fp);
  if (fp) $('fuelPromptText').textContent = `FUEL? ${fp.idx} ${fp.name}`;
  const banner = $('fuelAlert');
  banner.className = `fuel-alert ${state.alert === 'home' ? 'bingo' : state.alert || 'hidden'}${state.alertAck ? ' acked' : ''}`;
  if (state.alert) $('fuelAlertText').textContent = { bingo: 'BINGO FUEL', home: 'HOME BINGO', joker: 'JOKER FUEL' }[state.alert];
  $('clockPill').textContent = formatClock(now());
}

/* ==== bindNavUi ==== 航法表示の操作 */
export function bindNavUi(actions) {
  $('dataPanel').addEventListener('click', (e) => {
    const act = e.target.closest('[data-nav]')?.dataset.nav;
    const route = navContext().route;
    if (!act || !route) return;
    if (act === 'prev' || act === 'next') { stepActive(route, act === 'next' ? 1 : -1); emit('route'); }
    if (act === 'log') actions.openSheet('log');
    if (act === 'fuel') askFuel(route.activeIdx - 1, route.points[route.activeIdx - 1]?.name || '');
  });
  $('directExec').addEventListener('click', () => {
    const route = navContext().route;
    if (route && state.directArm && Number.isFinite(state.own.lat)) executeDirect(route, state.directArm, state.own);
    state.directArm = null;
    emit('route');
  });
  $('directCancel').addEventListener('click', () => { state.directArm = null; emit('route'); });
  $('fuelPromptText').addEventListener('click', () => { const fp = state.fuelPrompt; state.fuelPrompt = null; emit('route'); askFuel(fp.idx, fp.name); });
  $('fuelPromptClose').addEventListener('click', () => { state.fuelPrompt = null; emit('route'); });
  $('fuelAlertAck').addEventListener('click', () => { state.alertAck = true; renderNavOverlays(); });
}
