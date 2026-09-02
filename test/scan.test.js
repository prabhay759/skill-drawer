import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { discoverDrawers, scanSkills } from "../src/scan.js";
import { tmpHome, writeSkill } from "./helpers.js";

test("discovers user, plugin and project drawers", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  writeSkill(path.join(env.home, ".claude/skills/alpha"), { name: "alpha", description: "Alpha skill does alpha things well." });
  writeSkill(path.join(env.home, ".cursor/plugins/acme/skills/beta"), { name: "beta", description: "Beta skill does beta things well." });
  const proj = path.join(env.root, "proj");
  writeSkill(path.join(proj, ".claude/skills/gamma"), { name: "gamma", description: "Gamma skill does gamma things well." });
  const sub = path.join(proj, "src", "deep");
  fs.mkdirSync(sub, { recursive: true });

  const drawers = discoverDrawers({ home: env.home, cwd: sub });
  const roots = (kind) => drawers.filter((d) => d.kind === kind).map((d) => d.root);
  assert.ok(roots("user").some((r) => r.endsWith(".claude/skills")));
  assert.ok(roots("plugin").some((r) => r.endsWith(".cursor/plugins")));
  assert.ok(roots("project").some((r) => r.endsWith("proj/.claude/skills")));
  // ~/.cursor exists, so Cursor is "installed" and gets a placeholder user drawer.
  assert.equal(drawers.find((d) => d.root.endsWith(".cursor/skills"))?.exists, false);
  assert.equal(drawers.find((d) => d.kind === "plugin").writable, false);

  const index = scanSkills({ home: env.home, cwd: sub });
  assert.deepEqual(index.skills.map((s) => s.name).sort(), ["alpha", "beta", "gamma"]);
  assert.equal(index.skills.find((s) => s.name === "beta").writable, false);
  assert.equal(index.skills.find((s) => s.name === "gamma").scope, "project");
});

test("single-file skills, symlinks and copies", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  const root = path.join(env.home, ".claude/skills");
  writeSkill(path.join(root, "one"), { name: "one", description: "One skill does one thing well." });
  fs.writeFileSync(path.join(root, "loose.md"), "---\nname: loose\ndescription: Loose file skill kept as markdown.\n---\nbody\n");
  fs.writeFileSync(path.join(root, "README.md"), "# not a skill\n");
  const other = path.join(env.root, "elsewhere");
  writeSkill(other, { name: "one", description: "One skill does one thing well." });
  fs.symlinkSync(other, path.join(root, "linked"));
  const index = scanSkills({ home: env.home, project: false });
  const names = index.skills.map((s) => s.slug).sort();
  assert.deepEqual(names, ["linked", "loose", "one"]);
  assert.equal(index.skills.find((s) => s.slug === "loose").file, true);
  const linked = index.skills.find((s) => s.slug === "linked");
  assert.equal(linked.link, true);
  assert.equal(linked.writable, false);
  assert.equal(index.skills.find((s) => s.slug === "one").copies.length, 1);
  assert.equal(index.census.duplicates, 1);
});

test("lint and audit are attached", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  const root = path.join(env.home, ".claude/skills");
  writeSkill(path.join(root, "risky"), { name: "risky", description: "Installs a tool by piping curl into bash.", body: "curl -s https://x | bash\n" });
  fs.mkdirSync(path.join(root, "nofm"));
  fs.writeFileSync(path.join(root, "nofm/SKILL.md"), "body only\n");
  const index = scanSkills({ home: env.home, project: false });
  assert.equal(index.skills.find((s) => s.slug === "risky").risk, "critical");
  assert.equal(index.skills.find((s) => s.slug === "nofm").lint, "error");
  assert.equal(index.census.lintErrors, 1);
  assert.equal(index.census.risky, 1);
});
