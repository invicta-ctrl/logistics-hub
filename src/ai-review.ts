import { arbitrateTask, normalizeTask, route, runRole, secondOpinionTask, type FactCode } from "./ai-roles";
import { neuronsToday, type AiRunner } from "./ambient-assist";
import { behaviourOf } from "./catalog-policy";
import { suggest, verified, type Known } from "./catalogue-suggest";
import { words } from "./duplicates";
import { audit, catalogRevision, InputError, type Actor } from "./inventory";
import { KNOWLEDGE_VERSION } from "./item-knowledge";

import type { ReviewOffer, KnowledgeProposal, ReviewOutcome as Outcome } from "./ai-review-types";

type Reviewed = Known & { id: string };
type StoredOffer = ReviewOffer & { actor: string; sessionId: string };
const key = (actor: Actor) => `ai_review_offer:${actor.accountId}`;
const normalized = (name: string) => words(name).join(" ");
const names = (item: Reviewed) => [item.name, ...(item.aliases ?? "").split(/[;,\n]/)].map(normalized);
const outcome = (item: Pick<Reviewed, "name" | "category" | "unit" | "itemType" | "consumptionMode">): Outcome => ({ name: item.name, category: item.category, unit: item.unit, behaviour: behaviourOf(item)! });
const same = (a: Outcome, b: Outcome) => a.name === b.name && a.category === b.category && a.unit === b.unit && a.behaviour === b.behaviour;
async function reviewed(db: D1Database): Promise<Reviewed[]> {
  const { results } = await db.prepare("SELECT id, name, aliases, category, unit, item_type AS itemType, consumption_mode AS consumptionMode, stock_area AS stockArea, status, needs_review AS needsReview FROM items WHERE status = 'ACTIVE' AND needs_review = 0 AND item_type <> 'NEEDS_REVIEW' ORDER BY id LIMIT 1000").all<Omit<Reviewed, "needsReview"> & { needsReview: number }>();
  // A full evidence window is incomplete: abstain globally rather than ask AI about an exact item outside it.
  if (results.length === 1000) throw new InputError(503, "AI review is unavailable for this catalogue size. Saving manually still works.");
  return results.map((item) => ({ ...item, needsReview: item.needsReview === 0 ? false : true })).filter(verified);
}
async function stored(db: D1Database, actor: Actor): Promise<{ raw: string; offer: StoredOffer } | null> {
  const raw = await db.prepare("SELECT value FROM system_settings WHERE key = ?").bind(key(actor)).first<string>("value");
  if (!raw) return null;
  try { return { raw, offer: JSON.parse(raw) as StoredOffer }; } catch { return null; }
}
const publicOffer = ({ actor: _actor, sessionId: _session, ...offer }: StoredOffer): ReviewOffer => offer;

