// 0.2.3 手順のルート連携の画面検証：node tests/e2e-route-proc.mjs <URL> <スクリーンショット出力dir>
// 機体・手順（RJAH SID＋APP〔復行つき〕）を用意 → ルート RJAH → HUC 360/40 → RJAH（代替 RJSK）で SID・APP を選ぶ
// → 経路の並びと印・LOG・燃料（アークは実距離）→ 地図の重畳（手順レイヤー OFF でも出る・航法中の区間の強調・直線なし）
// → 模擬飛行で MISSED APP → 復行の点・DIV 燃料 → 代替経路へ勝手に向けない → DIVERT → ALT → リセット → 再読込 → TAC で手順なし
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
const ready = () => page.waitForSelector('body[data-ready="true"]');
const panel = () => page.evaluate(() => document.getElementById('dataPanel').innerText.replace(/\s+/g, ' ').trim());

await page.goto(url, { waitUntil: 'load' });
await ready();
await page.evaluate(async () => { const m = await import('/js/state.js'); m.updateSettings({ follow: false, view: { lat: 36.35, lon: 140.45, scale: 6 } }); });
await page.waitForTimeout(1300);
await page.reload({ waitUntil: 'load' });
await ready();

// --- 機体と手順（作図は 0.2.2 のエディターで確認済みなので API で用意）
await mod('/js/aircraft.js', `const ac = m.addAircraft('F-16C'); Object.assign(ac.configs[0], { name: 'CL', fuelCap: 10000, taxiTakeoff: 500, approachLanding: 600, missedApproach: 900, reserve: 1500,
  climb: { speed: { unit: 'IAS', value: 350 }, roc: 6000, ff: 9000 }, cruise: { speed: { unit: 'MACH', value: 0.85 }, ff: 4000 }, descent: { speed: { unit: 'IAS', value: 300 }, rod: 4000, ff: 1500 } }); m.saveAircraft();`);
await mod('/js/procedures.js', `
  const sid = m.newProcedure('RJAH', 'SID'); Object.assign(sid, { name: 'ARC1', rwy: '03', parts: [
    { id: 'a', type: 'heading', hdg: 37, end: { type: 'alt', alt: 2105, grad: 3.3 }, name: '', alt: null, speed: null, turn: null },
    { id: 'b', type: 'radial', station: 'HUC', radial: 60, inbound: false, end: { type: 'dme', dist: 20 }, name: 'SIDB', alt: { type: 'above', v: 5000 }, speed: null, turn: { mode: 'radius', radius: 1.5 } },
    { id: 'c', type: 'arc', station: 'HUC', dme: 20, to: 330, dir: 'L', name: 'SIDC', alt: null, speed: null, turn: null } ] });
  const app = m.newProcedure('RJAH', 'APP'); Object.assign(app, { name: 'TAC03', startFix: 'HUC R-210 D15', startAlt: 6000, parts: [
    { id: 'f1', type: 'tf', to: 'HUC R-210 D8', name: 'FAF', alt: { type: 'at', v: 2500 }, speed: null, turn: null },
    { id: 'f2', type: 'tf', to: 'HUC R-210 D1', name: 'MAPT', alt: { type: 'at', v: 600 }, speed: null, turn: null } ],
    missed: [{ id: 'm1', type: 'radial', station: 'HUC', radial: 30, inbound: false, end: { type: 'dme', dist: 10 }, name: 'MAHF', alt: { type: 'at', v: 4000 }, speed: null, turn: null }] });
  m.saveProcedures(); window.__proc = { sid: sid.id, app: app.id };`);

// --- ルート：RJAH → HUC 360/40 → RJAH、代替 RJSK
await page.click('#routeBtn');
await page.click('[data-tab="route"]');
await page.click('[data-ract="new"]');
await page.selectOption('[data-rf="configRef"]', { index: 1 });
const add = async (list, text, alt) => {
  await page.fill(`[data-add-input="${list}"]`, text);
  if (alt !== undefined) await page.fill(`[data-add-alt="${list}"]`, String(alt));
  await page.click(`[data-add="${list}"]`);
};
await add('points', 'RJAH');
await add('points', 'RJAH');
await add('points', 'HUC 360/40', 20000);
await add('alternate', 'RJSK');
R.pickers = await page.$$eval('#tab-route .proc-pick select', (s) => s.map((x) => `${x.dataset.rf}:${[...x.options].map((o) => o.textContent).join('/')}`));
const ids = await page.evaluate(() => window.__proc);
await page.selectOption('[data-rf="proc:SID"]', ids.sid);
await page.selectOption('[data-rf="proc:APP"]', ids.app);
const rows = () => page.$$eval('#tab-route table.pts:first-of-type tr:not(.pt-detail)', (t) => t.map((x) => `${x.cells[0].textContent} ${x.cells[1].textContent}`));
R.rows = await rows();
await add('points', 'GOT', 20000);      // 手順の外に足すと、APP の手前（経路の最後）に入る
R.rowsAfterAdd = await rows();
await page.screenshot({ path: `${outDir}/rp1_route.png` });

