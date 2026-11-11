/* ==== nav.js ==== 飛行中の航法：計画のキャッシュ、離陸検出、自動送り、ETA/TOS、EST FUEL、Joker/Bingo 警告 */
import { state, emit, currentVariation } from './state.js';
import { activeRoute, autoSequence, recordTakeoff } from './route.js';
import { findConfig } from './aircraft.js';
import { userPoints } from './points.js';
import { computePlan, estimateFuel, projectLanding, remainingFromPosition, divertNeed } from './flightplan.js';
import { distanceNm, bearingTrue, toMagnetic, crossTrackNm, gsiVariation } from './geo.js';
import { toTas, windTriangle } from './aero.js';
import { now, parseClock } from './clock.js';

const AIRBORNE_GS_KT = 50;          // これを超えたら離陸とみなす
export const XTK_WARN_NM = 2;       // 横ずれ：黄
export const XTK_ALERT_NM = 3.5;    // 横ずれ：赤
const DAY_MS = 86400000;
const SAME_POINT_NM = 0.1;
let cache = { key: '', plan: null };

/* ==== navContext ==== 描画・画面用：アクティブルート、形態、計画（ルートか形態が変わったら再計算） */
export function navContext() {
  const route = activeRoute();
  const found = route ? findConfig(route.configRef) : null;
  const cfg = found?.config || null;
  const key = route ? JSON.stringify([route, cfg]) : '';
  if (key !== cache.key) cache = { key, plan: route ? computePlan(route, cfg) : null };
  return { route, cfg, aircraft: found?.aircraft || null, plan: cache.plan, userPoints: userPoints() };
}

function legFor(plan, idx) {
  return plan?.legs.find((l) => l.toIndex === idx) || null;
}

/* ==== baseTime ==== ETA の起点：実際の離陸時刻、無ければ計画離陸時刻 */
function baseTime(route) {
  return route.flight?.takeoffAt || parseClock(route.plannedTakeoff) || null;
}

/* ==== etaTable ==== 各 STPT の ETA（ms）。飛行中はアクティブ以降を現在位置と GS から引き直す */
export function etaTable(nav, own, t = now()) {
  const { route, plan } = nav;
  const out = {};
  if (!plan?.ok) return out;
  const base = baseTime(route);
  const airborne = !!route.flight?.takeoffAt && Number.isFinite(own?.lat);
  let liveT = null;
  plan.legs.forEach((leg) => {
    if (airborne && leg.toIndex === route.activeIdx) {
      const gs = own.gs > AIRBORNE_GS_KT ? own.gs : leg.gs;
      liveT = t + (distanceNm(own, route.points[leg.toIndex]) / gs) * 3600000;
      out[leg.toIndex] = liveT;
    } else if (liveT !== null) {
      liveT += leg.time * 3600000;
      out[leg.toIndex] = liveT;
    } else if (base) out[leg.toIndex] = base + leg.cumTime * 3600000;
  });
  return out;
}

/* ==== validityWindow ==== SUP・NOTAM を表示する時間帯
 * 計画離陸時刻あり：離陸〜終了予定（不明なら+1日）。飛行中：今〜終了予定（過ぎたものは隠す）。無し：今 */
export function validityWindow(t = now()) {
  const nav = navContext();
  const r = nav.route;
  const dur = nav.plan?.ok ? (nav.plan.time + (nav.plan.altTime || 0)) * 3600000 : DAY_MS;
  const span = Math.min(DAY_MS, Number.isFinite(dur) ? dur : DAY_MS);
  if (r?.flight?.takeoffAt) return { start: t, end: Math.max(t, r.flight.takeoffAt + span) };
  const planned = r ? parseClock(r.plannedTakeoff, t) : null;
  if (planned) return { start: planned, end: planned + span };
  return { start: t, end: t };
}

/* ==== legGeometry ==== アクティブ区間の起点と終点（DIRECT 後は直行線） */
function activeLeg(route) {
  const to = route.points[route.activeIdx];
  let from = route.flight?.directOrigin || null;
  for (let i = route.activeIdx - 1; !from && i >= 0; i -= 1) if (!route.points[i].skipped) from = route.points[i];
  return { from, to };
}

/* ==== fuelToPoint ==== 現在位置から地点までの計画燃料。ルート上の先の STPT ならルート沿い、そうでなければ巡航で直行 */
function fuelToPoint(nav, own, pt) {
  const { route, plan, cfg } = nav;
  const idx = route.points.findIndex((p, i) => i >= route.activeIdx && !p.skipped && distanceNm(p, pt) < SAME_POINT_NM);
  if (idx >= 0) {
    const toIdx = plan.legs.findIndex((l) => l.toIndex === idx);
    const all = remainingFromPosition(plan, route, own);
    const after = plan.legs.slice(toIdx + 1).reduce((s, l) => s + l.fuel, 0);
    return { fuel: all.fuel - after, onRoute: true };
  }
  const passed = route.points.some((p, i) => i < route.activeIdx && distanceNm(p, pt) < SAME_POINT_NM);
  if (passed) return { passed: true };
  const alt = Number.isFinite(own.alt) ? own.alt : route.cruiseAlt;
  const course = bearingTrue(own, pt);
  const gs = windTriangle(course, toTas(cfg.cruise.speed, alt, route.isaDev || 0), route.wind).gs;
  return { fuel: gs > 0 ? (distanceNm(own, pt) / gs) * cfg.cruise.ff : NaN, onRoute: false };
}

