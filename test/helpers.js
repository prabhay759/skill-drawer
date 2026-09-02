import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tmpHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-drawer-test-"));
  const home = path.join(root, "home");
  const store = path.join(root, "store");
  fs.mkdirSync(home, { recursive: true });
  process.env.SKILL_DRAWER_HOME = store;
  return {
    root,
    home,
    store,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export function writeSkill(dir, { name, description, body = "# Body\n", extraFrontmatter = "" }) {
  fs.mkdirSync(dir, { recursive: true });
  const fm = [name !== undefined ? `name: ${name}` : null, description !== undefined ? `description: ${description}` : null, extraFrontmatter || null]
    .filter(Boolean)
    .join("\n");
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\n${fm}\n---\n\n${body}`);
  return dir;
}
