// 0.2.5 AIP の PDF 取り込みの画面検証：node tests/e2e-aip.mjs <URL> <スクリーンショット出力dir> <空港 zip …>
// 空港ごとの zip（国土交通省の AD2・SID・STAR・IAC の PDF）を読み込む → 確認画面 → 取り込む
// → 滑走路（AD2）が L/R つきで手順エディターに出る・SID の滑走路端が推定でない
// → ルート RJCC → RJCC で SID JUGGLAR2 RWY01L、その TRANSITION（PANSY）だけ選べる（他の SID の TRANSITION は出ない）
// → 地図：手順の色、名前のあるフィックスは WPT 形式（三角＋名前）
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';

const [url, outDir, ...zips] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());
const R = {};
const mod = (path, fn, arg) => page.evaluate(async ([p, f, a]) => { const m = await import(p); return new Function('m', 'a', f)(m, a); }, [path, fn, arg]);

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('body[data-ready="true"]');
await page.click('#settingsBtn');
const t0 = Date.now();
await page.setInputFiles('#aipFile', zips);
await page.waitForSelector('[data-aip="apply"]', { timeout: 300000 });
R.scanSec = Math.round((Date.now() - t0) / 1000);
R.status = await page.textContent('#aipStatus');
R.review = await page.evaluate(() => ({
  runways: [...document.querySelectorAll('[data-aiprwy]')].map((c) => c.closest('label').innerText.replace(/\s+/g, ' ')),
  procs: document.querySelectorAll('[data-aipproc]').length,
  groups: [...document.querySelectorAll('.aip-review details > summary')].map((s) => s.innerText.replace(/\s+/g, ' ').trim()),
  sample: [...document.querySelectorAll('[data-aipproc]')].slice(0, 3).map((c) => c.closest('label').innerText.replace(/\s+/g, ' ')),
}));
await page.screenshot({ path: `${outDir}/a1_review.png` });
await page.click('[data-aip="apply"]');
await page.waitForTimeout(800);
R.applied = await page.textContent('#aipStatus');
R.stored = await mod('/js/procedures.js', `const l = m.procedures(); const c = {}; l.forEach(p => { c[p.type] = (c[p.type] || 0) + 1; }); return c;`);

// 作図：取り込んだ手順を全部作図して、警告の無い本数（国土交通省の NAV データ無しの状態）
R.build = await page.evaluate(async () => {
  const [P, W] = await Promise.all([import('/js/procedures.js'), import('/js/proc-wire.js')]);
  const out = { ok: 0, warn: 0, byType: {}, kinds: {}, sample: [] };
  P.procedures().forEach((p) => {
    const r = W.buildForTest(p);
    const bad = r.warnings.filter((w) => !/推定値|として作図/.test(w));
    if (bad.length) { out.warn += 1; const k = bad[0].replace(/^\d+：/, '').replace(/：.*$/, ''); out.kinds[k] = (out.kinds[k] || 0) + 1; if (/終わりの条件/.test(bad[0]) || out.sample.length < 6) out.sample.push(`${p.id}: ${bad[0]} ｜ ${(p.source?.text || '').slice(0, 150)}`); } else out.ok += 1;
    out.byType[p.type] = (out.byType[p.type] || 0) + 1;
  });
  return out;
});
R.conv = await page.evaluate(async () => {
  const P = await import('/js/procedures.js');
  const g = P.procedures().find((p) => p.id === 'aip-RJAH-SID-GOPVU1-21R');
  return g ? g.parts.map((q) => q.type).join(',') : null;
});

// 滑走路：AIP の L/R、SID の滑走路端は AIP の DER（推定の警告なし）
R.sid = await page.evaluate(async () => {
  const [P, G, W] = await Promise.all([import('/js/procedures.js'), import('/js/procgeo.js'), import('/js/proc-wire.js')]);
  const ctx = W.__ctx || null;
  const s = P.procedures().find((p) => p.id === 'aip-RJCC-SID-JUGGLAR2-01L');
  return s ? { rwy: s.rwy, parts: s.parts.length, wpts: Object.keys(s.wpts).length } : null;
});
await page.click('#settingsBtn').catch(() => {});
await page.evaluate(() => document.getElementById('settingsSheet').classList.remove('open'));

