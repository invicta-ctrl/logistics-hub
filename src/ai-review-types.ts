/** Wire contracts shared by the browser and Worker; no server runtime is imported into the app. */
export type ReviewProposal = { kind: "REVIEW_ONLY"; role: "TEXT_NORMALIZE" | "CANDIDATE_ARBITRATE" | "RARE_SECOND_OPINION"; field: "term" | "id" | "follow_up"; value: string };
export type ReviewOutcome = { name: string; category: string; unit: string; behaviour: string };
export type ReviewOffer = { id: string; draftId: string; revision: number; catalogRevision: number; observed: string; expiresAt: number; proposal: ReviewProposal | null; label: string | null; reason: string };
export type KnowledgeProposal = { id: string; observed: string; target: ReviewOutcome; support: number; actors: number; conflicts: number; decision: "APPROVE" | "REJECT" | null; knowledgeVersion: number };
