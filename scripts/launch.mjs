#!/usr/bin/env node
// Launcher shared by ./start.sh (macOS, Linux) and start.bat (Windows), run once Node 24 exists:
// makes sure pnpm and the project dependencies are installed, starts the app and opens the browser.
//   node scripts/launch.mjs            start (or just open the browser if the app is already running)
//   node scripts/launch.mjs --check    only check / install prerequisites, don't start
//   NO_OPEN=1                          don't open the browser
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WIN = process.platform === 'win32';
const PNPM_VERSION = '10.34.9';
const ADMIN_URL = 'http://localhost:5173';
const POS_URL = 'http://localhost:5174/sale/';
const PORTS = [3000, 5173, 5174];
const checkOnly = process.argv.includes('--check');

const say = msg => console.log(`\x1b[36m▶\x1b[0m ${msg}`);
const fail = msg => { console.error(`\n\x1b[31m✖ ${msg}\x1b[0m\n`); process.exit(1); };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: WIN, ...opts });
const quiet = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: WIN });

// 1. Node
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) fail(`Node.js ${process.versions.node} is too old — this app needs Node.js 24 or newer. Install it from https://nodejs.org and start again.`);
say(`Node.js ${process.versions.node}`);

// 2. pnpm: the one on PATH if it is v10, otherwise the exact version through npx (no global install needed).
function findPnpm() {
  const own = quiet('pnpm', ['-v']);
  if (own.status === 0 && own.stdout.trim().startsWith('10.')) return { cmd: 'pnpm', pre: [], label: `pnpm ${own.stdout.trim()}` };
  say(`pnpm 10 not found — using pnpm ${PNPM_VERSION} via npx (downloaded once, then cached)`);
  const viaNpx = quiet('npx', ['--yes', `pnpm@${PNPM_VERSION}`, '-v']);
  if (viaNpx.status !== 0) fail(`Could not run pnpm through npx:\n${viaNpx.stderr || viaNpx.stdout}\nInstall it yourself with "npm install -g pnpm@10" and start again.`);
  return { cmd: 'npx', pre: ['--yes', `pnpm@${PNPM_VERSION}`], label: `pnpm ${PNPM_VERSION} (npx)` };
}
const pnpm = findPnpm();
say(pnpm.label);

// 3. Dependencies: install when node_modules is missing or older than the lockfile.
const marker = path.join(ROOT, 'node_modules', '.modules.yaml');
const lock = path.join(ROOT, 'pnpm-lock.yaml');
const stale = !fs.existsSync(marker) || fs.statSync(lock).mtimeMs > fs.statSync(marker).mtimeMs;
if (stale) {
  say('Installing dependencies (first run takes a few minutes)…');
  const r = run(pnpm.cmd, [...pnpm.pre, 'install']);
  if (r.status !== 0) {
    fail(`Installing dependencies failed.${process.platform === 'darwin' ? '\nIf the error mentions "better-sqlite3" or "gyp", run "xcode-select --install" and start again.' : WIN ? '\nIf the error mentions "better-sqlite3" or "gyp", install "Visual Studio Build Tools" (Desktop development with C++) and start again.' : ''}`);
  }
} else say('Dependencies are up to date');
if (checkOnly) { say('Everything needed is installed.'); process.exit(0); }

// 4. Already running? Just open it. A port taken by something else? Say so.
const reachable = async url => { try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } };
const portBusy = port => new Promise(resolve => {
  const s = net.connect({ port, host: '127.0.0.1' });
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
});
function openBrowser(url) {
  if (process.env.NO_OPEN) return;
  if (WIN) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}
function banner() {
  console.log(`
\x1b[32m✔ PhuongDong POS is running\x1b[0m
   Back office : ${ADMIN_URL}
   POS (bán hàng): ${POS_URL}
   Online shop : ${ADMIN_URL}/shop
   Sign in     : admin / admin123   (you'll be asked to set a new password)
   Stop        : close this window or press Ctrl+C
`);
}

if ((await reachable(`${ADMIN_URL}/`)) && (await reachable('http://localhost:3000/api/health'))) {
  say('The app is already running.');
  banner();
  openBrowser(ADMIN_URL);
  process.exit(0);
}
const busy = [];
for (const p of PORTS) if (await portBusy(p)) busy.push(p);
if (busy.length) fail(`Port(s) ${busy.join(', ')} are used by another program. Close it (or the other copy of this app) and start again.`);

// 5. Start (migrates the database and loads demo data on the first run), then open the browser when ready.
say('Starting the app (first start also creates the demo data)…');
const dev = spawn(pnpm.cmd, [...pnpm.pre, 'dev'], { cwd: ROOT, stdio: 'inherit', shell: WIN });
const stop = () => { if (!dev.killed) dev.kill('SIGINT'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
dev.on('exit', code => process.exit(code ?? 0));

const started = Date.now();
while (Date.now() - started < 300_000) {
  if ((await reachable(`${ADMIN_URL}/`)) && (await reachable('http://localhost:3000/api/health'))) {
    banner();
    openBrowser(ADMIN_URL);
    break;
  }
  await new Promise(r => setTimeout(r, 1500));
}
