# Skill Drawer

**Browse, lint, organise and safely prune every agent skill on your machine.**

Skill Drawer finds the skills your coding agents load — Claude Code, Codex, Cursor, Gemini, Copilot, Windsurf and friends — in both user-level drawers (`~/.claude/skills`, `~/.cursor/skills`, …) and project-local ones (`.claude/skills` inside a repo), and gives you one place to read them, validate them, spot duplicates and conflicts, edit them, disable them, trash and restore them, export and import them, and install new ones.

```
npx skill-drawer
```

That starts a local server on `127.0.0.1:3782` and opens it in your browser. Nothing leaves your machine.

Skill Drawer covers everything [skill-cabinet](https://github.com/subsy/skill-cabinet) does (scan, filter, search, read, delete, keyboard-driven, themed) and adds the pieces a catalog needs to actually be a manager:

| | skill-cabinet | **skill-drawer** |
|---|:---:|:---:|
| Scan user-level drawers (`~/.*/skills`, Cursor builtin & plugins) | ✓ | ✓ |
| Scan **project-local** drawers (walks up from your cwd) | | ✓ |
| Extra roots on the command line (`--root`) | | ✓ |
| Filter by drawer, search name/description/path/frontmatter | ✓ | ✓ |
| Rendered body, raw source, frontmatter, extra files | ✓ | ✓ |
| Static risk audit (curl-pipe-bash, credential paths, prompt override…) | ✓ | ✓ |
| Origin inference (frontmatter, path, plugin.json, git remote) | ✓ | ✓ |
| Delete one or many | ✓ | ✓ |
| **Trash with restore** (soft delete, undo toast, empty trash) | | ✓ |
| **Disable / enable** (quarantine instead of delete) | | ✓ |
| **Frontmatter & structure lint** (missing name/description, bad YAML, name mismatch, oversize, broken links) | | ✓ |
| **Duplicate & trigger-conflict detection** (identical copies, same name, near-identical names, overlapping descriptions) | | ✓ |
| **Edit in place** (any file in the skill, ⌘S to save) | | ✓ |
| **Open in `$EDITOR`** | | ✓ |
| **Create** and **rename** skills | | ✓ |
| **Export / import** a manifest or a full bundle | | ✓ |
| **Install** from GitHub (`owner/repo`, `owner/repo/path`, URL) or a local folder | | ✓ |
| Usage signals: modified, added, size, file count, sort by any | partial | ✓ |
| **Read-only mode** (`--read-only`) | | ✓ |
| Full **CLI** (`list`, `lint`, `issues`, `export`, `import`, `install`, `disable`, `enable`, `trash`) | | ✓ |
| Themes (Carbon, Paper, Nord, Solar, Mono) | ✓ | ✓ |
| Keyboard driven (`j`/`k`, `/`, `x`, `d`, …) | ✓ | ✓ |
| No build step; plain Node + a static page | | ✓ |

## Install

```
npm install -g skill-drawer     # then: skill-drawer
npx skill-drawer                # or run it without installing
npx github:prabhay759/skill-drawer   # straight from the repo
```

Requires Node 20+. `git` is needed only for installing skills from GitHub.

## The web UI

- **Left**: drawers that were found (user, plugin, builtin, project), quick filters (lint problems, risk findings, duplicates, disabled), sort (drawer, name, recently modified, recently added, largest, riskiest, most lint).
- **Middle**: the skills, with badges for lint status, risk level, identical copies, symlinks, single-file skills, project scope and tool-managed drawers. Mark several to trash, disable or export them together.
- **Right**: the selected skill. Tabs for the rendered body, raw source, frontmatter and signals (modified / added / size / hash / copies), files, health (lint problems + risk findings), and an editor.
- **Top**: New, Install, Import, Export, Issues (all conflicts, lint and risk findings in one place), Trash, rescan, theme, help.

### Keyboard

| Key | Action |
|---|---|
| `j` / `k`, `↓` / `↑` | next / previous skill |
| `Enter` | open selected |
| `/` | search |
| `x` / `Space` | mark / unmark |
| `a` | mark all visible |
| `d` | trash marked (or current) |
| `e` | disable / enable current |
| `n` / `i` / `t` / `!` | new skill / install / trash / issues |
| `1`–`6` | switch detail tab |
| `r` | rescan |
| `Esc` | clear marks / close dialog |
| `?` | shortcuts |

## Safety model

- **Delete goes to the trash.** `~/.skill-drawer/trash/<timestamp>-<name>/` keeps the whole folder (or file, or symlink) plus a `meta.json` with its original path. Restore from the Trash panel, the undo toast, or `skill-drawer trash restore <entry>`. "Delete permanently" skips the trash and says so.
- **Disable moves, it does not delete.** A disabled skill lives in `~/.skill-drawer/disabled/…` so the tool stops loading it; Enable moves it back. Disabled skills stay visible in the UI.
- **Tool-managed drawers are read-only.** Cursor's builtin skills and plugin caches, Claude/Codex plugin folders, and symlinked skills can be read and exported but not edited, renamed or disabled here, because the tool's updater would just put them back. Delete still works if you insist, as in skill-cabinet.
- **Read-only mode** (`--read-only` or `SKILL_DRAWER_READ_ONLY=1`) refuses every mutating request server-side, not just in the UI.
- The server binds to `127.0.0.1` only and rejects cross-origin browser requests. Rendered markdown is sanitised with DOMPurify.
- Editing and reading files is confined to the skill's own folder.

## CLI

```
skill-drawer                         open the web UI
skill-drawer list [--json]           every skill, with drawer, lint, risk and copies
skill-drawer lint [--json]           validate frontmatter/structure; exit 1 on errors (CI-friendly)
skill-drawer issues [--json]         duplicates and trigger conflicts
skill-drawer drawers                 the drawers that were found
skill-drawer export [--bundle] [f]   manifest, or bundle with file contents
skill-drawer import <file> [--drawer <dir>] [--overwrite] [--fetch]
skill-drawer install <src> [names…] [--drawer <dir>] [--overwrite]
skill-drawer disable <name|path>     quarantine a skill
skill-drawer enable <name>           put it back
skill-drawer trash [list|restore <entry>|purge <entry>|empty]
```

Options: `--port <n>`, `--no-open`, `--read-only`, `--root <dir>` (repeatable), `--no-project`, `--cwd <dir>`, `--json`.

`install` sources: `owner/repo`, `owner/repo@ref`, `owner/repo/path/to/skills`, a full `https://github.com/...` URL (with or without `/tree/<ref>/<path>`), or a local folder. Every folder under the source that contains a `SKILL.md` is installed; pass names after the source to pick specific ones.

## Export & import

- **Manifest** (`skill-drawer export`): what you have — name, drawer, path, origin, content hash. Small, diffable, good for committing to dotfiles. On import, entries with a GitHub origin can be fetched with `--fetch`.
- **Bundle** (`skill-drawer export --bundle`): the manifest plus every file's contents (text as UTF-8, binaries as base64). Restores byte-for-byte on another machine with no network access.

## What it looks for

User-level: every `~/.<tool>/skills` and `~/.<tool>/skill`, plus `~/.cursor/skills-cursor`, `~/.cursor/plugins`, `~/.claude/plugins`, `~/.codex/plugins` (recursively, any `skills/` folder inside), and `~/.gemini/antigravity/{skills,global_skills}`.

Project-level: walking up from the current directory, `.claude/skills`, `.agents/skills`, `.codex/skills`, `.cursor/skills`, `.gemini/skills`, `.github/skills`, `.windsurf/skills`, `.kiro/skills`, `.opencode/skills`, `.copilot/skills` and a bare `skills/`.

A skill is a folder with a `SKILL.md` (or `skill.md`), or a loose `*.md` file directly in a drawer (README/CHANGELOG/LICENSE excluded).

## Lint rules

`name` and `description` required; `name` ≤ 64 chars, lowercase letters/digits/single hyphens, matching the folder; `description` ≤ 1024 chars; valid YAML mapping; `metadata` is a mapping; `compatibility` ≤ 500 chars; unknown keys reported as info; empty body, > 500 lines or > 200 KB warned; relative links in the body must resolve inside the folder.

## Environment

| Variable | Effect |
|---|---|
| `PORT` | port (default 3782; falls back to the next free port unless set) |
| `SKILL_DRAWER_NO_OPEN=1` | do not open a browser |
| `SKILL_DRAWER_READ_ONLY=1` | read-only mode |
| `SKILL_DRAWER_HOME` | where trash and disabled skills live (default `~/.skill-drawer`) |
| `SKILL_DRAWER_EDITOR`, `VISUAL`, `EDITOR` | used by "Open in editor" |

## Programmatic use

```js
import { scanSkills, lintSkill, detectConflicts, exportManifest } from "skill-drawer";
const { skills, drawers, conflicts, census } = scanSkills({ cwd: process.cwd() });
```

## Releasing

Releases are automated in `.github/workflows/release.yml`; nothing is published from a laptop.

- **Merge to `main` with a bumped `version` in `package.json`.** If that version is not on npm yet, CI runs the tests, publishes with provenance, tags `vX.Y.Z` and creates a GitHub release whose notes come from the matching `CHANGELOG.md` section.
- **Or click Actions → Release → Run workflow** and choose patch, minor or major. The workflow bumps the version, commits, tags, publishes and releases.

One-time setup: add an `NPM_TOKEN` repository secret (npmjs.com → Access Tokens → Granular, read and write, with 2FA bypass for automation). After the first publish you can switch the package to npm Trusted Publishing for this repo and workflow and delete the secret.

See [FEATURES.md](FEATURES.md) for what is covered relative to skill-cabinet and what is deliberately out of scope.

## Development

```
npm install
npm run dev      # server with --watch, no browser
npm test         # node --test
```

No bundler: `web/` is served as-is, `marked` and `dompurify` are served from `node_modules`.

## License

MIT
