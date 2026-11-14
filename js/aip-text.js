/* ==== aip-text.js ==== 従来型の SID/STAR/TRANSITION の文章（AIP のチャートの上の説明文）→ 手順。規則で読み、読めない文は警告に残す
 * 読む言い回し：Climb (via) RWY HDG to 600FT / until CHE 6.3DME、Climb direct to X、turn right HDG 146° to intercept and proceed via CVT R011、
 *   via HUC R047 to GOPVU / to 30.0DME / until crossing YOE R301、via HUC 26.0DME clockwise ARC to TAIYO / to intercept and proceed via ITE R141、
 *   direct to X、From over X、Cross X / STN Rnnn/D.DDME at or above / at or below / at / between …
 * 2本の滑走路で共通の続き（「turn right,...」「...to intercept …」）はつなぐ。DOM・pdf.js に依存しない */
import { altConstraint, procName, gradientNotes, waypointTable } from './aip-parse.js';

const NAVTYPE = '(?:\\s+(?:VOR\\/DME|VORTAC|TACAN|VOR|NDB|DME))?';
const ID = '([A-Z][A-Z0-9]{1,5})';
const RWYS_RE = /RWY\s?(\d{2}[LRC]?(?:\s*\/\s*(?:RWY\s?)?\d{2}[LRC]?)*)\s*:/g;
const TITLE_RE = /^([A-Z][A-Z0-9 ]*? (?:DEPARTURE|ARRIVAL|TRANSITION))(?:\s*\(.*\))?$/;

/* ==== narrativeBlocks ==== ページの文字 → 題名ごとの説明文。題名の下で、x が近く、行の間が詰まっている文字だけを集める（図の中の文字は入れない） */
export function narrativeBlocks(pages) {
  const blocks = [];
  pages.forEach((page) => {
    let cur = null;
    page.lines.forEach((l) => l.segs.forEach((g) => {
      const t = g.text.replace(/\s+/g, ' ').trim();
      if (TITLE_RE.test(t) && !/CHART|SID and/.test(t)) { cur = { title: t.match(TITLE_RE)[1], x: g.x, y: l.y, text: '' }; blocks.push(cur); return; }
      if (!cur) return;
      if (l.y - cur.y > 34 || g.x < cur.x - 20 || g.x > cur.x + 170) return;
      if (/^(Note|CHANGE|\*)/.test(t)) { cur = null; return; }
      cur.text += ` ${t}`;
      cur.y = l.y;
    }));
  });
  return blocks.map((b) => ({ ...b, text: b.text.replace(/\s+/g, ' ').trim() })).filter((b) => b.text);
}

/* ==== labelDefs ==== 図の中の「名前」の下の定義：「R081/D26.0 HUC」（ラジアルと距離）・「D32.5 HUC」（距離だけ） */
export function labelDefs(pages) {
  const out = {};
  pages.forEach((page) => {
    const segs = page.lines.flatMap((l) => l.segs.map((g) => ({ ...g, y: l.y, t: g.text.trim() })));
    segs.filter((g) => /^[A-Z][A-Z0-9]{4}$/.test(g.t)).forEach((n) => {
      const below = segs.filter((g) => g.y - n.y > 4 && g.y - n.y < 26 && Math.abs(g.x - n.x) < 48);
      below.forEach((g) => {
        let m;
        if ((m = g.t.match(/^R(\d{3})\/D(\d+(?:\.\d+)?) ([A-Z]{2,4})$/))) (out[n.t] ||= {}).full ||= `${m[3]} R-${m[1]} D${m[2]}`;
        else if ((m = g.t.match(/^D(\d+(?:\.\d+)?) ([A-Z]{2,4})$/))) ((out[n.t] ||= {}).dme ||= []).push({ stn: m[2], d: Number(m[1]) });
      });
    });
  });
  return out;
}

/* ==== fixDefsFor ==== 手順で使う名前の定義（「HUC R-047 D32.5」）。距離だけのときは、その点へ向かうパーツのラジアル（via）と組み合わせる */
function fixDefsFor(parts, defs) {
  const out = {};
  parts.forEach((p) => {
    const n = p.to || p.xFix;
    const d = defs[n];
    if (!d || out[n]) return;
    if (d.full) { out[n] = d.full; return; }
    const v = p.via && d.dme?.find((x) => x.stn === p.via.stn);
    if (v) out[n] = `${v.stn} R-${String(p.via.radial).padStart(3, '0')} D${v.d}`;
  });
  return out;
}

