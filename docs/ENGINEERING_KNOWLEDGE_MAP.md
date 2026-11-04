# Engineering knowledge map — 140 topics

Status: **reference and review aid**, adopted for training and technical assessment on 2026-11-03. **Not** a blanket technology mandate, accepted feature spec, deployment approval, or a demand to introduce every pattern/tool. Every agent starts from the current accepted slice and uses the smallest appropriate subset. For UX and launch checks see WEB_QUALITY_RELEASE_GATES.md.

## How to apply

- **Foundation**: relevant correctness, data integrity, security, testing, accessibility and Git practices are expected in affected features.
- **Conditional design choice**: apply only where observed requirements, data volume, load or failure modes justify it; document alternatives/tradeoffs.
- **Future capability**: keep out of production until a scoped specification with acceptance tests approves it.
- **Study only**: algorithms, interview concepts and design patterns do not automatically belong in the app.

For Logistics Hub: the active V1.16.x accepted scope and existing Cloudflare Worker/D1/R2 architecture govern, not this catalog. Do not introduce new infrastructure or redesign on the strength of a reference list.

## 1 — Backend (20)

1. REST APIs — resource contracts; foundation if an API route is in scope.
2. HTTP and status codes — correct semantics, failure cases; foundation.
3. Authentication with JWT — optional credential strategy, not a default.
4. OAuth 2.0 — conditional delegated authorization and threat model.
5. Sessions and cookies — secure lifecycle, CSRF/SameSite; foundation where sessions used.
6. SQL vs NoSQL — explicit data-model choice; do not add a second database by habit.
7. Database indexing — query-plan and measured-access driven.
8. Transactions and ACID — critical for stateful writes and financial/inventory truth.
9. ORM and migrations — migrations mandatory when schema changes, ORM optional.
10. Caching with Redis — optional tool, not needed by default on Cloudflare/D1.
11. Message queues — only for durable asynchronous work requiring decoupling.
12. Rate limiting — relevant for public endpoints and privileged actions.
13. WebSockets — optional real-time transport when polling or SSE insufficient.
14. Background jobs — durable retries/outbox as requirements warrant.
15. File uploads to S3 — generic object-storage concept; use approved provider (e.g. R2) per project.
16. Pagination — bounded large datasets and stable sort/cursors.
17. API versioning — compatibility when actual clients demand it.
18. Input validation — canonical server-side boundary.
19. Logging and monitoring — safe operational evidence without PII leakage.
20. Unit and integration tests — risk-matched regression gates.

## 2 — Data structures and algorithms (20)

1. Arrays and strings
2. Hashing
3. Two pointers
4. Sliding window
5. Prefix sum
6. Binary search
7. Stack and queue
8. Monotonic stack
9. Linked list
10. Recursion
11. Backtracking
12. Trees and BST
13. Heap / priority queue
14. Tries
15. Graphs BFS / DFS
16. Topological sort
17. Dijkstra
18. Union find
19. Greedy
20. Dynamic programming

These are **study/problem-solving tools**. Choose an algorithm only when a bounded route, search, scheduling or optimization feature needs it, and test correctness/complexity on real input sizes. Do not turn the platform into an algorithm demonstration.

## 3 — High-level design (20)

1. Scalability — workload targets and bottleneck evidence.
2. Load balancing — platform/edge features if needed.
3. Caching — staleness and invalidation guarantees first.
4. CDN — public immutable assets; approved provider.
5. Database sharding — future extreme-scale option, not pilot architecture.
6. Replication — explicit consistency/failover needs.
7. Consistent hashing — conditional partition placement mechanism.
8. CAP theorem — tradeoffs during partitions.
9. PACELC — latency versus consistency in healthy operation.
10. Consistency models — define observable invariants first.
11. Kafka and pub/sub — evaluate only for necessary event volume/decoupling.
12. Event-driven architecture — only with durable processing and traceability.
13. Microservices — avoid premature split; prefer cohesive modular monolith.
14. API gateway — only when multiple APIs/policies justify it.
15. Rate limiter design — actor/tenant/action scope and shared-state correctness.
16. Bloom filter — probabilistic optimization with false-positive policy.
17. Circuit breaker — resilience for unstable remote dependencies.
18. Saga pattern — compensating workflow for cross-boundary transactions.
19. Blob storage — secure object lifecycle/retention; R2 where approved.
20. Back-of-envelope estimation — traffic, data, storage, latency and cost budgets before scaling.

## 4 — Low-level design (20)

