# Adopt the release gate
Use the repository's actual approved app root, package manager, exact Node version, and existing test tooling. Before any feature work, resolve governance.json and the required document markers; get owner approval for missing decisions.
## Required package scripts
- lint: ESLint (or the accepted equivalent) over application and test source.
- typecheck: TypeScript strict check, including generated framework types.
- test: unit/integration runner; native machine-readable results in unit.json.
- build: real production Worker/application or library/catalog build.
- test:e2e: Playwright or accepted browser runner, actual critical journeys; e2e.json.
- test:a11y: browser axe-core scans with zero unapproved violations; a11y.json.
- test:visual: Playwright screenshot regression against reviewed baselines; visual.json.
- test:security: relevant authorization, denial, tenant isolation, integrity, input and secret checks; security.json.
- test:license: exact dependency and asset license inventory, approved notices, fail on forbidden/unresolved use; license.json.
- test:perf: Lighthouse CI / accepted representative performance test; perf.json.
Every report is a nonempty JSON object/array from real tool execution, written to the absolute KAWING_EVIDENCE_DIR supplied by the runner. Use the runner's native JSON reporter or an adapter that serializes actual results; never hand-write a synthetic pass flag. Exit nonzero on failed assertions. Report actual cases, failures, measurements and coverage; preserve sanitized supporting artifacts in that directory. Playwright supports JSON reporter with PLAYWRIGHT_JSON_OUTPUT_FILE; configure separate suites/fixtures and use the corresponding report filename. For Lighthouse CI, configure actual approved URLs/start command, three representative runs, LCP <=2500 ms, CLS <=0.1, TBT <=200 ms; export measured and assertion results. These lab measurements are not field INP. Do not fabricate route names or test scripts. The shared library uses stories/consumer fixtures for browser and performance coverage.
Run node --test scripts/foundations.test.mjs to check the shared automation itself; its fixtures are synthetic, not product evidence. Run node scripts/check-governance.mjs, install locked dependencies, and node scripts/release-readiness.mjs locally from repository root. The hosted quality workflow runs the same gate. Review the results and report contents, not just existence or status.
Require Kawing release readiness in the main branch ruleset and code owner review. Review and verify the real GitHub settings; if plan support is missing, block production release pending an explicit owner-approved equivalent safeguard per QUALITY.md. Ensure Cloudflare's single approved deployment trigger gates the exact candidate SHA, and verify deployment identity and smoke tests. This kit does not grant deployment authority.

## Logistics Hub adoption
Existing real commands: typecheck, test, build, test:browser, test:browser:worker, verify:privacy, verify:migration and verify:restore. CI also runs database performance fixtures. New readiness gate requires real reports and additional lint, axe, reviewed visual, license and measured performance coverage. The adopted mappings use actual Vitest and Playwright native results, with separately selected axe and screenshot suites. Missing reviewed screenshot baselines or unverified asset/dependency licensing fail closed. New gates may reveal pre-existing failures; no automatic snapshot acceptance or exception is authorized. Existing CI, CodeQL and deploy workflows remain until a qualified approved consolidation. Node 22.23.4 pinned from successful CI job 131078297553; local Bridge Node 26.3.0 is not the pinned readiness runtime.

### Remediation status
Isolated Node 22.23.4 is now available; see CURRENT for executable path and verification. Lint preserves unused-variable errors except explicitly intentional discard conventions. `licenses/assets.json` records all public files with SHA-256, provenance, and status; approved records require matching content hash and nonempty license/evidence. Unresolved assets/dependencies fail the gate; no presumed institutional rights. Full readiness remains blocked on measured legacy test lint, full suites, reviewed snapshots, actual Desktop skills/model and release safeguards.
