/**
 * Front-matter engine.
 *
 * Goal: editing one field must change exactly one field on disk. Instead of
 * parsing the whole header and re-serialising it (which re-quotes dates,
 * drops comments and injects defaults), the header is split into top-level
 * "blocks" (a `key:` line plus its continuation lines). Untouched blocks are
 * written back byte-for-byte; only edited keys are replaced, removed or inserted.
 */
const yaml = require('js-yaml');

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(?:\s|$)/;

// ---------- file <-> parts ----------
function splitFile(raw) {
  const text = raw.replace(/^﻿/, '');
  const bom = text.length !== raw.length;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const norm = eol === '\r\n' ? text.replace(/\r\n/g, '\n') : text;
  const m = norm.match(/^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/);
  if (!m) return { bom, eol, fm: null, rest: norm };
  return { bom, eol, fm: m[1] || '', rest: norm.slice(m[0].length) };
}

function joinFile({ bom, eol, fm, rest }) {
  const head = fm ? `---\n${fm}\n---\n` : '---\n---\n';
  let out = head + rest;
  if (eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  return (bom ? '﻿' : '') + out;
}

// ---------- blocks ----------
function parseBlocks(fm) {
  const blocks = [];
  let cur = null;
  for (const line of String(fm || '').split('\n')) {
    const m = KEY_RE.exec(line);
    if (m) { cur = { key: m[1], lines: [line] }; blocks.push(cur); }
    else if (cur) cur.lines.push(line);
    else { cur = { key: null, lines: [line] }; blocks.push(cur); }
  }
  return blocks.filter(b => b.key || b.lines.some(l => l.trim()));
}

const blocksToText = blocks => blocks.map(b => b.lines.join('\n')).join('\n');

function blockValue(b) {
  try {
    const o = yaml.safeLoad(b.lines.join('\n'), { schema: yaml.CORE_SCHEMA });
    return { ok: true, value: o && typeof o === 'object' ? o[b.key] : undefined };
  } catch (e) {
    return { ok: false, error: String(e.message).split('\n')[0] };
  }
}

/** Parsed view of the header. Later duplicates win (as in Jekyll). */
function readData(blocks) {
  const data = {}, warnings = [], seen = {};
  for (const b of blocks) {
    if (!b.key) continue;
    const r = blockValue(b);
    if (!r.ok) { warnings.push(`Could not parse "${b.key}": ${r.error}`); continue; }
    if (seen[b.key]) warnings.push(`Duplicate key "${b.key}" (the last one wins)`);
    seen[b.key] = true;
    data[b.key] = r.value;
  }
  return { data, warnings };
}

// ---------- values ----------
const PLAIN = /^[A-Za-z\/][A-Za-z0-9 _.\/+-]*$/;
const RESERVED = /^(true|false|yes|no|on|off|null|y|n|~)$/i;

function scalar(s, forceQuote) {
  s = String(s);
  if (!forceQuote && PLAIN.test(s) && !RESERVED.test(s) && !/\s$/.test(s)) return s;
  return JSON.stringify(s); // a JSON string is a valid YAML double-quoted scalar
}

const isEmpty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/** Normalise a value so "same" compares equal regardless of how it was typed. */
function norm(v, field, dflt) {
  switch (field.type) {
    case 'list': {
      const a = Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
      return a.map(x => String(x).trim()).filter(Boolean);
    }
    case 'number': return v == null || v === '' ? null : Number(v);
    case 'bool': return v == null || v === '' ? (dflt == null ? null : !!dflt) : v === true || v === 'true';
    default: return v == null ? '' : String(v).trim();
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function valueLines(key, value, field) {
  switch (field.type) {
    case 'list': return [`${key}: [${value.map(x => scalar(x, false)).join(', ')}]`];
    case 'number': return [`${key}: ${value}`];
    case 'bool': return [`${key}: ${value ? 'true' : 'false'}`];
    case 'date': return [`${key}: ${value}`];
    case 'longtext': return [`${key}: ${scalar(value, true)}`];
    default: return [`${key}: ${scalar(value, !!field.quote)}`];
  }
}

// ---------- patching ----------
/**
 * edits: [{ key, value (normalised), field }]; orderKeys: schema key order,
 * used only to decide where a brand-new key is inserted.
 */
function applyEdits(blocks, edits, orderKeys) {
  const out = blocks.slice();
  const idx = k => orderKeys.indexOf(k);
  for (const { key, value, field } of edits) {
    const at = [];
    out.forEach((b, i) => { if (b.key === key) at.push(i); });
    const empty = isEmpty(value);
    const newLines = empty
      ? (field.type === 'list' && at.length ? [`${key}: []`] : null)
      : valueLines(key, value, field);

    if (at.length) {
      const last = at[at.length - 1];
      if (newLines) out[last] = { key, lines: newLines }; else out.splice(last, 1);
      for (const i of at.slice(0, -1).reverse()) out.splice(i < last ? i : i, 1); // drop earlier duplicates
      continue;
    }
    if (!newLines) continue;
    const pos = idx(key);
    let insertAt = -1;
    out.forEach((b, i) => { if (b.key && idx(b.key) >= 0 && idx(b.key) < pos) insertAt = i + 1; });
    if (insertAt === -1) {
      const first = out.findIndex(b => b.key);
      insertAt = first === -1 ? out.length : first;
    }
    out.splice(insertAt, 0, { key, lines: newLines });
  }
  return out;
}

/** Build a header for a brand-new file in schema order. */
function buildNew(entries, orderKeys) {
  const sorted = entries.slice().sort((a, b) => orderKeys.indexOf(a.key) - orderKeys.indexOf(b.key));
  return sorted.flatMap(e => valueLines(e.key, e.value, e.field)).join('\n');
}

module.exports = { splitFile, joinFile, parseBlocks, blocksToText, readData, norm, same, isEmpty, applyEdits, buildNew, scalar };