/* ==== runwayClauses ==== 「RWY03R/03L : …」ごとに分ける。共通の続き（「… ...to intercept …」）は「...」で終わる文につなぐ */
export function runwayClauses(text) {
  const marks = [...text.matchAll(RWYS_RE)];
  if (!marks.length) return [{ rwys: [], text }];
  const out = marks.map((m, i) => ({
    rwys: m[1].split('/').map((s) => s.replace(/RWY|\s/g, '')),
    text: text.slice(m.index + m[0].length, marks[i + 1]?.index ?? text.length).trim(),
  }));
  const last = out.at(-1);
  const j = last.text.search(/\.\.\.\s*\.\.\./);
  if (j >= 0) {
    const shared = last.text.slice(j).replace(/^\.\.\.\s*\.\.\./, '').trim();
    last.text = `${last.text.slice(0, j)}...`;
    out.forEach((c) => { if (/\.\.\.\s*$/.test(c.text)) c.text = `${c.text.replace(/\.\.\.\s*$/, '')} ${shared}`; });
  }
  out.forEach((c) => { c.text = c.text.replace(/\.\.\./g, ' ').replace(/\s+/g, ' ').trim(); });
  return out;
}

const ftOf = (s) => (/^FL/.test(s) ? Number(s.slice(2)) * 100 : Number(s.replace(/FT$/, '')));

/* ==== crossRule ==== 「Cross X at or above 6000FT」「cross HUC R047/8.0DME between 4000FT and 7000FT」 */
function crossRule(where, kind, a, b) {
  const t = kind.toLowerCase();
  let alt;
  if (t === 'between') alt = altConstraint([`-${Math.max(ftOf(a), ftOf(b))}`, `+${Math.min(ftOf(a), ftOf(b))}`]);
  else alt = { type: t === 'at or above' ? 'above' : t === 'at or below' ? 'below' : 'at', v: ftOf(a) };
  const w = where.replace(/\s*\([^)]*\)/g, '').replace(new RegExp(`${NAVTYPE}$`), '').trim();
  const rd = w.match(/^([A-Z]{2,4}) R(\d{3})\/(\d+(?:\.\d+)?)DME$/);
  if (rd) return { stn: rd[1], radial: Number(rd[2]), dme: Number(rd[3]), alt };
  const fx = w.match(/^([A-Z][A-Z0-9]{1,5})$/);
  return fx ? { fix: fx[1], alt } : { bad: where };
}

/* ==== Scanner ==== 文の頭から言い回しを1つずつ読む */
class Scanner {
  constructor(text, opts) {
    // 普通の英単語（Climb・Cross・From）は小文字に。大文字だけの語（フィックス・局・RWY・HDG・DME）はそのまま
    this.s = text.replace(/\b([A-Z][a-z]+)\b/g, (w) => w.toLowerCase()).replace(/\bproceed v via\b/g, 'proceed via');
    this.parts = [];
    this.cross = [];
    this.warn = [];
    this.startFix = '';
    this.opts = opts;
    this.n = 0;
  }

  id() { this.n += 1; return `${this.opts.id}-${this.n}`; }

  push(p) { this.parts.push({ id: this.id(), name: '', alt: null, speed: null, turn: null, ...p }); }

  eat(re) {
    const m = this.s.match(re);
    if (m) this.s = this.s.slice(m[0].length);
    return m;
  }

  skipSep() { this.eat(/^[\s,.;:]+/); this.eat(/^(?:and|then)\s+/); }

