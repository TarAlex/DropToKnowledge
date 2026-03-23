/**
 * app.js — Main controller for DropToKnowledge PWA
 * Connects DB, storage adapters, UI rendering, settings, and SW messages.
 */

import {
  getAllEntries, getEntry, deleteEntry, clearAllEntries,
  countByType, getAllSettings, setSetting, updateEntry
} from './db.js';

import {
  isSupported as isLocalSupported,
  chooseDirectory, restoreDirectory, getDirectoryName, saveEntryDirectly, updateMetadataFile
} from './storage-local.js';

import { OneDrive, GoogleDrive, Dropbox } from './storage-cloud.js';
import { showToast, updateCounts, renderItems, renderItemDetail } from './ui.js';

// --- App state ----------------------------------------------------------------

const state = {
  filter:   'all',
  sortBy:   'date-desc',
  search:   '',
  settings: {
    storageMode:     'local',
    organizeByType:  true,
    datePrefix:      true
  }
};

// --- Cloud adapters map -------------------------------------------------------

const CLOUD_ADAPTERS = {
  onedrive: OneDrive,
  gdrive:   GoogleDrive,
  dropbox:  Dropbox
};

// --- DOM refs -----------------------------------------------------------------

const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// --- Init ---------------------------------------------------------------------

async function init() {
  await loadSettings();
  await renderList();
  await updateBadgeCounts();

  setupSidebar();
  setupSearchBar();
  setupSortBar();
  setupSettingsModal();
  setupItemModal();
  setupServiceWorkerMessages();

  // Check for shared item after redirect
  const params = new URLSearchParams(location.search);
  if (params.has('shared')) {
    await renderList();
    await updateBadgeCounts();
    showToast('New item saved!', 'success');
    history.replaceState({}, '', './');
  }
  if (params.has('share_error')) {
    showToast('Error receiving shared item', 'error');
    history.replaceState({}, '', './');
  }

  // Restore directory name display
  if (state.settings.storageMode === 'local') {
    const name = await getDirectoryName();
    if (name) {
      $('folder-path').textContent = `\u{1F4C2} ${name}`;
    }
  }
}

// --- Load / save settings -----------------------------------------------------

async function loadSettings() {
  const saved = await getAllSettings();
  if (saved.storageMode)    state.settings.storageMode    = saved.storageMode;
  if (saved.organizeByType !== undefined) state.settings.organizeByType = saved.organizeByType;
  if (saved.datePrefix     !== undefined) state.settings.datePrefix     = saved.datePrefix;
}

async function saveSetting(key, value) {
  state.settings[key] = value;
  await setSetting(key, value);
}

// --- Render helpers -----------------------------------------------------------

async function renderList() {
  const entries = await getAllEntries({
    type:   state.filter,
    sortBy: state.sortBy,
    search: state.search
  });

  const container = $('item-list');
  const emptyState = $('empty-state');

  if (!entries.length) {
    emptyState.classList.remove('hidden');
    container.innerHTML = '';
    return;
  }

  emptyState.classList.add('hidden');
  renderItems(entries, container, openItemDetail);
}

async function updateBadgeCounts() {
  const counts = await countByType();
  updateCounts(counts);
}

// --- Sidebar ------------------------------------------------------------------

function setupSidebar() {
  const sidebar  = $('sidebar');
  const overlay  = $('sidebar-overlay');
  const toggle   = $('sidebar-toggle');
  const closeBtn = $('sidebar-close');

  const openSidebar  = () => { sidebar.classList.add('sidebar--open'); overlay.classList.add('sidebar-overlay--visible'); };
  const closeSidebar = () => { sidebar.classList.remove('sidebar--open'); overlay.classList.remove('sidebar-overlay--visible'); };

  toggle.addEventListener('click', openSidebar);
  closeBtn.addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);

  // Nav items (filter)
  $$('.nav-item[data-filter]').forEach(btn => {
    btn.addEventListener('click', async () => {
      $$('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      state.filter = btn.dataset.filter;
      $('topbar-title').textContent = btn.querySelector('.nav-text').textContent;

      closeSidebar();
      await renderList();
    });
  });

  // Settings shortcut
  $('settings-btn').addEventListener('click', () => {
    closeSidebar();
    openSettingsModal();
  });
}

// --- Search -------------------------------------------------------------------

function setupSearchBar() {
  const toggleBtn = $('search-toggle');
  const closeBtn  = $('search-close');
  const bar       = $('search-bar');
  const input     = $('search-input');

  let debounceTimer;

  toggleBtn.addEventListener('click', () => {
    bar.classList.toggle('hidden');
    if (!bar.classList.contains('hidden')) input.focus();
  });

  closeBtn.addEventListener('click', () => {
    bar.classList.add('hidden');
    input.value   = '';
    state.search  = '';
    renderList();
  });

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.search = input.value.trim();
      renderList();
    }, 250);
  });
}

// --- Sort ---------------------------------------------------------------------

function setupSortBar() {
  const toggleBtn = $('sort-toggle');
  const bar       = $('sort-bar');

  toggleBtn.addEventListener('click', () => bar.classList.toggle('hidden'));

  $$('.sort-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      $$('.sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.sortBy = btn.dataset.sort;
      bar.classList.add('hidden');
      await renderList();
    });
  });
}

// --- Settings modal -----------------------------------------------------------

function openSettingsModal() {
  const modal = $('settings-modal');
  modal.classList.remove('hidden');
  syncSettingsUI();
}