// --- LOG と燃料（アークは弦より長い）
await page.click('[data-tab="log"]');
R.logNames = await page.$$eval('table.log tr td:first-child', (t) => t.map((x) => x.textContent).filter((x) => !x.startsWith('代替')));
R.arc = await mod('/js/nav.js', `const n = m.navContext(); const r = n.route; const i = r.points.findIndex(p => p.name === 'SIDC');
  const leg = n.plan.legs.find(l => l.toIndex === i); const p0 = r.points[i - 1], p1 = r.points[i];
  const R = 3440.065, f = Math.PI / 180; const chord = 2 * R * Math.asin(Math.sqrt(Math.sin((p1.lat - p0.lat) * f / 2) ** 2 + Math.cos(p0.lat * f) * Math.cos(p1.lat * f) * Math.sin((p1.lon - p0.lon) * f / 2) ** 2));
  return { path: +leg.dist.toFixed(2), chord: +chord.toFixed(2), destLanding: Math.round(n.plan.destLanding) };`);
await page.screenshot({ path: `${outDir}/rp2_log.png` });
await page.click('[data-close="dataSheet"]');

// --- 地図：手順レイヤーと手順の表示を OFF にしても、ルートで選んだ手順は描く
await mod('/js/procedures.js', `m.procedures().forEach(p => { p.visible = false; }); m.saveProcedures();`);
await mod('/js/state.js', `m.emit('proc')`);
await page.waitForTimeout(300);
const mapCounts = () => page.evaluate(() => ({
  procGroups: document.querySelectorAll('#overlay .proc').length,
  procLines: document.querySelectorAll('#overlay .proc-line').length,
  missedDashed: document.querySelectorAll('#overlay .proc-line.missed').length,
  activeProc: document.querySelectorAll('#overlay .proc-line.active').length,
  routeActive: document.querySelectorAll('#overlay .route-active').length,
  routeLineMoves: (document.querySelector('#overlay .route-line')?.getAttribute('d').match(/M/g) || []).length,
  labels: [...document.querySelectorAll('#overlay .stpt text')].map((t) => t.textContent),
}));
R.mapPlan = await mapCounts();
await page.screenshot({ path: `${outDir}/rp3_map_plan.png` });

// --- 模擬飛行：SID の 2 番目（SIDB）を飛行中 → 強調はその区間
await mod('/js/route.js', `const r = m.activeRoute(); r.flight.takeoffAt = Date.now(); m.setActiveIdx(r, 2); m.saveRoutes();`);
await page.evaluate(async () => { const g = await import('/js/gps.js'); g.startSim({ lat: 36.25, lon: 140.45, trk: 40, gs: 300, alt: 4000 }); });
await page.waitForTimeout(500);
R.mapSid = await mapCounts();
R.panelSid = await panel();

