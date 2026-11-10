// 0.2.1 画面検証：node tests/e2e-data.mjs <URL> <出力dir> <AIP zip> <NOTAM zip>
// 実データの読込 → グループ・表示 → 公式優先 → 複数候補のリスト → 方位アイコン → XTK/BINGO/HOME → 選択行の挿入 → 項目別の書き出し・読込
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const [url, outDir, aipZip, notamZip] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());
const R = {};
const ev = (f, a) => page.evaluate(f, a);

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('body[data-ready="true"]');

// --- 読込（AIP 一式 zip ＋ NOTAM zip）
await page.click('#settingsBtn');
let t0 = Date.now();
await page.setInputFiles('#navFile', [aipZip, notamZip]);
await page.waitForFunction(() => /読み込み完了/.test(document.getElementById('navStatus').textContent), null, { timeout: 180000 });
R.importSec = ((Date.now() - t0) / 1000).toFixed(1);
R.groups = await ev(() => [...document.querySelectorAll('#navList tr')].map((tr) => tr.innerText.replace(/\s+/g, ' ').replace(' ×', '')));
await page.screenshot({ path: `${outDir}/d1_import.png` });
await page.click('[data-close="settingsSheet"]');

// --- 公式優先：OpenAIP 空域が隠れているか
R.openAipHidden = await ev(() => [...document.querySelectorAll('#geo [data-as]')].every((p) => p.classList.contains('off')));
R.navGeoPaths = await ev(() => document.querySelectorAll('#navgeo path').length);

// --- 百里付近に拡大
await ev(async () => { const s = await import('/js/state.js'); s.updateSettings({ follow: false }); });
await ev(async () => {
  const m = await import('/js/main.js').catch(() => null);
  return m;
});
const goto = async (lat, lon, scale) => ev(async ([la, lo, sc]) => {
  const st = await import('/js/state.js');
  st.state.settings.follow = false;
  window.dispatchEvent(new CustomEvent('pv-goto', { detail: { lat: la, lon: lo, scale: sc } }));
}, [lat, lon, scale]);
await page.fill('#gotoInput', 'RJAH').catch(() => {});
await page.click('#settingsBtn');
await page.fill('#gotoInput', '36.18 140.41');
await page.click('#gotoBtn');
await page.click('[data-close="settingsSheet"]');
for (let i = 0; i < 4; i += 1) await page.click('#zoomIn');
await page.waitForTimeout(600);
R.overlayNav = await ev(() => ({ wpt: document.querySelectorAll('#overlay .wpt').length, obs: document.querySelectorAll('#overlay .obs').length, hold: document.querySelectorAll('#overlay .hold').length, labels: document.querySelectorAll('#overlay .nd-lbl').length }));
await page.screenshot({ path: `${outDir}/d2_hyakuri_nav.png` });

// --- 方位アイコンは常に表示
R.compassVisible = await page.isVisible('#compass');

// --- 複数候補のリスト：RJAH（飛行場）と HUC（NAVAID）が近い場所
const huc = await ev(async () => { const p = await import('/js/points.js'); const h = p.findPoint('RJAH'); return h; });
R.rjah = !!huc;
await page.click('#zoomOut'); await page.click('#zoomOut'); await page.click('#zoomOut');
await page.waitForTimeout(400);
const pos = await ev(() => { const g = document.querySelector('#overlay .apt'); return null; });
const apt = await ev(() => {
  const els = [...document.querySelectorAll('#overlay .apt, #overlay .nav')];
  const pts = els.map((e) => e.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number));
  for (let i = 0; i < pts.length; i += 1) for (let j = i + 1; j < pts.length; j += 1) {
    if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < 14) return [(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2];
  }
  return null;
});
if (apt) {
  await page.mouse.click(apt[0], apt[1]);
  await page.waitForTimeout(400);
  R.pickList = await ev(() => [...document.querySelectorAll('.pick-item')].map((b) => b.textContent.trim()).slice(0, 4));
  await page.screenshot({ path: `${outDir}/d3_picklist.png` });
  await page.click('.pick-item[data-pick="0"]');
  R.pickedTitle = await ev(() => document.querySelector('#infoSheet h2').textContent);
  await page.click('[data-close-info]');
}

