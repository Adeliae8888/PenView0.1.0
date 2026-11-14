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

import { toTas, convertSpeed, windTriangle, pressureRatio } from '../js/aero.js';
import { computeLeg, computePlan, estimateFuel, projectLanding, missingPerf } from '../js/flightplan.js';

test('標準大気と速度換算（公表値と照合）', () => {
  near(pressureRatio(40000), 0.18509, 0.0002, 'δ FL400');
  near(toTas({ unit: 'IAS', value: 300 }, 0), 300, 0.01, '海面で IAS=TAS');
  near(toTas({ unit: 'MACH', value: 0.8 }, 30000), 471.5, 0.5, 'FL300 M0.80 TAS');
  assert.equal(convertSpeed({ unit: 'MACH', value: 0.8 }, 'IAS', 30000).value, 304);
  assert.equal(convertSpeed({ unit: 'IAS', value: 250 }, 'MACH', 35000).value, 0.74);
  near(toTas({ unit: 'IAS', value: 300 }, 10000), 345.4, 0.5, '10000ft 300KIAS');
  near(toTas({ unit: 'MACH', value: 0.8 }, 30000, 10), 471.5 * Math.sqrt((228.71 + 10) / 228.71), 0.5, 'ISA+10');
  const back = convertSpeed(convertSpeed({ unit: 'IAS', value: 350 }, 'MACH', 20000), 'IAS', 20000);
  near(back.value, 350, 2, 'IAS→MACH→IAS');
  assert.equal(windTriangle(90, 400, { dir: 270, spd: 50 }).gs, 450);
  near(windTriangle(90, 400, { dir: 90, spd: 50 }).gs, 350, 1e-9, '向かい風');
});

const CFG = {
  fuelCap: 10000, taxiTakeoff: 500, approachLanding: 600, missedApproach: 900, reserve: 1500,
  climb: { speed: { unit: 'IAS', value: 350 }, roc: 6000, ff: 9000 },
  cruise: { speed: { unit: 'MACH', value: 0.85 }, ff: 4000 },
  descent: { speed: { unit: 'IAS', value: 300 }, rod: 4000, ff: 1500 },
};
const DEP = { name: 'RJAH', lat: 36.1811, lon: 140.415, alt: 105 };

test('区間の計算：上昇→巡航、TOC、降下は区間の終わり、手動上書き', () => {
  const a = { name: 'A', ...destination(DEP, 90, 100), alt: 25000 };
  const leg = computeLeg(DEP, a, CFG);
  assert.deepEqual(leg.segs.map((s) => s.phase), ['climb', 'cruise']);
  near(leg.segs.reduce((s, x) => s + x.dist, 0), leg.dist, 1e-6, '区間距離の合計');
  near(distanceNm(DEP, leg.toc), leg.segs[0].dist, 0.01, 'TOC は上昇距離の位置');
  near(leg.segs[0].time * 60, (25000 - 105) / 6000, 1e-6, '上昇時間 = 高度差/上昇率');
  near(leg.fuel, leg.segs[0].time * 9000 + leg.segs[1].time * 4000, 1e-6, '燃料 = Σ FF×時間');
  const b = { name: 'B', ...destination(a, 90, 60), alt: 2000 };
  const d = computeLeg(a, b, CFG);
  assert.deepEqual(d.segs.map((s) => s.phase), ['cruise', 'descent']);
  assert.equal(d.toc, null);
  const forced = computeLeg(DEP, { ...a, phase: 'climb' }, CFG);
  assert.deepEqual(forced.segs.map((s) => s.phase), ['climb']);
  const shortClimb = computeLeg(DEP, { name: 'C', ...destination(DEP, 90, 10), alt: 25000 }, CFG);
  assert.equal(shortClimb.warn.length, 1, '10nm では上昇が終わらない警告');
  // 飛行場への1区間：区間高度まで上昇 → 巡航 → 到着標高まで降下
  const altnLeg = computeLeg({ ...DEP, alt: 30 }, { name: 'ALTN', ...destination(DEP, 0, 150), alt: 312, legAlt: 20000 }, CFG);
  assert.deepEqual(altnLeg.segs.map((s) => s.phase), ['climb', 'cruise', 'descent']);
  assert.equal(altnLeg.cruiseAlt, 20000);
  near(altnLeg.segs.reduce((s, x) => s + x.dist, 0), altnLeg.dist, 1e-6, '距離の合計');
  const tooShort = computeLeg({ ...DEP, alt: 30 }, { name: 'X', ...destination(DEP, 0, 20), alt: 312, legAlt: 20000 }, CFG);
  assert.equal(tooShort.warn[0], '区間が短く巡航高度に届きません');
  near(tooShort.segs.reduce((s, x) => s + x.dist, 0), tooShort.dist, 1e-6, '縮めても距離は合う');
  const head = computeLeg(DEP, { ...a, wind: { dir: 90, spd: 80 } }, CFG);
  assert.ok(head.time > leg.time && head.fuel > leg.fuel, '向かい風で時間・燃料が増える');
});

test('ルート全体：目的地・代替飛行場の接地燃料、EST FUEL、見込み', () => {
  const a = { name: 'A', ...destination(DEP, 90, 100), alt: 25000 };
  const dest = { name: 'DEST', ...destination(a, 180, 120), alt: 100 };
  const altn = { name: 'ALTN', ...destination(dest, 270, 80), alt: 50 };
  const route = { points: [DEP, a, dest], alternate: [{ ...altn, alt: 50 }], activeIdx: 1, flight: {} };
  assert.deepEqual(missingPerf(null), ['機体・形態が未選択']);
  const plan = computePlan(route, CFG);
  assert.ok(plan.ok);
  assert.equal(plan.takeoffFuel, 9500);
  const burned = plan.legs.reduce((s, l) => s + l.fuel, 0);
  near(plan.destArrival, 9500 - burned, 1e-6, '目的地到着燃料');
  near(plan.destLanding, plan.destArrival - 600, 1e-6, '目的地接地 = 到着 − 進入着陸');
  const altBurn = plan.altLegs.reduce((s, l) => s + l.fuel, 0);
  near(plan.altLanding, plan.destArrival - 900 - altBurn - 600, 1e-6, '代替接地 = 到着 − 復行 − 代替経路 − 進入着陸');
  assert.equal(plan.toc.length, 1);
  assert.equal(estimateFuel(plan, route, Date.now()), 10000, '離陸前は搭載燃料');
  const t0 = Date.parse('2026-11-09T00:00:00Z');
  route.flight = { takeoffAt: t0, checks: [{ idx: 1, fuel: 8000, at: t0 + 600000 }] };
  const leg1 = plan.legs[0];
  near(estimateFuel(plan, route, t0 + 600000 + 1800000), 8000 - (leg1.fuel / leg1.time) * 0.5, 1e-6, '最後のチェックから計画FFで減らす');
  const proj = projectLanding(plan, route, DEP, 8000, CFG);
  near(proj.dest, 8000 - burned - 600, 1e-6, '出発点にいれば全区間が残り');
});

import { setStoreErrorHandler } from '../js/store.js';
import { setPointSources, resolvePoint } from '../js/points.js';
import { newRoute, addPoint, executeDirect, autoSequence, stepActive, passedActive } from '../js/route.js';
setStoreErrorHandler(() => {});   // node には IndexedDB が無い

test('地点の定義：NAVAID のラジアルは局の公表偏差で換算', () => {
  setPointSources({ navaids: [{ ident: 'HUC', n: 'HYAKURI', t: 'VORTAC', dec: -7.0, p: [140.4, 36.2] }], airports: [{ icao: 'RJAH', n: 'HYAKURI', elev: 105, p: [140.415, 36.1811] }] });
  const r = resolvePoint('HUC 270/25');
  near(distanceNm({ lat: 36.2, lon: 140.4 }, r), 25, 0.01, 'DME 25');
  near(bearingTrue({ lat: 36.2, lon: 140.4 }, r), 263, 0.05, 'R270 は真方位 263（局偏差 7°W）');
  assert.equal(r.name, 'HUC270025');
  assert.equal(resolvePoint('rjah').elev, 105);
  assert.ok(resolvePoint('N3611.0 E14024.9'));
  assert.equal(resolvePoint('XXXX'), null);
});

