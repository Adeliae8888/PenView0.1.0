// 0.2.2 手順エディターの画面検証：node tests/e2e-proc.mjs <URL> <スクリーンショット出力dir>
// 手順タブ → 新規 SID（RJAH RWY03）→ パーツ（針路で上昇・ラジアル・DME アーク・直線）→ 旋回 → 高度制限 → 地図描画
// → 注記ドラッグ → 長押し「手順エディターへ」→ 書き出し・読込 → 再読込で残る → 戻るボタン → TAC で隠れる
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
const tab = '#tab-proc';
const setField = async (pp, value) => {
  const el = page.locator(`${tab} [data-pp="${pp}"]`).first();
  const tag = await el.evaluate((e) => e.tagName);
  if (tag === 'SELECT') await el.selectOption(String(value)); else { await el.fill(String(value)); await el.dispatchEvent('change'); }
  await page.waitForTimeout(60);
};
const addPart = (type, list = 'parts') => page.click(`${tab} [data-add-part="${type}"][data-list="${list}"]`);

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('body[data-ready="true"]');
await page.evaluate(async () => { const m = await import('./js/state.js'); m.updateSettings({ follow: false, view: { lat: 36.35, lon: 140.5, scale: 4 } }); });
await page.waitForTimeout(1300);
await page.reload({ waitUntil: 'load' });   // 地図を百里へ（保存した表示位置で起動）
await page.waitForSelector('body[data-ready="true"]');

await page.click('#routeBtn');
await page.click('#dataSheet [data-tab="proc"]');
await page.click(`${tab} [data-pr="new"]`);
await setField('ad', 'RJAH');
await setField('name', 'TEST1');
await setField('rwy', '03');
await addPart('heading');
await setField('parts.0.hdg', 30);
await setField('parts.0.end.type', 'alt');
await setField('parts.0.end.alt', 1500);
await addPart('radial');
await setField('parts.1.station', 'HUC');
await setField('parts.1.radial', 60);
await setField('parts.1.end.type', 'dme');
await setField('parts.1.end.dist', 12);
await setField('parts.1.turn.mode', 'perf');
await setField('parts.1.turn.kias', 250);
await setField('parts.1.turn.alt', 3000);
await setField('parts.1.alt.type', 'above');
await setField('parts.1.alt.v', 5000);
await addPart('arc');
await setField('parts.2.station', 'HUC');
await setField('parts.2.dme', 12);
await setField('parts.2.to', 120);
await setField('parts.2.dir', 'R');
await addPart('tf');
await setField('parts.3.to', 'HUC R-120 / GOT R-150');
await setField('parts.3.name', 'TESTA');
await setField('parts.3.alt.type', 'between');
await setField('parts.3.alt.v', 9000);
await setField('parts.3.alt.v2', 7000);
await setField('parts.3.speed', 250);
R.cards = await page.locator(`${tab} .part-card`).count();
R.warnings = await page.locator(`${tab} ul.warn li`).allTextContents();
R.turnRadius = await page.locator(`${tab} .part-card`).nth(1).locator('.muted').textContent();
await page.screenshot({ path: `${outDir}/proc-editor.png` });

await page.click('#dataSheet [data-close="dataSheet"]');
await page.waitForTimeout(300);
R.map = await page.evaluate(() => ({
  lines: document.querySelectorAll('#overlay .proc-line').length,
  turns: document.querySelectorAll('#overlay .proc-line.turn').length,
  labels: [...document.querySelectorAll('#overlay .proc [data-lbl]')].map((t) => t.textContent),
  bars: document.querySelectorAll('#overlay .alt-bar').length,
  est: !!document.querySelector('#overlay .proc-start.est'),
}));
await page.screenshot({ path: `${outDir}/proc-map.png` });

// 注記ドラッグ
const lbl = page.locator('#overlay .proc-fix[data-lbl]').first();
const box = await lbl.boundingBox();
await page.mouse.move(box.x + 5, box.y + 5);
await page.mouse.down();
await page.mouse.move(box.x + 65, box.y + 45, { steps: 5 });
await page.mouse.up();
R.dragHit = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.getAttribute('data-lbl') || e?.tagName; }, [box.x + 5, box.y + 5]);
R.dragOffset = await page.evaluate(async () => { const m = await import('./js/procedures.js'); return m.procedures()[0].parts.map((p) => p.lbl || p.lbl2).filter(Boolean); });
await page.waitForTimeout(200);
const box2 = await page.locator("#overlay .proc-fix[data-lbl]").first().boundingBox();
R.labelMoved = box2 ? Math.round(box2.x - box.x) : null;
console.log(JSON.stringify(R, null, 1));

// 地図の長押し →「手順エディターへ」：最後に触ったフィックス欄に入る
await page.click('#routeBtn');
await page.locator(`${tab} [data-pp="parts.3.to"]`).focus();
await page.click('#dataSheet [data-close="dataSheet"]');
await page.mouse.click(300, 300, { button: 'right' });
await page.waitForSelector('#infoSheet.open');
const pick = page.locator('#infoSheet .pick-item').first();
if (await pick.count()) await pick.click();
await page.click('#infoSheet [data-act="editor"]');
R.afterEditor = await page.evaluate(async () => { const m = await import('./js/procedures.js'); return m.procedures()[0].parts[3].to; });
R.sheetBack = await page.evaluate(() => document.getElementById('dataSheet').classList.contains('open'));

// 戻るボタン（Android）でシートが閉じる
await page.goBack().catch(() => {});
await page.waitForTimeout(200);
R.backClosed = await page.evaluate(() => !document.getElementById('dataSheet').classList.contains('open'));
R.urlStill = page.url().startsWith(url);

// 書き出し → 消す → 読込
R.exported = await page.evaluate(async () => {
  const p = await import('./js/procedures.js');
  const io = await import('./js/ui-settings-data.js');
  const data = { type: 'penview-share', version: 2, procedures: structuredClone(p.procedures()) };
  const id = p.procedures()[0].id;
  p.removeProcedure(id);
  const before = p.procedures().length;
  const done = await io.applyImport(data, 'procedures');
  return { before, after: p.procedures().length, done };
});
await page.waitForTimeout(1500);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('body[data-ready="true"]');
await page.waitForTimeout(300);
R.afterReload = await page.evaluate(() => document.querySelectorAll('#overlay .proc-line').length);
await page.evaluate(async () => { const m = await import('./js/state.js'); m.switchMode('TAC'); });
await page.waitForTimeout(300);
R.tacHidden = await page.evaluate(() => document.querySelectorAll('#overlay .proc-line').length === 0);
R.wakeLockApi = await page.evaluate(() => 'wakeLock' in navigator);

console.log(JSON.stringify(R, null, 1));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
