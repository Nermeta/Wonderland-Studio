/** ISBN lookup via the Open Library search API (public, no key). */
const isbn13 = s => String(s).replace(/[^0-9X]/gi, '');

function pickIsbn(list) {
  const ids = (Array.isArray(list) ? list : []).map(isbn13);
  return ids.find(i => /^97[89]\d{10}$/.test(i)) || ids.find(i => i.length === 10) || '';
}

async function lookupIsbn({ title, author }, { fetchImpl = fetch, limit = 6 } = {}) {
  title = String(title || '').trim();
  author = String(author || '').trim();
  if (!title) throw Object.assign(new Error('Enter a title first.'), { status: 400 });
  const q = new URLSearchParams({ title, limit: '10', fields: 'title,author_name,isbn,first_publish_year,number_of_pages_median' });
  if (author) q.set('author', author);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  let res;
  try { res = await fetchImpl(`https://openlibrary.org/search.json?${q}`, { signal: ctl.signal, headers: { 'user-agent': 'WonderlandStudio/0.2 (local editor)' } }); }
  catch (e) { throw Object.assign(new Error(e.name === 'AbortError' ? 'Open Library took too long to answer.' : `Could not reach Open Library: ${e.message}`), { status: 502 }); }
  finally { clearTimeout(timer); }
  if (!res.ok) throw Object.assign(new Error(`Open Library error (${res.status})`), { status: 502 });
  const data = await res.json().catch(() => ({}));
  const seen = new Set(), out = [];
  for (const d of data.docs || []) {
    const isbn = pickIsbn(d.isbn);
    if (!isbn || seen.has(isbn)) continue;
    seen.add(isbn);
    out.push({ title: d.title || '', author: (d.author_name || []).slice(0, 2).join(' & '), year: d.first_publish_year || null, pages: d.number_of_pages_median || null, isbn });
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { lookupIsbn, pickIsbn };
