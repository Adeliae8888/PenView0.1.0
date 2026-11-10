/* ==== navdata.js ==== 読み込んだ航空データ（AIP KML・SUP・障害物・NOTAM）の分類・保存・有効期間・表示グループ
 * データは「グループ」単位で保存し、同じグループを読み込み直したら置き換える */
import { load, save } from './store.js';
import { unzip } from './zip.js';
import { parseKml, parseAixm, parsePeriod, parseAltitude } from './kml.js';

const INDEX_KEY = 'navIndex';
const AIRAC_DAYS = 28;
const DAY_MS = 86400000;
const M_TO_FT = 3.28084;
const ROUND = 1e5;

/* ==== GROUPS ==== key → 表示名、TAC での既定表示（tac）、NAV での既定表示（nav、省略時 true）
 * 既定で出すのは飛行に直結するものだけ。量が多く地図を埋めるもの（ACC・無人機・ホールディング等）は既定で隠す */
export const GROUPS = {
  'aip-jsdf': { label: 'JSDF 訓練空域', tac: true }, 'aip-civtrain': { label: '民間訓練空域', tac: true, nav: false },
  'aip-restricted': { label: '制限区域', tac: true }, 'aip-aca': { label: 'ACA', tac: true }, 'aip-ctr': { label: 'CTR/INFO', tac: true },
  'aip-acc': { label: 'ACC セクター', tac: false, nav: false }, 'aip-adiz': { label: 'ADIZ', tac: true }, 'aip-other-area': { label: 'その他区域', tac: false, nav: false },
  'aip-ats': { label: 'ATS ルート', tac: false }, 'aip-rnav': { label: 'RNAV ルート', tac: false }, 'aip-direct': { label: 'Direct/TACAN ルート', tac: false },
  'aip-oceanic': { label: 'Oceanic ルート', tac: false }, 'aip-wpt': { label: 'WPT', tac: false }, 'aip-vfrrep': { label: 'VFR REP', tac: false },
  'aip-hold': { label: 'ホールディング', tac: false, nav: false }, 'aip-navaid': { label: 'NAVAID（公式）', tac: false }, 'aip-arp': { label: '飛行場（公式）', tac: true },
  'sup-airspace': { label: 'SUP 臨時空域', tac: true }, 'sup-navaid': { label: 'SUP NAVAID', tac: false }, 'sup-uas': { label: 'SUP 無人機', tac: false, nav: false },
  'obs-area1': { label: '障害物 AREA1', tac: false }, 'obs-area2': { label: '障害物 AREA2', tac: false }, 'obs-sup': { label: '障害物 SUP', tac: false },
  'notam-airspace': { label: 'NOTAM 空域', tac: true }, 'notam-obstacle': { label: 'NOTAM 障害物', tac: false }, 'notam-aerodrome': { label: 'NOTAM 飛行場', tac: false },
  other: { label: 'その他 KML', tac: false },
};

const AIP_FILES = [
  [/^JSDF_training/i, 'aip-jsdf'], [/^Civil_training/i, 'aip-civtrain'], [/^Restricted_area/i, 'aip-restricted'], [/^Approach_control_area/i, 'aip-aca'],
  [/^Control_zone/i, 'aip-ctr'], [/^ACC_Sector/i, 'aip-acc'], [/^ADIZ/i, 'aip-adiz'], [/^(Corridors|Supersonic|Take_off|QNH|FIR)/i, 'aip-other-area'],
  [/^ATS_ROUTES/i, 'aip-ats'], [/^RNAV_ROUTES/i, 'aip-rnav'], [/^Direct_routes/i, 'aip-direct'], [/^Oceanic/i, 'aip-oceanic'],
  [/^REP_WPT/i, 'aip-wpt'], [/^Visual_REP/i, 'aip-vfrrep'], [/^Enroute_Holding/i, 'aip-hold'], [/^RADIO_NAVIGATION_AIDS/i, 'aip-navaid'], [/^AERODROME_REFERENCE/i, 'aip-arp'],
];

/* ==== classify ==== ファイルの場所と名前からグループを決める */
export function classify(path, notamKind) {
  if (notamKind) return `notam-${notamKind}`;
  const file = path.split('/').pop();
  if (/OBSTACLE/i.test(path)) return /AREA2/i.test(path) ? 'obs-area2' : /AREA1/i.test(path) ? 'obs-area1' : 'obs-sup';
  if (/SUP/i.test(path) && /RADIO NAVIGATION|NAVAID/i.test(path)) return 'sup-navaid';
  if (/Unmanned|drone/i.test(path)) return 'sup-uas';
  if (/(^|\/)4_SUP|(^|\/)SUP_/i.test(path)) return 'sup-airspace';
  const hit = AIP_FILES.find(([re]) => re.test(file));
  return hit ? hit[1] : 'other';
}

export function effDate(path) {
  const m = path.match(/EFF(\d{8})|_(20\d{6})(?:[_.(]|$)/);
  const d = m && (m[1] || m[2]);
  return d ? Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8))) : null;
}

const r5 = (v) => Math.round(v * ROUND) / ROUND;
const pick = (a, ...keys) => keys.map((k) => a[k]).find((v) => v);

