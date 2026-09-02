import YAML from "yaml";

export function parseFrontmatter(text) {
  if (!text.startsWith("---")) {
    return { data: {}, content: text, raw: "", present: false, error: null };
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return {
      data: {},
      content: text,
      raw: "",
      present: true,
      error: "Frontmatter opened with --- but never closed",
    };
  }
  const raw = text.slice(3, end).replace(/^\r?\n/, "");
  let data = {};
  let error = null;
  try {
    const parsed = YAML.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed;
    } else if (parsed !== null && parsed !== undefined) {
      error = "Frontmatter is not a YAML mapping";
    }
  } catch (err) {
    error = `YAML frontmatter could not be parsed: ${err.message.split("\n")[0]}`;
  }
  const content = text.slice(end + 4).replace(/^\r?\n/, "");
  return { data, content, raw, present: true, error };
}

export function stringifyFrontmatter(data, body) {
  const yaml = YAML.stringify(data).trimEnd();
  return `---\n${yaml}\n---\n\n${body.replace(/^\n+/, "")}`;
}

/** Replace/insert the `name` key of a SKILL.md without reformatting the rest. */
export function setFrontmatterName(text, name) {
  const fm = parseFrontmatter(text);
  if (!fm.present || fm.error) {
    const data = { name, ...(fm.data || {}) };
    return stringifyFrontmatter(data, fm.present ? fm.content : text);
  }
  const lines = fm.raw.split("\n");
  let replaced = false;
  const next = lines.map((line) => {
    if (!replaced && /^name\s*:/.test(line)) {
      replaced = true;
      return `name: ${name}`;
    }
    return line;
  });
  if (!replaced) next.unshift(`name: ${name}`);
  return `---\n${next.join("\n")}\n---\n${fm.content}`;
}

/** Replace the whole frontmatter block, keeping the body untouched. */
export function replaceFrontmatter(text, data) {
  const fm = parseFrontmatter(text);
  const body = fm.present ? fm.content : text;
  const yaml = YAML.stringify(data).trimEnd();
  return `---\n${yaml}\n---\n${body.startsWith("\n") || !body ? body : "\n" + body}`;
}
