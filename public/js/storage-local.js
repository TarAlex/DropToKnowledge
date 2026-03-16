/**
 * storage-local.js — File System Access API storage adapter for 1folder
 * Writes entries into a user-chosen directory, organized by type.
 */

import { getSetting, setSetting, markSynced } from './db.js';

// We persist the FileSystemDirectoryHandle in IndexedDB so it survives page reloads.
// Note: The handle must be re-verified each session (user may revoke permission).

let _dirHandle = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns true if File System Access API is available */
export function isSupported() {
  return 'showDirectoryPicker' in window;
}

/** Ask user to choose a directory and persist the handle */
export async function chooseDirectory() {
  if (!isSupported()) {
    throw new Error('File System Access API is not supported in this browser.');
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await persistHandle(handle);
  _dirHandle = handle;
  return handle.name;
}

/** Restore persisted handle from IDB (ask permission again if needed) */
export async function restoreDirectory() {
  try {
    const serialized = await getSetting('dirHandle');
    if (!serialized) return null;

    // We store by name only (can't serialize handles to IDB reliably cross-origin)
    // On Chrome 86+ handles can be stored in IDB natively
    // Here we attempt native IDB storage first, fall back to name only
    const handle = await getHandleFromIdb();
    if (!handle) return null;

    const permission = await verifyPermission(handle);
    if (!permission) return null;

    _dirHandle = handle;
    return handle.name;
  } catch (err) {
    console.warn('[storage-local] Could not restore directory handle:', err);
    return null;
  }
}

/** Returns the currently active directory name, or null */
export async function getDirectoryName() {
  if (_dirHandle) return _dirHandle.name;
  return restoreDirectory();
}

/** Sync an array of entries to the selected directory */
export async function syncEntries(entries, opts = {}) {
  if (!_dirHandle) {
    const restored = await restoreDirectory();
    if (!restored) throw new Error('No directory selected. Please choose a folder in Settings.');
  }

  const {
    organizeByType = true,
    datePrefix     = true
  } = opts;

  const syncedIds = [];
  const errors    = [];

  for (const entry of entries) {
    try {
      await writeEntry(entry, { organizeByType, datePrefix });
      syncedIds.push(entry.id);
    } catch (err) {
      console.error('[storage-local] Failed to write entry:', entry.id, err);
      errors.push({ id: entry.id, error: err.message });
    }
  }

  if (syncedIds.length > 0) {
    await markSynced(syncedIds);
  }

  return { synced: syncedIds.length, errors };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function writeEntry(entry, { organizeByType, datePrefix }) {
  let targetDir = _dirHandle;

  if (organizeByType) {
    const subdirName = typeToFolder(entry.type);
    targetDir = await _dirHandle.getDirectoryHandle(subdirName, { create: true });
  }

  const filename = buildFilename(entry, datePrefix);
  const fileHandle = await targetDir.getFileHandle(filename, { create: true });
  const writable   = await fileHandle.createWritable();

  if (entry.content) {
    // Binary file (image, audio, doc etc.)
    await writable.write(entry.content);
  } else if (entry.type === 'url') {
    // Write URL as plain text with metadata
    const lines = [
      entry.url || entry.text || '',
      '',
      `Title: ${entry.title || ''}`,
      `Saved: ${entry.createdAt}`
    ];
    await writable.write(lines.join('\n'));
  } else {
    // Note / text
    const lines = [
      entry.title ? `# ${entry.title}` : '',
      entry.title ? '' : null,
      entry.text || '',
      '',
      `---`,
      `Saved: ${entry.createdAt}`
    ].filter(l => l !== null);
    await writable.write(lines.join('\n'));
  }

  await writable.close();
}

function typeToFolder(type) {
  const map = {
    url:    'links',
    note:   'notes',
    images: 'images',
    docs:   'documents',
    voice:  'audio'
  };
  return map[type] || 'other';
}

function buildFilename(entry, datePrefix) {
  if (!datePrefix) return entry.filename;

  // entry.filename already has a date prefix from SW, use as-is
  return entry.filename || `${entry.createdAt.replace(/[:.]/g, '-')}_${entry.id.slice(0, 8)}.txt`;
}

async function verifyPermission(handle, mode = 'readwrite') {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

// Store the actual FileSystemDirectoryHandle in IDB (Chrome 86+ supports this natively)
const IDB_HANDLE_KEY = '1folder-dir-handle';

async function persistHandle(handle) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('1folder-handles', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('handles');
    };
    req.onsuccess = () => {
      const db  = req.result;
      const tx  = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, IDB_HANDLE_KEY);
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

async function getHandleFromIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('1folder-handles', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('handles');
    };
    req.onsuccess = () => {
      const db    = req.result;
      const tx    = db.transaction('handles', 'readonly');
      const store = tx.objectStore('handles');
      const get   = store.get(IDB_HANDLE_KEY);
      get.onsuccess = () => resolve(get.result || null);
      get.onerror   = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}
