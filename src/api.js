export async function readJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

export async function apiJson(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`/api${path} returned ${res.status}`);
  return res.json();
}

export async function loadAlbums() {
  try {
    const data = await apiJson('/albums');
    if (Array.isArray(data.albums)) return { albums: data.albums, source: 'api' };
  } catch {
    // Static fallback keeps the current Pages/Workers asset deployment usable.
  }

  const index = await readJson('/albums/index.json');
  const albums = await Promise.all(
    (index.albums || [])
      .filter((album) => album.status !== 'archived')
      .map((album) => readJson(album.manifest)),
  );
  return { albums, source: 'static' };
}

export async function loadAdminSummary() {
  try {
    return await apiJson('/admin/summary');
  } catch {
    const { albums, source } = await loadAlbums();
    const scenes = albums.flatMap((album) =>
      (album.scenes || []).map((scene) => ({ ...scene, albumId: album.id, albumTitle: album.title })),
    );
    return {
      source,
      mode: 'static-fallback',
      user: null,
      roles: [],
      counts: {
        albums: albums.length,
        scenes: scenes.length,
        users: 0,
        publishedScenes: scenes.filter((scene) => scene.status === 'published').length,
      },
      albums,
      scenes,
      users: [],
      bindings: {
        d1: false,
        r2: false,
        access: false,
      },
    };
  }
}
