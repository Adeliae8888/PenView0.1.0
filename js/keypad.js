/* ==== keypad.js ==== 手袋でも押せる大きいテンキー。openKeypad({title, unit, value}) → Promise<number|null> */

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'CLR', '0', '⌫'];
let el = null;

function ensure() {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'keypad hidden';
  el.innerHTML = `<div class="kp-box" role="dialog" aria-modal="true">
    <div class="kp-title"></div><div class="kp-display"><span class="kp-value"></span><span class="kp-unit"></span></div>
    <div class="kp-grid">${KEYS.map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('')}</div>
    <div class="kp-actions"><button type="button" data-k="cancel" class="btn">取消</button><button type="button" data-k="ok" class="btn primary">入力</button></div></div>`;
  document.body.appendChild(el);
  return el;
}

export function openKeypad({ title = '', unit = '', value = '' } = {}) {
  const box = ensure();
  let text = value === null || value === undefined ? '' : String(Math.round(value));
  const show = () => { box.querySelector('.kp-value').textContent = text || '0'; };
  box.querySelector('.kp-title').textContent = title;
  box.querySelector('.kp-unit').textContent = unit;
  show();
  box.classList.remove('hidden');
  return new Promise((resolve) => {
    const onClick = (e) => {
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (!k) return;
      if (k === 'ok' || k === 'cancel') {
        box.classList.add('hidden');
        box.removeEventListener('click', onClick);
        resolve(k === 'ok' && text !== '' ? Number(text) : null);
        return;
      }
      if (k === 'CLR') text = '';
      else if (k === '⌫') text = text.slice(0, -1);
      else if (text.length < 6) text = (text === '0' ? '' : text) + k;
      show();
    };
    box.addEventListener('click', onClick);
  });
}
