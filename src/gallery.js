import { loadAlbums } from './api.js';
import { PcSplatViewer } from './pcviewer.js';

const LOCAL_PREPARE_API = 'http://127.0.0.1:5199';

const state = {
  albums: [],
  currentAlbum: null,
  query: '',
  adminMode: localStorage.getItem('galleryAdminMode') === '1',
};

let viewer = null;

function assetUrl(scene) {
  return scene.sog || scene.ply || scene.assetUrl || scene.r2Url;
}

function formatCount(n) {
  if (!n) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M splats`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K splats`;
  return `${n} splats`;
}

function visibleScenes() {
  const q = state.query.trim().toLowerCase();
  return (state.currentAlbum?.scenes || [])
    .filter((scene) => state.adminMode || scene.status === 'published')
    .filter((scene) => !q || [
      scene.title,
      scene.id,
      scene.notes,
      ...(scene.tags || []),
    ].join(' ').toLowerCase().includes(q));
}

function renderShell(app) {
  app.innerHTML = `
    <header class="topbar">
      <div>
        <h1>Immersive Gallery</h1>
        <p id="album-subtitle"></p>
      </div>
      <div class="top-actions">
        <button id="gallery-admin-toggle" type="button">${state.adminMode ? 'Admin On' : 'Admin'}</button>
        <a class="nav-link" href="/prepare">Prepare</a>
        <a class="nav-link" href="/admin">Control Panel</a>
        <input id="search" type="search" placeholder="Search scenes" />
        <select id="album-select" aria-label="Album"></select>
      </div>
    </header>
    <main>
      <section id="gallery" class="gallery" aria-live="polite"></section>
    </main>
    <div id="viewer" class="viewer hidden">
      <div id="viewer-canvas"></div>
      <div class="viewer-bar">
        <button id="close-viewer" type="button">Back</button>
        <strong id="viewer-title"></strong>
        <button id="enter-vr" class="hidden" type="button">Enter VR</button>
      </div>
      <div id="viewer-status" class="viewer-status"></div>
    </div>
  `;
}

function renderAlbumSelect() {
  const select = document.getElementById('album-select');
  select.innerHTML = '';
  for (const album of state.albums) {
    const option = document.createElement('option');
    option.value = album.id;
    option.textContent = album.title;
    select.appendChild(option);
  }
  if (state.currentAlbum) select.value = state.currentAlbum.id;
}

function sceneCard(scene) {
  const card = document.createElement('article');
  card.className = 'scene-card';
  card.tabIndex = 0;

  const wrap = document.createElement('div');
  wrap.className = 'scene-thumb-wrap';
  const img = document.createElement('img');
  img.src = scene.thumbnail;
  img.alt = scene.title;
  img.loading = 'lazy';
  wrap.appendChild(img);

  const body = document.createElement('div');
  body.className = 'scene-body';

  const title = document.createElement('h2');
  title.textContent = scene.title;

  const meta = document.createElement('p');
  const type = scene.sog ? 'SOG' : 'PLY';
  meta.textContent = [type, formatCount(scene.splatCount), scene.date].filter(Boolean).join(' · ');

  body.append(title, meta);
  if (state.adminMode) body.append(adminControls(scene));
  card.append(wrap, body);
  wrap.addEventListener('click', () => openViewer(scene));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openViewer(scene);
    }
  });
  return card;
}

function adminControls(scene) {
  const controls = document.createElement('div');
  controls.className = 'card-admin';

  const input = document.createElement('input');
  input.value = scene.title || scene.id;
  input.title = 'Scene title';
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('change', async () => {
    await localSceneAction('rename', scene.albumId || state.currentAlbum.id, scene.id, input.value);
    await reloadGallery();
  });

  const archive = document.createElement('button');
  archive.type = 'button';
  archive.textContent = scene.status === 'archived' ? 'Publish' : 'Archive';
  archive.addEventListener('click', async (event) => {
    event.stopPropagation();
    await localSceneAction(scene.status === 'archived' ? 'publish' : 'archive', scene.albumId || state.currentAlbum.id, scene.id);
    await reloadGallery();
  });

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'danger-inline';
  del.textContent = 'Delete';
  del.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (!confirm(`Delete ${scene.title || scene.id}? This removes the local scene folder.`)) return;
    await localSceneAction('delete', scene.albumId || state.currentAlbum.id, scene.id);
    await reloadGallery();
  });

  controls.append(input, archive, del);
  return controls;
}

function adminHeaders() {
  const pin = sessionStorage.getItem('localAdminPin') || '';
  return pin ? { 'X-Admin-Pin': pin } : {};
}

