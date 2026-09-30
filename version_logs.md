# PeriApicAI Version Logs

## Current Baseline

Application version: **2.9.1**.

PeriApicAI is an experimental research prototype for dental periapical radiograph analysis. It has not been clinically validated and is not a substitute for professional diagnosis, treatment planning, or clinical judgment.

The current architecture provides:

- Independent **Technical Quality** and **Pathology** workflows.
- 11 canonical Technical acquisition-error classes.
- 8 canonical Pathology classes.
- Compact six-field pre-analysis Validity gate.
- Single and Dual execution modes.
- Deterministic consensus and provenance tracking.
- Exact-ID role ladders with bounded failover.
- Isolated BYOK credential handling.
- Versioned human review and evaluation records.
- Immediate event-driven persistence of assessment state.
- Canonical `system_stats` aggregates for low-read Admin dashboards.
- Paginated `user_stats` for the Admin user directory.
- Filter-scoped full Admin exports independent of table pagination.
- Production client/server build separation.
- Server-side image validation, persistence DTO allowlisting, and signed lineage/validity attestations.
- Hardened Admin restore/delete flows, login lockout behavior, proxy trust parsing, generic error responses, CSP, and stack-trace redaction.
- Added focused security regression coverage and a Google AI Studio / Cloud Run release package with secret-safe metadata and environment template.
- Matched the v2 production embed policy with `frame-ancestors 'self' *` so AI Studio can iframe the published app; this broadens clickjacking exposure versus an exact-origin allowlist.
- Reduced deployment environment template to required server secrets plus optional Firestore credentials.

Current production prompt lineage labels remain:

- `technical-quality-prompt-v1`
- `pathology-segmentation-prompt-v2`

---

## v2.9.1 — Security hardening and Google AI Studio release packaging (September 2026)

This release updates the v2.9.0 deployment baseline with security hardening, focused regression coverage, and a reproducible package for Google AI Studio Build mode and Cloud Run.

### Changes from v2.9.0

- Hardened Admin backup restore: validate the complete payload before writing, cap restored collections, allowlist public persistence fields, and exclude server-owned review/sync state.
- Removed the rate-limit validation bypass and made `TRUST_PROXY` explicit and bounded.
- Replaced client-facing raw error details with generic responses while preserving server logs for diagnosis.
- Removed `unsafe-eval` and `unsafe-inline` from the CSP `script-src`; retained inline styles required by the current React UI.
- Redacted stack traces and sensitive error details from automatic bug logs and legacy persistence reads.
- Added regression tests covering lockout, restore payloads, destructive-action authorization, image validation, error sanitization, CSP, and proxy configuration.



This is the current release baseline. Firebase Admin remains optional for local operation but is recommended for durable shared Cloud Run persistence.

---

## v2.9.0 — Deployment stabilization, Admin statistics, export, and production cleanup (September 2026)

### Production packaging

- Finalized production separation between frontend assets and backend runtime:
  - frontend output: `dist/client`
  - backend artifact: `dist/server.cjs`
- Vite is loaded only for development and is not required by the production server runtime.
- Production static serving is restricted to client assets and does not expose the backend bundle as a public static file.
- Runtime port configuration supports deployment environments while retaining a local fallback.
- Clean install, clean production build, production dependency runtime, server startup, health check, and static SPA serving were verified.

### Admin statistics architecture

- Replaced the previous split aggregate approach with canonical `system_stats` materialized views.
- Statistics are organized conceptually as:
  - `all_time`
  - `monthly_YYYY-MM`
  - `daily_YYYY-MM-DD`
- Individual assessment, Pathology, and bug records remain authoritative.
- Live aggregate updates use idempotent previous-state-to-next-state contribution replacement.
- Assessment statistics remain associated with the original session-start date bucket even if the assessment completes later.
- Normal Admin Overview reads aggregate statistics rather than scanning historical raw logs.
- Firestore realtime listeners and continuous Admin polling are not required for dashboard statistics.
- Legacy `system_metadata` and `system_metrics` have no active runtime readers or writers.

### User statistics

- User/device summary counters are materialized into `system_stats`.
- Detailed per-user information is stored separately in `user_stats`.
- Admin Overview reads compact user counters without scanning the user directory.
- The User Directory is loaded only when requested and uses paginated access.
- Unique and active-user counters are maintained independently from session count.