// 手順の一覧：飛行場で絞り込み、全部を表示／非表示（絞り込み中はその飛行場だけ）
await page.click('#routeBtn');
await page.click('[data-tab="proc"]');
await page.selectOption('[data-pfilter]', 'RJAH');
await page.waitForTimeout(200);
const visCount = () => page.evaluate(async () => { const P = await import('/js/procedures.js'); const l = P.procedures(); return { rjah: l.filter((p) => p.ad === 'RJAH' && p.visible !== false).length, other: l.filter((p) => p.ad !== 'RJAH' && p.visible !== false).length, rows: document.querySelectorAll('[data-pvis]').length }; });
R.list0 = await visCount();
R.toggleLabel0 = await page.textContent('[data-pr="visall"]');
await page.click('[data-pr="visall"]');
await page.waitForTimeout(200);
R.list1 = await visCount();
R.toggleLabel1 = await page.textContent('[data-pr="visall"]');
await page.click('[data-pr="visall"]');
await page.waitForTimeout(200);
R.list2 = await visCount();
// ラジアルの「局から終点まで点線」：GOPVU1 RWY21R の HUC R047 のパーツ
await page.click('[data-pr="edit"][data-id="aip-RJAH-SID-GOPVU1-21R"]');
await page.waitForTimeout(200);
R.editorRadial = await page.$$eval('.part-card', (c) => c.map((x) => x.querySelector('b').textContent));
R.inboundOpts = await page.$$eval('select[data-pp="parts.2.inbound"] option', (o) => o.map((x) => x.textContent));
await page.check('input[data-pp="parts.2.guide"]');
await page.waitForTimeout(300);
R.guideSaved = await mod('/js/procedures.js', `return m.procedures().find(p => p.id === 'aip-RJAH-SID-GOPVU1-21R').parts[2].guide`);
R.guideDrawn = await page.evaluate(() => document.querySelectorAll('#overlay .proc-guide').length);
await page.click('[data-pr="back"]');
await page.click('[data-close="dataSheet"]');

// ルート RJCC → RJCC：SID と、その SID の TRANSITION だけ選べる
await page.click('#routeBtn');
await page.click('[data-tab="route"]');
await page.click('[data-ract="new"]');
const add = async (text, alt) => {
  await page.fill('[data-add-input="points"]', text);
  if (alt !== undefined) await page.fill('[data-add-alt="points"]', String(alt));
  await page.click('[data-add="points"]');
};
await add('RJCC');
await add('RJCC');
R.depPicker0 = await page.$$eval('.proc-pick select', (s) => s.map((x) => x.dataset.rf));
await page.selectOption('[data-rf="proc:SID"]', 'aip-RJCC-SID-JUGGLAR2-01L');
await page.waitForTimeout(200);
R.trChoices = await page.$$eval('[data-rf="proc:SID_TR"] option', (o) => o.map((x) => x.textContent));
await page.selectOption('[data-rf="proc:SID_TR"]', 'aip-RJCC-TRANSITION-PANSY');
await page.waitForTimeout(200);
R.rows = await page.$$eval('#tab-route table.pts:first-of-type tr:not(.pt-detail):not(.proc-pick-row)', (t) => t.map((x) => `${x.cells[0].textContent} ${x.cells[1].textContent}`));
// SID を TRANSITION の無いもの（SOSHU2）に変えると TRANSITION は外れる
await page.selectOption('[data-rf="proc:SID"]', 'aip-RJCC-SID-SOSHU2-01L');
await page.waitForTimeout(200);
R.afterSidChange = await mod('/js/route.js', `const r = m.activeRoute(); return { SID: r.procs.SID, SID_TR: r.procs.SID_TR, n: r.points.length, last: r.points.at(-2).name }`);
R.trChoicesAfter = await page.$$eval('[data-rf="proc:SID_TR"]', (s) => s.length);
await page.selectOption('[data-rf="proc:SID"]', 'aip-RJCC-SID-JUGGLAR2-01L');
await page.waitForTimeout(200);
await page.selectOption('[data-rf="proc:SID_TR"]', 'aip-RJCC-TRANSITION-PANSY');
await page.waitForTimeout(200);
R.startWarn = await page.evaluate(async () => {
  const [P, W] = await Promise.all([import('/js/procedures.js'), import('/js/proc-render.js')]);
  return null;
});
await page.screenshot({ path: `${outDir}/a2_route.png` });
await page.click('[data-close="dataSheet"]');

// 地図：千歳の上で
await page.evaluate(async () => { const s = await import('/js/state.js'); s.updateSettings({ follow: false, mode: 'NAV', view: { lat: 42.55, lon: 141.75, scale: 6 } }); });
await page.waitForTimeout(1300);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('body[data-ready="true"]');
await page.click('#zoomOut');
await page.waitForTimeout(800);
R.map = await page.evaluate(() => ({
  procGroups: [...document.querySelectorAll('#overlay .proc')].map((g) => g.getAttribute('class')),
  wptMarks: [...document.querySelectorAll('#overlay .proc-wpt text')].map((t) => t.textContent),
  ppStpt: [...document.querySelectorAll('#overlay .stpt')].map((g) => g.getAttribute('class').replace('stpt', '').trim()).filter(Boolean).slice(0, 12),
  startEstimated: [...document.querySelectorAll('#overlay .proc-start.est')].length,
  derLabel: [...document.querySelectorAll('#overlay .proc .proc-fix')].map((t) => t.textContent).filter((s) => /RWY/.test(s)),
}));
await page.screenshot({ path: `${outDir}/a3_map.png` });

console.log(JSON.stringify(R, null, 1));
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'errors: none');
await browser.close();
