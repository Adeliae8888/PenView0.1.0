/* ==== ui-aip.js ==== 設定画面：AIP の PDF（空港ごとの zip）を読む → 確認画面（読み取った滑走路・手順、読まなかった PDF）→ 選んだものを取り込む */
import { emit, state, updateSettings } from './state.js';
import { scanAip, applyAip, aipRunwayIndex, removeAipRunways } from './aip-import.js';
import { procedures, mergeProcedures, saveProcedures, procLabel } from './procedures.js';
import { esc } from './map-render.js';
import { findPoint } from './points.js';

const $ = (id) => document.getElementById(id);
let pending = null;                         // 読み取った結果（取り込み前）

const h3 = (v) => String(v).padStart(3, '0');
const altTxt = (a) => (a ? ` ${{ above: '≥', below: '≤', at: '=', between: '' }[a.type] || ''}${a.v}${a.type === 'between' ? `/${a.v2}` : ''}` : '');

/* ==== partText ==== パーツ1つを短く：「RWY HDG→600ft」「L HDG 002°→HUC R-047」「HUC R047→D8」「ARC HUC 26 CW→TAIYO」「GOPVU」 */
function partText(pt) {
  const end = (e) => (!e ? '' : e.type === 'alt' ? `${e.alt}ft` : e.type === 'dme' ? `${e.station || ''} D${e.dist}` : e.to);
  if (pt.type === 'heading') return `${pt.rwyHdg && (pt.hdg === null || pt.hdg === undefined) ? 'RWY HDG' : `HDG ${h3(pt.hdg)}°`}→${end(pt.end)}`;
  if (pt.type === 'turnhdg') return `${pt.dir} HDG ${h3(pt.hdg)}°→${end(pt.end)}`;
  if (pt.type === 'radial') return `${pt.station} R${h3(pt.radial)}${pt.inbound ? ' 局へ' : ''}→${end(pt.end)}`;
  if (pt.type === 'arc') return `ARC ${pt.station} ${pt.dme} ${pt.dir === 'L' ? 'CCW' : 'CW'}→${pt.xFix || (pt.endBy === 'other' ? `${pt.xStation} R${h3(pt.xRadial)}` : `R${h3(pt.to)}`)}`;
  return pt.to || '';
}

/* ==== partSummary ==== 「RWY HDG→600ft → HUC R047→ D8.0 ≤8000 → GOPVU ≤10000」 */
function partSummary(p) {
  const head = p.startFix ? [`${p.startFix}${p.startAlt ? ` ${p.startAlt}` : ''}`] : [];
  return [...head, ...p.parts.map((pt) => `${partText(pt)}${altTxt(pt.alt)}`)].join(' → ');
}

function procRow(p, exists) {
  const parents = p.type === 'TRANSITION' ? ` <span class="muted">← ${p.parents.length ? `${p.parents.length} 本の ${p.side === 'STAR' ? 'STAR' : 'SID'}` : 'つながる手順なし'}</span>` : '';
  const warn = p.warnings?.length ? `<div class="warn small">${p.warnings.map(esc).join('<br>')}</div>` : '';
  const d = state.settings.aipDefaults;
  const dflt = p.defaulted ? `<div class="muted small">既定値で補った値があります（上昇勾配 ${d.grad}%・旋回 ${d.kias}KIAS・バンク ${d.bank}°）</div>` : '';
  const src = p.source?.text ? `<details class="small"><summary>原文</summary><span class="muted">${esc(p.source.text)}</span></details>` : '';
  return `<label class="aip-row"><input type="checkbox" data-aipproc="${esc(p.id)}" checked /><span><b>${esc(procLabel(p))}</b>${exists.has(p.id) ? ' <span class="tag">上書き</span>' : ''}${parents}
    <br><span class="muted small">${esc(partSummary(p))}</span>${warn}${dflt}${src}</span></label>`;
}

function skippedHtml(sk) {
  const list = (title, arr) => (arr.length ? `<p><b>${title}</b>（${arr.length}）<br><span class="muted small">${arr.map(esc).join('、')}</span></p>` : '');
  const n = sk.text.length + sk.iac.length + sk.image.length;
  if (!n) return '';
  return `<details><summary>読まなかった PDF（${n}）</summary>
    ${list('説明文が読めなかった SID/STAR（画像・未対応の書き方）', sk.text)}${list('進入チャート（0.2.7 で対応予定）', sk.iac)}${list('文字の無い画像の PDF（読めません）', sk.image)}</details>`;
}

