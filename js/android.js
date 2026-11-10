/* ==== android.js ==== タブレット（主に Android）向け：画面を消さない（Wake Lock）、戻るボタンで一番上のシート・テンキーを閉じる */
import { state, on, updateSettings } from './state.js';

let lock = null;

/* ==== keepAwake ==== 設定 keepAwake が ON の間は画面を消さない。アプリが裏に回ると解除されるので、戻ったら取り直す */
async function keepAwake() {
  const want = state.settings.keepAwake !== false && document.visibilityState === 'visible';
  if (!('wakeLock' in navigator)) return;
  try {
    if (want && !lock) {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if (!want && lock) {
      await lock.release();
      lock = null;
    }
  } catch (error) {
    lock = null;            // 省電力モードなどで断られることがある（致命的ではない）
    console.warn('wakeLock', error);
  }
}

export function wakeLockActive() {
  return !!lock;
}

const CLOSABLE = ['.keypad', '#infoSheet', '#dataSheet', '#settingsSheet'];
const isKeypad = (el) => el.classList.contains('keypad');
const isOpen = (el) => el && (isKeypad(el) ? !el.classList.contains('hidden') : el.classList.contains('open'));

function topOpen() {
  return CLOSABLE.map((s) => document.querySelector(s)).find(isOpen) || null;
}

function closeEl(el) {
  if (isKeypad(el)) el.querySelector('[data-k="cancel"]')?.click();
  else if (el.id === 'infoSheet') el.querySelector('[data-close-info]')?.click() || el.classList.remove('open');
  else el.classList.remove('open');
}

/* ==== bindBackButton ==== シートが開いたら履歴を1つ積み、戻るボタン（popstate）でそれを閉じる。開いていなければ普通に戻る */
function bindBackButton() {
  let pushed = false;
  let skip = false;                 // 閉じるボタンで閉じたとき、積んだ履歴を自分で戻す分の popstate は無視
  const watched = new WeakSet();
  const sync = () => {
    const open = !!topOpen();
    if (open && !pushed) { history.pushState({ penviewSheet: true }, ''); pushed = true; }
    if (!open && pushed) { pushed = false; skip = true; history.back(); }
  };
  const mo = new MutationObserver(sync);
  const watch = () => CLOSABLE.forEach((s) => {
    const el = document.querySelector(s);
    if (el && !watched.has(el)) { watched.add(el); mo.observe(el, { attributes: true, attributeFilter: ['class'] }); }
  });
  new MutationObserver(watch).observe(document.body, { childList: true });   // テンキーは初回に作られる
  watch();
  window.addEventListener('popstate', () => {
    if (skip) { skip = false; return; }
    pushed = false;
    const el = topOpen();
    if (el) { closeEl(el); setTimeout(sync, 0); }
  });
}

function bindKeepAwakeToggle() {
  const box = document.getElementById('keepAwake');
  if (!box) return;
  const show = () => {
    box.checked = state.settings.keepAwake !== false;
    const st = document.getElementById('wakeStatus');
    if (st) st.textContent = !('wakeLock' in navigator) ? 'この端末は非対応' : (lock ? '作動中' : '');
  };
  box.addEventListener('change', () => updateSettings({ keepAwake: box.checked }));
  on('settings', () => setTimeout(show, 300));
  show();
}

export function initAndroid() {
  bindKeepAwakeToggle();
  keepAwake();
  document.addEventListener('visibilitychange', keepAwake);
  on('settings', keepAwake);
  bindBackButton();
}
