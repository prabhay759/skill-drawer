import fs from "node:fs";
import path from "node:path";
import { scanSkills, toCatalogSkill, copySkill, agentPresence } from "./scan.js";
import { overlapPairs } from "./overlap.js";
import { exportManifest, importManifest, parseManifest } from "./manifest.js";
import { installSkills } from "./install.js";
import { listStore, restore, purge, purgeAll, stash } from "./store.js";
import { startServer } from "./server.js";
import { drawerHome } from "./util.js";
import { publicConfig, saveConfig, testConnection, assessSkill, compareSkills, clearCache, PRESETS } from "./ai.js";
import { readSkill } from "./scan.js";

const HELP = `skill-drawer — browse, lint and organise agent skills across every drawer

Usage
  skill-drawer [options]                 open the web UI (default)
  skill-drawer list [--json]             list skills across all drawers
  skill-drawer lint [--json]             validate frontmatter and structure
  skill-drawer issues [--json]           duplicates, conflicts, lint, risk
  skill-drawer export [file] [--manifest]
                                         full bundle by default; --manifest is the
                                         small form (needs GitHub origins to restore)
  skill-drawer import <file> [--drawer <path>] [--overwrite] [--fetch]
  skill-drawer install <src> [--drawer <path>] [--overwrite]
                                         src: owner/repo, owner/repo/path, GitHub URL, local folder
  skill-drawer disable <name|path>       quarantine a skill (reversible)
  skill-drawer enable <name>             put a disabled skill back
  skill-drawer archive <name|path>       shelve a skill outside every agent
  skill-drawer unarchive <entry> [--drawer <path>]
  skill-drawer archive list              what is on the shelf
  skill-drawer copy <name|path> --drawer <path> [--overwrite]
  skill-drawer move <name|path> --drawer <path> [--overwrite]
  skill-drawer sync <name|path> [--dry-run]
                                         overwrite same-named copies in other agents
  skill-drawer agents                    installed agents and their skills
  skill-drawer quality [--json]          static quality score for every skill
  skill-drawer overlap [--threshold 0.35] [--json]
                                         pairs of skills likely to trigger on the same request
  skill-drawer trash [list|restore <entry>|empty|purge <entry>]
  skill-drawer ai [show|set <key>=<value>…|test|presets|clear-cache]
                                         configure the model used for assess/compare
                                         keys: provider (openai|anthropic), baseUrl, model, apiKey, temperature, maxTokens
  skill-drawer assess <name|path> [--json] [--force]
                                         AI quality assessment of one skill
  skill-drawer compare <a> <b> [--json] [--force]
                                         AI comparison of two skills
  skill-drawer drawers                   show the drawers that were found

Options
  --port <n>          port for the UI (default 3782, or PORT)
  --no-open           do not open a browser
  --read-only         browse only; every mutating action is refused
  --root <dir>        add an extra drawer root (repeatable)
  --no-project        skip project-local drawers under the current directory
  --cwd <dir>         directory to walk up from for project drawers
  --json              machine-readable output for list/lint/issues/drawers
  -h, --help          this help
  -v, --version       version

Environment
  PORT, SKILL_DRAWER_NO_OPEN=1, SKILL_DRAWER_READ_ONLY=1,
  SKILL_DRAWER_HOME (trash/disabled store, default ~/.skill-drawer),
  SKILL_DRAWER_EDITOR / VISUAL / EDITOR (for "open in editor")
`;