/* ==== renderReview ==== 確認画面 */
function renderReview() {
  const el = $('aipReview');
  if (!pending) { el.innerHTML = ''; return; }
  const exists = new Set(procedures().map((p) => p.id));
  const rw = pending.runways.map((r) => `<label class="aip-row"><input type="checkbox" data-aiprwy="${esc(r.icao)}" checked /><span><b>${esc(r.icao)}</b> 滑走路 ${r.runways.map((x) => esc(x.d)).join('・')}
    <span class="muted small">（末端・離陸側の端・標高。${esc(r.eff || '')}）</span></span></label>`).join('');
  const byAd = {};
  pending.procs.forEach((p) => (byAd[p.ad] ||= []).push(p));
  const groups = Object.entries(byAd).map(([ad, ps]) => `<details open><summary><b>${esc(ad)}</b> 手順 ${ps.length} 本
    <button type="button" class="btn sm" data-aipall="${esc(ad)}">全部</button><button type="button" class="btn sm" data-aipnone="${esc(ad)}">なし</button></summary>
    ${ps.map((p) => procRow(p, exists)).join('')}</details>`).join('');
  el.innerHTML = `<div class="aip-review"><h4>読み取った内容（確かめてから取り込む）</h4>${rw ? `<h4>滑走路（AD2）</h4>${rw}` : ''}
    ${groups ? `<h4>手順</h4><p class="muted small">取り込んだ手順は地図に出しません（ルートで選んだとき、または手順の一覧で表示にしたときに出ます）。</p>${groups}` : ''}
    ${skippedHtml(pending.skipped)}
    <div class="row"><button type="button" class="btn primary" data-aip="apply">取り込む</button><button type="button" class="btn" data-aip="cancel">やめる</button></div></div>`;
}

/* ==== defaultsHtml ==== 文章に書かれていない値を補う既定値 */
function defaultsHtml() {
  const d = state.settings.aipDefaults;
  const f = (k, label, step) => `<label>${label}<input type="number" step="${step}" data-aipdef="${k}" value="${d[k]}" /></label>`;
  return `<div class="row wrap"><span class="muted small">文章に無い値の既定値：</span>${f('grad', '上昇勾配 %', '0.1')}${f('kias', '旋回 KIAS', '10')}${f('bank', 'バンク °', '1')}</div>`;
}

/* ==== renderAipSection ==== 補う値の既定値・取り込み済みの飛行場の滑走路 */
export function renderAipSection() {
  $('aipDefaults').innerHTML = defaultsHtml();
  const idx = Object.entries(aipRunwayIndex());
  $('aipList').innerHTML = idx.length ? `<table class="pts">${idx.map(([icao, r]) => `<tr><td>${esc(icao)}</td><td>${r.runways.map((x) => esc(x.d)).join('・')}</td>
    <td>${esc(r.eff || '')}</td><td><button type="button" class="btn sm danger" data-aiprm="${esc(icao)}">×</button></td></tr>`).join('')}</table>` : '';
  renderReview();
}

/* ==== markUnknownFixes ==== PDF にも登録済みの地点（国土交通省の NAV データ等）にも無いフィックスを警告に */
function markUnknownFixes(procs) {
  procs.forEach((p) => {
    const names = [p.startFix, ...p.parts.flatMap((q) => [q.to, q.xFix, q.station, q.xStation, q.end?.station, String(q.end?.to || '').split(' ')[0]])]
      .filter((n) => n && /^[A-Z][A-Z0-9]{1,5}$/.test(n));
    const unknown = [...new Set(names.filter((n) => !p.wpts?.[n] && !p.fixDefs?.[n] && !findPoint(n)))];
    p.warnings = (p.warnings || []).filter((w) => !/座標が PDF にありません/.test(w));
    if (unknown.length) p.warnings.push(`座標が見つかりません：${unknown.join('・')}（国土交通省の NAV データを読み込むと引けます）`);
  });
}

async function onFiles(files) {
  const status = $('aipStatus');
  try {
    status.scrollIntoView({ block: 'center' });
    pending = await scanAip(files, { onProgress: (m) => { status.textContent = m; }, existing: procedures(), defaults: state.settings.aipDefaults });
    markUnknownFixes(pending.procs);
  } catch (err) {
    status.textContent = `読み取りに失敗しました：${err.message}`;
    pending = null;
  }
  renderReview();
  $('aipReview').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function onApply() {
  const root = $('aipReview');
  const runwayIcaos = new Set([...root.querySelectorAll('[data-aiprwy]:checked')].map((c) => c.dataset.aiprwy));
  const procIds = new Set([...root.querySelectorAll('[data-aipproc]:checked')].map((c) => c.dataset.aipproc));
  const list = await applyAip(pending, { runwayIcaos, procIds });
  mergeProcedures(list);
  await saveProcedures();
  $('aipStatus').textContent = `取り込みました：滑走路 ${runwayIcaos.size} 飛行場・手順 ${list.length} 本`;
  pending = null;
  emit('proc');
  emit('route');
  renderAipSection();
}

export function bindAipSection() {
  $('aipDefaults').addEventListener('change', (e) => {
    const k = e.target.dataset.aipdef;
    const v = Number(e.target.value);
    if (k && v > 0) updateSettings({ aipDefaults: { ...state.settings.aipDefaults, [k]: v } });
  });
  $('aipFile').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) await onFiles(files);
  });
  $('aipReview').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const set = (ad, on) => $('aipReview').querySelectorAll('[data-aipproc]').forEach((c) => { if (c.dataset.aipproc.startsWith(`aip-${ad}-`)) c.checked = on; });
    if (b.dataset.aipall) { e.preventDefault(); set(b.dataset.aipall, true); }
    if (b.dataset.aipnone) { e.preventDefault(); set(b.dataset.aipnone, false); }
    if (b.dataset.aip === 'apply') await onApply();
    if (b.dataset.aip === 'cancel') { pending = null; $('aipStatus').textContent = ''; renderReview(); }
  });
  $('aipList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-aiprm]');
    if (!b) return;
    await removeAipRunways(b.dataset.aiprm);
    emit('route');
    renderAipSection();
  });
}