1. OOP pillars
2. SOLID principles
3. DRY / KISS / YAGNI
4. Composition over inheritance
5. UML class diagrams
6. Singleton
7. Factory
8. Abstract factory
9. Builder
10. Prototype
11. Adapter
12. Decorator
13. Facade
14. Proxy
15. Observer
16. Strategy
17. Command
18. State
19. Thread safety
20. Machine coding

Only use patterns that eliminate demonstrated complexity. Existing TypeScript/functional modules are valid; no compulsory classes, diagram factory, extra layers or singleton global state. Prioritize explicit order/payment state machines and concurrent mutation safety when those features are accepted.

## 5 — AI and agentic systems (20)

1. LLM fundamentals
2. Tokens and context window
3. Prompt engineering
4. Structured outputs
5. Embeddings
6. Vector databases
7. RAG pipelines
8. Chunking strategies
9. Reranking
10. Tool calling
11. MCP protocol
12. ReAct agent loop
13. Planning and reflection
14. Agent memory
15. Multi-agent systems
16. Agent orchestration
17. Guardrails
18. Evals
19. Observability and tracing
20. Fine-tuning with LoRA

**Conditional / future only.** Logistics intelligence may use the narrowest approved capability. Never give AI authorization to change price, confirm payment, move stock or mutate records without validated, audited server-side policy. Threat-model prompt injection and data leakage, validate structured responses, evaluate fallback/cost. Embeddings, vector stores, fine-tuning and multi-agent orchestration are not automatic dependencies.

## 6 — DevOps (20)

1. Linux and Bash — operator fluency, scoped scripts.
2. Networking basics — DNS, TCP, TLS, routing.
3. Git and GitHub — short-lived slices/PRs and verified main.
4. Docker — only when the stack/test harness needs containers.
5. Docker Compose — optional local multi-service orchestration.
6. Kubernetes — **not** justified by default for Cloudflare pilot.
7. Helm — only if Kubernetes was separately accepted.
8. CI/CD pipelines — exact commit checks, protected release boundary.
9. GitHub Actions — existing checks and controlled execution permissions.
10. AWS Cloud — provider knowledge, not requirement to migrate from Cloudflare.
11. Terraform — optional repeatable infrastructure once approved.
12. Ansible — optional server configuration, no VPS by default.
13. Nginx reverse proxy — optional self-hosted architecture only.
14. Load balancers — managed provider functionality unless demonstrated need.
15. Prometheus — optional metrics tooling.
16. Grafana — optional observability dashboard.
17. ELK logging — avoid costly stack for tiny pilot; use safe bounded logs.
18. Blue-green deploys — strategy for zero-downtime where platform supports it.
19. Auto scaling — measured load/cost limits and provider behavior.
20. Secrets management — mandatory secure lifecycle for deployed credentials.

## 7 — Cybersecurity (20)

1. OWASP Top 10 — risk review baseline.
2. SQL injection — parameterized queries, no user SQL.
3. XSS — output encoding, safe templates/config.
4. CSRF — session/cookie write protection when relevant.
5. CORS — explicit origin policy, not authentication.
6. SSRF — constrain outbound URLs/metadata access.
7. HTTPS and TLS — secure transport.
8. Hashing and encryption — correct primitives for each purpose.
9. Password hashing — modern adaptive hashing when passwords owned.
10. Secure sessions — expiry, revocation, cookie attributes.
11. JWT security — signatures/claims/revocation if JWT selected.
12. OAuth security — redirect, state/PKCE and scopes if OAuth selected.
13. Secrets management — scoped and rotated, never public.
14. IAM and least privilege — role/tenant/branch denies.
15. Security headers and CSP — defense in depth against injection/clickjacking.
16. Rate limiting and DDoS — edge and per-identity abuse controls.
17. Input validation — server canonical validation.
18. Dependency scanning — verified lockfiles and dependency review.
19. Penetration testing — authorized environments/scopes and remediation.
20. Prompt injection — for any deployed AI retrieval/tool integration.

## Per-slice adoption evidence

In the existing PR/handoff, write: affected routes/features; relevant numbered topics; **implemented vs existing vs N/A vs deferred**; acceptance criteria; exact tests, security evidence, diff review, and remaining risks. Treat missing expertise as an investigation item, not an invitation to implement every tool.

Reference standards: OWASP ASVS https://asvs.owasp.org/ ; NIST SSDF https://csrc.nist.gov/pubs/sp/800/218/final ; W3C WCAG 2.2 https://www.w3.org/TR/WCAG22/
