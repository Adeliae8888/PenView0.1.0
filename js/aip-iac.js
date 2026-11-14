/* ==== aip-iac.js ==== 進入チャート（IAC）→ APP の手順（0.2.7）
 * RNP（RNAV）：ウェイポイントの座標と役割（IAF/IF/FAF/MAPt/MAHF）の一覧 → IAF ごとに IAF → IF → FAF →（途中のフィックス）→ MAPt を TF でつなぐ（ほぼ自動）
 * 従来型（ILS・LOC・VOR・TACAN 等）：進入経路は図だけ → FAF（座標）→ 滑走路末端（RWxx）の下書き＋図の中の定義（R002/D15.0 HUC 等）を候補として残す（半自動）
 * 復行：「MISSED APPROACH」の文章を読む（SID の文章の読み方＋復行の言い回し）。最後の「hold」は待機のパーツ（入航コースは図から推定）
 * DOM・pdf.js に依存しない（テストでそのまま使う） */
import { parseLatLon, tokens } from './aip-parse.js';
import { Scanner } from './aip-text.js';
import { distanceNm, crossTrackNm } from './geo.js';

const NAME_RE = /^([A-Z][A-Z0-9]{1,5})(?:\(([A-Za-z/ ]+)\))?$/;
const LAT_TOK = /^(\d{6}(?:\.\d+)?[NS])(?:\/(\d{7}(?:\.\d+)?[EW]))?$/;
const LON_TOK = /^\d{7}(?:\.\d+)?[EW]$/;
const ON_FINAL_NM = 0.3;                 // 最終進入の線からこれ以内のフィックスは途中のフィックス（ステップダウン）
const HOLD_NEAR_PX = 90;                 // 待機フィックスの名前からこれ以内の方位を待機の図の方位とみなす
const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const rolesOf = (s) => String(s || '').toUpperCase().split('/').map((r) => r.trim()).filter(Boolean);

/* ==== iacTitle ==== ファイル名「RJAH__IAC (RNP RWY21R)_20260514.pdf」→ { name:'RNP RWY21R', rwy:'21R', rnav:true } */
export function iacTitle(file) {
  const m = String(file || '').match(/__IAC\s*\((.+)\)\s*[＊*]?_\d{8}\.pdf$/i);
  const name = (m ? m[1] : '').replace(/\s+/g, ' ').trim();
  const rwy = name.match(/RWY\s?(\d{2}[LRC]?)/)?.[1] || '';
  return { name, rwy, rnav: /^(RNP|RNAV)/.test(name) };
}

/* ==== nameLeftOf ==== 座標の左（同じ行）の名前「NAKAH」「SEIFA(IAF)」。無ければ真上の名前 */
function nameLeftOf(toks, la) {
  const left = toks.filter((t) => Math.abs(t.y - la.y) < 2 && t.x + t.w <= la.x + 1 && la.x - (t.x + t.w) < 45 && NAME_RE.test(t.t))
    .sort((a, b) => b.x - a.x)[0];
  if (left) return left;
  return toks.filter((t) => NAME_RE.test(t.t) && la.y - t.y > 2 && la.y - t.y < 16 && Math.abs(t.x + t.w / 2 - (la.x + la.w / 2)) < 30)
    .sort((a, b) => (la.y - a.y) - (la.y - b.y))[0] || null;
}

/* ==== roleBelow ==== 名前のすぐ下の「(IAF/MAHF)」「(FAF)」 */
function roleBelow(items, nm) {
  const it = items.find((i) => i.y - nm.y > 3 && i.y - nm.y < 14 && Math.abs(i.x + i.w / 2 - (nm.x + nm.w / 2)) < 22 && /^\s*\([A-Za-z/ ]+\)\s*$/.test(i.s));
  return it ? rolesOf(it.s.replace(/[()]/g, '')) : [];
}

