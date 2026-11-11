/* ==== route-proc.js ==== ルートと手順（SID/STAR/APP）のつなぎ：選べる手順、手順のフィックス → STPT への展開、再同期、復行の点
 * 並び：DEP → SID のフィックス → 経路の STPT → STAR のフィックス → APP のフィックス → DST
 * 手順の点は p.proc = {id, role, partId} と p.mark（'SID' 等）を持つ。id は手順とパーツから決まるので、作図を直しても同じ点として扱える
 * getProc(id) と build(proc) を受け取る（DOM に依存しない） */
import { distanceNm } from './geo.js';
import { makePoint, DEFAULT_CRUISE_ALT } from './route.js';

export const PROC_ROLES = ['SID', 'STAR', 'APP'];
const SAME_FIX_NM = 0.1;            // これより近い点は同じフィックスとみなす（STAR の終点＝APP の開始など）
const USER_FIELDS = ['tos', 'wind', 'phase', 'speed', 'legAlt'];   // 作図を直しても残す、利用者が入れた値

/* ==== destPoint ==== 目的飛行場の点（復行後は末尾ではなくなるので role で探す） */
export function destPoint(route) {
  return route.points.find((p) => p.role === 'dst') || route.points.at(-1) || null;
}

/* ==== procChoices ==== DEP（SID）または DST（STAR・APP）の飛行場の手順 */
export function procChoices(route, role, list) {
  if (!route || route.points.length < 2) return [];
  const ad = (role === 'SID' ? route.points[0] : destPoint(route))?.name;
  return list.filter((p) => p.type === role && p.ad && p.ad === ad);
}

/* ==== fixAlt ==== フィックスの高度（燃料計算用）。高度で終わるレグはその高度、制限があれば制限、無ければ SID は巡航高度・他は前の点の高度
 * SID の「以上」は巡航高度まで上がってよい。範囲は SID は上の値、STAR・APP は下の値（早めに降りる＝燃料は多めに見込む） */
export function fixAlt(f, role, prevAlt, cruise) {
  if (Number.isFinite(f.altEnd)) return f.altEnd;
  const c = f.altC;
  const v = Number(c?.v);
  if (c?.type && v) {
    if (c.type === 'between') {
      const v2 = Number(c.v2) || v;
      return role === 'SID' ? Math.max(v, v2) : Math.min(v, v2);
    }
    if (c.type === 'above' && role === 'SID') return Math.max(v, cruise);
    return v;
  }
  return role === 'SID' ? cruise : prevAlt;
}

function procPoint(route, proc, src, partId, alt, pathNm) {
  const p = makePoint({ name: src.name || proc.type, lat: src.lat, lon: src.lon, alt }, route);
  return { ...p, id: `pp-${proc.id}-${partId}`, proc: { id: proc.id, role: proc.type, partId }, mark: proc.type, pathNm: Number.isFinite(pathNm) ? pathNm : null };
}

/* ==== expandProc ==== 手順 → STPT の並び。prev＝直前の点（高度の引き継ぎ・同じフィックスの省略）。missed＝復行の点 */
export function expandProc(route, proc, b, prev) {
  const cruise = route.cruiseAlt ?? DEFAULT_CRUISE_ALT;
  const out = { points: [], missed: [] };
  let alt = prev?.alt ?? cruise;
  let last = prev;
  if (proc.type !== 'SID' && b.start && !(last && distanceNm(last, b.start) < SAME_FIX_NM)) {
    alt = Number(proc.startAlt) || alt;
    last = procPoint(route, proc, b.start, 'start', alt, null);
    out.points.push(last);
  }
  b.fixes.forEach((f, i) => {
    alt = fixAlt(f, proc.type, alt, cruise);
    // SID の最初のフィックスは飛行場標点から：標点 → 滑走路端の距離を足す
    const extra = proc.type === 'SID' && i === 0 && b.start && prev ? distanceNm(prev, b.start) : 0;
    // 名前の無いフィックス（針路で上昇の終わりなど）は、高度で終わるなら「2105FT」、それ以外は「手順名-番号」
    const name = f.name || (Number.isFinite(f.altEnd) ? `${Math.round(f.altEnd)}FT` : `${proc.name || proc.type}-${i + 1}`);
    const p = procPoint(route, proc, { ...f, name }, f.partId, Math.round(alt), Number.isFinite(f.pathNm) ? f.pathNm + extra : null);
    if (f.missed) { p.mark = 'MA'; out.missed.push(p); } else out.points.push(p);
  });
  return out;
}