test('ルート編集・自動送り・DIRECT', () => {
  const r = newRoute('T');
  const P = (name, lon) => ({ name, lat: 36, lon });
  addPoint(r, { ...P('DEP', 140), elev: 100 });
  addPoint(r, P('DST', 141.0));
  addPoint(r, P('A', 140.2));
  addPoint(r, P('B', 140.4));
  addPoint(r, P('C', 140.6));
  assert.deepEqual(r.points.map((p) => p.name), ['DEP', 'A', 'B', 'C', 'DST'], '目的地の手前に入る');
  assert.equal(r.points[0].alt, 100);
  assert.equal(r.activeIdx, 1);
  assert.ok(!passedActive(r, { lat: 36, lon: 140.05 }));
  assert.equal(autoSequence(r, { lat: 36.01, lon: 140.2 }), 1, '2nm 以内で送る');
  assert.equal(r.activeIdx, 2);
  assert.equal(autoSequence(r, { lat: 36.05, lon: 140.45 }), 2, '真横を過ぎたら送る');
  // ルート内の DIRECT：C を飛ばして DST へ
  executeDirect(r, { pointId: r.points[4].id }, { lat: 36.1, lon: 140.5 });
  assert.equal(r.activeIdx, 4);
  assert.ok(r.points[3].skipped && !r.points[4].skipped);
  assert.deepEqual(r.flight.directOrigin, { lat: 36.1, lon: 140.5, alt: null, name: 'DIR' });
  assert.ok(!stepActive(r, 1), '目的地より先へは進めない');
  stepActive(r, -1);
  assert.equal(r.activeIdx, 2, '飛ばした点は▲▼で避ける');
  // ルート外の DIRECT：アクティブの手前に挿入し、その後は元のルートへ
  executeDirect(r, { name: 'XRAY', lat: 36.3, lon: 140.3 }, { lat: 36.2, lon: 140.2 });
  assert.equal(r.points[2].name, 'XRAY');
  assert.equal(r.activeIdx, 2);
  assert.equal(r.points[3].name, 'B', '続きは元のルート');
});

import { crossTrackNm } from '../js/geo.js';
import { parseKml, parseAixm, parsePeriod, parseAltitude } from '../js/kml.js';
import { classify, effDate, isValidIn } from '../js/navdata.js';
import { setActiveIdx } from '../js/route.js';

test('横ずれ（XTK）：右が正', () => {
  const a = { lat: 36, lon: 140 };
  const b = { lat: 37, lon: 140 };     // 真北へのコース
  near(crossTrackNm(a, b, destination({ lat: 36.5, lon: 140 }, 90, 2)), 2, 0.01, '東に2nm＝右');
  near(crossTrackNm(a, b, destination({ lat: 36.5, lon: 140 }, 270, 3.5)), -3.5, 0.01, '西に3.5nm＝左');
});

test('KML・NOTAM・期間・高度の解析', () => {
  const kml = `<kml><Placemark><name/><description><![CDATA[<table><tr><td>DESIGNATOR</td><td>Y111</td></tr><tr><td>MEA</td><td>FL270</td></tr></table>]]></description>
    <MultiGeometry><LineString><coordinates> 139.1,35.1,0 139.2,35.2,0</coordinates></LineString></MultiGeometry></Placemark>
    <Placemark><name>MENOU</name><Point><coordinates>140.5,36.5,0</coordinates></Point></Placemark>
    <Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>1,1 2,1 2,2 1,1</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`;
  const f = parseKml(kml);
  assert.deepEqual(f.map((x) => x.kind), ['line', 'point', 'area']);
  assert.equal(f[0].attrs.DESIGNATOR, 'Y111');
  assert.deepEqual(f[1].p, [140.5, 36.5]);
  const aixm = `<message:AIXMBasicMessage><aixm:Airspace gml:id="x"><aixm:upperLimit uom="FT">9843</aixm:upperLimit><aixm:lowerLimit uom="FT">GND</aixm:lowerLimit>
    <gml:CircleByCenterPoint numArc="1"><gml:pos>35.5 139.5</gml:pos><gml:radius uom="m">1852</gml:radius></gml:CircleByCenterPoint></aixm:Airspace>
    <event:series>U</event:series><event:number>3146</event:number><event:year>2026</event:year>
    <event:effectiveStart>2026-11-10T00:00:00Z</event:effectiveStart><event:effectiveEnd>2026-11-11T00:00:00Z</event:effectiveEnd><event:text>TEST</event:text></message:AIXMBasicMessage>`;
  const n = parseAixm(aixm);
  assert.equal(n.length, 1);
  assert.equal(n[0].name, 'U3146/26');
  assert.equal(n[0].attrs.UPPER, '9843FT');
  near(distanceNm({ lat: 35.5, lon: 139.5 }, { lat: n[0].g[0][1], lon: n[0].g[0][0] }), 1, 0.001, '円の半径 1852m=1nm（緯度・経度の順を確認）');
  assert.equal(n[0].valid.to - n[0].valid.from, 86400000);
  assert.deepEqual(parsePeriod('From 1500UTC 30 SEP 2026 to 1500UTC 29 SEP 2027.'), { from: Date.UTC(2026, 8, 30, 15), to: Date.UTC(2027, 8, 29, 15) });
  assert.equal(parsePeriod('by NOTAM'), null);
  // 「Until」は終わり（以前は開始と誤読して有効な空域を隠していた）
  assert.deepEqual(parsePeriod('Until 1500UTC 31 MAR 2028.'), { from: null, to: Date.UTC(2028, 2, 31, 15) });
  assert.deepEqual(parsePeriod('Between 1 OCT 2026 and 30 NOV 2026'), { from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 10, 30, 23, 59, 59) });
  assert.deepEqual(parsePeriod('From 1500UTC 8 JUL 2026 until 1459UTC 17 MAR 2027. <BR>during hours between SR and SS, daily.'), { from: Date.UTC(2026, 6, 8, 15), to: Date.UTC(2027, 2, 17, 14, 59) });
  assert.deepEqual(parsePeriod('From 0000UTC 12 JUN 2025 until further notice.'), { from: Date.UTC(2025, 5, 12), to: null });
  assert.deepEqual(parsePeriod('From 1500UTC 28 OCT 2026 to 1500UTC 23 DEC 2026. <br> From 1500UTC 20 JAN 2027 to 1500UTC 17 MAR 2027.'), { from: Date.UTC(2026, 9, 28, 15), to: Date.UTC(2027, 2, 17, 15) });
  assert.equal(parsePeriod('3 days in mid OCT 2026'), null, '日付が特定できない＝期間不明（常に表示）');
  assert.equal(parseAltitude('FL230').ft, 23000);
  assert.equal(parseAltitude('UNL').ft, Infinity);
  assert.equal(parseAltitude('11000FT').ft, 11000);
});

test('NAV データの分類・有効日・有効期間', () => {
  assert.equal(classify('3_AIP(Shapefile, KML)/20261029/KML_20261029/JSDF_training_and_testing_areas_HIGH_EFF20261029.kml'), 'aip-jsdf');
  assert.equal(classify('3_AIP(Shapefile, KML)/x/Supersonic_flight_area_EFF20261029.kml'), 'aip-other-area');
  assert.equal(classify('4_SUP(KML)/RADIO NAVIGATION AIDS/26_132_Ashiya_TACAN_(AHT)/SUP_132_26_Unserviceability(NAVAID).kml'), 'sup-navaid');
  assert.equal(classify('4_SUP(KML)/Airspace/2026/SUP_200_26_Establishment of temporary training areas (Hyakuri).kml'), 'sup-airspace');
  assert.equal(classify('5_OBSTACLE DATA/1.AREA1/AREA1_20261029.kml/AREA1/AREA1_13_TOKYO_20261029.kml'), 'obs-area1');
  assert.equal(classify('x.xml', 'airspace'), 'notam-airspace');
  assert.equal(effDate('RNAV_ROUTES_EFF20261029.kml'), Date.UTC(2026, 9, 29));
  const it = { v: { from: 100, to: 200 } };
  assert.ok(isValidIn(it, { start: 150, end: 150 }));
  assert.ok(!isValidIn(it, { start: 201, end: 300 }), '期間後は出さない');
  assert.ok(isValidIn(it, { start: 0, end: 100 }), '時間帯の終わりに始まるものは出す');
  assert.ok(isValidIn({ v: null }, { start: 0, end: 1 }), '期間不明は常に出す');
});

