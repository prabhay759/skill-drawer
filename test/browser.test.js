/**
 * Browser smoke test. Guards the UI defects that unit tests cannot see:
 * controls that overflow their column and become unclickable, element ids that
 * drift out of the markup, and badges rendered from the wrong object shape.
 *
 * Skipped when Playwright or a Chromium build is not installed, so `npm test`
 * still works on a bare checkout; CI installs both.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startServer } from "../src/server.js";
import { tmpHome, writeSkill } from "./helpers.js";

let chromium = null;
try {
  ({ chromium } = await import("playwright"));
} catch {
  chromium = null;
}
const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

// Playwright can be installed without any browser binary; probe once so the
// suite skips cleanly instead of failing on every launch.
let ready = false;
if (chromium) {
  try {
    const probe = await chromium.launch({ executablePath });
    await probe.close();
    ready = true;
  } catch {
    ready = false;
  }
}
const skip = ready ? false : "playwright or a chromium build is not installed";

async function boot(t) {
  const env = tmpHome();
  const root = path.join(env.home, ".claude/skills");
  writeSkill(path.join(root, "pdf-tools"), {
    name: "pdf-tools",
    description: "Read, merge, split and fill PDF forms. Use when the user mentions a .pdf file.",
    body: "# PDF tools\n\n## Steps\n\n1. Install: `pip install pypdf`\n2. Merge the files\n\nDo not overwrite the original.\n",
  });
  writeSkill(path.join(root, "mismatched"), { name: "wrong-name", description: "A skill whose frontmatter name does not match its folder, which lint can fix." });
  // An identical copy (so the "1 copy" badge appears) and a stale one (to sync).
  const body = "# PDF tools\n\n## Steps\n\n1. Install: `pip install pypdf`\n2. Merge the files\n\nDo not overwrite the original.\n";
  writeSkill(path.join(env.home, ".codex/skills/pdf-tools"), {
    name: "pdf-tools",
    description: "Read, merge, split and fill PDF forms. Use when the user mentions a .pdf file.",
    body,
  });
  writeSkill(path.join(env.home, ".cursor/skills/pdf-tools"), {
    name: "pdf-tools",
    description: "Read, merge, split and fill PDF forms. Use when the user mentions a .pdf file.",
    body: "# PDF tools\n\nAn older copy.\n",
  });
  const { server, url } = await startServer({ port: 0, open: false, quiet: true, project: false, home: env.home });
  const browser = await chromium.launch({ executablePath });
  const page = await browser.newPage({ viewport: { width: 1250, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  t.after(async () => { await browser.close(); server.close(); env.cleanup(); });
  await page.goto(url);
  await page.waitForSelector(".skill-card");
  return { page, errors, env, url, root };
}

test("the page loads, renders every skill and logs no errors", { skip }, async (t) => {
  const { page, errors } = await boot(t);
  assert.equal(await page.locator(".skill-card").count(), 4);
  assert.equal(await page.isVisible("#search"), true);
  assert.deepEqual(errors, []);
});

test("badges match between a card and the detail header", { skip }, async (t) => {
  const { page, errors } = await boot(t);
  await page.click(".skill-card:has-text('pdf-tools') >> nth=0");
  await page.waitForSelector(".detail-title h1");
  const card = await page.$eval(".skill-card:has-text('pdf-tools') >> nth=0 >> .name", (e) => e.textContent.replace(/\s+/g, " ").trim());
  const detail = await page.$eval(".detail-title", (e) => e.textContent.replace(/\s+/g, " ").trim());
  for (const badge of ["Q", "1 copy"]) {
    assert.ok(card.includes(badge), `card badge ${badge}: ${card}`);
    assert.ok(detail.includes(badge), `header badge ${badge}: ${detail}`);
  }
  assert.ok(!(await page.content()).includes(">undefined"), "no undefined leaked into the markup");
  assert.deepEqual(errors, []);
});

test("no control overflows its column, at three window widths", { skip }, async (t) => {
  const { page, errors } = await boot(t);
  for (const width of [1000, 1250, 1600]) {
    await page.setViewportSize({ width, height: 860 });
    await page.check(".skill-card >> nth=0 >> input");
    await page.check(".skill-card >> nth=1 >> input");
    await page.waitForTimeout(120);
    const problems = await page.evaluate(() => {
      const out = [];
      const fits = (sel, within) => {
        const a = document.querySelector(sel)?.getBoundingClientRect();
        const b = within ? document.querySelector(within).getBoundingClientRect() : { right: window.innerWidth };
        if (a && a.right > b.right + 1) out.push(sel);
      };
      if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push("page");
      fits(".toolbar");
      fits("#bulk", ".list-pane");
      fits(".list-head", ".list-pane");
      if (!document.querySelector("#search").getBoundingClientRect().width) out.push("#search collapsed");
      return out;
    });
    assert.deepEqual(problems, [], `overflow at ${width}px`);
    // Every bulk button must be clickable, not covered by a neighbouring pane.
    for (const id of ["bulk-copy", "bulk-archive", "bulk-clear"]) {
      await page.click(`#${id}`, { trial: true, timeout: 2000 });
    }
    await page.click("#bulk-clear");
  }
  assert.deepEqual(errors, []);
});

test("a destructive action round-trips: trash, then restore from the shelf", { skip }, async (t) => {
  const { page, errors, root } = await boot(t);
  const before = await page.locator(".skill-card").count();
  await page.click(".skill-card:has-text('wrong-name')");
  await page.waitForSelector("[data-act='delete']");
  await page.click("[data-act='delete']");
  await page.click(".modal [data-ok]");
  await page.waitForFunction((n) => document.querySelectorAll(".skill-card").length === n - 1, before);
  assert.equal(fs.existsSync(path.join(root, "mismatched")), false);
  await page.click('[data-shelf="trashed"]');
  await page.waitForSelector(".modal [data-restore]");
  await page.click(".modal [data-restore]");
  await page.waitForFunction((n) => document.querySelectorAll(".skill-card").length === n, before);
  assert.equal(fs.existsSync(path.join(root, "mismatched", "SKILL.md")), true);
  assert.deepEqual(errors, []);
});

test("one-click lint fix rewrites the frontmatter name", { skip }, async (t) => {
  const { page, errors, root } = await boot(t);
  await page.click(".skill-card:has-text('wrong-name')");
  await page.waitForSelector("[data-tab='health']");
  await page.click("[data-tab='health']");
  await page.waitForSelector("[data-fix]");
  await page.click("[data-fix]");
  await page.waitForFunction(() => !document.querySelector("[data-fix]"));
  assert.match(fs.readFileSync(path.join(root, "mismatched/SKILL.md"), "utf8"), /name: mismatched/);
  assert.deepEqual(errors, []);
});

test("sync overwrites a same-named copy in another agent", { skip }, async (t) => {
  const { page, errors, env } = await boot(t);
  const other = path.join(env.home, ".cursor/skills/pdf-tools/SKILL.md");
  assert.match(fs.readFileSync(other, "utf8"), /An older copy/);
  await page.click(".skill-card:has-text('pdf-tools') >> nth=0");
  await page.waitForSelector("[data-act='sync']");
  await page.click("[data-act='sync']");
  await page.waitForSelector("#sync-go");
  await page.click("#sync-go");
  await page.click(".modal [data-ok]");
  await page.waitForTimeout(700);
  assert.match(fs.readFileSync(other, "utf8"), /pip install pypdf/, "the copy took the source version");
  assert.deepEqual(errors, []);
});

test("live reload picks up a skill written on disk", { skip }, async (t) => {
  const { page, errors, root } = await boot(t);
  writeSkill(path.join(root, "appeared-later"), { name: "appeared-later", description: "Written straight to disk while the page was open." });
  await page.waitForFunction(() => [...document.querySelectorAll(".skill-card .name")].some((e) => e.textContent.includes("appeared-later")), null, { timeout: 15000 });
  assert.deepEqual(errors, []);
});

test("the issues panel caps each group instead of listing everything", { skip }, async (t) => {
  const { page, errors, env } = await boot(t);
  const root = path.join(env.home, ".codex/skills");
  for (let i = 0; i < 14; i += 1) {
    writeSkill(path.join(root, `dupe-${i}`), { name: `dupe-${i}`, description: "Read, merge, split and fill PDF forms. Use when the user mentions a .pdf file." });
  }
  await page.click("#btn-refresh");
  await page.waitForTimeout(600);
  await page.click("#btn-checks");
  await page.click('[data-panel="issues"]');
  await page.waitForSelector(".modal .issue");
  const shown = await page.locator(".modal .issue:visible").count();
  assert.ok(shown <= 30, `capped groups, saw ${shown} issue blocks`);
  assert.ok(await page.locator(".modal [data-more]").count() > 0, "an expander is offered");
  await page.click(".modal [data-more] >> nth=0");
  assert.ok((await page.locator(".modal .issue:visible").count()) > shown, "expanding reveals more");
  assert.deepEqual(errors, []);
});
