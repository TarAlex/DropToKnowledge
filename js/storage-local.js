/**
 * storage-local.js — File System Access API storage adapter for DropToKnowledge
 * Writes entries into a user-chosen directory, organized by type.
 */

import { getSetting, setSetting, markSynced } from './db.js';

// We persist the FileSystemDirectoryHandle in IndexedDB so it survives page reloads.
let _dirHandle = null;

// --- Public API ---------------------------------------------------------------

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

// --- Private helpers ----------------------------------------------------------

async function writeEntry(entry, { organizeByType, datePrefix }) {
  let targetDir = _dirHandle;

  if (organizeByType) {
    const subdirName = typeToFolder(entry.type);
    targetDir = await _dirHandle.getDirectoryHandle(subdirName, { create: true });
  }

  const baseFilename = buildFilename(entry, datePrefix);

  if (entry.content) {
    // Binary file (image, audio, doc etc.)
    const fileHandle = await targetDir.getFileHandle(baseFilename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(entry.content);
    await writable.close();

    // For binary files, we still want to save metadata (tags/comments)
    await updateMetadataFile(entry, targetDir, baseFilename);
  } else {
    // For URLs and Notes, we save everything in a single .md file
    const mdFilename = baseFilename.replace(/\.[^.]+$/, '') + '.md';
    await updateMetadataFile(entry, targetDir, mdFilename);
  }
}

/**
 * Updates (or creates) an .md file with frontmatter metadata and content.
 */
async function updateMetadataFile(entry, targetDir, filename) {
  const mdFilename = filename.endsWith('.md') ? filename : `${filename}.md`;
  const tags = (entry.tags || []).join(', ');
  const comment = entry.comment || '';

  let bodyContent = '';
  if (entry.type === 'url') {
    bodyContent = `[${entry.url || entry.text}](${entry.url || entry.text})`;
  } else if (entry.type === 'note') {
    bodyContent = entry.text || '';
  } else {
    // Binary file metadata
    bodyContent = `Metadata for shared file: ${filename}`;
  }

  const fileContent = [
    '---',
    `title: "${(entry.title || '').replace(/"/g, '\\"')}"`,
    `type: ${entry.type}`,
    `id: ${entry.id}`,
    `saved: ${entry.createdAt}`,
    `tags: [${tags}]`,
    '---',
    '',
    bodyContent,
    '',
    '## Notes',
    '',
    comment
  ].join('\n');

  const fileHandle = await targetDir.getFileHandle(mdFilename, { create: true });
  const writable   = await fileHandle.createWritable();
  await writable.write(fileContent);
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
  if (entry.filename) return entry.filename;

  const dateStr = entry.createdAt.replace(/[:.]/g, '-').slice(0, 19);
  const ext = entry.type === 'url' ? '.md' : (entry.type === 'note' ? '.md' : '.bin');
  return `${dateStr}_${entry.id.slice(0, 8)}${ext}`;
}

async function verifyPermission(handle, mode = 'readwrite') {
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

const IDB_HANDLE_KEY = 'droptoknowledge-dir-handle';

async function persistHandle(handle) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('droptoknowledge-handles', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(handle, IDB_HANDLE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

async function getHandleFromIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('droptoknowledge-handles', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('handles', 'readonly');
      const store = tx.objectStore('handles');
      const get = store.get(IDB_HANDLE_KEY);
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}
