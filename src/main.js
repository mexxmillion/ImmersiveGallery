import { PcSplatViewer } from './pcviewer.js';

const $ = (id) => document.getElementById(id);

const state = {
  albums: [],
  currentAlbum: null,
  query: '',
};

let viewer = null;

async function readJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

async function loadAlbums() {
  const index = await readJson('/albums/index.json');
  state.albums = await Promise.all(
    (index.albums || [])
      .filter((album) => album.status !== 'archived')
      .map((album) => readJson(album.manifest)),
  );
  state.currentAlbum = state.albums[0] || null;
}

function assetUrl(scene) {
  return scene.sog || scene.ply;
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

function renderAlbumSelect() {
  const select = $('album-select');
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
  $('album-subtitle').textContent = album
    ? `${album.description || 'Private web gallery'} · ${visibleScenes().length} scenes`
    : 'No albums published yet';

  const gallery = $('gallery');
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
  $('viewer-canvas').innerHTML = '';
  $('viewer').classList.add('hidden');
  $('enter-vr').classList.add('hidden');
}

async function openViewer(scene) {
  await closeViewer();
  $('viewer').classList.remove('hidden');
  $('viewer-title').textContent = scene.title;
  $('viewer-status').textContent = 'Loading...';

  try {
    viewer = new PcSplatViewer($('viewer-canvas'), (msg) => {
      $('viewer-status').textContent = msg;
    });
    await viewer.load(assetUrl(scene));
    if (viewer.vrSupported) {
      $('enter-vr').classList.remove('hidden');
      $('enter-vr').onclick = () => viewer.enterVR();
    }
  } catch (error) {
    console.error(error);
    $('viewer-status').textContent = `Could not load ${scene.sog ? 'SOG' : 'PLY'} scene.`;
  }
}

function wire() {
  $('search').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderGallery();
  });
  $('album-select').addEventListener('change', (event) => {
    state.currentAlbum = state.albums.find((album) => album.id === event.target.value) || state.albums[0] || null;
    renderGallery();
  });
  $('close-viewer').addEventListener('click', closeViewer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('viewer').classList.contains('hidden')) closeViewer();
  });
}

async function boot() {
  try {
    await loadAlbums();
    wire();
    renderAlbumSelect();
    renderGallery();
  } catch (error) {
    console.error(error);
    $('gallery').innerHTML = '<div class="empty">Could not load gallery manifests.</div>';
  }
}

boot();
