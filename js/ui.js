/**
 * ui.js — DOM rendering helpers for DropToKnowledge
 */

// --- Toast --------------------------------------------------------------------

let _toastTimer = null;
const toastEl = () => document.getElementById('toast');

export function showToast(message, type = 'info', duration = 3000) {
  const el = toastEl();
  if (!el) return;
  clearTimeout(_toastTimer);
  el.textContent  = message;
  el.className    = `toast toast--${type}`;
  el.style.display = 'block';
  void el.offsetWidth; // reflow to restart animation
  el.classList.add('toast--visible');
  _toastTimer = setTimeout(() => {
    el.classList.remove('toast--visible');
    setTimeout(() => { el.style.display = 'none'; }, 300);
  }, duration);
}

// --- Loading / Spinner --------------------------------------------------------

export function setLoading(selector, loading) {
  const el = document.querySelector(selector);
  if (!el) return;
  if (loading) el.setAttribute('disabled', '');
  else         el.removeAttribute('disabled');
}

// --- Counts -------------------------------------------------------------------

export function updateCounts(counts) {
  for (const [type, count] of Object.entries(counts)) {
    const el = document.getElementById(`count-${type}`);
    if (el) el.textContent = count > 0 ? count : '';
  }
}

// --- Item list rendering ------------------------------------------------------

const TYPE_META = {
  url:    { icon: '\u{1F517}', label: 'Link',     color: '#4fc3f7' },
  note:   { icon: '\u{1F4DD}', label: 'Note',     color: '#a5d6a7' },
  images: { icon: '\u{1F5BC}\uFE0F', label: 'Image',    color: '#f48fb1' },
  docs:   { icon: '\u{1F4C4}', label: 'Document', color: '#ffcc80' },
  voice:  { icon: '\u{1F3B5}', label: 'Audio',    color: '#ce93d8' }
};

export function renderItems(entries, container, onItemClick) {
  container.innerHTML = '';

  if (!entries.length) return;

  // Group by date for nicer display
  const groups = groupByDate(entries);

  for (const [dateLabel, items] of Object.entries(groups)) {
    const groupEl = document.createElement('div');
    groupEl.className = 'item-group';

    const headerEl = document.createElement('div');
    headerEl.className = 'item-group-header';
    headerEl.textContent = dateLabel;
    groupEl.appendChild(headerEl);

    for (const entry of items) {
      groupEl.appendChild(buildItemCard(entry, onItemClick));
    }

    container.appendChild(groupEl);
  }
}

function buildItemCard(entry, onItemClick) {
  const meta = TYPE_META[entry.type] || { icon: '\u{1F4CE}', label: entry.type, color: '#888' };
  const card = document.createElement('article');
  card.className  = 'item-card';
  card.dataset.id = entry.id;
  if (!entry.synced) card.classList.add('item-card--unsynced');

  card.innerHTML = `
    <div class="item-card-icon" style="background:${meta.color}22;color:${meta.color}">
      ${meta.icon}
    </div>
    <div class="item-card-body">
      <div class="item-card-title">${escapeHtml(entry.title || entry.filename)}</div>
      <div class="item-card-meta">
        <span class="item-type-badge" style="color:${meta.color}">${meta.label}</span>
        <span class="item-card-time">${formatTime(entry.createdAt)}</span>
        ${entry.synced ? '<span class="synced-badge" title="Synced">\u2713</span>' : ''}
      </div>
      ${entry.type === 'url' ? `<div class="item-card-url">${escapeHtml(entry.url || entry.text || '')}</div>` : ''}
      ${entry.type === 'note' ? `<div class="item-card-snippet">${escapeHtml(truncate(entry.text || '', 120))}</div>` : ''}
    </div>
    <button class="item-card-chevron" aria-label="Open">\u203A</button>
  `;

  card.addEventListener('click', () => onItemClick(entry));
  return card;
}

// --- Item detail modal --------------------------------------------------------

