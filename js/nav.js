/* ==== nav.js ==== 飛行中の航法：計画のキャッシュ、離陸検出、自動送り、ETA/TOS、EST FUEL、Joker/Bingo 警告 */
import { state, emit, currentVariation } from './state.js';
import { activeRoute, autoSequence, recordTakeoff } from './route.js';
import { findConfig } from './aircraft.js';
import { userPoints } from './points.js';
import { computePlan, estimateFuel, projectLanding } from './flightplan.js';
import { distanceNm, bearingTrue, toMagnetic } from './geo.js';
import { now, parseClock } from './clock.js';

const AIRBORNE_GS_KT = 50;          // これを超えたら離陸とみなす
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

/* ==== liveNav ==== データパネル用の現在値 */
export function liveNav(nav, own, t = now()) {
  const { route, plan, cfg } = nav;
  if (!route || route.points.length < 2) return null;
  const target = route.points[route.activeIdx];
  const out = { idx: route.activeIdx, target, last: route.activeIdx === route.points.length - 1 };
  if (Number.isFinite(own?.lat) && target) {
    out.dist = distanceNm(own, target);
    out.brg = toMagnetic(bearingTrue(own, target), currentVariation().value);
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
  }
  return out;
}

/* ==== alertLevel ==== EST FUEL と Joker/Bingo の比較 */
export function alertLevel(route, est) {
  if (!route || !Number.isFinite(est)) return null;
  if (Number.isFinite(route.bingo) && est <= route.bingo) return 'bingo';
  if (Number.isFinite(route.joker) && est <= route.joker) return 'joker';
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
  const level = alertLevel(route, liveNav(navContext(), own, t)?.est);
  if (level !== state.alert) {
    state.alert = level;
    state.alertAck = false;
    emit('alert');
  }
}
