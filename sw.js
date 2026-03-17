/// <reference lib="webworker" />
'use strict';

const APP_VERSION    = '1.1.0';
const CACHE_NAME     = `droptoknowledge-cache-${APP_VERSION}`;
const SHARE_URL      = './share-handler';
const OFFLINE_URLS   = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/storage-local.js',
  './js/storage-cloud.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ─── Lifecycle ──────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(OFFLINE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('droptoknowledge-cache-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle Web Share Target POST
  // Check if pathname ends with /share-handler (relative to scope)
  if (url.pathname.endsWith('/share-handler') && request.method === 'POST') {
    event.respondWith(handleShareTarget(event));
    return;
  }

  // Network-first for navigations, cache-first for assets
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

// ─── Share Target Handler ────────────────────────────────────────────────────

async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();

    const title   = formData.get('title')  || '';
    const text    = formData.get('text')   || '';
    const url     = formData.get('url')    || '';
    const rawFiles = formData.getAll('files');

    const timestamp = new Date().toISOString();
    const entries   = [];

    // ── Text / URL entry ──
    const textContent = text || url;
    if (textContent) {
      const isUrl = looksLikeUrl(textContent) || looksLikeUrl(url);
      const type  = isUrl ? 'url' : 'note';

      entries.push({
        id:        crypto.randomUUID(),
        type,
        title:     title || (isUrl ? extractDomain(textContent) : truncate(textContent, 60)),
        text:      textContent,
        url:       isUrl ? (url || textContent) : undefined,
        filename:  buildFilename(timestamp, type, title || 'item', isUrl ? '.txt' : '.txt'),
        mime:      'text/plain',
        createdAt: timestamp,
        synced:    false
      });
    }

    // ── File entries ──
    for (const file of rawFiles) {
      if (!(file instanceof File)) continue;

      const mime    = file.type || 'application/octet-stream';
      const logicalType = resolveType(mime);
      const ext         = extFromMime(mime, file.name);
      const baseName    = file.name ? file.name.replace(/\.[^.]+$/, '') : 'file';

      // Read file content into ArrayBuffer for IDB storage
      const arrayBuffer = await file.arrayBuffer();

      entries.push({
        id:           crypto.randomUUID(),
        type:         logicalType,
        title:        title || file.name || `Shared ${logicalType}`,
        filename:     buildFilename(timestamp, logicalType, baseName, ext),
        mime,
        content:      arrayBuffer,
        originalName: file.name,
        createdAt:    timestamp,
        synced:       false
      });
    }

    // ── Persist to IDB ──
    await saveEntriesToIdb(entries);

    // ── Notify open clients ──
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'NEW_SHARED_ITEMS', count: entries.length });
    }

    // Redirect back to app after sharing
    // Use relative path for redirect
    return Response.redirect('./?shared=1', 303);

  } catch (err) {
    console.error('[SW] Share handler error:', err);
    return Response.redirect('./?share_error=1', 303);
  }
}

// ─── Cache strategies ────────────────────────────────────────────────────────

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match('./index.html');
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

const DB_NAME    = 'droptoknowledge-db';
const DB_VERSION = 2;
const STORE_NAME = 'entries';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = event => {
      const db = event.target.result;

      // v1 store
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('type',      'type',      { unique: false });
        store.createIndex('synced',    'synced',    { unique: false });
      }

      // v2: settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function saveEntriesToIdb(entries) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    entries.forEach(e => store.put(e));
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

// ─── Utility functions ────────────────────────────────────────────────────────

function looksLikeUrl(str) {
  if (!str) return false;
  return /^https?:\/\//i.test(str.trim()) ||
         /^[a-zA-Z0-9-]+\.[a-z]{2,}(\/|$)/i.test(str.trim());
}

function extractDomain(url) {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
  } catch {
    return url.slice(0, 50);
  }
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function resolveType(mime) {
  const base = mime.split('/')[0];
  if (base === 'image')  return 'images';
  if (base === 'audio')  return 'voice';
  if (base === 'video')  return 'docs';
  if (mime.startsWith('text/')) return 'note';
  return 'docs';
}

function extFromMime(mime, filename) {
  // Try to get extension from original filename first
  if (filename) {
    const m = filename.match(/(\.[^.]+)$/);
    if (m) return m[1];
  }
  const map = {
    'image/jpeg':                   '.jpg',
    'image/png':                    '.png',
    'image/gif':                    '.gif',
    'image/webp':                   '.webp',
    'image/svg+xml':                '.svg',
    'audio/mpeg':                   '.mp3',
    'audio/ogg':                    '.ogg',
    'audio/wav':                    '.wav',
    'audio/webm':                   '.webm',
    'video/mp4':                    '.mp4',
    'video/webm':                   '.webm',
    'application/pdf':              '.pdf',
    'application/msword':           '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.ms-excel':     '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'text/plain':                   '.txt',
    'text/markdown':                '.md',
    'text/html':                    '.html',
    'text/uri-list':                '.txt'
  };
  return map[mime] || '.bin';
}

function buildFilename(timestamp, type, name, ext) {
  // 2024-01-15T10-30-00_url_example.txt
  const datePart = timestamp.replace(/[:.]/g, '-').slice(0, 19);
  const safeName = name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 40);
  return `${datePart}_${type}_${safeName}${ext}`;
}