function parseArgs(argv) {
  const flags = { roots: [], project: true, open: true, readOnly: process.env.SKILL_DRAWER_READ_ONLY === "1" };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--port") flags.port = Number(next());
    else if (a === "--no-open") flags.open = false;
    else if (a === "--read-only" || a === "--readonly") flags.readOnly = true;
    else if (a === "--root") flags.roots.push(path.resolve(next()));
    else if (a === "--no-project") flags.project = false;
    else if (a === "--cwd") flags.cwd = path.resolve(next());
    else if (a === "--json") flags.json = true;
    else if (a === "--bundle") flags.bundle = true;
    else if (a === "--manifest") flags.manifest = true;
    else if (a === "--drawer") flags.drawer = path.resolve(next().replace(/^~(?=$|\/)/, process.env.HOME || ""));
    else if (a === "--overwrite") flags.overwrite = true;
    else if (a === "--fetch") flags.fetch = true;
    else if (a === "--force") flags.force = true;
    else if (a === "--threshold") flags.threshold = Number(next());
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--quiet" || a === "-q") flags.quiet = true;
    else if (a === "-h" || a === "--help") flags.help = true;
    else if (a === "-v" || a === "--version") flags.version = true;
    else if (a.startsWith("-")) throw new Error(`Unknown option ${a}`);
    else positional.push(a);
  }
  return { flags, positional };
}

function scanOpts(flags) {
  return { cwd: flags.cwd || process.cwd(), extraRoots: flags.roots, project: flags.project };
}

