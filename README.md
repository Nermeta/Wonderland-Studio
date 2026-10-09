# Wonderland Studio

A local content editor for the **Wynter's Wonderland** Jekyll site. It runs on your machine, edits the site's Markdown files in place, and binds to `127.0.0.1` only.

## Run

```bash
npm install
cp config.example.json config.json   # set "repo" to your local nermeta.github.io clone
npm start                            # http://localhost:4747
```

Or skip the config file: `JEKYLL_REPO=/path/to/repo npm start`
(PowerShell: `$env:JEKYLL_REPO="C:\path\to\repo"; npm start`)

## What it edits

One tab per collection, named like the site nav:

| Tab | Directory | Notes |
| --- | --- | --- |
| Library | `_book-reviews/` | Cover preview from `assets/images/covers/<isbn>.jpg` when present |
| Emblems | `_certifications/` | Two kinds: **Certification** (badge art + shape picker with live display-case preview) and **Education** |
| Discoveries | `_deep-dives/` | |
| Chronicles | `_learning-logs/` | Two kinds: **Skill** and **Session log** (picks its parent from existing skills) |
| Explorations | `_tutorials/` | New files get the `YYYY-MM-DD-` prefix the existing ones use |
| Field Notes | `_writeups/` | |

Forms are generated from per-collection field schemas (`lib/schemas.js`). Each shows the `layout` and `public` default it reads from `_config.yml`.

- **Preview tab** renders the entry's front matter and Markdown in the site's look. It approximates the layout; a real Jekyll build is still the final word.
- **Visible to the AI chat** toggle writes `public: false`, which keeps the entry out of `context.json`. The page still publishes.
- Dropdown-style fields (difficulty, platform, topic, tags…) suggest values already used in that collection but accept new ones.

## It only changes what you change

Saving never re-writes a whole header. The editor splits front matter into per-key blocks and rewrites **only the keys whose value changed**. Everything else is written back byte-for-byte: comments, quoting, key order, date style, line endings, keys the editor doesn't know about (shown read-only under "Other front matter"). A no-op save writes nothing.

- Legacy values outside a field's usual options (for example a `status` the schema doesn't list) never block saving until you change that field.
- Duplicate keys are flagged. Editing that field keeps the last one, as Jekyll does.
- If a file changes on disk while you have it open, saving asks before overwriting.
- Delete moves the file to `.studio-trash/` in the repo rather than erasing it.

Run `npm test` to prove it on your own repo: it copies the site to a temp folder, does a no-op save on every file, and fails if a single byte differs.

## Git (branch + commit only)

The chip in the top right shows the current branch and how many files changed. From there you can create or switch to a branch, tick the files to include, and commit with a one-line message.

- Commits on `main`/`master` are refused. Create a feature branch first.
- Messages must be a single line (max 100 characters).
- It never pushes. Push and open the PR yourself.

## Safety

- Binds to `127.0.0.1`, checks the `Host` header (DNS-rebinding guard) and rejects cross-origin API calls.
- Filenames are validated; nothing outside the collection folders, `assets/images/badges/` and `.studio-trash/` is written.
- Add `.studio-trash/` to the site's `.gitignore`. The git panel already hides it.

## Not built yet

`_posts/` (only the default "Welcome to Jekyll" post lives there), `_pages/`, `context.json` regeneration, and local Jekyll builds.