/* ==== iacFixes ==== チャートの座標の一覧 → [{name, lat, lon, roles:['IAF','MAHF']}]（ページの上から順）
 * 書き方：「NAKAH 362609.88N」の下に「(IAF/MAHF) 1402250.78E」、「SEIFA(IAF) 260303.88N/1274448.52E」、従来型の「FAF : 361615.20N/1402739.82E」 */
export function iacFixes(pages) {
  const out = [];
  const add = (f) => { const o = out.find((x) => x.name === f.name); if (o) o.roles = [...new Set([...o.roles, ...f.roles])]; else out.push(f); };
  pages.forEach((page) => {
    const toks = tokens(page.items);
    toks.filter((t) => LAT_TOK.test(t.t)).forEach((la) => {
      const m = la.t.match(LAT_TOK);
      const lo = m[2] || toks.find((t) => LON_TOK.test(t.t) && ((t.y > la.y + 3 && t.y - la.y < 14 && Math.abs(t.x - la.x) < 12) || (Math.abs(t.y - la.y) < 2 && t.x > la.x && t.x - la.x < 70)))?.t;
      const ll = lo && parseLatLon(`${m[1]} ${lo}`);
      const nm = ll && nameLeftOf(toks, la);
      if (!nm) return;
      const [, name, inl] = nm.t.match(NAME_RE);
      add({ name, lat: ll.lat, lon: ll.lon, roles: inl ? rolesOf(inl) : roleBelow(page.items, nm), y: la.y });
    });
    page.lines.forEach((l) => {
      const f = l.text.replace(/\s+/g, ' ').match(/\b(FAF|MAPt|IF|IAF)\s*:\s*(\d{6}(?:\.\d+)?[NS])\s*\/\s*(\d{7}(?:\.\d+)?[EW])/);
      const ll = f && parseLatLon(`${f[2]} ${f[3]}`);
      if (ll) add({ name: f[1].toUpperCase(), lat: ll.lat, lon: ll.lon, roles: [f[1].toUpperCase()], y: l.y });
    });
  });
  return out;
}