function setupSettingsModal() {
  // Close handlers
  $('settings-close').addEventListener('click', () => $('settings-modal').classList.add('hidden'));
  $('settings-modal').querySelector('.modal-backdrop').addEventListener('click', () => $('settings-modal').classList.add('hidden'));

  // Storage mode radio
  $$('input[name="storage-mode"]').forEach(radio => {
    radio.addEventListener('change', async () => {
      const val = radio.value;
      await saveSetting('storageMode', val);
      syncSettingsUI();
    });
  });

  // Local folder picker
  $('choose-directory').addEventListener('click', async () => {
    if (!isLocalSupported()) {
      showToast('File System Access API not supported in this browser', 'error');
      return;
    }
    try {
      const name = await chooseDirectory();
      $('folder-path').textContent = `\u{1F4C2} ${name}`;
      showToast('Folder selected', 'success');
    } catch (err) {
      if (err.name !== 'AbortError') showToast(`Could not select folder: ${err.message}`, 'error');
    }
  });

  // Cloud connect
  $('cloud-connect-btn')?.addEventListener('click', async () => {
    const mode    = state.settings.storageMode;
    const adapter = CLOUD_ADAPTERS[mode];
    if (!adapter) return;
    try {
      await adapter.connect();
      const info = await adapter.getUserInfo();
      if (info) {
        await setSetting(`${mode}_user`, info);
        syncSettingsUI();
        showToast(`Connected to ${adapter.name}`, 'success');
      }
    } catch (err) {
      showToast(`Connection failed: ${err.message}`, 'error');
    }
  });

  // Cloud disconnect
  $('cloud-disconnect-btn')?.addEventListener('click', async () => {
    const mode    = state.settings.storageMode;
    const adapter = CLOUD_ADAPTERS[mode];
    if (!adapter) return;
    await adapter.disconnect();
    syncSettingsUI();
    showToast('Disconnected', 'info');
  });

  // Show Android limitation notice if File System Access API is unavailable
  if (!isLocalSupported()) {
    $('local-unsupported-notice')?.classList.remove('hidden');
    $('choose-directory')?.setAttribute('disabled', 'true');
  }
}

async function syncSettingsUI() {
  const s = state.settings;

  // Radio
  const radioEl = document.querySelector(`input[name="storage-mode"][value="${s.storageMode}"]`);
  if (radioEl) radioEl.checked = true;

  // Show/hide sections
  const isLocal = s.storageMode === 'local';
  $('local-folder-section')?.classList.toggle('hidden', !isLocal);
  $('cloud-section')?.classList.toggle('hidden', isLocal);

  // Cloud section text
  if (!isLocal && $('cloud-section')) {
    const adapter = CLOUD_ADAPTERS[s.storageMode];
    if (adapter) {
      const connected = await adapter.isConnected();
      $('cloud-connect-btn')?.parentElement.classList.toggle('hidden', connected);
      $('cloud-connected-info')?.classList.toggle('hidden', !connected);
      const stubText = $('cloud-stub-text');
      if (stubText) {
        stubText.textContent = connected
          ? `Connected to ${adapter.name}`
          : `Connect your ${adapter.name} account to sync`;
      }
      if (connected) {
        const info = await adapter.getUserInfo();
        const emailEl = $('cloud-user-email');
        if (emailEl) emailEl.textContent = info?.email || '\u2014';
      }
    }
  }
}

// --- Item detail modal --------------------------------------------------------

function setupItemModal() {
  $('item-modal-close').addEventListener('click', closeItemModal);
  $('item-modal').querySelector('.modal-backdrop').addEventListener('click', closeItemModal);

  $('item-modal-delete').addEventListener('click', async () => {
    const id = $('item-modal').dataset.entryId;
    if (!id || !confirm('Delete this item?')) return;
    await deleteEntry(id);
    closeItemModal();
    await renderList();
    await updateBadgeCounts();
    showToast('Item deleted', 'info');
  });
}

async function openItemDetail(entry) {
  const modal = $('item-modal');
  modal.dataset.entryId = entry.id;
  $('item-modal-title').textContent = entry.title || entry.filename;

  const body = $('item-modal-body');
  // Reload with full content (sw stores ArrayBuffer; IDB re-fetches it)
  const full = await getEntry(entry.id);
  renderItemDetail(full, body);

  $('save-notes-btn').addEventListener('click', async () => {
    const tagsRaw = $('detail-tags').value.trim();
    const comment = $('detail-comment').value;
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
    await updateEntry(entry.id, { comment, tags });

    // Sync the updated metadata back to the file system
    if (state.settings.storageMode === 'local') {
      try {
        const name = await getDirectoryName();
        if (name) {
          await saveEntryDirectly(full); // This now handles updating the md file correctly
        }
      } catch (e) {
        console.error('Failed to update file on disk:', e);
      }
    }

    showToast('Notes saved', 'success');
    closeItemModal();
    await renderList();
  });

  modal.classList.remove('hidden');
}

function closeItemModal() {
  $('item-modal').classList.add('hidden');
  $('item-modal-body').innerHTML = '';
}

// --- Service Worker messages --------------------------------------------------

function setupServiceWorkerMessages() {
  navigator.serviceWorker?.addEventListener('message', async event => {
    if (event.data?.type === 'NEW_SHARED_ITEMS') {
      // Clear all entries first to prevent duplication after shared redirect
      await clearAllEntries();

      if (event.data.entries) {
        for (const entry of event.data.entries) {
          try {
            await saveEntryDirectly(entry);
          } catch (e) {
            console.error('Error saving entry directly:', e);
          }
        }
      }
      await renderList();
      await updateBadgeCounts();
      showToast(`Saved to inbox`, 'success');
    }
  });
}

// --- Boot ---------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', init);