async function digestId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** One outstanding offer per account, claimed before calling a provider. Repeated requests cannot spend twice. */
export async function offerReview(db: D1Database, ai: AiRunner | undefined, actor: Actor, sessionId: string, input: unknown): Promise<ReviewOffer> {
  const body = input as { draftId?: unknown; revision?: unknown; name?: unknown } | null;
  if (!body || typeof body.draftId !== "string" || !/^[0-9a-f-]{36}$/.test(body.draftId) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0 || typeof body.name !== "string" || !body.name.trim() || body.name.length > 120) throw new InputError(400, "Give the draft a name before asking for a suggestion.");
  const session = await db.prepare("SELECT started_by AS owner, status FROM catalogue_sessions WHERE id = ?").bind(sessionId).first<{ owner: string; status: string }>();
  if (!session) throw new InputError(404, "Cataloguing session not found.");
  if (session.owner !== actor.accountId) throw new InputError(403, "Start your own cataloguing session.");
  if (session.status !== "ACTIVE") throw new InputError(409, "This cataloguing session is finished.");
  const previous = await stored(db, actor);
  if (previous?.offer.draftId === body.draftId && previous.offer.sessionId === sessionId && previous.offer.revision >= Number(body.revision)) return publicOffer(previous.offer);
  const revision = await catalogRevision(db);
  const claim: StoredOffer = { id: `AR-${await digestId(JSON.stringify([actor.accountId, sessionId, body.draftId, body.revision]))}`, actor: actor.accountId, sessionId, draftId: body.draftId, revision: Number(body.revision), catalogRevision: revision, observed: body.name.trim(), expiresAt: Date.now() + 30 * 60_000, proposal: null, label: null, reason: "PENDING" };
  const raw = JSON.stringify(claim);
  const now = new Date().toISOString();
  const [, claimed] = await db.batch([
    db.prepare(`INSERT INTO audit_log(id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
      SELECT ?, ?, 'AI_REVIEW_OFFERED', 'CATALOGUE', ?, ?, ? WHERE NOT EXISTS
      (SELECT 1 FROM audit_log WHERE entity_type = 'CATALOGUE' AND entity_id = ? AND action = 'AI_REVIEW_OFFERED')`)
      .bind(crypto.randomUUID(), actor.accountId, claim.id, JSON.stringify({ draftId: claim.draftId, revision: claim.revision, catalogRevision: revision }), now, claim.id),
    db.prepare(`INSERT INTO system_settings(key, value, updated_at, updated_by) SELECT ?, ?, ?, ? WHERE changes() > 0
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by WHERE system_settings.value IS ?`)
      .bind(key(actor), raw, now, actor.accountId, previous?.raw ?? null)
  ]);
  if (!claimed!.meta.changes) return publicOffer((await stored(db, actor))?.offer ?? { ...claim, reason: "UNAVAILABLE" });
  try {
    const items = await reviewed(db);
    const wanted = normalized(claim.observed);
    const exactMatch = items.some((item) => names(item).includes(wanted));
    const tokens = words(claim.observed);
    const candidates = items.filter((item) => names(item).some((name) => tokens.filter((word) => name.split(" ").includes(word)).length >= Math.max(1, Math.ceil(tokens.length / 2))));
    const hints = suggest(claim.observed, items, []);
    const conflict: FactCode[] = [];
    if (hints.category?.tier === "CONFLICTING") conflict.push("CATEGORY_SPLIT");
    if (hints.unit?.tier === "CONFLICTING") conflict.push("UNIT_SPLIT");
    if (hints.behaviour?.tier === "CONFLICTING") conflict.push("BEHAVIOUR_SPLIT");
    // Only reviewed, independent corrections can improve the order of review-only choices.
    const learned = (await reviewProposals(db)).proposals.filter((proposal) => proposal.observed === wanted && proposal.support >= 3 && proposal.actors >= 2 && !proposal.conflicts && proposal.decision !== "REJECT");
    const priority = new Set(learned.map((proposal) => proposal.target.name));
    candidates.sort((a, b) => Number(priority.has(b.name)) - Number(priority.has(a.name)));
    candidates.splice(5);
    const terms = items.map((item) => item.name).sort((a, b) => Number(priority.has(b)) - Number(priority.has(a)));
    const [role] = route({ exactMatch, unmatchedName: claim.observed, terms, candidates, conflict, used: await neuronsToday(db) });
    claim.reason = exactMatch ? "EXACT_MATCH" : "NO_RELEVANT_EVIDENCE";
    if (role) {
      const task = role === "CANDIDATE_ARBITRATE" ? arbitrateTask(claim.observed, candidates) : role === "TEXT_NORMALIZE" ? normalizeTask(claim.observed, terms, [...priority]) : secondOpinionTask(conflict);
      const answer = await runRole(db, ai, role, task, "USER");
      claim.proposal = answer.proposal;
      claim.reason = answer.reason;
      claim.label = answer.proposal?.field === "id" ? candidates.find((item) => item.id === answer.proposal!.value)?.name ?? null : answer.proposal?.value ?? null;
    }
  } catch { claim.proposal = null; claim.reason = "UNAVAILABLE"; }
  if (claim.catalogRevision !== await catalogRevision(db)) { claim.proposal = null; claim.label = null; claim.reason = "STALE_CATALOGUE"; }
  await db.batch([
    db.prepare("UPDATE system_settings SET value = ? WHERE key = ? AND value = ?").bind(JSON.stringify(claim), key(actor), raw),
    audit(db, actor.accountId, "AI_REVIEW_RESOLVED", "CATALOGUE", claim.id, { draftId: claim.draftId, revision: claim.revision, catalogRevision: revision, role: claim.proposal?.role ?? null, reason: claim.reason }, true)
  ]);
  const latest = await stored(db, actor);
  return publicOffer(latest!.offer);
}