/* ==== fuelGates ==== BINGO（任意の地点で保有すべき燃料）と HOME BINGO（既定は目的地接地時）の見込み */
export function fuelGates(nav, own, est) {
  const { route, plan, cfg } = nav;
  const out = {};
  if (!plan?.ok || !Number.isFinite(est) || !Number.isFinite(own?.lat)) return out;
  if (Number.isFinite(route.bingo)) {
    const pt = route.bingoPoint;
    const f = pt ? fuelToPoint(nav, own, pt) : { fuel: 0 };
    out.bingo = f.passed ? { passed: true, min: route.bingo, name: pt.name } : { proj: est - f.fuel, min: route.bingo, name: pt?.name || 'NOW' };
  }
  if (route.flight?.diverted) {
    // DIVERT 後：行き先は代替飛行場。接地時に予備燃料（機種の最低燃料）を残せるか
    out.home = { proj: projectLanding(plan, route, own, est, cfg)?.dest, min: cfg.reserve || 0, name: route.points.at(-1)?.name || 'ALT', label: 'MIN' };
  } else if (route.flight?.missed) {
    // 復行中：目的地の接地は無くなったので HOME BINGO は判定しない（代わりに DIVERT の必要燃料を出す）
  } else if (Number.isFinite(route.homeBingo)) {
    const home = route.points.find((p) => p.id === route.homeBingoPointId);
    if (home && home !== route.points.at(-1)) {
      const f = fuelToPoint(nav, own, home);
      out.home = f.passed ? { passed: true, min: route.homeBingo, name: home.name } : { proj: est - f.fuel, min: route.homeBingo, name: home.name };
    } else {
      out.home = { proj: projectLanding(plan, route, own, est, cfg)?.dest, min: route.homeBingo, name: route.points.at(-1)?.name || 'DST' };
    }
  }
  return out;
}

/* ==== liveNav ==== データパネル用の現在値 */
export function liveNav(nav, own, t = now()) {
  const { route, plan, cfg } = nav;
  if (!route || route.points.length < 2) return null;
  const target = route.points[route.activeIdx];
  const out = { idx: route.activeIdx, target, last: route.activeIdx === route.points.length - 1 };
  if (Number.isFinite(own?.lat) && target) {
    out.dist = distanceNm(own, target);
    out.brg = toMagnetic(bearingTrue(own, target), currentVariation().value);
    const { from, to } = activeLeg(route);
    if (from && to) {
      out.xtk = crossTrackNm(from, to, own);
      out.dtk = toMagnetic(bearingTrue(from, to), gsiVariation(from.lat, from.lon) ?? currentVariation().value);
    }
  }
  const leg = legFor(plan, route.activeIdx);
  const gs = own?.gs > AIRBORNE_GS_KT ? own.gs : leg?.gs;
  out.ete = Number.isFinite(out.dist) && gs > 0 ? out.dist / gs : NaN;
  out.eta = etaTable(nav, own, t)[route.activeIdx] ?? (Number.isFinite(out.ete) ? t + out.ete * 3600000 : NaN);
  const tos = target?.tos ? parseClock(target.tos, out.eta || t) : null;
  out.tosDelta = tos && Number.isFinite(out.eta) ? (out.eta - tos) / 1000 : null;   // 正＝遅れ
  if (plan?.ok) {
    out.est = estimateFuel(plan, route, t);
    out.proj = projectLanding(plan, route, own, out.est, cfg);
    out.gates = fuelGates(nav, own, out.est);
    if (route.flight?.missed && !route.flight.diverted) out.divert = divertNeed(route, cfg, own);
  }
  return out;
}

/* ==== alertLevel ==== BINGO（地点での見込み）／HOME BINGO（目的地接地の見込み）を下回ったら。JOKER は従来どおり EST と比較 */
export function alertLevel(route, live) {
  if (!route || !live) return null;
  const below = (g) => g && !g.passed && Number.isFinite(g.proj) && g.proj < g.min;
  if (below(live.gates?.bingo)) return 'bingo';
  if (below(live.gates?.home)) return 'home';
  if (Number.isFinite(route.joker) && live.est <= route.joker) return 'joker';
  return null;
}

/* ==== onOwnUpdate ==== 自機が動くたび：離陸検出 → 自動送り（燃料入力の催促）→ 警告判定 */
export function onOwnUpdate(own) {
  const route = activeRoute();
  if (!route || route.points.length < 2) return;
  const t = now();
  if (own.gs > AIRBORNE_GS_KT && recordTakeoff(route, t)) emit('route');
  if (route.flight.takeoffAt) {
    const passed = autoSequence(route, own);
    if (passed !== null) {
      state.fuelPrompt = { idx: passed, name: route.points[passed].name };
      emit('route');
    }
  }
  const level = alertLevel(route, liveNav(navContext(), own, t));
  if (level !== state.alert) {
    state.alert = level;
    state.alertAck = false;
    emit('alert');
  }
}
