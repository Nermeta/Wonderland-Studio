/**
 * Find a credential's official page with Claude + the Anthropic web search tool.
 * Needs an API key. Returns { url, issuer, topic, skills[], summary, source, confidence }.
 */
const { normKey, asList, kebab } = require('./tags');

function buildPrompt({ title, issuer, topics, skills }) {
  return `Find the official page for this credential using web search.

Credential: ${title}
Issuer (may be blank): ${issuer || '(unknown)'}

Rules:
- Prefer the issuer's own website (the certification page, or the page where it is verified). Avoid resellers, courses and blog posts.
- Pick a topic from this list if one fits, otherwise a short lowercase word: ${topics.join(', ') || '(none yet)'}
- Give up to 6 skills the credential covers. Reuse the exact spelling from this list when a skill fits: ${skills.slice(0, 120).join(', ') || '(none yet)'}
- If you cannot find an official page, set url to "" and confidence to "low".

Reply with JSON only:
{"url":"https://...","issuer":"...","topic":"...","skills":["..."],"summary":"one sentence","source":"page title","confidence":"high|medium|low"}`;
}

function parseResult(text, { topics = [], skills = [] } = {}) {
  const a = String(text).indexOf('{'), b = String(text).lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error('Claude returned no JSON.');
  const o = JSON.parse(text.slice(a, b + 1));
  let url = '';
  try { const u = new URL(String(o.url || '')); if (u.protocol === 'https:') url = u.toString(); } catch { /* no usable link */ }
  const canonSkill = Object.fromEntries(skills.map(s => [normKey(s), s]));
  const seen = new Set(), outSkills = [];
  for (const s of asList(o.skills)) {
    const k = normKey(s);
    if (!k || seen.has(k) || s.length > 40) continue;
    seen.add(k); outSkills.push(canonSkill[k] || kebab(s));
  }
  const t = String(o.topic || '').trim();
  const topic = topics.find(x => normKey(x) === normKey(t)) || kebab(t);
  return {
    url, issuer: String(o.issuer || '').trim(), topic, skills: outSkills.slice(0, 6),
    summary: String(o.summary || '').slice(0, 240), source: String(o.source || '').slice(0, 120),
    confidence: ['high', 'medium', 'low'].includes(o.confidence) ? o.confidence : 'low'
  };
}

async function findCredential(input, { apiKey, model, fetchImpl = fetch }) {
  if (!apiKey) throw Object.assign(new Error('No Anthropic API key configured. Set ANTHROPIC_API_KEY or "anthropicApiKey" in config.json.'), { status: 400 });
  if (!String(input.title || '').trim()) throw Object.assign(new Error('Enter a title first.'), { status: 400 });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  let res;
  try {
    res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
        messages: [{ role: 'user', content: buildPrompt(input) }]
      })
    });
  } catch (e) {
    throw Object.assign(new Error(e.name === 'AbortError' ? 'The search took too long.' : `Could not reach the Claude API: ${e.message}`), { status: 502 });
  } finally { clearTimeout(timer); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Claude API error${data.error && data.error.message ? ': ' + data.error.message : ` (${res.status})`}`), { status: 502 });
  const text = (data.content || []).filter(p => p.type === 'text').map(p => p.text).join('');
  return parseResult(text, input);
}

module.exports = { findCredential, parseResult, buildPrompt };