test('選択行の前後に挿入・アクティブの直接指定', () => {
  const r = newRoute('INS');
  ['DEP', 'A', 'B', 'DST'].forEach((n, i) => addPoint(r, { name: n, lat: 36, lon: 140 + i * 0.1 }));
  const before = r.points.map((p) => p.name);
  addPoint(r, { name: 'X', lat: 36, lon: 140.05 }, 'points', 1);          // 1番目の前
  assert.deepEqual(r.points.map((p) => p.name), [before[0], 'X', ...before.slice(1)]);
  setActiveIdx(r, 3);
  assert.equal(r.activeIdx, 3);
  addPoint(r, { name: 'Y', lat: 36, lon: 140.07 }, 'points', 2);          // アクティブより前に入れてもアクティブの点は同じ
  assert.equal(r.points[r.activeIdx].name, before[2]);
});

import { navaidLabel } from '../js/map-render.js';
test('NAVAID ラベル：識別符号＋チャンネル／周波数（種類名なし）', () => {
  assert.equal(navaidLabel('HUC', 'VORTAC', '113.300', '80X'), 'HUC 80X 113.3');
  assert.equal(navaidLabel('NRE', 'VOR-DME', '117.900', '126X'), 'NRE 117.9');
  assert.equal(navaidLabel('GOT', 'TACAN', '115.300', '100X'), 'GOT 100X');
  assert.equal(navaidLabel('JET', 'TACAN(Compulsory)', '1201', '114X'), 'JET 114X');
  assert.equal(navaidLabel('SND', 'DME', '114.000', '87X'), 'SND 87X');
  assert.equal(navaidLabel('XX', 'VOR/DME', '112.15', '58Y'), 'XX 112.15');
});

import { intersectRays, rayCircle, turnRadiusNm, resolveFix, runwayStart, buildProcedure, gradientFtPerNm } from '../js/procgeo.js';
const ST = { HUC: { name: 'HUC', lat: 36.2, lon: 140.4, dec: -7 }, GOT: { name: 'GOT', lat: 36.75, lon: 140.35, dec: -7 }, MENOU: { name: 'MENOU', lat: 36.6, lon: 140.9 } };
const PCTX = {
  findPoint: (n) => ST[String(n).toUpperCase()] || null,
  resolvePoint: (t) => ST[t] || null,
  findAirport: (icao) => (icao === 'RJAH' ? { icao: 'RJAH', elev: 105, p: [140.415, 36.1811], rwy: [{ d: '03', hdg: 30, len: 2700 }, { d: '21', hdg: 210, len: 2700 }] } : null),
};

test('エディター：交点・ラジアル×DME・旋回半径・滑走路端', () => {
  const p = intersectRays({ lat: 0, lon: 0 }, 45, { lat: 0, lon: 1 }, 315);
  near(p.lat, 0.5, 0.001, '45°と315°の交点'); near(p.lon, 0.5, 0.001, '');
  assert.equal(intersectRays({ lat: 0, lon: 0 }, 0, { lat: 0, lon: 1 }, 0), null, '平行は交わらない（極での交点は範囲外）');
  const c = rayCircle(ST.HUC, 0, ST.HUC, 15);
  near(distanceNm(ST.HUC, c), 15, 0.001, 'DME 15');
  near(turnRadiusNm({ mode: 'radius', radius: 2 }), 2, 1e-9, '半径を直接');
  // 海面 250KIAS・バンク25°：250²/(68625×tan25°)=1.953nm
  near(turnRadiusNm({ mode: 'perf', kias: 250, alt: 0, bank: 25 }), 1.953, 0.005, 'KIAS・バンクから');
  near(gradientFtPerNm(3.3), 200.5, 0.5, '3.3% ≒ 200ft/nm');
  const x = resolveFix('HUC R-300 / GOT R-210', PCTX);
  near(bearingTrue(ST.HUC, x), 293, 0.05, 'HUC R-300 は真方位293（局偏差7°W）');
  near(bearingTrue(ST.GOT, x), 203, 0.05, 'GOT R-210 は真方位203');
  const d = resolveFix('HUC R-270 / GOT D40', PCTX);
  near(distanceNm(ST.GOT, d), 40, 0.01, 'ラジアル×DME');
  near(distanceNm(ST.HUC, resolveFix('HUC R-090 D12', PCTX)), 12, 0.001, 'ラジアル・DME');
  const s = runwayStart(PCTX.findAirport('RJAH'), { d: '03', hdg: 30, len: 2700 });
  near(distanceNm({ lat: 36.1811, lon: 140.415 }, s), 1350 / 1852, 0.001, '標点から長さの半分');
  assert.ok(s.estimated);
});

test('エディター：SID を組み立てる（針路で上昇→旋回→ラジアル→アーク→直線）', () => {
  const proc = {
    type: 'SID', ad: 'RJAH', rwy: '03', parts: [
      { id: 'a', type: 'heading', hdg: 37, end: { type: 'alt', alt: 2105, grad: 3.3 } },        // 2000ft 上昇 ≒ 10nm
      { id: 'b', type: 'radial', station: 'HUC', radial: 60, end: { type: 'dme', dist: 20 }, turn: { mode: 'radius', radius: 1.5 }, alt: { type: 'above', v: 5000 } },
      { id: 'c', type: 'arc', station: 'HUC', dme: 20, to: 90, dir: 'R' },
      { id: 'd', type: 'tf', to: 'MENOU', alt: { type: 'at', v: 13000 }, speed: 250 },
    ],
  };
  const r = buildProcedure(proc, PCTX);
  assert.deepEqual(r.warnings, ['RWY03 の滑走路端は推定値です（AIP AD 2.12 の座標で直せます）']);
  const leg1 = r.segments[0].pts;
  near(distanceNm(leg1[0], r.fixes[0]), 2000 / gradientFtPerNm(3.3), 0.2, '上昇勾配から距離（旋回で少し切り詰め）');
  assert.ok(r.segments.some((sg) => sg.turn), '旋回の弧がある');
  near(distanceNm(ST.HUC, r.fixes[1]), 20, 0.01, 'ラジアル D20');
  near(distanceNm(ST.HUC, r.fixes[2]), 20, 0.01, 'アークの終点も 20DME');
  near(bearingTrue(ST.HUC, r.fixes[2]), 83, 0.1, 'アークの終点は R-090（真方位083）');
  assert.equal(r.fixes[3].name, 'MENOU');
  const fixLabel = r.labels.find((l) => l.partId === 'd' && l.which === 'fix');
  assert.equal(fixLabel.alt.type, 'at');
  assert.match(r.labels.find((l) => l.partId === 'b' && l.which === 'course').text, /^HUC R-060 \d+\.\d$/);
});

/* ==== 0.2.3 手順のルート連携 ==== */
import { syncRouteProcs, missedPoints, fixAlt, procChoices, approachPhase } from '../js/route-proc.js';
import { executeMissed, executeDivert, resetFlight, pointTag } from '../js/route.js';

