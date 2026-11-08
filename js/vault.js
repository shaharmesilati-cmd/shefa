// Encrypted storage on this device only.
// - A random 256-bit data key encrypts everything (AES-GCM).
// - The data key is stored wrapped by a key derived from the user's passcode (PBKDF2-SHA256).
// - Nothing is ever sent anywhere. Without the passcode the stored data is unreadable.

const DB = 'shefa', STORE = 'kv';
const ITER = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
const rand = n => crypto.getRandomValues(new Uint8Array(n));

let dataKey = null;

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => { db.close(); res(req ? req.result : undefined); };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}
const get = k => tx('readonly', s => s.get(k));
const put = (k, v) => tx('readwrite', s => { s.put(v, k); });
const del = k => tx('readwrite', s => { s.delete(k); });

async function deriveKek(pass, salt, iter, usages) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(pass).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, usages);
}

export const isUnlocked = () => !!dataKey;
export async function exists() { return !!(await get('meta')); }
export async function lockState() {
  const m = await get('meta');
  return { fails: m?.fails || 0, lockUntil: m?.lockUntil || 0 };
}

export async function create(pass) {
  const salt = rand(16), iv = rand(12);
  const kek = await deriveKek(pass, salt, ITER, ['wrapKey', 'unwrapKey']);
  const dk = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrapped = new Uint8Array(await crypto.subtle.wrapKey('raw', dk, kek, { name: 'AES-GCM', iv }));
  await put('meta', { v: 1, salt, iter: ITER, iv, wrapped, fails: 0, lockUntil: 0, created: Date.now() });
  dataKey = await crypto.subtle.unwrapKey('raw', wrapped, kek, { name: 'AES-GCM', iv }, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function unwrapWith(meta, pass, extractable) {
  const kek = await deriveKek(pass, meta.salt, meta.iter, ['wrapKey', 'unwrapKey']);
  return crypto.subtle.unwrapKey('raw', meta.wrapped, kek, { name: 'AES-GCM', iv: meta.iv }, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt']);
}

/** Throws {code:'wrong'} or {code:'wait', seconds}. After 5 wrong tries the waits grow. */
export async function unlock(pass) {
  const meta = await get('meta');
  if (!meta) throw { code: 'missing' };
  const now = Date.now();
  if (meta.lockUntil > now) throw { code: 'wait', seconds: Math.ceil((meta.lockUntil - now) / 1000) };
  try {
    dataKey = await unwrapWith(meta, pass, false);
  } catch {
    meta.fails = (meta.fails || 0) + 1;
    meta.lockUntil = meta.fails >= 5 ? now + Math.min(3600, 30 * 2 ** (meta.fails - 5)) * 1000 : 0;
    await put('meta', meta);
    throw { code: 'wrong', fails: meta.fails };
  }
  if (meta.fails) { meta.fails = 0; meta.lockUntil = 0; await put('meta', meta); }
}

export async function changePass(oldPass, newPass) {
  const meta = await get('meta');
  let dk;
  try { dk = await unwrapWith(meta, oldPass, true); } catch { throw { code: 'wrong' }; }
  const salt = rand(16), iv = rand(12);
  const kek = await deriveKek(newPass, salt, ITER, ['wrapKey', 'unwrapKey']);
  const wrapped = new Uint8Array(await crypto.subtle.wrapKey('raw', dk, kek, { name: 'AES-GCM', iv }));
  await put('meta', { ...meta, salt, iter: ITER, iv, wrapped, fails: 0, lockUntil: 0 });
}

export function lock() { dataKey = null; }

/* "Stay signed in on this device": the data key is kept in this browser's storage as a non-exportable key,
   so the app opens without the passcode. The phone's own screen lock then protects it. */
export async function setRemember(on) {
  if (on) { if (!dataKey) throw { code: 'locked' }; await put('remember', { key: dataKey, at: Date.now() }); }
  else await del('remember');
}
export async function isRemembered() { const r = await get('remember'); return !!(r && r.key); }
export async function openRemembered() {
  const r = await get('remember');
  if (!r || !r.key) return false;
  dataKey = r.key;
  try { await load(); return true; } catch { dataKey = null; await del('remember'); return false; }
}

export async function load() {
  if (!dataKey) throw { code: 'locked' };
  const rec = await get('data');
  if (!rec) return null;
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, dataKey, rec.ct);
  return JSON.parse(dec.decode(pt));
}

export async function save(obj) {
  if (!dataKey) throw { code: 'locked' };
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, enc.encode(JSON.stringify(obj))));
  await put('data', { iv, ct, at: Date.now() });
}

export function wipe() {
  dataKey = null;
  try { localStorage.removeItem('stashwise-had-data'); } catch { }
  return new Promise(res => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => res(); });
}

/* ---- encrypted backup file (to move data between devices) ---- */
const b64 = u8 => btoa(String.fromCharCode(...u8));
const b64big = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function exportBackup(obj, pass) {
  const salt = rand(16), iv = rand(12);
  const key = await deriveKek(pass, salt, ITER, ['encrypt', 'decrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  return JSON.stringify({ format: 'shefa-backup', v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), data: b64big(ct) });
}
export async function importBackup(text, pass) {
  let f;
  try { f = JSON.parse(text); } catch { throw { code: 'format' }; }
  if (f.format !== 'shefa-backup') throw { code: 'format' };
  const key = await deriveKek(pass, unb64(f.salt), f.iter || ITER, ['encrypt', 'decrypt']);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv) }, key, unb64(f.data));
    return JSON.parse(dec.decode(pt));
  } catch { throw { code: 'wrong' }; }
}
