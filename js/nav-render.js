/* ==== nav-render.js ==== 読み込んだ航空データの描画とタップ判定
 * 区域・ルート線は世界座標の固定パス（期間・表示が変わったら作り直す）、点・ラベル・ホールディングは画面座標で毎回描く */
import { GROUPS, navIndex, navItems, isValidIn, limitText, hasGroupPrefix } from './navdata.js';
import { destination, gsiVariation, pointInRing, toTrue } from './geo.js';
import { esc, navaidLabel } from './map-render.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SHOW = { wpt: 1.2, wptLabel: 2, vfr: 2.5, hold: 0.9, obstacle: 3, obstacleLabel: 10, areaLabel: 1.2, routeLabel: 2, navaid: 0.25 };
// ラベルの優先順：訓練・制限・臨時空域を先に（件数上限で ACC 等に押し出されないように）。臨時空域は JSDF 訓練空域と同じ扱い
const LABEL_ORDER = ['aip-restricted', 'aip-jsdf', 'sup-airspace', 'notam-airspace'];
const OBST_ALL_SCALE = 8;          // これ以上拡大したら全障害物
const OBST_TALL_FT = 1000;         // それ未満の縮尺では標高 1000ft 以上だけ          // ラベル同士がこれより近ければ出さない
const HOLD_LEG_NM = 4;
const HOLD_WIDTH_NM = 2.5;
const MAX_LABELS = 60;
const CULL_PX = 40;
// グループごとの表示開始縮尺（これ未満なら点を1つも見ない＝重い障害物データの負荷対策）
const GROUP_MIN_SCALE = { 'aip-wpt': SHOW.wpt, 'aip-vfrrep': SHOW.vfr, 'aip-hold': SHOW.hold, 'obs-area1': SHOW.obstacle, 'obs-area2': SHOW.obstacle, 'obs-sup': SHOW.obstacle, 'notam-obstacle': SHOW.obstacle };
const worldCache = new WeakMap();

/* ==== screenOf ==== 点の画面座標（投影結果をキャッシュ） */
function screenOf(view, it) {
  let w = worldCache.get(it);
  if (!w) { w = view.proj.forward(it.p[1], it.p[0]); worldCache.set(it, w); }
  return view.worldToScreen(w.x, w.y);
}

const POINT_GROUPS = ['aip-wpt', 'aip-vfrrep', 'aip-hold', 'aip-navaid', 'aip-arp', 'obs-area1', 'obs-area2', 'obs-sup', 'notam-obstacle', 'notam-aerodrome', 'sup-navaid'];

/* ==== groupOn ==== グループの表示（設定に無ければモードの既定値） */
export function groupOn(settings, group) {
  const v = settings.layers[`nd:${group}`];
  if (v !== undefined) return v;
  return settings.mode === 'TAC' ? !!GROUPS[group]?.tac : GROUPS[group]?.nav !== false;
}

/* ==== officialHides ==== 公式データがあるとき OpenAIP の空域・障害物を隠すか */
export function officialHides(settings) {
  const prefer = settings.preferOfficial !== false;
  return {
    airspace: prefer && ['aip-jsdf', 'aip-restricted', 'aip-aca', 'aip-ctr'].some((g) => hasGroupPrefix(g)),
    obstacles: prefer && hasGroupPrefix('obs-area1'),
  };
}

function worldPath(proj, ring, close) {
  let d = '';
  ring.forEach(([lon, lat], i) => { const p = proj.forward(lat, lon); d += `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`; });
  return close ? `${d}Z` : d;
}

function subClass(group, item) {
  if (group === 'aip-direct') return /TACAN/i.test(item.a.TYPE || '') ? 'tacan' : 'conv';
  if (group === 'aip-aca') return /MIL/i.test(item.a.RMKS || '') ? 'mil' : '';
  return '';
}