const SID_ARC = {
  id: 'sid1', type: 'SID', ad: 'RJAH', rwy: '03', parts: [
    { id: 'a', type: 'heading', hdg: 37, end: { type: 'alt', alt: 2105, grad: 3.3 } },
    { id: 'b', type: 'radial', station: 'HUC', radial: 60, end: { type: 'dme', dist: 20 }, alt: { type: 'above', v: 5000 } },
    { id: 'c', type: 'arc', station: 'HUC', dme: 20, to: 90, dir: 'R' },
    { id: 'd', type: 'tf', to: 'MENOU', alt: { type: 'at', v: 13000 } },
  ],
};
const APP1 = {
  id: 'app1', type: 'APP', ad: 'RJAH', name: 'ILS', startFix: 'GOT', startAlt: 6000,
  parts: [{ id: 'f1', type: 'tf', to: 'HUC R-330 D10', alt: { type: 'at', v: 3000 } }, { id: 'f2', type: 'tf', to: 'HUC R-330 D2', alt: { type: 'at', v: 800 } }],
  missed: [{ id: 'm1', type: 'radial', station: 'HUC', radial: 150, end: { type: 'dme', dist: 10 }, alt: { type: 'at', v: 4000 } }],
};
const PROCS = { sid1: SID_ARC, app1: APP1 };
const getProc = (id) => PROCS[id] || null;
const build = (p) => buildProcedure(p, PCTX);
const procRoute = () => ({
  points: [
    { id: 'dep', name: 'RJAH', lat: 36.1811, lon: 140.415, alt: 105 },
    { id: 'mid', name: 'MID', ...destination(ST.MENOU, 90, 60), alt: 20000 },
    { id: 'dst', name: 'RJAH', lat: 36.1811, lon: 140.415, alt: 105, legAlt: 20000 },
  ],
  alternate: [{ id: 'alt', name: 'ALTN', ...destination(DEP, 0, 120), alt: 50, legAlt: 20000 }],
  activeIdx: 1, cruiseAlt: 20000, procs: { SID: 'sid1', STAR: null, APP: 'app1' }, flight: { takeoffAt: null, checks: [], directOrigin: null },
});

test('手順の実距離：DME アークは弧の長さ（r×角度）、旋回なしの直線は大圏距離', () => {
  const r = buildProcedure(SID_ARC, PCTX);
  // 弧の長さ = 半径 × 中心角。中心角は HUC から見たアークの始点（前のフィックス）→ 終点（R-090＝真方位083）
  const sweep = (bearingTrue(ST.HUC, r.fixes[2]) - bearingTrue(ST.HUC, r.fixes[1]) + 360) % 360;
  near(r.fixes[2].pathNm, 20 * sweep * Math.PI / 180, 0.02, '20DME の弧の長さ');
  near(r.fixes[3].pathNm, distanceNm(r.fixes[2], r.fixes[3]), 1e-6, '直線');
  near(r.fixes[0].pathNm, distanceNm(r.start, r.fixes[0]), 1e-6, '最初は滑走路端から');
});

test('手順の高度：高度で終わるレグ・制限・SID の「以上」・制限なし', () => {
  assert.equal(fixAlt({ altEnd: 2105 }, 'SID', 105, 20000), 2105);
  assert.equal(fixAlt({ altC: { type: 'above', v: 5000 } }, 'SID', 2105, 20000), 20000, 'SID の以上は巡航まで上がってよい');
  assert.equal(fixAlt({ altC: { type: 'above', v: 5000 } }, 'STAR', 20000, 20000), 5000);
  assert.equal(fixAlt({ altC: { type: 'between', v: 9000, v2: 7000 } }, 'STAR', 20000, 20000), 7000, 'STAR の範囲は下の値');
  assert.equal(fixAlt({ altC: null }, 'SID', 105, 20000), 20000, 'SID の制限なし＝巡航高度');
  assert.equal(fixAlt({ altC: null }, 'APP', 6000, 20000), 6000, 'APP の制限なし＝前の点');
});

test('手順をルートに展開：並び・印・実距離・同期で利用者の入力とアクティブが残る', () => {
  const r = procRoute();
  assert.deepEqual(procChoices(r, 'SID', Object.values(PROCS)).map((p) => p.id), ['sid1']);
  assert.ok(syncRouteProcs(r, getProc, build));
  assert.deepEqual(r.points.map((p) => p.mark || p.id), ['dep', 'SID', 'SID', 'SID', 'SID', 'mid', 'APP', 'APP', 'APP', 'dst']);
  assert.equal(pointTag(r.points, 2), '2 SID');
  assert.equal(pointTag(r.points, 9), 'DST');
  near(r.points[1].pathNm, distanceNm(r.points[0], buildProcedure(SID_ARC, PCTX).start) + buildProcedure(SID_ARC, PCTX).fixes[0].pathNm, 1e-6, 'SID の最初は標点→滑走路端を足す');
  assert.deepEqual(r.points.slice(1, 5).map((p) => p.alt), [2105, 20000, 20000, 13000]);
  assert.equal(r.points[6].name, 'GOT');
  assert.equal(r.points[6].alt, 6000);
  // 実距離で計算される：アークの区間は直線距離より長い
  const plan = computePlan(r, CFG);
  const arcLeg = plan.legs.find((l) => l.toIndex === 3);
  assert.ok(arcLeg.dist > distanceNm(r.points[2], r.points[3]) + 0.05, 'アークは弦より長い');
  // 同期し直しても変わらない／利用者の TOS は残る／アクティブの点を保つ
  assert.equal(syncRouteProcs(r, getProc, build), false);
  r.points[4].tos = '0130';
  r.flight.takeoffAt = Date.now();   // 飛行中は航法中の点を保つ（離陸前は最初の STPT に戻す：下で確認）
  r.activeIdx = 5;
  SID_ARC.parts[3].alt = { type: 'at', v: 15000 };
  assert.ok(syncRouteProcs(r, getProc, build));
  assert.equal(r.points[4].alt, 15000);
  assert.equal(r.points[4].tos, '0130');
  assert.equal(r.points[r.activeIdx].id, 'mid');
  SID_ARC.parts[3].alt = { type: 'at', v: 13000 };
  // 手順を外すと点も消える
  r.procs.SID = null;
  syncRouteProcs(r, getProc, build);
  assert.deepEqual(r.points.map((p) => p.mark || p.id), ['dep', 'mid', 'APP', 'APP', 'APP', 'dst']);
  assert.equal(r.points[r.activeIdx].id, 'mid');
  r.flight.takeoffAt = null;
  r.activeIdx = 5;
  r.procs.SID = 'sid1';
  syncRouteProcs(r, getProc, build);
  assert.equal(r.activeIdx, 1, '離陸前は最初の STPT から');
});

test('MISSED APP → 復行の点、DIVERT は手動、リセットで計画に戻る', () => {
  const r = procRoute();
  syncRouteProcs(r, getProc, build);
  const before = structuredClone(r.points);
  r.activeIdx = r.points.length - 2;          // 最後の APP の点を飛行中
  assert.ok(approachPhase(r));
  const ma = missedPoints(r, getProc, build);
  assert.equal(ma.length, 1);
  assert.equal(ma[0].mark, 'MA');
  near(distanceNm(ST.HUC, ma[0]), 10, 0.01, '復行 HUC R-150 D10');
  assert.ok(executeMissed(r, ma));
  assert.equal(r.points[r.activeIdx].mark, 'MA');
  assert.equal(pointTag(r.points, r.points.length - 2), 'DST', '元の目的地は DST のまま');
  assert.ok(r.points.at(-2).skipped, '目的地には降りていない');
  assert.equal(r.alternate.length, 1, '代替経路へは自動で向けない');
  assert.equal(syncRouteProcs(r, getProc, build), false, '復行後は同期しない');
  const own = { lat: ma[0].lat, lon: ma[0].lon, alt: 4000 };
  assert.ok(executeDivert(r, own));
  assert.equal(r.points[r.activeIdx].name, 'ALTN');
  assert.equal(pointTag(r.points, r.activeIdx), 'ALT');
  assert.equal(r.alternate.length, 0);
  assert.deepEqual(r.flight.directOrigin, { lat: own.lat, lon: own.lon, alt: 4000, name: 'DIV' });
  resetFlight(r);
  assert.deepEqual(r.points.map((p) => p.id), before.map((p) => p.id), 'リセットで元の並び');
  assert.equal(r.alternate.length, 1);
  assert.ok(!r.points.some((p) => p.role || p.skipped));
  assert.equal(r.flight.missed, undefined);
});

