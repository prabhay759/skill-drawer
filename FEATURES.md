# What Skill Drawer covers

Skill Drawer started from a review of [skill-cabinet](https://github.com/subsy/skill-cabinet): a local catalog for agent skills that can browse and delete, but not much else. This file lists what was carried over, what was added for each gap that review found, and what is deliberately out of scope.

## Carried over from skill-cabinet

| Capability | Where it lives |
|---|---|
| Scan `~/.<tool>/skills` for every dot-folder in `$HOME`, plus Cursor builtin and plugin drawers, Gemini Antigravity | `src/scan.js` `discoverDrawers` |
| Folder skills (`SKILL.md`), loose `*.md` file skills, symlinked skills | `src/scan.js` |
| Filter by drawer; search across name, description, path and frontmatter | `web/app.js` |
| Rendered body, raw source, frontmatter, extra files with preview | detail tabs |
| Delete one or many | `DELETE /api/skills/:id`, `POST /api/skills/delete` |
| Keyboard driven: `j` `k` `/` `x` `d` | `web/app.js` keydown handler |
| Themes, Carbon default | `web/styles.css` `data-theme` |
| Static risk audit of SKILL.md and companion scripts | `src/audit.js` |
| Identical-copy detection by content hash | `attachCopies` |
| Origin inference from frontmatter, path, plugin.json, git remote | `src/origin.js` |
| `PORT`, no-open env, port fallback, loopback only | `src/server.js` |
| Runs from npm or straight from GitHub with `npx` | `bin/skill-drawer.js`, no build step |

## Added, one per gap in the original review

| Gap | What was built |
|---|---|
| **No undo on delete** | Delete moves the skill to `~/.skill-drawer/trash/<stamp>-<name>/` with a `meta.json` recording the original path and type (folder, file, symlink). Restore from the Trash panel, the undo toast, or `skill-drawer trash restore`. Permanent delete is a separate, labelled button. |
| **Only lever is deletion** | Disable moves a skill to `~/.skill-drawer/disabled/…`, so the tool stops loading it; Enable moves it back. Disabled skills stay listed and greyed. Bulk disable from the selection bar. |
| **Tool-managed copies reappear after delete** | Builtin and plugin drawers are flagged `writable: false`. Edit, rename and disable are refused there with an explanation; delete still works if you insist. |
| **No validation or linting** | `src/lint.js`: missing or invalid frontmatter, missing `name` or `description`, name length and format, name not matching the folder, description length and HTML, `metadata` and `compatibility` shape, unknown keys, empty body, over-long or oversized SKILL.md, relative links that point at files not in the folder. Surfaces as a badge, a Health tab, the Issues panel, and `skill-drawer lint` (non-zero exit on errors, so it works in CI). |
| **No duplicate or conflict detection** | `src/conflicts.js`: identical copies, same name with different content (per drawer or across tools), near-identical names by edit distance, overlapping descriptions by keyword Jaccard similarity. Copies are collapsed to one representative so a duplicate is never reported twice. |
| **User-level drawers only** | Walks up from the working directory and picks up `.claude/skills`, `.agents/skills`, `.codex/skills`, `.cursor/skills`, `.gemini/skills`, `.github/skills`, `.windsurf/skills`, `.kiro/skills`, `.opencode/skills`, `.copilot/skills` and a bare `skills/` at every level. `--root <dir>` adds arbitrary drawers; `--cwd` and `--no-project` control the walk. |
| **Read only, no create, edit or rename** | Edit tab with a textarea for any file in the skill (Ctrl/Cmd+S), path-confined writes. Open in `$EDITOR`. New skill scaffolds a folder and SKILL.md. Rename moves the folder and rewrites the frontmatter `name`. |
| **No install or import** | Install from `owner/repo`, `owner/repo@ref`, `owner/repo/path`, a GitHub URL, or a local folder; every folder with a SKILL.md under the source is copied, optionally filtered by name. |
| **No sync, backup or export** | Manifest export (name, drawer, path, origin, hash) and bundle export (manifest plus every file, text as UTF-8 and binaries as base64). Import writes bundles into a chosen drawer and can fetch manifest-only entries from their GitHub origin. Both from the UI and the CLI. |
| **No usage signals** | Modified, added and last-read times, size, file count, content hash; sort by recently modified, recently added, largest, riskiest, most lint. |
| **No read-only mode** | `--read-only` or `SKILL_DRAWER_READ_ONLY=1` refuses every mutating request server-side; the UI hides the buttons too. |
| **Localhost, no auth** | Still localhost-only by design. Cross-origin browser requests are rejected, markdown is sanitised with DOMPurify, and file reads and writes are confined to the skill folder. |
| **No CLI** | `list`, `lint`, `issues`, `drawers`, `export`, `import`, `install`, `disable`, `enable`, `trash`, each with `--json` where it makes sense. |

## Added in 0.2.0

| Request | What was built |
|---|---|
| **Classify per agent** | `src/agents.js` maps every drawer folder to the agent that reads it. Drawers and skills carry `agentId` / `agentLabel`; the API returns an `agents` list; the sidebar is an agent tree with drawers nested; cards show an agent chip; default sort is by agent; `skill-drawer agents` in the CLI. |
| **Archive and unarchive from the UI** | A third store next to trash and disabled: `~/.skill-drawer/archive`. Archive from the toolbar, selection bar or CLI. The Archive panel lists entries with agent, drawer, description and original path, and can unarchive to the original location, into any other agent's drawer, or delete. Undo toast after archiving. |
| **Transport / copy skills across agents** | `copySkill` in `src/scan.js` copies or moves a folder, file or symlink (dereferenced) into another drawer, skipping `node_modules` and `.git`, with overwrite and rename. Copy to… / Move to… on a skill or a selection; drawer picker grouped by agent; keys `c` and `m`; CLI `copy` and `move`. |
| **Edit skills** | Edit button in the toolbar. The Edit tab gained a metadata form (description and other frontmatter keys) backed by `PUT /api/skills/:id/frontmatter`, which rewrites the frontmatter block and leaves the body byte-for-byte; plus New file and Delete file (`DELETE /api/skills/:id/file`) next to the file editor. |

## Added in 0.3.0

| Request | What was built |
|---|---|
| **Compare two skills and assess quality with a chat-completions API the user configures** | `src/ai.js`: a raw-HTTP client with two wire formats, OpenAI chat completions (`POST {baseUrl}/chat/completions`, Bearer key, `response_format: json_object` with automatic fallback) and Anthropic Messages (`POST {baseUrl}/v1/messages`, `x-api-key`). Settings in `~/.skill-drawer/ai.json` with env overrides and presets. Two prompts with strict JSON schemas: assessment (score, grade, five dimensions, strengths, weaknesses, suggestions, improved description) and comparison (overlap, same job, per-skill quality, keep/merge recommendation, merge plan, trigger fix). Results cached by model and content hash. UI: AI ⚙ settings with Test, Assess (AI) button and AI tab with Apply-description, Compare with… picker, Compare (AI) for two marked skills, Compare on two-skill conflicts in Issues. CLI: `ai`, `assess`, `compare`. |

## Added in 0.4.0

| Request | What was built |
|---|---|
| **Support Copilot** | `src/agents.js` knows GitHub Copilot's user drawer (`~/.copilot/skills`), project drawer (`.github/skills`) and three detection signals (`~/.copilot`, the `copilot` CLI, the `github.copilot` VS Code extension). |
| **Only show agents available locally** | `detectAgents` checks home folders, PATH binaries and app folders. The sidebar lists an agent only when it is installed or already holds skills; installed agents without a skills folder get a placeholder drawer (`exists: false`) that is created on first write. Hover shows the evidence. |
| **Open and close the drawer** | Agent groups collapse and expand with a chevron; the closed set is persisted in localStorage. "Create & open folder" on a placeholder drawer creates it and opens it in the file manager. |
| **Skill quality check, deep** | `src/quality.js`: a 0–100 static score with five explained parts; `qualityScore`/`qualityGrade` on every catalog entry; `Q` chip and sort; `GET /api/quality`; Quality panel with the top deductions per skill and batch AI assessment (two workers, progress bar); `skill-drawer quality`. |
| **Skill overlap check, deep** | `src/overlap.js`: description-weighted pairwise overlap with name and body components, identical-copy detection, same drawer / same agent / across agents tags; `GET /api/overlap` with threshold, agent scope and id filter; Overlap panel with threshold slider, per-pair AI verdict, top-10 AI batch; `skill-drawer overlap`. |
| **Comparison, deep** | Comparison view combines the AI verdict with static overlap and quality, a colour line diff of both SKILL.md files (`src/diff.js`, `GET /api/skills/:id/diff`), and quick actions: copy A's description to B or B's to A, and trash the skill the model recommends dropping. |

## Added in 0.5.0

| Request | What was built |
|---|---|
| **Remove the duplicated top-bar items** | `Export`, `Archive` and `Trash` existed both in the top bar (a place) and on a skill (an action). The top bar now has two menus — **Checks** (Quality, Overlap, Issues) and **Shelf** (Archived, Deleted, Import, Export) — cutting thirteen controls to six and keeping the search box from being squeezed out. |
| **Do we need the checkbox on the skill item?** | Kept, but no longer permanent clutter: it fades in on card hover, when anything is marked, or on keyboard focus. `x`, Select all and the bulk bar are unchanged. |
| **"Agents (shared)" not needed** | `.agents` is marked `shared: true` — a cross-tool convention, never a product — so it gets no placeholder drawer and appears only when it holds skills. Any agent can also be hidden outright from the new Agents settings panel (`~/.skill-drawer/agents.json`). |
| **Collapsible agents for skills** | The skill list is grouped into per-agent sections with a chevron, a count and a marked count. Collapse state persists, and opening a skill inside a closed group expands it. "Group by agent" toggles back to a flat list. |
| **Microsoft 365 Copilot skills** | New built-in agent: detection from `~/.m365`, `~/.microsoft365agents`, `~/.fx`, `~/.copilotstudio` and the `m365` / `atk` / `teamsfx` / `pac` CLIs; user drawer `~/.m365/skills`; project drawers `.m365/skills`, `.microsoft365agents/skills`, `appPackage/skills`. Because Microsoft's layout is still settling, the custom-agent feature covers any variation. |
| **Custom agents** | `src/settings.js` stores user-defined agents (id, label, absolute user folder, project folders) and hidden agent ids. They are scanned at their absolute path, appear in the sidebar and grouping, and are valid targets for copy, move, install and import. |

### Bugs found and fixed during this pass

- The bulk action bar did not wrap, so on a narrow window its buttons overflowed the list column and sat underneath the detail pane, where clicks never reached them.
- A custom agent whose folder already existed was reported as an empty placeholder, because only `~/.<tool>/skills` paths were covered by the home scan.
- Agent presence was computed from the real home directory even when the server was started with an explicit `home`, so tests and sandboxed runs saw the wrong agents.

## Added in 0.5.1

| Request | What was built |
|---|---|
| **Drop New, Install and Shelf from the top bar** | The top bar is now search, Checks, AI, rescan, theme and help. New and Install moved to the list header and default to the drawer in view (previously always `~/.claude/skills`), with Import and Export under a `⋯` menu beside them. Archived and Deleted moved into a sidebar **Shelf** section together with Disabled, so every "place a skill can be" sits in one column. Trash restore stays visible because it is the undo for a destructive action, and the panels were renamed to Archived/Deleted so they no longer share a label with the Archive/Trash buttons on a skill. |

## Added in 0.6.0

| Change | What was built |
|---|---|
| **Live reload** | `src/watch.js` wraps `fs.watch` with recursive detection, a shallow fallback, debouncing, a watcher cap and a mute window so Skill Drawer's own writes do not echo. `GET /api/events` is an SSE stream; the page reloads on `changed`, and holds off while the editor has unsaved changes. |
| **Sync across agents** | `GET/POST /api/skills/:id/sync` finds same-named skills in other writable drawers, reports which already match, and overwrites the chosen ones. UI dialog with per-target ticks and a destructive-action confirm; `skill-drawer sync --dry-run` on the CLI. |
| **One-click lint fixes** | `src/lint.js` tags mechanically repairable findings with a `fix` key; `POST /api/skills/:id/fix` applies it. Covers `name.missing`, `name.format` and `name.mismatch` by rewriting the frontmatter name to the folder slug. Fix buttons appear in the Health tab and the Issues panel. |
| **Committed browser tests** | `test/browser.test.js`: eight Playwright tests over load-without-errors, badge parity between card and header, overflow and clickability at three widths, trash-and-restore, one-click fix, sync, live reload and the Issues cap. They probe for a launchable browser and skip rather than fail without one; a CI job installs Chromium and runs them. |
| **Capped Issues panel** | Findings group by kind, each capped at eight with a "show more" expander, so hundreds of overlap pairs stay readable. |
| **Fewer filters, themes and export formats** | Four "Show" checkboxes become one **Needs attention**; five themes become Auto/Dark/Light with Auto following `prefers-color-scheme`; Export always writes a bundle in the UI, with `--manifest` kept on the CLI. The unused `~/.<tool>/skill` singular scan is gone. |

## Added in 0.7.0

| Request | What was built |
|---|---|
| **Cowork's path does not load; it is in personal OneDrive** | `src/onedrive.js` locates OneDrive from the `OneDriveConsumer` / `OneDrive` / `OneDriveCommercial` env vars, then `~/OneDrive`, `~/OneDrive - <Org>` and macOS `~/Library/CloudStorage/OneDrive-*`, preferring folders that exist. The Cowork agent resolves `<root>/Documents/Cowork/Skills` for every root plus `~/Documents/Cowork/Skills` for Known Folder Move. Agents can now declare several user folders (`userSkillsPaths`), and every resolved folder that exists becomes a drawer — the home dot-folder scan never reached OneDrive. Renamed to **Microsoft Cowork**, and Teams Toolkit signals were dropped so it no longer reports installed for an unrelated product. |
| **Remove Agents (shared)** | The built-in entry is gone, `.agents` is in the home skip list, and `.agents/skills` is out of the project search path, so nothing about it is scanned or listed. A custom agent covers anyone who still uses it. |
| **Claude Code → Claude** | Label change. |
| **Smarter search** | `web/query.js`, a dependency-free module shared by the page and the test suite: a tokenizer that keeps `"quoted phrases"` together, negation, ten field filters, comparison operators on ranked and numeric fields, boolean flags, relevance scoring by match location, a fuzzy subsequence fallback, and merged match ranges for highlighting. `web/app.js` became an ES module so it can import it; results sort by relevance while a query is present, matches are highlighted with `<mark>`, and the syntax is documented in the help dialog. |

## Out of scope, on purpose

- **Multi-user or remote access.** The server binds to 127.0.0.1 and has no auth; putting it on a network would need both.
- **Editing tool-managed skills in place.** The tool's updater owns those folders. Copy one into a user drawer if you want your own version.
- **Executing skills or sandboxing scripts.** The risk audit is static pattern matching, not a verdict.
- **A registry.** Install takes a Git repo or folder; there is no central index.

## Verification

- `npm test`: 27 tests over lint, conflicts, drawer discovery, scanning, trash and disabled stores, manifests, install, and the HTTP API including read-only refusal and cross-origin rejection.
- Browser run against a fixture home covering trash, undo, disable, enable and rename, plus screenshots of every tab and two themes.
- `npm run lint` syntax-checks every file; CI runs both on Linux, macOS and Windows with Node 20 and 22.
