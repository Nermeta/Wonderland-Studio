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

// Credential finder (mocked network)
(async () => {
  const { findCredential, parseResult } = require('../lib/credential');
  let body;
  const fake = async (u, o) => { body = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ content: [
    { type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [] },
    { type: 'text', text: 'Found it.\n{"url":"https://www.comptia.org/certifications/security","issuer":"CompTIA","topic":"Security","skills":["Network Security","DNS","zero trust"],"summary":"Entry-level security cert.","source":"CompTIA Security+","confidence":"high"}' }] }) }; };
  const r = await findCredential({ title: 'Security+', issuer: '', topics: ['security', 'cloud'], skills: ['DNS', 'network-security'] }, { apiKey: 'k', model: 'm', fetchImpl: fake });
  assert.strictEqual(body.tools[0].name, 'web_search');
  assert.strictEqual(r.url, 'https://www.comptia.org/certifications/security');
  assert.strictEqual(r.topic, 'security', 'matches existing topic spelling');
  assert.deepStrictEqual(r.skills, ['network-security', 'DNS', 'zero-trust'], 'reuses your spellings');
  assert.strictEqual(parseResult('{"url":"http://insecure.example","skills":[]}').url, '', 'http links are dropped');
  assert.strictEqual(parseResult('{"url":"javascript:alert(1)"}').url, '', 'non-http schemes are dropped');
  await assert.rejects(() => findCredential({ title: '' }, { apiKey: 'k', model: 'm', fetchImpl: fake }), /title first/);
  await assert.rejects(() => findCredential({ title: 'x' }, { apiKey: '', model: 'm' }), /No Anthropic API key/);
  console.log('credential tests passed');
})().catch(e => { console.error(e); process.exit(1); });

// Auto-fill (local rules + mocked Claude)
(async () => {
  const AF = require('../lib/autofill');
  const fields = [['topic', 'combo'], ['difficulty', 'combo', ['easy', 'medium', 'hard', 'insane']], ['platform', 'combo'], ['tools', 'list'], ['summary', 'longtext'], ['estimated_read', 'number'], ['audience', 'list'], ['tags', 'list'], ['category', 'combo']]
    .map(([key, type, options]) => ({ key, type, options }));
  const docs = [
    { __slug: 'a', topic: 'cybersecurity', category: 'active-directory', tags: ['kerberos', 'windows'], tools: ['nmap'], audience: ['tech'] },
    { __slug: 'b', topic: 'cybersecurity', category: 'active-directory', tags: ['kerberos'], tools: ['bloodhound'], audience: ['tech'] },
    { __slug: 'c', topic: 'sysadmin', tags: ['powershell'], audience: ['tech'] }];
  const inventory = T.buildInventory(docs.map(d => ({ coll: 'x', slug: d.__slug, title: d.__slug, data: d })));
  const body = '## Box Info\n\n| | |\n|---|---|\n| Difficulty | Medium |\n\nThis walkthrough covers how nmap finds the open ports. Run nmap again with scripts, then compare the nmap output. ' + 'More words here. '.repeat(120);
  const r = AF.localAutofill({ fields, values: { title: 'HTB: Escape', tags: ['kerberos'] }, body, docs, inventory, titleSlug: '' });
  const got = Object.fromEntries(r.proposals.map(p => [p.key, p.value]));
  assert.strictEqual(got.topic, 'cybersecurity', 'topic from entries sharing tags');
  assert.strictEqual(got.category, 'active-directory');
  assert.strictEqual(got.platform, 'HackTheBox');
  assert.strictEqual(got.difficulty, 'medium', 'difficulty read from the info table');
  assert.deepStrictEqual(got.tools, ['nmap']);
  assert.deepStrictEqual(got.audience, ['tech']);
  assert.ok(got.summary.startsWith('This walkthrough covers') && got.summary.length <= 260);
  assert.ok(got.estimated_read >= 2 && got.estimated_read <= 3, 'reading time ~200 wpm: ' + got.estimated_read);
  const filled = AF.localAutofill({ fields, values: { title: 'x', topic: 'mine', summary: 'mine' }, body, docs, inventory, titleSlug: '' });
  assert.ok(!filled.proposals.some(p => p.key === 'topic' || p.key === 'summary'), 'never proposes for filled fields');
  const bare = AF.localAutofill({ fields, values: { title: 'Notes' }, body: 'short', docs: [], inventory: T.buildInventory([]), titleSlug: '' });
  assert.ok(bare.needsClaude.includes('difficulty'), 'says what needs Claude');
  assert.strictEqual(AF.readingMinutes('too short'), null);

  let sent;
  const fake = async (u, o) => { sent = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"fields":{"difficulty":"Hard","summary":"A deep look.","tools":["Nmap","brand-new"],"estimated_read":"7"},"reasons":{"difficulty":"uses advanced attacks"}}' }] }) }; };
  const c = await AF.claudeAutofill({ collLabel: 'Field Notes', fields, values: { title: 't' }, body: 'b', docs, inventory }, { apiKey: 'k', model: 'm', fetchImpl: fake });
  const cg = Object.fromEntries(c.map(p => [p.key, p.value]));
  assert.ok(sent.messages[0].content.includes('easy | medium | hard | insane'), 'allowed options are in the prompt');
  assert.strictEqual(cg.difficulty, 'hard');
  assert.deepStrictEqual(cg.tools, ['nmap', 'brand-new'], 'reuses your spelling, kebab-cases new values');
  assert.strictEqual(cg.estimated_read, 7);
  const bad = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{"fields":{"difficulty":"impossible"}}' }] }) });
  assert.deepStrictEqual(await AF.claudeAutofill({ collLabel: 'x', fields, values: {}, body: '', docs, inventory }, { apiKey: 'k', model: 'm', fetchImpl: bad }), [], 'values outside the allowed options are dropped');
  console.log('autofill tests passed');
})().catch(e => { console.error(e); process.exit(1); });

// Site preview: a missing Ruby/Bundler is reported with a useful hint
(async () => {
  const Site = require('../lib/site');
  Site.start(process.cwd(), { cmd: 'definitely-not-a-real-command-xyz', args: [] });
  await new Promise(r => setTimeout(r, 400));
  const s = Site.status();
  assert.strictEqual(s.status, 'error');
  assert.ok(/Ruby and Bundler/.test(s.hint), 'explains how to install Ruby');
  Site.stop();
  console.log('site preview tests passed');
})().catch(e => { console.error(e); process.exit(1); });
