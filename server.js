/**
 * Wonderland Studio — local editor for the Wynter's Wonderland Jekyll site.
 * Binds to 127.0.0.1 only. Writes files directly into the Jekyll repo.
 *
 * Repo location (first match wins):
 *   1. JEKYLL_REPO env var
 *   2. config.json  { "repo": "...", "port": 4747 }
 *   3. ./site (a clone of the website inside this folder; `npm run setup` creates it)
 */
const express = require('express');
const multer = require('multer');
const yaml = require('js-yaml');
const { marked } = require('marked');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const FM = require('./lib/frontmatter');
const { COLLECTIONS } = require('./lib/schemas');
const Tags = require('./lib/tags');

// ---------- config ----------
let fileCfg = {};
try { fileCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')); } catch { /* optional */ }

// Relative paths in config.json resolve against this folder, so "./site" travels with the Studio.
const REPO = process.env.JEKYLL_REPO
  ? path.resolve(process.env.JEKYLL_REPO)
  : path.resolve(__dirname, fileCfg.repo || 'site');
const HOST = process.env.STUDIO_HOST || '127.0.0.1'; // only change inside a container; publish the port to localhost
const PORT = Number(process.env.PORT || fileCfg.port || 4747);
const API_KEY = process.env.ANTHROPIC_API_KEY || fileCfg.anthropicApiKey || '';
const SEARCH_MODEL = process.env.STUDIO_SEARCH_MODEL || fileCfg.searchModel || process.env.STUDIO_TAG_MODEL || fileCfg.tagModel || 'claude-haiku-5-5';
const TAG_MODEL = process.env.STUDIO_TAG_MODEL || fileCfg.tagModel || 'claude-haiku-5-5';
const IMG_DIR = path.join(REPO, 'assets', 'images');
const BADGE_DIR = path.join(IMG_DIR, 'badges');
const COVER_DIR = path.join(IMG_DIR, 'covers');
const TRASH = '.studio-trash'; // dot-folder: Jekyll ignores it
const TRASH_DIR = path.join(REPO, TRASH);
const BADGE_PREFIX_DEFAULT = '/assets/images/badges/';
const PROTECTED_BRANCHES = ['main', 'master'];

// ---------- helpers ----------
const repoExists = () => fs.existsSync(REPO);
const slugOk = s => /^[a-z0-9][a-z0-9._-]*$/i.test(s) && !s.includes('..');
const byId = id => COLLECTIONS.find(c => c.id === id);
const colDir = c => path.join(REPO, c.dir);
const httpErr = (status, message, extra) => Object.assign(new Error(message), { status, extra });

function slugify(s, fallback = 'untitled') {
  return String(s).toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function findFile(c, slug) {
  if (!slugOk(slug)) return null;
  for (const ext of ['.md', '.markdown']) {
    const p = path.join(colDir(c), slug + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function uniqueSlug(c, base) {
  let slug = base, n = 2;
  while (findFile(c, slug)) slug = `${base}-${n++}`;
  return slug;
}

// _config.yml → per-collection defaults (layout, public)
function configDefaults(c) {
  try {
    const cfg = yaml.safeLoad(fs.readFileSync(path.join(REPO, '_config.yml'), 'utf8')) || {};
    const out = {};
    for (const d of cfg.defaults || []) {
      const t = d.scope && d.scope.type;
      if (t === c.config || !d.scope || (!t && !(d.scope.path))) Object.assign(out, d.values || {});
    }
    return out;
  } catch { return {}; }
}

function kindOf(c, data) {
  const name = c.detect ? c.detect(data) : 'default';
  return c.kinds[name] ? name : Object.keys(c.kinds)[0];
}

function readDoc(c, slug) {
  const file = findFile(c, slug);
  if (!file) return null;
  const raw = fs.readFileSync(file, 'utf8');
  const split = FM.splitFile(raw);
  const blocks = FM.parseBlocks(split.fm || '');
  const { data, warnings } = FM.readData(blocks);
  const kind = kindOf(c, data);
  const known = new Set(c.kinds[kind].fields.map(x => x.key));
  const other = {};
  for (const k of Object.keys(data)) if (!known.has(k)) other[k] = data[k];
  return { file, raw, split, blocks, data, warnings, kind, other, body: split.rest.replace(/^\s+|\s+$/g, ''), mtime: fs.statSync(file).mtimeMs };
}

const effectivePublic = (data, dflt) => (data.public != null ? !!data.public : (dflt.public != null ? !!dflt.public : true));

function summarize(c, slug, doc, dflt) {
  const d = doc.data;
  return {
    slug,
    kind: doc.kind,
    title: d.title != null ? String(d.title) : slug,
    date: String(d.date || d.finished_date || d.date_end || d.date_start || '').slice(0, 10),
    status: d.status || d.outcome || '',
    sub: String(d.author || d.institution || d.subject || d.parent || d.topic || d.platform || ''),
    difficulty: d.difficulty || '',
    shape: d.shape || '',
    badge_image: d.badge_image ? String(d.badge_image) : '',
    isbn: d.isbn ? String(d.isbn) : '',
    public: effectivePublic(d, dflt),
    warnings: doc.warnings.length
  };
}

function listDocs(c) {
  const dir = colDir(c);
  if (!fs.existsSync(dir)) return [];
  const dflt = configDefaults(c);
  return fs.readdirSync(dir)
    .filter(f => /\.(md|markdown)$/.test(f))
    .map(f => f.replace(/\.(md|markdown)$/, ''))
    .filter(slugOk)
    .map(slug => {
      try { return summarize(c, slug, readDoc(c, slug), dflt); }
      catch (e) { return { slug, title: slug, kind: 'default', error: e.message, warnings: 1 }; }
    });
}

function listFiles(dir, re) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => re.test(f)).sort() : [];
}

// ---------- validation ----------
function coerce(field, v) {
  switch (field.type) {
    case 'list': return FM.norm(v, field);
    case 'number': return FM.norm(v, field);
    case 'bool': return FM.norm(v, field, field.default);
    default: return FM.norm(v, field);
  }
}

function validateFields(kind, values, { create, orig = {} }) {
  const errs = [], clean = {};
  for (const fd of kind.fields) {
    if (fd.hidden || !(fd.key in values)) continue;
    const v = coerce(fd, values[fd.key]);
    const empty = FM.isEmpty(v) || v === null;
    if (fd.required && empty) { errs.push(`${fd.label} is required.`); continue; }
    if (!empty) {
      if (fd.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errs.push(`${fd.label} must be YYYY-MM-DD.`);
      const untouched = !create && FM.same(v, FM.norm(orig[fd.key], fd, fd.default)); // never block saving over a legacy value you didn't change
      if (fd.type === 'select' && !untouched && !fd.options.includes(v)) errs.push(`${fd.label} must be one of: ${fd.options.join(', ')}.`);
      if (fd.type === 'number') {
        if (!Number.isFinite(v)) errs.push(`${fd.label} must be a number.`);
        else {
          if (fd.integer && !Number.isInteger(v)) errs.push(`${fd.label} must be a whole number.`);
          if (fd.min != null && v < fd.min) errs.push(`${fd.label} must be at least ${fd.min}.`);
          if (fd.max != null && v > fd.max) errs.push(`${fd.label} must be at most ${fd.max}.`);
        }
      }
      if (fd.pattern && !new RegExp(fd.pattern).test(v)) errs.push(`${fd.label} doesn't look right.`);
      if (fd.type === 'ref' && !slugOk(v)) errs.push(`${fd.label} is not a valid slug.`);
      if (typeof v === 'string' && /[\r\n]/.test(v) && fd.type !== 'longtext') errs.push(`${fd.label} must be a single line.`);
    }
    clean[fd.key] = v;
  }
  return { errs, clean };
}

// ---------- tags ----------
function allDocs() {
  const docs = [];
  for (const c of COLLECTIONS) {
    const dir = colDir(c);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => /\.(md|markdown)$/.test(x))) {
      const slug = f.replace(/\.(md|markdown)$/, '');
      if (!slugOk(slug)) continue;
      try {
        const d = readDoc(c, slug);
        docs.push({ coll: c.id, collLabel: c.label, slug, title: d.data.title != null ? String(d.data.title) : slug, data: d.data });
      } catch { /* unreadable file: skip */ }
    }
  }
  return docs;
}
const inventory = () => Tags.buildInventory(allDocs());

/** Newly added tag-like values take the spelling already used elsewhere. */
function normalizeTagFields(kind, clean, orig) {
  const inv = inventory(), notes = [];
  for (const fd of kind.fields) {
    if (fd.type !== 'list' || !Tags.TAG_FIELDS.includes(fd.key) || !Array.isArray(clean[fd.key])) continue;
    const existing = new Set(Tags.asList(orig && orig[fd.key]));
    const r = Tags.normalizeItems(clean[fd.key], inv[fd.key].canonical, existing);
    clean[fd.key] = r.items;
    r.changed.forEach(ch => notes.push({ field: fd.key, ...ch }));
  }
  return notes;
}

// ---------- git ----------
const git = (args) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd: REPO, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
    if (err) return reject(httpErr(400, (stderr || err.message).trim().split('\n').slice(0, 4).join(' ')));
    resolve(stdout);
  });
});

