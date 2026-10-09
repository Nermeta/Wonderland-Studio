/**
 * Tag vocabulary tools: inventory, near-duplicate detection, canonical
 * spelling, and tag suggestions (local matching or the Claude API).
 */
const TAG_FIELDS = ['tags', 'tech_stack', 'tools', 'genre', 'skills'];

const normKey = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const asList = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(x => String(x).trim()).filter(Boolean);
const isLower = t => t === t.toLowerCase();
const kebab = s => String(s).trim().toLowerCase().replace(/[^a-z0-9+#.]+/g, '-').replace(/^-+|-+$/g, '');

// ---------- inventory ----------
/** docs: [{ coll, collLabel, slug, title, data }] */
function buildInventory(docs) {
  const out = {};
  for (const field of TAG_FIELDS) {
    const byTag = new Map();
    for (const d of docs) {
      for (const t of new Set(asList(d.data[field]))) {
        if (!byTag.has(t)) byTag.set(t, []);
        byTag.get(t).push({ coll: d.coll, collLabel: d.collLabel, slug: d.slug, title: d.title });
      }
    }
    const tags = [...byTag].map(([tag, entries]) => ({ tag, count: entries.length, entries }));

    const groups = new Map();
    for (const t of tags) {
      const k = normKey(t.tag);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const canonical = {}, duplicates = [];
    for (const [k, arr] of groups) {
      // Most used spelling wins; ties prefer all-lowercase, then alphabetical.
      arr.sort((a, b) => b.count - a.count || (isLower(b.tag) - isLower(a.tag)) || a.tag.localeCompare(b.tag));
      canonical[k] = arr[0].tag;
      if (arr.length > 1) duplicates.push({ canonical: arr[0].tag, variants: arr.map(x => ({ tag: x.tag, count: x.count })) });
    }
    tags.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }));
    duplicates.sort((a, b) => a.canonical.localeCompare(b.canonical, undefined, { sensitivity: 'base' }));
    out[field] = { tags, canonical, duplicates };
  }
  // Same word spelled differently in another field (e.g. tag "dns" vs skill "DNS").
  // Fields are separate vocabularies on purpose, so this is informational only.
  for (const field of TAG_FIELDS) {
    for (const t of out[field].tags) {
      const k = normKey(t.tag);
      t.alsoIn = TAG_FIELDS.filter(g => g !== field && out[g].canonical[k] && out[g].canonical[k] !== t.tag)
        .map(g => ({ field: g, tag: out[g].canonical[k] }));
    }
  }
  return out;
}

/** Map newly added items to the existing spelling. Items already on the entry are left alone. */
function normalizeItems(items, canonical, existing = new Set()) {
  const seen = new Set(), out = [], changed = [];
  for (const raw of asList(items)) {
    let t = raw;
    if (!existing.has(raw)) {
      const c = canonical[normKey(raw)];
      if (c && c !== raw) { changed.push({ from: raw, to: c }); t = c; }
    }
    if (!seen.has(t)) { seen.add(t); out.push(t); }
  }
  return { items: out, changed };
}

// ---------- local suggestions ----------
const words = s => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

function countIn(hay, phrase) {
  if (!phrase.trim()) return 0;
  let n = 0, i = 0;
  while ((i = hay.indexOf(phrase, i)) !== -1) { n++; i += phrase.length - 1; }
  return n;
}

/**
 * entry: { title, summary, topic, body, current: [], lists: { tech_stack:[], tools:[], genre:[] } }
 * vocab: inventory.tags.tags  ([{ tag, count }])
 */
