# 📜 PeriApicaI — Version History & Changelog

Documenting the evolution and release history of the **PeriApicaI** Next-Gen Multimodal AI Imaging Platform for Dental Radiology.

---

## 🚀 Version 2.8.0 (Current Stable Release — August 2026)

### 🌟 Major Highlights, Unified AI Pipeline & Operational UX Hardening
- **P0: Elimination of Redundant Image Re-Compression (Single-Pass Preparation)**:
  - **Zero Re-Encode Overhead**: Updated `prepareAnalysisImage` in `imageCompressor.ts` to inspect incoming data URLs and immediately reuse already compressed images (`compressedImageBase64`) alongside `lastCompressionMetrics` (0ms re-compression latency).
  - **Dimension Extraction Without Re-Drawing**: Added `getImageDimensionsFromDataUrl` to safely decode image bounds without canvas repaints or quality degradation.
  - **Pipeline Parity**: Guaranteed identical, uncorrupted prepared image inputs (1200px / 0.88 quality), real MIME preservation, and exact dimension mapping across Classic and Pathology AI flows.
- **P0: Accurate BYOK Error Classification (No False Positives)**:
  - **Eliminated Faulty Key Inference**: Fixed false-positive `CUSTOM_KEY_FAILED` tagging in `assessmentRoutes.ts` and `geminiPathologyService.ts` that previously treated any request carrying a custom API key as an invalid key error.
  - **Transient vs. Auth Classification**: Network timeouts, socket resets, or 5xx server issues with custom keys are now correctly classified as `TRANSIENT` (`isQuotaExhausted: false`), allowing single-shot client retry to function properly.
  - **Strict Auth & Quota Guard**: `CUSTOM_KEY_FAILED` is now strictly reserved for authenticated invalid key errors or verified BYOK quota exhaustion.
- **P0: Dual-Queue Offline Resiliency & Reconnect Flush**:
  - **Universal Offline Flush**: In `App.tsx`, both Classic (`flushPendingLogs`) and Pathology (`flushPendingPathologyLogs`) queues are automatically triggered non-blockingly on app mount.
  - **Online Event Listener**: Added `window.online` listener with cleanup on unmount to re-sync queued logs as soon as network connectivity is restored.
- **P1: Fully Non-Blocking Step 4 & Step 5 Transitions (Zero-Latency UI Reset)**:
  - **Instant Navigation**: Transitioning from Step 4 to Step 5 (`handleProceedFromAnalysisPathology`) and finishing Step 5 session reset (`completeValidationAndSave`, `completePathologySessionAndSave`) now switch UI steps immediately without blocking on 8-second network timeouts.
  - **Safe Background Dispatch**: Session snapshots are captured synchronously prior to state reset, and log persistence requests execute in the background with explicit `.catch()` handlers, seamlessly fallback-queuing on failures.
  - **Consent Guard**: Ensured radiograph image payloads are never dispatched in log updates unless `shareConsent === true`.
- **Unified AI Image Preparation & Dispatch Architecture**:
  - **Unified Client Retry Budget**: Streamlined client dispatch logic across Classic Quality and Pathology Segmentation, cutting retry loops to a single transient network retry while instantly failing fast on invalid API keys, authentication errors, or quota exhaustion (HTTP 429).
  - **Standardized SSE Streaming**: Normalized real-time progress events, status messages, and AbortController signal handling across both diagnostic pipelines.
- **Resilient Bounded Offline Log Queue**:
  - **Strict Queue & Payload Caps**: Configured `MAX_QUEUE_ITEMS = 25`, `MAX_QUEUE_TOTAL_BYTES = 500KB`, and `MAX_OFFLINE_IMAGE_BYTES = 80KB`. Automatically strips bulky base64 images before dropping metadata items.
  - **Controlled Concurrency Flush**: Flushes pending offline logs in small sequential batches (concurrency $\le 2$) with automatic back-off and pause when encountering server rate limits (429).
  - **Storage Quota & Privacy Protection**: Wrapped all localStorage interactions in try/catch blocks to ensure flawless operation in Private Browsing / full-storage environments without logging API keys or PHI.
