/* Wonderland Studio — schema-driven editor for every Wonderland collection */
(() => {
  const $ = s => document.querySelector(s);
  const SHAPES = ['round', 'shield', 'hex'];

  const state = {
    schema: null, cur: null,
    items: [], meta: { suggestions: {}, skills: [], badges: [], covers: [], badgePrefix: '/assets/images/badges/' },
    slug: null, kind: null, values: {}, body: '', other: {}, warnings: [], mtime: null, file: '',
    newSlug: '', slugTouched: false,
    savedKey: '', pendingFile: null, pendingUrl: null,
    filter: 'all', search: '', pane: 'edit', git: null,
    view: 'edit', vocab: null, claude: false, tv: { field: 'tags', filter: 'all', search: '' }
  };

  // ---------- utils ----------
  const today = () => new Date().toISOString().slice(0, 10);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const base = p => String(p || '').split('/').pop();
  const mediaUrl = p => (p ? String(p).replace(/^\/assets\/images\//, '/media/') : '');
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  /** Show a cover: the local cached file if there is one, else Open Library (what the site build fetches). */
  function paintCover(node, isbn, file, emptyText) {
    const clean = String(isbn || '').replace(/[^0-9Xx]/g, '');
    node.style.backgroundImage = ''; node.textContent = emptyText;
    const url = file ? `/media/covers/${encodeURIComponent(file)}`
      : clean ? `https://covers.openlibrary.org/b/isbn/${clean}-M.jpg?default=false` : '';
    if (!url) return;
    const probe = new Image();
    probe.onload = () => { if (probe.naturalWidth > 1 && node.isConnected) { node.style.backgroundImage = `url("${url}")`; node.textContent = ''; } };
    probe.src = url;
  }
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

  async function api(url, opts = {}) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { data, status: res.status });
    return data;
  }

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), isErr ? 6000 : 3200);
  }

  const col = () => state.schema.collections.find(c => c.id === state.cur);
  const kindDef = () => col().kinds[state.kind];
  const visibleFields = () => kindDef().fields.filter(f => !f.hidden);
  const snapshot = () => JSON.stringify([state.values, state.body, state.newSlug]);
  const isDirty = () => !!state.pendingFile || snapshot() !== state.savedKey;
  const isEmblemBadge = () => state.cur === 'emblems' && state.kind === 'badge';
  const imgSrc = () => state.pendingUrl || mediaUrl(state.values.badge_image);
  const guard = () => !isDirty() || confirm('You have unsaved changes. Discard them?');

  // ---------- values ----------
  function blankValues(kindName) {
    const v = {};
    for (const f of col().kinds[kindName].fields) {
      if (f.hidden) continue;
      if (f.type === 'list') v[f.key] = [];
      else if (f.type === 'bool') v[f.key] = f.default != null ? f.default : false;
      else if (f.type === 'select') v[f.key] = f.options.includes('in-progress') ? 'in-progress' : f.options[0];
      else if (f.key === 'date' && state.cur !== 'emblems') v[f.key] = today();
      else v[f.key] = '';
    }
    return v;
  }

  function fromServer(kindName, raw) {
    const v = blankValues(kindName);
    for (const f of col().kinds[kindName].fields) {
      if (f.hidden || !(f.key in raw)) continue;
      const x = raw[f.key];
      if (f.type === 'list') v[f.key] = (Array.isArray(x) ? x : x == null ? [] : [x]).map(String);
      else if (f.type === 'bool') v[f.key] = !!x;
      else v[f.key] = x == null ? '' : String(x);
    }
    return v;
  }

  // ---------- collections / list ----------
  function renderTabs() {
    const nav = $('#tabs');
    nav.innerHTML = '';
    for (const c of state.schema.collections) {
      const b = el('button', 'tab' + (state.view === 'edit' && c.id === state.cur ? ' active' : ''), esc(c.label));
      b.type = 'button';
      b.addEventListener('click', () => selectCollection(c.id));
      nav.appendChild(b);
    }
    const tb = el('button', 'tab' + (state.view === 'tags' ? ' active' : ''), 'Tags');
    tb.type = 'button';
    tb.addEventListener('click', openTags);
    nav.appendChild(tb);
  }

  async function selectCollection(id) {
    if ((id !== state.cur || state.view === 'tags') && !guard()) return;
    state.view = 'edit'; $('.workroom').hidden = false; $('#tags-view').hidden = true;
    state.cur = id;
    store.set('ws.cur', id);
    history.replaceState(null, '', '#' + id);
    state.filter = 'all'; state.search = ''; $('#search').value = '';
    renderTabs();
    $('#cab-title').textContent = col().label;
    $('#btn-new').textContent = `+ New ${col().singular}`;
    await loadList();
    openNew();
  }

  async function loadVocab() {
    try { const d = await api('/api/tags'); state.vocab = d.fields; state.claude = d.claude; }
    catch { state.vocab = state.vocab || null; }
  }

  async function loadList() {
    await loadVocab();
    const d = await api('/api/c/' + state.cur);
    state.items = d.items;
    state.meta = { suggestions: d.suggestions, skills: d.skills, badges: d.badges, covers: d.covers, badgePrefix: d.badgePrefix || state.meta.badgePrefix };
    renderList();
  }

  function statusClass(v) {
    if (['earned', 'completed', 'complete'].includes(v)) return 'ok';
    if (['in-progress', 'not-started'].includes(v)) return 'wip';
    return '';
  }

  function badgeEl(shape, src, size) {
    const b = el('div', `badge ${shape}` + (src ? ' has-img' : ''));
    if (size) b.style.setProperty('--s', size + 'px');
    const inner = el('div', 'badge-inner', '<span>✦</span>');
    if (src) inner.style.backgroundImage = `url("${src}")`;
    b.appendChild(inner);
    return b;
  }

  function renderList() {
    const items = state.items;
    // filters: All + each status value + Hidden
    const statuses = [...new Set(items.map(i => i.status).filter(Boolean))].sort();
    const hidden = items.filter(i => i.public === false).length;
    const f = $('#filters');
    f.innerHTML = '';
    const chip = (key, label, n) => {
      const b = el('button', 'chip-btn' + (state.filter === key ? ' active' : ''), `${esc(label)} <span>${n}</span>`);
      b.type = 'button';
      b.addEventListener('click', () => { state.filter = key; renderList(); });
      f.appendChild(b);
    };
    chip('all', 'All', items.length);
    if (statuses.length > 1) statuses.forEach(s => chip('s:' + s, s, items.filter(i => i.status === s).length));
    if (hidden) chip('hidden', 'Hidden from AI', hidden);

    const q = state.search.trim().toLowerCase();
    const shown = items
      .filter(i => state.filter === 'all' || (state.filter === 'hidden' ? i.public === false : i.status === state.filter.slice(2)))
      .filter(i => !q || [i.title, i.sub, i.slug].some(x => String(x || '').toLowerCase().includes(q)))
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(a.title).localeCompare(String(b.title)));

    const ul = $('#item-list');
    ul.innerHTML = '';
    if (!shown.length) {
      ul.innerHTML = `<li class="empty">${items.length ? 'Nothing in this drawer.' : `No ${esc(col().label.toLowerCase())} yet. Add the first.`}</li>`;
      return;
    }
    for (const it of shown) {
      const li = el('li', 'item' + (it.slug === state.slug ? ' active' : ''));
      if (state.cur === 'emblems' && it.kind === 'badge') li.appendChild(badgeEl(it.shape || 'round', mediaUrl(it.badge_image)));
      if (state.cur === 'library') {
        const cv = el('div', 'cover-thumb', '❦');
        const file = state.meta.covers.find(c => c.replace(/\.\w+$/, '') === it.isbn);
        paintCover(cv, it.isbn, file, '❦');
        li.appendChild(cv);
      }
      const txt = el('div');
      const pills = [];
      if (it.status) pills.push(`<span class="pill ${statusClass(it.status)}">${esc(it.status)}</span>`);
      if (it.difficulty) pills.push(`<span class="pill">${esc(it.difficulty)}</span>`);
      if (it.public === false) pills.push('<span class="pill warn" title="Excluded from context.json">hidden</span>');
      if (it.warnings) pills.push('<span class="pill warn" title="Front matter needs attention">⚠</span>');
      txt.innerHTML = `<div class="t">${esc(it.title)}</div><div class="m">${pills.join('')}${it.sub ? `<span>${esc(it.sub)}</span>` : ''}${it.date ? `<span>${esc(it.date)}</span>` : ''}</div>`;
      li.appendChild(txt);
      li.addEventListener('click', () => openItem(it.slug));
      ul.appendChild(li);
    }
  }

  // ---------- opening documents ----------
  function clearPending() {
    if (state.pendingUrl) URL.revokeObjectURL(state.pendingUrl);
    state.pendingFile = null; state.pendingUrl = null;
  }

  function setDoc(d) {
    clearPending();
    Object.assign(state, { other: {}, warnings: [], mtime: null, file: '', newSlug: '', slugTouched: false, pane: 'edit' }, d);
    state.savedKey = snapshot();
    renderEditor();
    renderList();
  }

  function openNew(kindName) {
    const kind = kindName || Object.keys(col().kinds)[0];
    setDoc({ slug: null, kind, values: blankValues(kind), body: '' });
    autoSlug();
  }

  async function openItem(slug) {
    if (slug === state.slug && !isDirty()) return;
    if (!guard()) return;
    try {
      const d = await api(`/api/c/${state.cur}/${encodeURIComponent(slug)}`);
      setDoc({ slug, kind: d.kind, values: fromServer(d.kind, d.values), body: d.body, other: d.other, warnings: d.warnings, mtime: d.mtime, file: d.file });
    } catch (e) { toast(e.message, true); }
  }

  function autoSlug() {
    if (state.slug || state.slugTouched) return;
    const c = col();
    const t = slugify(state.values.title || '');
    state.newSlug = t ? (c.datePrefix ? `${state.values.date || today()}-${t}` : t) : '';
    const inp = $('#f-slug');
    if (inp) inp.value = state.newSlug;
  }

  // ---------- field builders ----------
  function afterChange(key) {
    if (key === 'title' || key === 'date') autoSlug();
    refreshChrome();
    if (state.pane === 'preview') schedulePreview();
  }

  function wrapField(f, extraCls) {
    const w = el('div', 'field' + (f.wide ? ' wide' : '') + (extraCls ? ' ' + extraCls : ''));
    w.dataset.key = f.key;
    const label = el('span', null, esc(f.label) + (f.required ? '<b class="req">*</b>' : ''));
    w.appendChild(label);
    return w;
  }
  const addHint = (w, f) => { if (f.hint) w.appendChild(el('small', 'hint', esc(f.hint))); return w; };

  const vocabFor = key => (state.vocab && state.vocab[key] ? state.vocab[key] : null);
  const normKey = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

  function datalistFor(f) {
    const voc = f.type === 'list' ? vocabFor(f.key) : null;
    if (voc && voc.tags.length) {
      const dl = el('datalist'); dl.id = 'dl-' + f.key;
      dl.innerHTML = voc.tags.map(t => `<option value="${esc(t.tag)}" label="${t.count} use${t.count === 1 ? '' : 's'}">`).join('');
      return dl;
    }
    const opts = (state.meta.suggestions[f.key] || f.options || []);
    if (!opts.length) return null;
    const dl = el('datalist'); dl.id = 'dl-' + f.key;
    dl.innerHTML = opts.map(o => `<option value="${esc(o)}">`).join('');
    return dl;
  }

  function buildText(f) {
    const w = wrapField(f);
    const input = el('input'); input.type = f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text';
    if (f.type === 'number') { if (f.min != null) input.min = f.min; if (f.max != null) input.max = f.max; input.step = f.step || 1; }
    if (f.type === 'combo' && (state.meta.suggestions[f.key] || f.options)) input.setAttribute('list', 'dl-' + f.key);
    input.value = state.values[f.key] ?? '';
    input.addEventListener('input', () => { state.values[f.key] = input.value; afterChange(f.key); });
    w.appendChild(input);
    if (f.key === 'isbn' && state.cur === 'library') w.appendChild(buildIsbnLookup(w, input));
    return addHint(w, f);
  }

  function buildIsbnLookup(w, input) {
    const box = el('div', 'suggest');
    const bar = el('div', 'suggest-bar');
    const btn = el('button', 'btn-mini', 'Look up ISBN'); btn.type = 'button';
    btn.title = 'Searches Open Library by this entry’s title and author.';
    const list = el('div', 'sugg-list');
    bar.appendChild(btn); box.append(bar, list);
    const fill = (key, val) => {
      if (val == null || val === '' || String(state.values[key] ?? '').trim()) return;
      state.values[key] = val;
      const inp = document.querySelector(`[data-key="${key}"] input`);
      if (inp) inp.value = val;
      afterChange(key);
    };
    btn.addEventListener('click', async () => {
      const label = btn.textContent; btn.disabled = true; btn.textContent = 'Searching…';
      try {
        const q = new URLSearchParams({ title: state.values.title || '', author: state.values.author || '', genres: (state.meta.suggestions.genre || []).join('|'), topics: (state.meta.suggestions.topic || []).join('|') });
        const r = await api('/api/isbn?' + q);
        list.innerHTML = '';
        if (!r.results.length) { list.appendChild(el('span', 'hint', 'No match. Check the title and author spelling, or type the ISBN by hand.')); return; }
        for (const m of r.results) {
          const b = el('button', 'sugg', `${esc(m.title)}<small>${esc([m.author, m.year, m.pages ? m.pages + ' pp' : '', m.isbn, (m.genre || []).join('/')].filter(Boolean).join(' · '))}</small>`);
          b.type = 'button';
          b.addEventListener('click', () => {
            state.values.isbn = m.isbn; input.value = m.isbn; afterChange('isbn');
            fill('author', m.author); fill('pages', m.pages); fill('topic', m.topic);
            const gw = document.querySelector('[data-key="genre"]');
            if (gw && gw._add && !(state.values.genre || []).length) m.genre.forEach(g => gw._add(g));
            list.innerHTML = ''; toast('ISBN set. Empty author, pages, genre and topic were filled in too.');
          });
          list.appendChild(b);
        }
      } catch (e) { toast(e.message, true); }
      finally { btn.disabled = false; btn.textContent = label; }
    });
    return box;
  }

  function buildLong(f) {
    const w = wrapField(f);
    const ta = el('textarea'); ta.rows = 3; ta.value = state.values[f.key] ?? '';
    ta.addEventListener('input', () => { state.values[f.key] = ta.value; afterChange(f.key); });
    w.appendChild(ta);
    return addHint(w, f);
  }

  function buildSelect(f) {
    const w = wrapField(f);
    const seg = el('div', 'seg');
    for (const o of f.options) {
      const b = el('button', null, esc(o)); b.type = 'button'; b.dataset.v = o;
      b.addEventListener('click', () => { state.values[f.key] = o; paintSeg(); afterChange(f.key); });
      seg.appendChild(b);
    }
    // a legacy value outside the list stays selectable-as-is until changed
    const cur = state.values[f.key];
    if (cur && !f.options.includes(cur)) { const b = el('button', 'on', esc(cur) + ' (existing)'); b.type = 'button'; b.dataset.v = cur; seg.appendChild(b); }
    function paintSeg() {
      seg.querySelectorAll('button').forEach(b => {
        const on = b.dataset.v === state.values[f.key];
        b.classList.toggle('on', on);
        b.classList.toggle('alt', on && ['in-progress', 'not-started'].includes(b.dataset.v));
      });
    }
    paintSeg();
    w.appendChild(seg);
    return addHint(w, f);
  }

  function buildBool(f) {
    const w = wrapField(f);
    w.firstChild.remove();
    const lab = el('label', 'switch');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!state.values[f.key];
    cb.addEventListener('change', () => { state.values[f.key] = cb.checked; afterChange(f.key); });
    lab.append(cb, el('span', 'track'), el('span', 'lbl', `${esc(f.label)}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}`));
    w.appendChild(lab);
    return w;
  }

  function buildRef(f) {
    const w = wrapField(f);
    const sel = el('select');
    const slugs = state.meta.skills.filter(s => s !== state.slug);
    const cur = state.values[f.key];
    const opts = ['', ...slugs, ...(cur && !slugs.includes(cur) ? [cur] : [])];
    sel.innerHTML = opts.map(o => `<option value="${esc(o)}">${o ? esc(o) : '— choose a skill —'}</option>`).join('');
    sel.value = cur || '';
    sel.addEventListener('change', () => { state.values[f.key] = sel.value; afterChange(f.key); });
    w.appendChild(sel);
    return addHint(w, f);
  }

  function buildList(f) {
    const w = wrapField(f);
    const box = el('div', 'chips');
    const input = el('input'); input.type = 'text'; input.placeholder = state.values[f.key].length ? '' : 'add…';
    if ((state.meta.suggestions[f.key] || f.options || []).length || (vocabFor(f.key) && vocabFor(f.key).tags.length)) input.setAttribute('list', 'dl-' + f.key);
    const arr = () => state.values[f.key];
    function draw() {
      box.querySelectorAll('.tag').forEach(t => t.remove());
      arr().forEach((t, i) => {
        const tag = el('span', 'tag', `${esc(t)}`);
        const x = el('button', null, '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remove ' + t);
        x.addEventListener('click', () => { arr().splice(i, 1); draw(); afterChange(f.key); });
        tag.appendChild(x);
        box.insertBefore(tag, input);
      });
      input.placeholder = arr().length ? '' : 'add…';
    }
    function add(raw) {
      let changed = false;
      const notes = [], canon = vocabFor(f.key) && vocabFor(f.key).canonical;
      for (const p0 of String(raw).split(',').map(s => s.trim()).filter(Boolean)) {
        let p = p0;
        const c = canon && canon[normKey(p0)];
        if (c && c !== p0) { notes.push(`${p0} → ${c}`); p = c; }
        if (!arr().includes(p)) { arr().push(p); changed = true; }
      }
      if (notes.length) toast(`Using the existing spelling: ${notes.join(', ')}`);
      if (changed) { draw(); afterChange(f.key); }
    }
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); input.value = ''; }
      else if (e.key === 'Backspace' && !input.value && arr().length) { arr().pop(); draw(); afterChange(f.key); }
    });
    input.addEventListener('input', e => {
      if (input.value.includes(',') || (!e.inputType || e.inputType === 'insertReplacementText')) { add(input.value); input.value = ''; }
    });
    input.addEventListener('blur', () => { if (input.value.trim()) { add(input.value); input.value = ''; } });
    box.addEventListener('click', e => { if (e.target === box) input.focus(); });
    box.appendChild(input);
    draw();
    w.appendChild(box);
    w._add = add;
    addHint(w, f);
    if (f.key === 'tags') w.appendChild(buildSuggest(w));
    return w;
  }

  function buildSuggest(w) {
    const wrap = el('div', 'suggest');
    const bar = el('div', 'suggest-bar');
    const list = el('div', 'sugg-list');
    const local = el('button', 'btn-mini', '✦ Suggest tags'); local.type = 'button';
    local.title = 'Matches your existing tags against this entry. Nothing leaves your machine.';
    bar.appendChild(local);
    local.addEventListener('click', () => runSuggest('local', local, list, w));
    if (state.claude) {
      const ai = el('button', 'btn-mini claude', 'Ask Claude'); ai.type = 'button';
      ai.title = "Sends this entry's title, summary and body to the Claude API.";
      ai.addEventListener('click', () => runSuggest('claude', ai, list, w));
      bar.appendChild(ai);
    }
    wrap.append(bar, list);
    return wrap;
  }

  async function runSuggest(mode, btn, listEl, w) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = mode === 'claude' ? 'Asking Claude…' : 'Thinking…';
    try {
      const r = await api('/api/tags/suggest', json('POST', { mode, values: state.values, body: state.body }));
      listEl.innerHTML = '';
      if (!r.suggestions.length) { listEl.appendChild(el('span', 'hint', 'No confident matches. Add tags by hand' + (state.claude && mode === 'local' ? ' or try Ask Claude.' : '.'))); return; }
      if (mode === 'claude') listEl.appendChild(el('span', 'sugg-note', 'Suggested by Claude. Dashed tags are new to your vocabulary.'));
      for (const s of r.suggestions) {
        const b = el('button', 'sugg' + (s.isNew ? ' new' : ''), `${esc(s.tag)}${s.reason ? `<small>${esc(s.reason)}</small>` : ''}`);
        b.type = 'button'; b.title = (s.isNew ? 'New tag. ' : '') + (s.reason || '');
        b.addEventListener('click', () => { w._add(s.tag); b.remove(); });
        listEl.appendChild(b);
      }
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; btn.textContent = label; }
  }

  function buildField(f) {
    switch (f.type) {
      case 'longtext': return buildLong(f);
      case 'select': return buildSelect(f);
      case 'bool': return buildBool(f);
      case 'ref': return buildRef(f);
      case 'list': return buildList(f);
      default: return buildText(f);
    }
  }

  // ---------- emblem art ----------
  const art = {};
  function buildArt() {
    const wrap = el('div', 'art');

    const f1 = el('div', 'field');
    f1.appendChild(el('span', null, 'Badge art'));
    const drop = el('div', 'drop'); drop.tabIndex = 0;
    drop.innerHTML = '<p><strong>Drop badge art here</strong><br>or click to choose — PNG works best</p><code></code>';
    const file = el('input'); file.type = 'file'; file.hidden = true; file.accept = 'image/png,image/jpeg,image/webp,image/svg+xml,image/gif';
    drop.appendChild(file);
    const existing = el('div', 'existing'); existing.innerHTML = '<small>Or reuse one from the badges folder</small>';
    const strip = el('div', 'strip'); existing.appendChild(strip);
    f1.append(drop, existing);

    const f2 = el('div', 'field');
    f2.appendChild(el('span', null, 'Shape'));
    const picker = el('div', 'shape-picker'); f2.appendChild(picker);

    wrap.append(f1, f2);
    Object.assign(art, { drop, file, strip, existing, picker, dropName: drop.querySelector('code') });

    const setFile = fl => {
      if (!fl) return;
      if (!/^image\//.test(fl.type)) return toast("That doesn't look like an image.", true);
      clearPending();
      state.pendingFile = fl; state.pendingUrl = URL.createObjectURL(fl);
      refreshChrome();
    };
    drop.addEventListener('click', () => file.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    file.addEventListener('change', () => { setFile(file.files[0]); file.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => setFile(e.dataTransfer.files[0]));
    return wrap;
  }

  function buildDisplayCase() {
    const p = el('div', 'preview-pane');
    p.innerHTML = '<span class="pane-label">On the display case</span><div class="preview-big"></div><div class="preview-caption"></div><code class="preview-path"></code>';
    Object.assign(art, { big: p.querySelector('.preview-big'), caption: p.querySelector('.preview-caption'), path: p.querySelector('.preview-path') });
    return p;
  }

  function refreshArt() {
    const v = state.values, src = imgSrc();
    art.dropName.textContent = state.pendingFile ? state.pendingFile.name : (v.badge_image ? base(v.badge_image) : '');
    art.picker.innerHTML = '';
    for (const s of SHAPES) {
      const b = el('button', 'shape-opt' + (v.shape === s ? ' on' : '')); b.type = 'button';
      b.appendChild(badgeEl(s, src)); b.append(s);
      b.addEventListener('click', () => { v.shape = s; refreshChrome(); });
      art.picker.appendChild(b);
    }
    art.big.innerHTML = ''; art.big.appendChild(badgeEl(v.shape, src));
    art.caption.innerHTML = `${esc(v.title || 'Untitled emblem')}<small>${esc(v.topic || 'topic')} · ${esc(v.status)}</small>`;
    art.path.textContent = state.pendingFile ? `${state.meta.badgePrefix}${state.pendingFile.name} (uploads on save)` : (v.badge_image || 'no badge image yet');
    art.existing.hidden = !state.meta.badges.length;
    art.strip.innerHTML = '';
    for (const name of state.meta.badges) {
      const b = el('button', base(v.badge_image) === name && !state.pendingFile ? 'sel' : ''); b.type = 'button'; b.title = name;
      b.appendChild(badgeEl(v.shape, '/media/badges/' + encodeURIComponent(name)));
      b.addEventListener('click', () => { clearPending(); v.badge_image = state.meta.badgePrefix + name; refreshChrome(); });
      art.strip.appendChild(b);
    }
  }

  // ---------- editor ----------
  function renderEditor() {
    const c = col(), k = kindDef(), isNew = !state.slug;
    $('#form-title').textContent = `${isNew ? 'New' : 'Edit'} ${k.label.toLowerCase()}`;
    $('#file-name').textContent = isNew ? '' : state.file;
    $('#btn-delete').hidden = isNew;

    // kind switcher + filename (new files only)
    const kb = $('#kindbar');
    kb.innerHTML = '';
    kb.hidden = !isNew;
    if (isNew) {
      const kinds = Object.entries(c.kinds);
      if (kinds.length > 1) {
        kb.appendChild(el('span', null, 'Kind'));
        const seg = el('div', 'seg');
        for (const [name, def] of kinds) {
          const b = el('button', name === state.kind ? 'on' : '', esc(def.label)); b.type = 'button';
          b.addEventListener('click', () => switchKind(name));
          seg.appendChild(b);
        }
        kb.appendChild(seg);
      }
      const fl = el('label', 'field filename');
      fl.innerHTML = '<span>Filename</span>';
      const slug = el('input'); slug.type = 'text'; slug.id = 'f-slug'; slug.value = state.newSlug; slug.placeholder = 'auto from title';
      slug.addEventListener('input', () => { state.slugTouched = true; state.newSlug = slug.value.trim(); refreshChrome(); });
      fl.append(slug, el('code', 'small muted', '.md'));
      kb.appendChild(fl);
    }

    const warn = $('#warnings');
    warn.hidden = !state.warnings.length;
    warn.innerHTML = state.warnings.length ? `<b>Front matter notes</b><ul>${state.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>Editing a field you see here rewrites just that key.` : '';

    // layout
    const lay = $('#layout');
    lay.innerHTML = '';
    lay.className = 'layout' + (isEmblemBadge() ? ' with-art' : '');
    const grid = el('div', 'fields-grid');
    if (state.cur === 'library') {
      const cf = el('div', 'field wide cover-field');
      cf.innerHTML = '<div class="cover-big" id="cover-big">cover</div><div><span>Cover</span><small class="hint" id="cover-hint"></small></div>';
      grid.appendChild(cf);
    }
    for (const f of visibleFields()) {
      if (f.custom) continue;
      const d = datalistFor(f);
      if (d) lay.appendChild(d);
      grid.appendChild(buildField(f));
    }
    lay.prepend(grid);
    if (isEmblemBadge()) { lay.appendChild(buildArt()); lay.appendChild(buildDisplayCase()); }

    // body
    const hasBody = !(state.cur === 'emblems' && state.kind === 'education');
    $('#body-wrap').hidden = !hasBody;
    $('#body-label').innerHTML = isEmblemBadge() ? 'Notes <em>(optional — certifications have no page of their own)</em>' : 'Body <em>(Markdown)</em>';
    $('#f-body').value = state.body;

    // front matter this editor doesn't manage
    const keys = Object.keys(state.other);
    const oth = $('#other');
    oth.hidden = !keys.length;
    oth.innerHTML = keys.length ? '<b>Other front matter — kept exactly as is</b>' + keys.map(key => {
      let v = JSON.stringify(state.other[key]); if (v.length > 48) v = v.slice(0, 45) + '…';
      return `<code><i>${esc(key)}</i>: ${esc(v)}</code>`;
    }).join('') : '';

    // panes
    const canPreview = state.cur !== 'emblems';
    $('#tab-preview').hidden = !canPreview;
    const d = c.defaults || {};
    $('#layout-note').textContent = state.cur === 'emblems'
      ? 'no page · shown on the Emblems display case'
      : [d.layout ? `layout: ${d.layout}` : '', `public by default: ${d.public != null ? d.public : true}`].filter(Boolean).join(' · ');
    setPane('edit');
    refreshChrome();
  }

  function switchKind(name) {
    const old = state.values;
    state.kind = name;
    state.values = blankValues(name);
    for (const key of Object.keys(state.values)) if (key in old && typeof old[key] === typeof state.values[key]) state.values[key] = old[key];
    renderEditor();
  }

  function refreshChrome() {
    $('#dirty').hidden = !isDirty();
    const dl = document.querySelector('[data-key="date"] > span');
    if (dl && isEmblemBadge()) dl.textContent = state.values.status === 'earned' ? 'Date earned' : 'Target date';
    if (isEmblemBadge()) refreshArt();
    if (state.cur === 'library') {
      const isbn = String(state.values.isbn || '').replace(/[^0-9Xx]/g, '');
      const file = state.meta.covers.find(c => c.replace(/\.\w+$/, '') === isbn);
      const big = $('#cover-big');
      if (big) paintCover(big, isbn, file, 'no cover yet');
      const hint = $('#cover-hint');
      if (hint) hint.textContent = file ? `assets/images/covers/${file}` : (isbn ? `Preview from Open Library. The site build caches it for ${isbn}.` : 'Add an ISBN and the cover is fetched on the next build.');
    }
  }

  // ---------- preview ----------
  function setPane(p) {
    state.pane = p;
    document.querySelectorAll('.pane-tab').forEach(b => b.classList.toggle('on', b.dataset.pane === p));
    $('#pane-edit').hidden = p !== 'edit';
    $('#pane-preview').hidden = p !== 'preview';
    if (p === 'preview') refreshPreview();
  }

  let pvTimer;
  const schedulePreview = () => { clearTimeout(pvTimer); pvTimer = setTimeout(refreshPreview, 350); };

  function previewDoc(v, html) {
    const rating = Math.max(0, Math.min(5, parseInt(v.rating, 10) || 0));
    const dt = v.date && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? new Date(v.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
    const tags = a => (a || []).map(t => `<span class="t">${esc(t)}</span>`).join('');
    const meta = [
      dt && `<span>${esc(dt)}</span>`,
      v.author && `<span>by ${esc(v.author)}</span>`,
      v.difficulty && `<span class="d">${esc(v.difficulty)}</span>`,
      rating && `<span class="stars">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</span>`,
      v.estimated_read && `<span>${esc(v.estimated_read)} min read</span>`,
      v.pages && `<span>${esc(v.pages)} pages</span>`,
      v.platform && `<span>${esc(v.platform)}</span>`,
      v.outcome && `<span class="d">${esc(v.outcome)}</span>`
    ].filter(Boolean).join('');
    const stack = v.tech_stack || v.tools || v.genre;
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;background:#05070f;color:#e8e4d8;font:400 16px/1.7 Raleway,system-ui,sans-serif}
      article{max-width:760px;margin:0 auto;padding:2.2rem 1.5rem 4rem}
      .eyebrow{font:600 .72rem Raleway;letter-spacing:.2em;text-transform:uppercase;color:#b8914a;margin:0}
      h1{font:700 2rem 'Cinzel Decorative',serif;color:#e6c27a;margin:.4rem 0 .5rem;line-height:1.25}
      .sum{font-style:italic;color:#aab0c4;margin:0 0 1rem}
      .meta{display:flex;flex-wrap:wrap;gap:.9rem;font:.78rem 'Share Tech Mono',monospace;color:#8d93a8;align-items:center}
      .meta .d{color:#00e5cc}.stars{color:#e6c27a}
      .row{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.7rem}
      .row .t{font:.72rem 'Share Tech Mono',monospace;padding:.1rem .5rem;border:1px solid rgba(0,229,204,.45);color:#00e5cc;border-radius:3px}
      .row.lore .t{border-color:rgba(224,64,251,.5);color:#e040fb}
      hr{border:0;border-top:1px solid rgba(184,145,74,.3);margin:1.6rem 0}
      h2,h3{font-family:Raleway;color:#e6c27a;margin-top:2rem}h2{font-size:1.35rem}
      a{color:#00e5cc}code{font-family:'Share Tech Mono',monospace;background:rgba(255,255,255,.07);padding:.08rem .35rem;border-radius:3px;font-size:.88em}
      pre{background:#0a1020;border:1px solid rgba(184,145,74,.25);border-radius:4px;padding:1rem;overflow:auto}pre code{background:none;padding:0}
      blockquote{margin:1rem 0;padding:.2rem 1rem;border-left:3px solid #b8914a;color:#aab0c4}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid rgba(184,145,74,.25);padding:.4rem .7rem;text-align:left}
      img{max-width:100%}</style></head><body><article>
      <p class="eyebrow">${esc(v.topic || '')}</p><h1>${esc(v.title || 'Untitled')}</h1>
      ${v.summary ? `<p class="sum">${esc(v.summary)}</p>` : ''}<div class="meta">${meta}</div>
      ${stack && stack.length ? `<div class="row">${tags(stack)}</div>` : ''}${v.tags && v.tags.length ? `<div class="row lore">${tags(v.tags)}</div>` : ''}
      <hr>${html || '<p style="color:#8d93a8"><em>Nothing written yet.</em></p>'}</article><link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&family=Raleway:wght@300;400;600&family=Share+Tech+Mono&display=swap" rel="stylesheet"></body></html>`;
  }

  async function refreshPreview() {
    let html = '';
    try { html = (await api('/api/render', json('POST', { markdown: state.body }))).html; }
    catch (e) { html = `<p>${esc(e.message)}</p>`; }
    $('#preview-frame').srcdoc = previewDoc(state.values, html);
  }

  // ---------- save / revert / delete ----------
  async function save(force) {
    const missing = visibleFields().filter(f => f.required && (f.type === 'list' ? !state.values[f.key].length : !String(state.values[f.key] ?? '').trim()));
    document.querySelectorAll('.field.bad').forEach(x => x.classList.remove('bad'));
    if (missing.length) {
      missing.forEach(f => { const w = document.querySelector(`[data-key="${f.key}"]`); if (w) w.classList.add('bad'); });
      const w = document.querySelector(`[data-key="${missing[0].key}"]`);
      const focusEl = w && w.querySelector('input,select,textarea,button'); if (focusEl) focusEl.focus();
      return toast(`${missing.map(f => f.label).join(', ')} ${missing.length > 1 ? 'are' : 'is'} required.`, true);
    }
    const btn = $('#btn-save'); btn.disabled = true;
    try {
      if (state.pendingFile) {
        const fd = new FormData(); fd.append('badge', state.pendingFile);
        const up = await api('/api/badges', { method: 'POST', body: fd });
        clearPending();
        state.values.badge_image = state.meta.badgePrefix + up.filename;
        if (!state.meta.badges.includes(up.filename)) state.meta.badges.push(up.filename);
      }
      let r;
      if (state.slug) {
        r = await api(`/api/c/${state.cur}/${encodeURIComponent(state.slug)}`, json('PUT', { values: state.values, body: state.body, mtime: state.mtime, force: !!force }));
      } else {
        r = await api(`/api/c/${state.cur}`, json('POST', { kind: state.kind, values: state.values, body: state.body, slug: state.newSlug || undefined }));
      }
      const wasNew = !state.slug;
      await loadList();
      const d = await api(`/api/c/${state.cur}/${encodeURIComponent(r.slug)}`);
      setDoc({ slug: r.slug, kind: d.kind, values: fromServer(d.kind, d.values), body: d.body, other: d.other, warnings: d.warnings, mtime: d.mtime, file: d.file });
      const spelled = (r.normalized || []).map(n => `${n.from} → ${n.to}`);
      toast((r.unchanged ? 'No changes to save.' : wasNew ? `Created ${d.file}` : `Saved ${d.file} — changed: ${r.changed.join(', ')}`) + (spelled.length ? ` · spelling matched: ${spelled.join(', ')}` : ''));
      await refreshGit();
    } catch (e) {
      if (e.status === 409 && e.data && e.data.conflict) {
        if (confirm('This file changed on disk since you opened it (another editor or a git checkout?).\n\nOverwrite it with what you have here?')) { btn.disabled = false; return save(true); }
      } else toast(e.message, true);
    } finally { btn.disabled = false; }
  }

  // ---------- git ----------
  async function refreshGit() {
    try { state.git = await api('/api/git'); } catch { state.git = null; }
    const chip = $('#git-chip');
    const g = state.git;
    chip.hidden = !g || !g.isRepo;
    if (chip.hidden) return;
    $('#git-branch').textContent = g.branch || 'detached HEAD';
    $('#git-count').textContent = g.changes.length ? `${g.changes.length} changed` : '';
    chip.classList.toggle('warn', g.protected);
    chip.title = g.protected ? `On ${g.branch || 'detached HEAD'} — create a feature branch before committing` : 'Branch and commit';
    if (!$('#git-dialog').open) return;
    fillGitDialog();
  }

  function fillGitDialog() {
    const g = state.git; if (!g) return;
    const warn = $('#git-warn');
    warn.hidden = !g.protected;
    warn.textContent = g.protected ? `You're on ${g.branch || 'a detached HEAD'}. Create or switch to a feature branch, then commit.` : '';
    const sel = $('#git-branches');
    sel.innerHTML = g.branches.map(b => `<option${b === g.branch ? ' selected' : ''}>${esc(b)}</option>`).join('');
    if (!$('#git-newbranch').value) $('#git-newbranch').value = `studio/${today()}`;
    const ul = $('#git-files');
    const checked = new Set([...ul.querySelectorAll('input:checked')].map(i => i.value));
    const first = !ul.children.length || ul.querySelector('.none');
    ul.innerHTML = '';
    if (!g.changes.length) ul.innerHTML = '<li class="none">Nothing to commit — the working tree is clean.</li>';
    for (const ch of g.changes) {
      const li = el('li');
      const cb = el('input'); cb.type = 'checkbox'; cb.value = ch.path; cb.checked = first || checked.has(ch.path);
      cb.addEventListener('change', updateCommitBtn);
      li.append(cb, el('span', 'lab ' + ch.label, esc(ch.label)), el('span', null, esc(ch.path)));
      ul.appendChild(li);
    }
    updateCommitBtn();
  }

  function updateCommitBtn() {
    const g = state.git;
    const msg = $('#git-msg').value.trim();
    $('#git-msg-count').textContent = `${msg.length}/100`;
    const picked = $('#git-files').querySelectorAll('input:checked').length;
    $('#git-commit').disabled = !g || g.protected || !msg || !picked;
  }

  async function gitAction(path, body, okMsg) {
    try {
      const r = await api(path, json('POST', body));
      state.git = r.state || r;
      if (okMsg) toast(okMsg(r));
      await refreshGit();
      fillGitDialog();
    } catch (e) { toast(e.message, true); }
  }

  // ---------- tags view ----------
  const TV_NAMES = { tags: 'Tags', tech_stack: 'Tech stack', tools: 'Tools', genre: 'Genre', skills: 'Skills' };

  async function openTags() {
    if (state.view !== 'tags' && !guard()) return;
    state.view = 'tags';
    $('.workroom').hidden = true; $('#tags-view').hidden = false;
    history.replaceState(null, '', '#tags');
    renderTabs();
    await loadVocab();
    renderTagView();
  }

  function renderTagView() {
    const v = state.vocab, tv = state.tv;
    const seg = $('#tv-fields'); seg.innerHTML = '';
    if (!v) { $('#tv-list').innerHTML = '<li class="empty">Could not load tags.</li>'; return; }
    for (const k of Object.keys(TV_NAMES)) {
      const b = el('button', k === tv.field ? 'on' : '', `${esc(TV_NAMES[k])} ${v[k] ? v[k].tags.length : 0}`); b.type = 'button';
      b.addEventListener('click', () => { tv.field = k; tv.filter = 'all'; renderTagView(); });
      seg.appendChild(b);
    }
    const data = v[tv.field];
    const once = data.tags.filter(t => t.count === 1).length;
    const dupKeys = new Set(data.duplicates.flatMap(d => d.variants.map(x => x.tag)));

    const f = $('#tv-filters'); f.innerHTML = '';
    const chip = (key, label, n) => {
      const b = el('button', 'chip-btn' + (tv.filter === key ? ' active' : ''), `${esc(label)} <span>${n}</span>`); b.type = 'button';
      b.addEventListener('click', () => { tv.filter = key; renderTagView(); });
      f.appendChild(b);
    };
    chip('all', 'All', data.tags.length);
    chip('once', 'Used once', once);
    chip('multi', 'Used 2+ times', data.tags.length - once);
    if (dupKeys.size) chip('dups', 'Spelling clashes', dupKeys.size);

    const note = $('#tv-notice');
    note.hidden = !data.duplicates.length;
    note.innerHTML = data.duplicates.length
      ? `<b>${data.duplicates.length} spelling clash${data.duplicates.length > 1 ? 'es' : ''} in ${esc(TV_NAMES[tv.field].toLowerCase())}:</b> ` +
        data.duplicates.map(d => d.variants.map(x => `<code>${esc(x.tag)}</code> (${x.count})`).join(' vs ')).join(' · ') +
        '<br>Open the entries below and keep one spelling. New tags are matched to the most-used spelling automatically.'
      : '';

    const q = tv.search.trim().toLowerCase();
    const max = Math.max(1, ...data.tags.map(t => t.count));
    const rows = data.tags
      .filter(t => tv.filter === 'all' || (tv.filter === 'once' ? t.count === 1 : tv.filter === 'multi' ? t.count > 1 : dupKeys.has(t.tag)))
      .filter(t => !q || t.tag.toLowerCase().includes(q));
    const ul = $('#tv-list'); ul.innerHTML = '';
    if (!rows.length) {
      const li = el('li', 'empty', q ? `No ${esc(TV_NAMES[tv.field].toLowerCase())} match “${esc(tv.search.trim())}”. ` : 'Nothing here.');
      if (q) {
        const clr = el('button', 'linkish', 'Clear search'); clr.type = 'button';
        clr.addEventListener('click', () => { tv.search = ''; $('#tv-search').value = ''; renderTagView(); });
        li.appendChild(clr);
      }
      ul.appendChild(li);
      return;
    }
    for (const t of rows) {
      const li = el('li');
      const also = (t.alsoIn || []).map(a => `also “${esc(a.tag)}” in ${esc(TV_NAMES[a.field].toLowerCase())}`).join(' · ');
      li.innerHTML = `<details><summary><span class="tg${dupKeys.has(t.tag) ? ' dup-tag' : ''}">${esc(t.tag)}${also ? `<small>${also}</small>` : ''}</span>` +
        `<span class="bar"><i style="width:${Math.max(4, Math.round((t.count / max) * 100))}%"></i></span><span class="ct">${t.count}</span></summary><ul class="ents"></ul></details>`;
      const ents = li.querySelector('.ents');
      for (const e of t.entries) {
        const b = el('button', null, `<span>${esc(e.collLabel)}</span>${esc(e.title)}`); b.type = 'button';
        b.addEventListener('click', async () => { await selectCollection(e.coll); await openItem(e.slug); });
        const eli = el('li'); eli.appendChild(b); ents.appendChild(eli);
      }
      ul.appendChild(li);
    }
  }

  $('#tv-search').addEventListener('input', e => { state.tv.search = e.target.value; renderTagView(); });

  // ---------- wiring ----------
  $('#form').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'submit') e.preventDefault(); });
  $('#form').addEventListener('submit', e => { e.preventDefault(); save(false); });
  $('#f-body').addEventListener('input', e => { state.body = e.target.value; refreshChrome(); if (state.pane === 'preview') schedulePreview(); });
  document.querySelectorAll('.pane-tab').forEach(b => b.addEventListener('click', () => setPane(b.dataset.pane)));
  $('#search').addEventListener('input', e => { state.search = e.target.value; renderList(); });

  $('#btn-new').addEventListener('click', () => { if (guard()) { openNew(); const t = document.querySelector('[data-key="title"] input'); if (t) t.focus(); } });
  $('#btn-revert').addEventListener('click', () => {
    if (!isDirty()) return;
    if (state.slug) { const s = state.slug; state.slug = null; openItem(s); } else openNew(state.kind);
  });

  const dlg = $('#confirm');
  $('#btn-delete').addEventListener('click', () => { $('#confirm-text').textContent = `Remove “${state.values.title || state.slug}” from the cabinet?`; dlg.showModal(); });
  $('#confirm-no').addEventListener('click', () => dlg.close());
  $('#confirm-yes').addEventListener('click', async () => {
    dlg.close();
    try {
      await api(`/api/c/${state.cur}/${encodeURIComponent(state.slug)}`, { method: 'DELETE' });
      toast('Removed — recoverable from .studio-trash/');
      await loadList(); openNew(); refreshGit();
    } catch (e) { toast(e.message, true); }
  });

  const gdlg = $('#git-dialog');
  $('#git-chip').addEventListener('click', async () => { await refreshGit(); gdlg.showModal(); fillGitDialog(); });
  $('#git-close').addEventListener('click', () => gdlg.close());
  $('#git-msg').addEventListener('input', updateCommitBtn);
  $('#git-all').addEventListener('click', () => { $('#git-files').querySelectorAll('input').forEach(i => (i.checked = true)); updateCommitBtn(); });
  $('#git-none').addEventListener('click', () => { $('#git-files').querySelectorAll('input').forEach(i => (i.checked = false)); updateCommitBtn(); });
  $('#git-switch').addEventListener('click', () => gitAction('/api/git/branch', { name: $('#git-branches').value, create: false }, r => `Switched to ${(r.state || r).branch}`));
  $('#git-create').addEventListener('click', () => gitAction('/api/git/branch', { name: $('#git-newbranch').value.trim(), create: true }, r => `Created ${(r.state || r).branch}`));
  $('#git-commit').addEventListener('click', async () => {
    const paths = [...$('#git-files').querySelectorAll('input:checked')].map(i => i.value);
    await gitAction('/api/git/commit', { message: $('#git-msg').value.trim(), paths }, r => `Committed ${r.sha}`);
    $('#git-msg').value = ''; updateCommitBtn();
  });

  window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#form').requestSubmit(); } });

  // ---------- boot ----------
  (async function init() {
    try {
      state.schema = await api('/api/schema');
      if (!state.schema.repoExists) {
        const b = $('#banner'); b.hidden = false;
        b.innerHTML = `The Jekyll repo wasn't found at <code>${esc(state.schema.repo)}</code>. Set <code>JEKYLL_REPO</code> or copy <code>config.example.json</code> to <code>config.json</code>, then restart.`;
      }
      const ids = state.schema.collections.map(c => c.id);
      const want = location.hash.slice(1);
      state.cur = ids.includes(want) ? want : ids.includes(store.get('ws.cur')) ? store.get('ws.cur') : ids[0];
      renderTabs();
      $('#cab-title').textContent = col().label;
      $('#btn-new').textContent = `+ New ${col().singular}`;
      await loadList();
      openNew();
      refreshGit();
      if (want === 'tags') await openTags();
    } catch (e) { toast(e.message, true); }
  })();
})();
