/* ==== proc-render.js ==== 手順の描画（画面座標）：線・旋回の弧・復行（破線）・フィックス・AIP 風の注記
 * 高度制限：以上＝下線、以下＝上線、指定高度＝上下線、範囲＝上の値に上線・下の値に下線（AIP の書き方） */
import { esc } from './map-render.js';
import { buildProcedure } from './procgeo.js';
import { isUnverified } from './procedures.js';

const CHAR_PX = 6.6;
const LINE_PX = 12;
const cache = new Map();

/* ==== built ==== 手順の計算結果を、手順と地点データが変わるまで使い回す */
export function built(proc, ctx) {
  const key = JSON.stringify(proc) + ctx.version;
  const hit = cache.get(proc.id);
  if (hit && hit.key === key) return hit.value;
  const value = buildProcedure(proc, ctx);
  cache.set(proc.id, { key, value });
  return value;
}

function polyline(view, pts) {
  return pts.map((g, i) => { const p = view.geoToScreen(g.lat, g.lon); return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join('');
}

/* ==== altSvg ==== 高度制限の文字と上線・下線（x,y はその行の左下） */
function altSvg(alt, x, y) {
  if (!alt?.type || !alt.v) return { svg: '', lines: 0 };
  const line = (yy, w) => `<path class="alt-bar" d="M${x.toFixed(1)} ${yy.toFixed(1)}h${w.toFixed(1)}"/>`;
  const txt = (v, yy) => `<text class="proc-alt" x="${x.toFixed(1)}" y="${yy.toFixed(1)}">${esc(v)}</text>`;
  const w = (v) => String(v).length * CHAR_PX;
  if (alt.type === 'between' && alt.v2) {
    const [hi, lo] = [Math.max(alt.v, alt.v2), Math.min(alt.v, alt.v2)];
    return { svg: txt(hi, y) + line(y - 10, w(hi)) + txt(lo, y + LINE_PX) + line(y + LINE_PX + 3, w(lo)), lines: 2 };
  }
  const v = String(alt.v);
  let bars = '';
  if (alt.type === 'above' || alt.type === 'at') bars += line(y + 3, w(v));
  if (alt.type === 'below' || alt.type === 'at') bars += line(y - 10, w(v));
  return { svg: txt(v, y) + bars, lines: 1 };
}

/* ==== isNamedFix ==== 名前のあるウェイポイント（GOPVU・H1R00 など）。D8.0 HUC・2105FT・手順名-番号 は除く */
export function isNamedFix(name) {
  return /^[A-Z][A-Z0-9]{1,4}$/.test(String(name || ''));
}

/* ==== wptMark ==== 名前のあるフィックスは WPT と同じ形（三角＋右上の名前）で手順の色。ルートに入れた手順は STPT のラベルに名前が出るので三角だけ */
function wptMark(view, f, withName = true) {
  const p = view.geoToScreen(f.lat, f.lon);
  return `<g class="proc-wpt" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><path d="M0-5L4.5 3H-4.5Z"/>${withName ? `<text x="6" y="-4">${esc(f.name)}</text>` : ''}</g>`;
}

/* ==== labelSvg ==== 注記1つ。off＝ドラッグでずらした量（px）。data-lbl でドラッグ対象を特定。名前のあるフィックスは名前を WPT 形式で出すので注記は高度・速度だけ */
function labelSvg(view, proc, l) {
  const s = view.geoToScreen(l.lat, l.lon);
  const off = l.off || { dx: l.kind === 'fix' ? 10 : 0, dy: l.kind === 'fix' ? -8 : -6 };
  const x = s.x + off.dx;
  const y = s.y + off.dy;
  const id = `${proc.id}|${l.partId}|${l.which}`;
  if (l.kind === 'course') {
    return `<text class="proc-crs" data-lbl="${esc(id)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle">${esc(l.text)}</text>`;
  }
  const text = isNamedFix(l.text) ? '' : l.text;
  let out = text ? `<text class="proc-fix" data-lbl="${esc(id)}" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${esc(text)}</text>` : '';
  const a = altSvg(l.alt, x, y + LINE_PX);
  out += a.svg;
  if (l.speed) out += `<text class="proc-spd" x="${x.toFixed(1)}" y="${(y + LINE_PX * (1 + a.lines)).toFixed(1)}">MAX ${esc(l.speed)}KT</text>`;
  const leader = Math.hypot(off.dx, off.dy) > 30 ? `<path class="proc-leader" d="M${s.x.toFixed(1)} ${s.y.toFixed(1)}L${x.toFixed(1)} ${(y - 4).toFixed(1)}"/>` : '';
  return leader + out;
}

/* ==== unverifiedTag ==== チャートから読み込んで未確認の手順：開始点の下に「未確認」 */
function unverifiedTag(view, s) {
  const p = view.geoToScreen(s.lat, s.lon);
  return `<g class="proc-unv" transform="translate(${(p.x - 22).toFixed(1)} ${(p.y + 20).toFixed(1)})"><rect width="44" height="16" rx="3"/><text x="22" y="12" text-anchor="middle">未確認</text></g>`;
}

/* ==== drawProcedures ==== 表示する手順をすべて描く。editingId の手順は強調、activePartId（航法中の区間）は航法色で太く、onRoute（ルートで選んだ手順）は太く */
export function drawProcedures(view, procs, ctx, editingId, activePartId = null, onRoute = new Set()) {
  return procs.map((proc) => {
    const r = built(proc, ctx);
    const unv = isUnverified(proc);
    const cls = `proc${proc.id === editingId ? ' editing' : ''}${onRoute.has(proc.id) ? ' on-route' : ''} proc-${proc.type.toLowerCase()}${unv ? ' unverified' : ''}`;
    let out = (r.guides || []).map((gd) => `<path class="proc-guide" d="${polyline(view, gd)}"/>`).join('');
    out += r.segments.map((sg) => `<path class="proc-line${sg.dashed ? ' missed' : ''}${sg.turn ? ' turn' : ''}${activePartId && sg.partId === activePartId ? ' active' : ''}" d="${polyline(view, sg.pts)}"/>`).join('');
    r.fixes.forEach((f) => {
      if (isNamedFix(f.name)) { out += wptMark(view, f, !onRoute.has(proc.id)); return; }
      const p = view.geoToScreen(f.lat, f.lon);
      out += `<path class="proc-fixmark" d="M${p.x.toFixed(1)} ${(p.y - 5).toFixed(1)}l4.5 8h-9Z"/>`;
    });
    if (r.start && proc.type !== 'SID' && isNamedFix(r.start.name)) out += wptMark(view, r.start, !onRoute.has(proc.id));
    else if (r.start) {
      const p = view.geoToScreen(r.start.lat, r.start.lon);
      out += `<circle class="proc-start${r.start.estimated ? ' est' : ''}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5"/><text class="proc-fix" x="${(p.x + 8).toFixed(1)}" y="${(p.y + 14).toFixed(1)}">${esc(r.start.name || '')}${r.start.estimated ? '（推定）' : ''}</text>`;
    }
    out += r.labels.map((l) => labelSvg(view, proc, l)).join('');
    if (unv && r.start) out += unverifiedTag(view, r.start);
    return `<g class="${cls}">${out}</g>`;
  }).join('');
}
