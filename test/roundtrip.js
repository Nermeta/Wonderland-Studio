/**
 * Safety check: a no-op save must never change a byte of any real file.
 *
 *   npm test                          (uses JEKYLL_REPO / config.json)
 *   JEKYLL_REPO=/path/to/site npm test
 *
 * Works on a throwaway copy of the repo, so it can't touch your working tree.
 */
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');

const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')); } catch { return {}; } })();
const SRC = path.resolve(process.env.JEKYLL_REPO || cfg.repo || path.join(__dirname, '..', '..', 'wynters-wonderland'));
if (!fs.existsSync(SRC)) { console.error(`Repo not found: ${SRC}\nSet JEKYLL_REPO or config.json.`); process.exit(2); }

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-roundtrip-'));
fs.cpSync(SRC, TMP, { recursive: true, filter: s => !/[\\/](\.git|node_modules|_site|vendor)([\\/]|$)/.test(s) });
process.env.JEKYLL_REPO = TMP;
const app = require('../server.js');

const srv = http.createServer(app).listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const j = async (m, u, b) => {
    const r = await fetch(base + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) });
    return { s: r.status, d: await r.json() };
  };
  let n = 0, bad = 0, notes = 0;
  const { collections } = (await j('GET', '/api/schema')).d;
  for (const c of collections) {
    for (const it of (await j('GET', `/api/c/${c.id}`)).d.items) {
      const det = (await j('GET', `/api/c/${c.id}/${it.slug}`)).d;
      const file = path.join(TMP, c.dir, it.slug + '.md');
      const before = fs.readFileSync(file);
      const r = await j('PUT', `/api/c/${c.id}/${it.slug}`, { values: det.values, body: det.body, mtime: det.mtime });
      n++;
      if (r.s !== 200 || !r.d.unchanged || !before.equals(fs.readFileSync(file))) { bad++; console.log(`ALTERED  ${c.dir}/${it.slug}  ${r.s} ${JSON.stringify(r.d)}`); }
      for (const w of det.warnings) { notes++; console.log(`note     ${c.dir}/${it.slug}: ${w}`); }
    }
  }
  console.log(`\n${n} files checked, ${bad} altered, ${notes} front-matter notes`);
  srv.close(); fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
});
