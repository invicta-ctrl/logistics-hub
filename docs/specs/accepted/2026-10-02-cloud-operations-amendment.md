# Accepted Amendment — Cloud Operations lane (release-scoped production preparation)

STATUS: ACCEPTED
ACCEPTED_BY: Earl (instruction of 2026-10-02: "Remove the Logistics Hub's dependency on Earl's local Windows machine for controlled production preparation by creating a repository-native Cloud Operations lane")
ACCEPTED_DATE: 2026-10-02
APPLIES_TO: invicta-ctrl/logistics-hub
SCOPE: operational and governance only. It does not change any product behavior, V1.2, or the Road-to-V2 order, and it does not start V1.3.

## Objective

Production preparation for a release (today: creating an R2 bucket and applying one D1 migration, with a backup and a rollback point) must no longer need Earl's Windows PC. It runs from GitHub Actions, in a `production` environment, from a declarative per-release manifest, and leaves an auditable report. All existing production safety requirements stay: exact target, preflight, backup, rollback point, explicit owner authority, post-change verification.

## The one temporary branch

`ops/cloud-production-runner` is allowed as a single temporary branch while the completed V1.2 branch (`road-to-v2/v1.2-item-profiles-media`) stays **frozen** (no commits, no merges into it). It is the "one active writer" exception for this slice only:

1. It starts from the latest `main` and carries only this mechanism: the script, the workflow, the release manifests, their tests and documents.
2. It is merged to `main` (fast-forward) once its gates are green, then deleted locally and remotely, **before** V1.2 is integrated.
3. It is not a Road-to-V2 branch, so forward propagation does not apply to it; it reaches the Road-to-V2 branches when V1.2 is brought onto the updated `main` and propagated in the normal way.
4. Afterwards the branch budget is as before: `main` and at most one active branch.

## What was built

| Piece | Path |
|---|---|
| Release script (also the library the tests use) | `scripts/ops/production-release.mjs` |
| Workflow (manual dispatch only, `production` environment) | `.github/workflows/production-ops.yml` |
| Release manifests | `ops/releases/<release>.json` (V1.2: `ops/releases/v1.2.json`) |
| Tests | `tests/production-release.test.ts` |
| Runbook | `docs/DEPLOYMENT.md` → "Cloud Operations" |

No framework and no new dependency: Node's own `crypto`, `fs`, `child_process` and `fetch`, and the `wrangler` already in `devDependencies`.

## Safety requirements, and where each is enforced

1. **Explicit release and exact SHA.** The workflow takes `release` and a full 40-hex `expected_sha`. The script refuses unless the checked-out release tree is exactly that commit, the commit is on the manifest's release branch or on `main`, and the tree's `wrangler.jsonc` and migration files match the manifest.
2. **Only the Logistics Hub's own resources.** The manifest names the Worker, the D1 database (name, binding, id) and the R2 buckets; the release `wrangler.jsonc` must match exactly, the old `hau-usc-logistics-production` and `-staging` names are forbidden everywhere, and every `wrangler` or API call goes through an allowlist that accepts only the fixed set of read statements, export, Time Travel, bookmark, the manifest's bucket names, and the two authorized writes. `wrangler` itself never runs in the release checkout: it runs in a fresh directory holding a config generated from the manifest and the release's migration files, with a minimal environment (no inherited secrets, no `.env`, no other config), so nothing in a release can redirect it. The D1 binding must carry exactly the manifest's keys.
3. **Read-only preflight first** (always, and as its own workflow mode): applied migrations equal the release's migration files minus the manifest's pending list; the pending list is exactly what the manifest says; the buckets to create are absent; the buckets that must exist do (their creation time is recorded), and are private. A missing or invalid backup key stops even the preflight.
4. **Backup before any change.** A D1 export, encrypted before it leaves the runner to Earl's **public** key (`OPS_BACKUP_PUBLIC_KEY`: a random AES-256-GCM key wrapped with RSA-OAEP; RSA of at least 3072 bits; a private key pasted by mistake is refused), checked for plausibility, with the plaintext deleted at once. The runner cannot open the backup again; Earl keeps the private key offline. Only the ciphertext is uploaded as an artifact. Production data never enters Git, a log, or a readable artifact.
5. **Rollback point.** A D1 Time Travel bookmark is recorded in the report before the first change.
6. **Only the manifest's operations, in order:** `PRECHECK → BACKUP → BOOKMARK → BASELINE → CREATE_BUCKET → VERIFY_BUCKET → APPLY_MIGRATIONS → RECONCILE → READY_TO_MERGE`. Any unexpected state stops the run (fail closed), names the step and says what is and is not changed.
7. **Post-change reconciliation, read-only:** exactly the intended migration was added; exactly the intended schema objects appeared and nothing else changed; item, movement, on-hand, loan and phone-record figures equal the baseline taken just before the change; new tables are empty; the evidence bucket still exists with the same creation time; the bucket list differs by exactly the new bucket; the new bucket is private; and `d1_migrations` records the migration (wrangler reporting success is not enough).
8. **Auditable report** (`report.json`, `report.md`): every step, its status and evidence (names, counts, hashes, bookmark), the operations performed, and the result. It holds no production rows.
9. **Never on a push.** The workflow has only `workflow_dispatch`. Preparing needs a typed confirmation `PREPARE <release> <sha>`. Merging `main` never migrates production.
10. **Who can run it.** The real controls are configured on the GitHub `production` environment: deployment branches limited to `main` and a required reviewer. These are **required** setup steps (the workflow and script also refuse any ref except `main`, but that is defence in depth, since whoever can change the tooling on a branch can change that check).

## Credentials (GitHub `production` environment)

Three secrets, configured once by Earl in Settings → Environments → `production`, together with the required deployment-branch rule (`main` only) and a required reviewer:

- `CLOUDFLARE_API_TOKEN`: scoped to the Logistics Hub account, with D1 (Edit) and Workers R2 Storage (Edit) permissions only.
- `CLOUDFLARE_ACCOUNT_ID`.
- `OPS_BACKUP_PUBLIC_KEY`: the public half of an RSA key pair (at least 3072 bits) that Earl generates; the private half stays offline with Earl and opens the backups (`node scripts/ops/production-release.mjs decrypt --in <file> --key <private.pem> --file <out.sql>`). Setup commands are in `docs/DEPLOYMENT.md`.

No credential is stored in the repository, a log, or a plaintext artifact. The script strips the token from every captured output and from the report files.

## What this amendment does not do

It does not apply anything to production by itself, does not merge V1.2, does not weaken any existing rollback or backup requirement, and does not authorize operations that are not in a release manifest. A new release needs a new manifest, reviewed like code.
