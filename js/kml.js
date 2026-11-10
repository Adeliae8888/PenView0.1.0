/* ==== kml.js ==== KML と AIXM（デジタル NOTAM）の解析。ブラウザとテスト（node）の両方で動くよう正規表現で読む
 * 出力の地物：{ name, attrs:{}, kind:'point'|'line'|'area', p:[lon,lat] | g:[[lon,lat],…] } */
import { destination } from './geo.js';

const NM_PER_M = 1 / 1852;
const CIRCLE_SEGMENTS = 48;

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>|<\/br>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : null;
}

function parseCoords(text) {
  return String(text || '').trim().split(/\s+/).map((t) => t.split(',').map(Number)).filter((c) => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])).map((c) => [c[0], c[1]]);
}

/* ==== kmlAttrs ==== description の表（<td>項目</td><td>値</td>）と ExtendedData の両方から属性を取る */
function kmlAttrs(pm) {
  const attrs = {};
  const desc = tag(pm, 'description') || '';
  const html = desc.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const m of html.matchAll(/<td>([^<]{1,60})<\/td>\s*<td>([\s\S]*?)<\/td>/g)) attrs[decodeEntities(m[1])] = decodeEntities(m[2]);
  for (const m of pm.matchAll(/<(?:Data|SimpleData) name="([^"]+)"[^>]*>(?:\s*<value>)?([\s\S]*?)(?:<\/value>\s*)?<\/(?:Data|SimpleData)>/g)) attrs[m[1]] = decodeEntities(m[2]);
  return attrs;
}

/* ==== parseKml ==== Placemark ごとに地物を返す（MultiGeometry は形ごとに分ける） */
export function parseKml(text) {
  const out = [];
  for (const m of text.matchAll(/<Placemark\b[\s\S]*?<\/Placemark>/g)) {
    const pm = m[0];
    const name = decodeEntities(tag(pm, 'name') || '');
    const attrs = kmlAttrs(pm);
    for (const pt of pm.matchAll(/<Point\b[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) {
      const c = parseCoords(pt[1])[0];
      if (c) out.push({ name, attrs, kind: 'point', p: c });
    }
    for (const ls of pm.matchAll(/<LineString\b[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) {
      const g = parseCoords(ls[1]);
      if (g.length >= 2) out.push({ name, attrs, kind: 'line', g });
    }
    for (const pg of pm.matchAll(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) {
      const g = parseCoords(pg[1]);
      if (g.length >= 3) out.push({ name, attrs, kind: 'area', g });
    }
  }
  return out;
}

/* ==== AIXM（デジタル NOTAM） ==== */
function circleRing(lat, lon, radiusNm) {
  return Array.from({ length: CIRCLE_SEGMENTS + 1 }, (_, i) => {
    const p = destination({ lat, lon }, (i * 360) / CIRCLE_SEGMENTS, radiusNm);
    return [p.lon, p.lat];
  });
}

function latLonPairs(text) {
  const n = String(text || '').trim().split(/\s+/).map(Number);
  const out = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i + 1], n[i]]);   // AIXM（EPSG:4326）は「緯度 経度」の順
  return out;
}

function aixmLimit(xml, name) {
  const m = xml.match(new RegExp(`<aixm:${name}(?: uom="([^"]*)")?[^>]*>([^<]*)</aixm:${name}>`));
  if (!m) return '';
  const v = m[2].trim();
  if (/^(GND|SFC|UNL|FLOOR|CEILING)$/i.test(v)) return v.toUpperCase();
  return m[1] === 'FL' ? `FL${v.padStart(3, '0')}` : `${v}${(m[1] || 'FT').toUpperCase()}`;
}

function aixmGeometry(xml) {
  const rings = [];
  for (const c of xml.matchAll(/<gml:CircleByCenterPoint\b[\s\S]*?<gml:pos>([^<]+)<\/gml:pos>\s*<gml:radius uom="([^"]+)">([^<]+)<\/gml:radius>/g)) {
    const [[lon, lat]] = latLonPairs(c[1]);
    const r = Number(c[3]) * (c[2] === 'NM' || c[2] === '[nmi_i]' ? 1 : c[2] === 'KM' ? 1000 * NM_PER_M : NM_PER_M);
    rings.push(circleRing(lat, lon, r));
  }
  const parts = [...xml.matchAll(/<gml:posList>([^<]+)<\/gml:posList>/g)].flatMap((m) => latLonPairs(m[1]));
  if (parts.length >= 3) rings.push(parts);
  return rings;
}

/* ==== parseAixm ==== デジタル NOTAM 1ファイル → 地物（空域＝区域、障害物＝点、飛行場＝点） */
export function parseAixm(text) {
  const ev = (k) => decodeEntities(tag(text, `event:${k}`) || '');
  const id = ev('series') && ev('number') ? `${ev('series')}${ev('number')}/${String(ev('year')).slice(-2)}` : '';
  const from = Date.parse(ev('effectiveStart') || tag(text, 'gml:beginPosition') || '');
  const toRaw = ev('effectiveEnd') || tag(text, 'gml:endPosition') || '';
  const to = Date.parse(toRaw);
  const attrs = { NOTAM: id, TEXT: ev('text'), FROM: ev('effectiveStart'), TO: ev('effectiveEnd') };
  const valid = { from: Number.isFinite(from) ? from : null, to: Number.isFinite(to) ? to : null };
  const out = [];
  if (/<aixm:Airspace\b/.test(text)) {
    const lim = { UPPER: aixmLimit(text, 'upperLimit'), LOWER: aixmLimit(text, 'lowerLimit') };
    aixmGeometry(text).forEach((g) => out.push({ name: id, attrs: { ...attrs, ...lim }, kind: 'area', g, valid, notamKind: 'airspace' }));
  } else {
    const pos = tag(text, 'gml:pos');
    if (pos) {
      const [p] = latLonPairs(pos);
      const elev = text.match(/<aixm:elevation uom="([^"]+)">([^<]+)</);
      const type = (tag(text, 'aixm:type') || '').replace(/^OTHER:/, '');
      out.push({ name: id, attrs: { ...attrs, TYPE: type, ELEV: elev ? `${elev[2]}${elev[1]}` : '' }, kind: 'point', p, valid, notamKind: /<aixm:VerticalStructure\b/.test(text) ? 'obstacle' : 'aerodrome' });
    }
  }
  return out;
}