test('同じ基地へ戻るルート：目的地の飛行場名は DEP の点ではなく飛行場として引く（標高を保つ）', () => {
  setPointSources({ airports: [{ icao: 'RJAH', n: 'HYAKURI', elev: 105, p: [140.415, 36.1811] }], navaids: [], routePoints: () => [{ name: 'RJAH', lat: 36.1811, lon: 140.415, alt: 105 }] });
  const p = resolvePoint('RJAH');
  assert.equal(p.elev, 105);
  setPointSources({ airports: [], navaids: [], routePoints: () => [] });
});

test('進入前の DIVERT：その位置から代替へ直行し、元の目的地は DST のまま', () => {
  const r = procRoute();
  syncRouteProcs(r, getProc, build);
  r.activeIdx = r.points.findIndex((p) => p.mark === 'APP');
  const own = { lat: 36.3, lon: 140.5 };
  assert.ok(executeDivert(r, own));
  assert.equal(pointTag(r.points, r.activeIdx), 'ALT');
  assert.equal(pointTag(r.points, r.points.length - 2), 'DST');
  assert.ok(r.points.filter((p) => p.mark === 'APP').every((p) => p.skipped));
});

test('旋回して針路：左旋回 HDG 002°（ティアドロップ）。弧は半径×角度、旋回後の直線は指定の針路でラジアルに会合', () => {
  const proc = { id: 't', type: 'SID', ad: 'RJAH', rwy: '21', parts: [
    { id: 'a', type: 'heading', hdg: 210, end: { type: 'alt', alt: 600, grad: 3.3 } },
    { id: 'b', type: 'turnhdg', dir: 'L', hdg: 2, turn: { mode: 'radius', radius: 2 }, end: { type: 'fix', to: 'HUC R-047' } }] };
  const ctx = { ...PCTX, findAirport: () => ({ icao: 'RJAH', elev: 105, p: [140.415, 36.1811], rwy: [{ d: '21', hdg: 210, len: 2700 }] }) };
  const r = buildProcedure(proc, ctx);
  assert.deepEqual(r.warnings.filter((w) => !w.includes('推定値')), []);
  const seg = r.segments.find((x) => x.partId === 'b');
  const fixA = r.fixes[0];
  const fixB = r.fixes[1];
  // 弧の終点（直線の始まり）は、弧の中心から半径 2nm
  const p1 = seg.pts.at(-2);
  const center = destination(fixA, bearingTrue(r.start, fixA) - 90, 2);   // 左旋回：中心は入ってくる進路の左 90°
  near(distanceNm(center, p1), 2, 0.01, '半径');
  // 弧の長さ = 2nm × 中心角（左回りに 210→354 真方位＝真方位差 216°）
  const inTrue = bearingTrue(r.start, fixA);
  const outTrue = bearingTrue(p1, fixB);
  const sweep = (inTrue - outTrue + 360) % 360;
  let arcLen = 0;
  for (let i = 1; i < seg.pts.length - 1; i += 1) arcLen += distanceNm(seg.pts[i - 1], seg.pts[i]);
  near(arcLen, 2 * sweep * Math.PI / 180, 0.02, '弧の長さ');
  // 会合点は HUC R047 上
  near(bearingTrue(ST.HUC, fixB), (47 + ST.HUC.dec + 360) % 360, 0.1, 'R047 上（交点の数値誤差 5m 程度）');
  near(fixB.pathNm, arcLen + distanceNm(p1, fixB), 0.01, '実距離＝弧＋直線');
});

/* ==== 0.2.5 AIP の PDF ==== */
import { unshift, toLines } from '../js/pdf-text.js';
import { parseAd2, findTables, waypointTable, procName, altConstraint, oppositeRwy, tablesToProcs, linkTransitions } from '../js/aip-parse.js';

const it = (s, x, y, w = s.length * 5, h = 8) => ({ s, x, y, w, h });
const pageOf = (items) => ({ items, lines: toLines(items) });

test('ずれた文字コードを戻す・名前・高度・反対側の滑走路', () => {
  assert.equal(unshift('&OLPE\x03WR\x03\x19\x13\x13)7\x03RQ\x03+\'*\x13\x15\x1b\xdb\x0f'), 'Climb to 600FT on HDG028°,');
  assert.equal(procName('TIARA TWO A DEPARTURE'), 'TIARA2A');
  assert.equal(procName('KURIS 1G ARRIVAL'), 'KURIS1G');
  assert.equal(procName('HITAKA ONE DEPARTURE'), 'HITAKA1');
  assert.equal(procName('PANSY TRANSITION'), 'PANSY');
  assert.deepEqual(altConstraint(['-7000', '+4000']), { type: 'between', v: 7000, v2: 4000 });
  assert.deepEqual(altConstraint(['+FL170']), { type: 'above', v: 17000 });
  assert.deepEqual(altConstraint(['9000']), { type: 'at', v: 9000 });
  assert.equal(oppositeRwy('03L'), '21R');
  assert.equal(oppositeRwy('16R'), '34L');
  assert.equal(oppositeRwy('05'), '23');
});

test('AD 2.12／2.13：L/R・THR・DER（反対側の末端がずれていればその分外へ）・真方位が無ければ両端から', () => {
  // 03L：THR A、21R：THR B（A の真北 2000m）。21R は着陸用の末端が 300m ずれている（TORA 2500・LDA 2200）
  const A = { lat: 36.0, lon: 140.0 };
  const B = destination(A, 0, 2000 / 1852);
  const dmsS = (v, deg) => { const d = Math.floor(v); const m = Math.floor((v - d) * 60); const s = ((v - d) * 60 - m) * 60; return `${String(d).padStart(deg, '0')}${String(m).padStart(2, '0')}${s.toFixed(2).padStart(5, '0')}`; };
  const items = [
    it('XXXX AD 2.12 RUNWAY PHYSICAL CHARACTERISTICS', 100, 10),
    it('03L', 60, 40), it('to be issued later', 110, 40), it('2500×45', 200, 40), it(`${dmsS(A.lat, 2)}N`, 330, 40), it('THR ELEV:107ft', 420, 40),
    it(`${dmsS(A.lon, 3)}E`, 330, 50),
    it('21R', 60, 70), it('2500×45', 200, 70), it(`${dmsS(B.lat, 2)}N`, 330, 70), it('THR ELEV:100ft', 420, 70),
    it(`${dmsS(B.lon, 3)}E`, 330, 80),
    it('XXXX AD 2.13 DECLARED DISTANCES', 100, 100),
    it('03L', 60, 120), it('2500', 150, 120), it('2500', 220, 120), it('2500', 290, 120), it('2500', 360, 120),
    it('21R', 60, 135), it('2500', 150, 135), it('2500', 220, 135), it('2500', 290, 135), it('2200', 360, 135),
    it('XXXX AD 2.14 APPROACH', 100, 160),
  ];
  const r = parseAd2([pageOf(items)]);
  assert.equal(r.icao, 'XXXX');
  const a = r.runways.find((x) => x.d === '03L');
  near(a.hdg, 0, 0.01, '真方位は両端から');
  assert.equal(a.elev, 107);
  near(distanceNm(A, a.der) * 1852, 2300, 1, 'DER＝反対側 THR から 300m 外');
  near(distanceNm(B, r.runways.find((x) => x.d === '21R').der) * 1852, 2000, 1, '21R の DER は 03L の THR（ずれなし）');
});

