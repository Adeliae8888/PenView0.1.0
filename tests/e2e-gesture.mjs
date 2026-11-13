// 0.2.4 地図の操作の画面検証（タッチ）：node tests/e2e-gesture.mjs <URL> <スクリーンショット出力dir>
// ◎＝自機中央＋Track-up／方位アイコン＝North-up／それ以外はスワイプ・ピンチ・2本指の回転で自由に操作
// ・◎ 中のピンチ（1本目の指が少しずれてから2本目が触れる、1本指を残して動かす、も含む）→ ◎ は外れない
// ・◎ 中の 2本指の回転 → 中央固定は保ち、向きは手動（航跡が変わっても回らない）
// ・◎ 中のスワイプ → 中央固定が外れ、向きはその時のまま（◎ を押すまで Track-up に戻らない）
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';

const [url, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, hasTouch: true, isMobile: false });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const cdp = await context.newCDPSession(page);
const R = {};
const wait = (ms) => page.waitForTimeout(ms);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });

// 指の動き：from[] → to[] を steps 回に分けて（1本または2本）
async function drag(from, to, steps = 12) {
  await touch('touchStart', from);
  for (let i = 1; i <= steps; i += 1) {
    await touch('touchMove', from.map(([x, y], k) => [x + (to[k][0] - x) * i / steps, y + (to[k][1] - y) * i / steps]));
    await wait(16);
  }
  await touch('touchEnd', []);
  await wait(250);
}
const st = () => page.evaluate(async () => {
  const s = (await import('/js/state.js')).state;
  const tf = document.getElementById('geo').getAttribute('transform');
  const rot = Number(tf.match(/rotate\(([-\d.e]+)\)/)[1]);
  const svg = document.getElementById('map').getBoundingClientRect();
  return { follow: s.settings.follow, orient: s.settings.orient, rot: +(((rot % 360) + 360) % 360).toFixed(1), scale: +tf.match(/scale\(([\d.e-]+)/)[1] };
});
const ownScreen = () => page.evaluate(() => {
  const el = document.querySelector('#overlay .own, #overlay .ownship, #overlay [class*="own"]');
  const r = el?.getBoundingClientRect();
  return r ? [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] : null;
});
const setTrk = (trk) => page.evaluate(async (t) => { const g = await import('/js/gps.js'); g.updateSim({ trk: t }); }, trk);

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('body[data-ready="true"]');
await page.evaluate(async () => { const g = await import('/js/gps.js'); g.startSim({ lat: 36.3, lon: 140.5, trk: 90, gs: 1, alt: 10000 }); });
await page.click('#followBtn');
await wait(500);
R.start = await st();
R.ownAtStart = await ownScreen();

// 1) ◎ 中のピンチ：1本目が 12px ずれてから 2本目が触れる → 拡大
await touch('touchStart', [[500, 400]]);
await touch('touchMove', [[512, 400]]);
await wait(30);
await drag([[512, 400], [600, 400]], [[450, 400], [700, 400]], 10);
R.pinch = await st();
// 2) ピンチの後に1本指を残して動かす（指を離す順がずれる）。CDP の touchEnd に渡すのは「離した指」
const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
await tp('touchStart', [[500, 400, 0], [600, 400, 1]]);
await tp('touchMove', [[480, 400, 0], [620, 400, 1]]);
await tp('touchEnd', [[620, 400, 1]]);
for (let i = 1; i <= 6; i += 1) { await tp('touchMove', [[480 + i * 20, 400 + i * 10, 0]]); await wait(16); }
await tp('touchEnd', [[600, 460, 0]]);
await wait(250);
R.pinchThenOneFinger = await st();
R.ownAfterPinch = await ownScreen();

// 3) ◎ 中の 2本指の回転（約 40°）→ 中央固定は保ち、向きは手動。航跡が変わっても回らない
const c = [550, 400];
const ring = (deg) => [[c[0] - 100 * Math.cos(deg * Math.PI / 180), c[1] - 100 * Math.sin(deg * Math.PI / 180)], [c[0] + 100 * Math.cos(deg * Math.PI / 180), c[1] + 100 * Math.sin(deg * Math.PI / 180)]];
await touch('touchStart', ring(0));
for (let d = 4; d <= 40; d += 4) { await touch('touchMove', ring(d)); await wait(16); }
await touch('touchEnd', []);
await wait(300);
R.rotate = await st();
await setTrk(180);
await wait(500);
R.rotateThenTrk180 = await st();
R.ownAfterRotate = await ownScreen();

// 4) ◎ を押す → 自機中央＋Track-up（航跡 180°）
await page.click('#followBtn');
await wait(500);
R.followAgain = await st();

// 5) ◎ 中のスワイプ → 中央固定が外れ、向きは今のまま。航跡が変わっても回らない
await drag([[500, 500]], [[350, 380]], 12);
R.swipe = await st();
await setTrk(270);
await wait(500);
R.swipeThenTrk270 = await st();
// 6) ◎ を押すまで Track-up に戻らない → 押すと 270° が上
await page.click('#followBtn');
await wait(500);
R.followTrk270 = await st();
await page.screenshot({ path: `${outDir}/g1_trackup.png` });
// 7) 方位アイコン → North-up
await page.click('#compass');
await wait(500);
R.compass = await st();
// 8) North-up でのスワイプ → North-up のまま
await drag([[500, 500]], [[400, 450]], 8);
await setTrk(45);
await wait(400);
R.northSwipe = await st();

console.log(JSON.stringify(R, null, 1));
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'errors: none');
await browser.close();
