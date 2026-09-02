# Changelog

## 0.6.0

**Added**

- **Live reload.** The server watches every drawer and pushes changes over SSE, so editing a skill in your editor updates the page immediately. Reloads are skipped while you have unsaved edits open, and the watcher mutes itself briefly after Skill Drawer's own writes so they never echo back.
- **Sync across agents.** `Sync…` on a skill overwrites its same-named copies in other agents with this version, showing which are already identical. `skill-drawer sync <name> [--dry-run]` on the command line.
- **One-click lint fixes.** Mechanically repairable findings — a missing, badly formatted, or folder-mismatched frontmatter `name` — carry a **Fix** button in the Health tab and the Issues panel.
- **Committed browser tests.** Eight Playwright tests run in CI and cover the defects unit tests cannot see: controls overflowing their column, element ids drifting out of the markup, badges rendered from the wrong object shape, and a full trash-and-restore round trip. They skip cleanly when no browser is installed, so `npm test` still works on a bare checkout.

**Simplified**

- **The Issues panel is capped.** Findings are grouped by kind, each group shows the first eight with a "show more" expander. A drawer with hundreds of overlaps is now readable.
- **Two filters instead of four.** "With lint problems", "With risk findings" and "With duplicates" collapse into one **Needs attention**; the reports cover the detail.
- **Three themes instead of five.** Auto (follows your system), Dark and Light. Nord, Solar and Mono are gone.
- **One Export.** Always the full bundle, which is the only form that restores anywhere. `skill-drawer export --manifest` still writes the small form.
- **Dropped the `~/.<tool>/skill` scan.** Inherited from skill-cabinet; no tool uses the singular folder.

## 0.5.2

- **Fixed:** the detail header printed `undefined lint`, and silently omitted the quality chip and the identical-copies badge. Badges are rendered for two object shapes — the trimmed catalog entry behind each card and the full skill behind the header — and only the card shape carried `lintCount`, `copyCount` and `qualityScore`. Badges now read either shape, so a skill looks the same in the list and in its header.

## 0.5.1

- **A top bar of five controls.** New, Install and the Shelf menu leave the top bar, which is now just search, **Checks**, AI settings, rescan, theme and help.
- **New and Install move to the list header**, where they default to the drawer you are currently viewing instead of always guessing `~/.claude/skills`. Import and Export sit beside them under `⋯`.
- **Archived and Deleted move to the sidebar**, under a Shelf section with Disabled — the three places a skill sits when it is not active, next to the agents and drawers where active skills live. Nothing became unreachable: trash restore is the undo for a destructive action, so it keeps a visible home.
- Panels are named for the place (**Archived**, **Deleted**) while the buttons on a skill keep the verb (Archive, Trash), so the two never read the same again.

## 0.5.0

- **Toolbar without duplicate labels.** The top bar had `Export`, `Archive` and `Trash`, which also exist as buttons on a skill and mean something different there (a place versus an action). They now live in two menus: **Checks** (Quality report, Overlap report, Issues) and **Shelf** (Archived, Deleted, Import, Export). Thirteen buttons become six, and the search box no longer gets squeezed out on a narrow window.
- **Checkboxes only when you need them.** A skill's checkbox is invisible until you hover the card, mark something, or focus it with the keyboard. Marking with `x`, Select all and the bulk bar are unchanged.
- **Skill list grouped by agent.** The list has collapsible per-agent sections showing the count and how many are marked; the collapsed set is remembered, and navigating into a closed group opens it. Untick "Group by agent" for a flat list.
- **"Agents (shared)" is gone unless it holds skills.** `~/.agents/skills` is a cross-tool convention, not a product, so it no longer gets an empty placeholder drawer.
- **Agents settings.** "edit" beside the AGENTS heading opens a panel to show or hide any agent, and to add your own: give it a name, an absolute skills folder and optional project folders, and it is scanned like any built-in. Stored in `~/.skill-drawer/agents.json`.
- **Microsoft 365 Copilot.** Detected from `~/.m365`, `~/.microsoft365agents`, `~/.fx`, `~/.copilotstudio` or the `m365`, `atk`, `teamsfx` and `pac` CLIs; user drawer `~/.m365/skills`, project drawers `.m365/skills`, `.microsoft365agents/skills` and `appPackage/skills`. Microsoft's own layout is still settling, so use a custom agent if your setup differs.
- **Fixed:** the bulk action bar overflowed its column and its buttons slid under the detail pane, where they could not be clicked.
- **Fixed:** a custom agent whose folder already existed was listed as an empty placeholder because only `~/.<tool>/skills` paths were scanned.

