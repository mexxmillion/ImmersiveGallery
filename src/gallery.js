import { loadAlbums } from './api.js';
import { PcSplatViewer } from './pcviewer.js';

const state = {
  albums: [],
  currentAlbum: null,
  query: '',
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
    .filter((scene) => scene.status === 'published')
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

  const img = document.createElement('img');
  img.src = scene.thumbnail;
  img.alt = scene.title;
  img.loading = 'lazy';

  const body = document.createElement('div');
  body.className = 'scene-body';

  const title = document.createElement('h2');
  title.textContent = scene.title;

  const meta = document.createElement('p');
  const type = scene.sog ? 'SOG' : 'PLY';
  meta.textContent = [type, formatCount(scene.splatCount), scene.date].filter(Boolean).join(' · ');

  body.append(title, meta);
  card.append(img, body);
  card.addEventListener('click', () => openViewer(scene));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openViewer(scene);
    }
  });
  return card;
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
