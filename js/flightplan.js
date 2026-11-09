/* ==== flightplan.js ==== フライトログの計算：区間ごとに上昇・巡航・降下を自動配分（手動上書き可）し、時間と燃料を積み上げる
 * 仮定：上昇は区間の始め（STPT 通過後すぐ）、降下は区間の終わり（次の STPT にその高度で着く）
 * 区間の巡航高度 = max(出発点の高度, 到着点の高度, 到着点の legAlt)。飛行場への区間は legAlt で上昇→巡航→降下になる
 * 単位：距離 nm、高度 ft、速度 kt、上昇率/降下率 ft/min、燃料流量 lb/hr、燃料 lb、時間 h */
import { distanceNm, bearingTrue, destination } from './geo.js';
import { toTas, windTriangle } from './aero.js';

export const PHASES = ['auto', 'climb', 'cruise', 'descent'];

function segment(phase, distNm, tas, gs, ff, altStart, altEnd) {
  const time = gs > 0 ? distNm / gs : Infinity;
  return { phase, dist: distNm, tas, gs, time, fuel: ff * time, altStart, altEnd };
}

function phaseGs(perf, altFt, course, wind, dev, speedOverride) {
  const tas = toTas(speedOverride || perf.speed, altFt, dev);
  return { tas, gs: windTriangle(course, tas, wind).gs };
}

/* ==== verticalPart ==== 高度変化の部分（altA → altB）。距離が足りない場合は呼び出し側で縮める */
function verticalPart(kind, cfg, altA, altB, course, wind, dev) {
  const perf = cfg[kind];
  const rate = kind === 'climb' ? perf.roc : perf.rod;
  const { tas, gs } = phaseGs(perf, (altA + altB) / 2, course, wind, dev);
  const dist = rate > 0 ? gs * (Math.abs(altB - altA) / rate / 60) : Infinity;
  return segment(kind, dist, tas, gs, perf.ff, altA, altB);
}

function scaleSeg(seg, k) {
  return { ...seg, dist: seg.dist * k, time: seg.time * k, fuel: seg.fuel * k, altEnd: null };
}

/* ==== autoSegments ==== 自動配分：区間の始めに巡航高度まで上昇、終わりに到着高度まで降下、間を巡航 */
function autoSegments(from, to, dist, course, cfg, w, dev, warn) {
  const top = Math.max(from.alt, to.alt, Number(to.legAlt) || 0);
  let climb = top > from.alt ? verticalPart('climb', cfg, from.alt, top, course, w, dev) : null;
  let desc = top > to.alt ? verticalPart('descent', cfg, top, to.alt, course, w, dev) : null;
  const need = (climb?.dist || 0) + (desc?.dist || 0);
  if (need > dist) {
    // 距離が足りない：上昇・降下を同じ比率で縮める（巡航高度に届かない）
    const k = dist / need;
    climb = climb && scaleSeg(climb, k);
    desc = desc && scaleSeg(desc, k);
    warn.push(climb && desc ? '区間が短く巡航高度に届きません' : climb ? 'この区間で上昇が終わりません' : 'この区間で降下が終わりません');
  }
  const rest = Math.max(0, dist - (climb?.dist || 0) - (desc?.dist || 0));
  const segs = [];
  if (climb) segs.push(climb);
  if (rest > 1e-9) {
    const { tas, gs } = phaseGs(cfg.cruise, top, course, w, dev, to.speed);
    segs.push(segment('cruise', rest, tas, gs, cfg.cruise.ff, top, top));
  }
  if (desc) segs.push(desc);
  const toc = climb && climb.altEnd !== null ? destination(from, course, climb.dist) : null;
  return { segs, toc, top };
}

/* ==== computeLeg ==== 1区間。to.phase で手動上書き（auto 以外なら区間全体をその飛行段階で計算） */
export function computeLeg(from, to, cfg, { wind, dev = 0 } = {}) {
  const dist = distanceNm(from, to);
  const course = bearingTrue(from, to);
  const w = to.wind || wind;
  const phase = to.phase && to.phase !== 'auto' ? to.phase : null;
  const warn = [];
  let segs;
  let toc = null;
  let top = Math.max(from.alt, to.alt);
  if (phase) {
    const perf = cfg[phase];
    const alt = phase === 'cruise' ? to.alt : (from.alt + to.alt) / 2;
    const { tas, gs } = phaseGs(perf, alt, course, w, dev, phase === 'cruise' ? to.speed : null);
    segs = [segment(phase, dist, tas, gs, perf.ff, from.alt, to.alt)];
  } else {
    ({ segs, toc, top } = autoSegments(from, to, dist, course, cfg, w, dev, warn));
  }
  const time = segs.reduce((s, x) => s + x.time, 0);
  const fuel = segs.reduce((s, x) => s + x.fuel, 0);
  const gs = time > 0 && Number.isFinite(time) ? dist / time : NaN;
  return { dist, course, segs, time, fuel, gs, toc, warn, cruiseAlt: top };
}

/* ==== activePoints ==== 飛ばした STPT（DIRECT で通らない点）を除いた並び */
function flownSequence(points) {
  return points.map((p, i) => ({ ...p, index: i })).filter((p) => !p.skipped);
}

