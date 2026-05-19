import { createServer } from 'node:http';
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile, copyFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const root = path.resolve(import.meta.dirname, '..');
const memoryRoot = process.env.MEMORIES_ROOT || 'E:\\git\\ImmersiveMemories';
const pythonExe = process.env.SHARP_PYTHON || path.join(memoryRoot, '.venv', 'Scripts', 'python.exe');
const port = Number(process.env.PREPARE_API_PORT || 5199);
const uploadsRoot = path.join(root, '.local', 'uploads');
const jobs = [];

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

function send(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,X-Filename',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}

function slugify(value) {
  return String(value || 'scene')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'scene';
}

function prettyName(value) {
  return String(value || 'Untitled Scene')
    .replace(/\.[^.]+$/, '')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .slice(0, 80) || 'Untitled Scene';
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || root,
      shell: false,
      env: options.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      options.onLine?.(chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      options.onLine?.(chunk.toString());
    });
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}\n${stderr || stdout}`));
    });
  });
}

async function readSceneJson(sceneDir) {
  return JSON.parse(await readFile(path.join(sceneDir, 'scene.json'), 'utf8'));
}

async function refreshAlbum(albumId) {
  const albumDir = path.join(root, 'public', 'albums', albumId);
  const scenesDir = path.join(albumDir, 'scenes');
  await mkdir(scenesDir, { recursive: true });
  const sceneIds = await readdir(scenesDir).catch(() => []);
  const scenes = [];
  for (const sceneId of sceneIds) {
    const sceneDir = path.join(scenesDir, sceneId);
    if (await exists(path.join(sceneDir, 'scene.json'))) {
      scenes.push(await readSceneJson(sceneDir));
    }
  }
  scenes.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.title.localeCompare(b.title));

  const albumPath = path.join(albumDir, 'album.json');
  let album = {
    id: albumId,
    title: prettyName(albumId),
    description: 'Prepared locally with SHARP and SOG conversion',
    status: 'published',
    cover: `/albums/${albumId}/cover.jpg`,
    scenes: [],
  };
  if (await exists(albumPath)) {
    album = { ...album, ...JSON.parse(await readFile(albumPath, 'utf8')) };
  }
  album.scenes = scenes;
  await writeFile(albumPath, `${JSON.stringify(album, null, 2)}\n`, 'utf8');

  const cover = path.join(albumDir, 'cover.jpg');
  if (!(await exists(cover)) && scenes[0]) {
    await copyFile(path.join(scenesDir, scenes[0].id, 'thumb.jpg'), cover);
  }

  const albumsRoot = path.join(root, 'public', 'albums');
  const albumIds = await readdir(albumsRoot).catch(() => []);
  const albums = [];
  for (const id of albumIds) {
    const candidate = path.join(albumsRoot, id, 'album.json');
    if (!(await exists(candidate))) continue;
    const data = JSON.parse(await readFile(candidate, 'utf8'));
    albums.push({
      id: data.id,
      title: data.title,
      status: data.status,
      cover: data.cover,
      manifest: `/albums/${data.id}/album.json`,
      sceneCount: data.scenes?.length || 0,
    });
  }
  await writeFile(
    path.join(albumsRoot, 'index.json'),
    `${JSON.stringify({ generated: new Date().toISOString(), albums }, null, 2)}\n`,
    'utf8',
  );
}

async function processJob(job) {
  job.state = 'running';
  job.progress = 'Running SHARP...';
  try {
    const sceneDir = path.join(root, 'public', 'albums', job.albumId, 'scenes', job.sceneId);
    await mkdir(sceneDir, { recursive: true });

    const py = await run(pythonExe, [
      path.join(root, 'scripts', 'sharp-sog-prepare.py'),
      '--memory-root', memoryRoot,
      '--image', job.imagePath,
      '--out-dir', sceneDir,
      ...(job.focal ? ['--focal', String(job.focal)] : []),
      ...(job.maxGaussians ? ['--max-gaussians', String(job.maxGaussians)] : []),
    ], {
      onLine: (line) => {
        const text = line.trim();
        if (text) job.progress = text.slice(-240);
      },
    });
    const resultLine = py.stdout.trim().split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'));
    const result = resultLine ? JSON.parse(resultLine) : {};

    job.progress = 'Converting SOG...';
    await run('npx.cmd', ['splat-transform', '-w', 'scene.ply', 'scene.sog'], {
      cwd: sceneDir,
      onLine: (line) => {
        const text = line.trim();
        if (text) job.progress = text.slice(-240);
      },
    });
    await unlink(path.join(sceneDir, 'scene.ply')).catch(() => {});

    const existingAlbum = path.join(root, 'public', 'albums', job.albumId, 'album.json');
    let nextSort = 1;
    if (await exists(existingAlbum)) {
      const album = JSON.parse(await readFile(existingAlbum, 'utf8'));
      nextSort = Math.max(0, ...(album.scenes || []).map((scene) => scene.sortOrder || 0)) + 1;
    }
    const scene = {
      id: job.sceneId,
      title: job.title,
      status: 'published',
      date: new Date().toISOString().slice(0, 10),
      thumbnail: `/albums/${job.albumId}/scenes/${job.sceneId}/thumb.jpg`,
      splatCount: result.splatCount || null,
      sortOrder: nextSort,
      sog: `/albums/${job.albumId}/scenes/${job.sceneId}/scene.sog`,
    };
    await writeFile(path.join(sceneDir, 'scene.json'), `${JSON.stringify(scene, null, 2)}\n`, 'utf8');
    await refreshAlbum(job.albumId);

    await rm(path.dirname(job.imagePath), { recursive: true, force: true }).catch(() => {});
    job.progress = 'Ready';
    job.state = 'done';
    job.scene = scene;
  } catch (error) {
    job.state = 'failed';
    job.error = error.message;
    job.progress = 'Failed';
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}

async function handleUpload(req, res, url) {
  const filename = req.headers['x-filename'] || 'image.jpg';
  const ext = path.extname(String(filename)).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) {
    send(res, 400, { error: 'Upload a JPG, PNG, WEBP, HEIC, or HEIF image.' });
    return;
  }

  const title = prettyName(url.searchParams.get('title') || filename);
  const albumId = slugify(url.searchParams.get('albumId') || 'demo');
  const sceneId = slugify(url.searchParams.get('sceneId') || title);
  const focal = Number(url.searchParams.get('focal') || '') || null;
  const maxGaussians = Number(url.searchParams.get('maxGaussians') || '') || null;
  const jobId = crypto.randomUUID();
  const jobDir = path.join(uploadsRoot, jobId);
  await mkdir(jobDir, { recursive: true });
  const imagePath = path.join(jobDir, `source${ext}`);
  await pipeline(req, createWriteStream(imagePath));

  const job = {
    id: jobId,
    state: 'queued',
    progress: 'Queued',
    albumId,
    sceneId,
    title,
    focal,
    maxGaussians,
    imagePath,
    queuedAt: new Date().toISOString(),
  };
  jobs.unshift(job);
  send(res, 200, { job });
  processJob(job);
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Filename');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true, pythonExe, memoryRoot });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/prepare/jobs') {
      send(res, 200, { jobs: jobs.slice(0, 50) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/prepare/upload') {
      await handleUpload(req, res, url);
      return;
    }
    send(res, 404, { error: 'not found' });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[prepare-api] http://127.0.0.1:${port}`);
  console.log(`[prepare-api] python=${pythonExe}`);
  console.log(`[prepare-api] memories=${memoryRoot}`);
});