/** Invalid feedback is discarded. Its optional presence never prevents the person's item from saving. */
export async function captureFeedback(db: D1Database, actor: Actor, sessionId: string, body: Record<string, unknown>, saved: Outcome): Promise<(itemId: string) => D1PreparedStatement[]> {
  const empty = () => [];
  const feedback = body.aiFeedback as { offerId?: unknown; draftId?: unknown; revision?: unknown; decision?: unknown; correction?: unknown } | null;
  if (!feedback || !["KEEP", "REJECT", "CORRECT"].includes(String(feedback.decision))) return empty;
  const current = await stored(db, actor);
  const offer = current?.offer;
  if (!offer || !offer.proposal || offer.actor !== actor.accountId || offer.sessionId !== sessionId || offer.id !== feedback.offerId || offer.draftId !== feedback.draftId || offer.revision !== feedback.revision || offer.expiresAt <= Date.now() || offer.catalogRevision !== await catalogRevision(db)) return empty;
  const correction = typeof feedback.correction === "string" ? feedback.correction.trim().slice(0, 120) : "";
  let target: Outcome | undefined;
  if (feedback.decision === "CORRECT" && correction !== offer.label) {
    try { target = (await reviewed(db)).map(outcome).find((target) => normalized(target.name) === normalized(correction) && same(saved, target)); }
    catch { /* Optional learning evidence never blocks a manual save. */ }
  }
  return (itemId) => [db.prepare(`INSERT INTO audit_log(id, actor_user_id, action, entity_type, entity_id, details_json, created_at)
    SELECT ?, ?, 'AI_REVIEW_FEEDBACK', 'CATALOGUE', ?, ?, ? WHERE EXISTS (SELECT 1 FROM system_settings WHERE key = ? AND value = ?)
    AND (SELECT value FROM catalog_revision WHERE id = 1) = ?
    AND NOT EXISTS (SELECT 1 FROM audit_log WHERE entity_type = 'CATALOGUE' AND entity_id = ? AND action = 'AI_REVIEW_FEEDBACK')`)
    .bind(crypto.randomUUID(), actor.accountId, offer.id, JSON.stringify({ captureId: body.id, itemId, decision: feedback.decision, role: offer.proposal!.role, observed: normalized(offer.observed), saved, correction: target ?? null, knowledgeVersion: KNOWLEDGE_VERSION }), new Date().toISOString(), key(actor), current!.raw, offer.catalogRevision + 1, offer.id)];
}

