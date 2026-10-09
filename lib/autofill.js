/**
 * "Auto-fill empty fields": derive reasonable values for fields the author left blank.
 * Local mode is deterministic and offline. Claude mode asks the Messages API for the rest.
 */
const Tags = require('./tags');
const { normKey, asList, kebab } = Tags;

const isEmpty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0);

// ---------- text helpers ----------
function splitBody(md) {
  const code = []; 
  const prose = String(md || '').replace(/```[\s\S]*?```/g, m => { code.push(m); return '\n'; });
  return { prose, code: code.join('\n') };
}
const words = s => (String(s).match(/\S+/g) || []).length;

function readingMinutes(md) {
  const { prose, code } = splitBody(md);
  const w = words(prose.replace(/[#>*_`|\-]+/g, ' ')), c = words(code);
  if (w + c < 30) return null;
  return Math.max(1, Math.round(w / 200 + c / 100));
}

const stripMd = s => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();

function firstSummary(md) {
  const { prose } = splitBody(md);
  for (const para of prose.split(/\n\s*\n/)) {
    const lines = para.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length || /^(#|\||>|[-*+]\s|\d+\.\s|---)/.test(lines[0])) continue;
    const text = stripMd(lines.join(' '));
    if (words(text) < 8) continue;
    const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [text];
    let out = '';
    for (const s of sentences) { if (out && (out + s).length > 220) break; out += s; }
    out = out.trim();
    return out.length > 260 ? out.slice(0, 240).replace(/\s+\S*$/, '') + '…' : out;
  }
  return null;
}

// ---------- vocab & neighbours ----------
const vocabOf = (docs, key) => {
  const m = new Map();
  for (const d of docs) for (const v of asList(d[key])) m.set(v, (m.get(v) || 0) + 1);
  return m;
};

/** Most common value of `key` among entries that share tags with this one (weighted by overlap). */
function fromNeighbours(docs, key, tags) {
  const mine = new Set(asList(tags).map(normKey));
  if (!mine.size) return null;
  const score = new Map(); let n = 0;
  for (const d of docs) {
    const val = d[key]; if (isEmpty(val) || Array.isArray(val)) continue;
    const theirs = new Set(asList(d.tags).map(normKey));
    const shared = [...mine].filter(t => theirs.has(t)).length;
    if (!shared) continue;
    n++;
    score.set(String(val), (score.get(String(val)) || 0) + shared / (mine.size + theirs.size - shared));
  }
  const top = [...score].sort((a, b) => b[1] - a[1])[0];
  return top ? { value: top[0], reason: `most common among ${n} entr${n === 1 ? 'y' : 'ies'} sharing tags` } : null;
}

/** A value already used for `key` that appears in the title, tags or summary. */
function fromText(vocab, text) {
  const hay = ` ${String(text).toLowerCase().replace(/[^a-z0-9+#]+/g, ' ')} `;
  let best = null;
  for (const [v, count] of vocab) {
    const p = ` ${String(v).toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').trim()} `;
    if (p.trim().length < 3 || !hay.includes(p)) continue;
    if (!best || count > best.count) best = { value: v, count };
  }
  return best ? { value: best.value, reason: 'named in the title, tags or summary' } : null;
}

// ---------- local rules ----------
const CLAUDE_ONLY = new Set(['difficulty', 'outcome']);

function localAutofill({ fields, values, body, docs, inventory, titleSlug }) {
  const out = [], needsClaude = [];
  const have = k => !isEmpty(values[k]);
  const want = k => fields.some(f => f.key === k) && !have(k);
  const push = (k, value, reason) => { if (!isEmpty(value)) out.push({ key: k, value, reason }); };
  const others = docs.filter(d => d.__slug !== titleSlug);
  const text = [values.title, asList(values.tags).join(' '), values.summary].join(' ');

  if (want('estimated_read')) { const m = readingMinutes(body); if (m) push('estimated_read', m, 'about 200 words a minute, code counted slower'); }
  if (want('summary')) { const s = firstSummary(body); if (s) push('summary', s, 'opening paragraph. Edit it to taste'); }

  for (const key of ['topic', 'category', 'domain']) {
    if (!want(key)) continue;
    const r = fromNeighbours(others, key, values.tags) || fromText(vocabOf(others, key), text);
    if (r) push(key, r.value, r.reason);
  }

  if (want('platform')) {
    const t = String(values.title || '');
    const p = /\bHTB\b|hack ?the ?box/i.test(t) ? 'HackTheBox' : /\bTHM\b|try ?hack ?me/i.test(t) ? 'TryHackMe' : /\bCTF\b/i.test(t) ? 'CTF' : null;
    if (p) push('platform', p, 'from the title');
  }
  if (want('difficulty')) {
    const m = String(body).match(/\|\s*Difficulty\s*\|\s*(easy|medium|hard|insane)\s*\|/i);
    const f = fields.find(x => x.key === 'difficulty');
    if (m && (!f.options || f.options.includes(m[1].toLowerCase()))) push('difficulty', m[1].toLowerCase(), 'from the box info table');
  }
  if (want('subject')) {
    const s = String(values.title || '').replace(/\s*[-—:]?\s*(study|learning)?\s*(log|notes?)$/i, '').trim();
    if (s && s !== values.title) push('subject', s, 'title without “Study Log”');
  }

  for (const key of ['tech_stack', 'tools']) {
    if (!want(key) || !inventory[key]) continue;
    const entry = { title: values.title, summary: values.summary, topic: values.topic, body, current: [], lists: {} };
    const picks = Tags.suggestLocal(entry, inventory, 6, key).filter(s => !s.isNew).map(s => s.tag);
    const known = inventory[key].canonical;
    for (const t of asList(values.tags)) { const c = known[normKey(t)]; if (c && !picks.includes(c)) picks.push(c); }
    if (picks.length) push(key, picks.slice(0, 6), 'your existing values named in the entry or its tags');
  }
  if (want('tags')) {
    const s = Tags.suggestLocal({ title: values.title, summary: values.summary, topic: values.topic, body, current: [], lists: { tech_stack: values.tech_stack, tools: values.tools, genre: values.genre } }, inventory, 5);
    if (s.length) push('tags', s.map(x => x.tag), 'your tags found in the title, summary and body');
  }
  if (want('audience')) {
    const v = vocabOf(others, 'audience'), top = [...v].sort((a, b) => b[1] - a[1])[0];
    if (top) push('audience', [top[0]], 'the most common audience in this collection');
  }

  for (const f of fields) if (!have(f.key) && !out.some(o => o.key === f.key) && CLAUDE_ONLY.has(f.key)) needsClaude.push(f.key);
  return { proposals: out, needsClaude };
}

// ---------- Claude mode ----------
const CLAUDE_KEYS = ['summary', 'topic', 'difficulty', 'tech_stack', 'tools', 'category', 'domain', 'platform', 'outcome', 'audience', 'tags', 'estimated_read', 'subject'];

function buildPrompt({ collLabel, fields, values, body, vocab }) {
  const spec = fields.map(f => `- ${f.key} (${f.type}${f.options ? `, choose one of: ${f.options.join(' | ')}` : ''})${vocab[f.key] ? ` — values already in use: ${vocab[f.key].slice(0, 40).join(', ')}` : ''}`).join('\n');
  return `You are helping fill in blank front-matter fields for an entry on a personal cybersecurity and learning portfolio (section: ${collLabel}).

Known fields:
Title: ${values.title || ''}
Tags: ${asList(values.tags).join(', ')}
Summary: ${values.summary || ''}

Body:
${String(body || '').slice(0, 7000)}

Fill ONLY these blank fields:
${spec}

Rules:
- Reuse the exact spelling of a value already in use whenever it fits; new list values are lowercase kebab-case.
- summary is 1 to 2 sentences in the author's voice. estimated_read is whole minutes. Lists have at most 6 items.
- Skip a field you cannot fill with reasonable confidence.
- Give each field a reason of at most 10 words.
Reply with JSON only: {"fields":{"key":value},"reasons":{"key":"..."}}`;
}

async function claudeAutofill({ collLabel, fields, values, body, docs, inventory }, { apiKey, model, fetchImpl = fetch }) {
  if (!apiKey) throw Object.assign(new Error('No Anthropic API key configured. Set ANTHROPIC_API_KEY or "anthropicApiKey" in config.json.'), { status: 400 });
  const blank = fields.filter(f => isEmpty(values[f.key]) && CLAUDE_KEYS.includes(f.key));
  if (!blank.length) return [];
  const vocab = {};
  for (const f of blank) vocab[f.key] = [...vocabOf(docs, f.key).keys()];
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 40000);
  let res;
  try {
    res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 900, messages: [{ role: 'user', content: buildPrompt({ collLabel, fields: blank, values, body, vocab }) }] })
    });
  } catch (e) {
    throw Object.assign(new Error(e.name === 'AbortError' ? 'Claude took too long to answer.' : `Could not reach the Claude API: ${e.message}`), { status: 502 });
  } finally { clearTimeout(timer); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Claude API error${data.error && data.error.message ? ': ' + data.error.message : ` (${res.status})`}`), { status: 502 });
  const text = (data.content || []).filter(p => p.type === 'text').map(p => p.text).join('');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error('Claude returned no JSON.');
  const obj = JSON.parse(text.slice(a, b + 1));
  const got = obj.fields || {}, why = obj.reasons || {}, out = [];
  for (const f of blank) {
    let v = got[f.key];
    if (isEmpty(v)) continue;
    if (f.type === 'list') {
      const canon = (inventory[f.key] && inventory[f.key].canonical) || {};
      v = [...new Set(asList(v).map(x => canon[normKey(x)] || (Tags.TAG_FIELDS.includes(f.key) ? kebab(x) : String(x).toLowerCase())))].filter(Boolean).slice(0, 6);
    } else if (f.type === 'number') {
      v = Math.round(Number(v)); if (!(v >= 1)) continue;
    } else {
      v = String(v).trim();
      if (f.options && ['difficulty', 'outcome'].includes(f.key) && !f.options.includes(v.toLowerCase())) continue;
      if (f.options && ['difficulty', 'outcome'].includes(f.key)) v = v.toLowerCase();
      const known = [...vocabOf(docs, f.key).keys()].find(x => normKey(x) === normKey(v));
      if (known) v = known;
    }
    if (!isEmpty(v)) out.push({ key: f.key, value: v, reason: String(why[f.key] || '').slice(0, 100) });
  }
  return out;
}

module.exports = { localAutofill, claudeAutofill, readingMinutes, firstSummary, CLAUDE_KEYS };