  /* via STN Rnnn の続き（to X / to 30.0DME / to intercept and proceed via … / until crossing …） */
  viaRadial(stn, radial) {
    let m;
    if ((m = this.eat(new RegExp(`^\\s*,?\\s*to intercept and proceed via ${ID} R(\\d{3})(?:\\s*\\([^)]*\\))?`)))) {
      this.push({ type: 'radial', station: stn, radial, inbound: 'auto', end: { type: 'fix', to: `${m[1]} R-${m[2]}` } });
      return this.viaRadial(m[1], Number(m[2]));
    }
    if ((m = this.eat(new RegExp(`^\\s*,?\\s*to intercept and proceed via ${ID} (\\d+(?:\\.\\d+)?)\\s?DME (counter ?clockwise|clockwise) ARC to `)))) {
      this.push({ type: 'radial', station: stn, radial, inbound: 'auto', end: { type: 'dme', station: m[1], dist: Number(m[2]) } });
      return this.arc(m[1], Number(m[2]), /counter/.test(m[3]) ? 'L' : 'R');
    }
    if ((m = this.eat(new RegExp(`^\\s*until crossing ${ID} R(\\d{3})`)))) {
      this.push({ type: 'radial', station: stn, radial, inbound: 'auto', end: { type: 'fix', to: `${m[1]} R-${m[2]}` } });
      return true;
    }
    if ((m = this.eat(new RegExp(`^\\s*to (?:${ID} )?(\\d+(?:\\.\\d+)?)\\s?DME(?:\\s*\\([^)]*\\))?`)))) {
      this.push({ type: 'radial', station: m[1] || stn, radial, inbound: 'auto', end: { type: 'dme', dist: Number(m[2]) }, name: `D${m[2]} ${m[1] || stn}` });
      return true;
    }
    if ((m = this.eat(/^\s*to (\d{3,5})FT(?: or above)?/))) {
      this.push({ type: 'radial', station: stn, radial, inbound: 'auto', end: { type: 'alt', alt: Number(m[1]), grad: this.opts.grad } });
      return true;
    }
    if ((m = this.eat(new RegExp(`^\\s*to ${ID}${NAVTYPE}(?: via ${ID})?`)))) {
      if (m[1] === stn) (this.inbound ||= new Set()).add(`${stn}/${radial}`);   // 「via GOT R117 to GOT」＝局へ向かう
      if (m[2]) this.push({ type: 'tf', to: m[2], via: { stn, radial } });
      this.push({ type: 'tf', to: m[1], via: m[2] ? null : { stn, radial } });
      return true;
    }
    this.pending = { stn, radial };   // 「via KUE R329, to intercept and proceed via …」：次の文で決まる
    return true;
  }

