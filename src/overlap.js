/**
 * Pairwise overlap between skills: how likely two skills are to be picked
 * for the same request. Cheap and static; the AI comparison is the deep check.
 */
import { normalizeName, tokens, jaccard, levenshtein } from "./conflicts.js";

function nameSimilarity(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  return Math.max(0, 1 - dist / Math.max(na.length, nb.length));
}

function bodyTokens(text) {
  return tokens(String(text || "").slice(0, 20000));
}

/** Tokenize once per skill; the pair loop is O(n^2) and must not re-tokenize. */
function prepare(s) {
  return { skill: s, desc: tokens(s.description), body: bodyTokens(s.body ?? s.bodyPreview ?? "") };
}

function measure(pa, pb) {
  const name = nameSimilarity(pa.skill.name, pb.skill.name);
  const description = jaccard(pa.desc, pb.desc);
  const body = jaccard(pa.body, pb.body);
  const identical = Boolean(pa.skill.contentHash && pa.skill.contentHash === pb.skill.contentHash);
  // Description is what the agent chooses on; weigh it most.
  const score = identical ? 1 : Math.min(1, 0.2 * name + 0.55 * description + 0.25 * body);
  return { name, description, body, identical, score };
}

export function overlapPair(a, b) {
  return measure(prepare(a), prepare(b));
}

/**
 * @param {Array} skills  summaries with name, description, body, contentHash, agentId, drawerId, disabled
 * @param {{threshold?:number, limit?:number, agentId?:string, ids?:string[]}} opts
 */
export function overlapPairs(skills, { threshold = 0.35, limit = 200, agentId = null, ids = null } = {}) {
  let list = skills.filter((s) => !s.disabled);
  if (agentId && agentId !== "all") list = list.filter((s) => s.agentId === agentId);
  if (ids?.length) list = list.filter((s) => ids.includes(s.id));
  const prepared = list.map(prepare);
  const pairs = [];
  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const a = list[i];
      const b = list[j];
      const m = measure(prepared[i], prepared[j]);
      if (m.score < threshold) continue;
      pairs.push({
        a: { id: a.id, name: a.name, agentId: a.agentId, agentLabel: a.agentLabel, drawerLabel: a.drawerLabel, path: a.path },
        b: { id: b.id, name: b.name, agentId: b.agentId, agentLabel: b.agentLabel, drawerLabel: b.drawerLabel, path: b.path },
        sameAgent: a.agentId === b.agentId,
        sameDrawer: a.drawerId === b.drawerId,
        ...m,
        level: m.identical ? "identical" : m.score >= 0.7 ? "high" : m.score >= 0.5 ? "medium" : "low",
      });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  return { pairs: pairs.slice(0, limit), total: pairs.length, considered: list.length };
}