async function gitState() {
  try { await git(['rev-parse', '--is-inside-work-tree']); } catch { return { isRepo: false }; }
  let branch = null;
  try { branch = (await git(['symbolic-ref', '--short', '-q', 'HEAD'])).trim() || null; } catch { /* detached */ }
  const status = await git(['status', '--porcelain=v1', '-z', '-uall']);
  const parts = status.split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2), p = parts[i].slice(3);
    if (code[0] === 'R' || code[0] === 'C') i++; // skip the "from" path of a rename
    if (p.startsWith(TRASH + '/')) continue;
    changes.push({ path: p, code: code.trim() || '?', label: code === '??' ? 'new' : code.includes('D') ? 'deleted' : code.includes('A') ? 'new' : 'modified' });
  }
  const branches = (await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).split('\n').filter(Boolean);
  return { isRepo: true, branch, protected: !branch || PROTECTED_BRANCHES.includes(branch), branches, changes };
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '2mb' }));

// A local tool that writes files and runs git must not be drivable by a random web page.
app.use((req, res, next) => {
  const host = (req.get('host') || '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1'].includes(host)) return res.status(403).json({ error: 'Bad host.' }); // DNS-rebinding guard
  next();
});
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'Cross-origin request blocked.' });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(IMG_DIR, { fallthrough: true })); // /media/badges/x.png ↔ /assets/images/badges/x.png

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const colOr404 = req => { const c = byId(req.params.coll); if (!c) throw httpErr(404, 'Unknown collection.'); return c; };
const needRepo = () => { if (!repoExists()) throw httpErr(400, `Jekyll repo not found at ${REPO}`); };

