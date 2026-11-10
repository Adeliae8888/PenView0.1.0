/* ==== zip.js ==== 最小の ZIP 読み取り（無圧縮・Deflate）。入れ子の zip も展開。ブラウザ標準の DecompressionStream を使う
 * ファイル名は UTF-8 フラグが無ければ Shift_JIS（日本の Windows で作った zip）として読む */

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const MAX_DEPTH = 3;

function findEocd(view) {
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i -= 1) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  throw new Error('ZIP として読めません');
}

function decodeName(bytes, utf8) {
  if (!utf8) {
    try { return new TextDecoder('shift_jis', { fatal: true }).decode(bytes); } catch { /* UTF-8 で読む */ }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ==== listEntries ==== 中央ディレクトリから項目一覧 */
function listEntries(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = findEocd(view);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(p, true) !== SIG_CEN) throw new Error('ZIP の目次が壊れています');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decodeName(buf.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
    entries.push({ name, method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { view, entries };
}

async function readEntry(buf, view, e) {
  if (view.getUint32(e.local, true) !== SIG_LOC) throw new Error(`ZIP の項目が壊れています：${e.name}`);
  const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
  const raw = buf.subarray(start, start + e.size);
  if (e.method === 0) return raw;
  if (e.method === 8) return inflateRaw(raw);
  throw new Error(`未対応の圧縮方式（${e.method}）：${e.name}`);
}

/* ==== unzip ==== {path, bytes} の配列。filter(path) が true のものだけ読む。入れ子の zip は展開して path を連結 */
export async function unzip(input, filter = () => true, depth = 0, prefix = '') {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { view, entries } = listEntries(buf);
  const out = [];
  for (const e of entries) {
    if (e.name.endsWith('/')) continue;
    const path = prefix + e.name;
    if (/\.zip$/i.test(e.name) && depth < MAX_DEPTH) {
      out.push(...await unzip(await readEntry(buf, view, e), filter, depth + 1, `${path.replace(/\.zip$/i, '')}/`));
    } else if (filter(path)) {
      out.push({ path, bytes: await readEntry(buf, view, e) });
    }
  }
  return out;
}