- **Flow-Aware Predictive Prefetching**:
  - **Dynamic Mode-Based Prefetching**: Tracked prefetched modules via a Set. Step 2 prefetching strictly adapts to `appEngineMode` (Classic loads `AIAnalysisScreen` & `ValidationScreen`; Pathology loads `PathologyAnalysisScreen` & `TreatmentRecommendationScreen`).
  - **Admin Lazy Loading Guarantee**: Prevented heavy `AdminPortalModal` chunks from being prefetched prematurely at Step 2. Dynamically fetches new flow modules if the user switches mode during setup.
- **Bounded In-Memory Image Blob Cache**:
  - **Memory & Byte Capacity Control**: Added `MAX_CACHE_BYTES = 25MB`, `MAX_CACHE_ENTRIES = 50`, and calculated `estimatedBytes` per entry with LRU eviction and automatic `URL.revokeObjectURL()` release.
  - **Session-Optimized TTL**: Reduced in-memory cache TTL from 24 hours to 2 hours, preventing stale memory accumulation during long browser sessions.
- **Express Payload Hardening & Clear JSON Errors**:
  - Adjusted Express body parsers to a hardened **3MB** limit, matching the standardized client compression standard.
  - Added dedicated API error handling middleware that returns clean JSON responses with HTTP 413 (`PAYLOAD_TOO_LARGE`) instead of generic HTML error pages.
- **Admin Session Storage Protection & Diagnostics**:
  - Safeguarded `sessionStorage` in Admin view (`useAdminData.ts`) with a 50-item cap and automatic base64 stripping to prevent browser storage quota crashes.
  - Introduced lightweight queue and cache diagnostics (`getOfflineQueueDiagnostics`, `getDiagnostics`).

---

## ⚡ Version 2.7.0 (August 2026)

### 🌟 Major Highlights, Read Quota Fixes & Performance Optimization
- **Elimination of Firestore Background Read Flooding (Read Quota Protection)**:
  - **Deactivated Background Realtime Listeners**: Removed 24/7 background `onSnapshot` listeners on server startup (`reports`, `seg_reports`, `bugs`) that previously caused high read spikes (800+ reads per container restart/network reconnect).
  - **Removed Duplicate Pathology Watchers**: Eliminated redundant parallel listeners on `seg_reports` across `storageAdapter.ts` and `firestorePathologyService.ts`.
  - **Auto-Sync Polling Interval Optimization**: Replaced aggressive 15-second background synchronization polling (`syncJob.ts`) with a conservative 30-minute interval and on-demand synchronization.
  - **Single-Read Pre-Aggregated Dashboard Architecture**: Switched Admin Analytics and Report stats to read directly from the unified atomic `system_metadata/dashboard` document (1 Read operation instead of scanning hundreds of records).
  - **Query Pagination Limits & Bounds**: Enforced strict `limit(200)` and on-demand pagination across administrative queries to eliminate unbounded collection reads.
- **Frontend & State Store Streamlining**:
  - Audited global state in Zustand store, pruned redundant state setters, and eliminated unused variables across assessment screens and admin panels.
  - Memoized high-frequency components (`Header`, `StickyBottomNav`, `PerformanceTelemetry`) to minimize unnecessary rendering cycles.

---

## ⚡ Version 2.6.0 (August 2026)

### 🌟 Major Highlights & Architecture Upgrades
- **Dual Independent Pipeline Architecture (Pipeline A & Pipeline B)**:
  - Streamlined `analyzeRadiograph` in `src/services/aiService.ts` to strictly dispatch between **Pipeline A** (Technical Quality Assessment - ADA/EADMFR) and **Pipeline B** (Pathology 2D Segmentation & Spatial Grounding), purging redundant `both` mode dead code.
