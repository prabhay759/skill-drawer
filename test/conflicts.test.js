import test from "node:test";
import assert from "node:assert/strict";
import { detectConflicts, levenshtein, jaccard, tokens } from "../src/conflicts.js";

const mk = (id, name, description, hash, drawerId = "claude") => ({
  id, name, description, contentHash: hash, drawerId, drawerLabel: `~/.${drawerId}/skills`, path: `/h/.${drawerId}/skills/${name}`, disabled: false,
});

test("exact copies are grouped once", () => {
  const issues = detectConflicts([mk("a", "pdf", "Read pdf files and merge them together nicely", "h1"), mk("b", "pdf", "Read pdf files and merge them together nicely", "h1", "cursor")]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, "exact-copy");
  assert.equal(issues[0].skills.length, 2);
});

test("same name with different content is flagged", () => {
  const issues = detectConflicts([mk("a", "deploy", "Deploy things to production servers", "h1"), mk("b", "Deploy", "Ship a release to staging boxes", "h2", "codex")]);
  assert.ok(issues.some((i) => i.type === "same-name"));
});

test("near-identical names are flagged", () => {
  const issues = detectConflicts([mk("a", "pdf-tools", "Alpha beta gamma delta epsilon zeta", "h1"), mk("b", "pdf-tool", "One two three four five six seven", "h2")]);
  assert.ok(issues.some((i) => i.type === "similar-name"));
});

test("overlapping descriptions are flagged and copies do not double-report", () => {
  const d = "Read, merge, split and fill PDF forms and documents when the user mentions a pdf";
  const issues = detectConflicts([
    mk("a", "pdf-tools", d, "h1"),
    mk("b", "pdf-tools", d, "h1", "cursor"),
    mk("c", "pdf-helper", "Merge, split, read and fill PDF documents and forms whenever the user mentions a pdf", "h2", "codex"),
  ]);
  const overlaps = issues.filter((i) => i.type === "overlapping-description");
  assert.equal(overlaps.length, 1);
});

test("disabled skills are ignored", () => {
  const a = mk("a", "x-skill", "Alpha beta gamma delta epsilon zeta", "h1");
  const b = { ...mk("b", "x-skill", "Alpha beta gamma delta epsilon zeta", "h1", "cursor"), disabled: true };
  assert.equal(detectConflicts([a, b]).length, 0);
});

test("helpers", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(jaccard(tokens("merge pdf things"), tokens("merge pdf documents")), 0.5);
});
