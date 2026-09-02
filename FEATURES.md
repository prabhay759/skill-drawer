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

## Out of scope, on purpose

- **Multi-user or remote access.** The server binds to 127.0.0.1 and has no auth; putting it on a network would need both.
- **Editing tool-managed skills in place.** The tool's updater owns those folders. Copy one into a user drawer if you want your own version.
- **Executing skills or sandboxing scripts.** The risk audit is static pattern matching, not a verdict.
- **A registry.** Install takes a Git repo or folder; there is no central index.

## Verification

- `npm test`: 27 tests over lint, conflicts, drawer discovery, scanning, trash and disabled stores, manifests, install, and the HTTP API including read-only refusal and cross-origin rejection.
- Browser run against a fixture home covering trash, undo, disable, enable and rename, plus screenshots of every tab and two themes.
- `npm run lint` syntax-checks every file; CI runs both on Linux, macOS and Windows with Node 20 and 22.
