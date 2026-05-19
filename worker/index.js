const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

function notFound() {
  return json({ error: 'not found' }, 404);
}

function forbidden() {
  return json({ error: 'forbidden' }, 403);
}

function adminEmails(env) {
  return String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function getAccessIdentity(request, env) {
  const directEmail = request.headers.get('cf-access-authenticated-user-email')
    || request.headers.get('x-authenticated-user-email')
    || request.headers.get('x-dev-user-email');
  if (directEmail) return { email: directEmail.toLowerCase(), source: 'header' };

  const token = request.headers.get('Cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('CF_Authorization='))
    ?.slice('CF_Authorization='.length);
  if (!token || !env.ACCESS_TEAM_DOMAIN) return null;

  try {
    const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/get-identity`, {
      headers: { Cookie: `CF_Authorization=${token}` },
    });
    if (!res.ok) return null;
    const identity = await res.json();
    return {
      email: String(identity.email || '').toLowerCase(),
      name: identity.name || identity.email || null,
      sub: identity.sub || null,
      source: 'cloudflare-access',
    };
  } catch {
    return null;
  }
}

async function ensureUser(identity, env) {
  if (!identity?.email || !env.DB) return null;
  const existing = await env.DB.prepare(
    'select id, email, name, role, created_at as createdAt from users where lower(email) = lower(?)',
  ).bind(identity.email).first();
  if (existing) return existing;

  const role = adminEmails(env).includes(identity.email) ? 'admin' : 'viewer';
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'insert into users (id, email, name, role) values (?, ?, ?, ?)',
  ).bind(id, identity.email, identity.name || null, role).run();
  return { id, email: identity.email, name: identity.name || null, role, createdAt: new Date().toISOString() };
}

async function requestContext(request, env) {
  const identity = await getAccessIdentity(request, env);
  const user = await ensureUser(identity, env);
  const configuredAdmins = adminEmails(env);
  const isConfiguredAdmin = identity?.email && configuredAdmins.includes(identity.email);
  const roles = new Set();
  if (user?.role) roles.add(user.role);
  if (isConfiguredAdmin) roles.add('admin');
  return {
    identity,
    user,
    roles: [...roles],
    isAdmin: roles.has('admin'),
    isCurator: roles.has('admin') || roles.has('curator'),
  };
}

async function staticAlbums(request, env) {
  if (!env.ASSETS) return { albums: [] };
  const origin = new URL(request.url).origin;
  const indexRes = await env.ASSETS.fetch(new Request(`${origin}/albums/index.json`));
  if (!indexRes.ok) return { albums: [] };
  const index = await indexRes.json();
  const albums = [];
  for (const item of index.albums || []) {
    if (item.status === 'archived') continue;
    const albumRes = await env.ASSETS.fetch(new Request(`${origin}${item.manifest}`));
    if (albumRes.ok) albums.push(await albumRes.json());
  }
  return { albums };
}

async function dbAlbums(env, ctx) {
  if (!env.DB) return null;
  const albumRows = await env.DB.prepare(`
    select id, title, description, status, cover_url as cover, sort_order as sortOrder
    from albums
    where status != 'archived'
    order by sort_order, title
  `).all();

  const albums = [];
  for (const album of albumRows.results || []) {
    const sceneRows = await env.DB.prepare(`
      select id, title, status, date, thumbnail_url as thumbnail, asset_url as sog,
             asset_key as assetKey, splat_count as splatCount, sort_order as sortOrder
      from scenes
      where album_id = ? and status != 'archived'
      order by sort_order, title
    `).bind(album.id).all();
    albums.push({
      ...album,
      scenes: sceneRows.results || [],
      canManage: ctx.isCurator,
    });
  }
  return { albums };
}

async function albumsHandler(request, env) {
  const ctx = await requestContext(request, env);
  const fromDb = await dbAlbums(env, ctx);
  if (fromDb && fromDb.albums.length) return json({ ...fromDb, source: 'd1' });
  const fallback = await staticAlbums(request, env);
  return json({ ...fallback, source: 'static-assets' });
}

async function adminSummary(request, env) {
  const ctx = await requestContext(request, env);
  if (!ctx.isCurator && adminEmails(env).length > 0) return forbidden();

  const albumData = await dbAlbums(env, ctx) || await staticAlbums(request, env);
  const scenes = albumData.albums.flatMap((album) =>
    (album.scenes || []).map((scene) => ({ ...scene, albumId: album.id, albumTitle: album.title })),
  );

  let users = [];
  if (env.DB) {
    const rows = await env.DB.prepare(
      'select id, email, name, role, created_at as createdAt from users order by created_at desc limit 100',
    ).all();
    users = rows.results || [];
  }

  return json({
    mode: env.DB ? 'api' : 'static-fallback',
    user: ctx.user || ctx.identity,
    roles: ctx.roles,
    counts: {
      albums: albumData.albums.length,
      scenes: scenes.length,
      users: users.length,
      publishedScenes: scenes.filter((scene) => scene.status === 'published').length,
    },
    albums: albumData.albums,
    scenes,
    users,
    bindings: {
      d1: !!env.DB,
      r2: !!env.GALLERY_BUCKET,
      access: !!ctx.identity,
    },
  });
}

async function r2Asset(request, env, key) {
  if (!env.GALLERY_BUCKET) return notFound();
  const object = await env.GALLERY_BUCKET.get(key);
  if (!object) return notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}

async function uploadPrepare(request, env) {
  const ctx = await requestContext(request, env);
  if (!ctx.isCurator) return forbidden();
  if (!env.GALLERY_BUCKET) return json({ error: 'R2 binding not configured' }, 501);
  const body = await request.json().catch(() => ({}));
  const albumId = String(body.albumId || 'demo').trim();
  const sceneId = String(body.sceneId || crypto.randomUUID()).trim();
  return json({
    method: 'PUT',
    url: `/api/admin/uploads/${encodeURIComponent(albumId)}/${encodeURIComponent(sceneId)}`,
    assetKeyPrefix: `albums/${albumId}/scenes/${sceneId}/`,
    note: 'Upload endpoint scaffolded. Large direct browser uploads will be hardened in the next pass.',
  });
}

async function router(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/me') {
    const ctx = await requestContext(request, env);
    return json({ user: ctx.user || ctx.identity, roles: ctx.roles });
  }
  if (url.pathname === '/api/albums') return albumsHandler(request, env);
  if (url.pathname === '/api/admin/summary') return adminSummary(request, env);
  if (url.pathname === '/api/admin/upload-url' && request.method === 'POST') {
    return uploadPrepare(request, env);
  }
  if (url.pathname.startsWith('/api/assets/')) {
    return r2Asset(request, env, decodeURIComponent(url.pathname.slice('/api/assets/'.length)));
  }
  if (url.pathname.startsWith('/api/')) return notFound();
  return env.ASSETS.fetch(request);
}

export default {
  fetch(request, env) {
    return router(request, env);
  },
};
