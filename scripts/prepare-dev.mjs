import { spawn } from 'node:child_process';

const children = [];

function start(command, args) {
  const child = spawn(command, args, {
    shell: true,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  return child;
}

function stop() {
  for (const child of children) {
    try { child.kill(); } catch {}
  }
}

process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('exit', stop);

start('node', ['scripts/local-processor-server.mjs']);
start('npx', ['vite', '--host', '0.0.0.0', '--port', process.env.PORT || '5174']);
