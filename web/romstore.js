// SPDX-License-Identifier: GPL-3.0-only
//
// Browser-side cache for assembled ROM images, so a visitor drops their zip once
// and it is there on every later visit. IndexedDB (not localStorage) because the
// images are binary and tens of kilobytes, and IDB stores Uint8Arrays natively.
//
// The visitor's own ROM bytes stay in their own browser's origin storage; nothing
// here talks to the network. Clearing site data removes them.
//
// Everything degrades to a no-op: private windows, storage-blocked contexts and
// browsers without IndexedDB must still be able to play (they just re-drop the
// zip each session), so every entry point catches and returns null/false rather
// than rejecting.

const DB_NAME = "arcade-js";
const DB_VERSION = 1;
const STORE = "roms";

function openDb() {
  return new Promise((resolve, reject) => {
    const idb = globalThis.indexedDB;
    if (!idb) return resolve(null);
    let req;
    try { req = idb.open(DB_NAME, DB_VERSION); } catch (e) { return reject(e); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexedDB.open failed"));
    req.onblocked = () => resolve(null);
  });
}

function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(STORE, mode); } catch (e) { return reject(e); }
    let result;
    const req = fn(t.objectStore(STORE));
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error("idb transaction failed"));
    t.onabort = () => reject(t.error || new Error("idb transaction aborted"));
  });
}

/**
 * @returns {Promise<Object<string,Uint8Array>|null>} the cached images for a
 * game, or null if nothing is cached / caching is unavailable.
 */
export async function getCached(gameId) {
  let db = null;
  try {
    db = await openDb();
    if (!db) return null;
    const rec = await run(db, "readonly", (s) => s.get(gameId));
    if (!rec || !rec.images) return null;
    const out = {};
    for (const [name, v] of Object.entries(rec.images)) {
      out[name] = v instanceof Uint8Array ? v : new Uint8Array(v);
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  } finally {
    if (db) try { db.close(); } catch { /* nothing to do */ }
  }
}

/**
 * Store assembled images for a game. Copies them, so the caller may afterwards
 * transfer the originals' ArrayBuffers to the worker (which detaches them).
 * @returns {Promise<boolean>} whether it was actually cached.
 */
export async function putCached(gameId, images) {
  let db = null;
  try {
    const rec = { id: gameId, savedAt: Date.now(), images: {} };
    for (const [name, v] of Object.entries(images)) rec.images[name] = v.slice();
    db = await openDb();
    if (!db) return false;
    await run(db, "readwrite", (s) => s.put(rec));
    return true;
  } catch {
    return false;
  } finally {
    if (db) try { db.close(); } catch { /* nothing to do */ }
  }
}

/** Forget a game's cached images ("use a different zip"). */
export async function clearCached(gameId) {
  let db = null;
  try {
    db = await openDb();
    if (!db) return false;
    await run(db, "readwrite", (s) => s.delete(gameId));
    return true;
  } catch {
    return false;
  } finally {
    if (db) try { db.close(); } catch { /* nothing to do */ }
  }
}
