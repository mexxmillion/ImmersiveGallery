import { readdir, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const scenesRoot = path.join(root, 'public', 'albums', 'demo', 'scenes');

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: true, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

async function main() {
  const sceneIds = await readdir(scenesRoot);
  for (const id of sceneIds) {
    const sceneDir = path.join(scenesRoot, id);
    const ply = path.join(sceneDir, 'scene.ply');
    const sog = path.join(sceneDir, 'scene.sog');
    if (!(await exists(ply))) continue;
    if (await exists(sog)) {
      console.log(`[sog] ${id}: already exists`);
      continue;
    }
    console.log(`[sog] ${id}: converting PLY to SOG`);
    await run('npx', ['splat-transform', '-w', 'scene.ply', 'scene.sog'], sceneDir);
  }
  console.log('[sog] done');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
