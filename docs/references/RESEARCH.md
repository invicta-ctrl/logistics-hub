# Research: Distinctive UI/UX and Production-Quality Frontend Engineering

**Finalized:** 2026-11-25
**Scope:** Websites, web applications, and AI-assisted frontend development
**Status:** Research reference and proposed acceptance baseline; not an approved project specification.

## 1. Executive findings

The central problem with poorly directed vibe coding is not the use of AI. It is the absence of deliberate art direction, product-specific decisions, engineering judgment, and verification. Generative tools can converge on familiar visual patterns. Research on web design homogenization and Anthropic's own frontend guidance support the need for explicit design direction [1–3].

A professional interface should have a recognizable identity, clear hierarchy, coherent spatial system, complete interaction behavior, reliable data, accessible controls, and an implementation proportional to the problem. No particular font, color, layout, or animation proves AI authorship. The aesthetic observations below are qualitative review heuristics, not a validated detection method.

**Application rule:** Distinguish mandatory quality requirements from preferred art direction and conditional engineering techniques. Do not replace one generic AI aesthetic with another, or impose enterprise infrastructure on an MVP.

### Evidence and scope

- User-provided observations: 19 visual/copy anti-patterns, five preferred composition treatments, Apple-inspired spacing principles and concentric corner geometry.
- Eleven JPEG reference images in `D:\Documents\Projects\Design`: 222 listed concept entries (20 design concepts, 22 background treatments, and nine groups of 20 engineering concepts). Entries overlap; this is not a count of unique techniques.
- Public research, official design guidance, accessibility standards, browser documentation, performance guidance and security references listed in §9.
- Four SVG files in the `svg` subfolder were excluded. The screenshots are secondary educational references, not normative specifications; not every individual term was independently researched.

## 2. Anti-vibe-coding review catalog

Discourage these patterns as automatic defaults. Permit them when supported by a specific content, usability or brand requirement. Reject fabricated content and deceptive functionality outright.

| Area | Telltale patterns | Better approach |
|---|---|---|
| Buttons and navigation | Arrows on every button; excessive pills; generic floating navigation; indistinguishable primary and secondary CTAs | Match icons to action semantics; clear hierarchy; familiar navigation where useful |
| Labels and separators | Little dots between words; overused eyebrows (small labels above headings); pills above headlines; gratuitous section numbering | Use metadata, labels and numbering only when they communicate meaningful structure |
| Typography | Defaulting to Instrument Serif or Inter without justification; one italic word in every headline; gradient text; excessive tracked uppercase | Distinctive but readable typography, purposeful emphasis, a limited type scale and deliberate line breaks |
| Copy | Overusing “quiet,” “real,” “seamless,” “effortless,” “elevate,” “unlock” and similar marketing vocabulary; repeated two-word sentences; vague promises | Concrete product language, varied natural sentence rhythm, factual benefits and actionable labels |
| Color | Automatic cream backgrounds, beige/terracotta palettes, purple-blue gradients and gratuitous accents | Colors derived from brand, purpose and contrast requirements; use neutrals and accents intentionally |
| Iconography | Sparkle icons everywhere; inconsistent AI-generated icons; random icons on every label | Coherent, accessible icon set, recognizable symbols and text where needed; custom assets only when useful |
| Layout | Everything in a card; three identical icon cards; default bento grids; repetitive centered sections; colored left borders as decoration | Use typography, whitespace, dividers, lists, tables and asymmetric grids according to content |
| Hero and depth | Blurry glows behind the hero; excessive shadows or glass panels; arbitrary floating shapes | Product-led composition, restrained realistic lighting, actual product media and meaningful depth |
| Motion | Pulsing green dots; every section fading on scroll; repeated hover lifts and parallax | Motion communicates state, continuity or product behavior; status indicators reflect real status |
| Imagery | Indiscriminately dithered photos, generic AI illustrations, misleading product mockups | Relevant photography or honest, clearly labeled conceptual imagery; consistent art direction |
| Credibility | Made-up statistics, logos, testimonials, ratings and live indicators | Verified evidence or omit the claim; explicitly label demo data |
| Components | Unmodified UI-kit defaults with no product rationale; inconsistent radii, spacing and elevation | Reuse accessible primitives, customize deliberately through shared tokens, preserve working behavior |
| Page structure | Automatic hero–features–stats–testimonials–pricing–CTA sequence regardless of product | Structure content around the actual audience, questions and primary task |

