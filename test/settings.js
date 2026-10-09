/** Settings API: validation, persistence, and that the API key never leaves the server. */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-settings-'));
process.env.STUDIO_CONFIG = path.join(dir, 'config.json');
process.env.JEKYLL_REPO = dir;
delete process.env.ANTHROPIC_API_KEY; delete process.env.STUDIO_TAG_MODEL; delete process.env.STUDIO_SEARCH_MODEL;
fs.writeFileSync(process.env.STUDIO_CONFIG, JSON.stringify({ repo: './site', somethingElse: 1 }));
const app = require('../server');
const srv = app.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, t: await r.text() }; };
  try {
    let r = await call('GET', '/api/settings'); assert.strictEqual(JSON.parse(r.t).apiKey.set, false);
    const key = 'sk-ant-api03-' + 'k'.repeat(40);
    r = await call('PUT', '/api/settings', { anthropicApiKey: key, branchPrefix: 'edit-', onlineCovers: false, tagModel: 'claude-haiku-5-5' });
    assert.strictEqual(r.s, 200); assert.ok(!r.t.includes('kkkkkkkk'), 'key is never returned');
    const j = JSON.parse(r.t); assert.ok(j.apiKey.set && j.apiKey.tail === 'kkkk' && j.apiKey.source === 'config');
    assert.strictEqual(j.branchPrefix, 'edit-'); assert.strictEqual(j.onlineCovers, false);
    const saved = JSON.parse(fs.readFileSync(process.env.STUDIO_CONFIG, 'utf8'));
    assert.strictEqual(saved.anthropicApiKey, key); assert.strictEqual(saved.somethingElse, 1, 'unknown keys are preserved');
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(process.env.STUDIO_CONFIG).mode & 0o077, 0, 'config file is private');
    assert.ok((await call('GET', '/api/tags')).t.includes('"claude":true'), 'key enables Claude features immediately');
    for (const bad of [{ anthropicApiKey: 'short' }, { previewPort: 80 }, { previewPort: 'abc' }, { branchPrefix: '../x/' }, { tagModel: 'bad model!' }]) {
      assert.strictEqual((await call('PUT', '/api/settings', bad)).s, 400, 'rejects ' + JSON.stringify(bad));
    }
    r = await call('PUT', '/api/settings', { anthropicApiKey: '' });
    assert.strictEqual(JSON.parse(r.t).apiKey.set, false); assert.ok(!('anthropicApiKey' in JSON.parse(fs.readFileSync(process.env.STUDIO_CONFIG, 'utf8'))), 'removing deletes it');
    assert.strictEqual((await call('POST', '/api/settings/test-key', {})).s, 400, 'no key to test');
    console.log('settings tests passed');
  } catch (e) { console.error(e); process.exitCode = 1; }
  srv.close(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(process.exitCode || 0);
});
