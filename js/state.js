/* ==== state.js ==== アプリ状態（設定＝保存する／実行時＝保存しない）と変更通知 */
import { load, saveLater } from './store.js';
import { gsiVariation } from './geo.js';

export const SETTINGS_KEY = 'settings';

export const AIRSPACE_CLASSES = {
  ctr: 'CTR', tca: 'TCA', aca: 'ACA', pca: 'PCA', restricted: '制限', danger: '訓練/危険', info: 'INFO', heli: 'HELI', glider: 'GLIDER', other: 'その他',
};

const DEFAULT_SETTINGS = {
  mode: 'NAV',                       // 'NAV' | 'TAC'
  coordFormat: 'DDM',
  varMode: 'auto',                   // 'auto'（国土地理院近似式）| 'manual'
  manualVar: -8,                     // E=正 / W=負
  bullseye: { lat: 36.3474, lon: 141.3743, name: 'BULL' },
  follow: true,                      // ON＝自機を中央に固定して Heading(Track)-up、OFF＝North-up で自由に移動
  view: { lat: 36.3, lon: 139.5, scale: 0.6 },   // scale = px/km
  layers: { land: true, airspace: true, airports: true, navaids: true, obstacles: true, grid: false, procedures: true },
  airspaceClasses: Object.fromEntries(Object.keys(AIRSPACE_CLASSES).map((k) => [k, !['other', 'info', 'heli', 'glider'].includes(k)])),
  manualOwn: null,                   // GPS なしで手動設定した自機位置
  layersByMode: null,                // { NAV: {layers, airspaceClasses}, TAC: {...} }。モード切替でレイヤー表示を入れ替える
  timeZone: 'Z',                     // 'Z' | 'JST'
  timeOffsetMs: 0,                   // TIME HACK の補正
  keepAwake: true,                   // 画面を消さない（Wake Lock）
};

export const state = {
  settings: structuredClone(DEFAULT_SETTINGS),
  own: { lat: null, lon: null, trk: null, gs: null, alt: null, source: null, time: 0 },
  selection: null,                   // 地図でタップした点 {lat, lon}
  cursor: null,                      // マウス位置／最後にシングルタッチした点 {lat, lon}
  directArm: null,                   // DIRECT 実行待ち {name, lat, lon, pointId?}
  fuelPrompt: null,                  // 通過した STPT の燃料入力待ち {idx, name}
  alert: null,                       // 'joker' | 'bingo'
  gpsStatus: 'off',                  // off | acquiring | ok | lost | denied | sim
  data: { land: null, airspace: [], airports: [], navaids: [], obstacles: [] },
};

const listeners = new Map();

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((handler) => handler(payload));
}

/* ==== loadSettings ==== 保存済み設定を既定値に重ねる（新しい項目は既定値で補う） */
export async function loadSettings() {
  const saved = await load(SETTINGS_KEY, null);
  if (saved && typeof saved === 'object') {
    const d = structuredClone(DEFAULT_SETTINGS);
    state.settings = {
      ...d, ...saved,
      layers: { ...d.layers, ...saved.layers },
      airspaceClasses: { ...d.airspaceClasses, ...saved.airspaceClasses },
      bullseye: { ...d.bullseye, ...saved.bullseye },
      view: { ...d.view, ...saved.view },
    };
  }
  return state.settings;
}

/* ==== updateSettings ==== 設定を変えて保存予約し、settings イベントを出す */
export function updateSettings(patch) {
  Object.assign(state.settings, patch);
  saveLater(SETTINGS_KEY, () => state.settings);
  emit('settings', patch);
}

/* ==== switchMode ==== 今のレイヤー表示を元のモードに保存し、新しいモードの記憶を読み込む */
const TAC_DEFAULT_OFF = ['obstacles', 'navaids', 'procedures'];
export function switchMode(mode) {
  const s = state.settings;
  if (mode === s.mode) return;
  const byMode = s.layersByMode || {};
  byMode[s.mode] = { layers: { ...s.layers }, airspaceClasses: { ...s.airspaceClasses } };
  // 初めてのモード：基本レイヤーは引き継ぎ、読み込みデータ（nd:*）はそのモードの既定値に任せる
  const base = Object.fromEntries(Object.entries(s.layers).filter(([k]) => !k.startsWith('nd:')));
  const next = byMode[mode] || {
    layers: { ...base, ...Object.fromEntries(TAC_DEFAULT_OFF.map((k) => [k, mode !== 'TAC' && s.layers[k]])) },
    airspaceClasses: { ...s.airspaceClasses },
  };
  updateSettings({ mode, layersByMode: byMode, layers: { ...DEFAULT_SETTINGS.layers, ...next.layers }, airspaceClasses: { ...s.airspaceClasses, ...next.airspaceClasses } });
}

/* ==== currentVariation ==== 使用中の偏差（度, W=負）と出所 */
export function currentVariation() {
  const s = state.settings;
  if (s.varMode === 'manual') return { value: Number(s.manualVar) || 0, source: 'manual' };
  const ref = Number.isFinite(state.own.lat) ? state.own : s.view;
  const auto = gsiVariation(ref.lat, ref.lon);
  return auto === null ? { value: Number(s.manualVar) || 0, source: 'manual-fallback' } : { value: auto, source: 'gsi' };
}
