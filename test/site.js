/** Site-wide values and Markdown templates, on a throwaway copy of the site. */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const SRC = path.resolve(process.env.JEKYLL_REPO || path.join(__dirname, '..', 'site'));
if (!fs.existsSync(SRC)) { console.error('Repo not found: ' + SRC); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-site-'));
fs.cpSync(SRC, tmp, { recursive: true, filter: s => !/node_modules|[\\/]\.git([\\/]|$)|vendor|_site/.test(s) });
process.env.JEKYLL_REPO = tmp; process.env.STUDIO_TEMPLATES = path.join(tmp, 'tpl.json'); process.env.STUDIO_CONFIG = path.join(tmp, 'cfg.json');
const SC = require('../lib/siteconfig'), app = require('../server');
const rd = f => fs.readFileSync(path.join(tmp, f), 'utf8');

// site config: patch only what changed, and restoring gives the identical bytes
const before = { cfg: rd('_config.yml'), chat: rd('assets/js/chat.js') };
const cur = SC.read(tmp);
assert.ok(cur.title && cur.workerUrl.startsWith('https://'), 'reads title and worker url');
assert.deepStrictEqual(SC.write(tmp, { title: cur.title, workerUrl: cur.workerUrl }), [], 'no-op writes nothing');
assert.deepStrictEqual(SC.write(tmp, { workerUrl: 'https://example.workers.dev/chat' }).sort(), ['assets/js/chat.js']);
assert.ok(rd('assets/js/chat.js').includes("const WORKER_URL = 'https://example.workers.dev/chat';"));
SC.write(tmp, { title: 'New: "Title" #1', email: 'a@b.co', description: 'One two three. '.repeat(12), url: 'https://example.com/' });
const after = SC.read(tmp);
assert.strictEqual(after.title, 'New: "Title" #1'); assert.strictEqual(after.url, 'https://example.com'); assert.strictEqual(after.description, ('One two three. '.repeat(12)).trim());
const diff = rd('_config.yml').split('\n').length;
SC.write(tmp, { title: cur.title, email: cur.email, description: cur.description, url: cur.url, workerUrl: cur.workerUrl });
assert.strictEqual(SC.read(tmp).description, cur.description);
for (const k of ['title', 'email', 'url', 'github_username', 'workerUrl']) assert.strictEqual(SC.read(tmp)[k], cur[k], k + ' restored');
const cfgNow = rd('_config.yml').split('\n'), cfgOld = before.cfg.split('\n');
const moved = [...cfgNow.filter(l => !cfgOld.includes(l)), ...cfgOld.filter(l => !cfgNow.includes(l))];
assert.ok(moved.every(l => /^\s{2}\S/.test(l) || /^(description|email|title|url|github_username):/.test(l)), 'only edited keys moved: ' + JSON.stringify(moved));
assert.strictEqual(rd('assets/js/chat.js'), before.chat, 'chat.js restored byte-for-byte');
for (const bad of [{ workerUrl: 'http://x.dev' }, { workerUrl: "https://x.dev/'" }, { url: 'nope' }, { email: 'x' }, { title: '' }, { github_username: 'a b' }]) {
  assert.throws(() => SC.write(tmp, bad), /./, 'rejects ' + JSON.stringify(bad));
}

// desktop shortcut script: quoting survives spaces and apostrophes
const { powershellScript } = require('../scripts/make-shortcut');
const ps = powershellScript({ distro: 'Ubuntu-22.04', linuxPath: "/home/o'brien/My Studio" });
assert.ok(ps.includes(`$s.Arguments = '/c wsl.exe -d Ubuntu-22.04 --cd "/home/o''brien/My Studio" -e bash "/home/o''brien/My Studio/scripts/launch.sh" || pause'`), 'arguments are quoted for wsl.exe and PowerShell');
assert.ok(ps.includes("Join-Path (Join-Path $env:LOCALAPPDATA 'WonderlandStudio') 'studio.ico'") && ps.includes('$s.WindowStyle = 1'));

const srv = app.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { s: r.status, j }; };
  try {
    // site-config over HTTP + worker test against a local server
    const worker = http.createServer((q, s) => { s.statusCode = 405; s.end(); }).listen(0, '127.0.0.1');
    r = await call('PUT', '/api/site-config', { workerUrl: 'https://example.workers.dev/chat' }); assert.deepStrictEqual(r.j.changed, ['assets/js/chat.js']);
    assert.strictEqual((await call('POST', '/api/site-config/test-worker', { workerUrl: 'http://127.0.0.1:1/' })).s, 400, 'worker must be https');
    worker.close();
    // templates
    r = await call('GET', '/api/templates?coll=field-notes'); assert.ok(r.j.builtin.some(t => t.name === 'Box writeup') && r.j.builtin.some(t => t.coll === '*'));
    assert.ok(!r.j.builtin.some(t => t.coll === 'library'), 'only this collection and general templates');
    r = await call('POST', '/api/templates', { name: 'My layout', coll: 'field-notes', body: '## A\n\n## B\n' }); assert.strictEqual(r.s, 200);
    const id = r.j.template.id;
    assert.strictEqual((await call('GET', '/api/templates?coll=field-notes')).j.user.length, 1);
    assert.strictEqual((await call('GET', '/api/templates?coll=library')).j.user.length, 0, 'scoped to its collection');
    assert.strictEqual((await call('POST', '/api/templates', { name: '', coll: '*', body: 'x' })).s, 400);
    assert.strictEqual((await call('POST', '/api/templates', { name: 'x', coll: 'nope', body: 'x' })).s, 400);
    assert.strictEqual((await call('DELETE', '/api/templates/' + id)).s, 200);
    assert.strictEqual((await call('DELETE', '/api/templates/../../etc')).s, 404);
    // a second create of the same entry is refused, not written as title-2.md
    const mk = { values: { title: 'Dup Guard Book', author: 'A', isbn: '9780441172719' } };
    const first = await call('POST', '/api/c/library', mk);
    assert.strictEqual(first.s, 201, JSON.stringify(first.j));
    assert.strictEqual((await call('POST', '/api/c/library', mk)).s, 409, 'same title twice');
    assert.strictEqual((await call('POST', '/api/c/library', { values: { title: 'Different', author: 'A', isbn: '978-0-441-17271-9' } })).s, 409, 'same ISBN under another title');
    assert.ok(!fs.existsSync(path.join(process.env.JEKYLL_REPO, '_book-reviews', 'dup-guard-book-2.md')));
    await call('DELETE', '/api/c/library/' + first.j.slug);
    console.log('site tests passed');
  } catch (e) { console.error(e); process.exitCode = 1; }
  srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(process.exitCode || 0);
});