### Admin export

- Admin export was decoupled from the bounded table dataset.
- Tables may remain limited/paginated for routine use, while explicit export retrieves the complete dataset matching the current Admin filter.
- Dedicated server-side export supports:
  - Reports from `reports`
  - Pathology records from `seg_reports`
  - Bug records from `bugs`
- Full export uses bounded cursor pagination internally and is not limited by the 50/100-row frontend display size.
- Date and status/source filters are applied according to the active Admin selection.
- Export remains Admin-authenticated and server-side.

### Disclaimer behavior

- The experimental-use disclaimer is shown on every fresh application load.
- Acknowledgement closes the modal only for the current mounted application instance.
- Disclaimer acknowledgement is no longer persisted in local storage, session storage, cookies, or backend storage.
- The modal cannot be bypassed through an X button, backdrop click, or Escape key.

### Repository cleanup

- Temporary migration, repair, trace, lint-fix, and one-off Node scripts created during stabilization were removed.
- Obsolete disclaimer persistence code was removed.
- Legacy aggregate runtime dependencies were removed.
- Canonical build artifacts remain generated through the normal production build.
- Repository secret/configuration hygiene and package-lock consistency were rechecked.

### Deployment status

**v2.9.0 was the deployment-ready application baseline before the v2.9.1 security release.**

The deployment-readiness pass completed with:

- clean dependency install
- type checking
- focused regression tests
- full offline tests
- production build
- production startup
- health endpoint verification
- frontend static-serving verification

No live Gemini inference is required for the offline deployment-validation gate.

---

## v2.9.0-rc.1 — Deployment preflight (September 2026)

This release candidate prepared the application for the final v2.9.0 stabilization.

- Decoupled Vite from the production server runtime.
- Separated frontend output into `dist/client`.
- Built the server separately as `dist/server.cjs`.
- Removed production server source maps from the intended deployment artifact.
- Added runtime port binding suitable for containerized deployment.
- Preserved model-control runtime state while keeping transient local data outside deployment staging.

This release candidate is historical. It was superseded by **v2.9.0**.

---

# Recovered Application History

The milestones below preserve application versions and approximate month/year labels recorded in the archived project history.

They are historical documentation, not independently verified release tags and not evidence of clinical validation.

The project started in early August 2026; the earliest recoverable documented milestone is **v1.0.0, early August 2026**. Gaps between recorded application versions are intentionally left unfilled.

---

## v1.0.0 — Technical assessment and image viewer (early August 2026)

- Initial documented application focused on Technical Quality assessment.
- Historical documentation described 12 positioning/exposure-error categories, including cone-cut, elongation, foreshortening, overlap, motion blur, and exposure faults.
- Interactive radiograph viewer supported zoom, pan, brightness, contrast, and inversion.
- Basic JSON output and local session state supported the early workflow.

The historical 12-category description is preserved only as history. Current Technical analysis uses **11 canonical acquisition classes**, while input validity is handled separately.

---

## v1.5.0 — CAD metrics and bilingual presentation (early August 2026)

- Historical documentation introduced four automated measurement concepts:
  - periapical bone-gap measurement
  - occlusal-plane tilt angle
  - crown-to-root ratio
  - proximal-overlap percentage
- Vietnamese and English localization expanded across findings, recommendations, Technical dictionaries, and Admin interfaces.

These historical quantitative concepts do not establish calibrated measurement accuracy or current validated capabilities.

---

## v2.0.0 — Pathology spatial grounding (early August 2026)

- Added a Pathology-oriented workflow with normalized polygon coordinates on a 0–1000 scale.
- Historical Pathology taxonomy included eight broader categories involving radiolucency, bone loss, restorations, endodontics, caries, eruption status, prosthetics, and calculus.

The historical taxonomy was later superseded.

Current canonical Pathology classes are:

1. `periapical_radiolucency`
2. `alveolar_bone_loss`
3. `enamel_radiolucency`
4. `dentin_radiolucency`
5. `crown_restoration`
6. `filling_restoration`
7. `root_canal_filling`
8. `dental_implant`

Historical labels must not be interpreted as the current schema or as confirmed diagnoses.

---

## v2.2.0 — Streaming, cloud persistence, and BYOK (early August 2026)

