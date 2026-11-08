/* ==== ui.js ==== 画面部品：上部バー・データパネル（NAV/TAC）・地点情報・設定 */
import { state, updateSettings, currentVariation, emit, AIRSPACE_CLASSES } from './state.js';
import { COORD_FORMATS, formatLatLon, formatBe, parseCoordinate } from './coords.js';
import { bearingTrue, distanceNm, toMagnetic, formatBearing, formatVariation } from './geo.js';
import { startGps, stopGps, isGpsOn, startSim, stopSim, isSimOn, updateSim, setManualOwn } from './gps.js';
import { esc, fmtLimit } from './map-render.js';

const $ = (id) => document.getElementById(id);
const LAYER_LABELS = { land: '陸地', airspace: '空域', airports: '飛行場', navaids: 'NAVAID', obstacles: '障害物' };
const GPS_LABELS = { off: 'GPS OFF', acquiring: 'GPS 捕捉中', ok: 'GPS', lost: 'GPS LOST', denied: 'GPS 不可', sim: 'SIM' };

export function showBanner(text) {
  const b = $('banner');
  b.textContent = text;
  b.classList.remove('hidden');
}

function fmtNum(v, digits = 0) {
  return Number.isFinite(v) ? v.toFixed(digits) : '---';
}

function fmtEte(distNm, gsKt) {
  if (!(gsKt > 30)) return '--:--';
  const totalSec = Math.round((distNm / gsKt) * 3600);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/* ==== renderDataPanel ==== モードに応じた主要データ */
export function renderDataPanel() {
  const s = state.settings;
  const own = state.own;
  const v = currentVariation().value;
  const el = $('dataPanel');
  if (!Number.isFinite(own.lat)) {
    el.innerHTML = '<div class="dp-empty">自機位置なし<br><small>設定 → GPS 受信開始 / 地図をタップして「自機をここに」</small></div>';
    return;
  }
  const trk = Number.isFinite(own.trk) ? `${formatBearing(toMagnetic(own.trk, v))}°` : '---°';
  const common = `<div class="dp-row"><span><b>TRK</b>${trk}</span><span><b>GS</b>${fmtNum(own.gs)}</span><span><b>ALT</b>${fmtNum(own.alt)}</span></div>`;
  if (s.mode === 'TAC') {
    el.innerHTML = `<div class="dp-big"><b>OWN B/E</b>${esc(formatBe(own, s.bullseye, v))}</div>${common}
      <div class="dp-sub">${esc(s.bullseye.name)} ${esc(formatLatLon(s.bullseye.lat, s.bullseye.lon, s.coordFormat))}</div>`;
  } else {
    el.innerHTML = `<div class="dp-pos">${esc(formatLatLon(own.lat, own.lon, s.coordFormat))}</div>${common}
      <div class="dp-sub">VAR ${formatVariation(v)} · ${own.source === 'gps' ? `GPS ±${fmtNum(own.acc)}m` : own.source === 'sim' ? '模擬飛行' : '手動位置'}</div>`;
  }
}

/* ==== renderTopBar ==== モード・GPS・座標形式の表示 */
export function renderTopBar() {
  const s = state.settings;
  document.body.classList.toggle('mode-tac', s.mode === 'TAC');
  document.body.classList.toggle('mode-nav', s.mode === 'NAV');
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === s.mode)));
  const pill = $('gpsPill');
  pill.textContent = GPS_LABELS[state.gpsStatus] || 'GPS';
  pill.dataset.status = state.gpsStatus;
  $('coordBtn').textContent = s.coordFormat;
  $('followBtn').classList.toggle('active', s.follow);
  $('orientBtn').textContent = s.orientation === 'track' ? 'TRK↑' : 'N↑';
}