// --- TAC：読み込みデータは TAC の既定（ルート線・WPT は消える）
await page.click('[data-mode="TAC"]');
await page.waitForTimeout(500);
R.tacLines = await ev(() => document.querySelectorAll('#navgeo .nd-line').length);
await page.screenshot({ path: `${outDir}/d4_tac.png` });
await page.click('[data-mode="NAV"]');
R.navLinesBack = await ev(() => document.querySelectorAll('#navgeo .nd-line').length);

// --- ルート（機体・BINGO・HOME BINGO）→ 模擬飛行でコースから東に 2.5nm（XTK 黄）
await ev(async () => {
  const ac = await import('/js/aircraft.js'); const rt = await import('/js/route.js'); const st = await import('/js/state.js');
  const a = ac.addAircraft('F-16C'); const c = a.configs[0];
  Object.assign(c, { name: 'CL', fuelCap: 7000, taxiTakeoff: 300, approachLanding: 500, missedApproach: 800, reserve: 1000,
    climb: { speed: { unit: 'IAS', value: 350 }, roc: 8000, ff: 9000 }, cruise: { speed: { unit: 'MACH', value: 0.85 }, ff: 3500 }, descent: { speed: { unit: 'IAS', value: 300 }, rod: 4000, ff: 1500 } });
  ac.saveAircraft();
  const r = rt.newRoute('XTK'); rt.setActiveRoute(r.id); r.configRef = { aircraftId: a.id, configId: c.id };
  const pts = await import('/js/points.js');
  rt.addPoint(r, pts.resolvePoint('RJAH')); rt.addPoint(r, pts.resolvePoint('RJSN'));
  rt.addPoint(r, { ...pts.resolvePoint('HUC 360/60'), alt: 25000 });
  r.bingo = 6000; r.bingoPoint = { name: 'HUC360060', ...pts.resolvePoint('HUC 360/60') };
  r.homeBingo = 5000;
  rt.saveRoutes(); st.emit('route');
  const g = await import('/js/gps.js'); const geo = await import('/js/geo.js');
  const mid = geo.destination(r.points[0], geo.bearingTrue(r.points[0], r.points[1]), 20);
  const off = geo.destination(mid, geo.bearingTrue(r.points[0], r.points[1]) + 90, 2.5);
  g.startSim({ lat: off.lat, lon: off.lon, trk: geo.bearingTrue(r.points[0], r.points[1]), gs: 420, alt: 20000 });
});
await page.waitForTimeout(2500);
R.panel = await ev(() => document.getElementById('dataPanel').innerText.replace(/\s+/g, ' '));
R.xtkClass = await ev(() => document.querySelector('.xtk')?.className);
R.alert = await ev(() => document.getElementById('fuelAlert').className);
await page.screenshot({ path: `${outDir}/d5_xtk_bingo.png` });
await ev(async () => (await import('/js/gps.js')).stopSim());

// --- ルート編集：選択行の「前に挿入」
await page.click('#routeBtn');
await page.click('#tab-route td.pick[data-i="1"]');
await page.check('[data-insmode="before"]');
await page.fill('[data-add-input="points"]', 'HUC');
await page.click('[data-add="points"]');
R.routeAfterInsert = await ev(async () => (await import('/js/route.js')).activeRoute().points.map((p) => p.name));
await page.screenshot({ path: `${outDir}/d6_route_select.png` });
await page.click('[data-close="dataSheet"]');

// --- 項目別の書き出し（機体のみ）→ 中身の確認
await page.click('#settingsBtn');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-io-export="aircraft"]')]);
const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
R.exportAircraftKeys = Object.keys(exported).filter((k) => !['type', 'version', 'exportedAt', 'app'].includes(k));
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-io-export="navdata"]')]);
R.exportNavMB = (fs.statSync(await dl2.path()).size / 1e6).toFixed(1);

// --- 再読込でデータが残るか
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('body[data-ready="true"]');
R.afterReload = await ev(() => ({ navgeo: document.querySelectorAll('#navgeo path').length }));

console.log(JSON.stringify(R, null, 1));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