test('RNAV の表：通し番号の行、上下のコース・2段の高度、座標表、TRANSITION の親', () => {
  const head = [it('Serial', 110, 100), it('Path', 150, 100), it('Waypoint', 185, 100), it('Fly', 228, 100), it('Course', 250, 100), it('Magnetic', 290, 100),
    it('Distance', 328, 100), it('Turn', 370, 100), it('Altitude', 398, 100), it('Speed', 440, 100), it('Navigation', 505, 100), it('Number', 110, 110)];
  const row = (y, n, path, w, d, alt) => [it(n, 118, y), it(path, 155, y), it(w, 187, y), it('-', 230, y), it('-7.8', 294, y), it(d, 332, y), it('-', 374, y), it(alt, 402, y), it('-', 448, y), it('RNAV1', 512, y)];
  const items = [
    it('HITAKA ONE DEPARTURE', 110, 60), it('RWY21R', 110, 80), ...head,
    it('208', 257, 126), ...row(131, '001', 'VA', '-', '-', '+600'), it('(199.8)', 251, 136),
    ...row(154, '002', 'DF', 'H1R00', '-', '-3000'),
    it('067', 257, 172), it('-7000', 402, 172), ...row(177, '003', 'TF', 'LICEN', '8.5', ' '), it('(059.5)', 251, 182), it('+4000', 401, 182),
    it('Waypoint Coordinates', 286, 300), it('H1R00', 255, 320), it('361413.1N/1401954.3E', 328, 320), it('LICEN', 255, 340), it('361830.6N/1402857.4E', 328, 340),
    it('RWY21R : 4.1% climb gradient required up to 600FT.', 66, 400),
  ].filter((x) => x.s.trim());
  const pages = [pageOf(items)];
  const t = findTables(pages);
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].rwys, ['21R']);
  assert.deepEqual(t[0].legs.map((l) => [l.path, l.wpt, l.course]), [['VA', null, 208], ['DF', 'H1R00', null], ['TF', 'LICEN', 67]]);
  assert.deepEqual(t[0].legs[2].alt, { type: 'between', v: 7000, v2: 4000 });
  near(waypointTable(pages).LICEN.lat, 36 + 18 / 60 + 30.6 / 3600, 1e-9, '座標表');
  const procs = tablesToProcs(pages, { icao: 'RJAH', side: 'SID', source: { file: 'x.pdf' } });
  assert.equal(procs[0].id, 'aip-RJAH-SID-HITAKA1-21R');
  assert.deepEqual(procs[0].parts[0], { id: 'aip-RJAH-SID-HITAKA1-21R-001', name: '', alt: null, speed: null, turn: null, type: 'heading', hdg: 208, end: { type: 'alt', alt: 600, grad: 4.1 } });
  assert.deepEqual(Object.keys(procs[0].wpts), ['H1R00', 'LICEN']);
  // TRANSITION：SID の PDF のものは、最初のフィックスで終わる SID にだけつながる（同じフィックスから始まる STAR にはつながない）
  const tr = { id: 'tr', type: 'TRANSITION', ad: 'RJAH', side: 'SID', startFix: 'LICEN', parts: [{ type: 'tf', to: 'OGITU' }], parents: [] };
  const star = { id: 'st', type: 'STAR', ad: 'RJAH', startFix: 'OGITU', parts: [] };
  linkTransitions([tr], [...procs, star]);
  assert.deepEqual(tr.parents, ['aip-RJAH-SID-HITAKA1-21R']);
});

test('ルートの TRANSITION：選んだ SID に属するものだけ選べる・並び・SID を変えると外れる', () => {
  const sidA = { id: 'A', type: 'SID', ad: 'RJAH', rwy: '21', parts: [{ id: 'a1', type: 'tf', to: 'MENOU' }] };
  const sidB = { id: 'B', type: 'SID', ad: 'RJAH', rwy: '21', parts: [{ id: 'b1', type: 'tf', to: 'GOT' }] };
  const trA = { id: 'TA', type: 'TRANSITION', ad: 'RJAH', startFix: 'MENOU', parents: ['A'], parts: [{ id: 't1', type: 'tf', to: 'GOT' }] };
  const trB = { id: 'TB', type: 'TRANSITION', ad: 'RJAH', startFix: 'GOT', parents: ['B'], parts: [{ id: 't2', type: 'tf', to: 'MENOU' }] };
  const list = [sidA, sidB, trA, trB];
  const ctx = { ...PCTX, findAirport: () => ({ icao: 'RJAH', elev: 105, p: [140.415, 36.1811], rwy: [{ d: '21', hdg: 202, len: 2700 }] }) };
  const r = procRoute();
  r.procs = { SID: 'A', SID_TR: null, STAR_TR: null, STAR: null, APP: null };
  assert.deepEqual(procChoices(r, 'SID_TR', list).map((p) => p.id), ['TA']);
  r.procs.SID_TR = 'TA';
  syncRouteProcs(r, (id) => list.find((p) => p.id === id), (p) => buildProcedure(p, ctx));
  assert.deepEqual(r.points.map((p) => p.mark ? `${p.mark}:${p.name}` : p.id), ['dep', 'SID:MENOU', 'TR:GOT', 'mid', 'dst']);
  r.procs.SID = 'B';
  syncRouteProcs(r, (id) => list.find((p) => p.id === id), (p) => buildProcedure(p, ctx));
  assert.equal(r.procs.SID_TR, null, '別の SID に変えたら TRANSITION は外れる');
  assert.deepEqual(r.points.map((p) => p.mark ? `${p.mark}:${p.name}` : p.id), ['dep', 'SID:GOT', 'mid', 'dst']);
});

/* ==== 0.2.6 ==== */
test('DME アーク：終点を別の NAVAID のラジアルで（CW は東、CCW は西の交点）', () => {
  // 局 X は HUC の真東 40nm、偏差 0。X の R-270（真方位 270）は HUC を通る東西の線 → HUC 20DME の円と、真東・真西の 2 点で交わる
  const X = { name: 'XXX', ...destination(ST.HUC, 90, 40), dec: 0 };
  const ctx = { ...PCTX, findPoint: (n) => (String(n).toUpperCase() === 'XXX' ? X : PCTX.findPoint(n)) };
  const north = destination(ST.HUC, 0, 20);
  const arc = (dir) => buildProcedure({ id: 'a', type: 'STAR', ad: 'RJAH', startFix: 'N20', parts: [
    { id: 'p', type: 'arc', station: 'HUC', dme: 20, dir, endBy: 'other', xStation: 'XXX', xRadial: 270 }] }, { ...ctx, resolvePoint: () => north });
  // 大圏なので交点は真東・真西から少しずれる → 「円の上」「X から見て真方位 270 の上」「CW は東側・CCW は西側」「弧の長さ＝半径×中心角」で確かめる
  for (const [dir, east] of [['R', true], ['L', false]]) {
    const r = arc(dir);
    assert.deepEqual(r.warnings, []);
    const e = r.fixes[0];
    near(distanceNm(ST.HUC, e), 20, 0.01, '円の上');
    near(bearingTrue(X, e), 270, 0.05, 'X の R-270 の上');
    const b = bearingTrue(ST.HUC, e);
    assert.equal(b > 0 && b < 180, east, east ? 'CW は東側' : 'CCW は西側');
    const sweep = east ? b : 360 - b;
    near(e.pathNm, 20 * sweep * Math.PI / 180, 0.02, '弧の長さ');
  }
});

test('TRANSITION の開始フィックスに、SID で名前を付けたフィックス（GOPVU）を使える。登録済みの地点が先', () => {
  const sid = { id: 'g1', type: 'SID', ad: 'RJAH', rwy: '03', parts: [
    { id: 'a', type: 'radial', station: 'HUC', radial: 47, inbound: false, end: { type: 'dme', dist: 32.5 }, name: 'GOPVU' }] };
  const tr = { id: 'd1', type: 'TRANSITION', ad: 'RJAH', startFix: 'GOPVU', parents: ['g1'], parts: [{ id: 't', type: 'tf', to: 'GOT' }] };
  const ctx = { ...PCTX, relatedFixes: (p) => (p.type === 'TRANSITION' ? Object.fromEntries(buildProcedure(sid, PCTX).fixes.map((f) => [f.name, { lat: f.lat, lon: f.lon }])) : {}) };
  const r = buildProcedure(tr, ctx);
  assert.deepEqual(r.warnings, []);
  near(distanceNm(ST.HUC, r.start), 32.5, 0.01, 'GOPVU＝HUC D32.5');
  assert.equal(buildProcedure(tr, PCTX).warnings.length > 0, true, '関係する手順を引かなければ見つからない');
  // 同じ名前が登録済みの地点にあれば、そちらを使う
  const r2 = buildProcedure({ ...tr, startFix: 'GOT', parts: [{ id: 't', type: 'tf', to: 'MENOU' }] }, { ...ctx, relatedFixes: () => ({ GOT: { lat: 0, lon: 0 } }) });
  near(distanceNm(ST.GOT, r2.start), 0, 1e-9, '登録済みの GOT');
});