  /* 1つ読む。読めなければ false */
  step() {
    const o = this.opts;
    let m;
    if ((m = this.eat(/^cross [^,.]*? at assigned altitude/))) return true;
    const crossRe = /^(?:cross )?((?:[A-Z][A-Z0-9]{1,5}|\d)[^,]*?) (at or above|at or below|between|at) (FL\d{3}|\d{3,5}FT)(?: and (FL\d{3}|\d{3,5}FT))?(?:\(\*\))?/;
    if ((/^cross /.test(this.s) || this.lastCross) && (m = this.eat(crossRe))) { this.cross.push(crossRule(m[1], m[2], m[3], m[4])); this.lastCross = true; return true; }
    this.lastCross = false;
    if ((m = this.eat(new RegExp(`^from over ${ID}${NAVTYPE}`)))) { this.startFix = m[1]; return true; }
    if ((m = this.eat(/^climb (?:via )?RWY HDG (?:to|until) /))) return this.climbEnd();
    if ((m = this.eat(new RegExp(`^(?:climb |turn (?:right|left),? )?direct to ${ID}${NAVTYPE}(?: within .*?(?=,|\\. |$| via | direct ))?`)))) { this.push({ type: 'tf', to: m[1] }); return true; }
    if ((m = this.eat(/^turn (right|left),?\s*(?:via )?HDG\s?(\d{3})°?\s*/))) return this.turnHdg(m[1], Number(m[2]));
    if ((m = this.eat(new RegExp(`^climb on HDG\\s?(\\d{3})°? (?:to|until) ${ID} (\\d+(?:\\.\\d+)?)\\s?DME`)))) {
      this.push({ type: 'heading', hdg: Number(m[1]), end: { type: 'dme', station: m[2], dist: Number(m[3]) } });
      return true;
    }
    if ((m = this.eat(/^(?:via )?HDG\s?(\d{3})°?\s*/))) return this.turnHdg(this.lastTurn || 'right', Number(m[1]));
    if ((m = this.eat(new RegExp(`^(?:to )?intercept and proceed via ${ID} (\\d+(?:\\.\\d+)?)\\s?DME (counter ?clockwise|clockwise) ARC to `)))) return this.arc(m[1], Number(m[2]), /counter/.test(m[3]) ? 'L' : 'R');
    if ((m = this.eat(/^turn (right|left)(?: within .*?(?=,|\\. |$| via | direct ))?/))) { this.lastTurn = m[1]; return true; }
    if ((m = this.eat(new RegExp(`^(?:proceed )?via ${ID} (\\d+(?:\\.\\d+)?)\\s?DME (counter ?clockwise|clockwise) ARC to `)))) return this.arc(m[1], Number(m[2]), /counter/.test(m[3]) ? 'L' : 'R');
    if ((m = this.eat(new RegExp(`^(?:climb |proceed )?via ${ID} R(\\d{3})(?:\\s*\\([^)]*\\))?`)))) {
      // 「via CHE R021, via MKE R352 …」：前のラジアルから次のラジアルへ乗り継ぐ
      if (this.pending) this.push({ type: 'radial', station: this.pending.stn, radial: this.pending.radial, inbound: 'auto', end: { type: 'fix', to: `${m[1]} R-${m[2]}` } });
      this.pending = null;
      return this.viaRadial(m[1], Number(m[2]));
    }
    if ((m = this.eat(new RegExp(`^to intercept and proceed via ${ID} R(\\d{3})(?:\\s*\\([^)]*\\))?`)))) {
      // 前のラジアルから会合、または「turn right, to intercept …」（針路なし）＝そのラジアルに乗る
      const p = this.pending;
      this.pending = null;
      if (p) this.push({ type: 'radial', station: p.stn, radial: p.radial, inbound: 'auto', end: { type: 'fix', to: `${m[1]} R-${m[2]}` } });
      return this.viaRadial(m[1], Number(m[2]));
    }
    if (this.pending && (m = this.eat(new RegExp(`^to intercept and proceed via ${ID} (\\d+(?:\\.\\d+)?)\\s?DME (counter ?clockwise|clockwise) ARC to `)))) {
      const p = this.pending;
      this.pending = null;
      this.push({ type: 'radial', station: p.stn, radial: p.radial, inbound: 'auto', end: { type: 'dme', station: m[1], dist: Number(m[2]) } });
      return this.arc(m[1], Number(m[2]), /counter/.test(m[3]) ? 'L' : 'R');
    }
    if ((m = this.eat(new RegExp(`^proceed via ${ID} R(\\d{3}) to ${ID}${NAVTYPE}`)))) { this.push({ type: 'tf', to: m[3] }); return true; }
    return false;
  }

  /* Climb RWY HDG to 600FT (or above) / until (1NM FM RWY end/)CHE 6.3DME / to TTE 7.0DME */
  climbEnd() {
    let m;
    const head = { type: 'heading', hdg: null, rwyHdg: true };
    if ((m = this.eat(/^(\d{3,5})FT(?: or above)?/))) { this.push({ ...head, end: { type: 'alt', alt: Number(m[1]), grad: this.opts.grad } }); return true; }
    if ((m = this.eat(new RegExp(`^intercept and proceed via ${ID} (\\d+(?:\\.\\d+)?)\\s?DME (counter ?clockwise|clockwise) ARC to `)))) {
      this.push({ ...head, end: { type: 'dme', station: m[1], dist: Number(m[2]) } });
      return this.arc(m[1], Number(m[2]), /counter/.test(m[3]) ? 'L' : 'R');
    }
    if ((m = this.eat(new RegExp(`^(?:[\\d.]+\\s?NM (?:FM|from) RWY end\\s*\\/\\s*)?${ID} (\\d+(?:\\.\\d+)?)\\s?DME`)))) {
      this.push({ ...head, end: { type: 'dme', station: m[1], dist: Number(m[2]) } });
      return true;
    }
    return false;
  }