- Introduced server-sent streaming for longer-running Gemini operations.
- Added Firebase Firestore persistence for reports, audit information, and Pathology verification state.
- Added retry/fallback handling for provider failures and malformed responses.
- Added user-supplied Gemini credentials through BYOK.

Later hardening refined streaming cancellation, retry classification, and credential isolation.

Current BYOK requests remain isolated from SYSTEM credentials and never silently fall back to application credentials.

---

## v2.5.0 — Concurrent workflows, consensus, and editable polygons (August 2026)

- Historical `both` mode dispatched Technical and Pathology workflows concurrently.
- Model consensus and failover behavior expanded.
- Editable SVG pathology polygons used normalized image coordinates.
- Large-image handling gained background processing and progressive resizing.
- Workflow-specific presentation, review interfaces, exports, bug reporting, and Firestore synchronization expanded.

The cross-workflow `both` mode was removed in v2.6.0.

Historical alias-based model selection was later superseded by exact-ID model-control planning.

---

## v2.6.0 — Independent workflows and Admin consolidation (August 2026)

- Technical Quality and Pathology became explicitly independent workflows.
- The combined `both` dispatcher was removed.
- Admin gained revised tabs, responsive metrics, date filters, review dialogs, batch deletion, and shared retrieval components.
- Login verification and cache resets reduced stale Admin presentation.
- Shared pagination and synchronization helpers reduced duplication.
- Project-level README and version history were separated.

The realtime-listener design documented during this period was later reduced to control Firestore read volume.

---

## v2.7.0 — Firestore read control and frontend performance (August 2026)

- Disabled or removed unnecessary realtime listeners and duplicate Pathology watchers.
- Reduced repeated synchronization reads.
- Introduced more on-demand data access.
- Pre-aggregated dashboard metadata and bounded/paginated Admin queries replaced repeated broad collection scans.
- Store cleanup and component memoization reduced redundant frontend work.

The current architecture continues this direction through canonical `system_stats`, on-demand Admin reads, bounded detail queries, and disabled Pathology realtime snapshot listening.

---

## v2.8.0 — Shared image preparation and recovery-focused UX (August 2026)

- Shared prepared image bytes, MIME type, and dimensions across workflows.
- Improved separation of BYOK credential failures from transient provider failures.
- Added bounded offline recovery queues for both workflows.
- Improved completion/navigation persistence and captured session context.
- Added workflow-aware lazy loading and bounded image-blob caching.
- Improved request-size handling and structured payload errors.

Later audits found lifecycle, persistence, consent/reset, and queue-acknowledgement edge cases; these were subsequently repaired without abandoning background persistence or offline recovery.

---

## v2.8.9 — Canonical validation, provenance, and execution limits (August 2026)

- Standardized canonical finding keys, numeric confidence, and usable polygon geometry.
- Added explicit execution limits and cancellation behavior.
- Preserved finding provenance across consensus and Single execution.
- Hardened signed preview/image handling.
- Improved timing telemetry and result-integrity checks.

The archived label “Current Production Release” is historical only.

v2.8.9 was later superseded by the v2.9.0 release line. Historical static model selectors, alias behavior, URL lifetimes, and old attempt limits do not define current execution.

---

# Engineering Remediation History

The sections below summarize major internal engineering phases that occurred after the documented application-version milestones.

These `R` identifiers are engineering/remediation checkpoints, not application release versions.

---

## Pre-R16 — Validity, geometry, and result integrity

- Established a pre-analysis Validity gate separate from the Technical taxonomy.
- Reconciled Technical Quality to 11 canonical acquisition classes.
- Distinguished image coordinates from display coordinates for polygon handling.
- Preserved semantic findings when polygon geometry was unavailable.
- Improved confidence handling, including preservation of true zero confidence.
- Added stronger stale-request, retry, persistence, and review-integrity analysis.

Later R35.3 compacted Validity to the current six-field contract by removing generated reason prose.

---

## R16–R24 — Trust boundaries, storage isolation, and lifecycle reliability

- Added credential redaction and stricter public persistence DTO boundaries.
- Strengthened test-storage isolation.
- Improved idempotent local/remote persistence.
- Added serialized disk-write ownership and retry behavior.
- Hardened credential-mode handling.
- Improved Validity ownership, stale-response protection, async upload ownership, and SSE lifecycle handling.

Test isolation and preservation of production runtime state became explicit invariants.