/* ==== parsePeriod ==== SUP の期間「From 1500UTC 30 SEP 2026 to 1500UTC 29 SEP 2027.」→ {from, to}（読めなければ null） */
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
export function parsePeriod(text) {
  const re = /(\d{4})\s*UTC\s+(\d{1,2})\s+([A-Z]{3})[A-Z]*\.?\s+(\d{4})/gi;
  const times = [...String(text || '').matchAll(re)].map((m) => {
    const mon = MONTHS[m[3].toUpperCase()];
    return mon === undefined ? NaN : Date.UTC(Number(m[4]), mon, Number(m[2]), Number(m[1].slice(0, 2)), Number(m[1].slice(2)));
  }).filter(Number.isFinite);
  if (!times.length) return null;
  return { from: Math.min(...times), to: times.length > 1 ? Math.max(...times) : null };
}

/* ==== parseAltitude ==== "11000FT" "FL230" "SFC" "UNL" "9843FT" → {ft, text}。比較用に ft（FL は ×100、UNL は ∞） */
export function parseAltitude(text) {
  const t = String(text || '').trim().toUpperCase();
  if (!t) return null;
  if (/^(SFC|GND)$/.test(t)) return { ft: 0, text: 'SFC' };
  if (t === 'UNL') return { ft: Infinity, text: 'UNL' };
  const fl = t.match(/^FL\s*(\d+)/);
  if (fl) return { ft: Number(fl[1]) * 100, text: `FL${fl[1].padStart(3, '0')}` };
  const ft = t.match(/^(\d+(?:\.\d+)?)\s*(FT|M)?/);
  if (ft) return { ft: Number(ft[1]) * (ft[2] === 'M' ? 3.28084 : 1), text: t };
  return { ft: NaN, text: t };
}
