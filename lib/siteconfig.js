/**
 * A few site-wide values that live in plain files: title, email, description, url and
 * github_username in _config.yml, and the Cloudflare worker address in assets/js/chat.js.
 * Only the lines being changed are rewritten; everything else is left byte-for-byte.
 */
const fs = require('fs');
const path = require('path');
const FM = require('./frontmatter');

const CONFIG = repo => path.join(repo, '_config.yml');
const CHAT = repo => path.join(repo, 'assets', 'js', 'chat.js');
const KEYS = ['title', 'email', 'description', 'url', 'github_username'];
const WORKER_RE = /^(\s*const\s+WORKER_URL\s*=\s*)(['"])([^'"\r\n]*)\2(.*)$/;

const readText = p => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const eolOf = s => (s.includes('\r\n') ? '\r\n' : '\n');

function unquote(v) {
  v = v.trim();
  if (v.startsWith('"')) { const m = v.match(/^"((?:[^"\\]|\\.)*)"/); try { return JSON.parse(`"${m ? m[1] : ''}"`); } catch { return v; } }
  if (v.startsWith("'")) { const m = v.match(/^'((?:[^']|'')*)'/); return m ? m[1].replace(/''/g, "'") : v; }
  return v.replace(/\s+#.*$/, '');
}

/** Find a top-level key's lines in _config.yml: [startIndex, endIndexExclusive, value]. */
function locate(lines, key) {
  const re = new RegExp(`^${key}:[ \\t]*(.*)$`);
  const i = lines.findIndex(l => re.test(l));
  if (i === -1) return null;
  const rest = lines[i].match(re)[1];
  if (/^[>|][+-]?\s*$/.test(rest.trim())) {
    let j = i + 1; const body = [];
    while (j < lines.length && (/^[ \t]+\S/.test(lines[j]) || lines[j].trim() === '')) { if (lines[j].trim()) body.push(lines[j].trim()); j++; }
    while (j > i + 1 && lines[j - 1].trim() === '') j--; // keep trailing blank lines out of the block
    return { start: i, end: j, value: body.join(' '), folded: true };
  }
  return { start: i, end: i + 1, value: unquote(rest), folded: false, quoted: /^["']/.test(rest.trim()) };
}

function read(repo) {
  const out = { title: '', email: '', description: '', url: '', github_username: '', workerUrl: '', found: { config: false, chat: false } };
  const cfg = readText(CONFIG(repo));
  if (cfg !== null) {
    out.found.config = true;
    const lines = cfg.split(/\r?\n/);
    for (const k of KEYS) { const l = locate(lines, k); if (l) out[k] = l.value; }
  }
  const chat = readText(CHAT(repo));
  if (chat !== null) {
    const m = chat.split(/\r?\n/).map(l => l.match(WORKER_RE)).find(Boolean);
    if (m) { out.workerUrl = m[3]; out.found.chat = true; }
  }
  return out;
}

const bad = msg => Object.assign(new Error(msg), { status: 400 });

function validate(patch) {
  const clean = {};
  for (const [k, raw] of Object.entries(patch)) {
    if (raw === undefined) continue;
    const v = String(raw).trim();
    if (/[\r\n]/.test(v) && k !== 'description') throw bad(`${k} must be a single line.`);
    if (k === 'url' || k === 'workerUrl') {
      let u; try { u = new URL(v); } catch { throw bad(`${k === 'url' ? 'Site address' : 'Worker address'} must be a full URL like https://example.com.`); }
      if (u.protocol !== 'https:') throw bad(`${k === 'url' ? 'Site address' : 'Worker address'} must start with https://.`);
      if (/['"\s]/.test(v)) throw bad('Addresses cannot contain quotes or spaces.');
      clean[k] = k === 'url' ? v.replace(/\/+$/, '') : v;
    } else if (k === 'email') {
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad('That does not look like an email address.');
      clean[k] = v;
    } else if (k === 'github_username') {
      if (v && !/^[A-Za-z0-9-]{1,39}$/.test(v)) throw bad('GitHub usernames use letters, numbers and - only.');
      clean[k] = v;
    } else if (k === 'title' || k === 'description') {
      if (k === 'title' && !v) throw bad('The site title cannot be empty.');
      clean[k] = v.replace(/\s+/g, ' ');
    }
  }
  return clean;
}

function wrap(text, width = 78) {
  const out = []; let cur = '';
  for (const w of text.split(' ')) { if (cur && (cur + ' ' + w).length > width) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
  if (cur) out.push(cur);
  return out;
}

/** Returns the list of files changed. */
function write(repo, patch) {
  const clean = validate(patch), changed = [];
  const cfgKeys = KEYS.filter(k => k in clean);
  if (cfgKeys.length) {
    const raw = readText(CONFIG(repo));
    if (raw === null) throw bad('The site has no _config.yml.');
    const eol = eolOf(raw), lines = raw.split(/\r?\n/);
    let touched = false;
    for (const k of cfgKeys) {
      const l = locate(lines, k);
      if (!l) throw bad(`_config.yml has no “${k}” line to change.`);
      if (l.value === clean[k]) continue;
      const repl = k === 'description'
        ? ['description: >-', ...wrap(clean[k]).map(x => '  ' + x)]
        : [`${k}: ${l.quoted === false && /^[A-Za-z0-9 _.\/+-]+$/.test(clean[k]) ? clean[k] : FM.scalar(clean[k], true)}`];
      lines.splice(l.start, l.end - l.start, ...repl);
      touched = true;
    }
    if (touched) { fs.writeFileSync(CONFIG(repo), lines.join(eol), 'utf8'); changed.push('_config.yml'); }
  }
  if ('workerUrl' in clean) {
    const raw = readText(CHAT(repo));
    if (raw === null) throw bad('The site has no assets/js/chat.js.');
    const eol = eolOf(raw), lines = raw.split(/\r?\n/);
    const i = lines.findIndex(l => WORKER_RE.test(l));
    if (i === -1) throw bad('Could not find the WORKER_URL line in chat.js.');
    const m = lines[i].match(WORKER_RE);
    if (m[3] !== clean.workerUrl) {
      lines[i] = `${m[1]}${m[2]}${clean.workerUrl}${m[2]}${m[4]}`;
      fs.writeFileSync(CHAT(repo), lines.join(eol), 'utf8'); changed.push('assets/js/chat.js');
    }
  }
  return changed;
}

module.exports = { read, write, validate };
