'use strict';
/** Pages on the site that a Markdown link can point to: collection entries and the standalone pages. */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Jekyll's default slugify: lower-case, every run of non-letters/digits becomes one hyphen
const slugify = s => String(s).toLowerCase().replace(/[^\p{M}\p{L}\p{Nd}]+/gu, '-').replace(/^-+|-+$/g, '');

function readYaml(file) { try { return yaml.safeLoad(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; } }
function frontMatter(file) {
  try {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(file, 'utf8'));
    return m ? (yaml.safeLoad(m[1]) || {}) : {};
  } catch { return {}; }
}

/** Expand a collection permalink such as /tutorials/:name/ for one file. */
function collectionUrl(permalink, collection, slug) {
  const pl = permalink || `/${collection}/:name/`;
  // Jekyll drops a leading YYYY-MM-DD from the filename (the site's own links confirm it); 10-06-2026- is not a date to Jekyll
  const bare = slugify(slug.replace(/^\d{4}-\d{2}-\d{2}-/, ''));
  return pl.replace(/:name\b/g, bare).replace(/:slug\b/g, bare)
    .replace(/:collection\b/g, collection).replace(/\/{2,}/g, '/');
}

/**
 * @param repo        site folder
 * @param collections the Studio's collection list (needs id, label, config)
 * @param listItems   fn(collection) -> [{slug, title}]
 */
function listLinkables(repo, collections, listItems) {
  const cfg = readYaml(path.join(repo, '_config.yml'));
  const cols = cfg.collections || {};
  const groups = [];

  const pages = [];
  const home = ['index.markdown', 'index.md', 'index.html'].map(f => path.join(repo, f)).find(f => fs.existsSync(f));
  if (home) pages.push({ title: frontMatter(home).title || 'Home', url: '/' });
  const pdir = path.join(repo, '_pages');
  if (fs.existsSync(pdir)) {
    for (const f of fs.readdirSync(pdir).sort()) {
      if (!/\.(md|markdown|html)$/i.test(f)) continue;
      const fm = frontMatter(path.join(pdir, f));
      const base = f.replace(/\.[^.]+$/, '');
      const url = fm.permalink ? String(fm.permalink) : `/${slugify(base)}/`;
      pages.push({ title: fm.title || base, url });
    }
  }
  if (pages.length) groups.push({ id: 'pages', label: 'Site pages', items: pages });

  for (const c of collections) {
    const conf = cols[c.config];
    if (!conf || conf.output === false) continue; // collections that have no page of their own (emblems)
    let items = [];
    try { items = listItems(c); } catch { /* an unreadable collection just has nothing to offer */ }
    groups.push({
      id: c.id, label: c.label,
      items: items.filter(i => !i.error).map(i => ({ title: i.title || i.slug, url: collectionUrl(conf.permalink, c.config, i.slug) }))
    });
  }
  return groups;
}

module.exports = { listLinkables, collectionUrl, slugify };
