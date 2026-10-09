/** Markdown body templates: built-ins that mirror the headings of your own entries, plus ones you save. */
const fs = require('fs');

const BUILTIN = [
  { id: 'b-field-notes', coll: 'field-notes', name: 'Box writeup', body: `## Box Info

| | |
|---|---|
| Platform | |
| OS | |
| Difficulty | |

## My Approach

## Enumeration

## Foothold

## Privilege Escalation

## Key Takeaways

## Tools Used

## References
` },
  { id: 'b-explorations', coll: 'explorations', name: 'Step-by-step tutorial', body: `## What You'll Build

## Prerequisites

## Step 1 — 

## Step 2 — 

## Step 3 — 

## The Full Script

## Common Issues
` },
  { id: 'b-discoveries', coll: 'discoveries', name: 'Deep dive', body: `## Why This Deserves a Deep Dive

## The Foundation

## How It Actually Works

## Where It Gets Complicated

## Where It Gets Exploited

## Further Reading
` },
  { id: 'b-chronicles-skill', coll: 'chronicles', name: 'Skill log', body: `## Why I'm Studying This

## Study Plan

## Session Log

### Week 1 — 

## Concepts I Keep Coming Back To

## What's Next
` },
  { id: 'b-chronicles-session', coll: 'chronicles', name: 'Study session', body: `## Goal

## What I Covered

## What Clicked

## Where I Got Stuck

## Next Time
` },
  { id: 'b-library', coll: 'library', name: 'Book review', body: `## In One Sentence

## What It's About

## What Landed

## What I'd Push Back On

## Who Should Read It

## My Rating
` },
  { id: 'b-emblems', coll: 'emblems', name: 'Certification notes', body: `## What This Covers

## Why I Pursued It

## What I Learned

## Verify This Credential
` },
  { id: 'b-pages', coll: 'pages', name: 'Simple page', body: `A short introduction to this page.

## A Section

Some text, with a [link](/).
` },
  { id: 'b-checklist', coll: '*', name: 'Checklist', body: `- [ ] First thing
- [ ] Second thing
- [ ] Third thing
` },
  { id: 'b-prosandcons', coll: '*', name: 'Pros and cons', body: `| Pros | Cons |
| --- | --- |
|  |  |
|  |  |
` },
  { id: 'b-command', coll: '*', name: 'Command and output', body: `\`\`\`bash
command --here
\`\`\`

Output:

\`\`\`
paste the output here
\`\`\`
` }
];

const clean = s => String(s || '').replace(/\u0000/g, '');

function make(file) {
  const load = () => { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } };
  return {
    list(coll) {
      const ok = t => t.coll === '*' || t.coll === coll;
      return { builtin: BUILTIN.filter(ok), user: load().filter(ok) };
    },
    add({ name, coll, body }, known) {
      name = clean(name).trim().replace(/\s+/g, ' ');
      body = clean(body);
      if (!name || name.length > 60) throw Object.assign(new Error('Give the template a name up to 60 characters.'), { status: 400 });
      if (!body.trim()) throw Object.assign(new Error('There is nothing in the body to save.'), { status: 400 });
      if (body.length > 100000) throw Object.assign(new Error('That body is too long for a template.'), { status: 400 });
      if (coll !== '*' && !known.includes(coll)) throw Object.assign(new Error('Unknown collection.'), { status: 400 });
      const all = load();
      if (all.length >= 100) throw Object.assign(new Error('You already have 100 templates. Delete some first.'), { status: 400 });
      const t = { id: 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, coll, body };
      all.push(t);
      fs.writeFileSync(file, JSON.stringify(all, null, 2) + '\n', 'utf8');
      return t;
    },
    remove(id) {
      const all = load(), next = all.filter(t => t.id !== id);
      if (next.length === all.length) return false;
      fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
      return true;
    }
  };
}

module.exports = { make, BUILTIN };
