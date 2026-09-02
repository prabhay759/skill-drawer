import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { scanSkills } from "../src/scan.js";
import { exportManifest, importManifest, parseManifest } from "../src/manifest.js";
import { installSkills } from "../src/install.js";
import { tmpHome, writeSkill } from "./helpers.js";

test("bundle export/import round-trips files", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  const dir = writeSkill(path.join(env.home, ".claude/skills/alpha"), { name: "alpha", description: "Alpha skill does alpha things." });
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.writeFileSync(path.join(dir, "scripts/run.sh"), "echo hi\n");
  fs.writeFileSync(path.join(dir, "bin.dat"), Buffer.from([0, 1, 2, 255]));
  const index = scanSkills({ home: env.home, project: false });
  const bundle = exportManifest(index.skills, { includeFiles: true });
  assert.equal(bundle.format, "skill-drawer-bundle");
  assert.equal(bundle.skills[0].files.length, 3);
  const parsed = parseManifest(JSON.stringify(bundle));
  const dest = path.join(env.root, "dest");
  const r = importManifest(parsed, { drawerRoot: dest });
  assert.equal(r.written.length, 1);
  assert.equal(fs.readFileSync(path.join(dest, "alpha/scripts/run.sh"), "utf8"), "echo hi\n");
  assert.deepEqual([...fs.readFileSync(path.join(dest, "alpha/bin.dat"))], [0, 1, 2, 255]);
  const again = importManifest(parsed, { drawerRoot: dest });
  assert.equal(again.skipped.length, 1);
  assert.equal(importManifest(parsed, { drawerRoot: dest, overwrite: true }).written.length, 1);
});

test("manifest-only entries need install, with github origin", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  writeSkill(path.join(env.home, ".claude/skills/alpha"), { name: "alpha", description: "Alpha skill does alpha things.", extraFrontmatter: "source: https://github.com/acme/skills" });
  const index = scanSkills({ home: env.home, project: false });
  const manifest = exportManifest(index.skills);
  assert.equal(manifest.format, "skill-drawer-manifest");
  assert.equal(manifest.skills[0].origin.url, "https://github.com/acme/skills");
  const r = importManifest(manifest, { drawerRoot: path.join(env.root, "dest") });
  assert.equal(r.needsInstall.length, 1);
  assert.throws(() => parseManifest({ format: "nope", skills: [] }), /Unknown manifest format/);
});

test("install from a local folder copies every skill", (t) => {
  const env = tmpHome();
  t.after(env.cleanup);
  const src = path.join(env.root, "src");
  writeSkill(path.join(src, "skills/one"), { name: "one", description: "One skill does one thing." });
  writeSkill(path.join(src, "skills/two"), { name: "two", description: "Two skill does two things." });
  fs.mkdirSync(path.join(src, "skills/one/node_modules/x"), { recursive: true });
  const dest = path.join(env.home, ".claude/skills");
  const r = installSkills(src, { drawerRoot: dest });
  assert.deepEqual(r.installed.map((i) => i.slug).sort(), ["one", "two"]);
  assert.equal(fs.existsSync(path.join(dest, "one/node_modules")), false);
  const only = installSkills(src, { drawerRoot: dest, only: ["two"], overwrite: true });
  assert.deepEqual(only.installed.map((i) => i.slug), ["two"]);
  assert.throws(() => installSkills("not a source!!", { drawerRoot: dest }), /Source must be/);
});
