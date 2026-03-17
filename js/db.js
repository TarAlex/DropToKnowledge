/**
 * db.js — IndexedDB abstraction for DropToKnowledge
 * Shared by app.js, storage modules etc.
 */

const DB_NAME    = 'droptoknowledge-db';
const DB_VERSION = 2;
const STORE      = 'entries';
const SETTINGS   = 'settings';

let _db = null;

export function openDb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = event => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('type',      'type',      { unique: false });
        store.createIndex('synced',    'synced',    { unique: false });
      }

      if (!db.objectStoreNames.contains(SETTINGS)) {
        db.createObjectStore(SETTINGS, { keyPath: 'key' });
      }
    };

    req.onsuccess = () => {
      _db = req.result;

      // Re-open if browser closes the connection
      _db.onversionchange = () => {
        _db.close();
        _db = null;
      };

      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

// --- Entry CRUD ---------------------------------------------------------------

/** Insert or update entries */
export async function putEntries(entries) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    entries.forEach(e => store.put(e));
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

/** Fetch all entries (newest first by default) */
export async function getAllEntries({ type, sortBy = 'date-desc', search } = {}) {
  const db = await openDb();
  const entries = await new Promise((resolve, reject) => {
    const tx      = db.transaction(STORE, 'readonly');
    const store   = tx.objectStore(STORE);
    const index   = store.index('createdAt');
    const direction = sortBy === 'date-asc' ? 'next' : 'prev';
    const result  = [];
    const cursor  = index.openCursor(null, direction);

    cursor.onsuccess = event => {
      const c = event.target.result;
      if (!c) { resolve(result); return; }
      result.push(c.value);
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });

  let filtered = entries;

  if (type && type !== 'all') {
    filtered = filtered.filter(e => e.type === type);
  }

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(e =>
      (e.title  || '').toLowerCase().includes(q) ||
      (e.text   || '').toLowerCase().includes(q) ||
      (e.url    || '').toLowerCase().includes(q) ||
      (e.filename|| '').toLowerCase().includes(q)
    );
  }

  if (sortBy === 'type') {
    filtered.sort((a, b) => a.type.localeCompare(b.type) || b.createdAt.localeCompare(a.createdAt));
  }

  return filtered;
}

/** Get a single entry by id */
export async function getEntry(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req   = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Delete entry by id */
export async function deleteEntry(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req   = store.delete(id);
    req.onsuccess = resolve;
    req.onerror   = () => reject(req.error);
  });
}

/** Delete all entries */
export async function clearAllEntries() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req   = store.clear();
    req.onsuccess = resolve;
    req.onerror   = () => reject(req.error);
  });
}

/** Count entries per type */
export async function countByType() {
  const all = await getAllEntries();
  const counts = { all: all.length, url: 0, note: 0, images: 0, docs: 0, voice: 0 };
  all.forEach(e => {
    if (counts[e.type] !== undefined) counts[e.type]++;
    else counts.docs++;
  });
  return counts;
}

/** Merge changes into an existing entry and mark it unsynced */
export async function updateEntry(id, changes) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req   = store.get(id);
    req.onsuccess = () => {
      if (!req.result) { resolve(); return; }
      store.put({ ...req.result, ...changes, synced: false });
    };
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

/** Mark entries as synced */
export async function markSynced(ids) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of ids) {
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          req.result.synced = true;
          store.put(req.result);
        }
      };
    }
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

// --- Settings -----------------------------------------------------------------

export async function getSetting(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(SETTINGS, 'readonly');
    const req = tx.objectStore(SETTINGS).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror   = () => reject(req.error);
  });
}

export async function setSetting(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(SETTINGS, 'readwrite');
    const req = tx.objectStore(SETTINGS).put({ key, value });
    req.onsuccess = resolve;
    req.onerror   = () => reject(req.error);
  });
}

export async function getAllSettings() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(SETTINGS, 'readonly');
    const store = tx.objectStore(SETTINGS);
    const req   = store.getAll();
    req.onsuccess = () => {
      const obj = {};
      (req.result || []).forEach(item => { obj[item.key] = item.value; });
      resolve(obj);
    };
    req.onerror = () => reject(req.error);
  });
}