app.get('/api/schema', (req, res) => {
  res.json({
    repo: REPO,
    repoExists: repoExists(),
    collections: COLLECTIONS.map(c => ({
      id: c.id, label: c.label, singular: c.singular, glyph: c.glyph, dir: c.dir, datePrefix: !!c.datePrefix,
      dirExists: fs.existsSync(colDir(c)),
      defaults: configDefaults(c),
      kinds: Object.fromEntries(Object.entries(c.kinds).map(([k, v]) => [k, { label: v.label, fields: v.fields }]))
    }))
  });
});

app.get('/api/c/:coll', wrap(async (req, res) => {
  const c = colOr404(req);
  const items = listDocs(c);
  // Suggestions for combo / list fields: configured options ∪ values already used.
  const suggestions = {};
  for (const kind of Object.values(c.kinds)) {
    for (const fd of kind.fields) {
      if (!['combo', 'list'].includes(fd.type) || fd.hidden) continue;
      const set = new Set(fd.options || []);
      for (const it of items) {
        if (it.error) continue;
        const doc = readDoc(c, it.slug);
        const v = doc.data[fd.key];
        (Array.isArray(v) ? v : v != null ? [v] : []).forEach(x => x !== '' && set.add(String(x)));
      }
      suggestions[fd.key] = [...set].sort((a, b) => a.localeCompare(b));
    }
  }
  const skills = c.id === 'chronicles' ? items.filter(i => i.kind === 'skill').map(i => i.slug).sort() : [];
  if (c.id === 'chronicles') { suggestions.requires = skills; }
  res.json({
    items,
    suggestions,
    skills,
    badges: c.id === 'emblems' ? listFiles(BADGE_DIR, /\.(png|jpe?g|webp|svg|gif)$/i) : [],
    covers: c.id === 'library' ? listFiles(COVER_DIR, /\.(jpe?g|png|webp)$/i) : [],
    badgePrefix: c.id === 'emblems' ? detectBadgePrefix(items) : null
  });
}));

