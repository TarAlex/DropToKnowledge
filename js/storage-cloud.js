/**
 * storage-cloud.js — Cloud storage adapters for DropToKnowledge
 * Supports OneDrive (MS Graph), Google Drive REST API, Dropbox API v2
 *
 * Each adapter exposes: connect(), disconnect(), isConnected(),
 *                       getUserInfo(), syncEntries(entries, opts)
 *
 * Replace CLIENT_IDs and REDIRECT_URI with your real values.
 */

import { getSetting, setSetting, markSynced } from './db.js';

// --- Config — replace before production --------------------------------------
const CONFIG = {
  onedrive: {
    clientId:    'YOUR_ONEDRIVE_CLIENT_ID',
    redirectUri: 'https://YOUR_DOMAIN/oauth/onedrive',
    scopes:      'Files.ReadWrite offline_access User.Read'
  },
  gdrive: {
    clientId:    'YOUR_GDRIVE_CLIENT_ID',
    redirectUri: 'https://YOUR_DOMAIN/oauth/gdrive',
    scopes:      'https://www.googleapis.com/auth/drive.file'
  },
  dropbox: {
    clientId:    'YOUR_DROPBOX_CLIENT_ID',
    redirectUri: 'https://YOUR_DOMAIN/oauth/dropbox'
  }
};

// --- OneDrive (Microsoft Graph) -----------------------------------------------

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
    authUrl.searchParams.set('state',         'onedrive');

    // Open OAuth popup
    return openOAuthPopup(authUrl.toString(), 'onedrive');
  },

  async disconnect() {
    await setSetting('onedrive_token', null);
    await setSetting('onedrive_user',  null);
  },

  async isConnected() {
    const token = await getSetting('onedrive_token');
    return !!token;
  },

  async getUserInfo() {
    const token = await getSetting('onedrive_token');
    if (!token) return null;
    const resp = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return { email: data.mail || data.userPrincipalName, name: data.displayName };
  },

  async syncEntries(entries, opts = {}) {
    const token = await getSetting('onedrive_token');
    if (!token) throw new Error('OneDrive not connected');

    const { organizeByType = true, datePrefix = true } = opts;
    const syncedIds = [];
    const errors    = [];
    const baseFolder = 'DropToKnowledge';

    // Ensure base folder exists
    await ensureOneDriveFolder(token, baseFolder);

    for (const entry of entries) {
      try {
        const folder   = organizeByType ? `${baseFolder}/${typeToFolder(entry.type)}` : baseFolder;
        await ensureOneDriveFolder(token, folder);

        const filename = entry.filename;
        const content  = await entryToBlob(entry);

        const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${folder}/${filename}:/content`;
        const resp = await fetch(url, {
          method:  'PUT',
          headers: {
            Authorization:  `Bearer ${token}`,
            'Content-Type': content.type || 'application/octet-stream'
          },
          body: content
        });

        if (!resp.ok) throw new Error(`OneDrive upload failed: ${resp.status}`);
        syncedIds.push(entry.id);
      } catch (err) {
        errors.push({ id: entry.id, error: err.message });
      }
    }

    if (syncedIds.length) await markSynced(syncedIds);
    return { synced: syncedIds.length, errors };
  }
};

async function ensureOneDriveFolder(token, folderPath) {
  // Walk path segments and create each folder if missing
  const segments = folderPath.split('/');
  let current = '';
  for (const seg of segments) {
    current = current ? `${current}/${seg}` : seg;
    try {
      const checkUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${current}`;
      const check = await fetch(checkUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (check.status === 404) {
        // Create folder
        const parent = current.includes('/') ? current.slice(0, current.lastIndexOf('/')) : '';
        const parentUrl = parent
          ? `https://graph.microsoft.com/v1.0/me/drive/root:/${parent}:/children`
          : 'https://graph.microsoft.com/v1.0/me/drive/root/children';
        await fetch(parentUrl, {
          method:  'POST',
          headers: {
            Authorization:  `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name:   seg,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'replace'
          })
        });
      }
    } catch {/* ignore individual folder errors */}
  }
}

// --- Google Drive --------------------------------------------------------------

export const GoogleDrive = {
  name: 'Google Drive',

  async connect() {
    const { clientId, redirectUri, scopes } = CONFIG.gdrive;
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id',     clientId);
    authUrl.searchParams.set('redirect_uri',  redirectUri);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope',         scopes);
    authUrl.searchParams.set('state',         'gdrive');
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

    const { organizeByType = true } = opts;
    const syncedIds = [];
    const errors    = [];
    const rootFolderId = await ensureGDriveFolder(token, 'DropToKnowledge', 'root');

    for (const entry of entries) {
      try {
        let parentId = rootFolderId;
        if (organizeByType) {
          parentId = await ensureGDriveFolder(token, typeToFolder(entry.type), rootFolderId);
        }

        const blob    = await entryToBlob(entry);
        const meta    = JSON.stringify({ name: entry.filename, parents: [parentId] });
        const form    = new FormData();
        form.append('metadata', new Blob([meta], { type: 'application/json' }));
        form.append('file',     blob, entry.filename);

        const resp = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}` },
          body:    form
        });
        if (!resp.ok) throw new Error(`GDrive upload failed: ${resp.status}`);
        syncedIds.push(entry.id);
      } catch (err) {
        errors.push({ id: entry.id, error: err.message });
      }
    }

    if (syncedIds.length) await markSynced(syncedIds);
    return { synced: syncedIds.length, errors };
  }
};

async function ensureGDriveFolder(token, name, parentId) {
  // Check if folder exists
  const query = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${name}' and '${parentId}' in parents and trashed=false`
  );
  const listResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const list = await listResp.json();
  if (list.files && list.files.length > 0) return list.files[0].id;

  // Create folder
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents:  [parentId]
    })
  });
  const folder = await createResp.json();
  return folder.id;
}

