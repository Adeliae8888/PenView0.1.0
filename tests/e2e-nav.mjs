// 0.2.0 航法の画面検証：node tests/e2e-nav.mjs <URL> <スクリーンショット出力dir>
// 機体登録 → ルート作成（方位/距離定義・代替経路）→ ログ → 模擬飛行で離陸検出・自動送り・燃料入力・JOKER → DIRECT → 長押し → モード別レイヤー
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';

const [url, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());
const R = {};
const mod = (path, fn, arg) => page.evaluate(async ([p, f, a]) => { const m = await import(p); return new Function('m', 'a', f)(m, a); }, [path, fn, arg]);

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('body[data-ready="true"]');

// --- 機体登録
await page.click('#routeBtn');
await page.click('[data-tab="aircraft"]');
await page.click('[data-aact="newAc"]');
const fill = async (sel, v) => { await page.fill(sel, String(v)); await page.press(sel, 'Tab'); };
await fill('[data-acname]', 'F-16C');
await fill('[data-cf="name"]', 'CL+2TK');
const cfgVals = { fuelCap: 10000, taxiTakeoff: 500, approachLanding: 600, missedApproach: 900, reserve: 1500, 'climb.speed': 350, 'climb.roc': 6000, 'climb.ff': 9000, 'cruise.speed': 0.85, 'cruise.ff': 4000, 'descent.speed': 300, 'descent.rod': 4000, 'descent.ff': 1500 };
for (const [k, v] of Object.entries(cfgVals)) await fill(`[data-cf="${k}"]`, v);
R.unitBefore = await page.textContent('[data-cunit="cruise.speed"]');
await page.click('[data-cunit="cruise.speed"]');     // MACH → KIAS（FL250 で換算）
R.unitAfter = `${await page.textContent('[data-cunit="cruise.speed"]')} ${await page.inputValue('[data-cf="cruise.speed"]')}`;
await page.click('[data-cunit="cruise.speed"]'); await page.click('[data-cunit="cruise.speed"]');   // → TAS → MACH
R.unitBack = `${await page.textContent('[data-cunit="cruise.speed"]')} ${await page.inputValue('[data-cf="cruise.speed"]')}`;

// --- ルート：RJAH → HUC 360/40 → RJSN、代替 RJSK
await page.click('[data-tab="route"]');
await page.click('[data-ract="new"]');
await page.selectOption('[data-rf="configRef"]', { index: 1 });
await fill('[data-rf="joker"]', 7000);
await fill('[data-rf="bingo"]', 5500);
const add = async (list, text, alt) => {
  await page.fill(`[data-add-input="${list}"]`, text);
  if (alt !== undefined) await page.fill(`[data-add-alt="${list}"]`, String(alt));
  await page.click(`[data-add="${list}"]`);
};
await add('points', 'RJAH');
await add('points', 'RJSN');
await add('points', 'HUC 360/40', 25000);
await add('alternate', 'RJSK');
R.routeRows = await page.$$eval('#tab-route table.pts:first-of-type tr:not(.pt-detail) td:nth-child(2)', (t) => t.map((x) => x.textContent));
await page.screenshot({ path: `${outDir}/n1_route.png` });

// --- ログ
await page.click('[data-tab="log"]');
R.log = await page.evaluate(() => ({ rows: document.querySelectorAll('table.log tr').length, totals: document.querySelector('.totals')?.innerText.replace(/\s+/g, ' ') }));
await page.screenshot({ path: `${outDir}/n2_log.png` });
await page.click('[data-close="dataSheet"]');

// --- 模擬飛行：STPT1 の 3nm 手前から北へ（離陸検出 → 自動送り）
await mod('/js/route.js', `const r = m.activeRoute(); window.__stpt1 = r.points[1]; return r.points.map(p => p.name)`);
await page.evaluate(async () => {
  const g = await import('/js/gps.js');
  const geo = await import('/js/geo.js');
  const p = window.__stpt1;
  const start = geo.destination(p, 180, 3);
  g.startSim({ lat: start.lat, lon: start.lon, trk: 0, gs: 3600, alt: 25000 });   // 1nm/秒（試験のため高速）
});
await page.waitForTimeout(5500);
R.afterPass = await mod('/js/route.js', `const r = m.activeRoute(); return { active: r.activeIdx, takeoff: !!r.flight.takeoffAt }`);
R.fuelPrompt = await page.evaluate(() => !document.getElementById('fuelPrompt').classList.contains('hidden') && document.getElementById('fuelPromptText').textContent);
await page.screenshot({ path: `${outDir}/n3_nav_panel.png` });

// --- 燃料入力（テンキー）6800 → JOKER（7000）以下
await page.click('#fuelPromptText');
for (const k of ['6', '8', '0', '0']) await page.click(`.kp-grid [data-k="${k}"]`);
await page.click('.kp-actions [data-k="ok"]');
await page.waitForTimeout(1500);
R.alert = await page.evaluate(() => document.getElementById('fuelAlert').className);
R.panel = await page.evaluate(() => document.getElementById('dataPanel').innerText.replace(/\s+/g, ' '));
await page.screenshot({ path: `${outDir}/n4_joker.png` });
await page.click('#fuelAlertAck');

// --- DIRECT（ルート外の地点）：右クリック → DIRECT → EXECUTE
await mod('/js/gps.js', `m.stopSim()`);
await page.mouse.click(1000, 300, { button: 'right' });
await page.waitForTimeout(300);
await page.click('[data-act="direct"]');
R.directBar = await page.evaluate(() => !document.getElementById('directBar').classList.contains('hidden'));
await page.screenshot({ path: `${outDir}/n5_direct_armed.png` });
await page.click('#directExec');
R.afterDirect = await mod('/js/route.js', `const r = m.activeRoute(); return { names: r.points.map(p => p.name), active: r.activeIdx, dir: !!r.flight.directOrigin }`);

// --- モード別レイヤー：NAV でグリッド ON、TAC で OFF、NAV に戻ると ON
await page.click('#gridBtn');
await page.click('[data-mode="TAC"]');
const tacGrid1 = await page.evaluate(() => document.getElementById('gridBtn').classList.contains('active'));
if (tacGrid1) await page.click('#gridBtn');
await page.click('[data-mode="NAV"]');
R.modeLayers = { tacGridInitially: tacGrid1, navGridRestored: await page.evaluate(() => document.getElementById('gridBtn').classList.contains('active')) };

// --- タッチ：シングルタップ＝カーソルのみ、長押し＝地点情報
const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const tp = await touch.newPage();
tp.on('pageerror', (e) => errors.push(`touch pageerror: ${e.message}`));
await tp.goto(url, { waitUntil: 'load' });
await tp.waitForSelector('body[data-ready="true"]');
const cdp = await touch.newCDPSession(tp);
const touchAt = async (x, y, holdMs) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await tp.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await tp.waitForTimeout(300);
};
await touchAt(200, 300, 80);
R.touchTap = await tp.evaluate(() => ({ info: document.getElementById('infoSheet').classList.contains('open'), cursor: document.getElementById('cursorReadout').textContent }));
await touchAt(200, 300, 800);
R.touchLong = await tp.evaluate(() => document.getElementById('infoSheet').classList.contains('open'));
await tp.screenshot({ path: `${outDir}/n6_touch_longpress.png` });

console.log(JSON.stringify(R, null, 1));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
