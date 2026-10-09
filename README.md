# Wonderland Studio

A local content editor for the **Wynter's Wonderland** Jekyll site. It edits the site's Markdown files in place and binds to `127.0.0.1` only.

## Set up (any computer)

```bash
git clone https://github.com/Nermeta/Wonderland-Studio && cd Wonderland-Studio
npm install
npm run setup      # clones the website into ./site (ignored by this repo's git)
npm start          # http://localhost:4747
```

`./site` is a normal checkout of the website with its own git history, so the Studio never commits it. To use an existing clone instead, copy `config.example.json` to `config.json` and set `"repo"`, or run with `JEKYLL_REPO=/path/to/site`.

Push your site branches before switching computers. Anything not pushed lives only in that computer's `./site`.

## What it edits

One tab per collection, named like the site nav:

| Tab | Directory | Notes |
| --- | --- | --- |
| Library | `_book-reviews/` | Cover preview (local `assets/images/covers/<isbn>.jpg`, else Open Library by ISBN) and a **Look up ISBN** button that searches Open Library by title and author |
| Emblems | `_certifications/` | **Certification** (badge art, shape picker with live display-case preview) and **Education** kinds |
| Discoveries | `_deep-dives/` | |
| Chronicles | `_learning-logs/` | **Skill** and **Session log** kinds (a session picks its parent from existing skills) |
| Explorations | `_tutorials/` | New files get the `YYYY-MM-DD-` prefix the existing ones use |
| Field Notes | `_writeups/` | |
| Tags | all of the above | See below |

Forms come from per-collection schemas (`lib/schemas.js`) and show the `layout` and `public` default read from `_config.yml`. The Preview tab renders the entry's front matter and Markdown in the site's look (an approximation; a real Jekyll build is the final word). The **Visible to the AI chat** switch writes `public: false`, which keeps the entry out of `context.json`.

## Tags

- **Tags tab:** every value of `tags`, `tech_stack`, `tools`, `genre` and `skills`, with counts, a usage bar, and the entries that use each one (click an entry to open it). Filter by used once / used 2+ times / spelling clashes. A clash means one field spells the same tag two ways (`DNS` and `dns`). A note such as *also "DNS" in skills* means a different field spells it differently; fields are separate vocabularies, so that is informational only.
- **Normalize on save:** a tag you add takes the spelling already used most often (type `DNS`, get `dns`). Tags already on an entry are never rewritten.
- **✦ Suggest tags** (tags field): scores your existing tags against the entry's title, summary, topic and body, and also offers the entry's own tech stack/tools/genre values. Offline and private. Click a suggestion to add it; dashed ones are new to your vocabulary.
- **Ask Claude** (optional): appears when an API key is set. It sends the entry's title, summary and body, plus your tag vocabulary, to the Claude API and returns up to 8 tags, reusing your spellings. Set `ANTHROPIC_API_KEY` in your environment (preferred), or `"anthropicApiKey"` in the git-ignored `config.json`. The model defaults to `claude-haiku-5-5`; override with `STUDIO_TAG_MODEL` or `"tagModel"`. It costs API usage per click.

## Covers and ISBN lookup

The site's deploy workflow downloads covers from Open Library and caches them, so a fresh clone often has no `assets/images/covers/` files. The Studio therefore shows the local file when there is one and otherwise loads the cover straight from Open Library in your browser (the ISBN is sent to openlibrary.org). **Look up ISBN** (Library form) searches Open Library with the title and author you typed. Pick a result to set the ISBN and fill in an empty author or page count. Both need internet access.

## It only changes what you change

Saving never rewrites a whole header. Front matter is split into per-key blocks and **only keys whose value changed** are rewritten; everything else is kept byte-for-byte (comments, quoting, key order, date style, line endings, keys the editor doesn't manage). A no-op save writes nothing.

- Legacy values outside a field's usual options never block saving until you change that field.
- Duplicate keys are flagged; editing one keeps the last, as Jekyll does.
- If a file changes on disk while it is open, saving asks before overwriting.
- Delete moves the file to `.studio-trash/` in the site repo.

`npm test` runs the tag unit tests, then copies your site to a temp folder, does a no-op save on every file, and fails if one byte differs.

## Git (branch + commit only)

The chip in the header shows the current branch and the number of changed files. From it you can create or switch branches, pick files, and commit with a one-line message (max 100 characters).

- Commits on `main`/`master` are refused. Create a feature branch first.
- It never pushes. Push and open the PR yourself.
- It does not fetch or pull. Run `git -C site fetch --prune` (or `npm run setup`) before you start.

## Docker (optional, not yet tested)

The native setup above needs only Node and git. These files are provided for running the Studio in a container if you prefer:

```bash
mkdir -p site
cp .env.example .env     # set GIT_NAME, GIT_EMAIL (and optionally ANTHROPIC_API_KEY)
docker compose run --rm studio node scripts/setup.js   # clones the site into ./site
docker compose up --build                              # http://localhost:4747
```

The container runs as your own user (`STUDIO_UID`/`STUDIO_GID`, default 1000) so files in `./site` stay yours, and the port is published to localhost only. Commits need `GIT_NAME` and `GIT_EMAIL` because the container has no git identity of its own.

## Safety

Binds to `127.0.0.1`, checks the `Host` header (DNS-rebinding guard), rejects cross-origin API calls, validates every filename, and only writes inside the collection folders, `assets/images/badges/` and `.studio-trash/`. Add `.studio-trash/` to the site's `.gitignore`; the git panel already hides it.

## Not built yet

`_posts/` (only the default "Welcome to Jekyll" post), `_pages/`, `context.json` regeneration, local Jekyll builds, tag rename/merge.