## 0.4.0

- **Only agents that are actually here.** Skill Drawer now detects installed agents (home folder such as `~/.copilot`, a binary on PATH such as `codex`, or a VS Code extension such as GitHub Copilot) and lists an agent only when it is installed or already holds skills. Installed agents without a skills folder get a placeholder drawer that is created on first copy, install or "Create & open folder".
- **GitHub Copilot, first class.** Detected via `~/.copilot`, the `copilot` CLI, or the `github.copilot` VS Code extension; user drawer `~/.copilot/skills`, project drawer `.github/skills`.
- **Open and close drawer groups.** Each agent group in the sidebar collapses with a chevron; the state is remembered. Hover an agent to see how it was detected.
- **Quality check, deep.** A static 0–100 score with five explained parts (frontmatter 20, description-as-trigger 30, instructions 25, safety 15, structure 10) on every skill, a `Q` chip on cards, sort by lowest quality, and a Quality panel that lists what to fix first and can run the AI assessment over every skill in the current scope with progress. `skill-drawer quality`.
- **Overlap check, deep.** A pairwise static overlap score (description-weighted, then body, then name) with an adjustable threshold, "same drawer / same agent / across agents" severity, identical-copy detection, and per-pair or top-10 AI verdicts. `skill-drawer overlap`.
- **Comparison, deep.** The comparison view now adds static overlap and quality alongside the AI verdict, a colour line diff of the two SKILL.md files, and quick actions: copy one description onto the other skill, or trash the skill the model recommends dropping.

## 0.3.0

- **AI quality assessment.** An Assess (AI) button and an AI tab score a skill 0–100 with a grade, five dimensions (trigger, clarity, completeness, structure, safety), strengths, weaknesses, concrete suggestions and a rewritten description you can apply with one click. `skill-drawer assess <name>` from the CLI.
- **AI comparison of two skills.** Compare with… on any skill, Compare (AI) when exactly two are marked, and a Compare button on every two-skill conflict in the Issues panel. Reports overlap, whether they do the same job, quality of each, a keep-A / keep-B / keep-both / merge recommendation with rationale, a merge plan and a trigger fix. `skill-drawer compare <a> <b>`.
- **Bring your own model.** AI ⚙ in the top bar: pick a preset (OpenAI, Anthropic native or OpenAI-compatible, OpenRouter, Groq, Ollama, LM Studio, custom) or enter any base URL, model and API key. Two wire formats: OpenAI chat completions and Anthropic Messages. Settings in `~/.skill-drawer/ai.json` (mode 600) or via `SKILL_DRAWER_AI_*` environment variables; the key can also come from `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` etc. Test button. Results are cached by model and content hash; Re-assess bypasses the cache.

## 0.2.0

- **Per-agent classification.** Every drawer and skill carries the agent that reads it (Claude Code, Cursor, Codex, Gemini, GitHub Copilot, Windsurf, Kiro, OpenCode and more; unknown dot-folders are named after the folder). The sidebar is an agent tree with drawers nested underneath, cards show an agent chip, sort by agent is the default, and `skill-drawer agents` groups from the CLI.
- **Archive shelf.** Archive moves a skill out of every agent into `~/.skill-drawer/archive` with its agent, drawer and description recorded. The Archive panel lists what is shelved and can unarchive back to the original drawer, into any other agent's drawer, or delete for good. Undo toast on archive. CLI: `archive`, `archive list`, `unarchive`.
- **Copy and move across agents.** Copy to… and Move to… on a skill or a selection, with a drawer picker grouped by agent, optional rename, and overwrite. Symlinks are dereferenced so the target gets a real copy; `node_modules` and `.git` are skipped. Keys `c` and `m`. CLI: `copy`, `move`.
- **Editing.** Edit button in the toolbar. The Edit tab now has a metadata form (description plus other frontmatter keys) that rewrites the frontmatter block without touching the body, and New file / Delete file for the skill folder alongside the file editor.

## 0.1.0

First release. Everything skill-cabinet offers (scan user drawers, filter, search, read, delete, keyboard, themes, risk audit, origin inference) plus:

- Trash with restore and undo, disable/enable quarantine
- Frontmatter and structure lint
- Duplicate and trigger-conflict detection
- Project-local drawer scanning and `--root`
- In-place editor, open in `$EDITOR`, create and rename
- Manifest / bundle export and import
- Install from GitHub or a local folder
- Read-only mode
- Full CLI: `list`, `lint`, `issues`, `drawers`, `export`, `import`, `install`, `disable`, `enable`, `trash`
