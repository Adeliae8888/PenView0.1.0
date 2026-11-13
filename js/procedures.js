/* ==== procedures.js ==== SID/STAR/APP の手順（エディターで作図）の保持と保存 */
import { load, save } from './store.js';

export const PROC_KEY = 'procedures';
export const PROC_TYPES = ['SID', 'TRANSITION', 'STAR', 'APP'];   // TRANSITION は parents（つながる SID または STAR の id）を持つ
export const PART_TYPES = { tf: '直線（→フィックス）', radial: 'ラジアル', heading: '針路で上昇', turnhdg: '旋回して針路', arc: 'DME アーク' };
let list = [];
const uid = (p) => `${p}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export async function loadProcedures() {
  list = await load(PROC_KEY, []);
  return list;
}

export function procedures() {
  return list;
}

export function saveProcedures() {
  return save(PROC_KEY, list);
}

export function findProcedure(id) {
  return list.find((p) => p.id === id) || null;
}

export function newProcedure(ad = '', type = 'SID') {
  const p = { id: uid('pr'), ad: ad.toUpperCase(), type, name: '', rwy: '', derText: '', startFix: '', startAlt: null, parents: [], parts: [], missed: [], visible: true };
  list.push(p);
  saveProcedures();
  return p;
}

export function removeProcedure(id) {
  list = list.filter((p) => p.id !== id);
  saveProcedures();
}

export function duplicateProcedure(proc) {
  const c = { ...structuredClone(proc), id: uid('pr'), name: `${proc.name} コピー` };
  [...c.parts, ...c.missed].forEach((pt) => { pt.id = uid('pt'); });
  list.push(c);
  saveProcedures();
  return c;
}

/* ==== newPart ==== パーツのひな形 */
export function newPart(type) {
  const base = { id: uid('pt'), type, name: '', alt: null, speed: null, turn: null };
  if (type === 'tf') return { ...base, to: '' };
  if (type === 'radial') return { ...base, station: '', radial: null, inbound: false, end: { type: 'dme', dist: null } };
  if (type === 'heading') return { ...base, hdg: null, end: { type: 'alt', alt: null, grad: 3.3 } };
  if (type === 'turnhdg') return { ...base, dir: 'L', hdg: null, end: { type: 'fix', to: '' } };
  return { ...base, station: '', dme: null, to: null, dir: 'R' };
}

/* ==== mergeProcedures ==== 共有ファイルの取り込み（同じ id は上書き） */
export function mergeProcedures(items) {
  (items || []).forEach((p) => {
    const i = list.findIndex((x) => x.id === p.id);
    if (i >= 0) list[i] = p; else list.push(p);
  });
  saveProcedures();
}

/* ==== procLabel ==== 一覧表示用 "RJAH SID TOPAZ1" */
export function procLabel(p) {
  return `${p.ad || '----'} ${p.type === 'TRANSITION' ? 'TRANS' : p.type} ${p.name || '(名前なし)'}${p.type === 'SID' && p.rwy ? ` RWY${p.rwy}` : ''}`;
}