export function renderItemDetail(entry, container) {
  const meta = TYPE_META[entry.type] || { icon: '\u{1F4CE}', label: entry.type, color: '#888' };
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'item-detail-header';
  header.innerHTML = `
    <span class="item-detail-icon">${meta.icon}</span>
    <div>
      <div class="item-detail-type" style="color:${meta.color}">${meta.label}</div>
      <div class="item-detail-date">${formatDate(entry.createdAt)}</div>
    </div>
  `;
  container.appendChild(header);

  if (entry.type === 'url') {
    const urlSection = document.createElement('div');
    urlSection.className = 'item-detail-section';
    urlSection.innerHTML = `
      <div class="item-detail-url-wrap">
        <a href="${escapeHtml(entry.url || entry.text)}" target="_blank" rel="noopener noreferrer" class="item-detail-link">
          ${escapeHtml(entry.url || entry.text || '')}
        </a>
        <button class="btn btn-sm btn-outline copy-btn" data-copy="${escapeHtml(entry.url || entry.text || '')}">Copy</button>
      </div>
      ${entry.title ? `<p class="item-detail-text">${escapeHtml(entry.title)}</p>` : ''}
    `;
    container.appendChild(urlSection);
  } else if (entry.type === 'note') {
    const noteSection = document.createElement('div');
    noteSection.className = 'item-detail-section';
    noteSection.innerHTML = `
      <pre class="item-detail-text item-detail-pre">${escapeHtml(entry.text || '')}</pre>
      <button class="btn btn-sm btn-outline copy-btn" data-copy="${escapeHtml(entry.text || '')}">Copy text</button>
    `;
    container.appendChild(noteSection);
  } else if (entry.type === 'images' && entry.content) {
    const imgSection = document.createElement('div');
    imgSection.className = 'item-detail-section';
    const blob = new Blob([entry.content], { type: entry.mime });
    const url  = URL.createObjectURL(blob);
    imgSection.innerHTML = `
      <img src="${url}" alt="${escapeHtml(entry.title || 'Shared image')}" class="item-detail-image" />
      <p class="item-detail-filename">${escapeHtml(entry.filename)}</p>
    `;
    container.appendChild(imgSection);
  } else if (entry.type === 'voice' && entry.content) {
    const audioSection = document.createElement('div');
    audioSection.className = 'item-detail-section';
    const blob = new Blob([entry.content], { type: entry.mime });
    const url  = URL.createObjectURL(blob);
    audioSection.innerHTML = `
      <audio controls src="${url}" class="item-detail-audio"></audio>
      <p class="item-detail-filename">${escapeHtml(entry.filename)}</p>
    `;
    container.appendChild(audioSection);
  } else {
    // Generic file
    const fileSection = document.createElement('div');
    fileSection.className = 'item-detail-section';
    fileSection.innerHTML = `
      <div class="item-detail-file">
        <span class="item-detail-file-icon">\u{1F4CE}</span>
        <div>
          <div class="item-detail-filename">${escapeHtml(entry.filename)}</div>
          <div class="item-detail-mime">${escapeHtml(entry.mime || 'unknown type')}</div>
        </div>
      </div>
    `;
    if (entry.content) {
      const blob     = new Blob([entry.content], { type: entry.mime });
      const url      = URL.createObjectURL(blob);
      const dlBtn    = document.createElement('a');
      dlBtn.href     = url;
      dlBtn.download = entry.filename;
      dlBtn.className = 'btn btn-primary';
      dlBtn.textContent = '\u2B07 Download';
      fileSection.appendChild(dlBtn);
    }
    container.appendChild(fileSection);
  }

  // Copy button handler
  container.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.copy || '').then(() => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      }).catch(() => {});
    });
  });
}

// --- Utility ------------------------------------------------------------------

function groupByDate(entries) {
  const groups = {};
  const today  = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  for (const e of entries) {
    const d = new Date(e.createdAt).toDateString();
    const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(e.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    if (!groups[label]) groups[label] = [];
    groups[label].push(e);
  }
  return groups;
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '\u2026' : str;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
