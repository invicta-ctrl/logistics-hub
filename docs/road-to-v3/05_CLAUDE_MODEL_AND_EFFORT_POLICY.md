# Claude Project Model and Effort Policy

**Policy verification date:** 2026-10-08

Model names below are current operator selections, not permanent architectural dependencies. At the start of each major Road-to-V3 milestone, re-check the Claude Project model picker/current Anthropic offering. If a named model is retired or materially changed, choose the closest role-equivalent model and record the change in the release/coordination evidence.

This policy is tuned for a coordinator that delegates bounded work to threads while minimizing unnecessary usage.

## 1. Recommended Project settings

### Coordinator
- **Model:** Opus 5.5
- **Effort:** High
- **Role:** architecture, dependency graph, task decomposition, contract decisions, integration review, release acceptance.

High is the default. Do not leave the coordinator on the most expensive effort for routine progress tracking.

Escalate above High only when the available Claude interface explicitly offers a higher level and the task is one of:
- cross-domain schema redesign;
- auth/authorization architecture;
- production incident root cause;
- destructive/recovery decision;
- migration incompatibility;
- unresolved P0 with multiple plausible causes.

Return to High after the decision.

### Default implementation thread
- **Model:** Sonnet 5.5
- **Effort:** High
- **Role:** bounded coding task with frozen contracts.

Use Sonnet for most implementation because the coordinator should spend Opus context on architecture and review rather than routine code edits.

### Complex implementation thread
- **Model:** Sonnet 5.5
- **Effort:** Extra/highest available only when needed
- Use for:
  - D1 concurrency/idempotency;
  - offline replay/service-worker correctness;
  - security-sensitive deployment tooling;
  - migration/recovery code;
  - cross-file type/refactor work with subtle invariants.

### Review / verification thread
- **Model:** Sonnet 5.5
- **Effort:** High
- Independent of the writer when possible.

### Documentation / evidence thread
- **Model:** Sonnet 5.5
- **Effort:** Medium or normal
- Use for release records, evidence formatting, spec cleanup, fixture reports after technical decisions are already frozen.

## 2. Do not use four Claude coding threads merely because four are available

Thread count follows dependency structure.

Good parallel set:
```text
Coordinator — Opus High
├── Writer — Sonnet High
├── Security reviewer — Sonnet High
├── Performance/DB reviewer — Sonnet High
└── Verification/evidence — Sonnet Medium/High
```

If the repository currently authorizes only one writer, the non-writer threads remain read-only.

## 3. Coordinator context discipline

The coordinator should not implement every task.

Its scarce context is reserved for:
- authority;
- architecture;
- dependency order;
- cross-task contracts;
- integrating review findings;
- deciding whether acceptance criteria are actually met.

## 4. Thread prompt minimum

Every implementation/review thread receives:

- active release;
- task ID;
- accepted-spec path;
- exact goal;
- owned files/domain;
- read-only neighbors;
- frozen contracts;
- required behavior;
- failure behavior;
- tests/evidence;
- stop conditions;
- required handoff format.

## 5. Usage-saving rules

- research once, write findings to repository evidence;
- do not make every thread rediscover architecture;
- send narrow context;
- use deterministic tests before asking a model to reason about failures;
- reuse frozen contracts;
- do not re-review unchanged code;
- checkpoint early enough for another model/session to resume;
- prefer one excellent reviewer over several overlapping reviewers.

## 6. Model-role stability rule

The stable contract is the **role**, not the literal model name:

- coordinator = highest-capability reasoning/orchestration model appropriate to the plan;
- implementation = strong coding model with High effort;
- critical implementation/review = stronger effort only when justified;
- documentation = lower-cost capable model.

Do not block Road-to-V3 solely because a specific dated Claude model name disappears.
Do not silently change models either: record the replacement and reason.