### Functional and engineering warning signs

- Dead links, simulated actions, false success messages, mock data appearing as real, and edits lost on refresh.
- Missing empty, loading, validation, error, success, disabled, permission-denied and offline states where applicable.
- Desktop layouts merely squeezed into mobile viewports; overflow, illegible text, fixed overlays hiding controls, keyboard traps.
- Inconsistent component variants, arbitrary spacing values, duplicate code and competing state stores.
- Expensive effects, unused dependencies, unnecessary client JavaScript, slow or unstable rendering.
- Authorization enforced only in the UI, exposed secrets, insecure storage, unsafe caching or unvalidated server inputs.
- No regression tests, visual review, operational error visibility, or recovery strategy where relevant.

## 3. Preferred visual direction

These are creative preferences, not universal requirements. Select a coherent subset appropriate to the brand and task.

| Treatment | Intent and implementation |
|---|---|
| Monumental type scale | Use expressive display type and strong size contrast for editorial or marketing moments. Preserve reading order and responsive wrapping. |
| Overlapping product showcase | Let real product imagery intersect the headline or grid when it strengthens the focal point; never obscure essential text or controls. |
| Studio light, real shadow | Ground objects with plausible material, direction of light and contact shadows; avoid arbitrary glow behind every element. |
| Swiss grid | Establish deliberate alignment, modular proportions, typography-led hierarchy and asymmetry where appropriate. |
| Liquid Glass control dock | Use a restrained translucent control/navigation layer if it improves interaction; protect contrast and provide a solid fallback. Apple's material guidance is a native-platform reference, not a web implementation mandate [4–6]. |
| One living hero moment | One signature demonstration, interactive product view or orchestrated motion sequence is generally more memorable than repeated decorative transitions. Make the experience usable without animation. |

### Marketing vs. application UI

| Dimension | Marketing website | Operational application |
|---|---|---|
| Typography | Expressive, editorial hierarchy | Legible, compact, predictable hierarchy |
| Composition | Immersive, product-led, selective asymmetry | Task-oriented, stable, efficient layout |
| Spacing | Generous section separation | Density appropriate to content and task |
| Motion | Optional signature moment | Feedback and continuity; minimal distraction |
| Navigation | Audience and conversion oriented | Discoverable, consistent, keyboard operable |
| Surfaces | Selective expressive materials | Functional grouping; tables/lists before gratuitous cards |

## 4. Design system and interaction craftsmanship

### 4.1 Spatial system

- **Deference:** Put content and primary tasks ahead of decorative interface chrome. Use negative space and proximity to establish grouping before adding containers.
- **Grid rhythm:** A proposed starting scale is `4, 8, 12, 16, 24, 32, 48, 64, 96, 128px`. Use a 4px base with an 8px primary rhythm; choose a smaller set if the project needs less. This is a convention, not an Apple mandate.
- **Margins:** Start around 16px on small screens and 24px or more on larger screens when appropriate; scale with content and available width. Native iOS points and web CSS pixels are distinct units. The supplied 16pt iPhone and 20–24pt iPad values are examples, not universal requirements.
- **Touch targets:** Prefer 44×44 CSS px for touch-oriented web controls where feasible. Apple lists 44×44 pt as the default iOS/iPadOS control size and 28×28 pt as its minimum [5]. WCAG 2.2 SC 2.5.8 is a 24×24 CSS px Level AA minimum with exceptions, while SC 2.5.5 specifies 44×44 CSS px at AAA with exceptions [7].
- **Safe areas:** Account for notches, browser/device overlays and fixed controls; use CSS `env(safe-area-inset-*, 0px)` when applicable [8]. A safe-area inset does not replace ordinary spacing.
- **Concentric radii:** For uniform insets and circular concentric corners, `outer radius = inner radius + inset`. The inset is the geometric separation between the actual corner boundaries (including border thickness if applicable). Example: inner 12px, inset 8px → outer 20px. CSS radius clamping, unequal insets and noncircular corners may require optical adjustment.
- **Token ownership:** Define shared roles for spacing, type, color, radii, shadows and motion. Allow explicit, justified exceptions; avoid token proliferation.

### 4.2 Typography, color and interaction details (20 image entries)

