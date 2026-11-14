/* ==== procgeo.js ==== SID/STAR/APP エディターの幾何計算。手順（パーツの並び）→ 地図に描く線・注記
 * フィックスの書き方：名前 ／ HUC 270/25 ／ HUC R-270 D25 ／ HUC R-300 / GOT R-210（交点）／ HUC R-270 / GOT D15（ラジアル×DME）／ 座標
 * 方位はすべて磁方位で入力。ラジアルは局の公表偏差、それ以外は地点の偏差で真方位にする */
import { distanceNm, bearingTrue, destination, toTrue, toMagnetic, gsiVariation, norm360 } from './geo.js';
import { toTas } from './aero.js';

const RAD = Math.PI / 180;
const FT_PER_NM = 6076.12;
export const DEFAULT_GRADIENT_PCT = 3.3;     // AIP の標準上昇勾配（約 200ft/nm）
export const DEFAULT_BANK_DEG = 25;
const TURN_K = 68625;                       // 旋回半径 nm = TAS² / (68625 × tan バンク)
const ARC_STEP_DEG = 3;
const MIN_TURN_DEG = 2;
const SCAN_MAX_NM = 250;
const M_PER_NM = 1852;
export const DEFAULT_TURN_KIAS = 250;      // 「旋回して針路」で速度を入れないときの旋回速度

/* ==== turnRadiusNm ==== 半径を直接、または KIAS・高度・バンク角から */
export function turnRadiusNm(turn) {
  if (!turn) return 0;
  if (turn.mode === 'radius') return Number(turn.radius) || 0;
  const tas = toTas({ unit: 'IAS', value: Number(turn.kias) || 0 }, Number(turn.alt) || 0);
  const bank = (Number(turn.bank) || DEFAULT_BANK_DEG) * RAD;
  return tas > 0 ? (tas * tas) / (TURN_K * Math.tan(bank)) : 0;
}

export function gradientFtPerNm(pct) {
  return ((Number(pct) || DEFAULT_GRADIENT_PCT) / 100) * FT_PER_NM;
}