import { runwayClauses, textToProcs, narrativeBlocks } from '../js/aip-text.js';

const textPage = (lines) => { const items = lines.map(([s, x, y]) => it(s, x, y, s.length * 4)); return pageOf(items); };

test('従来型の文章：滑走路ごとに分け、「...」の共通の続きをつなぐ', () => {
  const c = runwayClauses('RWY03R/03L : Climb RWY HDG to 600FT, turn right,... RWY21R/21L : Climb RWY HDG to 600FT, turn left HDG 002°... ...to intercept and proceed via HUC R047 to GOPVU. Cross HUC R047/8.0DME at or below 8000FT, GOPVU at or below 10000FT.');
  assert.deepEqual(c.map((x) => x.rwys), [['03R', '03L'], ['21R', '21L']]);
  assert.match(c[0].text, /^Climb RWY HDG to 600FT, turn right, +to intercept and proceed via HUC R047 to GOPVU\. Cross/);
  assert.match(c[1].text, /turn left HDG 002° to intercept and proceed via HUC R047 to GOPVU/);
});

test('従来型の文章 → 手順：GOPVU ONE（RWY21）・DAIGO TRANSITION・CHOSHI TRANSITION・DAIGO 1 ARRIVAL', () => {
  const sid = textToProcs([textPage([
    ['GOPVU ONE DEPARTURE', 100, 130],
    ['RWY03R/03L : Climb RWY HDG to 600FT, turn right,...', 109, 145],
    ['RWY21R/21L : Climb RWY HDG to 600FT, turn left HDG 002°...', 109, 159],
    ['...to intercept and proceed via HUC R047 to GOPVU.', 194, 173],
    ['Cross HUC R047/8.0DME at or below 8000FT, GOPVU at or below 10000FT.', 194, 187],
    ['RWY03R/03L : 4.4% climb gradient required up to 2000FT, due to airspace', 139, 230],
    ['DAIGO TRANSITION', 109, 274],
    ['From over GOPVU, via GOT R117 to GOT TACAN.', 117, 289],
    ['Cross GOT R117/10.5DME at or below 10000FT.', 117, 304],
    ['CHOSHI TRANSITION', 108, 328],
    ['From over OGITU, turn right HDG 146° to intercept and proceed via CVT R011', 117, 344],
    ['to CVT VOR/DME.', 117, 357],
    ['Cross CVT R011/46.0DME at or below 13000FT, cross CVT R011/29.4DME at or above FL170.', 117, 370],
  ])], { icao: 'RJAH', side: 'SID', defaults: { grad: 3.3, kias: 250, bank: 25 } });
  const r21 = sid.find((p) => p.id === 'aip-RJAH-SID-GOPVU1-21R');
  assert.deepEqual(r21.warnings, []);
  assert.deepEqual(r21.parts.map((p) => [p.type, p.hdg ?? p.radial ?? p.to, p.end?.type, p.end?.alt ?? p.end?.dist ?? p.end?.to, p.alt?.type, p.alt?.v]), [
    ['heading', undefined, 'alt', 600, undefined, undefined],   // 針路は RWY HDG（null）
    ['turnhdg', 2, 'fix', 'HUC R-047', undefined, undefined],
    ['radial', 47, 'dme', 8, 'below', 8000],
    ['tf', 'GOPVU', undefined, undefined, 'below', 10000],
  ]);
  assert.equal(r21.parts[0].rwyHdg, true);
  assert.equal(r21.parts[1].dir, 'L');
  assert.equal(sid.find((p) => p.id === 'aip-RJAH-SID-GOPVU1-03R').parts[0].end.grad, 4.4, '上昇勾配の注記');
  const daigo = sid.find((p) => p.name === 'DAIGO');
  assert.equal(daigo.type, 'TRANSITION');
  assert.equal(daigo.startFix, 'GOPVU');
  assert.deepEqual(daigo.parts.map((p) => [p.type, p.end?.dist ?? p.to, p.alt?.v, p.inbound]), [['radial', 10.5, 10000, true], ['tf', 'GOT', undefined, undefined]]);
  const choshi = sid.find((p) => p.name === 'CHOSHI');
  // CVT（局）へ向かうラジアル：DME の制限は遠い順（46.0 → 29.4）に、局へ向かう向きで分ける
  assert.deepEqual(choshi.parts.map((p) => [p.type, p.end?.dist ?? p.end?.to ?? p.to, p.alt?.type, p.alt?.v, p.inbound]), [
    ['turnhdg', 'CVT R-011', undefined, undefined, undefined], ['radial', 46, 'below', 13000, true], ['radial', 29.4, 'above', 17000, true], ['tf', 'CVT', undefined, undefined, undefined]]);
  // 近い順に書かれていても同じ並び（遠い順）
  const choshi2 = textToProcs([textPage([['CHOSHI TRANSITION', 108, 328], ['From over OGITU, turn right HDG 146° to intercept and proceed via CVT R011 to CVT VOR/DME.', 117, 344],
    ['Cross CVT R011/29.4DME at or above FL170, cross CVT R011/46.0DME at or below 13000FT.', 117, 357]])], { icao: 'RJAH', side: 'SID' })[0];
  assert.deepEqual(choshi2.parts.map((p) => p.end?.dist ?? p.end?.to ?? p.to), ['CVT R-011', 46, 29.4, 'CVT']);
  linkTransitions(sid, []);
  assert.deepEqual(daigo.parents.sort(), ['aip-RJAH-SID-GOPVU1-03L', 'aip-RJAH-SID-GOPVU1-03R', 'aip-RJAH-SID-GOPVU1-21L', 'aip-RJAH-SID-GOPVU1-21R']);
  const star = textToProcs([textPage([
    ['DAIGO 1 ARRIVAL', 123, 155],
    ['From over GOT TACAN, proceed via GOT R132 to UGSIX, via HUC 26.0DME', 123, 170],
    ['clockwise ARC to TAIYO.', 123, 185],
    ['Cross TAIYO at or above 3000FT.', 123, 200],
  ])], { icao: 'RJAH', side: 'STAR' })[0];
  assert.equal(star.name, 'DAIGO1');
  assert.equal(star.startFix, 'GOT');
  assert.deepEqual(star.parts.map((p) => [p.type, p.to ?? p.xFix, p.dir, p.alt?.v]), [['tf', 'UGSIX', undefined, undefined], ['arc', 'TAIYO', 'R', 3000]]);
  // 読めない文は警告に残す
  const odd = textToProcs([textPage([['X ONE DEPARTURE', 100, 100], ['RWY03 : Climb RWY HDG to 600FT, fly the moon, direct to GOT.', 100, 115]])], { icao: 'RJAH' })[0];
  assert.deepEqual(odd.warnings, ['読めない文：「fly the moon」']);
  assert.deepEqual(odd.parts.map((p) => p.to ?? p.type), ['heading', 'GOT']);
});

