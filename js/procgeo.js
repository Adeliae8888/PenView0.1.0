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

/* ==== runwayStart ==== SID の開始点（滑走路端＝DER）：飛行場標点から方位・長さの半分だけ先。上書き座標があればそれ */
export function runwayStart(airport, rwy, override) {
  if (override && Number.isFinite(override.lat)) return { ...override, hdg: rwy?.hdg ?? 0, estimated: false };
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
    const st = ctx.findPoint(end.station || ownStation);   // ラジアルのレグは自局の DME が既定
    return st ? { p: rayCircle(from, courseTrue, st, Number(end.dist)) } : null;
  }
  const rm = String(end.to || '').toUpperCase().trim().match(RADIAL_RE);
  if (rm) {
    const st = ctx.findPoint(rm[1]);
    return st ? { p: intersectRays(from, courseTrue, st, radialTrue(st, rm[2])) } : null;
  }
  const fx = resolveFix(end.to, ctx);
  return fx ? { p: fx, name: fx.name } : null;
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
      course = norm360(radialTrue(st, part.radial) + (part.inbound ? 180 : 0));
    } else {
      course = toTrue(Number(part.hdg), gsiVariation(from.lat, from.lon) ?? 0);
    }
    const e = legEnd(from, course, part.end, ctx, cur, part.type === 'radial' ? part.station : null);
    if (!e?.p) return { error: '終わりの条件で点が決まりません（交わらない・遠すぎる）' };
    return { pts: [from, e.p], end: e.p, endName: e.name || '', endAlt: e.alt, c0: course, c1: course };
  }
  if (part.type === 'arc') return arcGeometry(part, from, ctx);
  return { error: '不明なパーツ' };
}

/* ==== arcGeometry ==== DME アーク：局を中心に、今のラジアルから指定ラジアルまで（R＝時計回り） */
function arcGeometry(part, from, ctx) {
  const st = ctx.findPoint(part.station);
  if (!st) return { error: `局が見つかりません：${part.station || ''}` };
  const r = Number(part.dme) || distanceNm(st, from);
  const startB = bearingTrue(st, from);
  const endB = radialTrue(st, part.to);
  const cw = (part.dir || 'R') === 'R';
  const sweep = cw ? norm360(endB - startB) : norm360(startB - endB);
  const n = Math.max(1, Math.ceil(sweep / ARC_STEP_DEG));
  const pts = Array.from({ length: n + 1 }, (_, i) => destination(st, startB + (cw ? 1 : -1) * (sweep * i) / n, r));
  const tangent = (b) => norm360(b + (cw ? 90 : -90));
  return { pts, end: pts.at(-1), endName: `${part.station} ${Math.round(r)}DME`, c0: tangent(startB), c1: tangent(endB), arc: true, radius: r };
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
  if (part.type === 'heading') return `HDG ${String(Math.round(Number(part.hdg)) % 360 || 360).padStart(3, '0')}° ${dist.toFixed(1)}`;
  return `${crs}° ${dist.toFixed(1)}`;
}

/* ==== buildLegs ==== パーツの並びを順に計算。turn は「前のパーツとの角」に付く */
function buildLegs(parts, start, ctx, out, dashed) {
  let cur = { p: start.p, alt: start.alt, c: start.c };
  let prevGeom = start.geom || null;
  parts.forEach((part, i) => {
    const g = partGeometry(part, cur, ctx);
    if (g.error) { out.warnings.push(`${dashed ? '復行 ' : ''}${i + 1}：${g.error}`); return; }
    const turn = part.turn && prevGeom ? filletTurn(prevGeom, g, turnRadiusNm(part.turn)) : null;
    if (turn?.error) out.warnings.push(`${i + 1}：${turn.error}`);
    if (turn?.arc) out.segments.push({ pts: turn.arc, dashed, turn: true });
    const seg = { pts: g.pts, dashed, partId: part.id };
    out.segments.push(seg);
    if (part.alt?.v || part.alt?.type === 'between') cur.alt = Number(part.alt.v) || cur.alt;
    if (Number.isFinite(g.endAlt)) cur.alt = g.endAlt;
    const mid = g.pts[Math.floor(g.pts.length / 2)];
    const midB = g.pts.length === 2 ? destination(g.pts[0], bearingTrue(g.pts[0], g.pts[1]), distanceNm(g.pts[0], g.pts[1]) / 2) : mid;
    out.labels.push({ ...midB, kind: 'course', text: courseLabel(part, g), partId: part.id, which: 'course', off: part.lbl2 });
    out.labels.push({ ...g.end, kind: 'fix', text: part.name || g.endName || '', alt: part.alt, speed: part.speed, altEst: Math.round(cur.alt), partId: part.id, which: 'fix', off: part.lbl });
    out.fixes.push({ ...g.end, name: part.name || g.endName || '' });
    prevGeom = g;
    cur = { p: g.end, alt: cur.alt, c: g.c1 };
  });
  return { cur, prevGeom };
}

/* ==== buildProcedure ==== 手順 → { segments:[{pts, dashed, turn}], labels:[…], fixes:[…], start, warnings } */
export function buildProcedure(proc, ctx) {
  const out = { segments: [], labels: [], fixes: [], warnings: [], start: null };
  let start;
  if (proc.type === 'SID') {
    const ad = ctx.findAirport(proc.ad);
    const rwy = ad?.rwy?.find((r) => r.d === proc.rwy);
    if (!ad || !rwy) { out.warnings.push('飛行場・滑走路を選んでください'); return out; }
    const override = proc.derText ? resolveFix(proc.derText, ctx) : null;
    const s = runwayStart(ad, rwy, override);
    start = { p: s, alt: ad.elev || 0, c: s.hdg };
    out.start = { ...s, name: `RWY${rwy.d}`, estimated: s.estimated };
    if (s.estimated) out.warnings.push(`RWY${rwy.d} の滑走路端は推定値です（AIP AD 2.12 の座標で直せます）`);
  } else {
    const fx = resolveFix(proc.startFix, ctx);
    if (!fx) { out.warnings.push('開始フィックスを入れてください'); return out; }
    start = { p: fx, alt: Number(proc.startAlt) || 0, c: null };
    out.start = { ...fx, name: fx.name || proc.startFix };
  }
  const main = buildLegs(proc.parts || [], start, ctx, out, false);
  if (proc.type === 'APP' && proc.missed?.length) {
    buildLegs(proc.missed, { ...main.cur, geom: main.prevGeom }, ctx, out, true);
  }
  return out;
}
