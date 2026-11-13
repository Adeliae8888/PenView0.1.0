/* ==== ui-settings-data.js ==== 設定画面：NAV データの読込・一覧・表示切替、項目別の書き出し・読込 */
import { state, emit, updateSettings } from './state.js';
import { importFiles, navIndex, removeGroup, airacExpired, exportNavData, importNavData, GROUPS } from './navdata.js';
import { groupOn } from './nav-render.js';
import { routes, mergeRoutes } from './route.js';
import { aircraftList, mergeAircraft } from './aircraft.js';
import { userPoints, setPointSources, saveUserPoints } from './points.js';
import { now } from './clock.js';
import { procedures, mergeProcedures } from './procedures.js';
import { aipRunwayIndex, mergeAipRunways } from './aip-import.js';
import { esc } from './map-render.js';

const $ = (id) => document.getElementById(id);
const IO_KINDS = [
  ['routes', 'ルート'], ['aircraft', '機体（形態を含む）'], ['navdata', 'NAV データ'], ['userPoints', 'ユーザーポイント'], ['procedures', '手順（SID/TRANSITION/STAR/APP）と AIP の滑走路'], ['settings', '設定'], ['all', '全データ'],
];
const fmtDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');

/* ==== renderNavDataSection ==== 読み込んだグループの一覧（件数・有効日・AIRAC 期限）と表示切替 */
export function renderNavDataSection() {
  const t = now();
  $('navList').innerHTML = navIndex().length ? `<table class="pts">${navIndex().map((r) => `<tr><td>${esc(r.label)}</td><td>${r.count.toLocaleString('en-US')}</td>
    <td class="${airacExpired(r, t) ? 'neg' : ''}">${r.eff ? `EFF ${fmtDate(r.eff)}${airacExpired(r, t) ? ' 期限切れ' : ''}` : `読込 ${fmtDate(r.importedAt)}`}</td>
    <td><button type="button" class="btn sm danger" data-ndel="${esc(r.group)}">×</button></td></tr>`).join('')}</table>` : '<p class="muted">まだ読み込んでいません</p>';
  $('navToggles').innerHTML = navIndex().map((r) => `<label class="chip"><input type="checkbox" data-ndgroup="${esc(r.group)}" ${groupOn(state.settings, r.group) ? 'checked' : ''}/>${esc(GROUPS[r.group]?.label || r.label)}</label>`).join('') || '<span class="muted">—</span>';
  $('preferOfficial').checked = state.settings.preferOfficial !== false;
}

export function bindNavDataSection() {
  $('navFile').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const status = $('navStatus');
    try {
      const groups = await importFiles(files, { includeArea2: $('navArea2').checked, onProgress: (msg) => { status.textContent = msg; } });
      status.textContent = `読み込み完了：${groups.map((g) => GROUPS[g]?.label || g).join('、')}`;
      emit('navdata');
    } catch (err) {
      status.textContent = `読み込めません：${err.message}`;
    }
    e.target.value = '';
    renderNavDataSection();
  });
  $('navList').addEventListener('click', async (e) => {
    const g = e.target.closest('[data-ndel]')?.dataset.ndel;
    if (!g || !confirm(`${GROUPS[g]?.label || g} を削除しますか？`)) return;
    await removeGroup(g);
    emit('navdata');
    renderNavDataSection();
  });
  $('navToggles').addEventListener('change', (e) => {
    const g = e.target.dataset.ndgroup;
    if (g) updateSettings({ layers: { ...state.settings.layers, [`nd:${g}`]: e.target.checked } });
  });
  $('preferOfficial').addEventListener('change', (e) => updateSettings({ preferOfficial: e.target.checked }));
}

/* ==== 書き出し・読込 ==== 形式：{ type:'penview-share', version:2, routes?, aircraft?, navdata?, userPoints?, procedures?, settings? } */
function collect(kind) {
  const all = kind === 'all';
  const data = { type: 'penview-share', version: 2, exportedAt: new Date().toISOString(), app: self.APP_VERSION };
  if (all || kind === 'routes') data.routes = routes();
  if (all || kind === 'aircraft') data.aircraft = aircraftList();
  if (all || kind === 'navdata') data.navdata = exportNavData();
  if (all || kind === 'userPoints') data.userPoints = userPoints();
  if (all || kind === 'procedures') { data.procedures = procedures(); data.aipRunways = aipRunwayIndex(); }
  if (all || kind === 'settings') data.settings = state.settings;
  return data;
}

function download(kind) {
  const blob = new Blob([JSON.stringify(collect(kind))], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `penview-${kind}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ==== applyImport ==== 入っている項目だけ取り込む（ルート・機体は同じ id を上書き、ポイントは追加、設定は置き換え） */
export async function applyImport(data, only = 'all') {
  if (data?.type !== 'penview-share') throw new Error('PenView の書き出しファイルではありません');
  const use = (k) => (only === 'all' || only === k) && data[k];
  const done = [];
  if (use('routes')) { mergeRoutes(data.routes); done.push('ルート'); }
  if (use('aircraft')) { mergeAircraft(data.aircraft); done.push('機体'); }
  if (use('navdata')) { await importNavData(data.navdata); done.push('NAV データ'); }
  if (use('userPoints')) {
    const ups = userPoints();
    data.userPoints.forEach((u) => { if (!ups.some((x) => x.id === u.id)) ups.push(u); });
    setPointSources({ userPoints: ups });
    saveUserPoints();
    done.push('ユーザーポイント');
  }
  if (use('procedures')) {
    if (data.aipRunways) await mergeAipRunways(data.aipRunways);
    mergeProcedures(data.procedures);
    emit('proc');
    emit('route');
    done.push('手順');
  }
  if (use('settings')) { updateSettings({ ...data.settings }); done.push('設定'); }
  if (!done.length) throw new Error('このファイルには選んだ項目が入っていません');
  return done;
}

export function renderIoSection() {
  $('ioRows').innerHTML = IO_KINDS.map(([k, label]) => `<div class="row io-row"><span class="grow">${label}</span>
    <button type="button" class="btn sm" data-io-export="${k}">書き出し</button><button type="button" class="btn sm" data-io-import="${k}">読込</button></div>`).join('');
}

export function bindIoSection() {
  let importKind = 'all';
  $('ioRows').addEventListener('click', (e) => {
    const ex = e.target.closest('[data-io-export]')?.dataset.ioExport;
    const im = e.target.closest('[data-io-import]')?.dataset.ioImport;
    if (ex) download(ex);
    if (im) { importKind = im; $('ioFile').click(); }
  });
  $('ioFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const done = await applyImport(JSON.parse(await f.text()), importKind);
      $('ioStatus').textContent = `読み込みました：${done.join('、')}`;
      emit('route');
      emit('navdata');
    } catch (err) { $('ioStatus').textContent = `読み込めません：${err.message}`; }
    e.target.value = '';
  });
}
