/* ==== clock.js ==== 時刻：端末時計＋ TIME HACK（秒単位の補正）。表示は Zulu 既定、JST に切替可 */
import { state } from './state.js';

const JST_OFFSET_MS = 9 * 3600 * 1000;

export function now() {
  return Date.now() + (state.settings.timeOffsetMs || 0);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/* ==== formatClock ==== ms → "12:34:56Z" / "21:34:56L" */
export function formatClock(ms, withSeconds = true) {
  if (!Number.isFinite(ms)) return '--:--';
  const jst = state.settings.timeZone === 'JST';
  const d = new Date(ms + (jst ? JST_OFFSET_MS : 0));
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return `${hm}${withSeconds ? `:${pad(d.getUTCSeconds())}` : ''}${jst ? 'L' : 'Z'}`;
}

/* ==== formatDuration ==== 時間(h) → "m:ss" / "h:mm:ss" */
export function formatDuration(hours) {
  if (!Number.isFinite(hours) || hours < 0) return '--:--';
  const total = Math.round(hours * 3600);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/* ==== parseClock ==== "1234" / "12:34" / "12:34:56"（表示中のタイムゾーン）→ 今日のその時刻の ms */
export function parseClock(text, refMs = now()) {
  const m = String(text || '').trim().match(/^(\d{1,2}):?(\d{2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
  if (h > 23 || mi > 59 || s > 59) return null;
  const off = state.settings.timeZone === 'JST' ? JST_OFFSET_MS : 0;
  const d = new Date(refMs + off);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, mi, s) - off;
}
