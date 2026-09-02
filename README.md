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
| **Per-agent classification** (Claude Code, Cursor, Codex, Gemini, Copilot, …) with an agent tree | | ✓ |
| **Detects installed agents** and shows only those (plus any folder holding skills) | | ✓ |
| **Static quality score** on every skill, Quality panel, batch AI assessment | | ✓ |
| **Overlap check** across skills with threshold and AI verdicts | | ✓ |
| Extra roots on the command line (`--root`) | | ✓ |
| Filter by drawer, search name/description/path/frontmatter | ✓ | ✓ |
| Rendered body, raw source, frontmatter, extra files | ✓ | ✓ |
| Static risk audit (curl-pipe-bash, credential paths, prompt override…) | ✓ | ✓ |
| Origin inference (frontmatter, path, plugin.json, git remote) | ✓ | ✓ |
| Delete one or many | ✓ | ✓ |
| **Trash with restore** (soft delete, undo toast, empty trash) | | ✓ |
| **Disable / enable** (quarantine instead of delete) | | ✓ |
| **Archive / unarchive** shelf, unarchive into any agent | | ✓ |
| **Copy / move skills across agents** | | ✓ |
| **Frontmatter & structure lint** (missing name/description, bad YAML, name mismatch, oversize, broken links) | | ✓ |
| **Duplicate & trigger-conflict detection** (identical copies, same name, near-identical names, overlapping descriptions) | | ✓ |
| **Edit in place** (any file in the skill, metadata form, add/delete files) | | ✓ |
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

- **Left**: agents that were found, each with its drawers nested underneath (user, plugin, builtin, project). Click an agent to see everything it loads, or a drawer for just that folder; "edit" beside the heading shows, hides or adds agents. Quick filters (lint problems, risk findings, duplicates, disabled), sort (drawer, name, recently modified, recently added, largest, riskiest, most lint).
- **Middle**: the skills, grouped into collapsible per-agent sections (untick "Group by agent" for a flat list), with badges for lint status, risk level, identical copies, symlinks, single-file skills, project scope and tool-managed drawers. Mark several to trash, disable or export them together.
- **Right**: the selected skill. Toolbar: Disable, Edit, Rename, Copy to…, Move to…, Archive, Open in editor, Export, Trash. Tabs for the rendered body, raw source, frontmatter and signals (modified / added / size / hash / copies), files, health (lint problems + risk findings), and Edit, which has a metadata form and a file editor with New file and Delete file.
- **Top**: New, Install, **Checks** (Quality report, Overlap report, Issues) and **Shelf** (Archived, Deleted, Import, Export), plus AI settings, rescan, theme and help. The per-skill Archive, Trash and Export buttons live on the skill itself; the menus hold the places those skills go.

### Moving skills between agents

Every agent reads its own folder, so a skill written for Claude Code is invisible to Cursor until it is copied there. Select a skill (or mark several), click **Copy to…** and pick the target drawer; the picker is grouped by agent. **Move to…** does the same but removes the original. Copies are real folders, never symlinks, so the target tool's updater cannot break them.

### Which agents appear

The sidebar lists an agent when it is installed on this machine (a home folder such as `~/.copilot` or `~/.claude`, a CLI such as `codex` on your PATH, or a VS Code extension such as GitHub Copilot) or when a skills folder for it already exists. Hover an agent name to see how it was detected. An installed agent with no skills folder yet shows an empty, italic drawer; copying, installing or creating a skill there makes the folder. Agents that are neither installed nor holding skills stay hidden. Click the chevron to close or open a group; the choice is remembered.

Supported agents include Claude Code, GitHub Copilot (`~/.copilot/skills`, `.github/skills`), Microsoft 365 Copilot (`~/.m365/skills`, `.m365/skills`, `.microsoft365agents/skills`, `appPackage/skills`), Cursor, Codex, Gemini, Windsurf, Kiro, OpenCode, Amp, Continue, Cline, Roo Code, Aider, Goose, Zed, Junie, Trae, Qwen Code and Augment.

`~/.agents/skills` is a cross-tool convention rather than a product, so it appears only when it actually holds skills and never as an empty drawer.

**Your own agents.** Click "edit" beside AGENTS to show or hide any agent, or to add one: a name, an absolute skills folder, and optional project-relative folders. Custom agents are scanned, grouped and written to exactly like the built-ins, and are stored in `~/.skill-drawer/agents.json`. Use this when a tool keeps its skills somewhere Skill Drawer does not know about yet.