function suggestLocal(entry, inventory, limit = 8) {
  const vocab = inventory.tags.tags, canon = inventory.tags.canonical;
  const have = new Set(asList(entry.current).map(normKey));
  const sections = [
    ['title', words(entry.title), 3],
    ['summary', words(entry.summary), 2],
    ['topic', words(entry.topic), 2],
    ['body', words(entry.body), 1]
  ];
  const found = new Map(); // key -> { tag, score, reasons, isNew }

  for (const { tag, count } of vocab) {
    const key = normKey(tag);
    if (!key || have.has(key) || canon[key] !== tag) continue; // variants collapse onto the canonical spelling
    const phrase = words(tag.replace(/[-_/]+/g, ' ')).trim();
    if (phrase.length < 2) continue;
    let score = 0, inHead = false;
    const where = [];
    for (const [name, hay, w] of sections) {
      const n = Math.max(countIn(hay, ` ${phrase} `), countIn(hay, ` ${phrase}s `));
      if (!n) continue;
      const used = name === 'body' ? Math.min(n, 3) : 1;
      score += w * used;
      if (name !== 'body') inHead = true;
      where.push(name === 'body' ? `${n}× in body` : `in ${name}`);
    }
    if (!score) continue;
    score *= 1 + 0.1 * Math.log(1 + count);
    if (score >= 2 || inHead) found.set(key, { tag, score, reason: where.join(', '), isNew: false });
  }

  // Values already chosen for this entry's own lists make natural tags.
  for (const [field, list] of Object.entries(entry.lists || {})) {
    for (const item of asList(list)) {
      const key = normKey(item);
      if (!key || have.has(key)) continue;
      const known = canon[key];
      const cand = { tag: known || kebab(item), score: 2.5, reason: `from ${field.replace('_', ' ')}`, isNew: !known };
      const prev = found.get(key);
      if (!prev || prev.score < cand.score) found.set(key, prev ? { ...cand, reason: `${prev.reason}; ${cand.reason}` } : cand);
    }
  }
  return [...found.values()]
    .sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag))
    .slice(0, limit)
    .map(({ tag, score, reason, isNew }) => ({ tag, score: Math.round(score * 10) / 10, reason, isNew }));
}

// ---------- Claude suggestions ----------
function buildPrompt(entry, inventory) {
  const vocab = inventory.tags.tags.slice(0, 150).map(t => `${t.tag} (${t.count})`).join(', ');
  const body = String(entry.body || '').slice(0, 6000);
  return `You tag entries on a personal cybersecurity and learning portfolio site.

Existing tag vocabulary (tag and number of uses):
${vocab || '(none yet)'}

Entry
Title: ${entry.title || ''}
Topic: ${entry.topic || ''}
Summary: ${entry.summary || ''}
Current tags: ${asList(entry.current).join(', ') || '(none)'}
Body:
${body}

Rules:
- Suggest up to 8 tags that would help a reader find this entry. Do not repeat the current tags.
- Reuse the exact spelling from the vocabulary whenever a tag fits.
- Propose at most 3 new tags, only when nothing in the vocabulary fits. New tags are lowercase kebab-case.
- Give each tag a reason of at most 10 words.
Reply with JSON only: {"tags":[{"tag":"...","reason":"..."}]}`;
}

function parseClaudeJson(text) {
  const a = String(text).indexOf('{'), b = String(text).lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error('Claude returned no JSON.');
  const obj = JSON.parse(text.slice(a, b + 1));
  if (!obj || !Array.isArray(obj.tags)) throw new Error('Claude returned an unexpected shape.');
  return obj.tags;
}

async function suggestClaude(entry, inventory, { apiKey, model, fetchImpl = fetch, limit = 8 }) {
  if (!apiKey) throw Object.assign(new Error('No Anthropic API key configured. Set ANTHROPIC_API_KEY or "anthropicApiKey" in config.json.'), { status: 400 });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  let res;
  try {
    res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 700, messages: [{ role: 'user', content: buildPrompt(entry, inventory) }] })
    });
  } catch (e) {
    throw Object.assign(new Error(e.name === 'AbortError' ? 'Claude took too long to answer.' : `Could not reach the Claude API: ${e.message}`), { status: 502 });
  } finally { clearTimeout(timer); }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Claude API error${data.error && data.error.message ? ': ' + data.error.message : ` (${res.status})`}`), { status: 502 });
  const text = (data.content || []).filter(p => p.type === 'text').map(p => p.text).join('');
  const have = new Set(asList(entry.current).map(normKey));
  const canon = inventory.tags.canonical, seen = new Set(), out = [];
  for (const t of parseClaudeJson(text)) {
    const raw = String(t && t.tag || '').trim();
    const key = normKey(raw);
    if (!raw || raw.length > 40 || !key || have.has(key) || seen.has(key)) continue;
    seen.add(key);
    const known = canon[key];
    out.push({ tag: known || kebab(raw), score: 0, reason: String(t.reason || '').slice(0, 120), isNew: !known });
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { TAG_FIELDS, normKey, asList, kebab, buildInventory, normalizeItems, suggestLocal, suggestClaude, buildPrompt, parseClaudeJson };