/* ==== buildNavGeo ==== 区域と線：グループ×小分類ごとに1本のパス */
export function buildNavGeo(el, proj, settings, win) {
  el.replaceChildren();
  navIndex().forEach(({ group }) => {
    if (!groupOn(settings, group)) return;
    const paths = {};
    navItems(group).forEach((it) => {
      if (it.k === 'point' || !isValidIn(it, win)) return;
      const key = `${it.k}|${subClass(group, it)}`;
      (paths[key] ||= []).push(worldPath(proj, it.g, it.k === 'area'));
    });
    Object.entries(paths).forEach(([key, list]) => {
      const [kind, sub] = key.split('|');
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('class', `nd nd-${kind} nd-${group}${sub ? ` nd-${sub}` : ''}`);
      p.setAttribute('d', list.join(''));
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      el.appendChild(p);
    });
  });
}

function inView(p, view) {
  return p.x > -CULL_PX && p.y > -CULL_PX && p.x < view.width + CULL_PX && p.y < view.height + CULL_PX;
}

/* ==== holdingSvg ==== 待機経路：インバウンドは磁方位（地点の偏差で真方位へ）、旋回方向 L/R */
function holdingSvg(view, it) {
  const fix = { lat: it.p[1], lon: it.p[0] };
  const inbound = toTrue(Number(it.a.INBD_TR) || 0, gsiVariation(fix.lat, fix.lon) ?? 0);
  const side = (it.a.TURN || 'R').toUpperCase() === 'L' ? -90 : 90;
  const back = destination(fix, inbound + 180, HOLD_LEG_NM);
  const c = destination(back, inbound + side, HOLD_WIDTH_NM);
  const d = destination(fix, inbound + side, HOLD_WIDTH_NM);
  const [A, B, C, D] = [fix, back, c, d].map((g) => view.geoToScreen(g.lat, g.lon));
  if (!inView(A, view)) return '';
  const r = Math.hypot(A.x - D.x, A.y - D.y) / 2;
  const sweep = side > 0 ? 1 : 0;
  return `<path class="hold" d="M${A.x.toFixed(1)} ${A.y.toFixed(1)}L${B.x.toFixed(1)} ${B.y.toFixed(1)}A${r.toFixed(1)} ${r.toFixed(1)} 0 0 ${1 - sweep} ${C.x.toFixed(1)} ${C.y.toFixed(1)}L${D.x.toFixed(1)} ${D.y.toFixed(1)}A${r.toFixed(1)} ${r.toFixed(1)} 0 0 ${1 - sweep} ${A.x.toFixed(1)} ${A.y.toFixed(1)}"/>`;
}

function pointSvg(view, group, it, knownIdents) {
  const s = screenOf(view, it);
  if (!inView(s, view)) return '';
  const at = `transform="translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})"`;
  const k = view.scale;
  if (group === 'aip-wpt') return k < SHOW.wpt ? '' : `<g class="wpt" ${at}><path d="M0-5L4.5 3H-4.5Z"/>${k >= SHOW.wptLabel ? `<text x="6" y="-4">${esc(it.n)}</text>` : ''}</g>`;
  if (group === 'aip-vfrrep') return k < SHOW.vfr ? '' : `<g class="vfr" ${at}><circle r="3.5"/><text x="6" y="-4">${esc(it.n)}</text></g>`;
  if (group === 'aip-hold') return k < SHOW.hold ? '' : holdingSvg(view, it);
  if (group === 'aip-navaid' || group === 'aip-arp') {
    if (knownIdents.has(it.n) || k < SHOW.navaid) return '';
    const cls = group === 'aip-navaid' ? 'nav' : 'apt';
    const shape = cls === 'nav' ? '<path d="M-6 0L-3-5.2H3L6 0 3 5.2H-3Z"/><circle r="1.5"/>' : '<circle r="5"/><path d="M-8 0H8M0-8V8"/>';
    const label = cls === 'nav' && k >= 2 ? navaidLabel(it.n, it.a.TYPE, it.a.FREQ, it.a.CH) : it.n;
    return `<g class="${cls}" ${at}>${shape}<text x="8" y="-6">${esc(label)}</text></g>`;
  }
  if (group.startsWith('obs-') || group === 'notam-obstacle') {
    if (k < SHOW.obstacle) return '';
    const elev = it.a.elev ?? it.a.ELEV ?? '';
    if (k < OBST_ALL_SCALE && !(parseFloat(elev) >= OBST_TALL_FT)) return '';
    return `<g class="obs${group === 'notam-obstacle' ? ' notam' : ''}" ${at}><path d="M-4 3L0-6 4 3Z"/>${k >= SHOW.obstacleLabel ? `<text x="5" y="-4">${esc(String(elev).replace(/FT$/, ''))}</text>` : ''}</g>`;
  }
  return `<g class="ndpt" ${at}><circle r="4"/>${k >= SHOW.wptLabel ? `<text x="6" y="-4">${esc(it.n)}</text>` : ''}</g>`;
}

