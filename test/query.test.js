import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery, scoreSkill, matchRanges } from "../web/query.js";

const skill = (o = {}) => ({
  id: "1", name: "pdf-tools", slug: "pdf-tools",
  description: "Read, merge and split PDF forms when the user mentions a pdf file",
  path: "/h/.claude/skills/pdf-tools", drawerId: "claude", drawerLabel: "~/.claude/skills",
  agentId: "claude", agentLabel: "Claude", risk: "none", lint: "ok", qualityScore: 86,
  copyCount: 1, scope: "user", kind: "user", writable: true, file: false, link: false,
  disabled: false, fileCount: 2, frontmatter: { tags: ["documents"] }, ...o,
});
const score = (q, s = skill()) => scoreSkill(s, parseQuery(q));
const hit = (q, s) => score(q, s) > 0;

test("bare terms are ANDed and rank by where they match", () => {
  assert.ok(hit("pdf"));
  assert.ok(hit("pdf merge"));
  assert.ok(!hit("pdf kubernetes"));
  assert.ok(!hit("kubernetes"));
  assert.ok(score("pdf-tools") > score("pdf"), "exact name beats prefix");
  assert.ok(score("pdf") > score("merge"), "name beats description");
  assert.ok(score("merge") > score("claude"), "description beats path");
  assert.equal(score(""), 1);
  assert.equal(parseQuery("").empty, true);
});

test("quoted phrases, negation and unknown keys", () => {
  assert.ok(hit('"PDF forms"'));
  assert.ok(!hit('"forms PDF"'));
  assert.ok(hit("-deploy"));
  assert.ok(!hit("-pdf"));
  assert.ok(hit("pdf -deploy"));
  // An unrecognised key stays a plain search term rather than silently filtering.
  assert.ok(!hit("todo:later"));
  assert.ok(hit("nonsense:x", skill({ description: "handles nonsense:x cases" })));
});

test("field filters", () => {
  assert.ok(hit("agent:claude"));
  assert.ok(hit("agent:Claude"));
  assert.ok(!hit("agent:cursor"));
  assert.ok(hit("drawer:.claude"));
  assert.ok(hit("name:pdf"));
  assert.ok(!hit("name:merge"), "name: does not search the description");
  assert.ok(hit("desc:merge"));
  assert.ok(!hit("desc:tools"));
  assert.ok(hit("path:skills"));
  assert.ok(hit("-agent:cursor"));
  assert.ok(!hit("-agent:claude"));
});

test("ranked and numeric comparisons", () => {
  assert.ok(hit("risk:none"));
  assert.ok(!hit("risk:>=high"));
  assert.ok(hit("risk:>=high", skill({ risk: "critical" })));
  assert.ok(hit("lint:error", skill({ lint: "error" })));
  assert.ok(hit("lint:>=warning", skill({ lint: "error" })));
  assert.ok(!hit("lint:>=warning"));
  assert.ok(hit("q:<90"));
  assert.ok(!hit("q:<50"));
  assert.ok(hit("score:>=86"));
  assert.ok(!hit("risk:nonsense"), "an unknown level matches nothing rather than everything");
});

test("flags", () => {
  assert.ok(hit("is:user"));
  assert.ok(!hit("is:project"));
  assert.ok(hit("is:disabled", skill({ disabled: true })));
  assert.ok(hit("is:duplicate"));
  assert.ok(hit("is:readonly", skill({ writable: false })));
  assert.ok(hit("has:copies"));
  assert.ok(hit("has:files"));
  assert.ok(!hit("has:lint"));
  assert.ok(hit("has:risk", skill({ risk: "low" })));
  // The full-skill shape (copies array) works as well as the catalog shape.
  assert.ok(hit("has:copies", skill({ copyCount: undefined, copies: [{ id: "2" }] })));
});

test("fuzzy name matching is a last resort, never a false positive", () => {
  assert.ok(hit("pdftls"), "subsequence of the name");
  assert.ok(!hit("zzz"));
  assert.ok(score("pdftls") < score("merge"), "fuzzy ranks below a real description hit");
});

test("filters combine with terms", () => {
  assert.ok(hit("merge agent:claude is:user"));
  assert.ok(!hit("merge agent:cursor"));
});

test("matchRanges merges overlaps and ignores negated terms", () => {
  assert.deepEqual(matchRanges("Read, merge and split PDF forms", parseQuery("merge pdf")), [[6, 11], [22, 25]]);
  assert.deepEqual(matchRanges("pdf-tools", parseQuery("pdf pdf-tools")), [[0, 9]]);
  assert.deepEqual(matchRanges("pdf-tools", parseQuery("-pdf")), []);
  assert.deepEqual(matchRanges("nothing here", parseQuery("agent:claude")), []);
});