/* ==== normalize ==== 地物 → 保存用の軽い形 {n, k, p|g, a, v, lo, up} */
function normalize(f, group) {
  const a = f.attrs || {};
  const item = { k: f.kind, n: '', a: {} };
  if (f.p) item.p = [r5(f.p[0]), r5(f.p[1])]; else item.g = f.g.map((c) => [r5(c[0]), r5(c[1])]);
  if (group.startsWith('obs-')) {
    const metric = /metric/i.test(a['Unit of measurement used'] || '') || group === 'obs-area1' || group === 'obs-area2';
    const elev = Number(pick(a, 'Elevation') || NaN);
    item.n = pick(a, 'Obstacle type', 'Type', 'Subject') || f.name || 'OBST';
    item.a = { elev: Number.isFinite(elev) ? Math.round(metric ? elev * M_TO_FT : elev) : null, lit: a.Lighting || '' };
  } else {
    item.n = pick(a, 'DESIGNATOR', 'NAME_CODE', 'ID', 'ICAO_ID', 'HLDG_POINT', 'ID_NAME', 'NAME2', 'NAME', 'Name／ID', 'NOTAM') || f.name || '';
    if (group === 'aip-vfrrep') item.n = `${a.CS || f.name}`.toUpperCase();
    if (group === 'aip-other-area' && a.AD) item.n = `${a.AD} RWY${a.RWY || ''}`;
    item.a = f.name && /^SUP_/i.test(f.name) ? { ...a, name: f.name.replace('_', ' ') } : a;
  }
  item.lo = pick(a, 'ALT_LOWER', 'LOWER') || '';
  item.up = pick(a, 'ALT_UPPER', 'UPPER', 'Altitude') || '';
  item.v = f.valid || parsePeriod(a.Period || a.PeriodD || '') || null;
  return item;
}

/* ==== importFiles ==== File の配列（zip/kml/xml）→ グループごとに置き換えて保存。onProgress(文字列) */
export async function importFiles(files, { includeArea2 = false, onProgress = () => {} } = {}) {
  const want = (p) => /\.(kml|xml)$/i.test(p) && (includeArea2 || !/AREA2/i.test(p));
  const entries = [];
  for (const file of files) {
    onProgress(`展開中：${file.name}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.zip$/i.test(file.name)) entries.push(...await unzip(bytes, want));
    else if (want(file.name)) entries.push({ path: file.name, bytes });
  }
  const dec = new TextDecoder();
  const groups = {};
  entries.forEach((e, i) => {
    if (i % 20 === 0) onProgress(`解析中 ${i + 1}/${entries.length}`);
    const text = dec.decode(e.bytes);
    const feats = /<message:AIXMBasicMessage|<aixm:/.test(text.slice(0, 2000)) ? parseAixm(text) : parseKml(text);
    feats.forEach((f) => {
      const key = classify(e.path, f.notamKind);
      const g = (groups[key] ||= { items: [], eff: null });
      g.items.push(normalize(f, key));
      g.eff = Math.max(g.eff || 0, effDate(e.path) || 0) || null;
    });
  });
  return saveGroups(groups, onProgress);
}

async function saveGroups(groups, onProgress) {
  const index = await load(INDEX_KEY, []);
  for (const [key, g] of Object.entries(groups)) {
    onProgress(`保存中：${GROUPS[key]?.label || key}`);
    await save(`nd:${key}`, g.items);
    const rec = { group: key, label: GROUPS[key]?.label || key, count: g.items.length, eff: g.eff, importedAt: Date.now() };
    const i = index.findIndex((x) => x.group === key);
    if (i >= 0) index[i] = rec; else index.push(rec);
    cache.items[key] = g.items;
  }
  await save(INDEX_KEY, index);
  cache.index = index;
  onProgress(`読み込み完了：${Object.keys(groups).length} グループ`);
  return Object.keys(groups);
}

/* ==== キャッシュ（起動時に全グループを読む） ==== */
const cache = { index: [], items: {} };

export async function loadNavData() {
  cache.index = await load(INDEX_KEY, []);
  for (const rec of cache.index) cache.items[rec.group] = reparsePeriods(rec.group, await load(`nd:${rec.group}`, []));
  return cache;
}

/* ==== reparsePeriods ==== SUP の期間は保存済みの原文から毎回読み直す（期間解析を直したとき、読み込み直し不要にするため） */
function reparsePeriods(group, items) {
  if (!group.startsWith('sup-') && group !== 'obs-sup') return items;
  items.forEach((it) => {
    const text = it.a?.Period || it.a?.PeriodD;
    if (text) it.v = parsePeriod(text);
  });
  return items;
}

export function navIndex() {
  return cache.index;
}

export function navItems(group) {
  return cache.items[group] || [];
}

export async function removeGroup(group) {
  cache.index = cache.index.filter((x) => x.group !== group);
  delete cache.items[group];
  await save(`nd:${group}`, []);
  await save(INDEX_KEY, cache.index);
}

/* ==== exportNavData / importNavData ==== 共有用（項目別書き出し） */
export function exportNavData() {
  return { index: cache.index, items: cache.items };
}

export async function importNavData(data) {
  const groups = {};
  (data?.index || []).forEach((rec) => { groups[rec.group] = { items: data.items?.[rec.group] || [], eff: rec.eff }; });
  return saveGroups(groups, () => {});
}

export function hasGroupPrefix(prefix) {
  return cache.index.some((x) => x.group.startsWith(prefix) && x.count > 0);
}

/* ==== airacStatus ==== AIRAC（28日）を過ぎたか */
export function airacExpired(rec, t) {
  return !!rec.eff && rec.group.startsWith('aip-') && t > rec.eff + AIRAC_DAYS * DAY_MS;
}

/* ==== isValidIn ==== 有効期間が表示の時間帯 [start, end] と重なるか（期間不明は常に表示） */
export function isValidIn(item, win) {
  const v = item.v;
  if (!v) return true;
  const from = v.from ?? -Infinity;
  const to = v.to ?? Infinity;
  return from <= win.end && to >= win.start;
}

export function limitText(item) {
  const lo = parseAltitude(item.lo)?.text || '';
  const up = parseAltitude(item.up)?.text || '';
  if (lo && up) return `${lo}–${up}`;
  return up || (lo ? `${lo}–` : '');
}