/* ==== intersectRays ==== 2つの「点＋真方位」の大圏の交点（前方のみ。平行・後方なら null）。Williams の公式 */
export function intersectRays(p1, b1, p2, b2) {
  const [f1, l1, f2, l2] = [p1.lat * RAD, p1.lon * RAD, p2.lat * RAD, p2.lon * RAD];
  const [t13, t23] = [b1 * RAD, b2 * RAD];
  const d12 = 2 * Math.asin(Math.sqrt(Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d12 < 1e-12) return null;
  const ta = Math.acos(Math.min(1, Math.max(-1, (Math.sin(f2) - Math.sin(f1) * Math.cos(d12)) / (Math.sin(d12) * Math.cos(f1)))));
  const tb = Math.acos(Math.min(1, Math.max(-1, (Math.sin(f1) - Math.sin(f2) * Math.cos(d12)) / (Math.sin(d12) * Math.cos(f2)))));
  const t12 = Math.sin(l2 - l1) > 0 ? ta : 2 * Math.PI - ta;
  const t21 = Math.sin(l2 - l1) > 0 ? 2 * Math.PI - tb : tb;
  const a1 = t13 - t12;
  const a2 = t21 - t23;
  if (Math.sin(a1) * Math.sin(a2) <= 0) return null;
  const a3 = Math.acos(-Math.cos(a1) * Math.cos(a2) + Math.sin(a1) * Math.sin(a2) * Math.cos(d12));
  const d13 = Math.atan2(Math.sin(d12) * Math.sin(a1) * Math.sin(a2), Math.cos(a2) + Math.cos(a1) * Math.cos(a3));
  const dist = (d13 / RAD) * 60;
  // 大圏では平行なラジアルも極で交わる：実用範囲（250nm）を超える交点は「交わらない」とする
  return dist > 0 && dist <= SCAN_MAX_NM ? destination(p1, b1, dist) : null;
}

/* ==== rayCircle ==== 点から真方位へ進んで、局からの距離が r になる最初の点（無ければ null） */
export function rayCircle(origin, brg, center, r) {
  const f = (d) => distanceNm(destination(origin, brg, d), center) - r;
  let prev = f(0);
  for (let d = 0.5; d <= SCAN_MAX_NM; d += 0.5) {
    const cur = f(d);
    if (Math.sign(cur) !== Math.sign(prev)) {
      let [a, b] = [d - 0.5, d];
      for (let i = 0; i < 40; i += 1) { const m = (a + b) / 2; if (Math.sign(f(m)) === Math.sign(f(a))) a = m; else b = m; }
      return destination(origin, brg, (a + b) / 2);
    }
    prev = cur;
  }
  return null;
}

/* ==== stationRadial ==== 局と磁ラジアル → 真方位（局の公表偏差、無ければ地点の偏差） */
function radialTrue(st, radialMag) {
  const dec = Number.isFinite(st.dec) ? st.dec : gsiVariation(st.lat, st.lon) ?? 0;
  return toTrue(Number(radialMag), dec);
}

const RADIAL_RE = /^([A-Z0-9]+)\s*R-?\s*(\d{1,3}(?:\.\d+)?)$/;
const DME_RE = /^([A-Z0-9]+)\s*D\s*(\d+(?:\.\d+)?)$/;

/* ==== resolveFix ==== フィックスの文字列 → {name, lat, lon}。findPoint(name) と resolvePoint(text) を ctx で受け取る */
export function resolveFix(text, ctx) {
  const t = String(text || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!t) return null;
  const parts = t.split(/\s*\/\s*(?=[A-Z])/);
  if (parts.length === 2) {
    const a = parts[0].match(RADIAL_RE);
    const b2 = parts[1].match(RADIAL_RE);
    const d2 = parts[1].match(DME_RE);
    const s1 = a && ctx.findPoint(a[1]);
    if (s1 && b2) {
      const s2 = ctx.findPoint(b2[1]);
      const p = s2 && intersectRays(s1, radialTrue(s1, a[2]), s2, radialTrue(s2, b2[2]));
      return p ? { name: '', ...p } : null;
    }
    if (s1 && d2) {
      const s2 = ctx.findPoint(d2[1]);
      const p = s2 && rayCircle(s1, radialTrue(s1, a[2]), s2, Number(d2[2]));
      return p ? { name: '', ...p } : null;
    }
  }
  const rd = t.match(/^([A-Z0-9]+)\s*R-?\s*(\d{1,3}(?:\.\d+)?)\s*D\s*(\d+(?:\.\d+)?)$/);
  if (rd) {
    const st = ctx.findPoint(rd[1]);
    return st ? { name: `D${rd[3]} ${st.name}`, ...destination(st, radialTrue(st, rd[2]), Number(rd[3])) } : null;
  }
  const p = ctx.resolvePoint(t);
  return p ? { name: p.name || '', lat: p.lat, lon: p.lon } : null;
}

/* ==== runwayStart ==== SID の開始点（滑走路端＝DER）：上書き座標 → AIP AD2 から読んだ DER → 飛行場標点から方位・長さの半分だけ先（推定） */
export function runwayStart(airport, rwy, override) {
  if (override && Number.isFinite(override.lat)) return { ...override, hdg: rwy?.hdg ?? 0, estimated: false };
  if (rwy?.der && Number.isFinite(rwy.der.lat)) return { lat: rwy.der.lat, lon: rwy.der.lon, hdg: rwy.hdg ?? 0, estimated: false, aip: true };
  const arp = { lat: airport.p[1], lon: airport.p[0] };
  const hdg = rwy?.hdg ?? 0;
  const p = destination(arp, hdg, ((rwy?.len || 0) / 2) / M_PER_NM);
  return { ...p, hdg, estimated: true };
}

/* ==== legEnd ==== ラジアル・針路のレグの終点（DME／フィックス・ラジアル交点／高度＝上昇勾配から距離） */
function legEnd(from, courseTrue, end, ctx, cur, ownStation) {
  if (!end) return null;
  if (end.type === 'alt') {
    const d = Math.max(0, (Number(end.alt) - cur.alt) / gradientFtPerNm(end.grad));
    return { p: destination(from, courseTrue, d), alt: Number(end.alt) };
  }
  if (end.type === 'dme') {
    const name = end.station || ownStation;
    const st = ctx.findPoint(name);   // ラジアルのレグは自局の DME が既定
    return st ? { p: rayCircle(from, courseTrue, st, Number(end.dist)) } : { error: `DME の局が見つかりません：${name || ''}` };
  }
  const rm = String(end.to || '').toUpperCase().trim().match(RADIAL_RE);
  if (rm) {
    const st = ctx.findPoint(rm[1]);
    return st ? { p: intersectRays(from, courseTrue, st, radialTrue(st, rm[2])) } : { error: `局が見つかりません：${rm[1]}` };
  }
  const fx = resolveFix(end.to, ctx);
  return fx ? { p: fx, name: fx.name } : { error: `フィックスが見つかりません：${end.to || ''}` };
}

/* ==== partGeometry ==== 1パーツ → 線（点列）・終点・出入りの真方位 */
function partGeometry(part, cur, ctx) {
  const from = cur.p;
  if (part.type === 'tf') {
    const fx = resolveFix(part.to, ctx);
    if (!fx) return { error: `フィックスが見つかりません：${part.to || ''}` };
    const c = bearingTrue(from, fx);
    return { pts: [from, fx], end: fx, endName: fx.name || part.to, c0: c, c1: norm360(bearingTrue(fx, from) + 180) };
  }
  if (part.type === 'radial' || part.type === 'heading') {
    let course;
    if (part.type === 'radial') {
      const st = ctx.findPoint(part.station);
      if (!st) return { error: `局が見つかりません：${part.station || ''}` };
      if (part.inbound === 'auto') return autoRadial(part, cur, ctx, st);
      course = norm360(radialTrue(st, part.radial) + (part.inbound ? 180 : 0));
    } else if (part.rwyHdg && (part.hdg === null || part.hdg === '' || part.hdg === undefined)) {
      // 「Climb RWY HDG」：SID の最初は滑走路の向き（AIP の真方位）
      if (!Number.isFinite(cur.c)) return { error: '滑走路の向きが分かりません（針路を入れてください）' };
      course = cur.c;
    } else {
      course = toTrue(Number(part.hdg), gsiVariation(from.lat, from.lon) ?? 0);
    }
    const e = legEnd(from, course, part.end, ctx, cur, part.type === 'radial' ? part.station : null);
    if (!e?.p) return { error: e?.error || '終わりの条件で点が決まりません（交わらない・遠すぎる）' };
    return { pts: [from, e.p], end: e.p, endName: e.name || '', endAlt: e.alt, c0: course, c1: course };
  }
  if (part.type === 'arc') return arcGeometry(part, from, ctx);
  if (part.type === 'turnhdg') return turnHeadingGeometry(part, cur, ctx);
  if (part.type === 'hold') return holdGeometry(part, cur);
  return { error: '不明なパーツ' };
}

export const DEFAULT_HOLD_KIAS = 230;

/* ==== holdGeometry ==== 待機（レーストラック）：今の点が待機フィックス。入航コース（磁）でフィックスに入り、旋回方向へ 180° 旋回 → 出航 → 180° 旋回 → 入航
 * 出航の長さ＝分（既定 1 分、速度は KIAS と高度から TAS）または距離 nm。旋回半径は KIAS・25° バンク。進む先は変えない（フィックスの点は増やさない） */
function holdGeometry(part, cur) {
  const F = cur.p;
  const auto = part.inbound === null || part.inbound === undefined || part.inbound === '';
  if (auto && !Number.isFinite(cur.c)) return { error: '待機の入航コースを入れてください' };
  const c = auto ? cur.c : toTrue(Number(part.inbound), gsiVariation(F.lat, F.lon) ?? 0);
  const kias = Number(part.kias) || DEFAULT_HOLD_KIAS;
  const alt = Number(part.alt?.v) || cur.alt || 0;
  const r = turnRadiusNm({ mode: 'perf', kias, alt, bank: DEFAULT_BANK_DEG });
  const len = Number(part.legNm) > 0 ? Number(part.legNm) : (toTas({ unit: 'IAS', value: kias }, alt) * (Number(part.min) || 1)) / 60;
  const s = part.dir === 'L' ? -1 : 1;
  const P = destination(F, c + 180, len);
  const arc = (center, b0) => Array.from({ length: 61 }, (_, i) => destination(center, b0 + s * i * 3, r));
  const turn1 = arc(destination(F, c + 90 * s, r), c - 90 * s);
  const turn2 = arc(destination(P, c + 90 * s, r), c + 90 * s);
  const inMag = Math.round(toMagnetic(c, gsiVariation(F.lat, F.lon) ?? 0));
  return { hold: true, pts: [F, ...turn1, ...turn2, P, F], end: F, endName: '', c0: c, c1: c, outMid: destination(turn1.at(-1), c + 180, len / 2), legNm: len, radius: r, inMag, auto };
}

/* ==== turnHeadingGeometry ==== 旋回して針路（turn left HDG 002° など）：今の進路から指定の向きに旋回し、針路に乗ってから終わりの条件まで直進
 * 180° を超える旋回・ティアドロップも描ける。半径は part.turn（速度・バンク、または半径）。無ければ 250KIAS・25°。高度で終わるときは旋回中の上昇も数える */
function turnHeadingGeometry(part, cur, ctx) {
  const from = cur.p;
  if (!Number.isFinite(Number(part.hdg)) || part.hdg === null || part.hdg === '') return { error: '針路を入れてください' };
  const hdg = toTrue(Number(part.hdg), gsiVariation(from.lat, from.lon) ?? 0);
  if (!Number.isFinite(cur.c)) {
    // 旋回の前の進路が分からない（TRANSITION・STAR の最初など）：旋回は描かず、その針路でまっすぐ
    const e0 = legEnd(from, hdg, part.end, ctx, cur, null);
    if (!e0?.p) return { error: e0?.error || '終わりの条件で点が決まりません（交わらない・遠すぎる）' };
    return { pts: [from, e0.p], end: e0.p, endName: e0.name || '', endAlt: e0.alt, c0: hdg, c1: hdg, p1: from, radius: 0 };
  }
  const right = (part.dir || 'R') === 'R';
  const t = part.turn?.mode ? { ...part.turn, alt: part.turn.alt || cur.alt } : { mode: 'perf', kias: DEFAULT_TURN_KIAS, alt: cur.alt };
  const r = turnRadiusNm(t);
  if (!(r > 0)) return { error: '旋回半径が決まりません' };
  const sweep = right ? norm360(hdg - cur.c) : norm360(cur.c - hdg);
  const c = destination(from, cur.c + (right ? 90 : -90), r);
  const b0 = bearingTrue(c, from);
  const n = Math.max(1, Math.ceil(sweep / ARC_STEP_DEG));
  const arc = Array.from({ length: n + 1 }, (_, i) => destination(c, b0 + (right ? 1 : -1) * (sweep * i) / n, r));
  const p1 = arc.at(-1);
  const arcNm = r * sweep * RAD;
  const climbed = part.end?.type === 'alt' ? arcNm * gradientFtPerNm(part.end.grad) : 0;
  const e = legEnd(p1, hdg, part.end, ctx, { ...cur, alt: cur.alt + climbed }, null);
  if (!e?.p) return { error: e?.error || '終わりの条件で点が決まりません（交わらない・遠すぎる）' };
  return { pts: [...arc, e.p], end: e.p, endName: e.name || '', endAlt: e.alt, c0: cur.c, c1: hdg, p1, radius: r };
}

/* ==== arcGeometry ==== DME アーク：局を中心に、今のラジアルから指定ラジアルまで（R＝時計回り） */
function arcGeometry(part, from, ctx) {
  const st = ctx.findPoint(part.station);
  if (!st) return { error: `局が見つかりません：${part.station || ''}` };
  const r = Number(part.dme) || distanceNm(st, from);
  const startB = bearingTrue(st, from);
  const cw = (part.dir || 'R') === 'R';
  let sweep;
  if (part.endBy === 'fix') {
    // 終点＝フィックス（「ARC to TAIYO」）：局から見たフィックスの方位まで
    const fx = resolveFix(part.xFix, ctx);
    if (!fx) return { error: `終点のフィックスが見つかりません：${part.xFix || ''}` };
    const b = bearingTrue(st, fx);
    sweep = cw ? norm360(b - startB) : norm360(startB - b);
  } else if (part.endBy === 'other') {
    // 終点＝別の NAVAID のラジアルとアークの交点（アークの向きに進んで最初に交わるところ）
    const x = ctx.findPoint(part.xStation);
    if (!x) return { error: `終点の局が見つかりません：${part.xStation || ''}` };
    sweep = arcCrossing(st, r, startB, cw, x, radialTrue(x, part.xRadial));
    if (sweep === null) return { error: `アークが ${part.xStation} R-${part.xRadial} と交わりません` };
  } else {
    const endB = radialTrue(st, part.to);
    sweep = cw ? norm360(endB - startB) : norm360(startB - endB);
  }
  const endB = startB + (cw ? sweep : -sweep);
  const n = Math.max(1, Math.ceil(sweep / ARC_STEP_DEG));
  const pts = Array.from({ length: n + 1 }, (_, i) => destination(st, startB + (cw ? 1 : -1) * (sweep * i) / n, r));
  const tangent = (b) => norm360(b + (cw ? 90 : -90));
  return { pts, end: pts.at(-1), endName: `${part.station} ${Math.round(r)}DME`, c0: tangent(startB), c1: tangent(endB), arc: true, radius: r };
}

/* ==== autoRadial ==== 向き「自動」のラジアル（AIP の文章から）：外向き・局へ向かうの両方を試し、終点が決まる方（両方なら近い方）
 * DME で終わるときは、今の距離より近ければ局へ向かう */
function autoRadial(part, cur, ctx, st) {
  const from = cur.p;
  const out = radialTrue(st, part.radial);
  const own = !part.end?.station || part.end.station === part.station;
  let order = [out, norm360(out + 180)];
  if (part.end?.type === 'dme' && own) order = Number(part.end.dist) < distanceNm(from, st) ? [order[1]] : [order[0]];
  const tries = order.map((c) => ({ c, e: legEnd(from, c, part.end, ctx, cur, part.station) })).filter((t) => t.e?.p);
  if (!tries.length) return { error: '終わりの条件で点が決まりません（交わらない・遠すぎる）' };
  const best = tries.sort((a, b) => distanceNm(from, a.e.p) - distanceNm(from, b.e.p))[0];
  return { pts: [from, best.e.p], end: best.e.p, endName: best.e.name || '', endAlt: best.e.alt, c0: best.c, c1: best.c };
}

/* ==== arcCrossing ==== 局 st・半径 r の円を startB から向き cw に回るとき、局 x のラジアル（真方位 xb）を最初に横切る角度（度）。無ければ null
 * x から見た方位とラジアルの差が符号を変え、かつラジアルの前方（差が 90° 未満）のところ */
export function arcCrossing(st, r, startB, cw, x, xb) {
  const side = (deg) => {
    const p = destination(st, startB + (cw ? deg : -deg), r);
    return ((bearingTrue(x, p) - xb + 540) % 360) - 180;
  };
  let prev = side(0);
  for (let d = 0.5; d <= 359.5; d += 0.5) {
    const cur = side(d);
    if (Math.sign(cur) !== Math.sign(prev) && Math.abs(cur) < 90 && Math.abs(prev) < 90) {
      let [a, b] = [d - 0.5, d];
      for (let i = 0; i < 40; i += 1) { const m = (a + b) / 2; if (Math.sign(side(m)) === Math.sign(side(a))) a = m; else b = m; }
      return (a + b) / 2;
    }
    prev = cur;
  }
  return null;
}

/* ==== filletTurn ==== 前の直線と今の直線の角を半径 r の弧でつなぐ（fly-by）。prev.pts の最後と cur.pts の最初を切り詰める */
function filletTurn(prev, cur, r) {
  const P = cur.pts[0];
  const delta = ((cur.c0 - prev.c1 + 540) % 360) - 180;
  if (!(r > 0) || Math.abs(delta) < MIN_TURN_DEG || prev.arc || cur.arc) return null;
  const d = r * Math.tan((Math.abs(delta) / 2) * RAD);
  if (d >= distanceNm(prev.pts.at(-2), P) || d >= distanceNm(P, cur.pts[1])) return { error: '旋回半径が大きすぎます（直線が短い）' };
  const t1 = destination(P, prev.c1 + 180, d);
  const t2 = destination(P, cur.c0, d);
  const side = delta > 0 ? 90 : -90;
  const c = destination(t1, prev.c1 + side, r);
  const b1 = bearingTrue(c, t1);
  const sweep = Math.abs(delta);
  const n = Math.max(2, Math.ceil(sweep / ARC_STEP_DEG));
  const arc = Array.from({ length: n + 1 }, (_, i) => destination(c, b1 + Math.sign(delta) * (sweep * i) / n, r));
  prev.pts[prev.pts.length - 1] = t1;
  cur.pts[0] = t2;
  return { arc, dir: delta > 0 ? 'R' : 'L', radius: r };
}

/* ==== courseLabel ==== レグの注記（コース・距離）。ラジアルは「HUC R-270」、針路は「HDG 030°」 */
function courseLabel(part, g) {
  const a = g.pts[0];
  const b = g.pts.at(-1);
  const dist = g.arc ? 0 : distanceNm(a, b);
  const mag = Math.round(toMagnetic(g.c0, gsiVariation(a.lat, a.lon) ?? 0)) % 360;
  const crs = String(mag || 360).padStart(3, '0');
  if (part.type === 'arc') return `${Math.round(g.radius)}DME ARC ${part.station}`;
  if (part.type === 'radial') return `${part.station} R-${String(Math.round(Number(part.radial)) % 360).padStart(3, '0')} ${dist.toFixed(1)}`;
  if (part.type === 'heading') return part.rwyHdg && !Number.isFinite(Number(part.hdg ?? NaN)) ? `RWY HDG ${dist.toFixed(1)}` : `HDG ${String(Math.round(Number(part.hdg)) % 360 || 360).padStart(3, '0')}° ${dist.toFixed(1)}`;
  if (part.type === 'turnhdg') return `${part.dir === 'L' ? 'L' : 'R'} TURN HDG ${String(Math.round(Number(part.hdg)) % 360 || 360).padStart(3, '0')}° ${distanceNm(g.p1, b).toFixed(1)}`;
  return `${crs}° ${dist.toFixed(1)}`;
}

/* ==== buildLegs ==== パーツの並びを順に計算。turn は「前のパーツとの角」に付く */
function buildLegs(parts, start, ctx, out, dashed) {
  let cur = { p: start.p, alt: start.alt, c: start.c };
  let prevGeom = start.geom || null;
  parts.forEach((part, i) => {
    const g = partGeometry(part, cur, ctx);
    if (g.error) { out.warnings.push(`${dashed ? '復行 ' : ''}${i + 1}：${g.error}`); return; }
    if (g.hold) { holdLeg(part, g, out, dashed); cur = { ...cur, c: g.c1, alt: Number(part.alt?.v) || cur.alt }; return; }
    // 「旋回して針路」の turn は自分の旋回の半径（角の丸めではない）
    const turn = part.turn && part.type !== 'turnhdg' && prevGeom ? filletTurn(prevGeom, g, turnRadiusNm(part.turn)) : null;
    if (turn?.error) out.warnings.push(`${i + 1}：${turn.error}`);
    if (turn?.arc) out.segments.push({ pts: turn.arc, dashed, turn: true });
    const seg = { pts: g.pts, dashed, partId: part.id };
    out.segments.push(seg);
    // ラジアルの「局から終点まで点線」：見た目の補助（経路・距離には入れない）
    if (part.type === 'radial' && part.guide) {
      const st = ctx.findPoint(part.station);
      if (st) (out.guides ||= []).push([st, g.end]);
    }
    if (part.alt?.v || part.alt?.type === 'between') cur.alt = Number(part.alt.v) || cur.alt;
    if (Number.isFinite(g.endAlt)) cur.alt = g.endAlt;
    const mid = g.pts[Math.floor(g.pts.length / 2)];
    const midB = g.pts.length === 2 ? destination(g.pts[0], bearingTrue(g.pts[0], g.pts[1]), distanceNm(g.pts[0], g.pts[1]) / 2) : mid;
    out.labels.push({ ...midB, kind: 'course', text: courseLabel(part, g), partId: part.id, which: 'course', off: part.lbl2 });
    out.labels.push({ ...g.end, kind: 'fix', text: part.name || g.endName || '', alt: part.alt, speed: part.speed, altEst: Math.round(cur.alt), partId: part.id, which: 'fix', off: part.lbl });
    out.fixes.push({ ...g.end, name: part.name || g.endName || '', partId: part.id, missed: dashed, altC: part.alt || null, altEnd: Number.isFinite(g.endAlt) ? g.endAlt : null });
    prevGeom = g;
    cur = { p: g.end, alt: cur.alt, c: g.c1 };
  });
  return { cur, prevGeom };
}

/* ==== holdLeg ==== 待機の線と注記「HOLD 090° R 1MIN」（出航側の中ほど）。フィックス（STPT）は増やさない */
function holdLeg(part, g, out, dashed) {
  out.segments.push({ pts: g.pts, dashed, hold: true, partId: part.id });
  const crs = String(g.inMag % 360 || 360).padStart(3, '0');
  const leg = Number(part.legNm) > 0 ? `${Number(part.legNm)}NM` : `${Number(part.min) || 1}MIN`;
  const alt = part.alt?.v ? ` ${part.alt.v}` : '';
  out.labels.push({ ...g.outMid, kind: 'course', text: `HOLD ${crs}°${g.auto ? '（入る向き）' : ''} ${part.dir === 'L' ? 'L' : 'R'} ${leg}${alt}`, partId: part.id, which: 'course', off: part.lbl2 });
}

/* ==== findRunway ==== 滑走路を名前で。AIP の L/R つきしか無いとき「03」は「03L」などの最初に当たるもの */
export function findRunway(ad, d) {
  if (!ad?.rwy || !d) return null;
  return ad.rwy.find((r) => r.d === d) || ad.rwy.find((r) => r.d.slice(0, 2) === String(d).slice(0, 2)) || null;
}

/* ==== localCtx ==== 地点の引き方：手順に付いたウェイポイント（AIP の座標 proc.wpts）→ 登録済みの地点 → 前の段の手順（SID 等）で名前を付けたフィックス
 * ctx.relatedFixes(proc) が { NAME: {lat, lon} } を返す（TRANSITION の開始に、自作 SID の「GOPVU」などを使えるように） */
function localCtx(proc, ctx) {
  const w = proc.wpts || {};
  const defs = proc.fixDefs || {};
  const rel = ctx.relatedFixes?.(proc) || {};
  const pick = (map, n) => { const k = String(n || '').toUpperCase().trim(); return map[k] ? { name: k, ...map[k] } : null; };
  // チャートの図の定義（「GOPVU＝HUC R-047 D32.5」）：登録済みの地点に無いときに使う
  // 「RW21R」＝その飛行場の滑走路末端（AIP AD2 の THR。進入の最後）。「RW21R D5.1」＝末端から手前（延長線上）5.1nm
  const thr = (n) => {
    const m = String(n || '').toUpperCase().trim().match(/^RW(\d{2}[LRC]?)(?:\s+D(\d+(?:\.\d+)?))?$/);
    const r = m && proc.ad && findRunway(ctx.findAirport?.(proc.ad), m[1]);
    if (!r?.thr || r.d.slice(0, 2) !== m[1].slice(0, 2)) return null;
    if (!m[2]) return { name: `RW${m[1]}`, lat: r.thr.lat, lon: r.thr.lon };
    return Number.isFinite(r.hdg) ? { name: '', ...destination(r.thr, r.hdg + 180, Number(m[2])) } : null;
  };
  const thrCtx = { ...ctx, findPoint: (n) => ctx.findPoint(n) || thr(n), resolvePoint: (t) => ctx.resolvePoint(t) || thr(t) };
  const def = (n) => { const k = String(n || '').toUpperCase().trim(); const p = defs[k] && resolveFix(defs[k], thrCtx); return p ? { ...p, name: k } : null; };
  return {
    ...ctx,
    findPoint: (n) => pick(w, n) || ctx.findPoint(n) || def(n) || pick(rel, n) || thr(n),
    resolvePoint: (t) => pick(w, t) || ctx.resolvePoint(t) || def(t) || pick(rel, t) || thr(t),
  };
}

/* ==== buildProcedure ==== 手順 → { segments:[{pts, dashed, turn}], labels:[…], fixes:[…], start, warnings }
 * SID は滑走路端から、それ以外（STAR・APP・TRANSITION）は開始フィックスから */
export function buildProcedure(proc, ctx) {
  const out = { segments: [], labels: [], fixes: [], warnings: [], start: null };
  let start;
  ctx = localCtx(proc, ctx);
  if (proc.type === 'SID') {
    const ad = ctx.findAirport(proc.ad);
    const rwy = findRunway(ad, proc.rwy);
    if (!ad || !rwy) { out.warnings.push('飛行場・滑走路を選んでください'); return out; }
    if (rwy.d !== proc.rwy) out.warnings.push(`RWY${proc.rwy} は AIP の滑走路 RWY${rwy.d} として作図しています`);
    const override = proc.derText ? resolveFix(proc.derText, ctx) : null;
    const s = runwayStart(ad, rwy, override);
    start = { p: s, alt: ad.elev || 0, c: s.hdg };
    out.start = { ...s, name: `RWY${rwy.d}`, estimated: s.estimated };
    if (s.estimated) out.warnings.push(`RWY${rwy.d} の滑走路端は推定値です（AIP AD 2.12 の座標で直せます）`);
  } else {
    const fx = resolveFix(proc.startFix, ctx);
    if (!fx) { out.warnings.push(proc.startFix ? `開始フィックスが見つかりません：${proc.startFix}` : '開始フィックスを入れてください'); return out; }
    // TRANSITION・STAR は、つながる手順の最後の進路を引き継ぐ（最初の「turn right HDG 146°」の旋回を描くため）
    const inC = ctx.inboundCourse?.(proc);
    start = { p: fx, alt: Number(proc.startAlt) || 0, c: Number.isFinite(inC) ? inC : null };
    out.start = { ...fx, name: fx.name || proc.startFix };
  }
  const main = buildLegs(proc.parts || [], start, ctx, out, false);
  if (proc.type === 'APP' && proc.missed?.length) {
    buildLegs(proc.missed, { ...main.cur, geom: main.prevGeom }, ctx, out, true);
  }
  annotatePath(out);
  return out;
}

function polyLenNm(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i += 1) d += distanceNm(pts[i - 1], pts[i]);
  return d;
}

/* ==== annotatePath ==== 各フィックスに、前のフィックス（最初は開始点）からの実際の飛行距離 pathNm（旋回・アークを含む）を付ける
 * 旋回で直線が切り詰められるので、全パーツを組み立て終えてから測る */
function annotatePath(out) {
  const cumAt = {};
  let cum = 0;
  out.segments.forEach((sg) => {
    if (sg.hold) return;   // 待機の周回は区間距離に入れない
    cum += polyLenNm(sg.pts);
    if (sg.partId) cumAt[sg.partId] = cum;
  });
  let prev = 0;
  out.fixes.forEach((f) => {
    const c = cumAt[f.partId];
    f.pathNm = Number.isFinite(c) ? Math.max(0, c - prev) : null;
    if (Number.isFinite(c)) prev = c;
  });
}
