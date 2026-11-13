// 0.2.5 実際の AIP の PDF での検証（PDF は同梱しない）：node tests/aip-corpus.mjs <pdfjs-dist の legacy/build/pdf.mjs> <PDF のあるフォルダ>
// ・AD2：全飛行場で滑走路が読める。DER の位置を独立に確かめる：THR → DER の距離 ＝ その滑走路の LDA（着陸用の末端から先の長さ）
// ・RNAV の SID/STAR：表・レグ・名前・座標の抜けがない
import fs from 'fs';
import path from 'path';
import { pdfPages } from '../js/pdf-text.js';
import { parseAd2, findTables, waypointTable, tablesToProcs, linkTransitions } from '../js/aip-parse.js';
import { distanceNm } from '../js/geo.js';

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
  procs.push(...tablesToProcs(pages, { icao: b.slice(0, 4), side: /__STAR/.test(b) ? 'STAR' : 'SID', source: { file: b } }));
}
linkTransitions(procs);
const count = {};
procs.forEach((p) => { count[p.type] = (count[p.type] || 0) + 1; });
console.log(out.ad2.join('\n'));
console.log(`表 ${tables}・レグ ${legs}・手順`, count, `TRANSITION の親なし ${procs.filter((p) => p.type === 'TRANSITION' && !p.parents.length).length}`);
console.log(out.problems.length ? `problems:\n${out.problems.join('\n')}` : 'problems: none');