| Concept | Application |
|---|---|
| Kerning | Refine individual letter-pair spacing where display type needs adjustment. |
| Optical centre | Correct perceived alignment when geometry alone looks wrong. |
| Tabular numbers | Use equal-width numerals for comparable data and changing values. |
| Layout shift | Reserve media and asynchronous content space; prevent disruptive movement. |
| Tracking | Adjust overall letter spacing for the intended type size and style. |
| Optimistic update | Reflect a safe action promptly; reconcile with server response and recover on failure. |
| X-height | Compare perceived size and readability when pairing typefaces. |
| Touch target | Provide usable hit areas beyond the visible icon if needed. |
| Leading | Choose line height for readability, font metrics and density. |
| Origin-aware animation | Anchor transitions to the initiating control or meaningful spatial origin. |
| OKLCH | Optionally use perceptually oriented color coordinates for palette work; check actual rendered contrast [9]. |
| Widow | Avoid awkward isolated words in headings where practical; do not hardcode brittle breaks. |
| Safe area | Respect screen insets, navigation and overlays. |
| Stagger | Sequence related motion sparingly rather than animating all content. |
| Line length | Use a comfortable measure; roughly 45–75 characters is a starting heuristic for prose, not a compliance rule. |
| Affordance | Make actionable elements recognizable, including without color or hover. |
| Combobox | Use native selection for simple needs; use an accessible searchable widget for complex choices [10]. |
| Interruptible animation | Let users cancel, reverse or continue without waiting for an effect. |
| Progressive disclosure | Reveal secondary complexity when relevant, without hiding essential information. |
| Shared element transition | Preserve continuity when a meaningful object changes view; offer a reduced-motion alternative. |

Prefer native semantics and accessible primitives. Motion should not block use or make hidden content unavailable; honor `prefers-reduced-motion` [11]. Provide a readable fallback for transparent surfaces, video, custom effects and unsupported features. Use color with text, shape or another cue for important status.

### 4.3 Optional backgrounds and materials (22 image entries)

| Family | Available treatments |
|---|---|
| Tactile | Felt texture; speckled graphite; grass texture; paper texture |
| Optical | Fluted glass; water ripples; lens distortion; iridescent shapes |
| Tonal | Thermal gradients; grainy gradients; stippled gradients |
| Editorial | Single-hue landscapes; cloud sky; blurred photos; impressionist paintings |
| Technical | Blueprint grids; contour lines; square-dot grids |
| Print and digital | Halftone; dithered images; pixel mosaics; ASCII and pixels |

Use a treatment only if it reinforces identity or comprehension. Optimize image dimensions and transfer size, preserve contrast, avoid distracting noise behind text, and use owned or appropriately licensed assets. Dithering, grids and blur are legitimate techniques but are also anti-patterns when used indiscriminately.

## 5. Frontend engineering research

The nine engineering screenshots contain 180 entries. Each row below preserves all 20 source concepts in compact form, followed by the practical decision rule. They are a knowledge inventory, not an implementation checklist requiring every option.

### 5.1 Rendering

**Source concepts (20):** CSR vs SSR; static generation (SSG); incremental static regeneration; streaming SSR; hydration; partial hydration; islands architecture; React Server Components; edge rendering; critical rendering path; reflow and repaint; virtual DOM; reconciliation; layout thrashing; paint and composite; lazy rendering; pre-rendering; SEO and rendering; Suspense boundaries; choosing a strategy.

**Application:** Select one suitable rendering strategy per route or application based on content freshness, SEO, personalization and complexity. Public stable pages often benefit from static output; authenticated interactive applications may need server rendering, client rendering or both. Avoid redundant frameworks, hydration and client code; measure before optimizing. Do not adopt islands, streaming or server components merely because they are available.

### 5.2 Performance

**Source concepts (20):** Core Web Vitals; LCP; INP; CLS; TTFB; code splitting; tree shaking; lazy loading; image optimization; font loading; bundle analysis; prefetch and preload; compression; debounce and throttle; memoization; virtualized lists; Web Workers; performance budgets; Lighthouse; real user monitoring.

**Application:** Optimize critical assets and rendering first. Avoid lazy-loading the likely LCP image; reserve layout space, limit unnecessary scripts, choose font-loading behavior intentionally, and measure before using virtualization, workers or memoization. For public web pages, target good field Core Web Vitals at the 75th percentile: LCP ≤ 2.5s, INP ≤ 200ms and CLS ≤ 0.1 [12]. Lab measurements are useful proxies, not proof of field compliance. TTFB is diagnostic, not a Core Web Vital. Define budgets proportional to the project and record the test environment.

