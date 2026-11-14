// 0.2.5 実際の AIP の PDF での検証（PDF は同梱しない）：node tests/aip-corpus.mjs <pdfjs-dist の legacy/build/pdf.mjs> <PDF のあるフォルダ>
// ・AD2：全飛行場で滑走路が読める。DER の位置を独立に確かめる：THR → DER の距離 ＝ その滑走路の LDA（着陸用の末端から先の長さ）
// ・RNAV の SID/STAR：表・レグ・名前・座標の抜けがない
// ・進入チャート（0.2.7）：RNP は IAF/IF → FAF → MAPt が座標つきでつながる、復行が読める、待機の図
//   ※RNP の座標の抜けは problems に出す
import fs from 'fs';
import path from 'path';
import { pdfPages } from '../js/pdf-text.js';
import { parseAd2, findTables, waypointTable, tablesToProcs, linkTransitions } from '../js/aip-parse.js';
import { distanceNm } from '../js/geo.js';
import { textToProcs } from '../js/aip-text.js';
import { iacToProcs } from '../js/aip-iac.js';

const [pdfjsPath, dir] = process.argv.slice(2);
const pdfjs = await import(pdfjsPath);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(dir).filter((f) => f.endsWith('.pdf'));
const read = async (f) => pdfPages(pdfjs, new Uint8Array(fs.readFileSync(f)));
const out = { ad2: [], problems: [] };

for (const f of files.filter((x) => /__AD2_/.test(x))) {
  const r = parseAd2(await read(f));
  r.runways.forEach((w) => {
    const m = distanceNm(w.thr, w.der) * 1852;
    if (w.lda && Math.abs(m - w.lda) > 15) out.problems.push(`${r.icao} ${w.d}：THR→DER ${m.toFixed(0)}m ≠ LDA ${w.lda}m`);
  });
  out.ad2.push(`${r.icao} ${r.runways.map((w) => `${w.d}${w.lda ? `(${(distanceNm(w.thr, w.der) * 1852).toFixed(0)}/${w.lda})` : ''}`).join(' ')}`);
}

let tables = 0;
let legs = 0;
const procs = [];
for (const f of files.filter((x) => /__(SID|STAR)/.test(path.basename(x)))) {
  const pages = await read(f);
  const t = findTables(pages);
  const w = waypointTable(pages);
  const b = path.basename(f);
  tables += t.length;
  t.forEach((x) => x.legs.forEach((l) => {
    legs += 1;
    if (['TF', 'DF', 'IF', 'CF'].includes(l.path) && !l.wpt) out.problems.push(`${b} ${x.title} ${l.serial}：名前なし`);
    if (l.wpt && !w[l.wpt]) out.problems.push(`${b} ${l.wpt}：座標なし`);
  }));
  const opts = { icao: b.slice(0, 4), side: /__STAR/.test(b) ? 'STAR' : 'SID', source: { file: b } };
  const fromTable = tablesToProcs(pages, opts);
  procs.push(...fromTable, ...textToProcs(pages, opts).filter((p) => !fromTable.some((q) => q.id === p.id || q.name === p.name)));
}
linkTransitions(procs);
const count = {};
procs.forEach((p) => { count[p.type] = (count[p.type] || 0) + 1; });
console.log(out.ad2.join('\n'));
const orphans = procs.filter((p) => p.type === 'TRANSITION' && !p.parents.length).map((p) => `${p.ad} ${p.name}`);
const unread = procs.filter((p) => p.warnings?.some((w) => /読めない文/.test(w))).length;
console.log(`表 ${tables}・レグ ${legs}・手順（RNAV＋従来型）`, count, `読めない文のある手順 ${unread}・TRANSITION の親なし ${orphans.length}${orphans.length ? `（${orphans.join('、')}）` : ''}`);

const iac = { charts: 0, app: 0, rnp: 0, rnpPath: 0, missed: 0, hold: 0, holdFromChart: 0, convPlaced: 0 };
for (const f of files.filter((x) => /__IAC/.test(path.basename(x)))) {
  const pages = await read(f);
  if (pages.reduce((n, p) => n + p.items.length, 0) < 30) continue;   // 画像だけ
  const b = path.basename(f);
  iac.charts += 1;
  iacToProcs(pages, { icao: b.slice(0, 4), source: { file: b } }).forEach((p) => {
    iac.app += 1;
    const rnp = /^(RNP|RNAV)/.test(p.name);
    if (rnp) {
      iac.rnp += 1;
      const names = [p.startFix, ...p.parts.map((q) => q.to)];
      if (p.parts.length >= 2) iac.rnpPath += 1;
      names.filter((n) => n && !p.wpts[n]).forEach((n) => out.problems.push(`${b} ${n}：座標なし`));
    } else if (p.startFix) iac.convPlaced += 1;
    if (p.missed.length) iac.missed += 1;
    const h = p.missed.find((q) => q.type === 'hold');
    if (h) { iac.hold += 1; if (h.inbound !== null) iac.holdFromChart += 1; }
  });
}
console.log('進入チャート', iac);
console.log(out.problems.length ? `problems:\n${out.problems.join('\n')}` : 'problems: none');