- **Admin Portal UI Redesign & Telemetry Interface**:
  - Overhauled Admin Portal interface (`AdminPortalModal.tsx`) with modern metallic charcoal/deep slate styling, streamlined tab navigation (Audit Logs, System Health, Data Cleanup, Telemetry), responsive metric cards, date-range filters, and interactive review modals.
- **Admin Data Retrieval & Synchronization Engine**:
  - Refactored server-side Admin data retrieval pipelines (`/api/admin/*`, `storageAdapter.ts`, `systemMetadataService.ts`) to fetch live metrics directly from storage adapters, execute batch deletions, support real-time Firestore listeners (`initFirestoreRealtimeListeners`), and aggregate daily snapshot metadata efficiently.
- **Admin Login Stale Data Flash Elimination**:
  - Fixed a UI flash bug in `AdminPortalModal.tsx` where old cached logs or stale system metadata were briefly displayed upon admin login before fresh data finished loading. Enabled synchronous skeleton verification state (`isVerifyingToken`) and proactive cache resets on login/logout.
- **JSON Schema Optimization & Token Efficiency**:
  - Streamlined `DENTAL_ANALYSIS_SCHEMA` and `PATHOLOGY_SEGMENT_SCHEMA` field descriptions to minimize token overhead, enhance inference response speed, and strictly enforce Gemini Vision structured output compliance.
- **End-to-End Logic & Middleware Audit Fixes**:
  - Refactored `isValidBase64Image` in `src/server/middleware/validation.ts` to replace fragile regex data URI parsing with robust `;base64,` splitting, supporting all image formats (JPEG, PNG, SVG, WEBP) and URL-safe base64 strings.
  - Adjusted Express security headers in `server.ts` to allow embedding in iframe previews (`frame-ancestors 'self' *`) while maintaining security posture.
- **Deep Codebase Optimization & Dead Code Pruning**:
  - Audited the entire codebase to purge unused imports (`SystemMetrics`, `ExternalLink`, `AlertCircle`, `X`, `compressImage`, `TaxonomyErrorItem`, `crypto`), duplicate type declarations (`PathologySegmentResult`), and obsolete helper routines (`getUserRole`, `setUserRole`, `getRoleLabel`).
- **DRY Refactoring & Code Duplication Purge**:
  - Backend: Extracted redundant real-time snapshot delta synchronization logic for `reports`, `seg_reports`, and `bugs` into a single reusable generic helper `setupCollectionStreamListener` in `src/server/services/storageAdapter.ts`.
  - Frontend: Centralized repetitive pagination calculation states and rendering structures across `ReportsTab`, `PathologyLogsPanel`, and `BugsTab` using a reusable `usePagination` hook and an elegant, ellipsis-supporting `<PaginationControls />` UI component.
- **Script Directory Restructuring**:
  - Cleaned up obsolete diagnostic scripts (`scripts/diagnoseDrift.ts`) and removed unneeded package commands to streamline container runtime dependencies.
- **Tidied Project Documentation & Logs**:
  - Separated historical changelogs into a dedicated `version_logs.md` file while refining `README.md` to focus purely on product overview, system architecture (`Mermaid`), and key capabilities.

---

## ⚡ Version 2.5.0 (August 2026)

### 🌟 Major Highlights & Architecture Upgrades
- **Dual-Pipeline Concurrent Execution (`both` mode)**:
  - Unified `analyzeRadiograph` pipeline executing **Pipeline A** (Technical Quality Assessment) and **Pipeline B** (Pathology 2D Segmentation) concurrently via `Promise.all` to minimize diagnostic latency.
- **Dual-Model Consensus & Automatic Failover Engine**:
  - Concurrent inference using `gemini-flash-latest`, `gemini-pro-latest`, and `gemini-flash-lite-latest` with automatic retry and quota-exhaustion fallback loops.
- **Interactive Vertex Polygon Canvas**:
  - Custom React SVG render engine converting normalized $[0, 1000]$ spatial grounding coordinates into smooth, editable pathology contours with drag-and-drop anchor vertices for clinician verification.
