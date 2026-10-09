/**
 * npm run setup
 * Puts a checkout of the website at ./site (ignored by this repo's git), so the
 * Studio is portable: clone it on a new computer, run this, done.
 * If ./site already exists it only runs `git fetch --prune` and reports status.
 */
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');

const root = path.join(__dirname, '..');
const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')); } catch { return {}; } })();
const remote = process.env.SITE_REMOTE || cfg.siteRemote || 'https://github.com/Nermeta/nermeta.github.io';
const dest = path.resolve(root, process.env.JEKYLL_REPO || cfg.repo || 'site');
const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'inherit' });
const out = (args, cwd) => execFileSync('git', args, { cwd }).toString().trim();

try {
  if (!fs.existsSync(path.join(dest, '.git'))) {
    if (fs.existsSync(dest) && fs.readdirSync(dest).length) { console.error(`${dest} exists but is not a git checkout. Move it aside and rerun.`); process.exit(1); }
    console.log(`Cloning ${remote}\n      into ${dest}\n`);
    git(['clone', remote, dest]);
  } else {
    console.log(`Found ${dest}. Fetching…`);
    git(['fetch', '--prune'], dest);
  }
  const branch = out(['branch', '--show-current'], dest) || '(detached)';
  const behind = (() => { try { return out(['rev-list', '--count', 'HEAD..@{u}'], dest); } catch { return '?'; } })();
  const dirty = out(['status', '--porcelain'], dest).split('\n').filter(Boolean).length;
  console.log(`\nSite ready: branch ${branch}, ${behind} commit(s) behind its remote, ${dirty} uncommitted file(s).`);
  if (behind !== '0' && behind !== '?') console.log('Update it with:  git -C site pull --ff-only');
  if (['main', 'master'].includes(branch)) console.log('You are on ' + branch + '. Create a feature branch before editing (the Studio git chip does this).');
  console.log('\nNext: npm start');
} catch (e) {
  console.error('\nSetup failed: ' + e.message);
  process.exit(1);
}
