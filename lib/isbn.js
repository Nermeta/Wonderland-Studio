/** ISBN lookup via the Open Library search API (public, no key). */
const isbn13 = s => String(s).replace(/[^0-9X]/gi, '');

function pickIsbn(list) {
  const ids = (Array.isArray(list) ? list : []).map(isbn13);
  return ids.find(i => /^97[89]\d{10}$/.test(i)) || ids.find(i => i.length === 10) || '';
}

async function lookupIsbn({ title, author, genres = [], topics = [] }, { fetchImpl = fetch, limit = 6 } = {}) {
  title = String(title || '').trim();
  author = String(author || '').trim();
  if (!title) throw Object.assign(new Error('Enter a title first.'), { status: 400 });
  const q = new URLSearchParams({ title, limit: '10', fields: 'title,author_name,isbn,first_publish_year,number_of_pages_median,subject' });
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
    out.push({ title: d.title || '', author: (d.author_name || []).slice(0, 2).join(' & '), year: d.first_publish_year || null, pages: d.number_of_pages_median || null, isbn, ...classify(d.subject, { genres, topics }) });
    if (out.length >= limit) break;
  }
  return out;
}

const key = x => String(x).toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Map Open Library subjects onto values you already use. Never invents new genres:
 * fiction/nonfiction is inferred from the subjects, the rest must match your vocabulary.
 */
function classify(subjects, { genres = [], topics = [] } = {}) {
  const subs = (Array.isArray(subjects) ? subjects : []).map(x => String(x).toLowerCase());
  const joined = ' ' + subs.map(x => x.replace(/[^a-z0-9]+/g, ' ').trim()).join(' | ') + ' ';
  const hits = vocab => vocab.filter(v => { const k = String(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); return k.length > 2 && joined.includes(' ' + k); });
  const genre = [];
  if (subs.length) {
    const fic = subs.some(x => /fiction/.test(x) && !/non-?fiction/.test(x));
    const non = subs.some(x => /non-?fiction/.test(x));
    genre.push(fic && !non ? 'fiction' : 'nonfiction');
  }
  for (const g of hits(genres)) if (!genre.some(x => key(x) === key(g))) genre.push(g);
  const canon = genre.map(g => genres.find(v => key(v) === key(g)) || g);
  const topic = hits(topics)[0] || canon.find(g => !['fiction', 'nonfiction'].includes(key(g))) || '';
  return { genre: canon.slice(0, 4), topic };
}

module.exports = { classify, lookupIsbn, pickIsbn };