/* ==== computeChain ==== 点の並びを順に計算し、燃料と時間を積み上げる */
function computeChain(points, cfg, opts, startFuel, origins = {}) {
  let fuel = startFuel;
  let time = 0;
  const legs = [];
  for (let i = 1; i < points.length; i += 1) {
    const to = points[i];
    const from = origins[to.index] ? { ...origins[to.index], alt: points[i - 1].alt } : points[i - 1];
    const leg = computeLeg(from, to, cfg, opts);
    fuel -= leg.fuel;
    time += leg.time;
    legs.push({ ...leg, fromIndex: points[i - 1].index, toIndex: to.index, name: to.name, alt: to.alt, cumTime: time, fuelRem: fuel, direct: !!origins[to.index] });
  }
  return { legs, fuelEnd: fuel, time };
}

/* ==== missingPerf ==== 計算に必要な性能値の欠け */
export function missingPerf(cfg) {
  if (!cfg) return ['機体・形態が未選択'];
  const need = [['climb', 'speed'], ['climb', 'roc'], ['climb', 'ff'], ['cruise', 'speed'], ['cruise', 'ff'], ['descent', 'speed'], ['descent', 'rod'], ['descent', 'ff']];
  return need.filter(([p, k]) => {
    const v = cfg[p]?.[k];
    return k === 'speed' ? !(v && Number.isFinite(v.value)) : !Number.isFinite(v);
  }).map(([p, k]) => `${p}.${k}`);
}

/* ==== computePlan ==== ルート全体：主経路（離陸→目的地）と代替経路（目的地→代替飛行場） */
export function computePlan(route, cfg) {
  const missing = missingPerf(cfg);
  if (missing.length || route.points.length < 2) return { ok: false, missing, legs: [], altLegs: [] };
  const opts = { wind: route.wind, dev: route.isaDev || 0 };
  const startFuel = Number.isFinite(route.startFuel) ? route.startFuel : cfg.fuelCap;
  const takeoffFuel = startFuel - (cfg.taxiTakeoff || 0);
  const seq = flownSequence(route.points);
  const origins = route.flight?.directOrigin ? { [route.activeIdx]: route.flight.directOrigin } : {};
  const main = computeChain(seq, cfg, opts, takeoffFuel, origins);
  const destArrival = main.fuelEnd;
  const result = {
    ok: true, missing: [], startFuel, takeoffFuel, legs: main.legs, time: main.time,
    toc: main.legs.filter((l) => l.toc).map((l) => ({ ...l.toc, toIndex: l.toIndex })),
    destArrival, destLanding: destArrival - (cfg.approachLanding || 0), reserve: cfg.reserve || 0, altLegs: [],
  };
  if (route.alternate?.length) {
    const dest = route.points.at(-1);
    const altSeq = [{ ...dest, index: -1 }, ...route.alternate.map((p, i) => ({ ...p, index: i }))];
    const alt = computeChain(altSeq, cfg, opts, destArrival - (cfg.missedApproach || 0));
    result.altLegs = alt.legs;
    result.altToc = alt.legs.filter((l) => l.toc).map((l) => ({ ...l.toc }));
    result.altLanding = alt.fuelEnd - (cfg.approachLanding || 0);
    result.altTime = alt.time;
  }
  return result;
}

/* ==== estimateFuel ==== EST FUEL：最後の燃料チェック（無ければ離陸時の燃料）から、現在の区間の計画燃料流量で減らす */
export function estimateFuel(plan, route, nowMs) {
  if (!plan.ok) return NaN;
  const flight = route.flight || {};
  if (!flight.takeoffAt) return plan.startFuel;
  const last = (flight.checks || []).at(-1);
  const base = last ? { fuel: last.fuel, at: last.at } : { fuel: plan.takeoffFuel, at: flight.takeoffAt };
  const leg = plan.legs.find((l) => l.toIndex === route.activeIdx) || plan.legs.at(-1);
  const ff = leg && leg.time > 0 ? leg.fuel / leg.time : 0;
  return base.fuel - ff * Math.max(0, (nowMs - base.at) / 3600000);
}

/* ==== remainingFromPosition ==== 現在位置から目的地までの計画燃料・時間（アクティブ区間は残り距離の割合で按分） */
export function remainingFromPosition(plan, route, own) {
  const idx = plan.legs.findIndex((l) => l.toIndex === route.activeIdx);
  if (idx < 0) return { fuel: 0, time: 0 };
  const leg = plan.legs[idx];
  const target = route.points[route.activeIdx];
  const frac = leg.dist > 0 ? Math.min(1, distanceNm(own, target) / leg.dist) : 0;
  const after = plan.legs.slice(idx + 1);
  return {
    fuel: leg.fuel * frac + after.reduce((s, l) => s + l.fuel, 0),
    time: leg.time * frac + after.reduce((s, l) => s + l.time, 0),
  };
}

/* ==== projectLanding ==== 推定燃料から、目的地・代替飛行場での接地燃料の見込み */
export function projectLanding(plan, route, own, estFuel, cfg) {
  if (!plan.ok || !Number.isFinite(estFuel) || !Number.isFinite(own?.lat)) return null;
  const rem = remainingFromPosition(plan, route, own);
  const destArrival = estFuel - rem.fuel;
  const out = { dest: destArrival - (cfg.approachLanding || 0) };
  if (plan.altLegs.length) {
    const altFuel = plan.altLegs.reduce((s, l) => s + l.fuel, 0);
    out.alt = destArrival - (cfg.missedApproach || 0) - altFuel - (cfg.approachLanding || 0);
  }
  return out;
}