/* ==== expandRole ==== route.procs[role] の手順を展開。手順が無い・飛行場が違う → 空。作図できない（地点データ未読込など）→ null＝今の点を残す */
function expandRole(route, role, prev, getProc, build) {
  const id = route.procs?.[role];
  const proc = id ? getProc(id) : null;
  const ad = (role === 'SID' ? route.points[0] : destPoint(route))?.name;
  if (!proc || proc.type !== role || proc.ad !== ad) return { points: [], missed: [] };
  const b = build(proc);
  if (!b.start) return null;
  return expandProc(route, proc, b, prev);
}

/* ==== nextPoints ==== 手順を入れ直した並び（route は変えない） */
export function nextPoints(route, getProc, build) {
  const base = route.points.filter((p) => !p.proc);
  if (base.length < 2) return null;
  const keep = (role) => route.points.filter((p) => p.proc?.role === role);
  const sid = expandRole(route, 'SID', base[0], getProc, build)?.points ?? keep('SID');
  const mid = base.slice(1, -1);
  const star = expandRole(route, 'STAR', (mid.at(-1) || sid.at(-1) || base[0]), getProc, build)?.points ?? keep('STAR');
  const app = expandRole(route, 'APP', (star.at(-1) || mid.at(-1) || sid.at(-1) || base[0]), getProc, build)?.points ?? keep('APP');
  return [base[0], ...sid, ...mid, ...star, ...app, base.at(-1)];
}

const sig = (pts) => JSON.stringify(pts.map((p) => [p.id, p.lat, p.lon, p.alt, p.pathNm ?? null, p.name]));

/* ==== syncRouteProcs ==== 手順の点を作図に合わせて入れ直す。変わったら true。アクティブの点・利用者の入力（TOS・風など）は保つ。復行後は触らない */
export function syncRouteProcs(route, getProc, build) {
  if (route.flight?.missed) return false;
  const next = nextPoints(route, getProc, build);
  if (!next || sig(next) === sig(route.points)) return false;
  const old = new Map(route.points.map((p) => [p.id, p]));
  next.forEach((p) => {
    const o = old.get(p.id);
    if (o && p.proc) USER_FIELDS.forEach((k) => { p[k] = o[k]; });
    if (o) p.skipped = o.skipped;
  });
  const activeId = route.points[route.activeIdx]?.id;
  route.points = next;
  const ai = next.findIndex((p) => p.id === activeId);
  route.activeIdx = ai >= 1 ? ai : Math.min(Math.max(1, route.activeIdx), next.length - 1);
  return true;
}

/* ==== missedPoints ==== 選んだ APP の進入復行の点（MISSED APP で使う）。無ければ [] */
export function missedPoints(route, getProc, build) {
  const id = route.procs?.APP;
  const proc = id ? getProc(id) : null;
  if (!proc || proc.type !== 'APP' || !proc.missed?.length) return [];
  const app = route.points.filter((p) => p.proc?.role === 'APP');
  const prev = app.at(-1) || destPoint(route);
  const b = build(proc);
  return b.start ? expandProc(route, proc, b, prev).missed : [];
}

/* ==== approachPhase ==== アクティブ STPT が APP の点か目的地（＝MISSED APP を出す時期） */
export function approachPhase(route) {
  const p = route.points[route.activeIdx];
  return !!p && (p.proc?.role === 'APP' || p === destPoint(route));
}
