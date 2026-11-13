/* ==== aip-parse.js ==== AIP の PDF（pdf-text.js のページ）から、滑走路（AD 2.12／2.13）と RNAV の SID/STAR/TRANSITION（ARINC 424 の表）を読む
 * DOM・pdf.js に依存しない（テストでそのまま使う） */
import { destination, bearingTrue, distanceNm } from './geo.js';

const DESIG = '(?:0[1-9]|[12]\\d|3[0-6])[LRC]?';
const DESIG_RE = new RegExp(`^(${DESIG})\\b`);
const LAT_RE = /(\d{2})(\d{2})(\d{2}(?:\.\d+)?)\s*([NS])/;
const LON_RE = /(\d{3})(\d{2})(\d{2}(?:\.\d+)?)\s*([EW])/;
const M_PER_NM = 1852;
const NUM_WORDS = { ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5', SIX: '6', SEVEN: '7', EIGHT: '8', NINE: '9' };
const PATHS = new Set(['IF', 'TF', 'DF', 'CF', 'VA', 'CA', 'FA', 'VI', 'CI', 'VM', 'FM', 'RF', 'AF', 'HM', 'HA', 'HF', 'FC', 'FD', 'CD', 'VD', 'PI']);

const dms = (d, m, s, h) => (Number(d) + Number(m) / 60 + Number(s) / 3600) * (/[SW]/.test(h) ? -1 : 1);

/* ==== parseLatLon ==== 「361013.29N」「1402429.73E」（同じ文字列でも別でも） */
export function parseLatLon(text) {
  const a = String(text).match(LAT_RE);
  const b = String(text).replace(a?.[0] || '', ' ').match(LON_RE);
  return a && b ? { lat: dms(a[1], a[2], a[3], a[4]), lon: dms(b[1], b[2], b[3], b[4]) } : null;
}

/* ==== sectionLines ==== start の文字を含む行から end の文字を含む行の手前まで（ページをまたぐ） */
function sectionLines(pages, start, end) {
  const out = [];
  let on = false;
  pages.forEach((p) => p.lines.forEach((l) => {
    if (!on && l.text.includes(start)) { on = true; return; }
    if (on && l.text.includes(end)) on = false;
    if (on) out.push(l.text.replace(/\s+/g, ' '));
  }));
  return out;
}

/* ==== opposite ==== 03L ↔ 21R */
export function oppositeRwy(d) {
  const n = Number(d.slice(0, 2));
  const s = d.slice(2);
  return `${String(((n + 17) % 36) + 1).padStart(2, '0')}${{ L: 'R', R: 'L', C: 'C' }[s] || ''}`;
}

/* ==== allLatLon ==== 文字列の中の座標をすべて（出てくる順） */
function allLatLon(text) {
  const lats = [...text.matchAll(new RegExp(LAT_RE.source, 'g'))];
  const lons = [...text.matchAll(new RegExp(LON_RE.source, 'g'))].filter((m) => !lats.some((a) => m.index >= a.index && m.index < a.index + a[0].length));
  return lats.map((a, i) => (lons[i] ? { lat: dms(a[1], a[2], a[3], a[4]), lon: dms(lons[i][1], lons[i][2], lons[i][3], lons[i][4]) } : null)).filter(Boolean);
}

/* ==== parseRunwayBlocks ==== AD 2.12：滑走路ごとの行のかたまり → 真方位・長さ・THR 座標・THR 標高
 * 末端がずれた滑走路（羽田 16L など）は「滑走路の始まり」と「(Displaced THR)」の2つの座標がある → end＝始まり、thr＝ずれた末端 */
function parseRunwayBlocks(lines) {
  const blocks = [];
  lines.forEach((t) => {
    const m = t.match(DESIG_RE);
    if (m && /°|issued|\d{3,5}\s*[×x]\s*\d/.test(t)) blocks.push({ d: m[1], text: t });
    else if (blocks.length) blocks.at(-1).text += ` ${t}`;
  });
  return blocks.map((b) => {
    const t = b.text.slice(b.d.length);
    const brg = t.match(/(\d{1,3}(?:\.\d+)?)\s*°/);
    const dim = t.match(/(\d{3,5})\s*[×x]\s*\d{2,3}/);
    const pts = allLatLon(t);
    const displaced = /Displaced THR/i.test(t) && pts.length >= 2;
    const el = t.match(/THR(?:\s*ELEV)?\s*:?\s*(-?\d+(?:\.\d+)?)\s*f(?:ee)?t/i);
    return { d: b.d, trueBrg: brg ? Number(brg[1]) : null, len: dim ? Number(dim[1]) : null, end: pts[0] || null, thr: displaced ? pts[1] : pts[0] || null, displaced, elev: el ? Number(el[1]) : null };
  }).filter((r) => r.thr);
}

/* ==== parseDeclared ==== AD 2.13：TORA・LDA */
function parseDeclared(lines) {
  const out = {};
  lines.forEach((t) => {
    const m = t.match(new RegExp(`^(${DESIG})\\s+(\\d{3,5}|-)\\s+(\\d{3,5}|-)\\s+(\\d{3,5}|-)\\s+(\\d{3,5}|-)`));
    if (m) out[m[1]] = { tora: Number(m[2]) || null, lda: Number(m[5]) || null };
  });
  return out;
}

/* ==== parseAd2 ==== AD2 → { icao, runways:[{d, hdg（真）, len, thr, der, elev}] }
 * DER（離陸の滑走路端）＝反対側の滑走路の始まり。始まりの座標が無い（ずれた末端だけ）なら、反対側の THR から TORA − LDA だけ外へ。
 * 真方位が未公表なら両端の座標から */
export function parseAd2(pages) {
  const all = pages.flatMap((p) => p.lines.map((l) => l.text)).join('\n');
  const icao = all.match(/\b([A-Z]{4}) AD 2\.12/)?.[1] || null;
  const rwys = parseRunwayBlocks(sectionLines(pages, 'AD 2.12', 'AD 2.13'));
  const decl = parseDeclared(sectionLines(pages, 'AD 2.13', 'AD 2.14'));
  const byD = Object.fromEntries(rwys.map((r) => [r.d, r]));
  const runways = rwys.map((r) => {
    const o = byD[oppositeRwy(r.d)];
    const hdg = r.trueBrg ?? (o ? bearingTrue(r.thr, o.thr) : null);
    let der = null;
    if (o && Number.isFinite(hdg)) {
      const dd = decl[o.d];
      const disp = !o.displaced && dd?.tora && dd?.lda && dd.tora > dd.lda ? dd.tora - dd.lda : 0;
      der = destination(o.end || o.thr, hdg, disp / M_PER_NM);
    }
    return { d: r.d, hdg, len: r.len, thr: r.thr, der, elev: r.elev, tora: decl[r.d]?.tora ?? null, lda: decl[r.d]?.lda ?? null };
  });
  return { icao, runways };
}

/* ==== procName ==== 「TIARA TWO A DEPARTURE」→「TIARA2A」、「KURIS 1G ARRIVAL」→「KURIS1G」 */
export function procName(title) {
  const words = title.replace(/\b(DEPARTURE|ARRIVAL|TRANSITION)\b/g, '').trim().split(/\s+/);
  let out = words[0] || '';
  words.slice(1).forEach((w, i) => {
    const prev = words[i];
    const num = NUM_WORDS[w] || (/^\d[A-Z]?$/.test(w) ? w : null);
    if (num) out += num;
    else if (/^[A-Z]$/.test(w) && (NUM_WORDS[prev] || /^\d$/.test(prev))) out += w;
    else out += ` ${w}`;
  });
  return out;
}

/* ==== joinGlyphs ==== 1字ずつ別になった文字（T I A R A）を、同じ行で隙間がほとんど無ければつなぐ */
function joinGlyphs(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  sorted.forEach((it) => {
    const last = out.findLast((o) => Math.abs(o.y - it.y) < 1.5 && it.x >= o.x);
    if (last && it.x - (last.x + last.w) < 0.25 * it.h && it.x - (last.x + last.w) > -0.5 * it.h) {
      last.s += it.s;
      last.w = it.x + it.w - last.x;
    } else out.push({ ...it });
  });
  return out;
}

/* ==== tokens ==== 行の文字（items）を空白で区切った語に（x・幅つき） */
function tokens(items) {
  return joinGlyphs(items).flatMap((it) => {
    const parts = it.s.split(/(\s+)/);
    const cw = it.w / Math.max(1, it.s.length);
    let off = 0;
    return parts.map((p) => { const t = { t: p, x: it.x + off * cw, w: p.length * cw, y: it.y }; off += p.length; return t; }).filter((t) => t.t.trim());
  }).sort((a, b) => a.x - b.x);
}

/* ==== altConstraint ==== 「+600」「-7000」「9000」「FL150」、2つなら範囲 */
export function altConstraint(list) {
  const vals = list.map((s) => {
    const m = s.match(/^([+-]?)(FL)?(\d{3,5})$/);
    if (!m) return null;
    return { sign: m[1], v: m[2] ? Number(m[3]) * 100 : Number(m[3]) };
  }).filter(Boolean);
  if (!vals.length) return null;
  if (vals.length >= 2) {
    const hi = vals.find((a) => a.sign === '-')?.v ?? Math.max(...vals.map((a) => a.v));
    const lo = vals.find((a) => a.sign === '+')?.v ?? Math.min(...vals.map((a) => a.v));
    return { type: 'between', v: hi, v2: lo };
  }
  const a = vals[0];
  return { type: a.sign === '+' ? 'above' : a.sign === '-' ? 'below' : 'at', v: a.v };
}

const COLS = ['Serial', 'Path', 'Waypoint', 'Fly', 'Course', 'Magnetic', 'Distance', 'Turn', 'Altitude', 'Speed', 'Vertical', 'Navigation'];

/* ==== headerColumns ==== 見出しの語の中心 x → 列 */
function headerColumns(page, headerY) {
  const head = tokens(page.items.filter((it) => Math.abs(it.y - headerY) < 2));
  return COLS.map((c) => { const t = head.find((h) => h.t === c); return t ? { c, x: t.x + t.w / 2 } : null; }).filter(Boolean);
}

/* ==== tableRows ==== 1つの表（"Serial" の見出しの下）→ レグの配列。行＝通し番号の行。コース・2段目の高度は行の上下にある */
function tableRows(page, headerY, endY) {
  const cols = headerColumns(page, headerY);
  const toks = tokens(page.items.filter((it) => it.y > headerY + 13 && it.y < endY));   // 見出しは2行（Serial … ／ Number …）
  const colOf = (t) => cols.reduce((best, c) => (Math.abs(t.x + t.w / 2 - c.x) < Math.abs(t.x + t.w / 2 - best.x) ? c : best), cols[0])?.c;
  const serials = toks.filter((t) => /^\d{3}$/.test(t.t) && colOf(t) === 'Serial').sort((a, b) => a.y - b.y);
  return serials.map((s, i) => {
    const top = i ? (serials[i - 1].y + s.y) / 2 : headerY + 13;
    const bot = i < serials.length - 1 ? (s.y + serials[i + 1].y) / 2 : Math.min(endY, s.y + 14);
    const cells = {};
    toks.filter((t) => t.y > top && t.y < bot && t !== s).forEach((t) => {
      const c = colOf(t);
      (cells[c] ||= []).push({ ...t, onRow: Math.abs(t.y - s.y) < 2 });
    });
    return rowLeg(s.t, cells);
  }).filter(Boolean);
}

/* ==== rowLeg ==== 列ごとの語 → レグ */
function rowLeg(serial, cells) {
  const on = (c, re) => (cells[c] || []).find((t) => t.onRow && re.test(t.t))?.t ?? null;
  const any = (c, re) => (cells[c] || []).filter((t) => re.test(t.t)).map((t) => t.t);
  const path = on('Path', /^[A-Z]{2}$/);
  if (!path || !PATHS.has(path)) return null;
  const course = any('Course', /^\d{3}$/)[0];
  // Waypoint の列がずれて読めたときは、行の中で Path の右・Magnetic の左にある識別子（Fly over の Y は除く）
  const rowToks = Object.values(cells).flat().filter((t) => t.onRow).sort((x, y) => x.x - y.x);
  const pathTok = rowToks.find((t) => t.t === path);
  const magTok = rowToks.find((t) => /^[-+]?\d{1,2}\.\d$/.test(t.t));
  const wpt = on('Waypoint', /^[A-Z][A-Z0-9]{1,5}$/)
    ?? rowToks.find((t) => pathTok && t.x > pathTok.x && (!magTok || t.x < magTok.x) && /^[A-Z][A-Z0-9]{1,5}$/.test(t.t) && t.t !== 'Y')?.t ?? null;
  return {
    serial, path, wpt, course: course ? Number(course) : null,
    dist: Number(on('Distance', /^\d+(\.\d+)?$/)) || null, turn: on('Turn', /^[LR]$/),
    alt: altConstraint(any('Altitude', /^[+-]?(FL)?\d{3,5}$/)), speed: Number(any('Speed', /^\d{3}$/)[0]) || null,
  };
}

/* ==== labelStacks ==== 図の中の「名前／緯度／経度」の縦の並び（那覇など座標表の無いチャート） */
function labelStacks(page, out) {
  const toks = tokens(page.items);
  toks.filter((t) => /^\d{6}(\.\d+)?[NS]$/.test(t.t)).forEach((la) => {
    const lo = toks.find((t) => /^\d{7}(\.\d+)?[EW]$/.test(t.t) && t.y > la.y && t.y - la.y < 16 && Math.abs(t.x - la.x) < 16);
    const nm = toks.filter((t) => /^[A-Z][A-Z0-9]{1,5}$/.test(t.t) && la.y - t.y > 2 && la.y - t.y < 16 && Math.abs(t.x + t.w / 2 - (la.x + la.w / 2)) < 30)
      .sort((x, y) => (la.y - x.y) - (la.y - y.y))[0];
    const ll = lo && parseLatLon(`${la.t} ${lo.t}`);
    if (nm && ll && !out[nm.t]) out[nm.t] = ll;
  });
}

/* ==== waypointTable ==== 「Waypoint Coordinates」の表（無ければ図の中の縦の並び）→ { NAME: {lat, lon} } */
export function waypointTable(pages) {
  const out = {};
  pages.forEach((p) => labelStacks(p, out));
  const re = /\b([A-Z][A-Z0-9]{1,5})\s+(\d{6}(?:\.\d+)?\s*[NS])\s*\/?\s*(\d{7}(?:\.\d+)?\s*[EW])/g;
  pages.forEach((p) => p.lines.forEach((l) => {
    for (const m of l.text.replace(/\s+/g, ' ').matchAll(re)) {
      const ll = parseLatLon(`${m[2]} ${m[3]}`);
      if (ll) out[m[1]] = ll;   // 表の値を優先
    }
  }));
  return out;
}

/* ==== findTables ==== 表の見出し（Serial）ごとに、直前の題名（… DEPARTURE/ARRIVAL/TRANSITION）と滑走路（RWY34L/RWY34R）を付ける */
export function findTables(pages) {
  const tables = [];
  let title = null;
  let rwys = [];
  pages.forEach((page) => {
    const heads = page.lines.filter((l) => /\bSerial\b/.test(l.text));
    page.lines.forEach((l) => {
      l.segs.forEach((g) => {
        const t = g.text.replace(/\s+/g, ' ').replace(/\s*RNA?V\s?\d.*$|\s*RNP\s?\d.*$/, '').trim();
        const tm = t.match(/^([A-Z][A-Z0-9 ]*? (DEPARTURE|ARRIVAL|TRANSITION))$/);
        if (tm && !t.includes('/') && !/^(RNAV|RNP|SID|STAR)\b/.test(t) && t.split(' ').length <= 6) { title = tm[1]; rwys = []; }
        const rm = t.match(/^RWY ?(\d{2}[LRC]?(?:\s*\/\s*(?:RWY ?)?\d{2}[LRC]?)*)$/);
        if (rm) rwys = rm[1].split('/').map((s) => s.replace(/RWY|\s/g, ''));
      });
      const hi = heads.indexOf(l);
      if (hi >= 0 && title) {
        const end = heads[hi + 1]?.y ?? page.lines.find((x) => x.y > l.y && /Waypoint Coordinates|Civil Aviation Bureau/.test(x.text))?.y ?? Infinity;
        const nextRwy = page.lines.find((x) => x.y > l.y && x.y < end && /^RWY ?\d{2}[LRC]?/.test(x.text.trim()));
        tables.push({ title, rwys: [...rwys], legs: tableRows(page, l.y, nextRwy?.y ?? end) });
      }
    });
  });
  return tables.filter((t) => t.legs.length);
}

/* ==== gradientNotes ==== 「RWY03L : 4.1% climb gradient required up to 600FT」→ { '03L': 4.1 }（「RWY34R/34L」も） */
export function gradientNotes(pages) {
  const out = {};
  pages.forEach((p) => p.lines.forEach((l) => {
    const m = l.text.replace(/\s+/g, ' ').match(/RWY ?(\d{2}[LRC]?(?:\s*\/\s*(?:RWY ?)?\d{2}[LRC]?)*)\s*:\s*(\d+(?:\.\d+)?)\s*% climb gradient/i);
    if (m) m[1].split('/').map((s) => s.replace(/RWY|\s/g, '')).forEach((d) => { out[d] = Number(m[2]); });
  }));
  return out;
}

const procKind = (title) => (/DEPARTURE/.test(title) ? 'SID' : /ARRIVAL/.test(title) ? 'STAR' : 'TRANSITION');
const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ==== legPart ==== ARINC 424 のレグ → 手順のパーツ。VA/CA＝針路で上昇（高度で終わり）、DF/TF/CF＝直線（→フィックス） */
function legPart(leg, id, grad) {
  const base = { id, name: '', alt: null, speed: leg.speed || null, turn: null };
  if (leg.path === 'VA' || leg.path === 'CA') {
    return { ...base, type: 'heading', hdg: leg.course, end: { type: 'alt', alt: leg.alt?.v ?? null, grad: grad || 3.3 } };
  }
  if (['DF', 'TF', 'CF', 'IF'].includes(leg.path) && leg.wpt) return { ...base, type: 'tf', to: leg.wpt, alt: leg.alt };
  return null;
}

/* ==== legsToProc ==== 表1つ（＋滑走路）→ 手順。IF は開始フィックス。使うウェイポイントの座標を proc.wpts に持たせる */
function legsToProc(table, rwy, { icao, wpts, grads, source }) {
  const type = procKind(table.title);
  const name = procName(table.title);
  const id = `aip-${slug(`${icao}-${type}-${name}${rwy ? `-${rwy}` : ''}`)}`;
  const warnings = [];
  const legs = [...table.legs];
  let startFix = '';
  let startAlt = null;
  if (type !== 'SID' && legs[0]?.path === 'IF') {
    const f = legs.shift();
    startFix = f.wpt || '';
    startAlt = f.alt?.v ?? null;
  }
  const parts = legs.map((l, i) => {
    const pt = legPart(l, `${id}-${l.serial || i}`, rwy ? grads[rwy] : null);
    if (!pt) warnings.push(`${l.serial} ${l.path}：未対応のレグ`);
    return pt;
  }).filter(Boolean);
  const used = [startFix, ...parts.map((p) => p.to)].filter(Boolean);
  const own = {};
  used.forEach((n) => { if (wpts[n]) own[n] = wpts[n]; else warnings.push(`${n}：座標が PDF にありません（登録済みの地点から探します）`); });
  return {
    id, ad: icao, type, name, rwy: rwy || '', derText: '', startFix, startAlt, parents: [], parts, missed: [], visible: false,
    wpts: own, source, warnings, lastFix: parts.at(-1)?.to || startFix,
  };
}

/* ==== tablesToProcs ==== 1つの PDF の表 → 手順の配列。SID は滑走路ごとに1本（同じ内容が続くページは1本に）
 * side＝その PDF が SID か STAR か（TRANSITION をどちらにつなぐか） */
export function tablesToProcs(pages, { icao, source, side = null }) {
  const tables = findTables(pages);
  const wpts = waypointTable(pages);
  const grads = gradientNotes(pages);
  const out = [];
  tables.forEach((t) => {
    const rwys = procKind(t.title) === 'SID' && t.rwys.length ? t.rwys : [null];
    rwys.forEach((rwy) => {
      const p = legsToProc(t, rwy, { icao, wpts, grads, source });
      if (p.type === 'TRANSITION' && side) p.side = side;
      if (!out.some((q) => q.id === p.id)) out.push(p);
    });
  });
  return out;
}

const firstFix = (p) => p.startFix || p.parts[0]?.to || '';
const lastFixOf = (p) => p.lastFix || p.parts.at(-1)?.to || p.parts.at(-1)?.name || '';

/* ==== linkTransitions ==== TRANSITION の親：最初のフィックスで終わる SID、または最後のフィックスから始まる STAR（同じ飛行場、既存の手順も含めて） */
export function linkTransitions(procs, existing = []) {
  const pool = [...procs, ...existing.filter((e) => !procs.some((p) => p.id === e.id))];
  procs.filter((t) => t.type === 'TRANSITION').forEach((t) => {
    const sids = t.side === 'STAR' ? [] : pool.filter((p) => p.type === 'SID' && p.ad === t.ad && lastFixOf(p) && lastFixOf(p) === firstFix(t));
    const stars = t.side === 'SID' ? [] : pool.filter((p) => p.type === 'STAR' && p.ad === t.ad && firstFix(p) && firstFix(p) === lastFixOf(t));
    t.parents = [...new Set([...(t.parents || []), ...sids.map((p) => p.id), ...stars.map((p) => p.id)])];
    if (!t.parents.length) t.warnings = [...(t.warnings || []), 'つながる SID・STAR が見つかりません（手順の編集で選べます）'];
  });
  return procs;
}
