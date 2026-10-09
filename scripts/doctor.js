#!/usr/bin/env node
/**
 * npm run doctor: check that this computer is ready to run the Studio.
 *   node scripts/doctor.js          report only
 *   node scripts/doctor.js --fix    also run npm install and fetch the site when they are missing
 * Required problems exit with code 1. Optional ones (live preview, signing in to push) only warn.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIX = process.argv.includes('--fix');
const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch { return {}; } })();
const SITE = path.resolve(ROOT, process.env.JEKYLL_REPO || cfg.repo || 'site');
const isWsl = !!process.env.WSL_DISTRO_NAME || (fs.existsSync('/proc/version') && /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8')));

const sh = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000, ...opts }); return { ok: r.status === 0 && !r.error, out: ((r.stdout || '') + '').trim(), err: ((r.stderr || '') + '').trim() }; };
const has = cmd => sh('bash', ['-c', `command -v ${cmd}`]).ok;

const results = [];
const add = (level, name, detail, fix) => results.push({ level, name, detail, fix });
const ok = (n, d) => add('ok', n, d);
const warn = (n, d, f) => add('warn', n, d, f);
const bad = (n, d, f) => add('bad', n, d, f);

async function main() {
  // Node and npm
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) ok('Node.js', `v${process.versions.node}`);
  else bad('Node.js', `v${process.versions.node} is too old (needs 18 or newer)`, 'Install a current Node: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash, reopen the terminal, then nvm install --lts');
  if (has('npm')) ok('npm', sh('npm', ['-v']).out); else bad('npm', 'not found', 'It comes with Node. Install Node as above.');

  // git
  if (has('git')) {
    ok('git', sh('git', ['--version']).out.replace('git version ', ''));
    const name = sh('git', ['config', '--global', 'user.name']).out, email = sh('git', ['config', '--global', 'user.email']).out;
    if (name && email) ok('git identity', `${name} <${email}>`);
    else bad('git identity', 'name or email not set, so commits will fail', 'git config --global user.name "Your Name" && git config --global user.email "you@example.com"');
  } else bad('git', 'not found', 'sudo apt update && sudo apt install -y git');

  // where the Studio lives (WSL is much slower and flaky on the Windows drive)
  if (isWsl && ROOT.startsWith('/mnt/')) warn('Location', `${ROOT} is on the Windows drive, which is slow and can break file watching`, 'Keep it in your Linux home folder, for example ~/Wonderland-Studio');
  else ok('Location', ROOT);

  // packages
  const pkgs = fs.existsSync(path.join(ROOT, 'node_modules', 'express'));
  if (pkgs) ok('Packages', 'installed');
  else if (FIX && has('npm')) {
    console.log('  Installing packages…');
    const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status === 0) ok('Packages', 'installed just now'); else bad('Packages', 'npm install failed', 'Read the messages above, then run npm install again');
  } else bad('Packages', 'not installed', 'npm install   (or rerun with --fix)');

  // the website checkout
  if (fs.existsSync(path.join(SITE, '.git'))) {
    const branch = sh('git', ['branch', '--show-current'], { cwd: SITE }).out || '(detached)';
    const remote = sh('git', ['config', '--get', 'remote.origin.url'], { cwd: SITE }).out;
    ok('Website folder', `${SITE} (branch ${branch}, from ${remote || 'no remote'})`);
  } else if (FIX && has('git')) {
    console.log('  Fetching the website…');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'setup.js')], { cwd: ROOT, stdio: 'inherit' });
    if (r.status === 0) ok('Website folder', 'fetched just now'); else bad('Website folder', 'could not fetch it', 'Check your internet connection, then run npm run setup');
  } else bad('Website folder', `no checkout at ${SITE}`, 'npm run setup   (or rerun with --fix)');

  // internet
  try {
    const r = await fetch('https://github.com', { method: 'HEAD', signal: AbortSignal.timeout(6000) });
    ok('GitHub reachable', `HTTP ${r.status}`);
  } catch (e) { bad('GitHub reachable', 'cannot reach github.com', 'Check your internet connection (in WSL, a VPN or firewall can block it). Editing still works offline; pushing does not.'); }

  // signing in to push (optional)
  const gh = has('gh') ? sh('gh', ['auth', 'status']) : null;
  const helper = sh('git', ['config', '--global', 'credential.helper']).out;
  if (gh && gh.ok) ok('GitHub sign-in', 'GitHub CLI is signed in');
  else if (helper) ok('GitHub sign-in', `git credential helper: ${helper.split(/\s+/)[0]}`);
  else warn('GitHub sign-in', 'not set up, so Push will be refused', 'Install the GitHub CLI (sudo apt install gh) and run gh auth login, then gh auth setup-git');

  // live preview (optional)
  if (has('ruby') && has('bundle')) ok('Live preview (Ruby)', `Ruby ${sh('ruby', ['-e', 'print RUBY_VERSION']).out}, Bundler ${sh('bundle', ['-v']).out.replace('Bundler version ', '')}`);
  else warn('Live preview (Ruby)', 'Ruby or Bundler missing; the Studio works, only the Preview button needs them', 'sudo apt install -y ruby-full build-essential zlib1g-dev && sudo gem install bundler, then bundle install in the site folder');

  // opening your browser
  if (isWsl) {
    if (has('wslview') || has('explorer.exe')) ok('Browser', 'can open your Windows browser'); else warn('Browser', 'cannot open a browser on its own', 'Open http://localhost:4747 yourself');
    const lnk = sh('bash', ['-c', 'ls "$(wslpath "$(cmd.exe /c "echo %USERPROFILE%" 2>/dev/null | tr -d "\\r")")"/*/Desktop/"Wonderland Studio.lnk" "$(wslpath "$(cmd.exe /c "echo %USERPROFILE%" 2>/dev/null | tr -d "\\r")")"/Desktop/"Wonderland Studio.lnk" 2>/dev/null | head -1'], { cwd: '/mnt/c' });
    if (lnk.out) ok('Desktop icon', 'present'); else warn('Desktop icon', 'not made yet', 'npm run shortcut');
  }
}

main().then(() => {
  const mark = { ok: '✓', warn: '!', bad: '✗' };
  console.log('\n  ♠ Wonderland Studio: readiness check\n');
  for (const r of results) {
    console.log(`  ${mark[r.level]} ${r.name.padEnd(20)} ${r.detail}`);
    if (r.fix && r.level !== 'ok') console.log(`    → ${r.fix}`);
  }
  const nBad = results.filter(r => r.level === 'bad').length, nWarn = results.filter(r => r.level === 'warn').length;
  console.log(nBad ? `\n  ${nBad} thing(s) need fixing before the Studio will run.\n` : nWarn ? `\n  Ready. ${nWarn} optional item(s) above.\n` : '\n  All good. Start it with npm run launch.\n');
  process.exit(nBad ? 1 : 0);
});