function detectBadgePrefix(items) {
  for (const it of items) {
    if (it.badge_image) { const i = it.badge_image.lastIndexOf('/'); return i === -1 ? '' : it.badge_image.slice(0, i + 1); }
  }
  return BADGE_PREFIX_DEFAULT;
}

app.get('/api/c/:coll/:slug', wrap(async (req, res) => {
  const c = colOr404(req);
  const doc = readDoc(c, req.params.slug);
  if (!doc) throw httpErr(404, 'Not found.');
  const dflt = configDefaults(c);
  const values = { ...doc.data };
  values.public = effectivePublic(doc.data, dflt);
  res.json({
    slug: req.params.slug, kind: doc.kind, values, body: doc.body, mtime: doc.mtime,
    other: doc.other, warnings: doc.warnings, defaults: dflt,
    file: path.relative(REPO, doc.file).replace(/\\/g, '/')
  });
}));

app.post('/api/c/:coll', wrap(async (req, res) => {
  needRepo();
  const c = colOr404(req);
  const kindName = req.body.kind && c.kinds[req.body.kind] ? req.body.kind : Object.keys(c.kinds)[0];
  const kind = c.kinds[kindName];
  const { errs, clean } = validateFields(kind, req.body.values || {}, { create: true });
  if (errs.length) throw httpErr(400, errs.join(' '));
  const normalized = normalizeTagFields(kind, clean, null);

  const entries = [];
  for (const fd of kind.fields) {
    let v = fd.key in clean ? clean[fd.key] : undefined;
    if (fd.hidden) v = fd.default;
    if (fd.type === 'bool' && v == null) v = fd.default;
    if (FM.isEmpty(v) || v === null || v === undefined) continue;
    entries.push({ key: fd.key, value: v, field: fd });
  }
  fs.mkdirSync(colDir(c), { recursive: true });
  let base = String(req.body.slug || '').trim();
  if (base && !slugOk(base)) throw httpErr(400, 'Filename may only use letters, numbers, dots, dashes and underscores.');
  if (!base) base = slugify(clean.title);
  if (req.body.slug && findFile(c, base)) throw httpErr(409, `A file named ${base} already exists.`);
  const slug = req.body.slug ? base : uniqueSlug(c, base);
  const body = String(req.body.body || '').replace(/\r\n/g, '\n').trim();
  const text = FM.joinFile({ bom: false, eol: '\n', fm: FM.buildNew(entries, kind.order), rest: body ? `\n${body}\n` : '' });
  fs.writeFileSync(path.join(colDir(c), slug + '.md'), text, 'utf8');
  res.status(201).json({ slug, normalized });
}));