- **Web Worker OffscreenCanvas Image Optimization**:
  - Background thread-offloaded 4K/8K X-ray image decoding and multi-stage step-down resizing (50% scale decrements) to preserve tiny dental radiologic details while keeping payloads under 1MB.
- **4-Domain Adaptive Color Architecture**:
  - **Obsidian Platinum (`slate-900`/`slate-100`)**: Header & Global Navigation.
  - **Royal Blue (`blue-600`)**: Pipeline A — Technical Exposure & Alignment Assessment.
  - **Deep Ocean Teal (`teal-600`)**: Pipeline B — Pathology Polygon Grounding & Recommendations.
  - **Metallic Charcoal & Deep Slate**: Admin Portal & System Telemetry.
- **Real-Time SSE Streaming**:
  - Server-Sent Events (SSE) streaming endpoint delivering zero-latency processing status and incremental diagnostic results.
- **Admin Audit Telemetry & Cloud Synchronization**:
  - Real-time snapshot listener integration with Firebase Firestore (`reports` and `path_reports` collections), live review modals, CSV/JSON report exports, and bug reporting webhooks.

---

## 🛠️ Version 2.2.0 — Real-Time Streaming & Cloud Telemetry (July 2026)

### 🚀 Enhancements
- **SSE Stream Pipeline**: Introduced backend streaming for Gemini Vision API responses to eliminate request timeouts on complex X-ray analyses.
- **Firestore Audit Persistence**: Integrated Firebase Firestore for long-term clinical report storage, audit logs, and pathology verification state tracking.
- **Auto-Retry & Fallback Handler**: Robust error interceptors handling rate-limits (HTTP 429), malformed JSON responses, and API key switches seamlessly.
- **BYOK (Bring Your Own Key) Support**: Added user-supplied custom Gemini API key configuration option with instant validation.

---

## 🔬 Version 2.0.0 — Pathology 2D Spatial Grounding (June 2026)

### 🚀 Enhancements
- **Pathology Segmentation Pipeline**: Added support for 8 anatomical and pathological dental lesion categories:
  1. Periapical Radiolucency / Cyst (*Thấu quang quanh chóp / Nang*)
  2. Bone Loss / Periodontal Defect (*Tiêu xương ổ / vách nha chu*)
  3. Existing Restoration (*Miếng trám răng / Hiện có*)
  4. Endodontic Canal Filling (*Chất trám bít ống tủy / Nội nha*)
  5. Caries / Dentin Involvement (*Sâu ngà răng / Tủy*)
  6. Impacted / Erupted Teeth (*Răng ngầm / Mọc lệch*)
  7. Crown / Fixed Prosthetics (*Chụp / Mão răng*)
  8. Calculus / Subgingival Deposit (*Vôi răng dưới nướu*)
- **Spatial Coordinate Normalization**: Implemented $[0, 1000]$ bounding polygon coordinate parsing from Gemini Vision structured outputs.

---

## 🌐 Version 1.5.0 — CAD Metrics & Internationalization (May 2026)

### 🚀 Enhancements
- **4 Automated CAD Quantitative Metrics**:
  - Periapical Bone Gap Measurement (mm)
  - Occlusal Plane Tilt Angle (°)
  - Crown-to-Root Ratio Calculation
  - Proximal Tooth Overlap Assessment (%)
- **Bilingual i18n Engine**:
  - Full Vietnamese (`VI`) and English (`EN`) localization across all diagnostic labels, clinical recommendation cards, technical failure dictionaries, and admin interfaces.

---

## 🏁 Version 1.0.0 — Initial Release (April 2026)

### 🚀 Enhancements
- **Core Technical Quality Assessment**:
  - Standardized evaluation of 12 dental radiograph positioning and exposure technical error categories (Cone-cut, Elongation, Foreshortening, Overlap, Motion Blur, Underexposure, Overexposure, etc.).
- **Base Web App & Viewer**:
  - Interactive X-ray viewer with zoom, pan, brightness, contrast, and inversion controls.
  - Basic JSON output generation and local session state.
