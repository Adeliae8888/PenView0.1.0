/* ==== aero.js ==== 標準大気（ISA）・速度換算（TAS/Mach/IAS）・風三角形。IAS は CAS とみなす（位置誤差は無視）
 * 高度 ft、速度 kt、温度 K、ISA 偏差 ℃（=K） */

const T0 = 288.15;                  // 海面温度 K
const LAPSE_PER_FT = 0.0019812;     // 対流圏の気温減率 K/ft
const TROPOPAUSE_FT = 36089;
const T_TROP = 216.65;
const A0_KT = 661.4786;             // 海面音速 kt
const A_PER_SQRT_K = 38.967854;     // 音速 kt = 38.967854 × √T
const RAD = Math.PI / 180;

export const SPEED_UNITS = ['TAS', 'MACH', 'IAS'];

/* ==== isaTemp ==== 高度の気温（K）。dev は ISA 偏差 */
export function isaTemp(altFt, dev = 0) {
  const t = altFt < TROPOPAUSE_FT ? T0 - LAPSE_PER_FT * altFt : T_TROP;
  return t + dev;
}

/* ==== pressureRatio ==== δ = P/P0（標準大気。気圧は ISA 偏差に依らない） */
export function pressureRatio(altFt) {
  if (altFt < TROPOPAUSE_FT) return (1 - 6.8755856e-6 * altFt) ** 5.2558797;
  return 0.2233609 * Math.exp(-4.806346e-5 * (altFt - TROPOPAUSE_FT));
}

export function speedOfSound(altFt, dev = 0) {
  return A_PER_SQRT_K * Math.sqrt(isaTemp(altFt, dev));
}

function casToMach(cas, altFt) {
  const qcP0 = (1 + 0.2 * (cas / A0_KT) ** 2) ** 3.5 - 1;
  const qcP = qcP0 / pressureRatio(altFt);
  return Math.sqrt(5 * ((qcP + 1) ** (2 / 7) - 1));
}

function machToCas(mach, altFt) {
  const qcP = (1 + 0.2 * mach * mach) ** 3.5 - 1;
  const qcP0 = qcP * pressureRatio(altFt);
  return A0_KT * Math.sqrt(5 * ((qcP0 + 1) ** (2 / 7) - 1));
}

/* ==== toTas ==== {unit, value} を高度での TAS に */
export function toTas(speed, altFt, dev = 0) {
  if (!speed || !Number.isFinite(speed.value)) return NaN;
  if (speed.unit === 'TAS') return speed.value;
  const mach = speed.unit === 'MACH' ? speed.value : casToMach(speed.value, altFt);
  return mach * speedOfSound(altFt, dev);
}

/* ==== convertSpeed ==== 単位を切り替えて数値を換算（同じ高度・気温で同じ速さ） */
export function convertSpeed(speed, toUnit, altFt, dev = 0) {
  const tas = toTas(speed, altFt, dev);
  if (!Number.isFinite(tas)) return { unit: toUnit, value: NaN };
  if (toUnit === 'TAS') return { unit: 'TAS', value: Math.round(tas) };
  const mach = tas / speedOfSound(altFt, dev);
  if (toUnit === 'MACH') return { unit: 'MACH', value: Math.round(mach * 100) / 100 };
  return { unit: 'IAS', value: Math.round(machToCas(mach, altFt)) };
}

export function nextSpeedUnit(unit) {
  return SPEED_UNITS[(SPEED_UNITS.indexOf(unit) + 1) % SPEED_UNITS.length];
}

export function formatSpeed(speed) {
  if (!speed || !Number.isFinite(speed.value)) return '---';
  return speed.unit === 'MACH' ? `M${speed.value.toFixed(2)}` : `${Math.round(speed.value)} ${speed.unit === 'IAS' ? 'KIAS' : 'KTAS'}`;
}

/* ==== windTriangle ==== 真コース・TAS・風（吹いてくる真方位/kt）→ GS と修正角。向かい風が TAS 以上なら gs=0 */
export function windTriangle(courseTrue, tas, wind) {
  if (!wind || !(wind.spd > 0) || !(tas > 0)) return { gs: tas, wca: 0 };
  const rel = (wind.dir - courseTrue) * RAD;
  const s = (wind.spd * Math.sin(rel)) / tas;
  if (Math.abs(s) >= 1) return { gs: 0, wca: 0 };
  const wca = Math.asin(s);
  const gs = tas * Math.cos(wca) - wind.spd * Math.cos(rel);
  return { gs: Math.max(0, gs), wca: wca / RAD };
}