### 5.3 State management

**Source concepts (20):** Local vs global state; Context API; Redux Toolkit; Zustand; server state; TanStack Query; normalized state; derived state; immutability; optimistic updates; cache invalidation; form state; URL as state; state machines; signals; avoiding prop drilling; selectors; persisting state; sync across tabs; choosing a store.

**Application:** Keep state at the smallest appropriate owner; separate server, form, navigation and local UI state. Derive rather than duplicate values. Add a shared store or query library only when it removes actual complexity; do not install competing libraries without cause. Preserve authoritative server data, handle rollback, and avoid persisting secrets or unnecessary personal information.

### 5.4 Networking

**Source concepts (20):** REST vs GraphQL; HTTP caching; ETags; pagination; infinite scroll; polling; WebSockets; server-sent events; retries and backoff; request deduping; request cancellation; batching APIs; backend-for-frontend pattern; CORS; handling rate limits; offline queue; error handling; timeouts; API contracts; HTTP/2 and HTTP/3.

**Application:** Start with the existing API contract and simplest suitable transport. Handle errors, cancellation of obsolete requests, timeouts and rate limits; retry only safe or explicitly idempotent operations with bounded backoff. Respect authorization and CORS configuration. Introduce realtime transport, GraphQL, batching or a BFF only for demonstrated requirements. Avoid infinite scrolling when pagination improves navigation or accessibility.

### 5.5 Caching

**Source concepts (20):** Browser cache; service workers; Cache API; IndexedDB; localStorage; sessionStorage; stale while revalidate; CDN caching; cache busting; PWA basics; offline first; background sync; precaching; app shell; cache keys; versioned assets; storage quotas; data sync; conflict resolution; push notifications.

**Application:** Prefer standard HTTP caching for ordinary assets and explicit cache policies for dynamic/private data [13]. Use versioned immutable assets when appropriate. If offline operation is required, define what can be read or written offline, synchronization, deduplication, conflicts, quota failures and recovery before implementation. Avoid caching sensitive user data in shared caches; clear user-specific state as appropriate on logout. Service workers and PWA features are optional and introduce lifecycle obligations.

### 5.6 Architecture

**Source concepts (20):** Component design; design systems; atomic design; monorepos; micro-frontends; module federation; folder structure; feature modules; routing; plugin architecture; shared libraries; theming; feature flags; config-driven UI; separation of concerns; clean architecture; code ownership; dependency boundaries; scalability; documentation.

**Application:** Reuse the accepted stack and coherent primitives. Prefer simple feature modules, clear boundaries and discoverable structure; abstract after demonstrated repetition or a concrete boundary. A modular monolith or ordinary frontend is often sufficient. Do not mandate micro-frontends, module federation, monorepos, plugins, feature flags or atomic-design layers without evidence of need. Remove unused implementation and dependencies within approved scope.

### 5.7 Security

**Source concepts (20):** XSS; CSRF; Content Security Policy; CORS; clickjacking; secure cookies; token storage; OAuth with PKCE; JWT handling; input sanitization; dependency audits; Subresource Integrity; HTTPS everywhere; iframe sandboxing; Permissions Policy; no secrets in frontend; auth flows; session timeout; security headers; third-party scripts.

**Application:** Follow the project's threat model and OWASP guidance [14]. Enforce access control and input validation server-side. Use contextual output encoding and appropriate sanitization for untrusted rich content, secure session handling, applicable CSRF mitigations, restrictive security headers, and HTTPS in production. Never ship confidential credentials to the browser. Apply PKCE for applicable OAuth flows; validate tokens at the trusted boundary; avoid unsafe token persistence. Configure CORS precisely; it is not authorization. Review third-party scripts and dependencies; use SRI, sandboxing and Permissions Policy where applicable. Validate tenant boundaries and unauthorized requests, not just the happy path.

### 5.8 Accessibility and localization

**Source concepts (20):** Semantic HTML; ARIA roles; keyboard navigation; focus management; screen readers; color contrast; alt text; forms and labels; skip links; reduced motion; live regions; accessible modals; testing with axe; WCAG levels; internationalization; RTL support; date and number formats; pluralization; locale routing; translation workflow.

