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
  assert.deepEqual(r.flight.directOrigin, { lat: 36.1, lon: 140.5, name: 'DIR' });
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
