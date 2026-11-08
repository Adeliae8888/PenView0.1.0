// 単体テスト：node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceNm, bearingTrue, destination, gsiVariation, toMagnetic, toTrue, formatBearing, pointInRing } from '../js/geo.js';
import { formatLatLon, toMgrs, fromMgrs, parseCoordinate, formatBe, latLonToUtm, utmToLatLon } from '../js/coords.js';
import { createProjection } from '../js/projection.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const TOKYO = { lat: 35.6895, lon: 139.6917 };
const OSAKA = { lat: 34.6937, lon: 135.5023 };

test('大圏距離と方位', () => {
  near(distanceNm(TOKYO, OSAKA) * 1.852, 396.4, 1.0, '東京-大阪 km');
  near(bearingTrue(TOKYO, OSAKA), 254.5, 1.0, '東京→大阪 真方位');
  const p = destination(TOKYO, 90, 60);
  near(distanceNm(TOKYO, p), 60, 0.01, 'destination 往復距離');
  near(bearingTrue({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 0, 1e-9, '真北');
  assert.equal(formatBearing(359.6), '000');
  assert.equal(formatBearing(5), '005');
});

test('磁気偏差（国土地理院2020.0年値 近似式）', () => {
  near(gsiVariation(35.2117, 135.8589), -7.92, 0.05, '計算サイト値 7.92°W');
  near(gsiVariation(35.6895, 139.6917), -7.67, 0.1, '東京 約7°40′W');
  assert.equal(gsiVariation(13.48, 144.79), null, 'グアムは範囲外');
  assert.equal(toMagnetic(90, -8), 98);
  assert.equal(toTrue(98, -8), 90);
});

test('DDM/DMS/DD 表示', () => {
  assert.equal(formatLatLon(35.6895, 139.6917, 'DDM'), 'N35°41.370′ E139°41.502′');
  assert.equal(formatLatLon(35.6895, 139.6917, 'DMS'), 'N35°41′22.2″ E139°41′30.1″');
  assert.equal(formatLatLon(-33.5, -70.25, 'DDM'), 'S33°30.000′ W070°15.000′');
  assert.equal(formatLatLon(35.99999999, 139, 'DDM'), 'N36°00.000′ E139°00.000′');
});

test('UTM 往復', () => {
  for (const [lat, lon] of [[35.6895, 139.6917], [26.21, 127.68], [43.06, 141.35], [-33.86, 151.21], [0.0001, 3]]) {
    const u = latLonToUtm(lat, lon);
    const back = utmToLatLon(u.zone, u.easting, u.northing, u.south);
    near(back.lat, lat, 1e-7, 'lat'); near(back.lon, lon, 1e-7, 'lon');
  }
});

test('MGRS 既知値と往復', () => {
  assert.equal(toMgrs(0, 0).replace(/\s/g, ''), '31NAA6602100000');
  // 独立実装（Krüger 級数）で照合した値
  assert.equal(toMgrs(38.8895, -77.0352).replace(/\s/g, ''), '18SUJ2348606483');
  assert.equal(toMgrs(35.6895, 139.6917).replace(/\s/g, ''), '54SUE8162250298');
  for (const [lat, lon] of [[35.6895, 139.6917], [26.21, 127.68], [43.06, 141.35], [24.0001, 123.1], [45.4, 141.7], [-33.86, 151.21]]) {
    const m = toMgrs(lat, lon);
    const back = fromMgrs(m);
    assert.ok(back, `解析失敗 ${m}`);
    near(distanceNm({ lat, lon }, back), 0, 0.002, `MGRS往復 ${m}`);   // 1m マスの中心＝誤差 1m 未満
  }
  const coarse = fromMgrs('54SUE');
  assert.ok(coarse && Math.abs(coarse.lat - 35.6) < 1, '100kmマスのみ');
});

test('座標入力の解析', () => {
  const cases = [
    'N35°41.370′ E139°41.502′', 'N3541.370 E13941.502', 'N 35 41.370 E 139 41.502',
    '35°41′22.2″N 139°41′30.1″E', '35 41 22.2N 139 41 30.1E', '35.6895 139.6917', '35.6895, 139.6917',
    toMgrs(35.6895, 139.6917),
  ];
  for (const c of cases) {
    const p = parseCoordinate(c);
    assert.ok(p, `解析失敗: ${c}`);
    near(distanceNm(p, TOKYO), 0, 0.01, c);
  }
  assert.equal(parseCoordinate('abc'), null);
  assert.equal(parseCoordinate('N95 E139'), null);
  const bull = { lat: 36.3474, lon: 141.3743 };
  const be = parseCoordinate('045/30', { bullseye: bull, variation: -7.5 });
  assert.equal(formatBe(be, bull, -7.5), '045/30');
});

test('多角形内判定', () => {
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  assert.ok(pointInRing(0.5, 0.5, sq));
  assert.ok(!pointInRing(1.5, 0.5, sq));
});

test('投影（ランベルト正角円錐）往復と北の向き', () => {
  const proj = createProjection();
  for (const p of [TOKYO, OSAKA, { lat: 26.2, lon: 127.7 }, { lat: 45.4, lon: 141.7 }]) {
    const xy = proj.forward(p.lat, p.lon);
    const back = proj.inverse(xy.x, xy.y);
    near(back.lat, p.lat, 1e-9, 'lat'); near(back.lon, p.lon, 1e-9, 'lon');
  }
  const o = proj.forward(36, 136);
  const n = proj.forward(36.1, 136);
  near(n.x - o.x, 0, 1e-9, '中央経線上で北は真上');
  assert.ok(n.y > o.y);
  const km = Math.hypot(proj.forward(35, 140).x - proj.forward(36, 140).x, proj.forward(35, 140).y - proj.forward(36, 140).y);
  // 標準緯線の間は縮尺係数 < 1（約0.985）
  near(km, 111.2 * 0.985, 1.0, '緯度1度 ≒ 109.5km');
});

import { pickStep, formatGridLabel, edgeLabelPoint, GRID_STEPS } from '../js/grid.js';
import { mgrsSquareLetters } from '../js/coords.js';

test('グリッド：刻みの選択と縁ラベル', () => {
  // 0.6 px/km → 1度 ≒ 67px → 2度刻み（134px）
  assert.equal(pickStep(GRID_STEPS.DD, 111.2 * 0.6), 2);
  // 20 px/km → 1分 ≒ 37px → DDM は 5分刻み（185px）より前の 2分刻み（74px）は 90px 未満なので 5分
  near(pickStep(GRID_STEPS.DDM, 111.2 * 20) * 60, 5, 1e-9, 'DDM 5分');
  assert.equal(pickStep(GRID_STEPS.MGRS, 0.6 / 1000), 100000);
  assert.equal(pickStep(GRID_STEPS.MGRS, 20 / 1000), 10000);
  assert.equal(formatGridLabel(36.5, true, 'DDM', 30 / 60), 'N36°30′');
  assert.equal(formatGridLabel(139.5 + 0.5 / 60, false, 'DDM', 0.5 / 60), 'E139°30.5′');
  assert.equal(formatGridLabel(36 + 15 / 3600, true, 'DMS', 15 / 3600), 'N36°00′15″');
  assert.equal(formatGridLabel(36, true, 'DMS', 1), 'N36°');
  assert.equal(formatGridLabel(139.25, false, 'DD', 0.05), '139.25°');
  const rect = { l: 0, t: 50, r: 100, b: 100 };
  assert.deepEqual(edgeLabelPoint([{ x: 40, y: 0 }, { x: 40, y: 200 }], rect, ['top', 'bottom', 'left', 'right']), { edge: 'top', x: 40, y: 50 });
  assert.deepEqual(edgeLabelPoint([{ x: -10, y: 70 }, { x: 200, y: 70 }], rect, ['left', 'right', 'top', 'bottom']), { edge: 'left', x: 0, y: 70 });
  assert.equal(edgeLabelPoint([{ x: 300, y: 0 }, { x: 300, y: 200 }], rect, ['top']), null);
  assert.deepEqual(mgrsSquareLetters(54, 381622, 3950298), { col: 'U', row: 'E' });
});
