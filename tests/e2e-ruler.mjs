// 0.2.7 ルーラーと B/E の画面検証：node tests/e2e-ruler.mjs <URL> <スクリーンショット出力dir>
// ・マウス：ボタン → 2回クリックで線と「磁方位 / 逆方位  距離」、NAVAID への吸い付き、端点ドラッグ（地図は動かない）、吸い付き 0 px、もう一度ボタンで消える
// ・TAC でも同じ／カーソル表示の上の行に B/E
// ・タッチ：2回タップで置く、端点を指でドラッグ、端点以外の 1本指は地図移動
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';

const [url, outDir] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const errors = [];
const R = {};
const LABEL_RE = /^\d{3}° \/ \d{3}° {2}[\d.]+nm$/;

async function openPage(opts) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, ...opts });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('body[data-ready="true"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  return { context, page };
}

const info = (page) => page.evaluate(async () => {
  const { rulerPoints, rulerOn } = await import('/js/ruler.js');
  const lbl = document.querySelector('#overlay .ruler-lbl text')?.textContent || null;
  const ends = [...document.querySelectorAll('#overlay .ruler-end')].map((g) => g.getAttribute('transform').match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map((v) => Math.round(Number(v))));
  return { on: rulerOn(), pts: rulerPoints(), lbl, ends, line: !!document.querySelector('#overlay .ruler-line:not(.preview)'), btn: document.getElementById('rulerBtn').classList.contains('active'), tf: document.getElementById('geo').getAttribute('transform'), infoOpen: document.getElementById('infoSheet').classList.contains('open'), cursor: document.getElementById('cursorReadout').innerText };
});

