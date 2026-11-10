// 画面検証：node tests/e2e.mjs <URL> <スクリーンショット出力dir>
// 起動 → 描画 → 模擬飛行 → タップ選択 → TAC 切替 → 設定の保存 → オフライン再読込
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';

const [url, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const result = {};
const ready = () => page.waitForSelector('body[data-ready="true"]', { timeout: 15000 });
const counts = () => page.evaluate(() => ({
  land: document.querySelector('#geo .land')?.getAttribute('d').length || 0,
  airspacePaths: document.querySelectorAll('#geo .as:not(.off)').length,
  airports: document.querySelectorAll('#overlay .apt').length,
  navaids: document.querySelectorAll('#overlay .nav').length,
  own: document.querySelectorAll('#overlay .own').length,
  panel: document.getElementById('dataPanel').innerText.replace(/\s+/g, ' ').trim(),
  gps: document.getElementById('gpsPill').textContent,
}));

await page.goto(url, { waitUntil: 'load' });
await ready();
await page.waitForTimeout(800);
result.start = await counts();
await page.screenshot({ path: `${outDir}/1_nav_start.png` });

// 模擬飛行（設定画面から）
await page.click('#settingsBtn');
await page.fill('#simTrk', '045');
await page.click('#simToggle');
await page.click('[data-close="settingsSheet"]');
await page.waitForTimeout(2500);
result.sim = await counts();
await page.click('#zoomIn'); await page.click('#zoomIn'); await page.click('#zoomIn');
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/2_nav_sim_zoom.png` });

// ◎ON（既定）：自機が画面中央・航跡が上
result.followHeadingUp = await page.evaluate(() => {
  const own = document.querySelector('#overlay .own').getAttribute('transform');
  const [x, y] = own.match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number);
  const rot = Number(own.match(/rotate\(([-\d.]+)\)/)[1]);
  return { ownX: Math.round(x), ownY: Math.round(y), symbolAngle: Math.round(rot), w: innerWidth, h: innerHeight };
});
await page.screenshot({ path: `${outDir}/3_follow_headingup.png` });

// グリッド（DDM）＋カーソル座標
await page.click('#gridBtn');
await page.mouse.move(300, 200);
await page.waitForTimeout(400);
result.gridDdm = await page.evaluate(() => ({
  lines: (document.querySelector('#overlay .grid-line')?.getAttribute('d').match(/M/g) || []).length,
  labels: [...document.querySelectorAll('#overlay .grid-lbl')].map((t) => t.textContent).slice(0, 6),
  cursor: document.getElementById('cursorReadout').textContent,
}));
await page.screenshot({ path: `${outDir}/3b_grid_ddm.png` });

// ドラッグで◎OFF → North-up に戻る
await page.mouse.move(600, 400); await page.mouse.down(); await page.mouse.move(500, 350, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(600);
result.afterDrag = await page.evaluate(() => ({
  follow: document.getElementById('followBtn').classList.contains('active'),
  compassNeedleDeg: Number((document.getElementById('compassNeedle').getAttribute('transform') || 'rotate(0)').match(/rotate\(([-\d.]+)/)[1]),
}));

// 地図をタップ → 地点情報
await page.mouse.click(420, 300);
await page.waitForTimeout(500);
result.info = await page.evaluate(() => document.getElementById('infoSheet').innerText.slice(0, 400));
await page.screenshot({ path: `${outDir}/4_info.png` });
await page.click('[data-act="bull"]');

// TAC
await page.click('[data-mode="TAC"]');
await page.click('#zoomOut'); await page.click('#zoomOut'); await page.click('#zoomOut');
await page.waitForTimeout(800);
result.tac = await counts();
await page.screenshot({ path: `${outDir}/5_tac.png` });

// 座標形式の切替（MGRS）→ UTM 方眼
await page.click('#coordBtn'); await page.click('#coordBtn'); await page.click('#coordBtn');
await page.click('#zoomIn'); await page.click('#zoomIn'); await page.click('#zoomIn'); await page.click('#zoomIn');
await page.mouse.move(400, 300);
await page.waitForTimeout(500);
result.coordBtn = await page.textContent('#coordBtn');
result.gridMgrs = await page.evaluate(() => ({
  labels: [...document.querySelectorAll('#overlay .grid-lbl')].map((t) => t.textContent).slice(0, 8),
  cursor: document.getElementById('cursorReadout').textContent,
}));
await page.screenshot({ path: `${outDir}/5b_grid_mgrs.png` });

// 設定の保存 → 再読込で残るか ＋ オフライン
await page.waitForTimeout(1500);
await page.reload({ waitUntil: 'load' }); await ready();
result.afterReload = await page.evaluate(() => ({ mode: document.body.className, coord: document.getElementById('coordBtn').textContent, sw: !!navigator.serviceWorker.controller }));
await context.setOffline(true);
try {
  await page.reload({ waitUntil: 'load', timeout: 15000 }); await ready();
  await page.waitForTimeout(500);
  result.offline = await counts();
} catch (e) { result.offline = `FAILED ${e.message.split('\n')[0]}`; }
await context.setOffline(false);

// スマホ縦
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await phone.goto(url, { waitUntil: 'load' }); await phone.waitForSelector('body[data-ready="true"]');
await phone.waitForTimeout(800);
await phone.screenshot({ path: `${outDir}/6_phone.png` });

console.log(JSON.stringify(result, null, 1));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