### Quality check

Every skill gets a static score out of 100 that needs no model: frontmatter validity (20), description as a trigger (30: length, says when to use it, has an action verb), instructions (25: length, headings, commands, steps, guardrails), safety (15, from the risk audit) and structure (10: broken links, reference files). The `Q` chip on each card shows it; sort by "Lowest quality first" to find the weak ones. The **Quality** button opens a table for the current agent scope with the two biggest deductions per skill and an **Assess all with AI** button that runs your configured model over each one with progress. `skill-drawer quality` prints the same table.

### Overlap check

The **Overlap** button scores every pair of skills in scope on how likely they are to be picked for the same request: descriptions weigh most, then bodies, then names. Identical copies score 100. Each pair is tagged same drawer (the tool will pick one unpredictably), same agent (both may load) or across agents (duplication). Drag the threshold, click **check with AI** on a pair for the model's verdict, or **Check top 10 with AI**. `skill-drawer overlap --threshold 0.3`.

### AI assessment and comparison

Click **AI ⚙** in the top bar once and point Skill Drawer at a model. Presets fill in OpenAI, Anthropic (native Messages API or the OpenAI-compatible endpoint), OpenRouter, Groq, Ollama and LM Studio; or type any base URL that speaks OpenAI chat completions, a model id, and an API key. Test, then Save. The key is stored in `~/.skill-drawer/ai.json` readable only by you, or you can leave it out and set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, or `SKILL_DRAWER_AI_API_KEY` in the environment instead. `SKILL_DRAWER_AI_BASE_URL`, `SKILL_DRAWER_AI_MODEL` and `SKILL_DRAWER_AI_PROVIDER` override the saved settings.

- **Assess (AI)** on a skill opens the AI tab: a score out of 100 and a grade, five dimensions (trigger, clarity, completeness, structure, safety) with notes, strengths, weaknesses, specific suggestions, and a rewritten description with an Apply button.
- **Compare with…** on a skill, **Compare (AI)** when exactly two skills are marked, or the Compare button on any two-skill conflict in Issues: overlap percentage, whether they do the same job, a quality score for each, a keep-A / keep-B / keep-both / merge recommendation with rationale, a merge plan, and a suggested rewrite so the agent can tell their triggers apart. The same view shows the static overlap and quality numbers, a colour line diff of the two SKILL.md files, and quick actions to copy one description onto the other or trash the one the model recommends dropping.

What is sent: the skill's frontmatter, body, file list and the static lint and risk findings, to the endpoint you configured and nowhere else. Results are cached by model and content hash, so re-opening is free; Re-assess bypasses the cache. Bodies over 60,000 characters are cut for the model and the result says so.

```
skill-drawer ai set preset=ollama model=llama3.1
skill-drawer ai set preset=anthropic apiKey=sk-ant-…
skill-drawer ai test
skill-drawer assess pdf-tools
skill-drawer compare pdf-tools pdf-helper --json
```

### Disable vs archive vs trash

- **Disable** pauses a skill. It stays listed in grey under its agent and comes back with one click.
- **Archive** shelves a skill you may want later but for no agent right now. It leaves the list and lives in the Archive panel, where you can unarchive it into its old drawer or any other agent's.
- **Trash** is for deletion, with restore until you empty it.

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
| `c` / `m` | copy / move to another agent |
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
skill-drawer agents                  installed agents, their drawers and skills
skill-drawer quality [--json]        static quality score for every skill
skill-drawer overlap [--threshold n] pairs likely to trigger on the same request
skill-drawer disable <name|path>     quarantine a skill
skill-drawer enable <name>           put it back
skill-drawer archive <name|path>     shelve a skill outside every agent
skill-drawer archive list            what is shelved
skill-drawer unarchive <entry> [--drawer <dir>]
skill-drawer copy <name|path> --drawer <dir> [--overwrite]
skill-drawer move <name|path> --drawer <dir> [--overwrite]
skill-drawer ai [show|set k=v…|test|presets|clear-cache]
skill-drawer assess <name|path> [--json] [--force]
skill-drawer compare <a> <b> [--json] [--force]
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
| `SKILL_DRAWER_AI_PROVIDER`, `SKILL_DRAWER_AI_BASE_URL`, `SKILL_DRAWER_AI_MODEL`, `SKILL_DRAWER_AI_API_KEY` | override the saved AI settings |

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