**Application:** Adopt WCAG 2.2 AA as the proposed web accessibility target [7]. Use native elements first and ARIA only where necessary; give every control a usable name, focus order and interaction behavior. Provide meaningful alt text, visible focus, accessible validation and modal focus management. For applicable WCAG contrast criteria, target 4.5:1 normal text, 3:1 large text and 3:1 relevant UI boundaries/graphics, accounting for exceptions. Test keyboard navigation and representative screen-reader flows; automated axe results are partial evidence. Add localization and RTL only when required, using locale-aware formatting and translation boundaries rather than speculative infrastructure.

### 5.9 Observability and verification

**Source concepts (20):** Error tracking; Sentry; frontend logging; RUM analytics; session replay; performance monitoring; product analytics; A/B testing; unit tests; component tests; E2E tests; Playwright; visual regression; contract tests; CI checks; canary releases; rollbacks; source maps; alerting; dashboards.

**Application:** Match testing to risk: use unit tests for logic, component tests for interactions when useful, E2E for critical user flows, and contract tests for important integration boundaries. Inspect actual browser output; Playwright can support repeatable screenshot comparison [15]. Track actionable errors without collecting secrets or unnecessary personal data. Session replay, analytics, A/B testing, canaries and monitoring vendors require actual need, privacy review and appropriate controls. Maintain rollback/recovery appropriate to the deployment; do not create dashboards or alerts nobody uses.

## 6. Priority and anti-overengineering rules

| Classification | Treatment |
|---|---|
| Mandatory quality baseline (proposed) | Honest content; working scoped interactions; responsive layout; accessible behavior; coherent visual tokens; appropriate security and performance; verified data and state; regression checks and rendered review. Apply relevant requirements to each project. |
| Preferred art direction | Swiss grid, strong type scale, negative space, realistic imagery and shadow, product-led composition, concentric corners, one memorable hero. Choose what fits. |
| Conditional techniques | Background textures, Liquid Glass, elaborate transitions, global stores, realtime networking, offline/PWA features, advanced rendering/caching, localization, analytics and distributed frontend architecture. Require a concrete use case and verification. |

Use the smallest dependency set and the simplest architecture that meets accepted requirements. Prefer existing accessible components over rebuilding them. Do not add design variants, decorative effects, compatibility layers, abstractions, infrastructure or tooling merely to appear sophisticated. Avoid forcing specific libraries, typefaces or brand treatments on every project. Record significant trade-offs briefly, not as a parallel governance system.

## 7. Practical implementation and acceptance checklist

Before implementing, resolve the audience, product purpose, core journeys, visual references, scope, exclusions, existing stack and acceptance criteria using the approved project brief and repository governance. Establish design tokens and a coherent direction before multiplying screens. Preview the current implementation on localhost when a runnable project exists. Keep the preview available during visual review, subject to project constraints; do not expose it publicly without authorization.

Use this checklist on the actual implementation, not just source code or a mockup. Record pass/fail/not applicable/not run and evidence for each relevant check.

- [ ] **Design:** Product-specific visual identity; clear hierarchy and focal point; no unexplained repetitive default patterns; meaningful typography and whitespace.
- [ ] **System consistency:** Tokens, component variants, iconography, radii, spacing, color and state treatments are coherent; justified exceptions are documented.
- [ ] **Content:** Copy is specific and truthful; no fabricated claims, unlabeled synthetic data or fake status; real destinations and actions work.
- [ ] **Responsive:** Review representative small, medium and wide viewports (e.g. 360/390, 768 and 1440 CSS px); no unintended overflow or hidden controls; applicable device/browser behavior works.
- [ ] **Interaction:** Primary user journeys work; relevant loading, empty, error, retry, success, disabled and permission states are present; data survives reload as required.
- [ ] **Accessibility:** Keyboard and visible focus, labels, contrast, target sizing, zoom/reflow, reduced motion and representative assistive-technology checks; record automated results and manual checks separately.
- [ ] **Performance:** Capture a representative baseline; inspect bundles and assets; measure applicable metrics and state whether lab or field; report deviations rather than claiming compliance from a single score.
- [ ] **Security and data:** Validate trust boundaries, applicable auth/authz, input handling, session management and cache behavior; check that sensitive data is not exposed; use safe synthetic test data.
- [ ] **Verification:** Run scoped regression tests and required CI/build/type/lint checks; review complete changes and desktop/mobile screenshots; do not claim an unrun check passed.
- [ ] **Simplicity:** No unnecessary libraries, duplicated architecture, speculative features or decorative complexity. Stop when accepted scope is complete.

