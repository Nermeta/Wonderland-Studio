/**
 * The site's navigation is a hand-written list in _includes/nav.html. A new page only shows up
 * there if a link is added, so the Studio adds or removes exactly one <li> line.
 */
const fs = require('fs');
const path = require('path');

const LINK = /^(\s*)<li><a href="\{\{ '([^']+)' \| relative_url \}\}"[^>]*>([^<]*)<\/a><\/li>\s*$/;
const HREF_OK = /^\/[A-Za-z0-9._\/-]*$/;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const file = repo => path.join(repo, '_includes', 'nav.html');

function load(repo) {
  const p = file(repo);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { p, raw, eol, lines: raw.split(/\r?\n/) };
}

function links(repo) {
  const n = load(repo); if (!n) return [];
  return n.lines.map(l => l.match(LINK)).filter(Boolean).map(m => ({ href: m[2], label: m[3] }));
}

function add(repo, href, label) {
  if (!HREF_OK.test(href)) throw Object.assign(new Error('That address cannot be used in the navigation.'), { status: 400 });
  const n = load(repo);
  if (!n) throw Object.assign(new Error('The site has no _includes/nav.html.'), { status: 400 });
  if (n.lines.some(l => (l.match(LINK) || [])[2] === href)) return false;
  const last = n.lines.map((l, i) => (LINK.test(l) ? i : -1)).filter(i => i >= 0).pop();
  if (last === undefined) throw Object.assign(new Error('Could not find the navigation list in nav.html.'), { status: 400 });
  const indent = n.lines[last].match(LINK)[1];
  const li = `${indent}<li><a href="{{ '${href}' | relative_url }}" {% if page.url == '${href}' %}aria-current="page"{% endif %}>${esc(label)}</a></li>`;
  n.lines.splice(last + 1, 0, li);
  fs.writeFileSync(n.p, n.lines.join(n.eol), 'utf8');
  return true;
}

function remove(repo, href) {
  const n = load(repo); if (!n) return false;
  const i = n.lines.findIndex(l => (l.match(LINK) || [])[2] === href);
  if (i === -1) return false;
  n.lines.splice(i, 1);
  fs.writeFileSync(n.p, n.lines.join(n.eol), 'utf8');
  return true;
}

module.exports = { links, add, remove, HREF_OK };
