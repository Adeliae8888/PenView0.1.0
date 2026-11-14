// 0.2.7 進入チャート（IAC）の画面検証：node tests/e2e-iac.mjs <URL> <スクリーンショット出力dir> <RJAH の zip>
// 百里の zip を読む → 確認画面に APP（RNP は IAF → IF → FAF → MAPt、復行と待機）→ 取り込む
// → RNP RWY21R：NAKAH → MAGRY → OMITT → H1R52 → RW21R、復行 NAKAH、待機（レーストラック・注記）
// → VOR RWY21R（従来型）：IF・FAF は滑走路の延長線上（末端からの距離）、候補（図の定義）がエディターに出る
// → ルート RJAH → RJAH の DST で APP を選べる。MISSED APP の点は NAKAH まで（待機は点を増やさない）
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';

const [url, outDir, zip] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());
const R = {};
const ready = () => page.waitForSelector('body[data-ready="true"]');

await page.goto(url, { waitUntil: 'load' });
await ready();
await page.click('#settingsBtn');
await page.setInputFiles('#aipFile', [zip]);
await page.waitForSelector('[data-aip="apply"]', { timeout: 300000 });
R.review = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-aipproc]')].map((c) => ({ id: c.dataset.aipproc, text: c.closest('label').innerText.replace(/\s+/g, ' ') }));
  return { app: rows.filter((r) => /-APP-/.test(r.id)).length, rnp21r: rows.find((r) => r.id === 'aip-RJAH-APP-RNP-RWY21R')?.text, vor21r: rows.find((r) => r.id === 'aip-RJAH-APP-VOR-RWY21R')?.text };
});
await page.screenshot({ path: `${outDir}/i1_review.png` });
await page.click('[data-aip="apply"]');
await page.waitForTimeout(800);

// 作図（OpenAIP の NAVAID と AIP の滑走路だけ。国土交通省の NAV データなし）
R.geo = await page.evaluate(async () => {
  const [P, W, G] = await Promise.all([import('/js/procedures.js'), import('/js/proc-wire.js'), import('/js/geo.js')]);
  const rnp = P.findProcedure('aip-RJAH-APP-RNP-RWY21R');
  const r = W.buildForTest(rnp);
  const hold = r.segments.find((s) => s.hold);
  const vor = W.buildForTest(P.findProcedure('aip-RJAH-APP-VOR-RWY21R'));
  const thr = vor.fixes.find((f) => f.name === 'RW21R');
  const apps = P.procedures().filter((p) => p.type === 'APP');
  return {
    rnpFixes: r.fixes.map((f) => `${f.missed ? 'MA:' : ''}${f.name}`), rnpWarn: r.warnings, start: r.start?.name,
    hold: hold ? { pts: hold.pts.length, closed: G.distanceNm(hold.pts[0], hold.pts.at(-1)) < 0.01 } : null,
    holdLabel: r.labels.find((l) => /^HOLD/.test(l.text))?.text,
    vorFixes: vor.fixes.map((f) => `${f.missed ? 'MA:' : ''}${f.name}`), vorWarn: vor.warnings,
    vorFinalNm: thr ? +G.distanceNm(vor.start, thr).toFixed(2) : null,
    clean: apps.filter((p) => !W.buildForTest(p).warnings.length).length, apps: apps.length,
  };
});

// 地図：RNP RWY21R を表示して百里の上で
await page.evaluate(async () => {
  const [P, S] = await Promise.all([import('/js/procedures.js'), import('/js/state.js')]);
  P.findProcedure('aip-RJAH-APP-RNP-RWY21R').visible = true; P.saveProcedures();
  S.updateSettings({ follow: false, mode: 'NAV', view: { lat: 36.3, lon: 140.4, scale: 9 } });
});
await page.waitForTimeout(1300);
await page.reload({ waitUntil: 'load' });
await ready();
await page.waitForTimeout(600);
R.map = await page.evaluate(() => ({
  app: document.querySelectorAll('#overlay .proc-app').length,
  missedLines: document.querySelectorAll('#overlay .proc-app .proc-line.missed').length,
  holdText: [...document.querySelectorAll('#overlay .proc-app .proc-crs')].map((t) => t.textContent).filter((s) => /HOLD/.test(s)),
  wpts: [...document.querySelectorAll('#overlay .proc-app .proc-wpt text')].map((t) => t.textContent),
  unvTag: document.querySelectorAll('#overlay .proc-app.unverified .proc-unv').length,
}));
await page.screenshot({ path: `${outDir}/i2_rnp21r.png` });