function pad(s, n) {
  s = String(s ?? "");
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function table(rows, headers) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (r) => r.map((c, i) => pad(c, widths[i])).join("  ").trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

function pickDrawer(index, flags) {
  if (flags.drawer) return { root: flags.drawer, label: flags.drawer };
  return (
    index.drawers.find((d) => d.writable && /\.claude\/skills$/.test(d.root)) ||
    index.drawers.find((d) => d.writable && d.kind === "user") ||
    { root: path.join(process.env.HOME || "", ".claude", "skills"), label: "~/.claude/skills" }
  );
}

function findByNameOrPath(index, query) {
  const abs = path.resolve(query);
  return (
    index.skills.find((s) => s.path === abs) ||
    index.skills.find((s) => s.name === query || s.slug === query) ||
    null
  );
}

export async function runCli(argv) {
  const { flags, positional } = parseArgs(argv);
  if (flags.help) {
    process.stdout.write(HELP);
    return;
  }
  if (flags.version) {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    console.log(pkg.version);
    return;
  }
  const [cmd, ...rest] = positional;
  const out = (obj) => console.log(JSON.stringify(obj, null, 2));

  switch (cmd) {
    case undefined:
    case "ui":
    case "serve": {
      await startServer({
        port: flags.port,
        open: flags.open,
        readOnly: flags.readOnly,
        quiet: flags.quiet,
        ...scanOpts(flags),
      });
      return;
    }
    case "list": {
      const index = scanSkills(scanOpts(flags));
      if (flags.json) return out(index.skills.map(toCatalogSkill));
      console.log(
        table(
          index.skills.map((s) => [
            s.disabled ? `${s.name} (disabled)` : s.name,
            s.drawerLabel,
            s.lint === "ok" ? "" : s.lint,
            s.risk === "none" ? "" : s.risk,
            s.copies.length ? `${s.copies.length} copies` : "",
            s.path,
          ]),
          ["name", "drawer", "lint", "risk", "dupes", "path"],
        ),
      );
      const c = index.census;
      console.log(`\n${c.total} skills (${c.disabled} disabled), ${c.unique} unique, ${c.conflicts} issues, ${c.trash} in trash`);
      return;
    }
    case "agents": {
      const index = scanSkills(scanOpts(flags));
      const presence = agentPresence();
      const groups = new Map();
      for (const d of index.drawers) {
        if (!groups.has(d.agentId)) {
          const p = presence.find((x) => x.id === d.agentId);
          groups.set(d.agentId, { id: d.agentId, label: d.agentLabel, installed: Boolean(p?.installed), via: p?.via || [], drawers: [], skills: [] });
        }
        groups.get(d.agentId).drawers.push({ label: d.label, root: d.root, exists: d.exists !== false, writable: d.writable, kind: d.kind });
      }
      for (const s of index.skills) groups.get(s.agentId)?.skills.push(s);
      if (flags.json) return out([...groups.values()].map((g) => ({ ...g, skills: g.skills.map(toCatalogSkill) })));
      for (const g of groups.values()) {
        const n = g.skills.length;
        console.log(`${g.label} — ${n} skill${n === 1 ? "" : "s"}${g.installed ? `, installed (${g.via.join(", ")})` : ", not detected; skills folder present"}`);
        for (const d of g.drawers) {
          const mine = g.skills.filter((s) => s.drawerLabel === d.label);
          console.log(`  ${d.label}${d.exists ? "" : "  (not created yet)"}${d.writable ? "" : "  (tool-managed)"}`);
          for (const s of mine) console.log(`    Q${String(s.quality.score).padStart(3)} ${s.quality.grade}  ${s.disabled ? "[disabled] " : ""}${s.name}`);
        }
      }
      return;
    }
    case "quality": {
      const index = scanSkills(scanOpts(flags));
      const rows = index.skills.slice().sort((a, b) => a.quality.score - b.quality.score);
      if (flags.json) return out(rows.map((s) => ({ id: s.id, name: s.name, path: s.path, agent: s.agentLabel, quality: s.quality })));
      console.log(table(rows.map((s) => [String(s.quality.score), s.quality.grade, s.name, s.agentLabel, s.quality.parts.filter((p) => p.points < p.max).map((p) => `${p.label.toLowerCase()}: ${p.note}`).join("; ").slice(0, 90)]), ["score", "grade", "name", "agent", "what to fix"]));
      return;
    }
    case "overlap": {
      const index = scanSkills(scanOpts(flags));
      const r = overlapPairs(index.skills, { threshold: flags.threshold ?? 0.35 });
      if (flags.json) return out(r);
      if (!r.pairs.length) console.log(`No pairs above ${(flags.threshold ?? 0.35) * 100}% overlap across ${r.considered} skills.`);
      for (const p of r.pairs) {
        console.log(`${String(Math.round(p.score * 100)).padStart(3)}%  ${p.level.padEnd(9)} ${p.a.name} (${p.a.agentLabel})  ⟷  ${p.b.name} (${p.b.agentLabel})${p.sameAgent ? "  [same agent]" : ""}`);
        console.log(`       name ${Math.round(p.name * 100)}%  description ${Math.round(p.description * 100)}%  body ${Math.round(p.body * 100)}%`);
      }
      console.log(`\n${r.total} pair${r.total === 1 ? "" : "s"} above threshold; run "skill-drawer compare <a> <b>" for the AI verdict on one.`);
      return;
    }
    case "archive": {
      const sub = rest[0];
      if (!sub || sub === "list") {
        const entries = listStore("archive");
        if (flags.json) return out(entries);
        if (!entries.length) console.log(`Archive is empty (${path.join(drawerHome(), "archive")})`);
        else console.log(table(entries.map((e) => [e.entryId, e.name, e.agentLabel || "", new Date(e.at).toISOString(), e.originalPath]), ["entry", "name", "agent", "archived", "original path"]));
        return;
      }
      const index = scanSkills(scanOpts(flags));
      const s = findByNameOrPath(index, sub);
      if (!s) throw new Error(`No skill named ${sub}`);
      const entry = stash("archive", s, { agentId: s.agentId, agentLabel: s.agentLabel, description: s.description });
      console.log(`archived ${s.name} -> ${entry.payloadPath}`);
      return;
    }
    case "unarchive": {
      if (!rest[0]) throw new Error("unarchive needs an entry id (see: skill-drawer archive list)");
      let target;
      if (flags.drawer) {
        const entry = listStore("archive").find((e) => e.entryId === rest[0]);
        if (!entry) throw new Error("Entry not found");
        target = path.join(flags.drawer, entry.type === "dir" ? path.basename(entry.originalPath) : entry.payload);
      }
      const r = restore("archive", rest[0], { target });
      console.log(`unarchived ${r.name} -> ${r.restoredTo}`);
      return;
    }
    case "sync": {
      if (!rest[0]) throw new Error("sync needs a skill name or path");
      const index = scanSkills(scanOpts(flags));
      const source = findByNameOrPath(index, rest[0]);
      if (!source) throw new Error(`No skill named ${rest[0]}`);
      const key = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const targets = index.skills.filter((s) => s.id !== source.id && !s.disabled && s.writable && key(s.name) === key(source.name));
      if (!targets.length) throw new Error(`No other agent has a skill named ${source.name}`);
      for (const t of targets) {
        const same = t.contentHash === source.contentHash;
        if (flags.dryRun) { console.log(`${same ? "in sync  " : "would sync"} ${t.agentLabel.padEnd(20)} ${t.path}`); continue; }
        if (same) { console.log(`in sync   ${t.agentLabel.padEnd(20)} ${t.path}`); continue; }
        const drawer = index.drawers.find((d) => d.id === t.drawerId);
        copySkill(source, drawer, { overwrite: true, newName: path.basename(t.path) });
        console.log(`synced    ${t.agentLabel.padEnd(20)} ${t.path}`);
      }
      return;
    }
    case "copy":
    case "move": {
      if (!rest[0]) throw new Error(`${cmd} needs a skill name or path`);
      if (!flags.drawer) throw new Error(`${cmd} needs --drawer <path>`);
      const index = scanSkills(scanOpts(flags));
      const s = findByNameOrPath(index, rest[0]);
      if (!s) throw new Error(`No skill named ${rest[0]}`);
      const drawer = index.drawers.find((d) => d.root === flags.drawer) || { root: flags.drawer, label: flags.drawer, writable: true };
      const r = copySkill(s, drawer, { move: cmd === "move", overwrite: flags.overwrite });
      console.log(`${cmd === "move" ? "moved" : "copied"} ${s.name} -> ${r.to}`);
      return;
    }
    case "ai": {
      const sub = rest[0] || "show";
      if (sub === "show") {
        const c = publicConfig();
        if (flags.json) return out(c);
        console.log(table([["provider", c.provider], ["baseUrl", c.baseUrl], ["model", c.model || "(not set)"], ["apiKey", c.hasKey ? c.keyHint : "(none)"], ["temperature", c.temperature], ["maxTokens", c.maxTokens], ["ready", c.ready ? "yes" : "no"]], ["setting", "value"]));
        return;
      }
      if (sub === "presets") {
        console.log(table(PRESETS.map((p) => [p.id, p.provider, p.baseUrl || "(you choose)", p.model || "(you choose)", p.keyEnv || ""]), ["preset", "provider", "baseUrl", "model", "key env"]));
        return;
      }
      if (sub === "set") {
        const patch = {};
        for (const kv of rest.slice(1)) {
          const i = kv.indexOf("=");
          if (i < 1) throw new Error(`Expected key=value, got ${kv}`);
          const k = kv.slice(0, i);
          const v = kv.slice(i + 1);
          if (k === "preset") {
            const p = PRESETS.find((x) => x.id === v);
            if (!p) throw new Error(`Unknown preset ${v}`);
            Object.assign(patch, { provider: p.provider, baseUrl: p.baseUrl, model: p.model });
          } else if (k === "temperature" || k === "maxTokens" || k === "timeoutMs") patch[k] = Number(v);
          else patch[k] = v;
        }
        const c = saveConfig(patch);
        console.log(`saved: provider=${c.provider} baseUrl=${c.baseUrl} model=${c.model || "(not set)"} apiKey=${c.hasKey ? c.keyHint : "(none)"}`);
        return;
      }
      if (sub === "test") {
        const r = await testConnection();
        console.log(`ok: ${r.model} via ${r.provider} answered "${r.reply}" in ${r.ms} ms`);
        return;
      }
      if (sub === "clear-cache") {
        clearCache();
        console.log("cleared");
        return;
      }
      throw new Error(`Unknown ai command ${sub}`);
    }
    case "assess": {
      if (!rest[0]) throw new Error("assess needs a skill name or path");
      const index = scanSkills(scanOpts(flags));
      const s = findByNameOrPath(index, rest[0]);
      if (!s) throw new Error(`No skill named ${rest[0]}`);
      const r = await assessSkill(readSkill(s), { force: flags.force });
      if (flags.json) return out(r);
      const a = r.result;
      console.log(`${s.name}: ${a.score}/100 (${a.grade})${r.cached ? "  [cached]" : ""}  model ${r.model}`);
      console.log(`\n${a.summary}\n`);
      for (const [k, d] of Object.entries(a.dimensions || {})) console.log(`  ${k.padEnd(13)} ${String(d.score).padStart(2)}/10  ${d.note}`);
      const list = (title, items) => { if (items?.length) { console.log(`\n${title}`); for (const i of items) console.log(`  - ${i}`); } };
      list("Strengths", a.strengths);
      list("Weaknesses", a.weaknesses);
      list("Suggestions", a.suggestions);
      if (a.improvedDescription) console.log(`\nSuggested description:\n  ${a.improvedDescription}`);
      return;
    }
    case "compare": {
      if (!rest[0] || !rest[1]) throw new Error("compare needs two skill names or paths");
      const index = scanSkills(scanOpts(flags));
      const a = findByNameOrPath(index, rest[0]);
      const b = findByNameOrPath(index, rest[1]);
      if (!a) throw new Error(`No skill named ${rest[0]}`);
      if (!b) throw new Error(`No skill named ${rest[1]}`);
      const r = await compareSkills(readSkill(a), readSkill(b), { force: flags.force });
      if (flags.json) return out(r);
      const c = r.result;
      console.log(`A: ${a.name} (${a.drawerLabel})  B: ${b.name} (${b.drawerLabel})${r.cached ? "  [cached]" : ""}  model ${r.model}`);
      console.log(`\n${c.summary}\n\noverlap ${c.overlap}%  same job: ${c.sameJob ? "yes" : "no"}  quality A ${c.scoreA}  B ${c.scoreB}\nrecommendation: ${c.recommendation} — ${c.rationale}`);
      const list = (title, items) => { if (items?.length) { console.log(`\n${title}`); for (const i of items) console.log(`  - ${i}`); } };
      list("Differences", c.differences);
      list("A does better", c.strengthsA);
      list("B does better", c.strengthsB);
      list("Merge plan", c.mergePlan);
      if (c.triggerFix) console.log(`\nTrigger fix:\n  ${c.triggerFix}`);
      return;
    }
    case "drawers": {
      const index = scanSkills(scanOpts(flags));
      if (flags.json) return out(index.drawers);
      console.log(table(index.drawers.map((d) => [d.label, d.kind, d.writable ? "yes" : "no", d.root]), ["drawer", "kind", "writable", "root"]));
      return;
    }
    case "lint": {
      const index = scanSkills(scanOpts(flags));
      const bad = index.skills.filter((s) => s.lint !== "ok");
      if (flags.json) return out(bad.map((s) => ({ id: s.id, name: s.name, path: s.path, status: s.lint, problems: s.lintProblems })));
      for (const s of bad) {
        console.log(`${s.lint.toUpperCase().padEnd(7)} ${s.name}  ${s.path}`);
        for (const p of s.lintProblems) console.log(`         ${p.level}: ${p.message} [${p.rule}]`);
      }
      const errors = bad.filter((s) => s.lint === "error").length;
      console.log(`\n${index.skills.length} skills checked, ${errors} with errors, ${bad.length - errors} with warnings`);
      process.exitCode = errors ? 1 : 0;
      return;
    }
    case "issues": {
      const index = scanSkills(scanOpts(flags));
      if (flags.json) return out({ conflicts: index.conflicts, census: index.census });
      if (!index.conflicts.length) console.log("No duplicates or conflicts found.");
      for (const c of index.conflicts) {
        console.log(`${c.severity.toUpperCase().padEnd(8)} ${c.title}`);
        console.log(`         ${c.detail}`);
        for (const s of c.skills) console.log(`           - ${s.path}`);
      }
      return;
    }
    case "export": {
      const index = scanSkills(scanOpts(flags));
      const data = exportManifest(index.skills.filter((s) => !s.disabled), { includeFiles: !flags.manifest });
      const text = JSON.stringify(data, null, 2) + "\n";
      if (rest[0]) {
        fs.writeFileSync(rest[0], text);
        console.error(`Wrote ${data.skills.length} skills to ${rest[0]}`);
      } else process.stdout.write(text);
      return;
    }
    case "import": {
      if (!rest[0]) throw new Error("import needs a manifest or bundle file");
      const data = parseManifest(fs.readFileSync(rest[0], "utf8"));
      const index = scanSkills(scanOpts(flags));
      const drawer = pickDrawer(index, flags);
      const result = importManifest(data, { drawerRoot: drawer.root, overwrite: flags.overwrite });
      for (const w of result.written) console.log(`imported  ${w.name} -> ${w.path}`);
      for (const s of result.skipped) console.log(`skipped   ${s.name}: ${s.reason}`);
      for (const n of result.needsInstall) {
        if (flags.fetch) {
          try {
            const r = installSkills(n.origin.url, { drawerRoot: drawer.root, only: [n.slug], overwrite: flags.overwrite });
            for (const i of r.installed) console.log(`installed ${i.slug} -> ${i.path}`);
            if (!r.installed.length) console.log(`skipped   ${n.name}: not found in ${n.origin.label}`);
          } catch (err) {
            console.log(`failed    ${n.name}: ${err.message}`);
          }
        } else console.log(`needs     ${n.name}: install from ${n.origin.url} (re-run with --fetch)`);
      }
      return;
    }
    case "install": {
      if (!rest[0]) throw new Error("install needs a source");
      const index = scanSkills(scanOpts(flags));
      const drawer = pickDrawer(index, flags);
      const result = installSkills(rest[0], { drawerRoot: drawer.root, overwrite: flags.overwrite, only: rest.slice(1).length ? rest.slice(1) : null });
      for (const i of result.installed) console.log(`installed ${i.slug} -> ${i.path}`);
      for (const s of result.skipped) console.log(`skipped   ${s.slug}: ${s.reason}`);
      if (!result.installed.length && !result.skipped.length) console.log(`nothing matched; available: ${result.available.join(", ")}`);
      return;
    }
    case "disable": {
      if (!rest[0]) throw new Error("disable needs a skill name or path");
      const index = scanSkills(scanOpts(flags));
      const s = findByNameOrPath(index, rest[0]);
      if (!s) throw new Error(`No skill named ${rest[0]}`);
      if (s.disabled) throw new Error(`${s.name} is already disabled`);
      const entry = stash("disabled", s);
      console.log(`disabled ${s.name} (moved to ${entry.payloadPath})`);
      return;
    }
    case "enable": {
      if (!rest[0]) throw new Error("enable needs a skill name");
      const index = scanSkills(scanOpts(flags));
      const s = index.skills.find((x) => x.disabled && (x.name === rest[0] || x.slug === rest[0]));
      if (!s) throw new Error(`No disabled skill named ${rest[0]}`);
      const r = restore("disabled", s.disabledEntry);
      console.log(`enabled ${s.name} -> ${r.restoredTo}`);
      return;
    }
    case "trash": {
      const sub = rest[0] || "list";
      if (sub === "list") {
        const entries = listStore("trash");
        if (flags.json) return out(entries);
        if (!entries.length) console.log(`Trash is empty (${path.join(drawerHome(), "trash")})`);
        else console.log(table(entries.map((e) => [e.entryId, e.name, new Date(e.at).toISOString(), e.originalPath]), ["entry", "name", "deleted", "original path"]));
        return;
      }
      if (sub === "restore") {
        if (!rest[1]) throw new Error("trash restore needs an entry id");
        const r = restore("trash", rest[1]);
        console.log(`restored ${r.name} -> ${r.restoredTo}`);
        return;
      }
      if (sub === "purge") {
        if (!rest[1]) throw new Error("trash purge needs an entry id");
        purge("trash", rest[1]);
        console.log(`purged ${rest[1]}`);
        return;
      }
      if (sub === "empty") {
        console.log(`purged ${purgeAll("trash")} entries`);
        return;
      }
      throw new Error(`Unknown trash command ${sub}`);
    }
    default:
      throw new Error(`Unknown command ${cmd}. Run skill-drawer --help`);
  }
}