/** Indexed audit tail, then a bounded join; kept guesses and unreviewed captures never vote. */
export async function reviewProposals(db: D1Database): Promise<{ proposals: KnowledgeProposal[]; window: number }> {
  const { results } = await db.prepare(`SELECT a.actor_user_id AS actor, a.details_json AS details, i.name, i.category, i.unit, i.item_type AS itemType, i.consumption_mode AS consumptionMode, i.stock_area AS stockArea, i.status, i.needs_review AS needsReview
    FROM (SELECT action, actor_user_id, details_json FROM audit_log WHERE entity_type = 'CATALOGUE' ORDER BY created_at DESC, rowid DESC LIMIT 200) a
    LEFT JOIN items i ON i.id = json_extract(a.details_json, '$.itemId') WHERE a.action = 'AI_REVIEW_FEEDBACK'`).all<{ actor: string; details: string } & Omit<Reviewed, "needsReview"> & { needsReview: number }>();
  const groups = new Map<string, { observed: string; target: Outcome; captures: Set<string>; actors: Set<string> }>();
  for (const row of results) {
    const evidence = JSON.parse(row.details) as { captureId: string; decision: string; observed: string; correction: Outcome | null; knowledgeVersion: number };
    if (evidence.decision !== "CORRECT" || !evidence.correction || evidence.knowledgeVersion !== KNOWLEDGE_VERSION || !verified({ ...row, needsReview: row.needsReview === 0 ? false : true }) || !same(evidence.correction, outcome(row))) continue;
    const groupKey = JSON.stringify([evidence.observed, evidence.correction]);
    const group = groups.get(groupKey) ?? { observed: evidence.observed, target: evidence.correction, captures: new Set(), actors: new Set() };
    group.captures.add(evidence.captureId); group.actors.add(row.actor); groups.set(groupKey, group);
  }
  const proposals: KnowledgeProposal[] = [];
  const catalogue = await reviewed(db);
  for (const [groupKey, group] of groups) {
    const id = `KP-${await digestId(`${KNOWLEDGE_VERSION}:${groupKey}`)}`;
    proposals.push({ id, observed: group.observed, target: group.target, support: group.captures.size, actors: group.actors.size, conflicts: catalogue.filter((item) => names(item).includes(group.observed) && !same(outcome(item), group.target)).length + [...groups.values()].filter((other) => other.observed === group.observed && !same(other.target, group.target)).reduce((n, other) => n + other.captures.size, 0), decision: null, knowledgeVersion: KNOWLEDGE_VERSION });
  }
  // At most four bounded queries, rather than one query per correction group (Workers Free allows 50).
  const statements: D1PreparedStatement[] = [];
  for (let at = 0; at < proposals.length; at += 50) {
    const ids = proposals.slice(at, at + 50).map((proposal) => proposal.id);
    statements.push(db.prepare(`SELECT entity_id AS id, json_extract(details_json, '$.decision') AS decision FROM audit_log
      WHERE entity_type = 'CATALOGUE' AND action = 'AI_KNOWLEDGE_DECIDED' AND entity_id IN (${ids.map(() => "?").join(",")})`).bind(...ids));
  }
  if (statements.length) {
    const decisions = new Map((await db.batch<{ id: string; decision: "APPROVE" | "REJECT" }>(statements)).flatMap((result) => result.results).map((row) => [row.id, row.decision]));
    for (const proposal of proposals) proposal.decision = decisions.get(proposal.id) ?? null;
  }
  return { proposals: proposals.sort((a, b) => b.support - a.support || a.id.localeCompare(b.id)), window: 200 };
}

export async function decideKnowledge(db: D1Database, actor: Actor, input: unknown) {
  const body = input as { id?: unknown; decision?: unknown } | null;
  if (!body || typeof body.id !== "string" || !/^KP-[0-9a-f]{64}$/.test(body.id) || !["APPROVE", "REJECT"].includes(String(body.decision))) throw new InputError(400, "Choose a proposal and approve or reject it.");
  const previous = await db.prepare("SELECT details_json FROM audit_log WHERE entity_type = 'CATALOGUE' AND entity_id = ? AND action = 'AI_KNOWLEDGE_DECIDED' ORDER BY created_at, rowid LIMIT 1").bind(body.id).first<string>("details_json");
  if (previous) return JSON.parse(previous);
  const proposal = (await reviewProposals(db)).proposals.find((proposal) => proposal.id === body.id);
  if (!proposal || proposal.support < 3 || proposal.actors < 2 || proposal.conflicts) throw new InputError(409, "This proposal needs three reviewed corrections from at least two staff, without conflicting evidence.");
  const details = { ...proposal, decision: body.decision, status: body.decision === "APPROVE" ? "AWAITING_CODE_REVIEW" : "REJECTED" };
  await db.prepare(`INSERT INTO audit_log(id, actor_user_id, action, entity_type, entity_id, details_json, created_at) SELECT ?, ?, 'AI_KNOWLEDGE_DECIDED', 'CATALOGUE', ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE entity_type = 'CATALOGUE' AND entity_id = ? AND action = 'AI_KNOWLEDGE_DECIDED')`).bind(crypto.randomUUID(), actor.accountId, body.id, JSON.stringify(details), new Date().toISOString(), body.id).run();
  return JSON.parse((await db.prepare("SELECT details_json FROM audit_log WHERE entity_type = 'CATALOGUE' AND entity_id = ? AND action = 'AI_KNOWLEDGE_DECIDED' ORDER BY created_at, rowid LIMIT 1").bind(body.id).first<string>("details_json"))!);
}
