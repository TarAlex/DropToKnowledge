/**
 * storage-cloud.js — Cloud storage adapters for DropToKnowledge
 */

import { getSetting, setSetting } from './db.js';

const CONFIG = {
  onedrive: {
    clientId:    'YOUR_ONEDRIVE_CLIENT_ID',
    redirectUri: 'https://taralex.github.io/DropToKnowledge/',
    scopes:      'Files.ReadWrite offline_access User.Read'
  },
  gdrive: {
    // PASTE YOUR CLIENT ID HERE:
    clientId:    'YOUR_GDRIVE_CLIENT_ID',
    redirectUri: 'https://taralex.github.io/DropToKnowledge/',
    scopes:      'https://www.googleapis.com/auth/drive.file'
  },
  dropbox: {
    clientId:    'YOUR_DROPBOX_CLIENT_ID',
    redirectUri: 'https://taralex.github.io/DropToKnowledge/'
  }
};

// --- Google Drive Implementation ----------------------------------------------

export const GoogleDrive = {
  name: 'Google Drive',

  async connect() {
    const { clientId, redirectUri, scopes } = CONFIG.gdrive;
    if (clientId === 'YOUR_GDRIVE_CLIENT_ID') {
      throw new Error('Please configure your Google Client ID in js/storage-cloud.js');
    }
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id',     clientId);
    authUrl.searchParams.set('redirect_uri',  redirectUri);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope',         scopes);
    authUrl.searchParams.set('state',         'gdrive');
    authUrl.searchParams.set('prompt',        'consent');

    return openOAuthPopup(authUrl.toString(), 'gdrive');
  },

  async disconnect() {
    await setSetting('gdrive_token', null);
    await setSetting('gdrive_user',  null);
  },

  async isConnected() {
    const token = await getSetting('gdrive_token');
    return !!token;
  },

  async getUserInfo() {
    const token = await getSetting('gdrive_token');
    if (!token) return null;
    const resp = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return { email: data.email, name: data.name };
  },

  async syncEntries(entries, opts = {}) {
    const token = await getSetting('gdrive_token');
    if (!token) throw new Error('Google Drive not connected');

    const syncedIds = [];
    const errors    = [];
    const rootFolderId = await ensureGDriveFolder(token, 'DropToKnowledge', 'root');

    for (const entry of entries) {
      try {
        const blob    = await entryToBlob(entry);
        const meta    = JSON.stringify({ name: entry.filename, parents: [rootFolderId] });
        const form    = new FormData();
        form.append('metadata', new Blob([meta], { type: 'application/json' }));
        form.append('file',     blob);

        const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}` },
          body:    form
        });
        if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
        syncedIds.push(entry.id);
      } catch (err) {
        errors.push({ id: entry.id, error: err.message });
      }
    }
    return { synced: syncedIds.length, errors };
  }
};

// --- OneDrive Implementation --------------------------------------------------

export const OneDrive = {
  name: 'OneDrive',
  async connect() {
    const { clientId, redirectUri, scopes } = CONFIG.onedrive;
    const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    authUrl.searchParams.set('client_id',     clientId);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('redirect_uri',  redirectUri);
    authUrl.searchParams.set('scope',         scopes);
    authUrl.searchParams.set('response_mode', 'fragment');
    return openOAuthPopup(authUrl.toString(), 'onedrive');
  },
  async disconnect() {
    await setSetting('onedrive_token', null);
  },
  async isConnected() {
    return !!(await getSetting('onedrive_token'));
  },
  async getUserInfo() {
    const token = await getSetting('onedrive_token');
    if (!token) return null;
    const resp = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    return { email: data.mail || data.userPrincipalName };
  }
};

// --- Dropbox Implementation ---------------------------------------------------

export const Dropbox = {
  name: 'Dropbox',
  async connect() {
    const { clientId, redirectUri } = CONFIG.dropbox;
    const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=token`;
    return openOAuthPopup(authUrl, 'dropbox');
  },
  async disconnect() {
    await setSetting('dropbox_token', null);
  },
  async isConnected() {
    return !!(await getSetting('dropbox_token'));
  },
  async getUserInfo() {
    const token = await getSetting('dropbox_token');
    if (!token) return null;
    const resp = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await resp.json();
    return { email: data.email };
  }
};

// --- Helpers ------------------------------------------------------------------

async function ensureGDriveFolder(token, name, parentId) {
  const query = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${name}' and '${parentId}' in parents and trashed=false`);
  const listResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const list = await listResp.json();
  if (list.files?.length > 0) return list.files[0].id;

  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
  });
  const folder = await createResp.json();
  return folder.id;
}

function openOAuthPopup(url, provider) {
  return new Promise((resolve, reject) => {
    const popup = window.open(url, 'oauth', 'width=500,height=600');
    const timer = setInterval(async () => {
      try {
        if (!popup || popup.closed) {
          clearInterval(timer);
          reject(new Error('Popup closed'));
          return;
        }
        if (popup.location.href.includes('access_token=')) {
          const token = new URLSearchParams(popup.location.hash.substring(1)).get('access_token');
          clearInterval(timer);
          popup.close();
          await setSetting(`${provider}_token`, token);
          resolve(token);
        }
      } catch (e) { /* ignore cross-origin errors */ }
    }, 500);
  });
}

async function entryToBlob(entry) {
  if (entry.content) return new Blob([entry.content], { type: entry.mime });
  const text = `${entry.url || entry.text}\n\n---\nTitle: ${entry.title}\nSaved: ${entry.createdAt}`;
  return new Blob([text], { type: 'text/plain' });
}