async function unlockAdmin() {
  const pin = prompt('Admin PIN:');
  if (pin === null) return;
  const res = await fetch(`${LOCAL_PREPARE_API}/admin/unlock`, {
    method: 'POST',
    headers: { 'X-Admin-Pin': pin },
  });
  if (!res.ok) {
    alert('Unlock failed. Start npm run prepare:dev and check LOCAL_ADMIN_PIN.');
    return;
  }
  sessionStorage.setItem('localAdminPin', pin);
  localStorage.setItem('galleryAdminMode', '1');
  state.adminMode = true;
  document.getElementById('gallery-admin-toggle').textContent = 'Admin On';
  await reloadGallery();
}

async function localSceneAction(action, albumId, sceneId, title = '') {
  const params = new URLSearchParams({ albumId, sceneId, ...(title ? { title } : {}) });
  const headers = adminHeaders();
  const routes = {
    rename: ['POST', '/prepare/rename-scene'],
    archive: ['POST', '/prepare/archive-scene'],
    publish: ['POST', '/prepare/publish-scene'],
    delete: ['DELETE', '/prepare/scene'],
  };
  const [method, route] = routes[action];
  const res = await fetch(`${LOCAL_PREPARE_API}${route}?${params}`, { method, headers });
  if (!res.ok) throw new Error(await res.text());
}

async function reloadGallery() {
  const currentId = state.currentAlbum?.id;
  const result = await loadAlbums();
  state.albums = result.albums;
  state.currentAlbum = state.albums.find((album) => album.id === currentId) || state.albums[0] || null;
  renderAlbumSelect();
  renderGallery();
}

function renderGallery() {
  const album = state.currentAlbum;
  document.getElementById('album-subtitle').textContent = album
    ? `${album.description || 'Private web gallery'} · ${visibleScenes().length} scenes`
    : 'No albums published yet';

  const gallery = document.getElementById('gallery');
  gallery.innerHTML = '';

  const scenes = visibleScenes();
  if (!scenes.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.currentAlbum ? 'No scenes match this view.' : 'No published albums found.';
    gallery.appendChild(empty);
    return;
  }

  for (const scene of scenes) gallery.appendChild(sceneCard(scene));
}

async function closeViewer() {
  if (viewer) {
    viewer.dispose();
    viewer = null;
  }
  document.getElementById('viewer-canvas').innerHTML = '';
  document.getElementById('viewer').classList.add('hidden');
  document.getElementById('enter-vr').classList.add('hidden');
}

async function openViewer(scene) {
  await closeViewer();
  document.getElementById('viewer').classList.remove('hidden');
  document.getElementById('viewer-title').textContent = scene.title;
  document.getElementById('viewer-status').textContent = 'Loading...';

  try {
    viewer = new PcSplatViewer(document.getElementById('viewer-canvas'), (msg) => {
      document.getElementById('viewer-status').textContent = msg;
    });
    await viewer.load(assetUrl(scene));
    if (viewer.vrSupported) {
      document.getElementById('enter-vr').classList.remove('hidden');
      document.getElementById('enter-vr').onclick = () => viewer.enterVR();
    }
  } catch (error) {
    console.error(error);
    document.getElementById('viewer-status').textContent = `Could not load ${scene.sog ? 'SOG' : 'PLY'} scene.`;
  }
}

function wire() {
  document.getElementById('search').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderGallery();
  });
  document.getElementById('album-select').addEventListener('change', (event) => {
    state.currentAlbum = state.albums.find((album) => album.id === event.target.value) || state.albums[0] || null;
    renderGallery();
  });
  document.getElementById('close-viewer').addEventListener('click', closeViewer);
  document.getElementById('gallery-admin-toggle').addEventListener('click', async () => {
    if (state.adminMode) {
      state.adminMode = false;
      localStorage.removeItem('galleryAdminMode');
      document.getElementById('gallery-admin-toggle').textContent = 'Admin';
      renderGallery();
    } else {
      await unlockAdmin();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('viewer')?.classList.contains('hidden')) closeViewer();
  });
}

export async function initGallery(app) {
  renderShell(app);
  try {
    const result = await loadAlbums();
    state.albums = result.albums;
    state.currentAlbum = state.albums[0] || null;
    wire();
    renderAlbumSelect();
    renderGallery();
  } catch (error) {
    console.error(error);
    document.getElementById('gallery').innerHTML = '<div class="empty">Could not load gallery manifests.</div>';
  }
}
