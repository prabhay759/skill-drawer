#!/usr/bin/env node
// Print the CHANGELOG.md section for a version (default: package.json version),
// followed by an npx one-liner. Used by the Release workflow for GitHub release notes.
import fs from "node:fs";
const version = process.argv[2] || JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const md = fs.readFileSync("CHANGELOG.md", "utf8");
const lines = md.split("\n");
const start = lines.findIndex((l) => new RegExp(`^## v?${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(l));
let body = "See CHANGELOG.md";
if (start !== -1) {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) if (/^## /.test(lines[i])) { end = i; break; }
  body = lines.slice(start + 1, end).join("\n").trim() || body;
}
process.stdout.write(`${body}\n\n\`\`\`\nnpx skill-drawer@${version}\n\`\`\`\n`);