// エディター：従来型の候補
await page.click('#routeBtn');
await page.click('[data-tab="proc"]');
const tags = () => page.$$eval('#tab-proc .tag.unverified', (t) => t.length);
R.listUnv0 = await tags();
R.listRows = await page.$$eval('#tab-proc [data-pr="edit"]', (t) => t.length);
await page.click('[data-pr="edit"][data-id="aip-RJAH-APP-VOR-RWY21R"]');
await page.waitForTimeout(300);
R.verifyBar = !!(await page.$('#tab-proc .verify-bar [data-pr="verify"]'));
R.editorHints = await page.evaluate(() => document.querySelector('#tab-proc .hints')?.innerText.replace(/\s+/g, ' ') || null);
await page.screenshot({ path: `${outDir}/i3_editor.png` });
await page.click('[data-pr="verify"]');
await page.waitForTimeout(300);
R.afterVerify = await page.evaluate(() => ({ bar: !!document.querySelector('#tab-proc .verify-bar'), done: /確認済み/.test(document.getElementById('tab-proc').innerText) }));
await page.click('[data-pr="back"]');
await page.waitForTimeout(200);
R.listUnv1 = await tags();

// ルート：RJAH → RJAH、DST で APP（RNP RWY21R）
await page.click('[data-tab="route"]');
await page.click('[data-ract="new"]');
const add = async (text) => { await page.fill('[data-add-input="points"]', text); await page.click('[data-add="points"]'); };
await add('RJAH'); await add('RJAH');
R.appChoices = await page.$$eval('[data-rf="proc:APP"] option', (o) => o.map((x) => x.textContent).filter((t) => /RNP|VOR/.test(t)).length);
R.pickLabels = await page.$$eval('[data-rf="proc:APP"] option', (o) => o.map((x) => x.textContent).filter((t) => /^(RNP RWY21R|VOR RWY21R)/.test(t)));
await page.selectOption('[data-rf="proc:APP"]', 'aip-RJAH-APP-RNP-RWY21R');
await page.waitForTimeout(300);
R.route = await page.evaluate(async () => {
  const [Rt, W] = await Promise.all([import('/js/route.js'), import('/js/proc-wire.js')]);
  const r = Rt.activeRoute();
  return { points: r.points.map((p) => p.name), missed: W.routeMissedPoints(r).map((p) => p.name) };
});
await page.reload({ waitUntil: 'load' });
await ready();
await page.waitForTimeout(500);
R.reloadUnv = await page.evaluate(() => ({ unvTags: document.querySelectorAll('#overlay .proc-unv').length }));
R.persist = await page.evaluate(async () => { const P = await import('/js/procedures.js'); return { vor: P.isUnverified(P.findProcedure('aip-RJAH-APP-VOR-RWY21R')), rnp: P.isUnverified(P.findProcedure('aip-RJAH-APP-RNP-RWY21R')) }; });
await browser.close();
console.log(JSON.stringify(R, null, 1));

const checks = {
  '確認画面に APP（RNP と従来型）': R.review.app >= 8 && /NAKAH → MAGRY → OMITT → H1R52 → RW21R ／ 復行：NAKAH → HOLD/.test(R.review.rnp21r || ''),
  'RNP：IAF → IF → FAF → 途中 → MAPt、復行 NAKAH、警告なし': R.geo.start === 'NAKAH' && R.geo.rnpFixes.join(' ') === 'MAGRY OMITT H1R52 RW21R MA:NAKAH' && !R.geo.rnpWarn.length,
  '待機：閉じたレーストラック＋注記': R.geo.hold?.closed && R.geo.hold.pts > 100 && /^HOLD \d{3}°(（入る向き）)? [RL] 1MIN 4000$/.test(R.geo.holdLabel || ''),
  '従来型：IF → FAF → 末端（延長線上 10.6nm）': R.geo.vorFinalNm === 10.6 && R.geo.vorFixes.slice(0, 2).join(' ') === 'FAF RW21R',
  '地図に APP と待機の注記': R.map.app === 1 && R.map.missedLines >= 2 && R.map.holdText.length === 1,
  'エディターに候補': /NAKAH ＝ HUC R-002 D15.0/.test(R.editorHints || ''),
  '取り込んだ手順は全部未確認（一覧・地図）': R.listUnv0 === R.listRows && R.listRows > 20 && R.map.unvTag === 1,
  '確認したを押すと未確認が消える（一覧は1つ減る・再読込後も）': R.verifyBar && !R.afterVerify.bar && R.afterVerify.done && R.listUnv1 === R.listUnv0 - 1 && R.persist.vor === false && R.persist.rnp === true,
  'ルートの選択に（未確認）': R.pickLabels.some((t) => /^RNP RWY21R.*（未確認）$/.test(t)) && R.pickLabels.some((t) => /^VOR RWY21R$/.test(t)),
  'ルート：DST で APP を選べる・復行の点は NAKAH まで': R.appChoices >= 5 && R.route.points.join(' ').includes('NAKAH MAGRY OMITT H1R52 RW21R') && R.route.missed.at(-1) === 'NAKAH',
};
Object.entries(checks).forEach(([k, v]) => console.log(`${v ? 'OK ' : 'NG '} ${k}`));
console.log('errors:', errors.length ? errors : 'none');
process.exitCode = Object.values(checks).every(Boolean) && !errors.length ? 0 : 1;
