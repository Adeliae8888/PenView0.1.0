/* ==== store.js ==== 保存層。すべて IndexedDB（容量大）。失敗は onError で必ず表に出す（握りつぶさない） */

const DB_NAME = 'penview';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise = null;
let onError = (what, error) => console.error(`[store] ${what}`, error);

export function setStoreErrorHandler(handler) {
  onError = handler;
}

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB 非対応')); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function run(mode, action) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

/* ==== load ==== 値を読む。失敗・未保存は fallback を返し、失敗は通知 */
export async function load(key, fallback) {
  try {
    const value = await run('readonly', (s) => s.get(key));
    return value === undefined ? fallback : value;
  } catch (error) {
    onError(`読込 ${key}`, error);
    return fallback;
  }
}

/* ==== save ==== 値を書く。完了を待てる。失敗は通知して false */
export async function save(key, value) {
  try {
    await run('readwrite', (s) => s.put(value, key));
    return true;
  } catch (error) {
    onError(`保存 ${key}`, error);
    return false;
  }
}

/* ==== saveLater ==== 連続変更をまとめて書く。予約済みなら延長しない（毎秒の変更で永遠に保存されない問題の対策）。
 * 書く値は発火時に getValue() で取るので、最新が保存される */
const timers = new Map();
export function saveLater(key, getValue, delayMs = 300) {
  if (timers.has(key)) return;
  timers.set(key, setTimeout(() => { timers.delete(key); save(key, getValue()); }, delayMs));
}

/* ==== requestPersistence ==== ブラウザによる自動削除を防ぐ（iOS の7日ルール対策） */
export function requestPersistence() {
  return navigator.storage?.persist ? navigator.storage.persist().catch(() => false) : Promise.resolve(false);
}