// ---- links to other pages ----
{
  const L = require('../lib/links');
  assert.strictEqual(L.slugify('2026-03-15-Setting_up a Home Lab'), '2026-03-15-setting-up-a-home-lab');
  assert.strictEqual(L.collectionUrl('/tutorials/:name/', 'tutorials', '2026-03-15-setting-up-a-home-lab'), '/tutorials/setting-up-a-home-lab/');
  assert.strictEqual(L.collectionUrl('/writeups/:name/', 'writeups', '10-06-2026-example-writeup'), '/writeups/10-06-2026-example-writeup/');
  assert.strictEqual(L.collectionUrl('/deep-dives/:name/', 'deep-dives', 'Zero Trust'), '/deep-dives/zero-trust/');
  assert.strictEqual(L.collectionUrl(undefined, 'writeups', 'x'), '/writeups/x/');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-'));
  fs.mkdirSync(path.join(d, '_pages'));
  fs.writeFileSync(path.join(d, '_config.yml'), 'collections:\n  writeups:\n    output: true\n    permalink: /writeups/:name/\n  certifications:\n    output: false\n');
  fs.writeFileSync(path.join(d, 'index.markdown'), '---\ntitle: Home page\n---\n');
  fs.writeFileSync(path.join(d, '_pages', 'about.markdown'), '---\ntitle: About\npermalink: /about-me/\n---\n');
  fs.writeFileSync(path.join(d, '_pages', 'resume.md'), '---\ntitle: Resume\n---\n');
  const g = L.listLinkables(d, [{ id: 'field-notes', label: 'Field Notes', config: 'writeups' }, { id: 'emblems', label: 'Emblems', config: 'certifications' }], () => [{ slug: 'Box One', title: 'Box One' }, { slug: 'bad', error: 'x' }]);
  assert.deepStrictEqual(g.map(x => x.id), ['pages', 'field-notes'], 'collections without output have no page to link to');
  assert.deepStrictEqual(g[0].items.map(i => i.url), ['/', '/about-me/', '/resume/']);
  assert.deepStrictEqual(g[1].items, [{ title: 'Box One', url: '/writeups/box-one/' }]);
  console.log('link tests passed');
}