test('ラジアルの向き「自動」：今の距離より近い DME へは局へ向かう、遠い DME へは外向き', () => {
  const from = destination(ST.HUC, 40 - 7, 21.9);              // HUC R040（磁）上の 21.9DME（偏差 -7）
  const run = (dist) => buildProcedure({ id: 'x', type: 'STAR', ad: 'RJAH', startFix: 'P', parts: [
    { id: 'r', type: 'radial', station: 'HUC', radial: 40, inbound: 'auto', end: { type: 'dme', dist } }] }, { ...PCTX, resolvePoint: () => from });
  const near19 = run(19).fixes[0];
  const far30 = run(30).fixes[0];
  near(distanceNm(ST.HUC, near19), 19, 0.01, '19DME');
  near(distanceNm(from, near19), 2.9, 0.02, '局へ向かって 2.9nm');
  near(distanceNm(from, far30), 8.1, 0.02, '外向きに 8.1nm');
});

test('ルーラー：磁方位・逆方位・距離の表記（0.2.7）', async () => {
  const { rulerMeasure, formatRuler, toggleRuler, rulerTap, rulerPoints, rulerOn } = await import('../js/ruler.js');
  const a = { lat: 36, lon: 140 };
  const b = destination(a, 45 + -8, 32.4);                    // 磁方位 045（偏差 8°W）に 32.4nm
  const m = rulerMeasure(a, b, -8);
  assert.equal(formatRuler(m), '045° / 225°  32.4nm');
  assert.equal(formatRuler({ brg: 350.2, rec: 170.2, nm: 123.6 }), '350° / 170°  124nm');
  assert.equal(toggleRuler(), true);
  assert.equal(rulerTap(a), true);
  assert.equal(rulerTap(b), true);
  assert.equal(rulerTap(a), false, '2点そろった後のタップはルーラーが受けない');
  assert.deepEqual(rulerPoints(), { a, b });
  assert.equal(toggleRuler(), false);
  assert.equal(rulerOn(), false);
  assert.deepEqual(rulerPoints(), { a: null, b: null });
});

test('待機（ホールド）：入航コースでフィックスに入るレーストラック、点は増えない（0.2.7）', async () => {
  const { buildProcedure } = await import('../js/procgeo.js');
  const F = { lat: 36.4361, lon: 140.3808 };   // NAKAH 付近
  const ctx = { findPoint: () => null, resolvePoint: (t) => (t === 'NAKAH' ? { name: 'NAKAH', ...F } : null), findAirport: () => null };
  const proc = { id: 'h', type: 'APP', ad: 'RJAH', startFix: 'NAKAH', parts: [], missed: [
    { id: 'm1', type: 'hold', inbound: 270, dir: 'R', min: 1, kias: 230, alt: { type: 'at', v: 4000 } }] };
  const r = buildProcedure(proc, ctx);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.fixes.length, 0, '待機は STPT を増やさない');
  const sg = r.segments[0];
  assert.ok(sg.hold && sg.dashed);
  const pts = sg.pts;
  near(distanceNm(pts[0], F), 0, 1e-6, '始まりはフィックス');
  near(distanceNm(pts.at(-1), F), 0, 1e-6, '終わりもフィックス（入航）');
  const P = pts.at(-2);                                          // 入航の始まり
  const inboundTrue = bearingTrue(P, F);
  near(((toMagnetic(inboundTrue, gsiVariation(F.lat, F.lon)) - 270 + 540) % 360) - 180, 0, 0.5, '入航コース 270°M');
  // 右旋回：出航側は入航の右（北側）。半径は 230KIAS・4000ft・25°
  const far = pts[61];
  assert.ok(far.lat > F.lat, '右旋回なら 270° 入航の北側に出る');
  const tas = 230 * (1 + 0.02 * 4);                              // 目安
  near(distanceNm(F, far), 2 * (tas ** 2) / (68625 * Math.tan(25 * Math.PI / 180)), 0.4, '出航側までの幅＝直径');
  assert.match(r.labels[0].text, /^HOLD 270° R 1MIN 4000$/);
});

test('進入チャート：名前・復行の文章・延長線上の点（0.2.7）', async () => {
  const { iacTitle, readMissed } = await import('../js/aip-iac.js');
  const { buildProcedure } = await import('../js/procgeo.js');
  assert.deepEqual(iacTitle('RJAH__IAC (RNP RWY21R)_20260514.pdf'), { name: 'RNP RWY21R', rwy: '21R', rnav: true });
  assert.deepEqual(iacTitle('RJCC__IAC (VOR A)＊_20260611.pdf'), { name: 'VOR A', rwy: '', rnav: false });
  const sum = (t) => readMissed(t, { id: 'm' }).parts.map((p) => (p.type === 'tf' ? `${p.to}${p.alt ? `${p.alt.type}${p.alt.v}` : ''}` : p.type === 'heading' ? `HDG${p.hdg}/${p.end.alt ?? `${p.end.station}${p.end.dist}`}` : p.type === 'turnhdg' ? `${p.dir}${p.hdg}>${p.end.to}` : p.type)).join(' ');
  assert.equal(sum('Climb to 5000FT, to O2L50, to O2L51, to O2L52, to IZUMI and hold.'), 'O2L50 O2L51 O2L52 IZUMI');
  assert.equal(sum('Turn left direct to H6L51, to GELMA at or below 1200FT, to LAVON, to OLVAL and hold at 2000FT.'), 'H6L51 GELMAbelow1200 LAVON OLVAL');
  assert.equal(sum('Direct to H8L51 at or below 1200FT, to H8L52, to OLVAL and hold at 2000FT.'), 'H8L51below1200 H8L52 OLVAL');
  assert.equal(sum('Climb to 600FT on HDG028°, turn left, climb to 4000FT via HUC R002 to NAKAH and hold.'), 'HDG28/600 NAKAH');
  assert.equal(sum('Turn right, climb on HDG 047° to intercept and proceed via HUC R002 to NAKAH and hold at 4000FT.'), 'R47>HUC R-002 NAKAH');
  assert.equal(sum('Climb on HDG 337° to TTE 3.0DME, turn right HDG 060° to intercept and proceed via TTE R015 to KASGA and hold at 4000FT.'), 'HDG337/TTE3 R60>TTE R-015 KASGA');
  assert.equal(sum('Turn left, climb via MKE R328 to 4000FT, proceed to MKE VOR/DME and hold.'), 'radial MKE');
  const h = readMissed('Direct to C1L50, turn right direct to MKE and hold at 4000FT.', { id: 'm' });
  assert.deepEqual(h.hold, { alt: 4000 });
  assert.deepEqual(h.warn, []);
  // 「RW21R D5.0」＝末端から延長線上に 5nm 手前、「RW21R」＝末端
  const thr = { lat: 36.1932, lon: 140.4185 };
  const ad = { icao: 'RJAH', p: [140.41, 36.18], rwy: [{ d: '21R', hdg: 199.8, thr }] };
  const ctx = { findPoint: () => null, resolvePoint: () => null, findAirport: () => ad };
  const r = buildProcedure({ id: 'a', type: 'APP', ad: 'RJAH', startFix: 'RW21R D5.0', parts: [{ id: 'p', type: 'tf', to: 'RW21R' }], missed: [] }, ctx);
  assert.deepEqual(r.warnings, []);
  near(distanceNm(r.start, thr), 5, 0.001, 'FAF は末端から 5nm');
  near(bearingTrue(r.start, thr), 199.8, 0.1, '延長線上（滑走路の向きで末端へ）');
  assert.equal(r.fixes[0].name, 'RW21R');
});

test('チャートから読み込んだ手順は確認するまで未確認（0.2.7）', async () => {
  const { isUnverified } = await import('../js/procedures.js');
  assert.equal(isUnverified({ id: 'aip-RJAH-APP-RNP-RWY21R', verified: false }), true, '取り込んだ直後');
  assert.equal(isUnverified({ id: 'aip-RJAH-SID-GOPVU1-03L' }), true, '0.2.6 以前に取り込んだもの（印なし）も未確認');
  assert.equal(isUnverified({ id: 'aip-RJAH-SID-GOPVU1-03L', verified: true }), false, '確認した');
  assert.equal(isUnverified({ id: 'pr-abc' }), false, '自分で作った手順');
  assert.equal(isUnverified({ id: 'pr-abc', verified: false }), true, '未確認の手順のコピー');
});