/* ==== renderInfo ==== タップした地点の情報（全座標形式・B/E・自機からの方位距離・空域） */
export function renderInfo(hits) {
  const sheet = $('infoSheet');
  const sel = state.selection;
  if (!sel) { sheet.classList.remove('open'); return; }
  const s = state.settings;
  const v = currentVariation().value;
  const coordRows = COORD_FORMATS.map((f) => `<tr><th>${f}</th><td class="mono sel-text">${esc(formatLatLon(sel.lat, sel.lon, f))}</td></tr>`).join('');
  let fromOwn = '';
  if (Number.isFinite(state.own.lat)) {
    const d = distanceNm(state.own, sel);
    fromOwn = `<tr><th>自機から</th><td class="mono">${formatBearing(toMagnetic(bearingTrue(state.own, sel), v))}°M / ${d.toFixed(1)}nm / ETE ${fmtEte(d, state.own.gs)}</td></tr>`;
  }
  const list = (title, items) => (items.length ? `<h3>${title}</h3><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '');
  sheet.innerHTML = `<div class="sheet-head"><h2>選択地点</h2><button type="button" class="btn" data-close-info>閉じる</button></div>
    <table class="kv">${coordRows}<tr><th>B/E</th><td class="mono">${esc(s.bullseye.name)} ${esc(formatBe(sel, s.bullseye, v))}</td></tr>${fromOwn}</table>
    ${list('近くの施設', (hits?.near || []).map((n) => n.label))}
    ${list('この地点の空域', hits?.airspaces || [])}
    <div class="row wrap actions">
      <button type="button" class="btn" data-act="bull">ブルズアイに設定</button>
      <button type="button" class="btn" data-act="own">自機をここに</button>
    </div>`;
  sheet.classList.add('open');
}

/* ==== renderSettings ==== 設定画面の値を現在の状態に合わせる */
export function renderSettings() {
  const s = state.settings;
  $('gpsToggle').textContent = isGpsOn() ? 'GPS 受信停止' : 'GPS 受信開始';
  $('simToggle').textContent = isSimOn() ? '模擬飛行 停止' : '模擬飛行 開始';
  $('gpsDetail').textContent = GPS_LABELS[state.gpsStatus];
  $('bullName').value = s.bullseye.name || '';
  $('bullInput').placeholder = formatLatLon(s.bullseye.lat, s.bullseye.lon, s.coordFormat);
  document.querySelectorAll('input[name="varMode"]').forEach((r) => { r.checked = r.value === s.varMode; });
  $('manualVar').value = s.manualVar;
  $('manualVar').disabled = s.varMode !== 'manual';
  const cv = currentVariation();
  $('varStatus').textContent = `使用中 ${formatVariation(cv.value)}（${{ gsi: '国土地理院 近似式・自機位置', manual: '手動', 'manual-fallback': '近似式の範囲外のため手動値' }[cv.source]}）`;
  const chip = (group, key, label, on) => `<label class="chip"><input type="checkbox" data-${group}="${key}" ${on ? 'checked' : ''}/>${esc(label)}</label>`;
  $('layerToggles').innerHTML = Object.entries(LAYER_LABELS).map(([k, l]) => chip('layer', k, l, s.layers[k])).join('');
  $('airspaceToggles').innerHTML = Object.entries(AIRSPACE_CLASSES).map(([k, l]) => chip('asclass', k, l, s.airspaceClasses[k])).join('');
  $('aboutText').textContent = `${self.APP_NAME} ${self.APP_VERSION} · 空域等 OpenAIP（CC BY-NC 4.0, openaip.net）· 陸地 Natural Earth · 偏差 国土地理院 磁気図2020.0年値`;
}

function coordCtx() {
  return { bullseye: state.settings.bullseye, variation: currentVariation().value };
}

/* ==== bindUi ==== イベント結線。地図操作は main.js が渡す actions で行う */
export function bindUi(actions) {
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => updateSettings({ mode: b.dataset.mode })));
  $('coordBtn').addEventListener('click', () => {
    const i = COORD_FORMATS.indexOf(state.settings.coordFormat);
    updateSettings({ coordFormat: COORD_FORMATS[(i + 1) % COORD_FORMATS.length] });
  });
  $('settingsBtn').addEventListener('click', () => { renderSettings(); $('settingsSheet').classList.add('open'); });
  $('gpsPill').addEventListener('click', () => { renderSettings(); $('settingsSheet').classList.add('open'); });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => $(b.dataset.close).classList.remove('open')));
  $('zoomIn').addEventListener('click', () => actions.zoom(1.6));
  $('zoomOut').addEventListener('click', () => actions.zoom(1 / 1.6));
  $('followBtn').addEventListener('click', () => updateSettings({ follow: !state.settings.follow }));
  $('orientBtn').addEventListener('click', () => updateSettings({ orientation: state.settings.orientation === 'track' ? 'north' : 'track' }));
  bindInfoSheet(actions);
  bindSettingsSheet(actions);
}

function bindInfoSheet(actions) {
  $('infoSheet').addEventListener('click', (e) => {
    const sel = state.selection;
    if (e.target.closest('[data-close-info]')) { state.selection = null; emit('selection'); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || !sel) return;
    if (act === 'bull') updateSettings({ bullseye: { ...state.settings.bullseye, lat: sel.lat, lon: sel.lon } });
    if (act === 'own') { setManualOwn(sel.lat, sel.lon); updateSettings({ manualOwn: { lat: sel.lat, lon: sel.lon } }); }
    state.selection = null;
    emit('selection');
    actions.redraw();
  });
}

function bindSettingsSheet(actions) {
  $('gpsToggle').addEventListener('click', () => { if (isGpsOn()) stopGps(); else startGps(); renderSettings(); });
  $('simToggle').addEventListener('click', () => {
    if (isSimOn()) { stopSim(); renderSettings(); return; }
    const start = Number.isFinite(state.own.lat) ? state.own : actions.center();
    const v = currentVariation().value;
    startSim({ lat: start.lat, lon: start.lon, trk: (Number($('simTrk').value) + v + 360) % 360, gs: Number($('simGs').value), alt: Number($('simAlt').value) });
    renderSettings();
  });
  ['simTrk', 'simGs', 'simAlt'].forEach((id) => $(id).addEventListener('change', () => {
    const v = currentVariation().value;
    updateSim({ trk: (Number($('simTrk').value) + v + 360) % 360, gs: Number($('simGs').value), alt: Number($('simAlt').value) });
  }));
  $('bullApply').addEventListener('click', () => {
    const text = $('bullInput').value.trim();
    const p = text ? parseCoordinate(text, coordCtx()) : state.settings.bullseye;
    if (!p) { $('bullStatus').textContent = '座標を読み取れません'; return; }
    updateSettings({ bullseye: { lat: p.lat, lon: p.lon, name: $('bullName').value.trim() || 'BULL' } });
    $('bullInput').value = '';
    $('bullStatus').textContent = `設定しました：${formatLatLon(p.lat, p.lon, state.settings.coordFormat)}`;
  });
  document.querySelectorAll('input[name="varMode"]').forEach((r) => r.addEventListener('change', () => { updateSettings({ varMode: r.value }); renderSettings(); }));
  $('manualVar').addEventListener('change', () => { updateSettings({ manualVar: Number($('manualVar').value) || 0 }); renderSettings(); });
  $('gotoBtn').addEventListener('click', () => {
    const p = parseCoordinate($('gotoInput').value, coordCtx());
    $('gotoStatus').textContent = p ? formatLatLon(p.lat, p.lon, state.settings.coordFormat) : '座標を読み取れません';
    if (p) actions.goTo(p);
  });
  $('settingsSheet').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.layer) updateSettings({ layers: { ...state.settings.layers, [t.dataset.layer]: t.checked } });
    if (t.dataset.asclass) updateSettings({ airspaceClasses: { ...state.settings.airspaceClasses, [t.dataset.asclass]: t.checked } });
  });
}