  /* turn right HDG 146° to intercept and proceed via … / to TTE 9.0DME / until crossing … */
  turnHdg(dir, hdg) {
    const turn = { mode: 'perf', kias: this.opts.kias, bank: this.opts.bank };
    const d = /left/i.test(dir) ? 'L' : 'R';
    let m;
    if ((m = this.eat(new RegExp(`^,?\\s*to intercept and proceed via ${ID} R(\\d{3})(?:\\s*\\([^)]*\\))?`)))) {
      this.push({ type: 'turnhdg', dir: d, hdg, turn, end: { type: 'fix', to: `${m[1]} R-${m[2]}` } });
      return this.viaRadial(m[1], Number(m[2]));
    }
    if ((m = this.eat(new RegExp(`^(?:to|until) ${ID} (\\d+(?:\\.\\d+)?)\\s?DME`)))) { this.push({ type: 'turnhdg', dir: d, hdg, turn, end: { type: 'dme', station: m[1], dist: Number(m[2]) } }); return true; }
    if ((m = this.eat(new RegExp(`^until crossing ${ID} R(\\d{3})`)))) { this.push({ type: 'turnhdg', dir: d, hdg, turn, end: { type: 'fix', to: `${m[1]} R-${m[2]}` } }); return true; }
    return false;
  }

  /* via HUC 26.0DME clockwise ARC to TAIYO / to intercept and proceed via ITE R141 */
  arc(stn, dme, dir) {
    let m;
    if ((m = this.eat(new RegExp(`^intercept and proceed via ${ID} R(\\d{3})(?:\\s*\\([^)]*\\))?`)))) {
      const own = m[1] === stn;
      this.push({ type: 'arc', station: stn, dme, dir, endBy: own ? 'own' : 'other', to: own ? Number(m[2]) : null, xStation: own ? '' : m[1], xRadial: own ? null : Number(m[2]) });
      return this.viaRadial(m[1], Number(m[2]));
    }
    if ((m = this.eat(new RegExp(`^${ID} R(\\d{3})`)))) {
      const own = m[1] === stn;
      this.push({ type: 'arc', station: stn, dme, dir, endBy: own ? 'own' : 'other', to: own ? Number(m[2]) : null, xStation: own ? '' : m[1], xRadial: own ? null : Number(m[2]) });
      return true;
    }
    if ((m = this.eat(new RegExp(`^${ID}${NAVTYPE}`)))) { this.push({ type: 'arc', station: stn, dme, dir, endBy: 'fix', xFix: m[1], name: m[1] }); return true; }
    return false;
  }

  run() {
    let guard = 0;
    while (this.s.trim() && guard < 200) {
      guard += 1;
      this.skipSep();
      if (!this.s.trim()) break;
      if (!this.step()) {
        const k = this.s.search(/[,.](?:\s|$)/);
        const bad = (k < 0 ? this.s : this.s.slice(0, k)).trim();
        if (bad) this.warn.push(`読めない文：「${bad}」`);
        this.s = k < 0 ? '' : this.s.slice(k + 1);
      }
    }
    return this;
  }
}

