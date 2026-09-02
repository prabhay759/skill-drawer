import test from "node:test";
import assert from "node:assert/strict";
import { lintSkill } from "../src/lint.js";
import { parseFrontmatter, setFrontmatterName } from "../src/frontmatter.js";

const run = (text, slug = "my-skill", files = []) => {
  const fm = parseFrontmatter(text);
  return lintSkill({ frontmatter: fm.data, slug, body: fm.content, source: text, present: fm.present, error: fm.error, files });
};
const rules = (r) => r.problems.map((p) => p.rule);

test("valid skill passes", () => {
  const r = run("---\nname: my-skill\ndescription: Does a useful thing when asked to do it.\n---\n\n# Hi\n");
  assert.equal(r.status, "ok");
  assert.deepEqual(r.problems, []);
});

test("missing frontmatter is an error", () => {
  const r = run("# just a body\n");
  assert.equal(r.status, "error");
  assert.ok(rules(r).includes("frontmatter.missing"));
  assert.ok(rules(r).includes("name.missing"));
});

test("bad yaml is an error", () => {
  const r = run("---\nname: [oops\ndescription: x\n---\nbody");
  assert.ok(rules(r).includes("frontmatter.invalid"));
});

test("name mismatch and format are warnings", () => {
  const r = run("---\nname: My Skill\ndescription: Long enough description here.\n---\nbody", "my-skill");
  assert.equal(r.status, "warning");
  assert.ok(rules(r).includes("name.format"));
  assert.ok(rules(r).includes("name.mismatch"));
});

test("oversized description is an error", () => {
  const r = run(`---\nname: my-skill\ndescription: ${"x".repeat(1100)}\n---\nbody`);
  assert.ok(rules(r).includes("description.length"));
});

test("broken relative links are flagged", () => {
  const r = run("---\nname: my-skill\ndescription: Long enough description here.\n---\nSee [ref](docs/ref.md) and [ok](ok.md).", "my-skill", [{ path: "ok.md" }]);
  assert.ok(rules(r).includes("link.broken"));
  assert.equal(r.problems.filter((p) => p.rule === "link.broken").length, 1);
});

test("unknown keys are info only", () => {
  const r = run("---\nname: my-skill\ndescription: Long enough description here.\nfoo: bar\n---\nbody");
  assert.equal(r.status, "info");
});

test("setFrontmatterName rewrites name in place", () => {
  const out = setFrontmatterName("---\ndescription: d\nname: old\n---\n\nbody\n", "new-name");
  assert.match(out, /^---\ndescription: d\nname: new-name\n---\n\nbody\n$/);
  const added = setFrontmatterName("# no fm\n", "fresh");
  assert.match(added, /^---\nname: fresh\n---/);
});
