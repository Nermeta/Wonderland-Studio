#!/usr/bin/env node
/**
 * npm run launch: start the Studio (if it isn't already running) and open it in your browser.
 * First run on a new computer also installs the packages and fetches the site.
 * Keep this window open while you work; close it (or use Settings → Quit) to stop the Studio.
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch { return {}; } })();
const PORT = Number(process.env.PORT || cfg.port || 4747);
const URL = `http://localhost:${PORT}/`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const isWsl = !!process.env.WSL_DISTRO_NAME || (fs.existsSync('/proc/version') && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')));

const log = m => console.log(`  ${m}`);

async function studioRunning() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/schema`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return false;
    const j = await r.json();
    return Array.isArray(j.collections);
  } catch { return false; }
}

function openBrowser(url) {
  const tries = process.platform === 'darwin' ? [['open', [url]]]
    : process.platform === 'win32' ? [['cmd', ['/c', 'start', '', url]]]
    : isWsl ? [['wslview', [url]], ['explorer.exe', [url]], ['cmd.exe', ['/c', 'start', '', url]]]
    : [['xdg-open', [url]]];
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { stdio: 'ignore', timeout: 8000 });
    if (!r.error) return true; // explorer.exe returns 1 even when it works
  }
  return false;
}

function prepare() {
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    log('First run: installing packages…');
    if (spawnSync(npm, ['install'], { cwd: ROOT, stdio: 'inherit' }).status !== 0) { console.error('npm install failed.'); process.exit(1); }
  }
  const siteDir = path.resolve(ROOT, process.env.JEKYLL_REPO || cfg.repo || 'site');
  if (!fs.existsSync(siteDir)) {
    log('First run: fetching the website into ./site …');
    spawnSync(npm, ['run', 'setup'], { cwd: ROOT, stdio: 'inherit' });
  }
}

(async () => {
  console.log('\n  ♠ Wonderland Studio');
  if (await studioRunning()) {
    log('Already running. Opening it in your browser.');
    if (!openBrowser(URL)) log(`Open ${URL} in your browser.`);
    return;
  }
  prepare();
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', code => process.exit(code || 0));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill('SIGTERM'));
  for (let i = 0; i < 80; i++) { // up to ~20 seconds
    if (await studioRunning()) break;
    await new Promise(r => setTimeout(r, 250));
  }
  if (await studioRunning()) {
    if (!openBrowser(URL)) log(`Open ${URL} in your browser.`);
    log('Keep this window open while you work. Close it, or use Settings → Quit, to stop the Studio.\n');
  } else {
    console.error('  The Studio did not start. The messages above say why.');
  }
})();
