import { loadAdminSummary } from './api.js';

const LOCAL_PREPARE_API = 'http://127.0.0.1:5199';

function statusLabel(value) {
  return value ? 'Ready' : 'Not configured';
}

function renderUser(user) {
  if (!user) return 'Static preview mode';
  return user.email || user.name || user.sub || 'Authenticated user';
}

function sceneRows(scenes) {
  if (!scenes.length) {
    return '<tr><td colspan="6">No scenes yet.</td></tr>';
  }
  return scenes.map((scene) => `
    <tr>
      <td>${scene.title || scene.id}</td>
      <td>${scene.albumTitle || scene.albumId || ''}</td>
      <td><span class="status-pill">${scene.status || 'draft'}</span></td>
      <td>${scene.sog || scene.assetKey || ''}</td>
      <td>${scene.splatCount ? `${(scene.splatCount / 1e6).toFixed(1)}M` : ''}</td>
      <td class="row-actions">
        ${scene.status === 'archived'
          ? `<button type="button" data-action="publish" data-album="${scene.albumId}" data-scene="${scene.id}">Publish</button>`
          : `<button type="button" data-action="archive" data-album="${scene.albumId}" data-scene="${scene.id}">Archive</button>`}
        <button type="button" class="danger-inline" data-action="delete" data-album="${scene.albumId}" data-scene="${scene.id}">Delete</button>
      </td>
    </tr>
  `).join('');
}

function userRows(users) {
  if (!users.length) {
    return '<tr><td colspan="4">No D1 users yet. Add yourself after Cloudflare Access is enabled.</td></tr>';
  }
  return users.map((user) => `
    <tr>
      <td>${user.email}</td>
      <td>${user.name || ''}</td>
      <td><span class="status-pill">${user.role || 'viewer'}</span></td>
      <td>${user.createdAt || ''}</td>
    </tr>
  `).join('');
}

function renderUploadPanel(summary) {
  const disabled = summary.bindings?.r2 ? '' : 'disabled';
  return `
    <section class="admin-card">
      <div class="card-head">
        <h2>Upload</h2>
        <span>${summary.bindings?.r2 ? 'R2 enabled' : 'R2 binding required'}</span>
      </div>
      <div class="upload-box">
        <input id="scene-title" placeholder="Scene title" ${disabled} />
        <input id="scene-file" type="file" accept=".sog,.ply,.jpg,.jpeg,.png,.webp" multiple ${disabled} />
        <button type="button" ${disabled}>Prepare Upload</button>
      </div>
      <p class="hint">For this milestone, uploads are UI/API scaffolding. SOG conversion remains local, and the Worker will use R2 once the bucket binding is configured.</p>
    </section>
  `;
}

function renderAdmin(summary) {
  return `
    <header class="topbar admin-topbar">
      <div>
        <h1>Control Panel</h1>
        <p>${renderUser(summary.user)} · ${summary.mode || summary.source || 'api'}</p>
      </div>
      <div class="top-actions">
        <a class="nav-link" href="/prepare">Prepare Scenes</a>
        <a class="nav-link" href="/">View Gallery</a>
      </div>
    </header>

    <main class="admin-main">
      <section class="admin-grid stats-grid">
        <div class="stat"><strong>${summary.counts?.albums ?? 0}</strong><span>Albums</span></div>
        <div class="stat"><strong>${summary.counts?.scenes ?? 0}</strong><span>Scenes</span></div>
        <div class="stat"><strong>${summary.counts?.publishedScenes ?? 0}</strong><span>Published</span></div>
        <div class="stat"><strong>${summary.counts?.users ?? 0}</strong><span>Users</span></div>
      </section>

      <section class="admin-grid">
        <div class="admin-card">
          <div class="card-head">
            <h2>Cloudflare</h2>
            <span>Bindings</span>
          </div>
          <div class="binding-list">
            <div><span>D1 database</span><strong>${statusLabel(summary.bindings?.d1)}</strong></div>
            <div><span>R2 bucket</span><strong>${statusLabel(summary.bindings?.r2)}</strong></div>
            <div><span>Access identity</span><strong>${statusLabel(summary.bindings?.access)}</strong></div>
          </div>
        </div>
        ${renderUploadPanel(summary)}
      </section>

      <section class="admin-card">
        <div class="card-head">
          <h2>Scenes</h2>
          <span>${summary.scenes?.length || 0} total</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Title</th><th>Album</th><th>Status</th><th>Asset</th><th>Splats</th><th>Actions</th></tr></thead>
            <tbody>${sceneRows(summary.scenes || [])}</tbody>
          </table>
        </div>
      </section>

      <section class="admin-card">
        <div class="card-head">
          <h2>Users & Roles</h2>
          <span>Google OAuth via Access</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Created</th></tr></thead>
            <tbody>${userRows(summary.users || [])}</tbody>
          </table>
        </div>
      </section>
    </main>
  `;
}

async function localSceneAction(action, albumId, sceneId) {
  const params = new URLSearchParams({ albumId, sceneId });
  if (action === 'archive') {
    await fetch(`${LOCAL_PREPARE_API}/prepare/archive-scene?${params}`, { method: 'POST' });
    return;
  }
  if (action === 'publish') {
    await fetch(`${LOCAL_PREPARE_API}/prepare/publish-scene?${params}`, { method: 'POST' });
    return;
  }
  if (action === 'delete') {
    await fetch(`${LOCAL_PREPARE_API}/prepare/scene?${params}`, { method: 'DELETE' });
  }
}

function wireSceneActions(app) {
  for (const button of app.querySelectorAll('[data-action]')) {
    button.addEventListener('click', async () => {
      const action = button.dataset.action;
      const albumId = button.dataset.album;
      const sceneId = button.dataset.scene;
      if (action === 'delete' && !confirm(`Delete ${sceneId}? This removes the local scene folder.`)) return;
      if (action === 'archive' && !confirm(`Archive ${sceneId}? It will disappear from the viewer but files stay on disk.`)) return;
      button.disabled = true;
      try {
        await localSceneAction(action, albumId, sceneId);
        await initAdmin(app);
      } catch (error) {
        console.error(error);
        alert(`Could not ${action} scene. Start npm run prepare:dev for local scene management.`);
        button.disabled = false;
      }
    });
  }
}

export async function initAdmin(app) {
  app.innerHTML = '<main><div class="empty">Loading control panel...</div></main>';
  const summary = await loadAdminSummary();
  app.innerHTML = renderAdmin(summary);
  wireSceneActions(app);
}
