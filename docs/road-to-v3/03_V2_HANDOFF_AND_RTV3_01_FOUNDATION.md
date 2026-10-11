# V2.0 Handoff and V2.1 (RTV3-01) Foundation

This file fixes the former circular gate.

## 1. V2.0 handoff asks only what V2 can truthfully verify

V2.0 must provide:

- final production commit/deployment identity;
- known migration level;
- known D1/R2 bindings;
- CI status;
- current production verification status;
- list of open defects/known limitations;
- accepted V2 invariants;
- current branch/worktree/active-writer state;
- current AI configuration/evidence from V1.15;
- rollback reference;
- existing measurements, **if already available**.

V2.0 is **not required** to invent:
- new route budgets;
- full provider cost baselines;
- new 1×/10×/100× activity fixtures;
- flake-free reproduction of every historical review finding;
- new RPO/RTO evidence.

Those belong to RTV3-01.

## 2. RTV3-01 purpose

**Planned product release: V2.1.** `RTV3-01` remains the stable internal milestone name.

RTV3-01 turns the inherited V2 system into a measured, observable, recoverable, Road-to-V3-ready platform.

It contains real engineering work, not only documents.

## 3. RTV3-01 size cap and packets

RTV3-01 is limited to these eight implementation packets:

### F1 — Final V2 reconciliation
- reproduce prior code/security review findings against the actual V2.0 baseline;
- mark each: reproduced / already fixed / stale / cannot reproduce / owner decision;
- classify confirmed severity.

### F2 — Operational tooling and supply-chain security
- deployment secret/state handling;
- fail-closed Git/deploy detection;
- CI action/dependency policy;
- stale allowlists/runtime policy;
- secret/private-data scanning validity;
- migration verification;
- production decrypt/output protection.

### F3 — Offline reliability
- poison-record isolation;
- visible/exportable quarantine;
- retry fairness;
- non-JSON/error cleanup;
- head-of-line avoidance;
- idempotent replay evidence.

### F4 — Observability implementation
- correlation/request ID;
- structured log field contract;
- deployment/version identity;
- **Owner-required V2.1 Administration version display:** reuse the existing Administration → System `This version` panel. Current code (`src/admin-system.ts`, `src/system-status.ts`, `vite.config.ts`) shows the 12-hex build fingerprint, commit and built-at time. Add a separate prominent **Product version: V2.1** from the *actual deployed* build/release metadata. Preserve `build.json.version` as the build/PWA fingerprint and preserve existing Commit/Built details. Prefer extending the existing governed System endpoint and build metadata; do not create another panel or publicly expose `/build.json`;
- keep product release labels repeatable for V2.2–V2.9 and V3.0; malformed/missing version metadata must show Unknown rather than a guessed release, and rollback must reflect the running version;
- verify the label in the deployed V2.1 Administration UI (phone/desktop, authorized and denied access), and distinguish production identity from local/source build identity;
- typed failure classes;
- D1/R2/provider failure visibility;
- user-support reference where useful.

This is actual Worker/application code and tests.

### F5 — Measurement and route inventory
- enumerate public/staff routes;
- measure bundle/request/payload/render behavior;
- D1/R2/provider usage where available;
- define 1×/10×/100× fixtures;
- define realistic synthetic activity profiles;
- freeze evidence-based budgets.

### F6 — Recovery and incident proof
- verify restore tool fails closed;
- representative D1 restore proof;
- representative R2 evidence proof;
- test the initial RPO/RTO targets or request an owner amendment;
- incident runbook and ownership.

### F7 — Ambient Assist platform hardening
- shared task/model registry;
- router contracts;
- schema validation;
- privacy allowlists;
- quota/circuit breaker;
- provider/model replacement procedure;
- aggregate observability;
- failure/fallback tests.

### F8 — Product-direction amendment preparation + release closure
- pre-draft the RTV3-02+ product-direction amendment;
- list retired V2 features affected by later cutovers;
- define decommissioning-plan template;
- complete RTV3-01 release evidence.

## 4. RTV3-01 P0 rule

Confirmed P0 findings discovered by F1 are owned by RTV3-01.

RTV3-01 cannot close while a reproducible P0 is open.

A P0 may not be "deferred to RTV3-02."

## 5. RTV3-01 Definition of Done

RTV3-01 is complete only when:

- all eight packets are complete or an accepted amendment explicitly removes one;
- no open reproducible P0 exists;
- review reconciliation register is current;
- route inventory exists;
- accepted budgets are derived from measurement rather than invented;
- 1×/10×/100× fixtures exist and have named activity assumptions;
- correlation/logging contract is implemented and tested;
- Administration → System shows correct **V2.1 product version**, separately from build fingerprint, commit and timestamp, based on verified deployed metadata; missing/mismatched metadata fails honestly, access controls and rollback behavior are covered;
- operational tooling fails closed where required;
- offline poison-record behavior is visible, exportable, retryable, and non-blocking;
- restore proof validates representative business data and R2 evidence;
- RPO/RTO targets are demonstrated or formally amended;
- incident ownership/runbook exists;
- Ambient Assist failure/quota/privacy behavior is proven;
- product-direction amendment for RTV3-02+ is pre-drafted and ready for owner signature;
- repository continuity files and release record are current;
- production/staging verification required by the accepted spec is complete.

## 6. What RTV3-01 does not require

Owner approval of the future product-direction amendment is not required to **start or complete the technical packets** of RTV3-01.

However, RTV3-02 implementation cannot start until that amendment is accepted.

## 7. RTV3-01 execution order

The packets are not unordered.

```text
F1 — Final V2 reconciliation
        ↓
        ├── F2 Operational tooling / supply-chain security
        ├── F3 Offline reliability
        ├── F4 Observability implementation
        └── F7 Ambient Assist platform hardening
                 ↓
F5 — Measurement / route inventory / fixture budgets
        ↓
F6 — Recovery / incident proof
        ↓
F8 — Product-direction amendment preparation + release closure
```

Rules:

- F1 runs first because confirmed findings may resize F2–F7.
- F2/F3/F4/F7 may proceed in parallel after F1 classification and contract ownership are clear.
- F5 may begin baseline capture early, but **final accepted budgets** are frozen only after the instrumentation needed to measure them is trustworthy.
- F6 uses the measured/observed system and therefore follows the relevant F2/F4/F5 groundwork.
- F8 may draft the amendment early, but release closure happens last.

## 8. Quota-policy re-derivation

RTV3-01 must explicitly re-derive the Ambient Assist quota policy from:

- current Cloudflare Workers AI allowance/pricing;
- measured task-level Neuron use where available;
- observed request mix;
- required reserve for high-value user-triggered work;
- graceful-degradation behavior.

The inherited ~8,000 normal / 9,500 stop values remain a **provisional owner policy** until this measurement is recorded.

F7 owns the AI-specific derivation.
F5 records provider/resource measurements needed by F7.

## 9. Browser/accessibility deliverable

F5 also owns the concrete supported-browser/device matrix and accessibility evidence baseline required by the Engineering Constitution.

The release record must state:

- intended support matrix;
- actually tested matrix;
- accepted gaps;
- accessibility checks run;
- any real-device checks still requiring owner action.
