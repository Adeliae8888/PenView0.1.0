/* ==== pdf-text.js ==== PDF の文字を位置つきで取り出す（pdf.js）。AIP のチャート・AD2 の読み取り用
 * ページ = { items:[{s,x,y,w,h}], lines:[{y, text, segs:[{text,x,x2}]}] }。y は上から下（px 相当）
 * 一部の AIP の PDF はフォントの文字コードが 29 ずれている（0x03＝空白、0x13〜0x1C＝数字）→ そのフォントだけ戻す
 * pdf.js はブラウザでは vendor/pdfjs、テスト（node）では pdfjs-dist を渡す */

const SHIFT = 29;
const DEG_CODE = 0xdb;                 // ずれたフォントの「°」
const LINE_TOL = 2.5;                  // 同じ行とみなす y の差
const SEG_GAP = 2.2;                   // 文字の高さのこれ倍より離れたら別の区切り（表の列・図の文字）

/* ==== shiftedFonts ==== 制御文字（0x01〜0x1F）を含む文字列があるフォント＝文字コードがずれている */
function shiftedFonts(items) {
  const set = new Set();
  items.forEach((it) => { if (/[\x01-\x1f]/.test(it.str)) set.add(it.fontName); });
  return set;
}

/* ==== unshift ==== ずれた文字コードを戻す */
export function unshift(s) {
  return [...s].map((c) => {
    const k = c.charCodeAt(0);
    if (k === DEG_CODE) return '°';
    return k < 0x60 ? String.fromCharCode(k + SHIFT) : c;
  }).join('');
}

/* ==== toLines ==== 文字の並び → 行（y が近いもの）→ 区切り（x の間が大きいところで分ける） */
export function toLines(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  sorted.forEach((it) => {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= LINE_TOL);
    if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
  });
  lines.sort((a, b) => a.y - b.y);
  return lines.map((l) => {
    const its = l.items.sort((a, b) => a.x - b.x);
    const segs = [];
    its.forEach((it) => {
      const last = segs.at(-1);
      const h = Math.max(it.h, last?.h || 0, 4);
      if (last && it.x - last.x2 < SEG_GAP * h) {
        last.text += (it.x - last.x2 > 0.15 * h ? ' ' : '') + it.s;
        last.x2 = Math.max(last.x2, it.x + it.w);
      } else segs.push({ text: it.s, x: it.x, x2: it.x + it.w, h: it.h });
    });
    segs.forEach((g) => { g.text = g.text.replace(/\s+/g, ' ').trim(); });
    return { y: l.y, segs: segs.filter((g) => g.text), text: segs.map((g) => g.text).join('  ').replace(/\s{3,}/g, '  ').trim() };
  });
}

/* ==== pdfPages ==== bytes → ページの配列。pdfjs＝pdf.js のモジュール */
export async function pdfPages(pdfjs, bytes) {
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0, isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const shifted = shiftedFonts(tc.items);
    const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => {
      const s = shifted.has(it.fontName) ? unshift(it.str) : it.str;
      const h = Math.hypot(it.transform[2], it.transform[3]) || it.height || 8;
      // 制御文字と CJK 拡張 A（壊れたフォントの空白「䢢」など）は空白に
      return { s: s.replace(/[\x00-\x1f\u3400-\u4dbf]/g, ' '), x: it.transform[4], y: vp.height - it.transform[5], w: it.width, h };
    });
    pages.push({ items, lines: toLines(items) });
  }
  await doc.destroy();
  return pages;
}