app.put('/api/c/:coll/:slug', wrap(async (req, res) => {
  needRepo();
  const c = colOr404(req);
  const doc = readDoc(c, req.params.slug);
  if (!doc) throw httpErr(404, 'Not found.');
  if (req.body.mtime != null && !req.body.force && Math.abs(doc.mtime - Number(req.body.mtime)) > 1) {
    throw httpErr(409, 'This file changed on disk since you opened it.', { conflict: true });
  }
  const kind = c.kinds[doc.kind];
  const dflt = configDefaults(c);
  const { errs, clean } = validateFields(kind, req.body.values || {}, { create: false, orig: doc.data });
  if (errs.length) throw httpErr(400, errs.join(' '));
  const normalized = normalizeTagFields(kind, clean, doc.data);

  // Only keys whose value actually changed are touched.
  const edits = [];
  for (const fd of kind.fields) {
    if (fd.hidden || !(fd.key in clean)) continue;
    const dv = fd.key === 'public' ? (dflt.public != null ? dflt.public : true) : fd.default;
    const before = FM.norm(doc.data[fd.key], fd, dv);
    const after = clean[fd.key];
    if (!FM.same(before, after)) edits.push({ key: fd.key, value: after, field: fd });
  }
  const newBody = String(req.body.body != null ? req.body.body : doc.body).replace(/\r\n/g, '\n').trim();
  const bodyChanged = newBody !== doc.body;

  if (!edits.length && !bodyChanged) return res.json({ slug: req.params.slug, unchanged: true, mtime: doc.mtime, normalized });

  const blocks = FM.applyEdits(doc.blocks, edits, kind.order);
  const next = { ...doc.split, fm: FM.blocksToText(blocks), rest: bodyChanged ? (newBody ? `\n${newBody}\n` : '') : doc.split.rest };
  fs.writeFileSync(doc.file, FM.joinFile(next), 'utf8');
  res.json({ slug: req.params.slug, changed: edits.map(e => e.key).concat(bodyChanged ? ['body'] : []), normalized, mtime: fs.statSync(doc.file).mtimeMs });
}));

// "Delete" moves to .studio-trash so a misclick is recoverable.
app.delete('/api/c/:coll/:slug', wrap(async (req, res) => {
  const c = colOr404(req);
  const file = findFile(c, req.params.slug);
  if (!file) throw httpErr(404, 'Not found.');
  fs.mkdirSync(TRASH_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.renameSync(file, path.join(TRASH_DIR, `${stamp}__${c.dir.replace(/^_/, '')}__${path.basename(file)}`));
  res.json({ ok: true });
}));

// ---------- tags ----------
app.get('/api/tags', wrap(async (req, res) => {
  res.json({ fields: inventory(), fieldNames: Tags.TAG_FIELDS, claude: !!API_KEY });
}));

app.post('/api/tags/suggest', wrap(async (req, res) => {
  const b = req.body || {};
  const v = b.values || {};
  const entry = {
    title: v.title, summary: v.summary, topic: v.topic, body: String(b.body || ''),
    current: b.field === 'skills' ? v.skills : v.tags,
    lists: { tech_stack: v.tech_stack, tools: v.tools, genre: v.genre }
  };
  const inv = inventory();
  if (b.mode === 'claude') {
    res.json({ mode: 'claude', suggestions: await Tags.suggestClaude(entry, inv, { apiKey: API_KEY, model: TAG_MODEL }) });
  } else {
    res.json({ mode: 'local', suggestions: Tags.suggestLocal(entry, inv, 8, b.field === 'skills' ? 'skills' : 'tags') });
  }
}));

// ---------- credential lookup (Claude + web search) ----------
app.post('/api/credential/find', wrap(async (req, res) => {
  const b = req.body || {};
  const inv = inventory();
  const topics = Array.isArray(b.topics) ? b.topics.map(String).slice(0, 100) : [];
  res.json({ result: await require('./lib/credential').findCredential(
    { title: b.title, issuer: b.issuer, topics, skills: inv.skills.tags.map(t => t.tag) },
    { apiKey: API_KEY, model: SEARCH_MODEL }) });
}));

// ---------- ISBN lookup (Open Library) ----------
app.get('/api/isbn', wrap(async (req, res) => {
  res.json({ results: await require('./lib/isbn').lookupIsbn({ title: req.query.title, author: req.query.author, genres: String(req.query.genres || '').split('|').filter(Boolean), topics: String(req.query.topics || '').split('|').filter(Boolean) }) });
}));

// ---------- markdown preview ----------
app.post('/api/render', (req, res) => {
  const md = String(req.body.markdown || '').slice(0, 500000);
  res.json({ html: marked.parse(md, { gfm: true, breaks: false }) });
});

// ---------- badge upload ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { try { fs.mkdirSync(BADGE_DIR, { recursive: true }); cb(null, BADGE_DIR); } catch (e) { cb(e); } },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = slugify(path.basename(file.originalname, ext), 'badge');
      let name = base + ext, n = 2;
      while (fs.existsSync(path.join(BADGE_DIR, name))) name = `${base}-${n++}${ext}`;
      cb(null, name);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(file.mimetype) && /\.(png|jpe?g|webp|svg|gif)$/i.test(file.originalname);
    cb(ok ? null : new Error('Badge must be a PNG, JPG, WebP, GIF or SVG image.'), ok);
  }
});