// 画面の中ほどにある NAVAID（他の点から離れたもの）の中心
const pickNavaid = (page) => page.evaluate(() => {
  const pts = [...document.querySelectorAll('#overlay .nav')].map((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const others = [...document.querySelectorAll('#overlay .apt, #overlay .nav, #overlay .nd-pt, #overlay .stpt')].map((el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const ok = pts.filter((p) => p.x > 250 && p.x < 900 && p.y > 150 && p.y < 650 && others.every((o) => Math.hypot(o.x - p.x, o.y - p.y) < 1 || Math.hypot(o.x - p.x, o.y - p.y) > 60));
  return ok[0] ? { x: Math.round(ok[0].x), y: Math.round(ok[0].y) } : null;
});

/* ---- マウス（NAV） ---- */
{
  const { context, page } = await openPage({});
  await page.click('#zoomIn'); await page.click('#zoomIn');
  await page.waitForTimeout(500);
  const nav = await pickNavaid(page);
  R.navaid = nav;
  await page.click('#rulerBtn');
  await page.mouse.click(300, 420);
  await page.mouse.move(nav.x - 60, nav.y - 30);
  await page.waitForTimeout(200);
  R.preview = await page.evaluate(() => !!document.querySelector('#overlay .ruler-line.preview'));
  await page.mouse.click(nav.x + 8, nav.y + 6);   // NAVAID の近く → 吸い付く
  await page.waitForTimeout(300);
  R.placed = await info(page);
  R.snapExact = await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    const { rulerPoints } = await import('/js/ruler.js');
    const b = rulerPoints().b;
    return state.data.navaids.some((n) => n.ident === b.name && Math.abs(n.p[1] - b.lat) < 1e-9 && Math.abs(n.p[0] - b.lon) < 1e-9);
  });
  await page.screenshot({ path: `${outDir}/r1_ruler_mouse.png` });
  const tf0 = R.placed.tf;
  // 端点 A をドラッグ（地図は動かない）
  await page.mouse.move(300, 420); await page.mouse.down(); await page.mouse.move(360, 520, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(300);
  R.dragged = await info(page);
  R.dragMapStill = R.dragged.tf === tf0;
  // 3回目のクリックは通常どおり地点情報
  await page.mouse.click(700, 250);
  await page.waitForTimeout(300);
  R.thirdClickInfo = (await info(page)).infoOpen;
  await page.click('[data-close-info]');
  // 吸い付き 0 px：NAVAID の近くへ B を動かしても吸い付かない
  await page.click('#settingsBtn'); await page.fill('#rulerSnap', '0'); await page.press('#rulerSnap', 'Tab'); await page.click('[data-close="settingsSheet"]');
  const b = R.dragged.ends[1];
  await page.mouse.move(b[0], b[1]); await page.mouse.down(); await page.mouse.move(nav.x + 50, nav.y + 40, { steps: 6 }); await page.mouse.move(nav.x + 8, nav.y + 6, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(300);
  R.noSnap = await info(page);
  // もう一度ボタン → 消える
  await page.click('#rulerBtn');
  await page.waitForTimeout(300);
  R.cleared = await info(page);
  // TAC でも同じ
  await page.click('[data-mode="TAC"]');
  await page.click('#rulerBtn');
  await page.mouse.click(400, 300); await page.mouse.click(600, 450);
  await page.waitForTimeout(300);
  R.tac = await info(page);
  await page.screenshot({ path: `${outDir}/r2_ruler_tac.png` });
  await context.close();
}

/* ---- タッチ ---- */
{
  const { context, page } = await openPage({ hasTouch: true, viewport: { width: 1100, height: 800 } });
  const cdp = await context.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await page.waitForTimeout(60); await touch('touchEnd', []); await page.waitForTimeout(250); };
  const drag = async (from, to, steps = 10) => {
    await touch('touchStart', [from]);
    for (let i = 1; i <= steps; i += 1) { await touch('touchMove', [[from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]]); await page.waitForTimeout(16); }
    await touch('touchEnd', []); await page.waitForTimeout(250);
  };
  await page.click('#rulerBtn');
  await tap(300, 300); await tap(700, 500);
  R.touchPlaced = await info(page);
  const tf0 = R.touchPlaced.tf;
  const e = R.touchPlaced.ends[1];
  await drag(e, [e[0] + 80, e[1] - 120]);
  R.touchDragged = await info(page);
  R.touchDragMapStill = R.touchDragged.tf === tf0;
  await drag([500, 650], [560, 600]);   // 端点から離れた 1本指 → 地図が動く
  R.touchPanMoved = (await info(page)).tf !== tf0;
  await page.screenshot({ path: `${outDir}/r3_ruler_touch.png` });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(R, (k, v) => (k === 'tf' ? undefined : v), 2));

const p = R.placed;
const checks = {
  'マウス：2点で線と読み': p.on && p.btn && p.line && LABEL_RE.test(p.lbl || ''),
  'マウス：仮の点線': R.preview,
  'マウス：NAVAID に吸い付く': R.snapExact && Math.hypot(p.ends[1][0] - R.navaid.x, p.ends[1][1] - R.navaid.y) <= 15,
  'マウス：置いている間は地点情報を開かない': !p.infoOpen,
  'マウス：端点ドラッグで読みが変わり地図は動かない': R.dragMapStill && R.dragged.lbl !== p.lbl && LABEL_RE.test(R.dragged.lbl || ''),
  '3回目のクリックは地点情報': R.thirdClickInfo,
  '吸い付き 0 px': !R.noSnap.pts.b?.name,
  'ボタンで消える': !R.cleared.on && !R.cleared.btn && !R.cleared.line && R.cleared.ends.length === 0,
  'TAC でも使える': R.tac.line && LABEL_RE.test(R.tac.lbl || ''),
  'B/E がカーソル表示の上の行': /^BULL \d{3}\/\d+\n/.test(R.tac.cursor),
  'タッチ：2回タップで置く': R.touchPlaced.line && LABEL_RE.test(R.touchPlaced.lbl || ''),
  'タッチ：端点ドラッグ（地図は動かない）': R.touchDragMapStill && R.touchDragged.lbl !== R.touchPlaced.lbl,
  'タッチ：端点以外の 1本指は地図移動': R.touchPanMoved,
};
Object.entries(checks).forEach(([k, v]) => console.log(`${v ? 'OK ' : 'NG '} ${k}`));
console.log('errors:', errors.length ? errors : 'none');
process.exitCode = Object.values(checks).every(Boolean) && !errors.length ? 0 : 1;