/* ==== missedText ==== 「MISSED APPROACH」の下の文章（左揃えの行を「Contact …」の手前まで）。同じ行の文字はつなぐ */
export function missedText(pages) {
  for (const p of pages) {
    const h = p.items.find((i) => /^\s*MISSED APPROACH\s*$/.test(i.s));
    const first = h && p.items.filter((i) => i.y > h.y + 3 && i.y < h.y + 40 && i.x > h.x - 60 && i.x < h.x + 50 && /[a-z]{2}/.test(i.s)).sort((a, b) => a.y - b.y)[0];
    if (!first) continue;
    const rows = p.items.filter((i) => Math.abs(i.x - first.x) < 3 && i.y >= first.y).sort((a, b) => a.y - b.y);
    const out = [];
    let y = first.y;
    for (const r of rows) {
      if (r.y - y > 2.2 * r.h || /^Contact\b/.test(r.s.trim())) break;
      out.push(lineFrom(p.items, r));
      y = r.y;
    }
    return out.join(' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

/* ==== lineFrom ==== 行の始まりの文字から右へ、間の詰まった文字をつなぐ */
function lineFrom(items, r) {
  const same = items.filter((i) => Math.abs(i.y - r.y) < 1.5 && i.x >= r.x).sort((a, b) => a.x - b.x);
  let line = '';
  let x2 = r.x;
  for (const i of same) {
    if (i.x - x2 > 2.5 * i.h) break;
    line += (line && i.x - x2 > 0.2 * i.h ? ' ' : '') + i.s;
    x2 = i.x + i.w;
  }
  return line.trim();
}

/* ==== MissedScanner ==== SID の文章の読み方に、復行の言い回しを足す：
 * Climb to 600FT on HDG028° ／ Climb on HDG222° to 500FT ／ climb to 4000FT via … ／ turn right to 3000FT via … ／ , to O2L51 ／ to GELMA at or below 1200FT ／
 * proceed to MKE VOR/DME ／ At MAPt, ／ and hold (at 4000FT) */
class MissedScanner extends Scanner {
  step() { return this.missedStep() || super.step(); }

  missedStep() {
    let m;
    if (this.eat(/^at MAPt,?/)) return true;
    if ((m = this.eat(/^(?:turn (?:right|left),?\s*)?direct ([A-Z][A-Z0-9]{1,5})\b/))) { this.push({ type: 'tf', to: m[1] }); return true; }
    if ((m = this.eat(/^climb to (\d{3,5})FT(?=\s+on HDG)/))) { this.climbAlt = Number(m[1]); return true; }
    if ((m = this.eat(/^climb on HDG\s?(\d{3})°?\s*(?=,?\s*to intercept)/))) return this.turnHdg(this.lastTurn || 'right', Number(m[1]));
    if ((m = this.eat(/^(?:climb )?on HDG\s?(\d{3})[°˚]?\s*to (\d{3,5})FT/))) return this.headingTo(Number(m[1]), { type: 'alt', alt: Number(m[2]) });
    if ((m = this.eat(/^on HDG\s?(\d{3})[°˚]?(?:\s*to ([A-Z]{2,4})\s?(\d+(?:\.\d+)?)\s?DME)?/))) {
      return this.headingTo(Number(m[1]), m[2] ? { type: 'dme', station: m[2], dist: Number(m[3]) } : { type: 'alt', alt: this.climbAlt });
    }
    if ((m = this.eat(/^(?:climb )?to (\d{3,5})FT(?:,|\s)/))) { this.climbAlt = Number(m[1]); return true; }
    if ((m = this.eat(/^(?:and )?hold(?: at (\d{3,5})FT)?/))) { this.hold = { alt: m[1] ? Number(m[1]) : this.climbAlt || null }; return true; }
    if ((m = this.eat(/^(?:proceed )?to ([A-Z][A-Z0-9]{1,5})(?:\s+(?:VOR\/DME|VORTAC|TACAN|VOR|NDB))?(?: (at or above|at or below|at) (\d{3,5})FT)?/))) {
      const alt = m[2] ? { type: m[2] === 'at or above' ? 'above' : m[2] === 'at or below' ? 'below' : 'at', v: Number(m[3]) } : null;
      this.push({ type: 'tf', to: m[1], alt });
      return true;
    }
    return false;
  }

  headingTo(hdg, end) {
    this.push({ type: 'heading', hdg, end: end.type === 'alt' ? { ...end, grad: this.opts.grad } : end });
    return true;
  }
}

/* ==== readMissed ==== 復行の文章 → { parts, hold:{alt}|null, warn } */
export function readMissed(text, { id, grad = 2.5, kias = 250, bank = 25 }) {
  if (!text) return { parts: [], hold: null, warn: ['復行の文章が読めません'] };
  // 「direct to X」の後の「at or below 1200FT」は「to X at …」と同じに読む
  const t = text.replace(/[˚º]/g, '°').replace(/\btrun\b/g, 'turn').replace(/\bto=/g, 'to ')
    .replace(/\b([A-Z]{2,4}) ?(\d+(?:\.\d+)?) ?DME\b/g, '$1 $2DME').replace(/\b([A-Z]{2,4}) R (\d{3})\b/g, '$1 R$2')
    .replace(/\b([Dd]irect to [A-Z][A-Z0-9]{1,5})( at or below| at or above| at) (\d{3,5}FT)/g, (s, a) => `${a}, cross ${a.split(' ').pop()}${s.slice(a.length)}`);
  const sc = new MissedScanner(t, { id, grad, kias, bank, missed: true }).run();
  sc.cross.forEach((c) => { const p = c.fix && sc.parts.find((q) => q.to === c.fix); if (p) p.alt = c.alt; });
  sc.parts.forEach((p) => { delete p.via; });
  return { parts: sc.parts, hold: sc.hold || null, warn: sc.warn };
}

/* ==== holdCourses ==== 待機の図（挿絵）の入航・出航の方位の組（062°・242° など）。待機フィックスの名前の近くで c と c+180 の2つ
 * 入航コースの文字は矢印でフィックスに入る脚の上（フィックスに近い）、出航は反対側の脚 → { inbound, outbound, dir（出航の脚が入航の右か左か） } */
function holdCourses(pages, fixName) {
  let best = null;
  pages.forEach((p) => {
    const toks = tokens(p.items);
    const degs = toks.map((t) => ({ t, m: t.t.match(/^(\d{3})[°˚]$/) })).filter((d) => d.m);
    toks.filter((t) => t.t.replace(/\(.*$/, '') === fixName).forEach((l) => {
      const fx = { x: l.x + l.w / 2, y: l.y };
      const near = degs.map((d) => ({ c: Number(d.m[1]) % 360, x: d.t.x, y: d.t.y, d: Math.hypot(d.t.x - fx.x, d.t.y - fx.y) })).filter((d) => d.d < HOLD_NEAR_PX);
      near.forEach((a) => near.forEach((b) => {
        if (angDiff(a.c, b.c + 180) < 2 && a.d <= b.d && (!best || a.d + b.d < best.sum)) best = { inb: a, out: b, sum: a.d + b.d };   // 名前に一番近い組（挿絵があれば挿絵）
      }));
    });
  });
  if (!best) return null;
  const { inb, out } = best;
  const r = inb.c * Math.PI / 180;
  const right = (out.x - inb.x) * Math.cos(r) + (out.y - inb.y) * Math.sin(r);   // 画面（北が上・y は下向き）で入航の右＝(cos, sin)
  return { inbound: inb.c, dir: right >= 0 ? 'R' : 'L' };
}

const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/* ==== between ==== a→b の線の上（横ずれ ON_FINAL_NM 以内）で、a と b の間にあるフィックス（a から近い順） */
function between(a, b, fixes) {
  const len = distanceNm(a, b);
  return fixes.filter((f) => f !== a && f !== b && !f.roles.length && Math.abs(crossTrackNm(a, b, f)) < ON_FINAL_NM && distanceNm(a, f) < len && distanceNm(b, f) < len)
    .sort((x, y) => distanceNm(a, x) - distanceNm(a, y));
}

const has = (f, r) => f.roles.includes(r);

/* ==== rnpPath ==== IF → FAF → MAPt（途中のフィックスを含む）と、IAF の一覧 */
function rnpPath(fixes) {
  const mapt = fixes.find((f) => has(f, 'MAPT')) || fixes.find((f) => /^RW\d{2}/.test(f.name));
  const faf = fixes.find((f) => has(f, 'FAF'));
  const iff = fixes.find((f) => has(f, 'IF'));
  if (!mapt || !faf) return null;
  const core = [...(iff ? [iff, ...between(iff, faf, fixes)] : []), faf, ...between(faf, mapt, fixes), mapt];
  const iafs = fixes.filter((f) => has(f, 'IAF') && f !== iff);
  return { core, iafs, mapt };
}

/* ==== iacToProcs ==== 1枚の進入チャート → APP の手順（IAF ごとに1本）。opts：{ icao, source:{file, eff}, defaults:{kias,bank} } */
export function iacToProcs(pages, { icao, source = {}, defaults = {} }) {
  const title = iacTitle(source.file);
  if (!title.name) return [];
  const fixes = iacFixes(pages);
  const wpts = Object.fromEntries(fixes.map((f) => [f.name, { lat: f.lat, lon: f.lon }]));
  const baseId = `aip-${slug(`${icao}-APP-${title.name}`)}`;
  const text = missedText(pages);
  const mi = readMissed(text, { id: `${baseId}-ma`, kias: defaults.kias, bank: defaults.bank });
  const warnings = [...mi.warn];
  const missed = [...mi.parts];
  if (mi.hold) missed.push(holdPart(pages, mi, missed, warnings, baseId));
  const common = { ad: icao, type: 'APP', rwy: title.rwy, derText: '', parents: [], missed, visible: false, wpts, source: { ...source, text }, startAlt: null };
  if (title.rnav) return rnpProcs(title, fixes, baseId, common, warnings);
  return [conventionalProc(title, pages, fixes, baseId, common, warnings)];
}

/* ==== holdPart ==== 復行の最後の待機：フィックス＝最後の点。入航コースと旋回方向は待機の図から。図から読めなければ入ってくる向き（描くときに決める）・右旋回 */
function holdPart(pages, mi, missed, warnings, baseId) {
  const last = missed.at(-1);
  const fixName = last?.to || last?.xFix || '';
  const h = fixName ? holdCourses(pages, fixName) : null;
  warnings.push(h ? `待機（${fixName}）入航 ${String(h.inbound).padStart(3, '0')}°・${h.dir === 'L' ? '左' : '右'}旋回は待機の図から読みました。チャートで確かめてください`
    : `待機（${fixName || '?'}）の入航コースは図から読めません：入ってくる向き・右旋回で描きます（エディターで直せます）`);
  return { id: `${baseId}-hold`, type: 'hold', name: '', inbound: h ? h.inbound : null, dir: h ? h.dir : 'R', min: 1, legNm: null, kias: null, alt: mi.hold.alt ? { type: 'at', v: mi.hold.alt } : null, speed: null, turn: null };
}

/* ==== rnpProcs ==== RNP：IAF ごとに IAF → IF → FAF → … → MAPt（TF）。IAF が無ければ IF（または FAF）から */
function rnpProcs(title, fixes, baseId, common, warnings) {
  const path = rnpPath(fixes);
  if (!path) return [{ ...common, id: baseId, name: title.name, startFix: '', parts: [], warnings: [...warnings, 'FAF・MAPt の座標が読めません'], lastFix: '' }];
  const starts = path.iafs.length ? path.iafs : [null];
  return starts.map((iaf) => {
    const seq = iaf ? [...between(iaf, path.core[0], fixes), ...path.core] : path.core.slice(1);
    const start = iaf || path.core[0];
    const parts = seq.map((f, i) => ({ id: `${baseId}${iaf ? `-${iaf.name}` : ''}-${i + 1}`, type: 'tf', to: f.name, name: '', alt: null, speed: null, turn: null }));
    return {
      ...common, id: `${baseId}${iaf && starts.length > 1 ? `-${iaf.name}` : ''}`, name: `${title.name}${iaf && starts.length > 1 ? ` (${iaf.name})` : ''}`,
      startFix: start.name, parts, warnings: [...warnings], lastFix: path.mapt.name,
    };
  });
}

/* ==== fixHints ==== 図の中の定義（候補）：「NAKAH(IAF) R002/D15.0 HUC」「FAF D5.5 HUC」など。従来型の組み立ての手がかり */
export function fixHints(pages) {
  const out = [];
  pages.forEach((p) => p.lines.forEach((l) => l.segs.forEach((g) => {
    const t = g.text.replace(/\s+/g, ' ').trim();
    const m = t.match(/^(?:R(\d{3})\/)?D(\d+(?:\.\d+)?) ([A-Z]{2,4})$/);
    if (!m) return;
    const near = p.lines.filter((q) => q.y < l.y && l.y - q.y < 26).flatMap((q) => q.segs.filter((s) => Math.abs(s.x - g.x) < 50).map((s) => s.text.trim()))
      .reverse().find((s) => /^(?:[A-Z][A-Z0-9]{2,5}\((?:IAF|IF|FAF|MAPt)\)|IAF|IF|FAF|MAPt)$/.test(s));
    if (near) out.push(`${near}：${m[1] ? `${m[3]} R-${m[1]} ` : `${m[3]} `}D${m[2]}`);
  })));
  return [...new Set(out)];
}

/* ==== profileFixes ==== 断面図の「IDKUS (FAF)」「BUVDI (IF)」と、その真下の「NM to THR」の値（滑走路末端からの距離）→ { FAF:{name, d}, IF:{name, d} } */
export function profileFixes(pages) {
  const out = {};
  pages.forEach((p) => {
    const row = p.items.find((i) => /NM to THR/.test(i.s));
    if (!row) return;
    const nums = p.items.filter((i) => Math.abs(i.y - row.y) < 2 && /^\s*\d+(?:\.\d+)?\s*$/.test(i.s)).map((i) => ({ d: Number(i.s), cx: i.x + i.w / 2 }));
    const toks = tokens(p.items).filter((t) => t.y < row.y && row.y - t.y < 120);
    toks.filter((t) => /^\(?(FAF|IF)\)?$/.test(t.t)).forEach((t) => {
      const role = t.t.replace(/[()]/g, '');
      const cx = t.x + t.w / 2;
      const n = nums.filter((x) => Math.abs(x.cx - cx) < 12).sort((a, b) => Math.abs(a.cx - cx) - Math.abs(b.cx - cx))[0];
      if (!n || out[role]) return;
      const above = t.t.startsWith('(') && toks.find((u) => t.y - u.y > 4 && t.y - u.y < 11 && Math.abs(u.x + u.w / 2 - cx) < 12 && /^[A-Z][A-Z0-9]{2,5}$/.test(u.t));
      out[role] = { name: above ? above.t : role, d: n.d };
    });
  });
  return out;
}

/* ==== conventionalProc ==== 従来型の下書き：IF → FAF → 滑走路末端（RWxx）の直線。位置は座標（あれば）か、断面図の「NM to THR」（末端から延長線上の距離）
 * IAF からの経路（アーク・ラジアル）は図だけなので、図の中の定義を候補（hints）に残して手で足す */
function conventionalProc(title, pages, fixes, baseId, common, warnings) {
  const hints = fixHints(pages);
  const prof = title.rwy ? profileFixes(pages) : {};
  const fixDefs = {};
  hints.forEach((h) => { const m = h.match(/^([A-Z][A-Z0-9]{4})\([A-Za-z]+\)：([A-Z]{2,4} R-\d{3} D[\d.]+)$/); if (m) fixDefs[m[1]] ||= m[2]; });   // 「NAKAH(IAF)：HUC R-002 D15.0」
  const ref = (role) => {
    const coord = fixes.find((f) => has(f, role));
    if (coord) return coord.name;
    const pf = prof[role];
    if (!pf || /^LDA/.test(title.name)) return '';   // LDA の最終進入は滑走路の延長線上に無い
    const expr = `RW${title.rwy} D${pf.d}`;
    if (pf.name === role) return expr;
    fixDefs[pf.name] = expr;
    return pf.name;
  };
  const faf = ref('FAF');
  const iff = ref('IF');
  const seq = [...(iff && faf ? [faf] : []), ...(title.rwy ? [`RW${title.rwy}`] : [])];
  const parts = seq.map((to, i) => ({ id: `${baseId}-${i + 1}`, type: 'tf', to, name: /^RW\d/.test(to) && / D/.test(to) ? (to === faf ? 'FAF' : 'IF') : '', alt: null, speed: null, turn: null }));
  const w = [...warnings, '従来型：IAF から IF・FAF までの経路（アーク・ラジアル）は自動では作りません。候補を見てエディターで足してください'];
  if (!faf) w.push('FAF の位置が読めません（開始フィックスを入れてください）');
  if (!title.rwy) w.push('周回進入：最終進入の行き先はエディターで入れてください');
  if (Object.values(fixDefs).some((v) => /^RW/.test(v)) || /^RW/.test(iff || faf || '')) w.push('IF・FAF は滑走路の延長線上に「末端からの距離」で置いています');
  return { ...common, id: baseId, name: title.name, startFix: iff || faf, parts, hints, fixDefs, warnings: w, lastFix: parts.at(-1)?.to || '' };
}
