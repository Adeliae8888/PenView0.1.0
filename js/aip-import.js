/* ==== aip-import.js ==== AIP の PDF（空港ごとの zip のまま、または PDF）を読む：AD2 → 滑走路、RNAV の SID/STAR → 手順
 * 読むだけ（scanAip）と、確認画面で選んだものを保存する（applyAip）を分ける。滑走路は IndexedDB の aipRunways に飛行場ごと */
import { load, save } from './store.js';
import { unzip } from './zip.js';
import { pdfPages } from './pdf-text.js';
import { parseAd2, tablesToProcs, linkTransitions } from './aip-parse.js';

const RWY_KEY = 'aipRunways';
let runways = {};                          // { ICAO: { runways:[…], eff, file, importedAt } }
let pdfjsPromise = null;

export async function loadAipRunways() {
  runways = await load(RWY_KEY, {});
  return runways;
}

/* ==== aipRunways ==== 飛行場の AIP の滑走路（L/R・THR・DER）。無ければ null */
export function aipRunways(icao) {
  return runways[String(icao || '').toUpperCase()]?.runways || null;
}

export function aipRunwayIndex() {
  return runways;
}

/* ==== pdfjs ==== pdf.js を必要なときだけ読む（同梱。オフラインでも可） */
function pdfjs() {
  pdfjsPromise ||= import('../vendor/pdfjs/pdf.min.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return m;
  });
  return pdfjsPromise;
}

const effOf = (name) => { const m = name.match(/_(\d{4})(\d{2})(\d{2})\.pdf$/i); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const base = (path) => path.split('/').pop();

/* ==== classifyPdf ==== ファイル名で種類を分ける（国土交通省の命名：ICAO__AD2_日付.pdf、ICAO__SID…、ICAO__STAR…、ICAO__IAC…） */
export function classifyPdf(path) {
  const b = base(path);
  const icao = b.match(/^([A-Z]{4})__/)?.[1] || null;
  if (/__AD2_/i.test(b)) return { kind: 'AD2', icao };
  if (/__SID/i.test(b)) return { kind: 'SID', icao };
  if (/__STAR/i.test(b)) return { kind: 'STAR', icao };
  if (/__IAC/i.test(b)) return { kind: 'IAC', icao };
  return { kind: 'OTHER', icao };
}

/* ==== collectPdfs ==== 選んだファイル（zip・pdf）→ {path, bytes} */
async function collectPdfs(files, onProgress) {
  const out = [];
  for (const file of files) {
    onProgress(`展開中：${file.name}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(file.name)) out.push(...await unzip(bytes, (p) => /\.pdf$/i.test(p)));
    else if (/\.pdf$/i.test(file.name)) out.push({ path: file.name, bytes });
  }
  return out;
}

/* ==== scanAip ==== 読んで結果を返す（保存はしない）。lib＝pdf.js（テストで差し替え） */
export async function scanAip(files, { onProgress = () => {}, existing = [], lib = null } = {}) {
  const pdfs = await collectPdfs(files, onProgress);
  const pdf = lib || await pdfjs();
  const res = { runways: [], procs: [], skipped: { text: [], iac: [], image: [], other: 0 } };
  for (const [i, f] of pdfs.entries()) {
    const c = classifyPdf(f.path);
    if (c.kind === 'OTHER') { res.skipped.other += 1; continue; }
    if (c.kind === 'IAC') { res.skipped.iac.push(base(f.path)); continue; }
    onProgress(`読み取り中 ${i + 1}/${pdfs.length}：${base(f.path)}`);
    const pages = await pdfPages(pdf, f.bytes);
    const words = pages.reduce((n, p) => n + p.items.length, 0);
    if (words < 30) { res.skipped.image.push(base(f.path)); continue; }
    const source = { file: base(f.path), eff: effOf(f.path) };
    if (c.kind === 'AD2') {
      const r = parseAd2(pages);
      if (r.runways.length) res.runways.push({ icao: r.icao || c.icao, runways: r.runways, ...source });
      continue;
    }
    const procs = tablesToProcs(pages, { icao: c.icao, side: c.kind, source });
    if (procs.length) res.procs.push(...procs); else res.skipped.text.push(base(f.path));
  }
  linkTransitions(res.procs, existing);
  onProgress(`読み取り完了：滑走路 ${res.runways.length} 飛行場・手順 ${res.procs.length} 本`);
  return res;
}

/* ==== applyAip ==== 確認画面で選んだ滑走路を保存し、手順を返す（手順の保存は呼ぶ側で mergeProcedures） */
export async function applyAip(res, { runwayIcaos, procIds }) {
  res.runways.filter((r) => runwayIcaos.has(r.icao)).forEach((r) => {
    runways[r.icao] = { runways: r.runways, eff: r.eff, file: r.file, importedAt: Date.now() };
  });
  await save(RWY_KEY, runways);
  return res.procs.filter((p) => procIds.has(p.id)).map(({ warnings, lastFix, side, ...p }) => p);
}

/* ==== mergeAipRunways ==== 書き出しファイルからの読込（同じ飛行場は置き換え） */
export async function mergeAipRunways(data) {
  Object.assign(runways, data || {});
  await save(RWY_KEY, runways);
}

/* ==== removeAipRunways ==== */
export async function removeAipRunways(icao) {
  delete runways[icao];
  await save(RWY_KEY, runways);
}
