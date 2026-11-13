/* ==== ui-aip.js ==== 設定画面：AIP の PDF（空港ごとの zip）を読む → 確認画面（読み取った滑走路・手順、読まなかった PDF）→ 選んだものを取り込む */
import { emit } from './state.js';
import { scanAip, applyAip, aipRunwayIndex, removeAipRunways } from './aip-import.js';
import { procedures, mergeProcedures, saveProcedures, procLabel } from './procedures.js';
import { esc } from './map-render.js';

const $ = (id) => document.getElementById(id);
let pending = null;                         // 読み取った結果（取り込み前）

/* ==== partSummary ==== 「HDG 028 → LICEN → OGITU」 */
function partSummary(p) {
  const head = p.startFix ? [p.startFix] : [];
  return [...head, ...p.parts.map((pt) => (pt.type === 'heading' ? `HDG ${String(pt.hdg).padStart(3, '0')}` : pt.to))].join(' → ');
}

function procRow(p, exists) {
  const parents = p.type === 'TRANSITION' ? ` <span class="muted">← ${p.parents.length ? `${p.parents.length} 本の ${p.side === 'STAR' ? 'STAR' : 'SID'}` : 'つながる手順なし'}</span>` : '';
  const warn = p.warnings?.length ? `<div class="warn small">${p.warnings.map(esc).join('<br>')}</div>` : '';
  return `<label class="aip-row"><input type="checkbox" data-aipproc="${esc(p.id)}" checked /><span><b>${esc(procLabel(p))}</b>${exists.has(p.id) ? ' <span class="tag">上書き</span>' : ''}${parents}
    <br><span class="muted small">${esc(partSummary(p))}</span>${warn}</span></label>`;
}

function skippedHtml(sk) {
  const list = (title, arr) => (arr.length ? `<p><b>${title}</b>（${arr.length}）<br><span class="muted small">${arr.map(esc).join('、')}</span></p>` : '');
  const n = sk.text.length + sk.iac.length + sk.image.length;
  if (!n) return '';
  return `<details><summary>読まなかった PDF（${n}）</summary>
    ${list('従来型の文章の SID/STAR（0.2.6 で対応予定）', sk.text)}${list('進入チャート（0.2.7 で対応予定）', sk.iac)}${list('文字の無い画像の PDF（読めません）', sk.image)}</details>`;
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
    ${groups ? `<h4>RNAV の手順</h4><p class="muted small">取り込んだ手順は地図に出しません（ルートで選んだとき、または手順の一覧で表示にしたときに出ます）。</p>${groups}` : ''}
    ${skippedHtml(pending.skipped)}
    <div class="row"><button type="button" class="btn primary" data-aip="apply">取り込む</button><button type="button" class="btn" data-aip="cancel">やめる</button></div></div>`;
}

/* ==== renderAipSection ==== 取り込み済みの飛行場の滑走路 */
export function renderAipSection() {
  const idx = Object.entries(aipRunwayIndex());
  $('aipList').innerHTML = idx.length ? `<table class="pts">${idx.map(([icao, r]) => `<tr><td>${esc(icao)}</td><td>${r.runways.map((x) => esc(x.d)).join('・')}</td>
    <td>${esc(r.eff || '')}</td><td><button type="button" class="btn sm danger" data-aiprm="${esc(icao)}">×</button></td></tr>`).join('')}</table>` : '';
  renderReview();
}

async function onFiles(files) {
  const status = $('aipStatus');
  try {
    status.scrollIntoView({ block: 'center' });
    pending = await scanAip(files, { onProgress: (m) => { status.textContent = m; }, existing: procedures() });
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
