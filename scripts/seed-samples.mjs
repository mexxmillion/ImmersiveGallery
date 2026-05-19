import { copyFile, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const galleryRoot = path.resolve(import.meta.dirname, '..');
const memoriesRoot = process.env.MEMORIES_ROOT || 'E:\\git\\ImmersiveMemories';
const sourcePublic = path.join(memoriesRoot, 'viewer', 'public');
const sourceManifest = path.join(sourcePublic, 'manifest.json');
const albumId = 'demo';
const outAlbum = path.join(galleryRoot, 'public', 'albums', albumId);

const preferredIds = [
  'sample_mountain',
  'sample_room_2',
  'zimage_res4lyf_hidetail_00070',
  'comfyui_temp_iupys_00008',
  'bc6e374e_90e1_4146_984a_1c7f725c8880',
  '3ae76775_9831_4e67_b6a9_6a7f1bec8e11',
  '269e896f_919b_4bc0_950a_993587fa3ba8',
  'zimage_res4lyf_hidetail_00009',
  'zimage_res4lyf_hidetail_00074',
  'zimage_res4lyf_hidetail_00021',
];

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function cleanTitle(item) {
  return item.title || item.name || item.id.replaceAll('_', ' ');
}

async function main() {
  const source = JSON.parse(await readFile(sourceManifest, 'utf8'));
  const byId = new Map(source.items.map((item) => [item.id, item]));
  const selected = preferredIds.map((id) => byId.get(id)).filter(Boolean);

  if (!selected.length) {
    throw new Error(`No preferred sample IDs found in ${sourceManifest}`);
  }

  await mkdir(path.join(galleryRoot, 'public', 'albums'), { recursive: true });
  await mkdir(outAlbum, { recursive: true });

  const scenes = [];
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index];
    const sceneDir = path.join(outAlbum, 'scenes', item.id);
    await mkdir(sceneDir, { recursive: true });

    const thumbSource = path.join(sourcePublic, item.thumb.replace(/^\//, ''));
    const plySource = path.join(sourcePublic, item.ply.replace(/^\//, ''));
    const thumbTarget = path.join(sceneDir, 'thumb.jpg');
    const plyTarget = path.join(sceneDir, 'scene.ply');
    const sogTarget = path.join(sceneDir, 'scene.sog');
    if (!(await exists(thumbTarget))) await copyFile(thumbSource, thumbTarget);
    if (!(await exists(sogTarget)) && !(await exists(plyTarget))) {
      await copyFile(plySource, plyTarget);
    }
    const coverTarget = path.join(outAlbum, 'cover.jpg');
    if (index === 0 && !(await exists(coverTarget))) await copyFile(thumbSource, coverTarget);

    const scene = {
      id: item.id,
      title: cleanTitle(item),
      status: 'published',
      date: item.date || null,
      thumbnail: `/albums/${albumId}/scenes/${item.id}/thumb.jpg`,
      splatCount: item.gaussians || null,
      sortOrder: index + 1,
    };

    if (await exists(sogTarget)) {
      scene.sog = `/albums/${albumId}/scenes/${item.id}/scene.sog`;
    }
    if (await exists(plyTarget)) {
      scene.ply = `/albums/${albumId}/scenes/${item.id}/scene.ply`;
    }

    await writeFile(
      path.join(sceneDir, 'scene.json'),
      `${JSON.stringify(scene, null, 2)}\n`,
      'utf8',
    );
    scenes.push(scene);
  }

  const album = {
    id: albumId,
    title: 'Demo Gallery',
    description: 'First web-publish test from the local Immersive Memories library',
    status: 'published',
    cover: `/albums/${albumId}/cover.jpg`,
    scenes,
  };
  await writeFile(path.join(outAlbum, 'album.json'), `${JSON.stringify(album, null, 2)}\n`, 'utf8');

  const index = {
    generated: new Date().toISOString(),
    albums: [{
      id: album.id,
      title: album.title,
      status: album.status,
      cover: album.cover,
      manifest: `/albums/${album.id}/album.json`,
      sceneCount: scenes.length,
    }],
  };
  await writeFile(
    path.join(galleryRoot, 'public', 'albums', 'index.json'),
    `${JSON.stringify(index, null, 2)}\n`,
    'utf8',
  );

  console.log(`Seeded ${scenes.length} scenes from ${memoriesRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
