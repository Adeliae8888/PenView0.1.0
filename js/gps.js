/* ==== gps.js ==== 自機位置の取得：GPS（端末の位置情報）／模擬飛行（PC での確認用）／手動設定 */
import { state, emit } from './state.js';
import { bearingTrue, distanceNm, destination, FT_PER_M, KT_PER_MPS } from './geo.js';

const STALE_MS = 5000;              // これ以上更新が無ければ LOST
const MIN_MOVE_NM = 0.01;           // 端末が針路を出さないとき、これ以上動いたら位置差から針路を出す
const MIN_SPEED_FOR_TRACK_KT = 2;
const SIM_STEP_MS = 1000;

let watchId = null;
let lastFix = null;
let simTimer = null;
let staleTimer = null;

function setOwn(patch) {
  Object.assign(state.own, patch, { time: Date.now() });
  emit('own', state.own);
}

function setStatus(status) {
  if (state.gpsStatus === status) return;
  state.gpsStatus = status;
  emit('gpsStatus', status);
}

/* ==== handleFix ==== 位置情報1回分。針路・速度が無い端末は前回位置との差から求める */
function handleFix(pos) {
  const c = pos.coords;
  const here = { lat: c.latitude, lon: c.longitude };
  let trk = Number.isFinite(c.heading) && c.speed > MIN_SPEED_FOR_TRACK_KT / KT_PER_MPS ? c.heading : null;
  let gs = Number.isFinite(c.speed) ? c.speed * KT_PER_MPS : null;
  if (lastFix) {
    const moved = distanceNm(lastFix, here);
    const hours = (pos.timestamp - lastFix.t) / 3600000;
    if (gs === null && hours > 0) gs = moved / hours;
    if (trk === null && moved > MIN_MOVE_NM) trk = bearingTrue(lastFix, here);
  }
  if (trk === null && Number.isFinite(state.own.trk)) trk = state.own.trk;
  lastFix = { ...here, t: pos.timestamp };
  setOwn({ ...here, trk, gs, alt: Number.isFinite(c.altitude) ? c.altitude * FT_PER_M : null, acc: c.accuracy, source: 'gps' });
  setStatus('ok');
}

export function startGps() {
  if (!('geolocation' in navigator)) { setStatus('denied'); return; }
  stopSim();
  setStatus('acquiring');
  watchId = navigator.geolocation.watchPosition(handleFix, (err) => {
    setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'lost');
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  clearInterval(staleTimer);
  staleTimer = setInterval(() => {
    if (state.gpsStatus === 'ok' && Date.now() - state.own.time > STALE_MS) setStatus('lost');
    emit('tick');
  }, 1000);
}

export function stopGps() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  lastFix = null;
  clearInterval(staleTimer);
  setStatus('off');
}

export function isGpsOn() {
  return watchId !== null;
}

/* ==== startSim ==== 模擬飛行：指定の針路・速度・高度で1秒ごとに進める */
export function startSim({ lat, lon, trk = 0, gs = 420, alt = 20000 }) {
  stopGps();
  stopSim();
  setOwn({ lat, lon, trk, gs, alt, source: 'sim' });
  setStatus('sim');
  simTimer = setInterval(() => {
    const next = destination(state.own, state.own.trk, (state.own.gs * SIM_STEP_MS) / 3600000);
    setOwn(next);
  }, SIM_STEP_MS);
}

export function updateSim(patch) {
  if (simTimer) setOwn(patch);
}

export function stopSim() {
  if (simTimer) { clearInterval(simTimer); simTimer = null; setStatus('off'); }
}

export function isSimOn() {
  return simTimer !== null;
}

/* ==== setManualOwn ==== GPS なしで自機位置を手で置く */
export function setManualOwn(lat, lon) {
  stopGps();
  stopSim();
  setOwn({ lat, lon, trk: null, gs: null, alt: null, source: 'manual' });
}