/* ==== applyCross ==== 高度の制限を当てる：名前のフィックス → そこで終わるパーツ、「STN Rnnn/D.DDME」→ そのラジアルを通るパーツの手前に D.DDME で終わるラジアルを足す */
function applyCross(sc) {
  const inb = sc.inbound || new Set();
  sc.parts.forEach((q) => { if (q.type === 'radial' && inb.has(`${q.station}/${q.radial}`)) q.inbound = true; });   // 行き先が局＝局へ向かう。それ以外は自動
  sc.cross.forEach((c) => {
    if (c.bad) { sc.warn.push(`高度の制限の場所が読めません：「${c.bad}」`); return; }
    if (c.fix) {
      if (c.fix === sc.startFix) { sc.startAlt = c.alt.v; return; }
      const p = sc.parts.find((q) => q.to === c.fix || q.xFix === c.fix || q.name === c.fix);
      if (p) p.alt = c.alt; else sc.warn.push(`${c.fix} の高度の制限：経路に ${c.fix} がありません`);
      return;
    }
    const on = (q) => (q.via?.stn === c.stn && q.via?.radial === c.radial) || (q.type === 'radial' && q.station === c.stn && q.radial === c.radial);
    let i = sc.parts.findIndex(on);
    if (i < 0) { sc.warn.push(`${c.stn} R${c.radial}/${c.dme}DME の高度の制限：そのラジアルを通るパーツがありません`); return; }
    // 同じラジアルで先に分けた DME の先へ：外向きは近い順、局へ向かうときは遠い順
    const inward = inb.has(`${c.stn}/${c.radial}`);
    const before = (d) => (inward ? d > c.dme + 0.05 : d < c.dme - 0.05);
    while (sc.parts[i + 1] && on(sc.parts[i + 1]) && sc.parts[i].type === 'radial' && sc.parts[i].end?.type === 'dme' && before(sc.parts[i].end.dist)) i += 1;
    const q = sc.parts[i];
    if (q.type === 'radial' && q.end?.type === 'dme' && Math.abs(q.end.dist - c.dme) < 0.05) { q.alt = c.alt; return; }
    sc.parts.splice(i, 0, { id: `${q.id}-d${c.dme}`, type: 'radial', station: c.stn, radial: c.radial, inbound: inward || 'auto', end: { type: 'dme', dist: c.dme }, name: `D${c.dme} ${c.stn}`, alt: c.alt, speed: null, turn: null });
  });
}

const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
const kindOf = (title) => (/DEPARTURE/.test(title) ? 'SID' : /ARRIVAL/.test(title) ? 'STAR' : 'TRANSITION');

/* ==== textToProcs ==== 1つの PDF の説明文 → 手順（SID は滑走路ごと）。opts：{ icao, side, source, defaults:{grad,kias,bank} } */
export function textToProcs(pages, { icao, side = null, source = null, defaults = {} }) {
  const d = { grad: 3.3, kias: 250, bank: 25, ...defaults };
  const grads = gradientNotes(pages);
  const table = waypointTable(pages);              // 図の中の「名前／緯度／経度」・座標表（あれば）
  const defs = labelDefs(pages);                   // 図の中の「名前／R081/D26.0 HUC」
  const out = [];
  narrativeBlocks(pages).forEach((b) => {
    const type = kindOf(b.title);
    const name = procName(b.title.replace(/\s*\(.*\)$/, ''));
    runwayClauses(b.text).forEach((c) => {
      const rwys = type === 'SID' && c.rwys.length ? c.rwys : [null];
      if (type === 'SID' && !c.rwys.length) return;
      rwys.forEach((rwy) => {
        const id = `aip-${slug(`${icao}-${type}-${name}${rwy ? `-${rwy}` : ''}`)}`;
        if (out.some((p) => p.id === id)) return;
        const sc = new Scanner(c.text, { id, grad: (rwy && grads[rwy]) || d.grad, kias: d.kias, bank: d.bank }).run();
        applyCross(sc);
        if (!sc.parts.length) return;
        if (type !== 'SID' && !sc.startFix) sc.warn.push('開始フィックス（From over …）が読めません');
        const fixDefs = fixDefsFor(sc.parts, defs);
        if (sc.startFix && defs[sc.startFix]?.full) fixDefs[sc.startFix] = defs[sc.startFix].full;
        sc.parts.forEach((p) => { delete p.via; });
        const used = [sc.startFix, ...sc.parts.map((p) => p.to || p.xFix)].filter((n) => n && /^[A-Z][A-Z0-9]{1,5}$/.test(n));
        const wpts = Object.fromEntries(used.filter((n) => table[n]).map((n) => [n, table[n]]));
        out.push({
          id, ad: icao, type, name, rwy: rwy || '', derText: '', startFix: sc.startFix, startAlt: sc.startAlt ?? null, parents: [],
          parts: sc.parts, missed: [], visible: false, wpts, fixDefs, source: { ...source, text: c.text }, warnings: sc.warn, side: type === 'TRANSITION' ? side : undefined,
          lastFix: [...sc.parts].reverse().find((p) => p.to || p.xFix || p.name)?.to || '',
          defaulted: sc.parts.some((p) => p.type === 'turnhdg') || sc.parts.some((p) => p.end?.grad === d.grad && p.type === 'heading'),
        });
      });
    });
  });
  return out;
}
