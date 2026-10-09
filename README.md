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

## Auto-fill and writing

**✦ Auto-fill empty fields** (top of every form) proposes values for blank fields only, and you review each one before it is applied (**Use** or **Use all**). It works offline:
- **Minutes to read:** about 200 words a minute, with code counted slower.
- **Summary:** the opening paragraph, to edit.
- **Topic, category, domain:** the most common value among entries that share your tags, otherwise a value already used that is named in the title or tags.
- **Platform and difficulty (Field Notes):** from the title (`HTB:`, `THM:`) and the box info table.
- **Subjects, tools, tags:** your existing values that the entry names, plus any of its tags that are in that vocabulary.
- **Audience:** the most common one in the collection. **Subject (Chronicles):** the title without “Study Log”.

**Auto-fill with Claude** (needs an API key) also fills what rules can't, such as Difficulty and Outcome. Difficulty and Outcome must be one of the field's allowed options. It sends the entry's title, tags and body to the Claude API.

The body box has a Markdown toolbar (bold, italic, headings, lists, quote, code, link, table, divider; Ctrl/Cmd+B, I and K work too, and undo works). **Writing focus** (or Ctrl/Cmd+Shift+F) hides all the fields so only the body shows; it is remembered in your browser.

## Covers and ISBN lookup

The site's deploy workflow downloads covers from Open Library and caches them, so a fresh clone often has no `assets/images/covers/` files. The Studio therefore shows the local file when there is one and otherwise loads the cover straight from Open Library in your browser (the ISBN is sent to openlibrary.org). **Look up ISBN** (Library form) searches Open Library with the title and author you typed. Pick a result to set the ISBN and fill in any empty author, page count, genre and topic. Genre and topic only use values you already have (plus fiction/nonfiction, inferred from Open Library's subjects), so a genre you have never used is not added automatically. Both need internet access.

## Credential links (Emblems)

Under **Credential link** there are two buttons. **Search the web** opens a DuckDuckGo search for the title, issuer and "certification" in a new tab; it needs no key and sends nothing from the Studio. **Find with Claude** (needs an API key) has Claude search the web for the issuer's official page and suggest the link, issuer, topic and skills. Review the card, then **Use these** fills the link and any empty issuer, topic and skills, reusing your existing spellings. Only `https` links are accepted. It uses Claude's web search tool, so it costs more than a tag suggestion; the model comes from `STUDIO_SEARCH_MODEL`/`"searchModel"` (default: the tag model). **Suggest skills** on the Skills field matches your existing skills against the title and description, offline.

## It only changes what you change

Saving never rewrites a whole header. Front matter is split into per-key blocks and **only keys whose value changed** are rewritten; everything else is kept byte-for-byte (comments, quoting, key order, date style, line endings, keys the editor doesn't manage). A no-op save writes nothing.

- Legacy values outside a field's usual options never block saving until you change that field.
- Duplicate keys are flagged; editing one keeps the last, as Jekyll does.
- If a file changes on disk while it is open, saving asks before overwriting.
- Delete moves the file to `.studio-trash/` in the site repo.

`npm test` runs the unit tests (tags, credentials, auto-fill, settings), then copies your site to a temp folder, does a no-op save on every file, and fails if one byte differs.

## Git: commit, push, review

The chip in the header shows the current branch, the number of changed files and any commits not pushed (↑2). Open it to create or switch branches, pick files, and commit with a one-line message (max 100 characters). Under **Share on GitHub**:

- **Check GitHub** runs `git fetch --prune`, so the status below it is current. **Pull updates** appears when your branch is behind and fast-forwards only.
- **Push branch** pushes the current feature branch to `origin`. It refuses on `main`/`master`, refuses while files are uncommitted, never forces, and tells you to run `gh auth login` if GitHub rejects your sign-in.
- **Open pull request ↗** opens GitHub's compare page for the branch (or, if the GitHub CLI is signed in and a pull request exists, that pull request). Review and merge it there; the Studio does not merge.
- Commits on `main`/`master` are refused. Create a feature branch first, and check that your branch includes the newest `main` (the dialog says when it doesn't).

## Preview the site locally

**Preview site** (header) runs `bundle exec jekyll serve` in your site folder and shows its log, then links to `http://127.0.0.1:4000/`. It needs Ruby and Bundler on your computer (`sudo apt install ruby-full build-essential`, then `bundle install` once in `site/`). If something is missing it says what. Stopping the Studio stops the preview.

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

## Settings

The **Settings** tab edits `config.json` (git-ignored, saved with private permissions) and applies changes at once, no restart:
- **Claude API key** (write-only: the Studio shows only the last four characters and never sends the key to the browser), with a **Test** button that checks it against the API's free model list. An `ANTHROPIC_API_KEY` environment variable overrides it and is safer on shared computers.
- **Model** and **web-search model**.
- **Covers from Open Library** on or off (off keeps the Studio fully offline apart from Claude).
- **Branch prefix** for new branches, and the **preview port**.
- **About this install**: version, address, site folder, and where the settings live. The site folder and Studio port are set in `config.json` (or `JEKYLL_REPO`/`PORT`) and need a restart.

## Not built yet

`_posts/` (only the default "Welcome to Jekyll" post), `_pages/`, `context.json` regeneration, local Jekyll builds, tag rename/merge.