// --- 進入：最後の APP の点（MAPT）へ。MISSED APP が出る
await mod('/js/route.js', `const r = m.activeRoute(); m.setActiveIdx(r, r.points.findIndex(p => p.name === 'MAPT')); m.saveRoutes();`);
await page.evaluate(async () => { const g = await import('/js/gps.js'); g.updateSim({ lat: 36.12, lon: 140.36, trk: 30, gs: 160, alt: 1500 }); });
await page.waitForTimeout(600);
R.panelApp = await panel();
R.missedBtn = await page.$$eval('[data-nav="missed"]', (b) => b.length);
R.divertNear = await page.$$eval('.dp-actions [data-nav="divert"]', (b) => b.length);   // 目的飛行場から 30NM 以内
R.phaseInRow = await page.$$eval('.dp-actions', (rows) => rows.length + ':' + [...rows[0].querySelectorAll('button')].map((b) => b.textContent).join(','));
await page.screenshot({ path: `${outDir}/rp4_app.png` });
await page.click('[data-nav="missed"]');
await page.waitForTimeout(400);
R.afterMissed = await mod('/js/route.js', `const r = m.activeRoute(); return { active: m.pointTag(r.points, r.activeIdx) + ' ' + r.points[r.activeIdx].name, alt: r.alternate.length, last: r.points.at(-1).name }`);
R.panelMissed = await panel();
R.divertBtn = await page.$$eval('[data-nav="divert"]', (b) => b.length);
R.mapMissed = await mapCounts();
await page.screenshot({ path: `${outDir}/rp5_missed.png` });
// 復行の終点まで飛んでも、代替経路へは勝手に向けない
await mod('/js/route.js', `const r = m.activeRoute(); window.__ma = r.points.at(-1);`);
await page.evaluate(async () => { const g = await import('/js/gps.js'); g.updateSim({ lat: window.__ma.lat, lon: window.__ma.lon, gs: 250, alt: 4000 }); });
await page.waitForTimeout(600);
R.atMahf = await mod('/js/route.js', `const r = m.activeRoute(); return { active: m.pointTag(r.points, r.activeIdx) + ' ' + r.points[r.activeIdx].name, alt: r.alternate.length }`);
R.divBeforeDivert = await page.$$eval('.dp-fuel .divert', (d) => d.length);   // DIV は DIVERT を押した後だけ
// 他所から戻る：30NM より遠いと DIVERT は出ない（復行後は出る）
R.divertAfterMissed = await page.$$eval('[data-nav="divert"]', (b) => b.length);

// --- DIVERT → 行き先は ALT、DIV＝現在位置から RJSK まで（区間計算）＋進入着陸 600＋予備 1500
await page.click('[data-nav="divert"]');
await page.waitForTimeout(600);
R.divCheck = await page.evaluate(async () => {
  const [fp, nav, st] = await Promise.all([import('/js/flightplan.js'), import('/js/nav.js'), import('/js/state.js')]);
  const n = nav.navContext(); const own = st.state.own;
  const to = n.route.points.at(-1);
  const leg = fp.computeLeg({ ...own, alt: own.alt }, to, n.cfg, { wind: n.route.wind, dev: 0, direct: true });
  const pl = n.plan.legs.find((l) => l.toIndex === n.route.activeIdx);
  return { shown: document.querySelector('.dp-fuel .divert')?.textContent, expected: Math.round(leg.fuel + 600 + 1500), alerts: document.querySelectorAll('.alert-flash, .flash').length,
    dbg: { planLeg: [pl.dist, pl.fuel, pl.from?.alt], myLeg: [leg.dist, leg.fuel], origin: n.route.flight.directOrigin, own: [own.lat, own.lon, own.alt] } };
});
R.afterDivert = await mod('/js/route.js', `const r = m.activeRoute(); return { active: m.pointTag(r.points, r.activeIdx) + ' ' + r.points[r.activeIdx].name, dir: r.flight.directOrigin?.name }`);
R.panelDivert = await panel();
await page.screenshot({ path: `${outDir}/rp6_divert.png` });

// --- リセットで計画に戻る → 再読込で残る
await page.evaluate(async () => { const g = await import('/js/gps.js'); g.stopSim(); });
await mod('/js/route.js', `m.resetFlight(m.activeRoute());`);
await mod('/js/state.js', `m.emit('route')`);
R.afterReset = await mod('/js/route.js', `const r = m.activeRoute(); return r.points.map((p, i) => m.pointTag(r.points, i) + ' ' + p.name).join(' | ')`);
await page.waitForTimeout(1200);
await page.reload({ waitUntil: 'load' });
await ready();
await page.waitForTimeout(500);
R.afterReload = await mod('/js/route.js', `const r = m.activeRoute(); return { n: r.points.length, procs: r.procs, alt: r.alternate.length }`);
R.mapReload = await mapCounts();

// --- TAC：手順は描かず、ルートは直線で全区間
await mod('/js/state.js', `m.switchMode('TAC')`);
await page.waitForTimeout(400);
R.mode = await mod('/js/state.js', `return m.state.settings.mode`);
R.mapTac = await mapCounts();
await page.screenshot({ path: `${outDir}/rp7_tac.png` });

console.log(JSON.stringify(R, null, 1));
console.log(errors.length ? `errors:\n${errors.join('\n')}` : 'errors: none');
await browser.close();