app.post('/api/badges', (req, res) => {
  if (!repoExists()) return res.status(400).json({ error: `Jekyll repo not found at ${REPO}` });
  upload.single('badge')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    res.status(201).json({ filename: req.file.filename });
  });
});

// ---------- git (branch + commit only; never pushes) ----------
app.get('/api/git', wrap(async (req, res) => { needRepo(); res.json(await gitState()); }));

app.post('/api/git/branch', wrap(async (req, res) => {
  needRepo();
  const name = String(req.body.name || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,80}$/.test(name) || name.includes('..') || name.endsWith('/') || name.endsWith('.lock')) {
    throw httpErr(400, 'Branch names may use letters, numbers, / . _ - only.');
  }
  await git(req.body.create ? ['switch', '-c', name] : ['switch', name]);
  res.json(await gitState());
}));

app.post('/api/git/commit', wrap(async (req, res) => {
  needRepo();
  const st = await gitState();
  if (!st.isRepo) throw httpErr(400, 'The site folder is not a git repository.');
  if (st.protected) throw httpErr(400, `You're on ${st.branch || 'a detached HEAD'}. Create a feature branch before committing.`);
  const message = String(req.body.message || '').trim();
  if (!message || /[\r\n]/.test(message) || message.length > 100) throw httpErr(400, 'Commit message must be one line, up to 100 characters.');
  const paths = Array.isArray(req.body.paths) ? req.body.paths : [];
  const allowed = new Set(st.changes.map(ch => ch.path));
  if (!paths.length || !paths.every(p => allowed.has(p))) throw httpErr(400, 'Pick one or more changed files to commit.');
  const staged = (await git(['diff', '--cached', '--name-only', '-z'])).split('\0').filter(Boolean);
  if (staged.some(p => !paths.includes(p))) throw httpErr(400, 'Other files are already staged in git. Commit or unstage them first.');
  await git(['add', '-A', '--', ...paths]);
  await git(['commit', '-m', message, '--', ...paths]);
  const sha = (await git(['rev-parse', '--short', 'HEAD'])).trim();
  res.json({ sha, state: await gitState() });
}));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error.', ...(err.extra || {}) });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`\n  ♠ Wonderland Studio is open at http://localhost:${PORT}`);
    console.log(`  ♦ Jekyll repo: ${REPO}${repoExists() ? '' : '  (NOT FOUND — set JEKYLL_REPO or config.json)'}\n`);
  });
}
module.exports = app;
