/* ==== aircraft.js ==== 機種と形態の性能登録。数値はユーザーが入力する（同梱しない） */
import { load, save } from './store.js';

export const AIRCRAFT_KEY = 'aircraft';
let fleet = [];

export async function loadAircraft() {
  fleet = await load(AIRCRAFT_KEY, []);
  return fleet;
}

export function aircraftList() {
  return fleet;
}

export function saveAircraft() {
  return save(AIRCRAFT_KEY, fleet);
}

const uid = (p) => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

/* ==== blankConfig ==== 形態の空ひな形（燃料 lb、速度 {unit,value}、上昇率/降下率 ft/min、FF lb/hr） */
export function blankConfig(name = '新しい形態') {
  return {
    id: uid('cfg'), name, fuelCap: null, taxiTakeoff: null, approachLanding: null, missedApproach: null, reserve: null,
    climb: { speed: { unit: 'IAS', value: null }, roc: null, ff: null },
    cruise: { speed: { unit: 'MACH', value: null }, ff: null },
    descent: { speed: { unit: 'IAS', value: null }, rod: null, ff: null },
    refAlt: 25000,   // 単位を切り替えたときの換算高度
  };
}

export function addAircraft(name = '新しい機種') {
  const ac = { id: uid('ac'), name, configs: [blankConfig()] };
  fleet.push(ac);
  saveAircraft();
  return ac;
}

export function removeAircraft(id) {
  fleet = fleet.filter((a) => a.id !== id);
  saveAircraft();
}

export function findConfig(ref) {
  const ac = fleet.find((a) => a.id === ref?.aircraftId);
  const cfg = ac?.configs.find((c) => c.id === ref?.configId);
  return ac && cfg ? { aircraft: ac, config: cfg } : null;
}

/* ==== mergeAircraft ==== 共有ファイルの取り込み（同じ id は上書き） */
export function mergeAircraft(list) {
  (list || []).forEach((ac) => {
    const i = fleet.findIndex((a) => a.id === ac.id);
    if (i >= 0) fleet[i] = ac; else fleet.push(ac);
  });
  saveAircraft();
}