// --- Dropbox ------------------------------------------------------------------

export const Dropbox = {
  name: 'Dropbox',

  async connect() {
    const { clientId, redirectUri } = CONFIG.dropbox;
    const authUrl = new URL('https://www.dropbox.com/oauth2/authorize');
    authUrl.searchParams.set('client_id',     clientId);
    authUrl.searchParams.set('redirect_uri',  redirectUri);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('state',         'dropbox');
    return openOAuthPopup(authUrl.toString(), 'dropbox');
  },

  async disconnect() {
    const token = await getSetting('dropbox_token');
    if (token) {
      // Revoke token
      await fetch('https://api.dropboxapi.com/2/auth/token/revoke', {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    }
    await setSetting('dropbox_token', null);
    await setSetting('dropbox_user',  null);
  },

  async isConnected() {
    const token = await getSetting('dropbox_token');
    return !!token;
  },

  async getUserInfo() {
    const token = await getSetting('dropbox_token');
    if (!token) return null;
    const resp = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return { email: data.email, name: data.name?.display_name };
  },

  async syncEntries(entries, opts = {}) {
    const token = await getSetting('dropbox_token');
    if (!token) throw new Error('Dropbox not connected');

    const { organizeByType = true } = opts;
    const syncedIds = [];
    const errors    = [];

    for (const entry of entries) {
      try {
        const subfolder = organizeByType ? `/${typeToFolder(entry.type)}` : '';
        const path      = `/DropToKnowledge${subfolder}/${entry.filename}`;
        const blob      = await entryToBlob(entry);
        const content   = await blob.arrayBuffer();

        const resp = await fetch('https://content.dropboxapi.com/2/files/upload', {
          method:  'POST',
          headers: {
            Authorization:    `Bearer ${token}`,
            'Content-Type':   'application/octet-stream',
            'Dropbox-API-Arg': JSON.stringify({
              path,
              mode:       'overwrite',
              autorename: false
            })
          },
          body: content
        });

        if (!resp.ok) throw new Error(`Dropbox upload failed: ${resp.status}`);
        syncedIds.push(entry.id);
      } catch (err) {
        errors.push({ id: entry.id, error: err.message });
      }
    }

    if (syncedIds.length) await markSynced(syncedIds);
    return { synced: syncedIds.length, errors };
  }
};

// --- OAuth popup helper -------------------------------------------------------

function openOAuthPopup(url, provider) {
  return new Promise((resolve, reject) => {
    const width  = 500;
    const height = 700;
    const left   = window.screenX + (window.outerWidth  - width)  / 2;
    const top    = window.screenY + (window.outerHeight - height) / 2;
    const popup  = window.open(url, `oauth-${provider}`, `width=${width},height=${height},left=${left},top=${top}`);

    if (!popup) {
      reject(new Error('Popup blocked. Please allow popups for this site.'));
      return;
    }

    // Poll for redirect
    const timer = setInterval(async () => {
      try {
        if (popup.closed) {
          clearInterval(timer);
          reject(new Error('OAuth popup was closed before completing'));
          return;
        }
        const popupUrl = popup.location.href;
        if (popupUrl.includes('access_token=')) {
          clearInterval(timer);
          popup.close();

          const hash   = new URL(popupUrl).hash.slice(1);
          const params = new URLSearchParams(hash);
          const token  = params.get('access_token');

          if (!token) { reject(new Error('No access token received')); return; }

          await setSetting(`${provider}_token`, token);
          resolve(token);
        }
      } catch {
        // cross-origin — popup hasn't redirected back yet
      }
    }, 500);
  });
}

// --- Shared utilities ---------------------------------------------------------

function typeToFolder(type) {
  const map = { url: 'links', note: 'notes', images: 'images', docs: 'documents', voice: 'audio' };
  return map[type] || 'other';
}

async function entryToBlob(entry) {
  if (entry.content) {
    return new Blob([entry.content], { type: entry.mime || 'application/octet-stream' });
  }
  const lines = entry.type === 'url'
    ? [entry.url || entry.text || '', '', `Title: ${entry.title || ''}`, `Saved: ${entry.createdAt}`]
    : [entry.title ? `# ${entry.title}\n` : '', entry.text || '', `\n---\nSaved: ${entry.createdAt}`];
  return new Blob([lines.join('\n')], { type: 'text/plain' });
}
