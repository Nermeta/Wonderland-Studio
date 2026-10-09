/** Unit tests for lib/tags.js. No repo needed:  node test/tags.js */
const assert = require('assert');
const T = require('../lib/tags');

const doc = (slug, data, coll = 'explorations') => ({ coll, collLabel: 'Explorations', slug, title: slug, data });
const docs = [
  doc('a', { tags: ['dns', 'python', 'active-directory'] }),
  doc('b', { tags: ['DNS', 'python', 'kerberos'] }),
  doc('c', { tags: ['dns', 'powershell'], tools: ['nmap'] }),
  doc('d', { tags: ['Penetration Testing', 'penetration-testing', 'penetration-testing'] }),
  doc('e', { tags: ['kerberos', 'windows-server'] })
];
const inv = T.buildInventory(docs);

// inventory + duplicates
const dns = inv.tags.tags.find(t => t.tag === 'dns');
assert.strictEqual(dns.count, 2, 'counts entries, not occurrences');
assert.strictEqual(inv.tags.canonical.dns, 'dns', 'most-used spelling is canonical');
assert.strictEqual(inv.tags.canonical.penetrationtesting, 'penetration-testing');
assert.deepStrictEqual(inv.tags.duplicates.map(d => d.canonical).sort(), ['dns', 'penetration-testing']);
assert.strictEqual(inv.tools.tags[0].tag, 'nmap');
const x = T.buildInventory([doc('p', { tags: ['dns'], skills: ['DNS'] })]);
assert.deepStrictEqual(x.tags.tags[0].alsoIn, [{ field: 'skills', tag: 'DNS' }], 'cross-field spelling differences are reported');
assert.strictEqual(x.tags.duplicates.length, 0, '...but are not treated as duplicates');

// tie → lowercase wins
const tie = T.buildInventory([doc('x', { tags: ['VLANs'] }), doc('y', { tags: ['vlans'] })]);
assert.strictEqual(tie.tags.canonical.vlans, 'vlans');

// normalize: only newly added items are touched, and results are de-duplicated
let r = T.normalizeItems(['DNS', 'python', 'Python'], inv.tags.canonical, new Set());
assert.deepStrictEqual(r.items, ['dns', 'python']);
assert.deepStrictEqual(r.changed, [{ from: 'DNS', to: 'dns' }, { from: 'Python', to: 'python' }].filter(c => c.from !== 'Python' || inv.tags.canonical.python !== 'Python'));
r = T.normalizeItems(['DNS', 'kerberos'], inv.tags.canonical, new Set(['DNS']));
assert.deepStrictEqual(r.items, ['DNS', 'kerberos'], 'legacy spelling already on the entry is left alone');
assert.deepStrictEqual(r.changed, []);

// local suggestions
const s = T.suggestLocal({
  title: 'Kerberos delegation attacks', summary: 'How DNS and Active Directory fit together', topic: '',
  body: 'We use PowerShell to query the Windows Server box. PowerShell again.', current: ['python'], lists: { tools: ['nmap', 'BloodHound'] }
}, inv);
const tags = s.map(x => x.tag);
assert.ok(tags.includes('kerberos'), 'title match');
assert.ok(tags.includes('dns'), 'summary match, case-insensitive');
assert.ok(tags.includes('active-directory'), 'hyphenated tag matches spaced phrase');
assert.ok(tags.includes('powershell'), 'body match');
assert.ok(!tags.includes('python'), 'never re-suggests current tags');
assert.ok(s.find(x => x.tag === 'bloodhound').isNew, 'list items become new-tag candidates');
assert.ok(s.find(x => x.tag === 'nmap').reason.includes('tools'));
assert.ok(s.length <= 8);

// Claude: request shape, parsing, spelling normalization (mocked network)
(async () => {
  let seen;
  const fake = async (url, opts) => {
    seen = { url, opts, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Sure!\n```json\n{"tags":[{"tag":"DNS","reason":"dns is discussed"},{"tag":"Zero Trust","reason":"new idea"},{"tag":"python","reason":"already there"},{"tag":"dns","reason":"dupe"}]}\n```' }] }) };
  };
  const out = await T.suggestClaude({ title: 't', body: 'b', current: ['python'] }, inv, { apiKey: 'k', model: 'm', fetchImpl: fake });
  assert.strictEqual(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(seen.opts.headers['x-api-key'], 'k');
  assert.strictEqual(seen.body.model, 'm');
  assert.ok(seen.body.messages[0].content.includes('dns (2)'), 'vocabulary is in the prompt');
  assert.deepStrictEqual(out.map(x => x.tag), ['dns', 'zero-trust'], 'canonical spelling, kebab-case new tags, no current/duplicate tags');
  assert.deepStrictEqual(out.map(x => x.isNew), [false, true]);

  await assert.rejects(() => T.suggestClaude({}, inv, { apiKey: '', model: 'm' }), /No Anthropic API key/);
  await assert.rejects(() => T.suggestClaude({}, inv, { apiKey: 'k', model: 'm', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) }) }), /invalid x-api-key/);
  await assert.rejects(() => T.suggestClaude({}, inv, { apiKey: 'k', model: 'm', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'no json here' }] }) }) }), /no JSON/);
  console.log('tag tests passed');
})().catch(e => { console.error(e); process.exit(1); });

// ISBN lookup (mocked network)
(async () => {
  const { lookupIsbn } = require('../lib/isbn');
  let url;
  const fake = async u => { url = u; return { ok: true, status: 200, json: async () => ({ docs: [
    { title: 'Piranesi', author_name: ['Susanna Clarke'], isbn: ['1635575630', '9781635575637'], first_publish_year: 2020, number_of_pages_median: 272 },
    { title: 'Piranesi', author_name: ['Susanna Clarke'], isbn: ['9781635575637'] },
    { title: 'No isbn', isbn: [] }] }) }; };
  const r = await lookupIsbn({ title: 'Piranesi', author: 'Clarke' }, { fetchImpl: fake });
  assert.ok(url.includes('title=Piranesi') && url.includes('author=Clarke'));
  assert.deepStrictEqual(r.map(x => x.isbn), ['9781635575637'], 'prefers ISBN-13, de-duplicates, drops entries without one');
  assert.strictEqual(r[0].pages, 272);
  const { classify } = require('../lib/isbn');
  assert.deepStrictEqual(classify(['Fantasy fiction', 'Magic', 'Mystery fiction'], { genres: ['fantasy', 'mystery', 'career'], topics: [] }), { genre: ['fiction', 'fantasy', 'mystery'], topic: 'fantasy' });
  assert.deepStrictEqual(classify(['Habit', 'Self-help', 'Productivity'], { genres: ['productivity', 'self-development'], topics: ['productivity'] }), { genre: ['nonfiction', 'productivity'], topic: 'productivity' });
  assert.deepStrictEqual(classify([], { genres: ['x'] }), { genre: [], topic: '' }, 'no subjects, no guess');
  await assert.rejects(() => lookupIsbn({ title: ' ' }, { fetchImpl: fake }), /title first/);
  console.log('isbn tests passed');
})().catch(e => { console.error(e); process.exit(1); });