A visual style issue may be accepted with a justified design decision. A functional, accessibility, security or data-integrity failure must be fixed or explicitly handled through the project's approved exception process before release, according to severity. The research itself does not authorize changes, deployments or new dependencies.

## 8. Local reference inventory

All files below were individually opened and visually inspected. Filenames identify the original source; no SVGs were opened for content.

| JPEG filename | Topic | Entries |
|---|---|---:|
| `7d143ab6-117c-40fe-9acf-c6e6e83a3dd5.jpg` | UI/UX craftsmanship | 20 |
| `a84a7560-4315-45d2-ad48-2f45cc2b2071.jpg` | Background treatments | 22 |
| `cd2a748b-6d83-4fd4-83c5-1a8174b5db99.jpg` | Rendering | 20 |
| `6b8aa806-b102-4e9e-bb48-c5d02bfcd756.jpg` | Performance | 20 |
| `cef81365-0446-48b1-9fa6-cef3e7c4c447.jpg` | State management | 20 |
| `40d21ce2-cd0c-46b3-b586-9811dc5974ad.jpg` | Networking | 20 |
| `b96233f8-0b65-437f-8e8b-db5cc72fc35c.jpg` | Caching | 20 |
| `a2f35e87-4df6-477f-b218-d746a3aa5598.jpg` | Architecture | 20 |
| `04920165-7958-428a-8d15-93d82e0a8d6c.jpg` | Security | 20 |
| `6980a836-7bd0-4d5f-acd5-2fa8cc09ec55.jpg` | Accessibility and localization | 20 |
| `5c92a6a1-b001-4f67-9848-25334edfec40.jpg` | Observability | 20 |
| **Total: 11 JPEGs** | | **222** |

The engineering images show a social-media educational series titled *System Design For Frontend Engineers*. The other two are cropped design-concept lists. Original posting dates and independent authorship of the cropped lists are unverified. The inventory preserves the listed terms; recommendations and classification are the research synthesis.

## 9. Public references

Public references checked on 2026-11-25. Normative requirements, platform guidance, research evidence and practitioner advice have different authority; use the appropriate source for the decision.

1. [Interrogating Design Homogenization in Web Vibe Coding](https://www.microsoft.com/en-us/research/publication/interrogating-design-homogenization-in-web-vibe-coding/) (March 2026); [preprint](https://arxiv.org/abs/2603.13036). Research on convergence and design agency, not a diagnostic checklist.
2. [Design Behaviour and Interface Consistency in Generative No-Code Tools: A Systematic Literature Review](https://www.mdpi.com/2073-431X/15/4/238) (April 2026). Research synthesis and evaluation gaps.
3. [Anthropic — Improving frontend design through Skills](https://claude.com/resources/articles/improving-frontend-design-through-skills). Vendor guidance on model aesthetic defaults and design direction.
4. [Apple HIG — Layout](https://developer.apple.com/design/human-interface-guidelines/layout). Native platform layout principles.
5. [Apple HIG — Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility). Native control sizes and inclusive interaction.
6. [Apple HIG — Materials](https://developer.apple.com/design/human-interface-guidelines/materials). Material layering, legibility and Liquid Glass.
7. [W3C — WCAG 2.2](https://www.w3.org/TR/WCAG22/). Web accessibility criteria, including target sizes and contrast.
8. [MDN — CSS env()](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/env). Safe-area and environment variables.
9. [MDN — OKLCH](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/oklch). CSS color function.
10. [W3C WAI — ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/patterns/); [Combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/). Accessible widget implementation guidance.
11. [MDN — prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion). Motion preference handling.
12. [web.dev — Web Vitals](https://web.dev/articles/vitals); [Threshold methodology](https://web.dev/articles/defining-core-web-vitals-thresholds). Performance metrics and interpretation.
13. [MDN — HTTP caching](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching); [Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control). Cache semantics and policy.
14. [OWASP — Cheat Sheet Series](https://cheatsheetseries.owasp.org/); [Web Frontend Security](https://cheatsheetseries.owasp.org/cheatsheets/Web_Frontend_Security_Cheat_Sheet.html); [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). Risk-based security practices.
15. [Playwright — Visual comparisons](https://playwright.dev/docs/test-snapshots). Screenshot regression tooling.

---

**Recommended use:** Keep this file as a research reference. Derive a short project-specific `DESIGN.md` or acceptance checklist from it only when the project requires one, rather than injecting the entire inventory into every agent prompt. Existing approved governance remains authoritative.