---

## R25–R30 — Provenance, review, and evaluation foundations

- Preserved Technical result provenance.
- Added stable Pathology lesion identities.
- Added versioned review/evaluation structures.
- Kept original AI output separate from later human review truth.
- Added reviewed-positive, reviewed-negative, unreviewed, incomplete, and invalid evaluation states.
- Preserved zero confidence as a valid present prediction.
- Added server-derived inference lineage.
- Added signed image/configuration-bound Validity evidence.
- Defined pilot-oriented review, grouping, adjudication, and inclusion concepts.

Training-data generation and lesion-level localization benchmarking remained deferred.

---

## R31–R34 — Execution reliability and model-control evolution

- Hardened Admin loading and inference execution.
- Separated model discovery, policy eligibility, operational availability, and workflow compatibility.
- Developed exact-ID model selection and frozen assessment execution concepts.
- Preserved historical cohort/matrix records for diagnostics.

Discovery success, provider quota/access failures, transient availability, and schema incompatibility remain distinct concepts.

---

## R35 — Ordered role ladders and frozen assessment execution

- Replaced historical score/promotion production selection with deterministic exact-ID role ladders.
- Frozen per-assessment snapshots preserve role assignment, fallback order, and credential affinity.
- Runtime operational availability determines which eligible candidate executes.
- Normal model selection became Automatic-only.
- BYOK continues through the frozen model ladder using the same custom credential.
- Credential-wide authentication failures stop rather than switching to SYSTEM credentials.
- Validity was compacted to six fields.
- Single execution avoids Branch B while Dual execution preserves independent branches.

Historical model-control experiments remain diagnostics only.

---

## R36–R37 — Pre-pilot blocker remediation

R36 identified six priority issues; R37 applied bounded fixes:

- Authenticated legacy Pathology deletion was closed.
- Normal model UI became Automatic-only.
- BYOK access errors use same-key ladder fallthrough where appropriate.
- Local cache writes gained atomic replacement and serialized ownership.
- Consent is captured before completion-flow reset.
- Offline queues acknowledge only successful unchanged entries.

Historical accepted validation for this phase recorded **613 passed, 0 failed, 0 skipped**, with lint/build passing under the guarded test environment.

This count belongs to the R37 checkpoint and should not be interpreted as the current test-suite size.

---

## R38 — Optimization review

A read-only optimization review found no sufficiently high-value, low-risk reason to remove core safety and evidence structures before pilot work.

The review retained:

- distinct model controls
- Validity evidence
- lineage
- frozen snapshots
- boundary validation
- Dual evidence
- deterministic consensus
- geometry-independent semantic findings
- image fidelity
- persistence recovery

Potential low-level optimization remained benchmark-gated.

---

## R39 — Prompt investigation

R39A produced experimental **Technical V2** and **Pathology V2** prompt candidates.

R39B and R39B.1 were inconclusive because of provider instability, incomplete repetitions, and insufficient labeled evidence.

**Neither candidate was adopted.**

Current production prompts remained unchanged, and no V3 prompt was created.

No diagnostic-superiority, calibration, or localization claim follows from the limited comparison.

---

## R40–R40C — Documentation and deployment consolidation

- Inventoried source, historical evidence, scratch output, and deployment artifacts.
- Retained `README.md` and `version_logs.md` as the canonical project-level documentation.
- Moved useful historical evidence outside the active source workspace.
- Simplified the public README.
- Restored the documented application-version history.
- Separated production client and server artifacts.
- Removed Vite as a production runtime dependency.
- Corrected production static-serving boundaries.
- Added deployment-compatible runtime port behavior.

The deployment issues originally identified during R40B were subsequently resolved during the v2.9.0 release work.

R40/R40C descriptions are historical engineering context and no longer represent outstanding deployment blockers.

---

## Current Status

**Current application version: 2.9.1**

PeriApicAI is:

- an experimental research prototype
- not clinically validated
- bilingual in English and Vietnamese
- deployable using the current production build
- based on independent Technical and Pathology workflows
- using immediate authoritative logging with canonical derived Admin statistics
- using bounded/on-demand Admin data access
- capable of full filter-scoped Admin export independent of table pagination

Future changes should update this history only when they represent a meaningful application release or engineering milestone. Historical entries should not be rewritten to make them appear as current behavior.
