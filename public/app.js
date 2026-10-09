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
      : clean && !(state.settings && state.settings.onlineCovers === false) ? `https://covers.openlibrary.org/b/isbn/${clean}-M.jpg?default=false` : '';
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
      else v[f.key] = f.default != null ? String(f.default) : '';
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
    const cols = state.schema.collections;
    const wrap = el('div', 'tab-menu');
    const label = state.view === 'edit' && col() ? col().label : 'Content';
    const head = el('button', 'tab' + (state.view === 'edit' ? ' active' : ''), `${esc(label)} <span class="caret">▾</span>`);
    head.type = 'button'; head.setAttribute('aria-haspopup', 'true'); head.setAttribute('aria-expanded', 'false');
    const menu = el('ul', 'menu'); menu.hidden = true; menu.setAttribute('role', 'menu');
    for (const c of cols) {
      const li = el('li', c.id === state.cur && state.view === 'edit' ? 'on' : '', `<span class="g">${esc(c.glyph || '')}</span>${esc(c.label)}`);
      li.setAttribute('role', 'menuitem'); li.tabIndex = 0;
      const go = () => { menu.hidden = true; head.setAttribute('aria-expanded', 'false'); selectCollection(c.id); };
      li.addEventListener('click', go);
      li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      menu.appendChild(li);
    }
    head.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; head.setAttribute('aria-expanded', String(!menu.hidden)); });
    wrap.append(head, menu);
    nav.appendChild(wrap);
    const tb = el('button', 'tab' + (state.view === 'tags' ? ' active' : ''), 'Tags');
    tb.type = 'button';
    tb.addEventListener('click', openTags);
    nav.appendChild(tb);
    const sb = el('button', 'tab' + (state.view === 'settings' ? ' active' : ''), 'Settings');
    sb.type = 'button';
    sb.addEventListener('click', openSettings);
    nav.appendChild(sb);
  }
  document.addEventListener('click', () => { document.querySelectorAll('.tab-menu .menu').forEach(m => { m.hidden = true; }); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.tab-menu .menu').forEach(m => { m.hidden = true; }); });

  async function selectCollection(id) {
    if ((id !== state.cur || state.view !== 'edit') && !guard()) return;
    state.view = 'edit'; $('.workroom').hidden = false; $('#tags-view').hidden = true; $('#settings-view').hidden = true;
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

  /** Options offered under a field: your tag vocabulary (with use counts) or the field's known values. */
  function optionsFor(f) {
    const voc = f.type === 'list' ? vocabFor(f.key) : null;
    if (voc && voc.tags.length) return voc.tags.map(t => ({ value: t.tag, note: `${t.count} use${t.count === 1 ? '' : 's'}` }));
    return (state.meta.suggestions[f.key] || f.options || []).map(o => ({ value: o }));
  }

  /** A themed dropdown that always opens below the field. Replaces the browser's datalist. */
  function attachDropdown(w, input, f, { pick, exclude = () => [], clear = true }) {
    const menu = el('ul', 'dd'); menu.hidden = true; menu.setAttribute('role', 'listbox');
    w.classList.add('has-dd'); w.appendChild(menu);
    let items = [], at = -1;
    const close = () => { menu.hidden = true; at = -1; };
    const mark = () => [...menu.children].forEach((li, i) => li.classList.toggle('on', i === at));
    function open() {
      const q = normKey(input.value), skip = new Set(exclude().map(normKey));
      const all = optionsFor(f).filter(o => !skip.has(normKey(o.value)));
      items = all.filter(o => !q || normKey(o.value).includes(q))
        .sort((x, y) => (normKey(y.value).startsWith(q) - normKey(x.value).startsWith(q))).slice(0, 40);
      menu.innerHTML = '';
      if (!items.length) return close();
      items.forEach((o, i) => {
        const li = el('li', null, `<span>${esc(o.value)}</span>${o.note ? `<small>${esc(o.note)}</small>` : ''}`);
        li.setAttribute('role', 'option');
        li.addEventListener('mousedown', e => { e.preventDefault(); pick(o.value); if (clear) { input.value = ''; open(); } else close(); });
        menu.appendChild(li);
      });
      const anchor = input.closest('.chips') || input;
      menu.style.top = anchor.offsetTop + anchor.offsetHeight + 2 + 'px';
      at = -1; menu.hidden = false;
    }
    input.addEventListener('focus', open);
    input.addEventListener('input', open);
    input.addEventListener('blur', close);
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (menu.hidden) open();
        if (!items.length) return;
        e.preventDefault();
        at = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; mark();
        menu.children[at].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && at >= 0 && !menu.hidden) {
        e.preventDefault(); e.stopImmediatePropagation();
        pick(items[at].value); if (clear) { input.value = ''; open(); } else close();
      }
    });
  }

  function buildText(f) {
    const w = wrapField(f);
    const input = el('input'); input.type = f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text';
    if (f.type === 'number') { if (f.min != null) input.min = f.min; if (f.max != null) input.max = f.max; input.step = f.step || 1; }
    input.value = state.values[f.key] ?? '';
    input.addEventListener('input', () => { state.values[f.key] = input.value; afterChange(f.key); });
    w.appendChild(input);
    if (f.type === 'combo' && optionsFor(f).length) attachDropdown(w, input, f, { clear: false, pick: v => { input.value = v; state.values[f.key] = v; afterChange(f.key); } });
    if (f.key === 'cert_url' && state.cur === 'emblems') w.appendChild(buildCredentialFinder(input));
    if (f.key === 'isbn' && state.cur === 'library') w.appendChild(buildIsbnLookup(w, input));
    return addHint(w, f);
  }

  function buildCredentialFinder(input) {
    const box = el('div', 'suggest');
    const bar = el('div', 'suggest-bar');
    const out = el('div', 'sugg-list');
    const web = el('a', 'btn-mini', 'Search the web ↗'); web.target = '_blank'; web.rel = 'noopener noreferrer';
    web.title = 'Opens a web search in a new tab. Nothing is sent from the Studio.';
    const q = () => [state.values.title, state.values.issuer, 'certification'].filter(Boolean).join(' ');
    web.addEventListener('click', () => { web.href = 'https://duckduckgo.com/?q=' + encodeURIComponent(q()); });
    web.href = 'https://duckduckgo.com/?q=' + encodeURIComponent(q());
    bar.appendChild(web);
    if (state.claude) {
      const ai = el('button', 'btn-mini claude', 'Find with Claude'); ai.type = 'button';
      ai.title = 'Claude searches the web for the official page and suggests the issuer, topic and skills. Uses your API key.';
      ai.addEventListener('click', async () => {
        if (!String(state.values.title || '').trim()) { toast('Enter a title first.', true); return; }
        const label = ai.textContent; ai.disabled = true; ai.textContent = 'Searching…'; out.innerHTML = '';
        try {
          const { result: r } = await api('/api/credential/find', json('POST', { title: state.values.title, issuer: state.values.issuer || '', topics: state.meta.suggestions.topic || [] }));
          const card = el('div', 'find-card');
          card.innerHTML = r.url
            ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.url)}</a><small>${esc(r.source || '')} · ${esc(r.confidence)} confidence</small>`
            : '<small>No official page found. Try the web search.</small>';
          if (r.summary) card.appendChild(el('p', 'small muted', esc(r.summary)));
          const use = el('button', 'btn-mini', 'Use these'); use.type = 'button';
          use.addEventListener('click', () => {
            const setText = (key, val) => {
              if (!val || (key !== 'cert_url' && String(state.values[key] ?? '').trim())) return;
              state.values[key] = val; const inp = document.querySelector(`[data-key="${key}"] input`); if (inp) inp.value = val; afterChange(key);
            };
            setText('cert_url', r.url); setText('issuer', r.issuer); setText('topic', r.topic);
            const sw = document.querySelector('[data-key="skills"]');
            if (sw && sw._add) r.skills.forEach(s => sw._add(s));
            card.remove(); toast('Filled in. Empty fields only; the link is replaced.');
          });
          if (r.url || r.skills.length) card.appendChild(use);
          out.appendChild(card);
        } catch (e) { toast(e.message, true); }
        finally { ai.disabled = false; ai.textContent = label; }
      });
      bar.appendChild(ai);
    }
    box.append(bar, out);
    return box;
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
    attachDropdown(w, input, f, { pick: add, exclude: arr });
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
    if (f.key === 'tags') w.appendChild(buildSuggest(w, 'tags'));
    if (f.key === 'skills' && state.cur === 'emblems') w.appendChild(buildSuggest(w, 'skills'));
    return w;
  }

  function buildSuggest(w, field = 'tags') {
    const wrap = el('div', 'suggest');
    const bar = el('div', 'suggest-bar');
    const list = el('div', 'sugg-list');
    const local = el('button', 'btn-mini', '✦ Suggest tags'); local.type = 'button';
    local.title = `Matches your existing ${field} against this entry. Nothing leaves your machine.`;
    if (field === 'skills') local.textContent = '✦ Suggest skills';
    bar.appendChild(local);
    local.addEventListener('click', () => runSuggest('local', local, list, w, field));
    if (state.claude && field === 'tags') {
      const ai = el('button', 'btn-mini claude', 'Ask Claude'); ai.type = 'button';
      ai.title = "Sends this entry's title, summary and body to the Claude API.";
      ai.addEventListener('click', () => runSuggest('claude', ai, list, w));
      bar.appendChild(ai);
    }
    wrap.append(bar, list);
    return wrap;
  }

  async function runSuggest(mode, btn, listEl, w, field = 'tags') {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = mode === 'claude' ? 'Asking Claude…' : 'Thinking…';
    try {
      const r = await api('/api/tags/suggest', json('POST', { mode, field, values: state.values, body: state.body }));
      listEl.innerHTML = '';
      if (!r.suggestions.length) { listEl.appendChild(el('span', 'hint', (field === 'skills' ? 'None of your existing skills match. Add skills by hand' + (state.claude ? ' or use Find with Claude above.' : '.') : 'No confident matches. Add tags by hand' + (state.claude && mode === 'local' ? ' or try Ask Claude.' : '.')))); return; }
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
      grid.appendChild(buildField(f));
    }
    lay.prepend(grid);
    if (isEmblemBadge()) { lay.appendChild(buildArt()); lay.appendChild(buildDisplayCase()); }

    $('#af-out').innerHTML = ''; $('#af-claude').hidden = !state.claude;
    renderStartFrom();

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
    const up = g.remote && g.remote.ahead ? ` ↑${g.remote.ahead}` : '';
    $('#git-count').textContent = [g.changes.length ? `${g.changes.length} changed` : '', up.trim()].filter(Boolean).join(' · ');
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
    if (!$('#git-newbranch').value) $('#git-newbranch').value = `${state.settings ? state.settings.branchPrefix : 'studio/'}${today()}`;
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
    fillShare();
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
    if (state.view === 'edit' && !guard()) return;
    state.view = 'tags';
    $('.workroom').hidden = true; $('#tags-view').hidden = false; $('#settings-view').hidden = true;
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

  // ---------- writing: Markdown toolbar + focus mode ----------
  const mdBar = $('#md-bar'), ta = $('#f-body');
  function replaceRange(start, end, text, selA, selB) {
    ta.focus(); ta.setSelectionRange(start, end);
    // execCommand keeps the browser's undo history; fall back to a plain edit.
    let ok = false; try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok) { ta.setRangeText(text, start, end, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    ta.setSelectionRange(selA, selB);
  }
  function wrapSel(before, after, placeholder) {
    const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || placeholder;
    if (ta.value.slice(s - before.length, s) === before && ta.value.slice(e, e + after.length) === after && s !== e) {
      replaceRange(s - before.length, e + after.length, sel, s - before.length, s - before.length + sel.length); return; // toggle off
    }
    replaceRange(s, e, before + sel + after, s + before.length, s + before.length + sel.length);
  }
  function lineBlock() {
    const v = ta.value; let s = ta.selectionStart, e = ta.selectionEnd;
    s = v.lastIndexOf('\n', s - 1) + 1; const nl = v.indexOf('\n', e); e = nl === -1 ? v.length : nl;
    return { s, e, lines: v.slice(s, e).split('\n') };
  }
  function prefixLines(make, test) {
    const { s, e, lines } = lineBlock();
    const all = lines.every(l => test(l));
    const out = lines.map((l, i) => all ? l.replace(test.strip, '') : make(l.replace(test.strip, ''), i)).join('\n');
    replaceRange(s, e, out, s, s + out.length);
  }
  const bullet = Object.assign(l => /^\s*[-*+]\s/.test(l), { strip: /^\s*[-*+]\s/ });
  const numbered = Object.assign(l => /^\s*\d+\.\s/.test(l), { strip: /^\s*\d+\.\s/ });
  const quote = Object.assign(l => /^>\s?/.test(l), { strip: /^>\s?/ });
  const heading = n => Object.assign(l => l.startsWith('#'.repeat(n) + ' '), { strip: /^#{1,6}\s+/ });
  const MD = [
    ['B', 'Bold (Ctrl/Cmd+B)', () => wrapSel('**', '**', 'bold text'), 'b'],
    ['I', 'Italic (Ctrl/Cmd+I)', () => wrapSel('*', '*', 'italic text'), 'i'],
    ['H2', 'Heading 2', () => prefixLines(l => '## ' + l, heading(2))],
    ['H3', 'Heading 3', () => prefixLines(l => '### ' + l, heading(3))],
    ['•', 'Bulleted list', () => prefixLines(l => '- ' + l, bullet)],
    ['1.', 'Numbered list', () => prefixLines((l, i) => `${i + 1}. ${l}`, numbered)],
    ['❝', 'Quote', () => prefixLines(l => '> ' + l, quote)],
    ['</>', 'Inline code', () => wrapSel('`', '`', 'code')],
    ['{ }', 'Code block', () => { const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || 'code'; replaceRange(s, e, '```\n' + sel + '\n```', s + 4, s + 4 + sel.length); }],
    ['🔗', 'Link (Ctrl/Cmd+K)', () => { const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || 'link text'; replaceRange(s, e, `[${sel}](url)`, s + sel.length + 3, s + sel.length + 6); }, 'k'],
    ['▦', 'Table', () => { const s = ta.selectionStart; const t = '| Column | Column |\n| --- | --- |\n| Cell | Cell |\n'; replaceRange(s, ta.selectionEnd, t, s + 2, s + 8); }],
    ['—', 'Divider', () => { const s = ta.selectionStart; replaceRange(s, ta.selectionEnd, '\n---\n', s + 5, s + 5); }]
  ];
  for (const [label, title, run] of MD) {
    const b = el('button', 'md-btn', esc(label)); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    b.addEventListener('mousedown', e => e.preventDefault()); // keep the text selection
    b.addEventListener('click', run);
    mdBar.appendChild(b);
  }
  ta.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const hit = MD.find(m => m[3] && m[3] === e.key.toLowerCase());
    if (hit && !e.shiftKey) { e.preventDefault(); hit[2](); }
  });

  const FOCUS_KEY = 'studio.focus';
  function setFocus(on) {
    $('#pane-edit').classList.toggle('focus', on);
    const b = $('#btn-focus'); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '⤡ Show fields' : '⤢ Writing focus';
    try { localStorage.setItem(FOCUS_KEY, on ? '1' : '0'); } catch { /* storage may be unavailable */ }
  }
  $('#btn-focus').addEventListener('click', () => setFocus(!$('#pane-edit').classList.contains('focus')));
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#btn-focus').click(); } });
  try { if (localStorage.getItem(FOCUS_KEY) === '1') setFocus(true); } catch { /* ignore */ }


  // ---------- start from an existing entry ----------
  const SKIP_WHEN_COPYING = ['title', 'date', 'finished_date', 'permalink', 'isbn', 'badge_image', 'cert_url', 'summary'];
  function renderStartFrom() {
    const wrap = $('#start-wrap'), sel = $('#start-from');
    wrap.hidden = !!state.slug || !state.items.length;
    if (wrap.hidden) return;
    sel.innerHTML = '<option value="">Blank</option>' + state.items.filter(i => !i.error)
      .map(i => `<option value="${esc(i.slug)}">${esc(i.title || i.slug)}</option>`).join('');
  }
  async function startFrom(slug) {
    if (!slug) return;
    const hasWork = state.body.trim() || Object.entries(state.values).some(([k, v]) => !SKIP_WHEN_COPYING.includes(k) && (Array.isArray(v) ? v.length : String(v || '').trim()) && k !== 'layout');
    if (hasWork && !confirm('Replace what you have typed so far with a copy of that entry?')) { $('#start-from').value = ''; return; }
    try {
      const d = await api(`/api/c/${state.cur}/${encodeURIComponent(slug)}`);
      const from = fromServer(d.kind, d.values), vals = blankValues(d.kind);
      for (const f of col().kinds[d.kind].fields) if (!f.hidden && !SKIP_WHEN_COPYING.includes(f.key) && f.key in from) vals[f.key] = from[f.key];
      setDoc({ slug: null, kind: d.kind, values: vals, body: d.body, other: d.other });
      autoSlug();
      toast(`Started from “${d.values.title || slug}”. Give it a title and fill in the rest.`);
    } catch (e) { toast(e.message, true); }
  }
  $('#start-from').addEventListener('change', e => startFrom(e.target.value));

  // ---------- Markdown templates ----------
  (function templatesMenu() {
    const bar = $('#md-bar'), host = $('#body-wrap'); host.style.position = 'relative';
    const btn = el('button', 'md-btn md-tpl', 'Templates ▾'); btn.type = 'button'; btn.title = 'Insert a Markdown skeleton, or save this body as a template';
    btn.addEventListener('mousedown', e => e.preventDefault());
    const menu = el('div', 'dd tpl-menu'); menu.hidden = true; host.appendChild(menu);
    bar.appendChild(btn);

    const ta = $('#f-body');
    function insert(t) {
      const text = t.body.replace(/\s+$/, '') + '\n';
      if (!ta.value.trim()) { replaceRange(0, ta.value.length, text, 0, 0); return; }
      const s = ta.selectionStart, before = ta.value.slice(0, s);
      const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
      replaceRange(s, ta.selectionEnd, lead + text, s + lead.length, s + lead.length + text.length);
    }
    async function open() {
      menu.innerHTML = ''; menu.hidden = false;
      menu.style.top = (btn.offsetTop + btn.offsetHeight + 4) + 'px'; menu.style.left = 'auto'; menu.style.right = Math.max(0, host.clientWidth - (btn.offsetLeft + btn.offsetWidth)) + 'px'; menu.style.minWidth = '19rem'; menu.style.maxWidth = 'min(26rem, 96vw)';
      let data;
      try { data = await api('/api/templates?coll=' + encodeURIComponent(state.cur)); } catch (e) { menu.appendChild(el('p', 'hint', esc(e.message))); return; }
      const section = (title, list, deletable) => {
        if (!list.length) return;
        menu.appendChild(el('div', 'tpl-head', esc(title)));
        for (const t of list) {
          const row = el('div', 'tpl-item'); const b = el('button', null, esc(t.name)); b.type = 'button';
          b.addEventListener('click', () => { menu.hidden = true; insert(t); });
          row.appendChild(b);
          if (deletable) {
            const x = el('button', 'tpl-x', '×'); x.type = 'button'; x.title = 'Delete this template'; x.setAttribute('aria-label', 'Delete ' + t.name);
            x.addEventListener('click', async e => { e.stopPropagation(); try { await api('/api/templates/' + encodeURIComponent(t.id), { method: 'DELETE' }); toast('Template deleted.'); open(); } catch (er) { toast(er.message, true); } });
            row.appendChild(x);
          }
          menu.appendChild(row);
        }
      };
      section('Yours', data.user, true);
      section('Built in', data.builtin, false);
      const save = el('div', 'tpl-save');
      save.innerHTML = '<div class="tpl-head">Save this body as a template</div>';
      const name = el('input'); name.type = 'text'; name.placeholder = 'Template name'; name.maxLength = 60;
      const scope = el('select'); scope.innerHTML = `<option value="${esc(state.cur)}">${esc(col().label)} only</option><option value="*">Every collection</option>`;
      const go = el('button', 'btn-mini', 'Save'); go.type = 'button';
      go.addEventListener('click', async () => {
        if (!state.body.trim()) return toast('Write something in the body first.', true);
        try { await api('/api/templates', json('POST', { name: name.value, coll: scope.value, body: state.body })); toast('Template saved.'); open(); }
        catch (e) { toast(e.message, true); }
      });
      const row = el('div', 'tpl-row'); row.append(name, scope, go);
      save.appendChild(row);
      save.appendChild(el('small', 'hint', 'Templates are kept in templates.json in the Studio folder. They fill an empty body, or insert at the cursor.'));
      menu.appendChild(save);
    }
    btn.addEventListener('click', e => { e.stopPropagation(); if (menu.hidden) open(); else menu.hidden = true; });
    document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') menu.hidden = true; });
  })();

  // ---------- auto-fill empty fields ----------
  function applyValue(key, val) {
    const w = document.querySelector(`[data-key="${key}"]`);
    if (!w) return false;
    if (Array.isArray(val)) { if (!w._add) return false; val.forEach(v => w._add(v)); return true; }
    const inp = w.querySelector('textarea, input');
    if (!inp) return false;
    inp.value = val; inp.dispatchEvent(new Event('input', { bubbles: true }));
    const dd = w.querySelector('.dd'); if (dd) dd.hidden = true;
    return true;
  }
  const labelOf = key => { const f = (state.schema.collections.find(c => c.id === state.cur) || {}).kinds; const k = f && (f[state.kind] || Object.values(f)[0]); const fd = k && k.fields.find(x => x.key === key); return fd ? fd.label : key; };
  async function runAutofill(mode, btn) {
    const out = $('#af-out'), label = btn.textContent;
    btn.disabled = true; btn.textContent = mode === 'claude' ? 'Asking Claude…' : 'Working…'; out.innerHTML = '';
    try {
      const r = await api('/api/autofill', json('POST', { coll: state.cur, kind: state.kind, slug: state.slug, mode, values: state.values, body: state.body }));
      if (!r.proposals.length) {
        out.appendChild(el('p', 'hint', 'Nothing more to fill in with confidence.' + ((r.needsClaude || []).length ? ` ${r.needsClaude.map(labelOf).join(' and ')} needs Claude.` : '') + (mode === 'local' && state.claude ? ' Try “Auto-fill with Claude”.' : '')));
        return;
      }
      const list = el('ul', 'af-list');
      for (const p of r.proposals) {
        const li = el('li');
        const shown = Array.isArray(p.value) ? p.value.join(', ') : String(p.value);
        li.innerHTML = `<b>${esc(labelOf(p.key))}</b><span class="af-val">${esc(shown)}</span><small>${esc(p.reason || '')}</small>`;
        const use = el('button', 'btn-mini', 'Use'); use.type = 'button';
        use.addEventListener('click', () => { if (applyValue(p.key, p.value)) { li.remove(); if (!list.children.length) out.innerHTML = ''; } else toast('That field is not on this form.', true); });
        li.appendChild(use); list.appendChild(li);
      }
      const all = el('button', 'btn-mini', 'Use all'); all.type = 'button';
      all.addEventListener('click', () => { r.proposals.forEach(p => applyValue(p.key, p.value)); out.innerHTML = ''; toast('Filled in. Review, then save.'); });
      out.append(list, all);
      if ((r.needsClaude || []).length) out.appendChild(el('p', 'hint', `${r.needsClaude.map(labelOf).join(' and ')} needs Claude to fill in.`));
    } catch (e) { toast(e.message, true); }
    finally { btn.disabled = false; btn.textContent = label; }
  }
  $('#af-local').addEventListener('click', e => runAutofill('local', e.currentTarget));
  $('#af-claude').addEventListener('click', e => runAutofill('claude', e.currentTarget));

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


  // ---------- settings ----------
  async function loadSettings() {
    try { state.settings = await api('/api/settings'); } catch { state.settings = state.settings || null; }
    return state.settings;
  }

  async function openSettings() {
    if (state.view === 'edit' && !guard()) return;
    state.view = 'settings';
    $('.workroom').hidden = true; $('#tags-view').hidden = true; $('#settings-view').hidden = false;
    history.replaceState(null, '', '#settings');
    renderTabs();
    await loadSettings();
    renderSettings();
  }

  function renderSettings() {
    const s = state.settings, root = $('#st-body'); root.innerHTML = '';
    if (!s) { root.appendChild(el('p', 'hint', 'Could not load settings.')); return; }
    const group = (title, note) => { const g = el('section', 'st-group'); g.appendChild(el('h3', null, esc(title))); if (note) g.appendChild(el('p', 'small muted', note)); root.appendChild(g); return g; };
    const row = (g, label, control, help) => {
      const r = el('div', 'st-row'); r.appendChild(el('span', 'st-label', esc(label)));
      const c = el('div', 'st-control'); c.appendChild(control); if (help) c.appendChild(el('small', 'hint', help)); r.appendChild(c); g.appendChild(r); return r;
    };
    const input = (type, value, ph) => { const i = el('input'); i.type = type; i.value = value ?? ''; if (ph) i.placeholder = ph; i.autocomplete = 'off'; i.spellcheck = false; return i; };
    const save = async (patch, msg) => {
      try { state.settings = await api('/api/settings', json('PUT', patch)); toast(msg || 'Saved.'); $('#st-saved').textContent = 'Saved to config.json'; await loadVocab(); renderSettings(); }
      catch (e) { toast(e.message, true); }
    };
    const srcNote = src => src === 'environment' ? ' It is set by an environment variable, which overrides this page.' : '';

    // Claude
    const g1 = group('Claude', 'Optional. Powers “Ask Claude”, “Auto-fill with Claude” and “Find with Claude”. Without a key, everything else still works.');
    const keyIn = input('password', '', s.apiKey.set ? 'Saved. Paste a new key to replace it' : 'sk-ant-…');
    keyIn.setAttribute('data-1p-ignore', ''); keyIn.setAttribute('data-lpignore', 'true');
    const keyBox = el('div', 'st-inline'); keyBox.appendChild(keyIn);
    const saveKey = el('button', 'btn', 'Save key'); saveKey.type = 'button';
    saveKey.addEventListener('click', () => { if (!keyIn.value.trim()) return toast('Paste a key first.', true); save({ anthropicApiKey: keyIn.value.trim() }, 'API key saved.'); });
    const testKey = el('button', 'btn', 'Test'); testKey.type = 'button';
    testKey.addEventListener('click', async () => {
      testKey.disabled = true; testKey.textContent = 'Testing…';
      try { const r = await api('/api/settings/test-key', json('POST', { anthropicApiKey: keyIn.value.trim() })); toast(`Key works. ${r.models.length} models available.`); }
      catch (e) { toast(e.message, true); } finally { testKey.disabled = false; testKey.textContent = 'Test'; }
    });
    keyBox.append(saveKey, testKey);
    if (s.apiKey.source === 'config') { const rm = el('button', 'btn btn-danger', 'Remove'); rm.type = 'button'; rm.addEventListener('click', () => save({ anthropicApiKey: '' }, 'API key removed.')); keyBox.appendChild(rm); }
    row(g1, 'API key', keyBox, s.apiKey.set
      ? `In use: key ending …${s.apiKey.tail} (${s.apiKey.source === 'environment' ? 'from the ANTHROPIC_API_KEY environment variable' : 'saved in config.json'}). It is never shown again or sent to the browser.`
      : 'Not set. A key saved here goes in config.json, which is git-ignored. An ANTHROPIC_API_KEY environment variable is safer on shared computers.');
    const model = (key, label, help) => {
      const i = input('text', s[key].source === 'default' ? '' : s[key].value, s[key].source === 'default' ? s[key].default : s[key].value);
      const b = el('div', 'st-inline'); b.appendChild(i);
      const sv = el('button', 'btn', 'Save'); sv.type = 'button'; sv.addEventListener('click', () => save({ [key]: i.value.trim() }, 'Model saved.'));
      b.appendChild(sv); if (s[key].source === 'environment') i.disabled = sv.disabled = true;
      row(g1, label, b, help + srcNote(s[key].source));
    };
    model('tagModel', 'Model', 'Used for tag suggestions and auto-fill. Blank uses the default.');
    model('searchModel', 'Web-search model', 'Used when finding a credential link. Blank uses the model above.');

    // Writing & lookups
    const g2 = group('Lookups', 'Where the Studio talks to the internet besides Claude.');
    const cov = el('label', 'st-switch'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = s.onlineCovers;
    cb.addEventListener('change', () => save({ onlineCovers: cb.checked }, cb.checked ? 'Online covers on.' : 'Online covers off.'));
    cov.append(cb, el('span', null, 'Show book covers from Open Library'));
    row(g2, 'Covers', cov, 'Your browser loads a cover by ISBN when none is cached in the site folder. Turn off to stay fully offline. ISBN lookup still works when you click it.');

    // Git & preview
    const g3 = group('Git and preview');
    const pre = input('text', s.branchPrefix, 'studio/'); pre.className = 'short';
    const pb = el('div', 'st-inline'); pb.appendChild(pre);
    const psv = el('button', 'btn', 'Save'); psv.type = 'button'; psv.addEventListener('click', () => save({ branchPrefix: pre.value }, 'Branch prefix saved.'));
    pb.appendChild(psv);
    row(g3, 'Branch prefix', pb, 'New branches start as this plus today’s date, for example studio/2026-10-09.');
    const port = input('number', s.previewPort); port.className = 'short'; port.min = 1024; port.max = 65535;
    const ptb = el('div', 'st-inline'); ptb.appendChild(port);
    const ptsv = el('button', 'btn', 'Save'); ptsv.type = 'button'; ptsv.addEventListener('click', () => save({ previewPort: port.value }, 'Preview port saved.'));
    ptb.appendChild(ptsv);
    row(g3, 'Preview port', ptb, 'Where “Preview” serves the site. Applies the next time you start it.');


    // Website (writes to the site's own files)
    const g5 = group('Website', 'These edit files inside your site folder (_config.yml and assets/js/chat.js). They show up as changed files in the git panel, so commit and push them like any other edit.');
    const wsBox = el('div'); g5.appendChild(wsBox);
    wsBox.appendChild(el('p', 'hint', 'Loading…'));
    api('/api/site-config').then(cfg => {
      wsBox.innerHTML = '';
      const fields = [
        ['title', 'Site title', 'text', 'Shown in the browser tab and the header.'],
        ['description', 'Description', 'area', 'The short line search engines and link previews use.'],
        ['url', 'Site address', 'text', 'The public address, such as https://nermeta.github.io.'],
        ['email', 'Contact email', 'text', ''],
        ['github_username', 'GitHub username', 'text', ''],
        ['workerUrl', 'Chat worker address', 'text', 'The Cloudflare Worker behind the AI chat (set in assets/js/chat.js). Only change this if you redeploy the worker somewhere new.']
      ];
      const inputs = {};
      for (const [key, label, kind, help] of fields) {
        const i = kind === 'area' ? el('textarea') : input('text', cfg[key]);
        if (kind === 'area') { i.rows = 3; i.value = cfg[key] || ''; }
        i.autocomplete = 'off'; inputs[key] = i;
        const c = el('div', 'st-inline'); c.appendChild(i);
        if (key === 'workerUrl') {
          const t = el('button', 'btn', 'Test'); t.type = 'button';
          t.addEventListener('click', async () => {
            t.disabled = true; t.textContent = 'Testing…';
            try { const r = await api('/api/site-config/test-worker', json('POST', { workerUrl: i.value.trim() })); toast(`Reachable (HTTP ${r.status}).`); }
            catch (e) { toast(e.message, true); } finally { t.disabled = false; t.textContent = 'Test'; }
          });
          c.appendChild(t);
        }
        row(wsBox, label, c, help);
      }
      const saveWs = el('button', 'btn btn-primary', 'Save website settings'); saveWs.type = 'button';
      saveWs.addEventListener('click', async () => {
        const patch = {}; for (const k of Object.keys(inputs)) if (inputs[k].value.trim() !== String(cfg[k] || '')) patch[k] = inputs[k].value.trim();
        if (!Object.keys(patch).length) return toast('Nothing changed.');
        try { const r = await api('/api/site-config', json('PUT', patch)); toast(`Changed ${r.changed.join(' and ')}. Commit it from the git panel.`); await refreshGit(); renderSettings(); }
        catch (e) { toast(e.message, true); }
      });
      const bar = el('div', 'st-inline'); bar.appendChild(saveWs); wsBox.appendChild(bar);
      if (!cfg.found.config) wsBox.prepend(el('p', 'hint', 'No _config.yml found in the site folder.'));
    }).catch(e => { wsBox.innerHTML = ''; wsBox.appendChild(el('p', 'hint', esc(e.message))); });

    // About
    const g4 = group('About this install');
    const i = s.info;
    const dl = el('dl', 'st-about');
    const add = (k, v) => { dl.appendChild(el('dt', null, esc(k))); dl.appendChild(el('dd', null, `<code>${esc(v)}</code>`)); };
    add('Studio', `v${i.version} on Node ${i.node}`);
    add('Address', `http://localhost:${i.port}${i.host !== '127.0.0.1' ? ` (bound to ${i.host})` : ''}`);
    add('Site folder', i.repo + (i.repoExists ? '' : '  (not found; run npm run setup)'));
    add('Site source', i.siteRemote);
    add('Settings file', i.configFile);
    g4.appendChild(dl);
    const quit = el('button', 'btn btn-danger', 'Quit the Studio'); quit.type = 'button';
    quit.addEventListener('click', async () => {
      if (isDirty() && !confirm('You have unsaved changes. Quit anyway?')) return;
      try { await api('/api/quit', json('POST', {})); } catch { /* the server closes the connection as it exits */ }
      document.body.innerHTML = '<main style="max-width:30rem;margin:20vh auto;text-align:center;font-family:Raleway,system-ui,sans-serif;color:#e8e4d8"><h1 style="font-family:serif;color:#b8914a">Studio stopped</h1><p>You can close this tab. Start it again from your desktop shortcut.</p></main>';
    });
    g4.appendChild(quit);
    g4.appendChild(el('p', 'small muted', 'The site folder and Studio port are set in config.json (or JEKYLL_REPO and PORT) and need a restart to change.'));
  }

  // ---------- share on GitHub ----------
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  let prInfo = null;
  async function fillShare() {
    const g = state.git; if (!g || !g.remote) return;
    const r = g.remote, sync = $('#git-sync'), pr = $('#git-pr');
    const pull = $('#git-pull'), push = $('#git-push');
    pr.hidden = true; pull.hidden = true;
    if (!r.web) { sync.textContent = 'This site folder has no GitHub remote called origin.'; push.disabled = true; return; }
    const notes = [];
    if (g.protected) {
      notes.push(r.behind ? `${g.branch} is ${plural(r.behind, 'commit')} behind GitHub. Pull before you start a new branch.` : `${g.branch} matches GitHub as of your last check. Make a feature branch to start editing.`);
      pull.hidden = !r.behind;
    } else if (!r.onRemote) {
      notes.push('This branch is not on GitHub yet. Commit, then push to share it.');
    } else if (r.ahead) {
      notes.push(`${plural(r.ahead, 'commit')} not pushed yet.`);
    } else {
      notes.push('Everything is pushed.');
      pull.hidden = !r.behind;
    }
    if (!g.protected && r.baseBehind) notes.push(`${r.base} has ${plural(r.baseBehind, 'newer commit')} that this branch does not include yet.`);
    if (!g.protected && g.changes.length) notes.push(`${plural(g.changes.length, 'file')} not committed.`);
    sync.textContent = notes.join(' ');
    push.disabled = g.protected || !!g.changes.length || (r.onRemote && !r.ahead);
    push.textContent = r.onRemote ? 'Push commits' : 'Push branch';
    if (!g.protected && r.onRemote && !r.ahead) {
      const base = r.base || 'main';
      pr.href = `${r.web}/compare/${encodeURIComponent(base)}...${g.branch.split('/').map(encodeURIComponent).join('/')}?expand=1`;
      pr.textContent = 'Open pull request ↗'; pr.hidden = false;
      try {
        prInfo = (await api('/api/git/pr')).pr;
        if (prInfo && state.git === g) { pr.href = prInfo.url; pr.textContent = prInfo.state === 'MERGED' ? 'Pull request merged ↗' : `Review pull request #${prInfo.number} ↗`; }
      } catch { /* the compare link still works */ }
    }
  }
  async function shareAction(btn, path, ok) {
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'Working…';
    try {
      const r = await api(path, json('POST', {}));
      state.git = r.state || r; toast(ok);
      await refreshGit(); fillGitDialog();
    } catch (e) { toast(e.message, true); }
    finally { btn.textContent = label; fillShare(); }
  }
  $('#git-fetch').addEventListener('click', e => shareAction(e.currentTarget, '/api/git/fetch', 'Checked GitHub.'));
  $('#git-pull').addEventListener('click', e => shareAction(e.currentTarget, '/api/git/pull', 'Pulled the latest.'));
  $('#git-push').addEventListener('click', e => shareAction(e.currentTarget, '/api/git/push', 'Pushed. Open the pull request to review it.'));

  // ---------- local site preview ----------
  const sdlg = $('#site-dialog'); let siteTimer = null;
  function paintSite(s) {
    const labels = { stopped: 'Not running.', starting: 'Starting… the first build can take a minute.', ready: 'Running.', error: 'It could not start.' };
    $('#site-status').textContent = labels[s.status] || s.status;
    $('#site-status').className = 'site-status ' + s.status;
    $('#site-dot').hidden = s.status !== 'ready';
    const hint = $('#site-hint'); hint.hidden = !s.hint; hint.textContent = s.hint || '';
    const log = $('#site-log'); log.hidden = !s.log.length; log.textContent = s.log.join('\n'); log.scrollTop = log.scrollHeight;
    const open = $('#site-open'); open.hidden = s.status !== 'ready'; open.href = s.url;
    $('#site-start').hidden = s.status === 'starting' || s.status === 'ready';
    $('#site-stop').hidden = !(s.status === 'starting' || s.status === 'ready');
    if (s.status === 'starting' && sdlg.open) { clearTimeout(siteTimer); siteTimer = setTimeout(pollSite, 1500); }
  }
  async function pollSite() { try { paintSite(await api('/api/site')); } catch { /* server restarting */ } }
  $('#site-chip').addEventListener('click', async () => { await pollSite(); sdlg.showModal(); });
  $('#site-close').addEventListener('click', () => { clearTimeout(siteTimer); sdlg.close(); });
  $('#site-start').addEventListener('click', async () => { try { paintSite(await api('/api/site/start', json('POST', {}))); } catch (e) { toast(e.message, true); } });
  $('#site-stop').addEventListener('click', async () => { try { paintSite(await api('/api/site/stop', json('POST', {}))); } catch (e) { toast(e.message, true); } });
  pollSite();

  window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('#form').requestSubmit(); } });

  // ---------- boot ----------
  (async function init() {
    try {
      state.schema = await api('/api/schema');
      await loadSettings();
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
      if (want === 'settings') await openSettings();
    } catch (e) { toast(e.message, true); }
  })();
})();