/* ==== shortName ==== 長い区域名を縮める（temporary training area → TTA 等） */
const ABBR = [[/temporary training areas?/i, 'TTA'], [/temporary reserved airspace/i, 'TRA'], [/training areas?/i, 'TA'], [/\s{2,}/g, ' ']];
function shortName(n) {
  return ABBR.reduce((s, [re, to]) => s.replace(re, to), String(n || '')).trim();
}

/* ==== labelBox ==== ラベルの画面上の範囲（文字数から幅を見積もる）。重なり判定に使う */
const CHAR_PX = 6.6;
const LINE_PX = 12;
function labelBox(s, lines) {
  const w = Math.max(...lines.map((t) => t.length)) * CHAR_PX;
  return { x0: s.x - w / 2, x1: s.x + w / 2, y0: s.y - LINE_PX, y1: s.y + LINE_PX * (lines.length - 1) + 3 };
}

function overlaps(a, list) {
  return list.some((b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);
}

function rank(group) {
  const i = LABEL_ORDER.indexOf(group);
  return i < 0 ? LABEL_ORDER.length : i;
}

function centroid(g) {
  const n = g.length;
  return g.reduce((a, c) => [a[0] + c[0] / n, a[1] + c[1] / n], [0, 0]);
}

/* ==== labelsSvg ==== 区域名（上限・下限）とルート名（線の中央）。数を制限 */
function labelsSvg(view, settings, win) {
  const out = [];
  const placed = [];
  const groups = navIndex().map((r) => r.group).sort((a, b) => rank(a) - rank(b));
  groups.forEach((group) => {
    if (!groupOn(settings, group) || view.scale < SHOW.areaLabel) return;
    navItems(group).forEach((it) => {
      if (out.length >= MAX_LABELS || it.k === 'point' || !isValidIn(it, win)) return;
      if (it.k === 'line' && view.scale < SHOW.routeLabel) return;
      const c = it.k === 'area' ? centroid(it.g) : it.g[Math.floor(it.g.length / 2)];
      const s = view.geoToScreen(c[1], c[0]);
      if (s.x < 0 || s.y < 0 || s.x > view.width || s.y > view.height) return;
      const name = shortName(it.n);
      const sub = it.k === 'area' ? limitText(it) : it.a.MEA ? `MEA ${it.a.MEA}` : '';
      const box = labelBox(s, sub ? [name, sub] : [name]);
      if (overlaps(box, placed)) return;
      placed.push(box);
      out.push(`<text class="nd-lbl ${it.k}" x="${s.x.toFixed(1)}" y="${s.y.toFixed(1)}" text-anchor="middle">${esc(name)}${sub ? `<tspan x="${s.x.toFixed(1)}" dy="${LINE_PX}">${esc(sub)}</tspan>` : ''}</text>`);
    });
  });
  return out.join('');
}

/* ==== drawNavOverlay ==== 画面座標の点・ホールディング・ラベル */
export function drawNavOverlay(view, state, win) {
  const s = state.settings;
  const known = new Set([...state.data.navaids.map((n) => n.ident), ...state.data.airports.map((a) => a.icao)]);
  const parts = [labelsSvg(view, s, win)];
  POINT_GROUPS.forEach((group) => {
    if (!groupOn(s, group) || view.scale < (GROUP_MIN_SCALE[group] || 0)) return;
    navItems(group).forEach((it) => { if (it.k === 'point' && isValidIn(it, win)) parts.push(pointSvg(view, group, it, known)); });
  });
  return parts.join('');
}

/* ==== navHits ==== タップ位置の近くの点（WPT・VFR・公式 NAVAID 等）と、その点を含む区域・近くのルート線 */
export function navHits(view, state, sx, sy, geo, win) {
  const s = state.settings;
  const areas = [];
  navIndex().forEach(({ group }) => {
    if (!groupOn(s, group)) return;
    navItems(group).forEach((it) => {
      if (!isValidIn(it, win)) return;
      if (it.k === 'area' && pointInRing(geo.lon, geo.lat, it.g)) {
        areas.push(`${GROUPS[group]?.label}：${it.n} ${limitText(it)}${it.a.NOTAM ? ` ${it.a.NOTAM}` : ''}`);
      } else if (it.k === 'line' && nearLine(view, it.g, sx, sy)) {
        areas.push(`${it.n}${it.a.MEA ? ` MEA ${it.a.MEA}` : ''}${it.a.MAG_TR ? ` ${it.a.MAG_TR}°M` : ''}${it.a.DIST ? ` ${it.a.DIST}nm` : ''}`);
      }
    });
  });
  return { near: navNearPoints(view, state, sx, sy, win), areas: areas.slice(0, 12) };
}

/* ==== navNearPoints ==== 画面の (sx,sy) から radius px 以内の NAV データの点（表示中のグループのみ）。ルーラーの吸い付けにも使う */
export function navNearPoints(view, state, sx, sy, win, radius = 22) {
  const s = state.settings;
  const near = [];
  const known = new Set([...state.data.navaids.map((n) => n.ident), ...state.data.airports.map((a) => a.icao)]);
  navIndex().forEach(({ group }) => {
    if (!groupOn(s, group)) return;
    navItems(group).forEach((it) => {
      if (it.k !== 'point' || !isValidIn(it, win)) return;
      if ((group === 'aip-navaid' || group === 'aip-arp') && known.has(it.n)) return;   // OpenAIP と同じ地点は二重に出さない
      const p = screenOf(view, it);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < radius) near.push({ kind: group, d, name: it.n, label: `${it.n}（${GROUPS[group]?.label || group}）`, lat: it.p[1], lon: it.p[0] });
    });
  });
  return near;
}

function nearLine(view, g, sx, sy) {
  for (let i = 1; i < g.length; i += 1) {
    const a = view.geoToScreen(g[i - 1][1], g[i - 1][0]);
    const b = view.geoToScreen(g[i][1], g[i][0]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((sx - a.x) * dx + (sy - a.y) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(a.x + t * dx - sx, a.y + t * dy - sy) < 10) return true;
  }
  return false;
}

/* ==== navCatalogPoints ==== 地点検索用：WPT・VFR REP・公式 NAVAID/飛行場（OpenAIP に無いもの） */
export function navCatalogPoints(knownIdents) {
  const out = [];
  [['aip-wpt', 'WPT'], ['aip-vfrrep', 'VFR'], ['aip-navaid', 'NAVAID'], ['aip-arp', 'AD']].forEach(([group, t]) => {
    navItems(group).forEach((it) => {
      if (it.k !== 'point' || ((group === 'aip-navaid' || group === 'aip-arp') && knownIdents.has(it.n))) return;
      out.push({ n: it.n, t: group === 'aip-vfrrep' ? `VFR ${it.a.AD || ''}` : it.a.TYPE || t, p: it.p });
    });
  });
  return out;
}
