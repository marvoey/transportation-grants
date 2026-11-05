# NOFO MVP — Repository Audit and Implementation Plan

| | |
|---|---|
| **Status** | **Rev 6** — Milestone 5 (chat integration and browser demo) implemented, tested and exercised in a real browser against the live BUILD requirements; **awaiting your review. Not committed.** Milestones 1–4 are committed. Every result is **provisional**: no requirement has been human-verified, and the reference set behind M3's accuracy is still the assistant's draft. |
| **Written** | Rev 1 (Milestone 1 plan): 2026-11-04 · Rev 2: 2026-11-04 |
| **Branch** | `nofo`. Rev 1 audited `397cced`. Rev 2 reviewed at `583c2e3` (updated guide, `CLAUDE.md` and Rev 1 of this plan committed). |
| **Demo deadline** | 2026-11-13 (Fri) |
| **Source of truth** | `NOFO_MVP_CLAUDE_CODE_IMPLEMENTATION_GUIDE.md` (scope, exclusions, acceptance scenario). Where this plan and the guide differ, the guide wins. |

## Revision history

| Rev | What changed |
|---|---|
| 1 | Milestone 1 audit and plan: architecture, reuse, gaps, risks, M2–M5 with BUILD-specific document ingestion. |
| 2 | Updated guide (commit `583c2e3`) **supersedes the Rev 1 Milestone 2**. M2 is now a **generic opportunity acquisition and ingestion service keyed by Simpler.Grants.gov opportunity UUID**. FY2026 BUILD is a primary *test fixture*, never a hardcoded dependency, and a **second real opportunity must run through the same code**. |
| 2.1 | **Step 0 live API checks** done with the key you supplied (read-only, ~15 requests). **FY2026 BUILD is in Simpler.Grants.gov** (archived, retrievable by UUID) with **one** attachment, the NOFO PDF. Downloads are public, so no key is sent to the files host. A second-opportunity candidate is recommended. The authority classifier gains "Q&A" patterns. R1/R12/R13 and Q11/Q12/Q14 are updated. The key is stored only in your gitignored `.env`. See §3.11. |
| 3 | **Decisions recorded and Milestone 2 implemented.** Q12: Wildlife Crossings is the second integration test. Q14: no manual supplemental documents yet; M2 is automatic retrieval only, with supplemental sources *designed* and potential missing sources *recorded* (BUILD FAQs/checklists/amendments may be added in M3 if needed). Q13: commit small stable fixtures and manifests, never caches, credentials or oversized artifacts. Q15: `CLAUDE.md` updated. Authority classification now lets derivative documents (FAQ, Q&A, template, webinar, …) win over a "NOFO" mention in their name. See §5 "M2 implementation record" and §9. |
| 3.2 | **Word (.docx) adapter added** at your request (beyond the guide's "register, parse only if essential"). Uses `mammoth` 1.13.0, which you installed, to convert to HTML and then reuses the HTML section extraction. Wildlife Crossings now reaches coverage `api_listed_processed`. 179 tests pass, none skipped. See "Rev 3.2" in the M2 implementation record. |
| 4 | **Milestone 3 implemented.** Source-grounded requirements extraction with code-verified citations, a reference-set evaluation, and an optional multi-pass mode. Deviation from Rev 1: sampling parameters (temperature) cannot be sent to current models, so reproducibility comes from caching and the evaluation, not from temperature 0. See "M3 implementation record" in §5. |
| 5 | **Milestone 4 implemented.** Project facts read from the conversation and verified against the applicant's own words; deterministic checks for numbers; narrow model interpretation for free-text conditions; ranked follow-up questions; a code-written advisory. Simplification versus Rev 1: the advisory is written by code, not a model (no extra model call, nothing invented). See "M4 implementation record" in §5. |
| 6 | **Milestone 5 implemented.** An "Assess a project" mode on `chat.html` (select an ingested opportunity, describe a project, follow-up questions, findings, a source drawer, fact removal) backed by `/api/nofo/*` routes that only read the local packages. The existing chat is untouched. A real-browser run found and fixed one bug (deep-link preselection). See "M5 implementation record" in §5. |

**Sections revised in Rev 2:** §1, §2.1–§2.4, §3.1–§3.4, §3.8–§3.10, new §3.11 (verified API contract), §4, §5 (M2 rewritten, M3/M5 adjusted, calendar), §6, §7, §8, §9, §10.

**Preserved from Rev 1 without change:** milestone order and gates; offline-extraction / online-assessment split; citation verification (§3.5); deterministic-vs-LLM split (§3.6); question ranking (§3.7); stateless chat with client-held facts; no database, no sessions, no uploads; no new frontend framework; no multi-agent orchestration for NOFO mode; evidence/safety rules; M4 scope and acceptance; M3 scope (apart from consuming the generic package).

Milestone 1 and Rev 2 changed only `docs/`; Rev 3 adds the Milestone 2 code (listed in the M2 implementation record in §5). I ran read-only commands (file reads, `git`, `npx tsc --noEmit`, `npx vitest run`, `npm view`, `npm audit`, WebFetch, and `curl` against the public OpenAPI spec and `/health`). Rev 2 used **no API key**. Rev 2.1 added read-only calls to the Simpler API using the key you supplied, which is kept only in your gitignored `.env` and appears in no tracked file. I did not start the server, call the Anthropic API, or exercise the browser.

---

## 1. Executive summary

**The existing app is a good base.** It is a small, clean TypeScript/Express/MCP app (about 3,600 lines under `src/`) with three patterns we can reuse directly:

- **Route pattern:** Zod validation → `asyncHandler` → `successResponse`.
- **Structured LLM output:** a forced `tool_choice` call that returns schema-shaped JSON (`classifier-agent.ts`).
- **Stateless chat:** the browser holds the history and the server holds no sessions.

**What is missing is almost everything the NOFO workflow needs.** Today there is:

- no document ingestion and no PDF or HTML parsing library
- no Simpler.Grants.gov client (nothing in the repo references it)
- no durable artifact store (the cache is TTL-based and keyed by hash)
- no test files at all on this branch
- no concept of a "selected opportunity" or "project facts"

**Recommended approach.** The NOFO feature is a **sequential, mostly deterministic pipeline inside one new module (`src/nofo/`)**:

1. **Offline** (CLI, run per opportunity; outputs persisted as local JSON). *Acquire:* given a Simpler.Grants.gov UUID, fetch the opportunity and its attachments, and parse PDF and HTML into page-addressed JSON, registering other formats honestly. *Extract (M3):* extract requirements with the LLM and verify every citation by string-matching against the page text.
2. **At request time:** one new endpoint takes `{opportunityId, messages, facts}` and runs fact extraction (LLM) → deterministic checks → batched LLM interpretation of the rest → question ranking → advisory narrative. The server renders the citations from structured data, never from model prose. **Request-time code never calls Simpler.Grants.gov**; it reads ingested packages from disk.
3. **Frontend:** a mode on the existing `chat.html` plus one new JS file.

**What I would not build:** multi-agent orchestration for NOFO mode, a database, sessions, file uploads, an ingestion web route, a project-profile page, a new discovery UI, or merging the unmerged `project-discovery` branch. See §8.

**Highest risks (detail in §7):**

1. **BUILD's API package is only the NOFO PDF.** *(Rev 2.1: the API key now works and FY2026 BUILD is retrievable.)* Simpler lists no FAQs, checklists or amendments for it. The guide's "FAQ clarifies the NOFO" scenarios therefore need curated supplemental sources, and the agency site returned **403** to automation, so those would be manual downloads.
2. **Remaining unverified behavior.** 429/rate-limit behavior has not been triggered, and I have not yet parsed the real NOFO PDF, so PDF text quality is still unknown (§3.11).
3. **The gold set** (15–25 manually verified requirements) needs human time and is on the critical path.
4. **The schedule has no slack, and Rev 2 makes M2 larger:** 7 working days for 4 implementation milestones (§5).

---

## 2. Audit findings

### 2.1 Current architecture (verified by reading the code)

```
Browser (public/*.html + vanilla JS, no framework, no build step)
   │  chat.js keeps chatHistory[], POST /api/chat {messages}
   ▼
Express app  src/web/api-server.ts
   ├─ /api/grants, /api/eligibility, /api/deadlines   → routes → src/tools/*.ts
   ├─ /api/chat  (express-rate-limit, 10 req/min)      → routes/chat.ts
   │        classifyIntent (forced tool_choice) → runRetrieval (≤5 tool iterations,
   │        tools scoped per intent) → draftReply (tool-free)
   │        retrieval calls tools through an in-process MCP Client
   │        (src/mcp/client.ts, InMemoryTransport) → src/server.ts → executeTool()
   └─ /api/health, static files from /public

Same tools also exposed over stdio:  src/index.ts → src/server.ts (MCP server)
Data:  SAM.gov API | mock | local XML extract  (DATA_SOURCE)   Cache: .cache/*.json (TTL)
```

| Area | What exists | Where |
|---|---|---|
| Stack | TS 5.5 (ES2022, Node16 modules, strict), Express 4.22, Zod 3.25.76, Anthropic SDK 0.133.0, MCP SDK 1.32.2, Vitest 2.1.9 installed | `package.json`, `tsconfig.json` |
| Routes | One router per feature, mounted in `createApp()`. Standard envelope `{success, data, error, code, retryable}` and a central `errorHandler` that returns generic 500s. | `src/web/api-server.ts`, `src/web/middleware/error-handler.ts` |
| Validation | Zod schemas plus `validateParams()` returning `{success,data}\|{success,error}` | `src/utils/validators.ts` |
| Anthropic | Singleton client with an optional `ANTHROPIC_BASE_URL` gateway override. Model defaults to `claude-sonnet-5`, `maxTokens` to 1024, both env-configurable. | `src/clients/anthropic-client.ts`, `src/config/config.ts` |
| Structured output | Forced `tool_choice` with a handwritten JSON schema (the classifier). The SDK ships `helpers/zod` and `helpers/json-schema` (present on disk; not yet evaluated). | `src/web/chat/classifier-agent.ts` |
| MCP | 4 tools. Schemas are in `tool-schemas.ts` and dispatch is in `tool-executor.ts`, shared by the stdio server and the web chat. | `src/mcp/*`, `src/server.ts` |
| Chat | Stateless. The client sends the full history; the server runs classify → retrieve → draft. Reply shape `{reply, toolCalls}`. | `src/web/routes/chat.ts`, `src/web/chat/*` |
| HTTP clients | `axios` instances in the SAM.gov clients and the Grants.gov XML extractor. **No reference to Simpler.Grants.gov anywhere in `src/`, `doc/`, `public/` or `.env.example`.** | `src/clients/sam-*.ts`, `src/data/xml-extractor.ts` |
| Frontend | `chat.html` plus `chat.js` (81 lines). `common.js` has `escapeHtml`, `sanitizeUrl` and an allow-list `renderMarkdown` (h2/h3/p/br/strong/em/code/ul/ol/li/a; http(s) links only). | `public/` |
| Storage | `CacheManager` writes hashed-key JSON files with a TTL under `.cache/` (gitignored). The Grants.gov extract uses `data/`. | `src/cache/cache-manager.ts`, `src/data/xml-extractor.ts` |
| Tests | **None.** No `*.test.ts`, no `vitest.config.ts`. `npx vitest run` exits 1 with "No test files found". | — |
| Baseline | `npx tsc --noEmit` passes (exit 0). | — |

### 2.2 Reuse vs. new

| Need | Reuse | New (minimum) |
|---|---|---|
| HTTP surface | Router/envelope/`asyncHandler`/`errorHandler`; `chatRateLimiter` pattern | `routes/nofo.ts`, mount in `api-server.ts` (read-only endpoints, M5) |
| Simpler.Grants.gov access | Config/`getConfig()` pattern (lazy key check, like Anthropic); `GrantServerError` codes; Zod | `src/nofo/simpler/*`: a small client using **native `fetch`** (not axios; see §3.9 and §4), UUID validation, bounded retries |
| Structured LLM output | Forced-tool-choice pattern, `getAnthropicClient()`, `getConfig()` | One helper (`nofo/llm.ts`): call + Zod parse + one retry, with a per-call `max_tokens` override (the global default of 1024 is too small for extraction). Used from M3. |
| Validation | Zod, `validateParams` | `nofo/schemas.ts` |
| Frontend | `chat.html`, `chat.js`, `renderMarkdown`, `escapeHtml`, `sanitizeUrl`, `style.css` | Mode toggle in `chat.html`, a small hook in `chat.js`, new `nofo.js` |
| Persistence | Plain JSON files (matches the guide) | `data/opportunities/<uuid>/…` packages. **Not** the TTL `CacheManager`: acquired documents and extraction output must be durable and reviewable. |
| Document processing | — | A `DocumentProcessor` adapter contract; PDF and HTML adapters; an "unsupported format" registrar (§4) |
| Tests | Vitest is installed | `vitest.config.ts`, test setup, fixtures, injectable `fetch` |
| MCP | Shared schemas/executor | Nothing required for the MVP (optional stretch, §8) |

### 2.3 Gap analysis against the guide's target architecture

| Guide component | Current state | Plan |
|---|---|---|
| Opportunity Document Service (Simpler client, UUID resolver, acquisition, curated supplemental references, manifest/cache, normalized content, coverage reporting) | absent | `src/nofo/{simpler/*,acquire/*,ingest/*,store.ts}` (§3.3) |
| Requirements Intelligence Service | absent | `src/nofo/extraction/*`, `citations.ts` |
| Applicant Assessment Service | absent | `src/nofo/assessment/*` |
| Advisory Service | absent (the existing `drafting-agent` is search-oriented) | `src/nofo/advisory.ts` |
| Web integration in `chat.html` | chat exists; no opportunity selection or structured findings view | `chat.html`, `chat.js` hook, `nofo.js` |
| Tests / evaluation | none | Vitest unit tests plus a separate gold-set eval script |

### 2.4 Repository-state findings that affect the plan

These are verified facts, with how I checked them. **None have been changed.**

1. **`dist/` is stale and comes from another branch.** It contains compiled `projects/`, `web/discovery/`, `*.test.js`, etc. (from the unmerged `project-discovery` branch), none of which exist in the `nofo` source. `npm run start:web` runs `dist/web-index.js`, so **running it without `npm run build` first would run the other branch's code.** Mitigation: `rm -rf dist && npm run build` at the start of M2 (`dist/` is gitignored).
2. **`project-discovery` is a large, unmerged feature branch** (59 files, +9.4k/−0.7k lines). It adds a project-profile workspace, session cookies, a discovery agent, `project.html`, and 12 test files plus `vitest.config.ts`. It overlaps the guide's non-goals ("no project-profile interface"). **I recommend not merging it** (§8). It is a useful reference for test setup only.
3. **`.data/projects.json` is tracked on `nofo`** (commit `397cced`). It holds session and owner IDs from the discovery experiment. On `project-discovery`, `.gitignore` ignores `.data/`; on `nofo` it does not. It is unrelated to NOFO. Suggest untracking it (your call).
4. **`data/GrantsDBExtract20261007v2.zip` is not a zip.** The file starts with `<!DOCTYPE html>`, so it is a saved error page. `.env.example` defaults to `DATA_SOURCE=local`, so existing search may return nothing locally. I did not run it. This is not in the NOFO scope, but it could embarrass a demo if someone clicks Search.
5. **Logger and config coupling.** `logger.*` calls `getConfig()` on every call, and `loadConfig()` throws if `SAM_API_KEY` is unset. Any CLI or test that touches `logger` needs that env var. Tests need a setup file that sets a dummy value (`project-discovery` has `src/test-setup.ts` for the same reason). The ingestion CLI will run against the real `.env`.
6. **`public/js/common.js` contains 8 NUL bytes.** They are most likely the placeholder tokens in `renderInline`, and the file works. But the Edit/Write tooling refuses to modify it. **Plan: do not edit `common.js`**; new frontend code goes in a new file.
7. **Existing hardening gaps (pre-existing, not caused by this work):**
   - `ChatRequestSchema` has no max on message count or content length.
   - CORS falls back to `'*'` with `credentials:true` when `CORS_ORIGINS` is unset.
   - `logger.info` logs tool inputs.
   - `npm audit --omit=dev` reports high-severity advisories (`body-parser` DoS, `follow-redirects`, plus `fast-uri`), all marked fixable with `npm audit fix`. The `follow-redirects` advisory (GHSA-mrwp-f3q8-3g9p) concerns **credentials following redirects**, one reason the new Simpler client uses native `fetch` with manual redirect handling instead of `axios` (§3.9).
   - New NOFO code will not inherit these gaps (§3.9). Fixing the old ones is a separate decision for you.
8. **`CLAUDE.md` now exists** (committed in `583c2e3`). It was written before the Rev 2 guide: it still says "One selected funding opportunity (FY2026 BUILD)" and "curated package", and lists "Grant discovery or search as part of the NOFO workflow" as out of scope. Its own rule ("the guide wins") covers the difference, but it is stale. The branch is `nofo`, not `feature/nofo-advisor-mvp`.
9. **`doc/` vs `docs/`:** existing documentation is in `doc/`; NOFO documentation is in `docs/`.
10. **Model ID history:** `doc/plan_1.md` records an earlier invalid model ID that caused `INTERNAL_ERROR`. M3 starts with a one-call smoke test of the configured model, before any batch extraction.
11. **Node version.** The dev machine runs Node v24.11.1. The README says "Node 18+" and the Dockerfile example uses `node:18-alpine`. The newest PDF library line requires Node ≥ 22.13 (§4). Ingestion (including PDF parsing) is an offline CLI step, so the runtime server never imports the PDF library and is unaffected.
12. **Existing search results cannot supply Simpler UUIDs directly.** In `DATA_SOURCE=local` mode, a result's `id` is the Grants.gov XML `OpportunityID` (`xml-extractor.ts:126`), an integer-style legacy ID. In `api` mode it is a SAM.gov notice ID. Neither is a Simpler.Grants.gov UUID. Simpler's `opportunity_id` is separate from its `legacy_opportunity_id`, and the guide says never to equate them. So the guide's "search-result adapter" is **optional** and only possible for local-mode results through the legacy-ID lookup (§3.11). The required input path is **direct UUID**.

### 2.5 Guide-vs-repo discrepancies

- The guide says to run `npm test` as a baseline. Here that fails because there are no tests, and bare `vitest` starts watch mode. We will add a `test:run` script (`vitest run`).
- The guide's suggested `NofoRequirement` type is a good start but lacks fields needed for the guide's own scenarios: a verified-citation flag, program category (capital/planning), and a machine-checkable constraint. See §3.4.
- The guide's demo says "chosen capital-grant category". The applicability model must therefore carry the grant category and rural/urban status, or the BCA and match findings will be wrong. I have not seen the FY2026 NOFO, so I cannot say which thresholds differ by category. This must be confirmed once the documents are acquired.

---

## 3. Proposed architecture

### 3.1 Principles

1. **Two phases.** *Offline*: acquire an opportunity's documents by UUID, parse them, then (M3) extract and verify requirements; outputs are persisted JSON packages. *Online*: assess a project against those cached requirements. The NOFO is never re-fetched, re-parsed or re-extracted per request, the runtime server never imports the PDF library, and **request-time code never calls Simpler.Grants.gov**.
2. **The LLM proposes; code verifies.** Citations, arithmetic, document IDs, page numbers and numeric thresholds are checked in code. We never ask the model to grade itself.
3. **Server owns the evidence chain.** The model's prose may reference requirement IDs only. The server resolves them to verified quotes, page numbers and source links. A citation therefore cannot be invented in prose.
4. **Unknown ≠ fail.** Missing facts produce `unknown`, plus a ranked question.
5. **Stateless.** The browser holds the conversation and the current `ProjectFacts`; the server holds nothing between turns. No database, no sessions, no cookies.
6. **Single module, no new frameworks.** Everything lives in `src/nofo/`, with one route file and one frontend file.
7. **Generic by construction (Rev 2).** Nothing under `src/` may branch on a program name, fiscal year, opportunity number or UUID. BUILD appears only in test fixtures and live-test records. A guard test enforces this (§5, M2).
8. **Honest coverage (Rev 2).** Every document has its own retrieval and processing status. A package is **never** declared "complete": the best coverage level says only that every document Simpler.Grants.gov *listed* was processed (§3.2).

### 3.2 Data layout (persisted; no database)

```
data/opportunities/<opportunityUuid>/
  opportunity.json        # normalized metadata (Zod) + retrievedAt + sha256 of the API response
  manifest.json           # package manifest: coverage + documents[] (shape below)
  supplemental.json       # OPTIONAL hand-authored input: curated official sources + authority overrides
  supplemental/<file>     # OPTIONAL manually placed files referenced by supplemental.json
  documents/<documentId>/original.<ext>   # bytes as downloaded (name is server-generated)
  documents/<documentId>/normalized.json  # { documentId, processorId, processorVersion, pages|sections }
  requirements.json       # (M3)
  gold.json               # (M3) human-verified reference set
```

This replaces Rev 1's `data/nofo/fy2026-build/`. The folder name is the validated, lower-cased UUID. **No user input is ever joined into a path** except through the validated UUID and server-generated document IDs.

**Commit policy (Q13, decided).** `data/opportunities/` is a **git-ignored cache**: live ingestion works for any valid UUID and its output is not committed automatically. A package for an offline demo is committed **deliberately** with `git add -f data/opportunities/<uuid>`, only for selected demo documents and only when small and stable. Small stable fixtures live in tracked locations: `data/fixtures/` (the posted-DOT opportunity list) and `src/nofo/__fixtures__/` (trimmed real-shape API records plus synthetic helpers). Never commit downloaded caches, credentials, temporary files, oversized artifacts or unnecessary raw API responses. `.gitignore` also excludes `*.tmp`.

**Document manifest entry** (conceptual; Zod is the source of truth):

```ts
{
  documentId,                       // 'sg-<attachment uuid>' | 'sup-<slug>-<sha8>' ; ^[a-z0-9-]{1,80}$
  origin: 'simpler_attachment' | 'curated_supplemental',
  title, fileName /* display only, sanitized */,
  declaredMimeType, detectedType /* from magic bytes */, sizeBytes, sha256,
  sourceAttachmentId?, sourceUpdatedAt?,
  originalUrl /* query string stripped, see §3.9 */, urlKind: 'relative'|'absolute'|'presigned',
  retrievedAt, retrievalMethod: 'api_download' | 'curated_url' | 'manual_file',
  authority: 'controlling' | 'official_guidance' | 'metadata' | 'unclassified',
  authorityMethod: 'heuristic' | 'manual',
  retrieval:  { status: 'downloaded'|'cached'|'failed'|'skipped_too_large'|'skipped_unsafe'
                        |'manual_required'|'removed_upstream', error? },
  processing: { status: 'parsed'|'unsupported_format'|'parse_failed'|'empty_text'|'not_attempted',
                processorId?, processorVersion?, pages?, error? }
}
```

**Package-level coverage:**

| `coverage.status` | Meaning |
|---|---|
| `none` | No document was parsed (including zero attachments). Metadata is still preserved. |
| `partial` | At least one document parsed, but at least one listed document failed, is unsupported/unparsed, is scanned with no text, or **no `controlling` document was parsed**. |
| `api_listed_processed` | Every attachment Simpler.Grants.gov listed was parsed and at least one is `controlling`. Always accompanied by a `completenessNote`: *completeness against the full official package cannot be verified; supplemental sources are curated, not discovered.* |

There is deliberately no `complete` value. `coverage.reasons[]` lists each shortfall in plain language, so M5 can show it.

**Authority classification (deterministic, no LLM).** For Simpler attachments, case-insensitive patterns over `file_name` + `file_description`:

| Pattern (examples) | Authority |
|---|---|
| 1st: `FAQ`, `frequently asked`, `questions and answers`, `Q&A`, `checklist`, `instruction`, `guide`, `template`, `webinar`, `office hours`, `additional resources`. **Derivative documents win, even when the name also says NOFO** (for example "NOFO Questions and Answers"). | `official_guidance` |
| 2nd (only if none of the above matched): `NOFO`, `notice of funding`, `funding opportunity announcement`, `FOA`, `amendment`, `modification` | `controlling` (candidate) |
| no match | `unclassified` |

This is a triage aid, not a legal determination. `unclassified` documents are ingested but treated as non-controlling by M3/M4 and surfaced for review. A curator can override any document with `overrides: { "<documentId>": "controlling" }` in `supplemental.json` (`authorityMethod:'manual'`). Simpler's structured `summary` fields (award floor/ceiling, applicant types, fiscal year, dates) are kept in `opportunity.json` as `metadata`-authority facts, **never** as requirement sources.

**Curated supplemental sources (`supplemental.json`).** Hand-authored list of `{ title, url? | localFile?, authority, note }`. Only listed URLs are fetched (https only, same download safeguards, no crawling, no link following). `localFile` supports manual placement for sites that block automation (my fetch of the BUILD agency page returned **403**). Manual files get `retrievalMethod:'manual_file'` and a recorded sha256. A listed source that cannot be retrieved gets `retrieval.status:'manual_required'` rather than disappearing silently.

### 3.3 Module and file plan

**New files**

| File | Purpose |
|---|---|
| `src/nofo/schemas.ts` | Zod schemas and inferred types: Opportunity, ManifestDocument, OpportunityPackage, NormalizedDocument, Requirement, ProjectFacts, Finding, AssessResponse. Single source of truth. |
| `src/nofo/simpler/schemas.ts` | Zod for **only the fields we use** from Simpler responses (tolerant of extra fields, strict on required ones). |
| `src/nofo/simpler/client.ts` | `SimplerGrantsClient`: native `fetch` with injectable `fetchImpl`, `AbortSignal` timeouts, bounded retries with jittered backoff for 429/5xx/network only (honors `Retry-After`, capped), typed errors (`SimplerApiError{status,kind}`), key sent only to the configured API host. |
| `src/nofo/simpler/source.ts` | Implements `OpportunitySource`: `getOpportunity(id)`, `getAttachments(id)`; UUID validation; maps the API response to our normalized `Opportunity`. Optional (P2): `findOpportunities(query)` for the helper CLI and `resolveLegacyId(n)`. |
| `src/nofo/acquire/download.ts` | Bounded download: https only, manual redirects (≤3, host rules), `Content-Length` pre-check plus streaming byte cap, sha256, magic-byte type detection, server-generated storage name, per-document status. |
| `src/nofo/acquire/supplemental.ts` | Load/validate `supplemental.json`; fetch listed URLs or register manual files through the same download path. |
| `src/nofo/acquire/authority.ts` | Deterministic classifier plus manual overrides. |
| `src/nofo/ingest/processors/{pdf,html,unsupported}.ts` + `registry.ts` | `DocumentProcessor` adapters (contract below). PDF: page-by-page text (+ heading heuristics by font size), `pdfjs-dist` dynamic-imported, hardened options, time/page caps. HTML: section-aware text via `cheerio`, links and source URL preserved. `unsupported`: registers XLSX/DOCX/ZIP/GIS/other with `processing.status:'unsupported_format'`, never extracting or parsing. |
| `src/nofo/ingest/normalize.ts` | Whitespace/hyphenation/unicode/header-footer normalization, **shared with citation matching (M3)** so both sides use identical rules. |
| `src/nofo/ingest/ingest-opportunity.ts` | `ingestOpportunity(opportunityId, opts?)`: the stable entry point (§5, M2). |
| `src/nofo/ingest/cli.ts` | `npm run nofo:ingest -- <uuid> [--refresh]`. P2: `npm run nofo:find -- "<query>"` (prints UUID, number, title, status), `--legacy-id <n>`. |
| `src/nofo/store.ts` | Package read/write. **Allow-lists IDs**; atomic writes (temp file + rename); Zod-validates every read; `loadPackage(uuid)` and `listPackages()` for M3–M5. |
| `src/nofo/llm.ts` | (M3) `callStructured({system, user, tool, schema, maxTokens})`: forced `tool_choice`, Zod parse, one repair retry, then a typed failure. |
| `src/nofo/extraction/{prompts,extract}.ts` + `cli.ts` | (M3) `npm run nofo:extract -- <uuid>`: bounded page-window batches → candidate requirements → citation verification → dedupe → `requirements.json`. |
| `src/nofo/citations.ts` | (M3) `verifyCitation()` and `verifyAll()` (§3.5). |
| `src/nofo/assessment/facts.ts` | (M4) `ProjectFacts` schema, merge rules, and the fact-extraction call (with user-quote verification). |
| `src/nofo/assessment/checks.ts` | (M4) Deterministic evaluators for machine-checkable constraints (§3.6). |
| `src/nofo/assessment/assess.ts` | (M4) Applicability filter, deterministic checks, batched LLM interpretation of the rest, in-memory cache keyed by hash(facts, requirementsVersion). |
| `src/nofo/assessment/questions.ts` | (M4) Rank and cap follow-up questions (§3.7). |
| `src/nofo/advisory.ts` | (M4) Narrative summary and next steps from findings only; requirement-ID token resolution. |
| `src/nofo/service.ts` | (M4/M5) Facade: `listOpportunities()`, `getSourcePage()`, `assessTurn()`. Routes and (optionally) MCP call only this. |
| `src/web/routes/nofo.ts` | (M5) Read-only HTTP endpoints (§3.8). |
| `public/js/nofo.js` | (M5) Mode UI, facts panel, findings cards, source drawer. Uses `textContent`/`escapeHtml` only. |
| `vitest.config.ts`, `src/test-setup.ts` | Test config (`include: src/**/*.test.ts`) and a dummy `SAM_API_KEY`. |
| `src/nofo/**/*.test.ts` + `src/nofo/__fixtures__/*` | Tests and local synthetic fixtures. |
| `scripts` entry `nofo:eval` (`src/nofo/eval/run-eval.ts`) | (M3) Compares `requirements.json` to `gold.json`; reports coverage and citation accuracy. Not part of `npm test`. |
| `docs/NOFO_DEMO.md` (M5) | Demo script, known limitations, benchmark notes. |

**Adapter contracts** (from the guide; return types adapted to the repo):

```ts
interface OpportunitySource {
  getOpportunity(id: string): Promise<Opportunity>;
  getAttachments(id: string): Promise<Attachment[]>;   // from the same detail response
}
interface DocumentProcessor {
  id: string; version: string;
  supports(mimeType: string, fileName: string, sniffedType: string): boolean;
  process(input: { file: Buffer; fileName: string; sourceUrl?: string }): Promise<NormalizedDocument>;
}
async function ingestOpportunity(opportunityId: string, opts?: IngestOptions): Promise<OpportunityPackage>;
```

**Modified files (small, additive)**

| File | Change |
|---|---|
| `package.json` / lockfile | New deps (§4); scripts `nofo:ingest`, (`nofo:find`), `nofo:extract`, `nofo:eval`, `test:run`. |
| `src/web/api-server.ts` | (M5) `import nofoRouter`; mount `/api/nofo` behind a rate limiter (reuse the chat limiter shape, same env vars). |
| `src/config/config.ts` + `.env.example` + `src/types/index.ts` (`Config`) | Optional blocks, **none required at startup**: `simpler` (`SIMPLER_GRANTS_API_KEY`, `SIMPLER_GRANTS_BASE_URL` default `https://api.simpler.grants.gov`, timeout, retries, `NOFO_MAX_DOWNLOAD_BYTES`) and `nofo` (`NOFO_DATA_DIR` default `data/opportunities`, `ANTHROPIC_EXTRACTION_MODEL` default = `ANTHROPIC_MODEL`, `NOFO_MAX_TOKENS`). The key is checked lazily with a clear error, like the Anthropic key. `.env.example` gets a placeholder only. |
| `public/chat.html`, `public/js/chat.js`, `public/js/api.js`, `public/css/style.css` | (M5) Mode switch, opportunity selector, facts panel, findings container; ~10-line `chat.js` hook; `api.js` helpers; additive styles. |
| `tsconfig.json` | Exclude `**/*.test.ts` from `tsc` output so tests don't ship in `dist/` (optional). |
| `README.md`, `doc/ARCHITECTURE.md` | Short NOFO section (M5). |

**Explicitly untouched:** `src/tools/*`, `src/clients/sam-*`, `src/mcp/*`, `src/server.ts`, `src/web/chat/*`, the other routes and HTML pages, and `common.js`.

### 3.4 Core types (adapted from the guide; Zod is the source of truth)

```ts
Requirement = {
  id, opportunityId /* Simpler UUID */,
  category: 'eligibility'|'funding'|'application'|'readiness'|'evaluation'|'post_award',
  topic: <controlled enum, e.g. 'applicant_type','federal_share','max_award','min_award',
          'match','bca','nepa','design_status','submission','geography', …>,
  title, description,
  mandatory: boolean | null,          // null = ambiguous → reviewStatus 'needs_review'
  programVariant: 'capital'|'planning'|'both'|null,
  appliesWhen: string[],              // human-readable conditions
  applicability?: Predicate[],        // optional machine-readable subset (see below)
  check?: Check,                      // optional machine-checkable constraint (§3.6)
  evidenceNeeded: string[],
  sources: { documentId, page?, section?, quote, authority, verified: boolean,
             locationCorrected?: boolean }[],
  reviewStatus: 'unreviewed'|'verified'|'needs_review',
  reviewNote?: string
}
ProjectFacts = { <typed fields>: { value|null, provenance:'user'|'derived', userQuote?, turn? } }
Finding = { requirementId, status:'supported'|'conflict'|'unknown'|'needs_specialist_review',
            method:'deterministic'|'llm', explanation, factsUsed[], sourceDocumentIds[] }
```

- **Rev 2:** `opportunityId` is the Simpler.Grants.gov UUID, distinct from the official `opportunityNumber` (kept as its own field in `opportunity.json`). `sources[].documentId` must resolve to a manifest entry whose `normalized.json` exists. `requirements.json` records a `sourceManifestHash` (hash of every document's sha256 and processorVersion) so changed documents mark extraction stale.
- Only the facts the demo needs are typed: `applicantType`, `grantCategory`, `areaType` (urban/rural), `totalProjectCostUsd`, `requestedFederalUsd`, `nonFederalMatchUsd` and `matchCommitted`, `bcaCompleted`, `designStatus`, `environmentalStatus`. Everything else is free text for the LLM path.
- `Predicate` and `Check` cover only a handful of kinds, each with a deterministic evaluator and unit tests: `applicant_type_in`, `amount_min`/`amount_max` (federal request), `federal_share_max_pct`/`match_min_pct`, and `document_required` (e.g. BCA). Anything the extractor cannot express this way stays a plain, LLM-judged requirement.
- Money is stored as integer USD. `totalProjectCostUsd` and `requestedFederalUsd` are distinct fields. The guide says not to conflate them, and the arithmetic check `request + match vs. total` is deterministic.

### 3.5 Citation verification (the central quality gate) — unchanged

For each source on each extracted requirement, code checks, in order:

1. `documentId` exists in the package manifest (else **reject the source**).
2. `page` is within the document's page range (else reject).
3. `quote` appears, after `normalize()`, in that page's text (**pass → `verified:true`**).
4. If not on that page but found on another page of the same document → **fix the location, set `locationCorrected:true`**.
5. Otherwise → **drop the source**. A requirement with no surviving source is **rejected**, and counted in the extraction report.

HTML sources use the section ID instead of a page number. All of this is string matching and needs no LLM. The normalizer is the weak point: PDF text extraction can reorder columns or break words. It is therefore tested early against the real documents in M2/M3, and fuzzy matching is a documented fallback if needed.

### 3.6 Deterministic vs. LLM judgment — unchanged

- **Deterministic (code):** applicant type membership, request vs. min/max, federal share % vs. cap, match % vs. minimum, `request + match = total`, document-required flags (BCA), and the `unknown` rule (a missing fact makes the finding `unknown`, never pass or fail).
- **LLM (batched, Zod-validated):** requirements with no machine-checkable `check`. The model sees the requirement (with its verified quote) and the relevant facts, wrapped in delimiters as **data**, and must return a status, a one-sentence explanation, and the fact keys it used. The code rejects any status that cites facts which don't exist. An LLM-only `conflict` is shown as **"Potential conflict — verify"**. Only deterministic conflicts are shown as plain "Conflict".
- **Cross-document authority conflicts** (the guide's "FAQ vs NOFO" scenarios): compare `check` values for the same `topic` across authority levels in code. If they differ, flag `needs_specialist_review` and show both citations; **never pick one**. Non-numeric contradictions are a stretch goal (§8).

### 3.7 Questions — unchanged

The code ranks candidate questions: requirements that are `unknown` solely because a typed fact is missing, ordered by (mandatory first, deterministic-check first, requirement `category`). It asks at most 3 per turn, and each question names the requirement it comes from. The question text is a template over the fact key, not free LLM generation. This guarantees every question traces to a source (the guide: "only when the applicable source requirement supports them").

### 3.8 API (all JSON, stateless, no cookies)

| Endpoint | Purpose |
|---|---|
| `GET /api/nofo/opportunities` | **Rev 2:** list opportunities that have been **ingested to disk** (from `listPackages()`), each with UUID, title, official number, fiscal year (if present in metadata), coverage status and reasons, and requirement counts by reviewStatus once M3 has run. |
| `GET /api/nofo/opportunities/:id/documents/:docId/pages/:page` | Page text plus authority and provenance, for the "verify evidence" drawer. `:id` must be a UUID and `:docId` allow-listed against the manifest; `:page` is a bounded integer. |
| `POST /api/nofo/assess` | Body `{opportunityId (UUID), messages[≤40, content ≤4000 chars], facts?}` → `{facts, findings[], questions[], advisory:{summary,nextSteps[]}, coverage, disclaimer}`. Strict Zod schema; unknown keys rejected. |

**There is deliberately no ingestion endpoint.** Ingestion needs the Simpler API key, makes server-side outbound requests from user-supplied IDs, and writes to disk. Exposing that on the web app would add an SSRF/cost/credential surface for no demo value. Ingestion is an operator action through the CLI. (The guide allows "a minimal test CLI or API route"; the CLI is the safer choice.)

The per-turn LLM call budget is: fact extraction (1, small) → interpretation of non-deterministic requirements (1–3 batches, skipped if the relevant facts are unchanged) → advisory narrative (1). I estimate roughly 10–20 s per turn from that call count, which I have **not measured**. Unchanged facts hit the in-memory cache, so a repeat is instant. Changing one fact recomputes only what depends on it, and acquisition, parsing and extraction are not rerun.

### 3.9 Security and safety design (per Optimizely secure-coding checklist)

**Applies to the whole feature (unchanged from Rev 1)**

- **Prompt-injection boundary.** The system prompt is fixed and separate from content. Document text, user messages and facts are passed inside delimiters as untrusted data. Models never receive tools that can act. The only tool is the forced "record results" schema. No MCP tools are reachable from NOFO mode.
- **Output validation in code.** Zod on every model output, plus citation verification, plus requirement-ID token resolution. Unknown tokens are stripped and flagged.
- **Fact provenance.** Each LLM-extracted fact must carry a `userQuote` that is verified as a substring of a *user* message. Otherwise it is discarded.
- **Input limits (new endpoints).** Max messages/lengths as above, request body size left at the Express default (100 kB), and the same IP rate limit as chat (start at the chat default of 10/min; tune from rehearsals).
- **No upload surface.** Applicant materials arrive as typed chat text only.
- **Rendering.** Findings, quotes and explanations render via `textContent` or `escapeHtml`. Anything markdown-ish goes through the existing allow-list `renderMarkdown`. No new raw-HTML sinks.
- **Logging.** NOFO code logs IDs, counts and status codes only, **not** message text or project facts. Errors use the existing generic handler.
- **Data.** The demo project is hypothetical. A visible banner reminds users not to enter confidential or personal information. Project text is sent to the Anthropic API (or the configured gateway).

**Added in Rev 2 for acquisition and ingestion**

- **API key handling.** `SIMPLER_GRANTS_API_KEY` is read only from the environment and checked lazily. It is **never** committed (only a placeholder in `.env.example`), logged, echoed in errors, or written to the manifest. Request logging records method, host, path template and status, never headers. The key is attached **only** to requests whose host equals the configured API host. The base URL must be `https`.
- **Redirects and host rules.** Redirects are followed manually (`redirect:'manual'`, ≤3 hops), each hop re-checked: https only, no `localhost` or private/loopback IP literals, and the API key is dropped on any cross-host hop. This avoids the credentials-follow-redirects class of bug flagged by the existing `follow-redirects` advisory. DNS-rebinding is not mitigated: the CLI is operator-run and does not accept URLs from end users (documented limitation).
- **`download_path` is untrusted input.** It is resolved against the API base only if relative, and otherwise validated as above. Its **query string is stripped** before it is stored in the manifest or logs, because a presigned URL's signature is a short-lived credential that must not land in git. We record `urlKind` instead.
- **Size and resource bounds.** Per-file cap (default 50 MB, `NOFO_MAX_DOWNLOAD_BYTES`) enforced from `Content-Length` **and** while streaming, a package-level cap, a max page count and total-text cap per document, a PDF parse timeout, and bounded concurrency (2) with bounded retries. Combined with Simpler's documented default limit of 60 requests/min and 10,000/day per key, one ingest stays far below it.
- **Content validation, not trust in metadata.** The processor is chosen from **magic bytes**, not the declared MIME type or extension. A mismatch is recorded as a `type_mismatch` note. Unknown or unsupported types are stored but **never parsed**.
- **Safe storage.** `file_name` from the API is display-only (control characters and path separators stripped, length-capped). The stored name is always server-generated (`original.<ext>` under a validated `documentId`). Path traversal, absolute paths, NULs, duplicate and reserved names are tested. Files live under `data/`, outside the web root, and are never served directly (M5 serves originals only through an allow-listed route; §5).
- **Archives are never extracted.** ZIP, DOCX, XLSX and GIS bundles are registered with a hash and `unsupported_format`. No unzip, so no zip-bomb or zip-slip surface. (The repo already depends on `unzipper` for the Grants.gov extract; we do not use it here.)
- **Hardened parsers.** `pdfjs-dist` runs text-only with eval/scripting/font features disabled, under a time and page cap, at a **current exact-pinned version** (older pdf.js releases had an arbitrary-JavaScript-execution advisory, CVE-2024-4367, fixed in 4.2.67; confirm with `npm audit` at install time). `cheerio` only parses; scripts and styles are dropped, and links are kept only if http(s).
- **Crash-safe, validated persistence.** Atomic writes (temp + rename), Zod validation on every read, and stale-lock-free single-writer CLI. A corrupt or tampered manifest fails closed with a clear error.
- **Typed, non-leaky errors.** `SimplerApiError` carries status and kind, mapped to existing `GrantServerError` codes. Messages contain no keys, headers or signed URLs.
- **Dependencies.** Exact-pinned versions (no `^`) for the new libraries, lockfile committed, `npm audit` before and after, licenses checked (§4). I recommend also running `npm audit fix` for the existing high-severity advisories as a separate commit, with your approval.

### 3.10 Frontend flow (reuses `chat.html`)

1. The user switches the mode. **Rev 2:** an **opportunity selector** lists the ingested packages from `GET /api/nofo/opportunities` (title, official number, UUID, coverage). It preselects the one given by `?opportunity=<uuid>` or, failing that, the most recently ingested. No UUID is hardcoded in the frontend. A banner shows "Preliminary assessment — not an official eligibility determination" and the **coverage status with its reasons** (e.g. "2 of 3 listed documents processed; 1 unsupported format").
2. The user describes the project. Each turn, `nofo.js` posts `{messages, facts}` and renders: a **Facts I'm using** panel (editable chips; the user can correct a fact and the assessment updates), **finding cards** grouped by status (conflict / unknown / needs review / supported) with citation chips, **up to 3 follow-up questions**, and a short **next steps** list.
3. A citation chip opens a drawer with the verified quote, document title and authority, page, and a link to the source. **Rev 2 note:** the BUILD `download_path` was observed to be a plain public URL, but the API does not promise that, so durable links are (a) our own locally stored original, served by an allow-listed, `nosniff` PDF route with `#page=N`, and (b) the opportunity's page on Simpler.Grants.gov (URL pattern to be verified).
4. Honest failure states: documents not ingested or unsupported, extraction rejected N requirements, the model returned invalid output → a visible message and no invented content.

### 3.11 Simpler.Grants.gov API contract — what is verified (Rev 2)

Source: the official OpenAPI spec at `https://api.simpler.grants.gov/openapi.json`, fetched 2026-11-04 and parsed locally (a local copy is in the session scratchpad and is **not** committed), plus the public developer page. Two keyless calls (detail with an all-zero UUID; a minimal search body) confirmed authentication behavior. **Rev 2.1** adds read-only live calls made with your key (see "Verified live" below). The spec-derived rows in this table are from Rev 2.

| Item | What the spec / probes show |
|---|---|
| Spec | OpenAPI 3.1, "Simpler Grants API" `v0`. The description says it is *"in active development… currently stable for everyday use, and will be versioned with advance notice for any breaking changes."* **Treat it as able to change; re-check at the start of M2.** |
| Auth | `ApiUserKeyAuth`: header **`X-API-Key`**. These endpoints alternatively accept a user JWT (`X-SGG-Token`), which we do not use. **Keyless detail and search calls returned HTTP 401.** `/health` is public (200). |
| Getting a key | The developer page says keys are created, rotated and revoked after signing in through Login.gov (some accounts need PIV/CAC). Default limit: **60 requests/min and 10,000/day per key** (page text as summarized by WebFetch; confirm). You created one in Rev 2.1; it works (see "Verified live"). |
| Detail | `GET /v1/opportunities/{opportunity_id}`. Path parameter type is declared `string` (not `uuid`), so **we validate UUIDs ourselves**. Documented responses: 200, 401, 404 (**no 429/5xx documented**; handle them anyway). Envelope `{data, message, status_code}`; observed error envelope `{data, errors[], internal_request_id, …}`. |
| Detail fields we use | `opportunity_id` (UUID), `opportunity_number`, `legacy_opportunity_id` (int\|null), `opportunity_title`, `opportunity_status`, `agency`/`agency_code`/`agency_name`, `top_level_agency_*`, `category`, `purpose_statement`, `created_at`/`updated_at`, `opportunity_assistance_listings[]`, `summary{…}`, **`attachments[]`**. |
| `summary` fields | Include `award_ceiling`, `award_floor`, `applicant_types[]`, `applicant_eligibility_description`, `close_date`, `fiscal_year`, `estimated_total_program_funding`, `expected_number_of_awards`, `additional_info_url`. Stored as `metadata`-authority facts; useful as a cross-check in M3 (§5), never as a requirement source. |
| **Attachment fields** | `opportunity_attachment_id` (UUID), `file_name`, `file_description`, `mime_type`, `file_size_bytes`, **`download_path`** ("The file's download path"), `created_at`, `updated_at`. |
| Search | `POST /v1/opportunities/search`. Body **requires** `pagination {page_offset, page_size, sort_order}`; optional `query`, `query_operator`, `filters` (agency, applicant_type, award_ceiling/floor, funding_category, funding_instrument, is_cost_sharing, opportunity_status, post_date, close_date, top_level_agency, …), `format`. Response `{data[], facet_counts, pagination_info{page_offset,page_size,sort_order,total_pages,total_records}}`. **Search items are `OpportunityV1`, which has no `attachments`: attachments come only from the detail call.** |
| Legacy ID | `GET /v1/opportunities/{legacy_opportunity_id}` with an **integer** ID ("Opportunity Get Legacy"). This is the only bridge from existing local-mode search results (§2.4 #12). |

**Verified live (Rev 2.1 "Step 0", 2026-11-04).** Read-only calls with the key you supplied, about 15 requests in total. Raw responses are in the session scratchpad and are not committed.

| Item | Observed |
|---|---|
| Auth | `X-API-Key` works: search and detail both returned 200. |
| **BUILD is in Simpler** | UUID **`4d8f5775-ff01-4a6f-ab4e-b125899043b3`**, number `DTOS59-26-RA-BUILD`, legacy ID `360921`, title "FY 2026 National Infrastructure Investments", category `discretionary`, DOT, status **`archived`**. **An archived opportunity is retrievable by UUID**, so the earlier "closed/archived may not be retrievable" risk is gone. |
| BUILD metadata | `award_ceiling` 25,000,000; `award_floor` 1; estimated total program funding 1,500,000,000; expected awards 100; posted 2025-11-26; closes 2026-02-24; `is_cost_sharing` true; `applicant_types` `["other"]`; `additional_info_url` `https://www.transportation.gov/BUILDgrants`; `competitions` empty. **`fiscal_year` is `null`**, so the fiscal year must come from the title and documents, not metadata. These are Simpler's metadata fields, kept as `metadata`-authority facts, never as requirement sources. |
| **BUILD attachments** | **Exactly one:** `FY_2026_BUILD_NOFO_Final.pdf`, `application/pdf`, 718,157 bytes, description "FY 2026 BUILD NOFO_Final". **No FAQ, checklist or amendment is attached.** Anything beyond the NOFO must come from curated supplemental sources (M2 P1). |
| `download_path` | An absolute `https` URL on `files.simpler.grants.gov`, shaped `/opportunities/<opportunityUuid>/attachments/<attachmentUuid>/<file_name>`, with **no query string or signature**. The files are served from S3 behind CloudFront. All 12 attachments across the 7 candidate opportunities I inspected had the same host and shape. We still handle relative and presigned forms (§3.9). |
| Download needs a key? | **No.** A keyless GET returned 200, `application/pdf`, `Content-Length` 718,157 (equal to the API's `file_size_bytes`), first bytes `%PDF-1.7`, no redirects. So **the API key must never be sent to the files host** (§3.9 already requires this). |
| Legacy lookup | `GET /v1/opportunities/360921` returned the same opportunity (200), so the optional legacy-ID adapter is feasible. |
| ID handling | An uppercase UUID is accepted (200). We still lower-case and validate UUIDs locally before any request. |
| Status values | `forecasted`, `posted`, `closed`, `archived` (spec enum). |
| Search | Works with `filters.top_level_agency.one_of:["DOT"]` plus `filters.opportunity_status.one_of:[…]` (1,500 DOT records across posted/closed/archived). `fiscal_year` is also null in search results, and results carry no attachments. |
| Rate limiting | No rate-limit headers on normal responses, and no 429 was triggered. |

**Second-opportunity candidates** (all DOT; attachments counted from live detail calls):

| Candidate | UUID | Status | Attachments | Use |
|---|---|---|---|---|
| **FHWA-WCPP-26-002**, Fiscal Year 2026 Wildlife Crossings Pilot Program | `41eb2492-6242-49f8-89ae-17d15c068be4` | posted, closes 2026-11-16, ceiling $80M | PDF NOFO (796,869 B) + **DOCX** application template (241,189 B) | **Recommended second test.** A transportation-infrastructure grant with a different attachment mix. It exercises the PDF path and the DOCX `unsupported_format` registration. |
| NHTSA-693JJ926R000024-FY26 (ITSE) | `5269870b-a071-47ba-a076-d3fbc1955077` | posted | 4 PDFs: NOFO, webinar, **two versions of a Q&A** | Optional extra check of authority classification and versioned guidance (not a capital program). |
| FR-RLD-26-001 (Atlantic Gateway…) | `9854b307-dff7-4f10-80dc-a760b9b3dbc2` | archived | **0** | Live check of the "no attachments" case. `DOT-FAA-26-0117-002` (`b8a038bf-3e44-4a09-a42d-6cc3606f1adb`) also has none. |

**Still not verified:**

1. 429 behavior, any `Retry-After`, and the rate-limit values in practice (the 60/min and 10,000/day default is from the developer page only).
2. Whether `download_path` is *always* a public unsigned URL (it was for all 12 observed). The presigned-URL handling stays in the plan.
3. **PDF text quality.** I downloaded the real NOFO but did not parse it: no PDF tool is installed and the parser dependency is not yet added. Page layout, tables and quote matching (R3) remain open until M2.
4. The human-facing opportunity page URL pattern, for a durable source link.
5. Pagination limits beyond the 25-item page I used.

---

## 4. Dependencies

Versions below were checked against the npm registry on 2026-11-04. Re-verify at install time, then **pin exactly**.

| Package | Purpose | Registry check | Notes |
|---|---|---|---|
| `pdfjs-dist` | PDF text per page, with positions for headings | latest 6.5.438, Apache-2.0, **Node ≥ 22.13 \|\| ≥ 24**. 5.6.205 supports Node ≥ 20.19. | Mozilla-maintained, page-addressable, no native build. Used only by the offline ingest CLI and dynamic-imported. Choose the 6.x vs 5.x line at install based on your Node version (dev machine is v24.11.1). Pin to a version well past CVE-2024-4367. **Rev 3 pinned choice: `6.4.299`** (published 2026-10-03, about a month old, rather than the 3-day-old latest; confirm its `engines` and `npm audit` at install). **Not yet installed** (see the M2 implementation record). |
| `cheerio` | HTML sections → text | 1.2.0, MIT, Node ≥ 20.18.1 | **Rev 2: now required**, because the guide's M2 processes HTML (attachments and curated HTML sources). Keep the adapter thin. **Rev 3 pinned choice: `1.2.0`** (published 2026-01-23). **Not yet installed.** |
| HTTP client | Simpler API + downloads | **No new package.** Native `fetch` (Node ≥ 18, built in). | Gives manual redirect control, streaming byte caps and `AbortSignal` timeouts. The existing `axios` stays for existing code. Using it for the new client would route credentials through `follow-redirects`, which has an open high-severity advisory in this tree. |
| *(not adding)* `pdf-parse` | — | — | Thin, poorly maintained wrapper over an old pdf.js. Avoid. |
| *(not adding)* `unpdf` | — | 2.1.0, Node ≥ 24 | Unnecessary extra layer, and a higher Node floor. |
| *(not adding)* `zod-to-json-schema` | — | — | Handwrite the small tool schemas (the existing pattern), or evaluate the SDK's built-in `helpers/zod` in M3 (it may need a different Zod import path; we have Zod 3.25.76). |
| `mammoth` | Word (.docx) → HTML → sections | 1.13.0, BSD-2-Clause, released 2026-09-26; about 8 small dependencies | **Added in Rev 3.2.** Installed by you as `^1.13.0` (caret, not exact). The existing `unzipper` is used only to inspect the ZIP directory. |
| *(not adding)* XLSX/ZIP libraries | — | — | Out of scope: registered, not parsed (ZIP is never extracted). |

Dev-only: no new devDependencies expected. A minimal valid PDF for test fixtures can be hand-generated in the test (a short string template), avoiding a PDF-writer dependency.

---

## 5. Milestones, calendar and acceptance criteria

**Calendar (working days to 2026-11-13).** These are my estimates, not measurements. **Rev 2 makes M2 about a day larger than in Rev 1** (an API client, acquisition safeguards, generic adapters and two live runs, instead of parsing a handful of hand-placed files). Because Rev 1 already had zero float, **this schedule now has negative float unless something is cut or the M3 gold-set work starts in parallel** (§8).

| Day | Plan |
|---|---|
| Wed 11/4 | **M1 / Rev 2.1** — this plan; your review. API key received and Step 0 live checks done (§3.11). |
| Thu 11/5 | **M2 part A** — Step 0 re-check, client, UUID validation, downloads, store, PDF adapter, unit tests |
| Fri 11/6 | **M2 part B** — HTML adapter, classification, coverage, caching; **live runs on BUILD and the second opportunity**; plan updated with results; commit. **Gold-set work starts the moment BUILD documents are ingested.** |
| Mon 11/9 | **M3** — extraction pipeline, smoke test, full run, gold-set eval; commit |
| Tue 11/10 | M3 fixes, then **M4** — facts, deterministic checks, questions, scenarios |
| Wed 11/11 | **M4** finish; **M5** start — endpoint + frontend |
| Thu 11/12 | **M5** finish, browser test, rehearsal, freeze, backup recording |
| Fri 11/13 | Deadline day, buffer only |

If the team observes the 11/11 federal holiday, M5 slips into the buffer. The API key is available, so M2's live verification is no longer blocked on credentials. The remaining blockers are your approval of the plan and your confirmation of the second opportunity (Q12). If a live run ever cannot be completed, the guide requires us to *document the blocker rather than claim a pass*.

### M2 — Generic opportunity acquisition and document ingestion (**Rev 2, supersedes Rev 1 M2**)

> **Status (Rev 3.1): implemented, unit-tested and verified live; gate met with caveats.** The pipeline, client, safeguards, caching, coverage reporting and CLI are done. After you installed `pdfjs-dist` and `cheerio`, the cached PDFs were parsed without re-downloading and the page addressing was verified against the documents' own tables of contents and with the shared quote matcher. **Caveats:** (1) I could not render PDF pages to compare them visually, because `poppler` is not installed; (2) the new dependencies are declared with caret ranges, not exact pins. Details and exact results are in **"M2 implementation record"** at the end of this milestone.

**Goal.** `ingestOpportunity(opportunityId)` takes a Simpler.Grants.gov UUID (direct input; optionally resolved from a legacy ID), retrieves opportunity details and the attachments Simpler lists, processes PDF and HTML, registers every other format honestly, and persists a traceable, cached package under `data/opportunities/<uuid>/`. **No program-specific code.**

**Entry points.** The library function `ingestOpportunity()` and the CLI `npm run nofo:ingest -- <uuid> [--refresh]`. No web route (§3.8).

**Preconditions and blockers**

| # | Item | Owner | If missing |
|---|---|---|---|
| 1 | **Simpler.Grants.gov API key** in `SIMPLER_GRANTS_API_KEY` | **Done (Rev 2.1).** The key is in your local gitignored `.env` and works. | — (if it is ever revoked: fixtures only, live tests recorded as **blocked**, not passed) |
| 2 | **Two real, different opportunity UUIDs** | **BUILD found** (`4d8f5775-ff01-4a6f-ab4e-b125899043b3`). **Second: WCPP recommended** (§3.11), pending your confirmation (Q12). | Cannot meet the M2 gate |
| 3 | `SAM_API_KEY` set for the CLI; dummy value in tests (§2.4 #5) | — | CLI fails at startup |
| 4 | `rm -rf dist && npm run build`; `vitest.config.ts`, `src/test-setup.ts`, `test:run` | Me, at the start of M2 | — |
| 5 | Node ≥ 22.13 for the offline CLI (§9 Q5) | You | Use `pdfjs-dist` 5.x |

**Step 0 — verify the live contract (first, before building on it).** *Status: largely done in Rev 2.1 (§3.11). At M2 start I re-run it, because the API says it is in active development, and I settle the remaining items there (429 behavior, PDF text quality).* With the key, make read-only calls for both UUIDs and record in §3.11: the form of `download_path`, whether downloads need the key, MIME types seen, status values, error bodies, and the UUID-vs-legacy behavior. If any assumption in this plan is wrong, **update the plan and tell you before writing code that depends on it.**

**Work, in priority order**

- **P0 (needed for the gate):**
  - config + `SimplerGrantsClient` + UUID validation + `getOpportunity`
  - bounded download with all §3.9 safeguards
  - `store.ts`
  - PDF processor, thin HTML processor, `unsupported` registrar, registry
  - deterministic authority classification
  - manifest + coverage computation
  - caching and re-ingest semantics
  - `ingestOpportunity()` + CLI
  - the unit tests below
  - live runs on both opportunities
- **P1:** `supplemental.json` (curated URLs and manual files, overrides).
- **P2 (cut first if behind):** `nofo:find` search helper; `--legacy-id` resolver.

**Cache and re-ingest semantics**

- Every run makes exactly one detail call, then decides per attachment using `(opportunity_attachment_id, updated_at, file_size_bytes)`.
- Unchanged, original present, sha256 re-hashes to the manifest value, and `processorVersion` current → status `cached`, no download, no parse.
- Processor version changed → reparse from the stored original, no download.
- Attachment disappeared upstream → keep the entry as `removed_upstream`; **never silently delete** (amendments matter).
- `--refresh` forces re-download.
- Running twice produces an identical manifest apart from `lastCheckedAt`.
- Per-document failures never abort the package: other documents continue and the failure is recorded.
- CLI exit codes: `0` package written (printing coverage), `2` hard failure (invalid UUID, 401, 404, retries exhausted), `3` package written with coverage `none`.

**Tests (unit, local synthetic fixtures, injected `fetch`, no network)**

| Area | Cases |
|---|---|
| Input | invalid UUID (empty, malformed, path-traversal strings); uppercase UUID normalized |
| API | unknown opportunity (404); bad key (401, message contains no key); 429 with `Retry-After` then success; retry exhaustion; 5xx retries bounded; timeout; malformed JSON; schema-violating response (missing `opportunity_id`, `attachments` not an array) |
| Package | **zero attachments** → metadata preserved, coverage `none`/unknown, never "complete"; attachment without `download_path` |
| Download | per-document failure while others continue; oversize via `Content-Length` and via streaming overrun; non-https rejected; private/loopback host rejected; **cross-host redirect does not carry `X-API-Key`**; presigned query string absent from manifest and logs |
| Safety | unsafe filenames (`../../x.pdf`, absolute path, NUL, over-long, reserved, duplicates) → server-generated storage name; magic-byte vs declared MIME mismatch |
| Formats | PDF with pages and hyphenation; PDF with no text → `empty_text` (no OCR); HTML headings/links/script-stripping; DOCX/XLSX/ZIP/GIS registered as `unsupported_format` and never parsed or extracted |
| Authority | table-driven classifier including `unclassified` and manual override |
| Cache | repeat ingest makes **only the one detail call** (mock call counts); processor version bump reparses without downloading; `removed_upstream` retained; crash mid-write leaves the previous manifest valid |
| Traceability | every `documentId` in the manifest resolves to an existing `normalized.json`, and every page in that file resolves to non-empty text |
| Generic-ness | the same `ingestOpportunity` code runs two different fixture opportunities; a **guard test** scans `src/nofo/**` for program-specific strings (e.g. `BUILD`, `FY2026`, hardcoded UUIDs) |

**Live verification protocol (both real opportunities)**

1. Ingest each; re-run each (cache hit proves no re-download).
2. Record per opportunity: attachments listed, downloaded, parsed, unsupported, failed, authority classification, coverage status and reasons.
3. **Spot-check 3 source references per opportunity**: choose a sentence in the original PDF, find it in `normalized.json` by page number, and confirm it visually in the original at that page.
4. Write the results table into this plan's M2 results section. If either run is blocked (no key, opportunity not in Simpler, no attachments), say so plainly and do not mark the gate passed.

**Acceptance criteria (guide checkpoint)**

- [x] **The same pipeline fetches two different real opportunities** (FY2026 BUILD and one other), acquires their available attachments, preserves original locations and provenance, parses supported files, and accurately reports missing or unsupported documents. No special-case program logic (guard test green). **Met.** Verified live on BUILD (1 PDF → 51 pages parsed, coverage `api_listed_processed`) and Wildlife Crossings (PDF → 24 pages parsed; DOCX registered as unsupported; coverage `partial`), plus the zero-attachment case.
- [x] An opportunity with no API attachments preserves its metadata and states that document coverage is incomplete/unknown. (Unit test, and live on `FR-RLD-26-001`.)
- [x] Invalid, rate-limited and malformed API responses are handled gracefully with the exact status recorded and no invented data. (Unit-tested. No live 429 occurred, so rate-limit handling is verified only against mocks.)
- [x] Document IDs and source references resolve to actual ingested content. **Met, with one caveat.** The traceability test passes, the live stored files' SHA-256 matches the manifest, and the spot-checks below pass (6 real sentences found on exactly their expected page; a false quote found nowhere). **Caveat:** the spot-check compares extracted text with the documents' own printed page references, not with a rendered image of the page, because no PDF renderer is installed.
- [x] No API key, signed URL or sensitive header appears in tracked files, manifests, or CLI/error output. (Tests; `git grep` finds the key in no tracked file; the live manifests contain no signature material.)
- [x] `npm run build` (`tsc`) clean; `npm run test:run` green. **170 passed, 0 skipped, 0 failed** (after the installs; before them 161 passed and 9 were skipped). No pre-existing tests exist on this branch.
- [x] This plan updated with the M2 implementation record below.
- [x] **Stopped for review.** Nothing from M3 (extraction), M4 (assessment/advisory) or M5 (chat UI) and no database is implemented.

**Report back.** Changed files; the live-contract findings from Step 0; per-opportunity acquisition results; parsing limitations (tables, columns, headers/footers); sources needing manual review; exact build and test output.

**Not in M2.** Requirements extraction, project assessment, advisory logic, a new chat UI or discovery UI, grant matching or triage, OCR, GIS analysis, spreadsheet calculation, application writing, autonomous crawling, a database.

#### M2 implementation record (Rev 3, 2026-11-04)

**Entry points (no web route, by design).**
- `ingestOpportunity(opportunityId, options?) → Promise<{ opportunity, manifest }>` in `src/nofo/ingest/ingest-opportunity.ts`.
- CLI: `npm run nofo:ingest -- <opportunity-uuid> [--refresh]` (runs with `tsx`, so a stale `dist/` can never be executed by mistake). Exit codes: `0` package written, `2` hard failure (invalid ID, auth, not found, retries exhausted, corrupt package), `3` package written but no document parsed (coverage `none`).
- Not built (cut-list items, P2): the `nofo:find` search helper and the `--legacy-id` resolver. The legacy lookup is verified feasible (§3.11).

**Files added** (all under `src/nofo/` unless noted)
- `schemas.ts`: Zod schemas for the opportunity, manifest, normalized documents and `supplemental.json`; `parseOpportunityId()`.
- `simpler/{schemas,client,source}.ts`: tolerant response schemas; native-`fetch` client (timeouts, bounded retries for 429/5xx/network only, `Retry-After` honored and capped, manual redirects, key sent only to the API host); `OpportunitySource` interface and its Simpler implementation.
- `acquire/{download,sniff,authority,supplemental}.ts`: bounded safe download; content-based type detection; deterministic authority classifier; optional curated-source loader.
- `ingest/{ingest-opportunity,coverage,normalize,cli}.ts` and `ingest/processors/{types,pdf,html,registry}.ts`: the pipeline, coverage and potential-missing-source computation, shared quote-matching normalization (for M3), the CLI, and the `DocumentProcessor` adapters (PDF, HTML).
- `store.ts`: path-safe, atomic, Zod-validated package store (`PackageStore`, `listPackages()`).
- Tests: 12 test files plus `__fixtures__/{helpers.ts, api/detail-build.json, api/detail-wcpp.json}`; `vitest.config.ts`, `src/test-setup.ts`.
- `data/fixtures/simpler-dot-posted-opportunities.json` (committed-safe list of the 9 posted DOT opportunities, with attachments).

**Files changed:** `package.json` (scripts `test:run`, `nofo:ingest`; **no dependency changes yet**), `src/types/index.ts` and `src/config/config.ts` (optional `simpler` and `nofo` config blocks, not required at startup), `.env.example` (placeholders only), `.gitignore` (`data/opportunities/`, `*.tmp`), `CLAUDE.md`, this plan. Untouched: all existing tools, routes, MCP code, chat agents and the frontend.

**Package shape** (on disk: `data/opportunities/<uuid>/`). `opportunity.json`, `manifest.json` and `documents/<documentId>/{original.<ext>, normalized.json}`, with `supplemental.json` and `supplemental/` optional. The manifest carries `coverage {status: none | partial | api_listed_processed, reasons[], completenessNote}`, `documents[]` (one entry per document with `origin`, `detectedType`, `sha256`, `sizeBytes`, `originalUrl` with the query stripped, `urlKind`, `authority` + `authorityMethod` + `authorityReason`, `retrieval {status, error?}`, `processing {status, processorId, processorVersion, pages|sections, detail|error}`, `notes[]`) and `potentialMissingSources[]`. Document IDs are `sg-<attachment-uuid>` (Simpler attachments) or `sup-<slug>-<hash>` (curated sources).

**Observed API and download behavior (live).** See §3.11. One detail call returns everything. All attachments are public unsigned `https` URLs on `files.simpler.grants.gov` that need no key (so no credential is ever sent to that host). Declared `file_size_bytes` matched the received size for every file. No rate-limit headers and no 429 were seen.

**Supported formats.** *Parsed:* digital PDF (page-aware text, font-size heading hints), HTML (sections by heading, http(s) links resolved against the source URL), and **Word `.docx`** (converted to HTML, then sectioned by Word heading styles; added in Rev 3.2). *Registered, never parsed:* XLSX, PPTX, legacy Office (`.doc`/`.xls`/`.ppt`), ZIP (never extracted), plain text, unknown binaries. *Not handled:* scanned PDFs (reported as `empty_text`; no OCR).

**Live acquisition results** (real API, real downloads; parsing blocked as described):

| Opportunity | UUID | Attachments listed → acquired | Result |
|---|---|---|---|
| FY2026 BUILD (`DTOS59-26-RA-BUILD`, archived) | `4d8f5775-ff01-4a6f-ab4e-b125899043b3` | 1 → 1 (NOFO PDF, 718,157 B) | Downloaded; `%PDF-` confirmed; classified `controlling`; **processing `parse_failed` ("PDF parser not installed")**; coverage `none`; CLI exit 3. Re-run: `retrieval=cached`, no re-download. Stored SHA-256 matches the manifest. |
| FY2026 Wildlife Crossings Pilot Program (`FHWA-WCPP-26-002`, posted) | `41eb2492-6242-49f8-89ae-17d15c068be4` | 2 → 2 (NOFO PDF 796,869 B; DOCX template 241,189 B) | Both downloaded. DOCX detected as `zip`, classified `official_guidance`, **registered `unsupported_format`**, and listed under `potentialMissingSources`. PDF `controlling`, `parse_failed` (parser not installed). Coverage `none`; exit 3. |
| `FR-RLD-26-001` (archived) | `9854b307-dff7-4f10-80dc-a760b9b3dbc2` | 0 → 0 | Metadata preserved; coverage `none` with "lists no attachments… unknown or incomplete"; `potentialMissingSources` recorded; exit 3. |

BUILD and Wildlife Crossings went through the identical code path; no program, year or ID appears anywhere in production source (guard test).

**Potential missing sources recorded for BUILD** (decision Q14: recorded, not fetched): the additional-information page `https://www.transportation.gov/BUILDgrants`; no FAQ/Q&A/checklist attached through Simpler; no amendment list exposed by Simpler. Add BUILD FAQs, checklists and amendments in M3 via `supplemental.json` if needed. The loader, schema, overrides and tests already exist.

**Exact results.** `npm run build` → exit 0. `npm run test:run` → 11 test files passed, 1 skipped; **161 tests passed, 9 skipped, 0 failed**. The 9 skipped are the `pdfjs-dist` (4) and `cheerio` (5) adapter tests, which are shown as skipped (with the reason in the test name) because the packages are not installed. The pure parts of the PDF adapter (line assembly, heading detection) are tested and pass. Existing app smoke test after a clean rebuild: `/api/health` ok, `/chat.html` 200, no NOFO route exists. Pre-existing `npm audit` result unchanged (3 moderate, 3 high; no dependency was added).

**Rev 3.1 results after the dependency install (live, real documents).**

- Installed by you: `pdfjs-dist` **6.5.438** (not the 6.4.299 I had suggested; it works on Node v24.11.1) and `cheerio` **1.2.0**. Both are declared with caret ranges (`^6.5.438`, `^1.2.0`), which does not meet the exact-pin rule in `CLAUDE.md`; fixing that is a one-line change per package and is left to you or the next dependency step. `package-lock.json` was rewritten by the install: it now has 87 `resolved` entries, all on `registry.npmjs.org` (previously 470 on the private mirror), with a diff of about 500 insertions and 1,000 deletions. **That lockfile change is unreviewed and uncommitted; review it before committing.**
- Re-running the CLI parsed the already-downloaded PDFs with no re-download (`retrieval=cached`):

| Opportunity | Document | Result |
|---|---|---|
| BUILD | NOFO PDF | **51 pages**, 118,137 characters, no blank pages, no warnings. Coverage **`api_listed_processed`** (exit 0). |
| Wildlife Crossings | NOFO PDF | **24 pages**, 50,816 characters, no blank pages, no warnings. DOCX template remains `unsupported_format`. Coverage **`partial`** (exit 0). |

- **Page-addressing check against each document's own printed table of contents.** BUILD: 24 TOC entries; 22 found on exactly the printed page, and the other 2 are wording differences inside the document itself (its TOC says "BUILD/BUILD/TIGER" while the body says "BUILD/RAISE/TIGER", and "Standard Form 424" vs "SF-424"); their content is on the right pages. Wildlife Crossings: 8 section entries; 7 exact, and 1 wording difference ("CONTENTS AND FORMATS" vs "CONTENT AND FORMAT"), correct page. So **every checked section lands on the page the document prints for it.**
- **Source-reference spot-check (3 per opportunity) with the shared matcher** (`textContainsQuote`, the function Milestone 3 will use): BUILD p6 (urban capital grants must request at least $5 million), BUILD p7 (up to three applications per applicant), BUILD p7 (definition of cost sharing, with a curly apostrophe), Wildlife Crossings p4 (20 percent non-Federal cost share), p1 (application closing date), p3 (eligible applicants). Each was found on exactly its expected page and no other. A deliberately false quote was found nowhere (negative control).
- **Text quality.** Extracted text is clean and complete: line breaks preserved, tables flattened into readable lines (for example "Rural Areas $1 million"), bullet glyphs and curly quotes survive. One artifact seen: a signature on BUILD's last page extracted as `Sean P. Duffy ?-0`.
- **Heading detection is weak on these documents:** 3 headings found in BUILD and 0 in Wildlife Crossings, because the NOFOs mark headings with bold or numbering rather than a larger font. Treat `headings` as optional. **M3 should locate sections from the text itself** (lettered/numbered headings such as `B. ELIGIBILITY`, `2. MINIMUM FUNDING REQUEST …`, which extract reliably) rather than from the font heuristic.
- **Audit:** `npm audit --omit=dev` now reports 1 high-severity advisory (down from 3 moderate + 3 high), and it is in `zod` 3.x (memory exhaustion when validating oversized constrained collections), a direct pre-existing dependency whose fix is a major version. It is not from the new packages. Our API responses are capped at 5 MB before validation, which bounds the exposure.
- **Not done:** a visual comparison of rendered PDF pages (no `poppler`/`pdftoppm` or other renderer installed). Installing `poppler-utils` would allow it.

**Rev 3.2: Word (.docx) adapter.**

- **Added:** `src/nofo/ingest/processors/docx.ts` (adapter, id `mammoth-docx`), registered in `registry.ts`; `html.ts` was refactored so the HTML and Word adapters share one extraction routine (`htmlToSections`), with behavior unchanged and its tests still passing. Test support: `src/nofo/__fixtures__/docx.ts` (a tiny ZIP/DOCX builder, so no zip-writing dependency was needed).
- **How it works:** `mammoth` converts the Word file to HTML, then the shared routine splits it into heading-delimited sections and links, the same shape HTML documents get. The HTML is parsed only for text, never rendered or served.
- **Dependency:** `mammoth` **1.13.0** (BSD-2-Clause, released 2026-09-26), installed by you; it is declared as `^1.13.0`, a caret range, not an exact pin (same caveat as `pdfjs-dist` and `cheerio`). The existing `unzipper` dependency is used only to read the ZIP directory. `npm audit --omit=dev` is unchanged (the one pre-existing `zod` item).
- **Safeguards:** the ZIP directory is inspected *before* converting (entry-count cap of 5,000, 100 MB declared-uncompressed cap, 300:1 compression-ratio cap, and `word/document.xml` must exist, so a mislabeled `.xlsx` fails cleanly); embedded images are dropped without being read; conversion has a time limit and the shared text-size limit applies. Word text such as `<script>` is kept as plain text, never executed.
- **Tests:** 8 adapter tests (headings, paragraphs and tables become sections; markup characters stay text; non-Word ZIP, corrupt container, decompression-bomb-shaped archive and too-many-entries archive are rejected; text limit) and 1 pipeline test (a DOCX first registered as `unsupported_format` is parsed later from the stored original with **no re-download**). Full suite: **179 passed, 0 skipped, 0 failed**; `tsc` clean.
- **Live result (Wildlife Crossings, `41eb2492-6242-49f8-89ae-17d15c068be4`):** re-running the CLI parsed the already-downloaded DOCX (`retrieval=cached`, so no re-download). The package moved from coverage `partial` to **`api_listed_processed`** and the "unparsed attachment" entry disappeared from `potentialMissingSources`. The template yielded **117 lines / 8,863 characters** of real content (form fields, instructions, entity-type lists, "Total Project Cost", "WCPP funding request"), 0 links, and **1 section**, because this template marks headings such as "I. SUMMARY" with bold text rather than Word heading styles. One converter warning, `An unrecognised element was ignored: w:tblPrEx` (a table-properties element; harmless).
- **Limitations:** the archive-size screen uses sizes the archive *declares*, so a deliberately falsified archive could still be expensive to open (images are never decompressed, which limits this); sections come only from Word heading styles, so documents that use bold text get no structure (the same as the NOFO PDFs; M3 should locate sections from the text); tables are flattened to one line per cell; images, drawings and text in images are dropped. **Not verified:** whether page headers/footers, text boxes, comments or tracked changes in *other* Word files are captured, and no visual comparison with the rendered document was possible.
- **Note on scope:** the guide says to download and register DOCX and parse it only if essential. Parsing was added because you asked for it and it makes the coverage report accurate; the template is a form, not a source of requirements, so M3 should not extract requirements from it.

**Superseded blocker (resolved by your install).** `npm install` failed for two reasons that predate this work: (1) the user-level `~/.npmrc` holds an expired token for `registry.npmjs.org` (HTTP 401); (2) the committed `package-lock.json` pins 470 packages to a private JFrog mirror (`jfrog.accenturefederaldev.com`) that requires credentials, and `node_modules` disagrees with the lockfile for `axios`, `follow-redirects`, `rollup`, `postcss` and `@hono/node-server`, so a plain install tries to re-fetch those from the mirror (401). I tried workarounds that override your npm credentials and registry settings, and an automated safety check blocked the lockfile-rewriting one; I stopped rather than work around it. **Nothing in `package.json`'s dependencies or `package-lock.json` was changed.** To finish: run, with access to the mirror (or after fixing your npm login), `npm install --save-exact pdfjs-dist@6.4.299 cheerio@1.2.0`, then `npm run test:run` (the 9 skipped tests will run) and `npm run nofo:ingest -- <uuid>` for each opportunity (cached PDFs are parsed without re-download).

**Limitations and open items.**
- PDF quality is unverified on real documents (tables, columns, headers/footers). Heading detection is a font-size heuristic.
- HTML adapter drops text that sits directly inside a block that also contains nested blocks.
- Authority classification is a heuristic triage aid; `unclassified` must be treated as non-controlling downstream.
- The client's 429 handling has only been tested against mocks.
- Single-writer CLI: there is no cross-process locking.
- DNS rebinding is not mitigated for downloads (operator-run, no end-user URLs).
- `nofo:find` and `--legacy-id` are not implemented.

### M3 — Requirements extraction (adjusted for Rev 2; otherwise unchanged)

- **Work:** `llm.ts`, `extraction/*`, `citations.ts`, `requirements.json`, `gold.json`, `nofo:eval`.
- **Rev 2 adjustments:** the extractor **consumes the generic M2 package** through `loadPackage(uuid)` and contains no BUILD-specific paths or IDs (same guard test). `requirements.json` and `gold.json` live in the package folder and record `sourceManifestHash`; extraction warns or refuses when the package changed since. Only documents that parsed are used, `controlling` documents take precedence, and `unclassified` documents are never treated as controlling. **Optional cheap cross-check:** compare an extracted max/min award with Simpler's `award_ceiling`/`award_floor` metadata and flag any disagreement as `needs_review` (a signal, never a source).
- **Scope:** eligibility, funding/financial, application-submission and selected readiness requirements. `evaluation` and `post_award` are extracted only as reference, never as assessment targets in the MVP.
- **Acceptance:**
  - **100%** of surviving sources have `verified:true` (by construction). The report lists how many candidate requirements and sources were rejected.
  - Zero requirements without a verified source.
  - Against the human-verified gold set (15–25 manually verified requirements from the actual BUILD documents), the eval script reports **coverage** and **citation accuracy**. Target: all gold items recovered, or each miss explained and fixed. If no gold set exists yet, the milestone report **states that limitation explicitly** rather than substituting model self-assessment.
  - Ambiguous items carry `reviewStatus:'needs_review'` and `mandatory:null`.
  - Re-running extraction is reproducible **from the cache** (no model call when documents, prompt and model are unchanged). *Rev 4 deviation:* current models reject sampling parameters such as temperature, so a fresh run can differ from the last one (verified: recall varied between runs); the multi-pass option and the evaluation script manage that.
  - Tests (mocked LLM): schema rejection, invented document ID rejected, wrong page corrected, unsupported quote dropped, dedupe across chunks, batch boundaries.
- **Critical path:** a human must write or verify the gold set from the actual documents. See §7 R2.

> **Status (Rev 4): implemented, unit-tested, run live on BUILD and Wildlife Crossings; awaiting your review.** The reference set is **drafted by the assistant and is not human-verified**, so the gate's accuracy claim is provisional. Details in the record below.

#### M3 implementation record (Rev 4)

**Entry points (CLI only; no web route).** `npm run nofo:extract -- <uuid> [--refresh] [--include-guidance] [--passes N]` writes `data/opportunities/<uuid>/requirements.json`; `npm run nofo:eval -- <uuid> [--gold <path>] [--min-coverage 0.8]` scores it. `extractRequirements(uuid, options)` is the library entry point. Run `nofo:ingest` first.

**How it works.** (1) Load the M2 package; use only documents that parsed and are `controlling` (guidance only with `--include-guidance`; never `unclassified` or removed ones). (2) Cut each document into bounded, overlapping batches (6 pages or 16,000 characters, 1-page overlap). (3) Send each batch to the model inside a fixed system prompt, with the document text framed as untrusted data and tag-like text neutralized. The model returns JSON through **structured outputs** (`output_config.format`); no forced tool use, and no temperature, thinking or tool parameters are sent. (4) Validate each candidate with Zod, **one item at a time**, so one bad item never discards a batch. (5) **Verify every citation in code** against the stored text: the document must be in the package, the quote must appear on the cited page or section (a wrong page is corrected and flagged; a quote that spans a page break is accepted only if it is on no single page), and quotes under 20 letters/digits are rejected. A candidate with no verifiable source is rejected. (6) A numeric `check` is kept only if its number appears in the verified quote. (7) Merge duplicates conservatively (same category and topic, plus a shared passage, identical title, or identical check; **candidates with different checks never merge**), assign stable IDs, and flag anything doubtful `needs_review`. (8) Cache the result; it is reused when the documents, prompt version, model and pass count are unchanged and the last run was complete.

**Files added** (all under `src/nofo/`): `llm.ts` (injectable model call), `quotes.ts` (quote overlap), `citations.ts` (verification), `util.ts`; `extraction/{schemas,chunker,prompts,check-values,merge,extract,args,cli}.ts`; `eval/{compare,run-eval}.ts`; the reference set `data/fixtures/nofo-gold/4d8f5775-ff01-4a6f-ab4e-b125899043b3.gold.json`; test support `__fixtures__/extraction.ts`; and 12 new test files. **Changed:** `store.ts` (read/write `requirements.json`), `types/index.ts` + `config/config.ts` (optional `ANTHROPIC_EXTRACTION_MODEL`), `.env.example`, `package.json` (scripts), `CLAUDE.md`.

**Model settings.** Default model `claude-sonnet-5` (the configured chat model; override with `ANTHROPIC_EXTRACTION_MODEL`). Effort defaults to `medium` (`ANTHROPIC_EXTRACTION_EFFORT`, or `off`). `medium` cut output tokens about 50% versus the default and removed an output-truncation failure; if output is still cut off, the batch is split in half automatically (up to two levels) instead of losing pages. A one-call smoke test of the model and structured-output mechanism passed before the first extraction.

**Results (live, real documents).** Model `claude-sonnet-5`, effort `medium`, prompt version 4.

| BUILD NOFO (51 pages), final run: 2 passes | |
|---|---|
| Batches | 22 of 22 succeeded (11 per pass), none truncated |
| Tokens | 163,196 in, 83,046 out (about $1.2 at list prices of $2 / $10 per million tokens; an estimate, not a bill) |
| Candidates | 193 proposed; **4 rejected** for having no verifiable source; 85 merged as duplicates; **104 requirements kept** |
| Review status | 81 `unreviewed`, **23 `needs_review`**, 0 `verified` (no human has reviewed any) |
| Evaluation vs. the 25-item reference set | **23 of 25 recovered by an overlapping quote (92%)**; **25 of 25 (100%)** if a requirement on the same page and topic that cites a different sentence also counts. The two strict misses (toll-credit rule, STIP/TIP listing) both have such a same-page, same-topic requirement. |
| Agreement on matched items | category 19 of 25 (the differences are judgment calls such as money rules filed under `funding` rather than `eligibility`); mandatory 24 of 25 |
| **Citation accuracy** | **118 of 118 stored sources re-verified** against the stored document text by an independent pass (the same check run again from the stored file) |
| Reference quotes | 25 of 25 found on their stated pages |

How the numbers moved while I built and tuned it (each row is a real run; the reference set is the same throughout):

| Run | Prompt / passes | Result | Strict coverage |
|---|---|---|---|
| 1 | v1, 1 pass, default effort | 100 kept; **1 batch cut off (pages 11–16), file `partial`** | 19/25 (76%) |
| 2 | v2, 1 pass, medium effort | 84 kept, complete; output tokens halved | 21/25 (84%); 22/25 lenient |
| 3 | v3, 2 passes | 99 kept; fixed the set-aside "checks" | 22/25 (88%); 23/25 lenient |
| 4 | v4, 2 passes, check-aware merging | **104 kept** | **23/25 (92%); 25/25 lenient** |

*Run 1 was first scored with a simpler matcher (first match instead of best match); I did not re-score it with the final one.*

| Wildlife Crossings NOFO (24 pages), 1 pass | |
|---|---|
| Result | 5 of 5 batches; 37 candidates, 0 rejected, 5 merged, **32 requirements kept**; 2 page locations corrected by code; 25 `unreviewed`, 7 `needs_review`; 36,919 tokens in, 15,588 out |
| What it shows | The same code extracted a different program's requirements (for example the 20 percent non-Federal share, State highway agency consultation, no application limit) with **no program-specific code or configuration**. There is **no reference set for it, so no accuracy claim is made**. |
| Cache | A repeat run answered in under a second with **no model call**. |

**Does it cover the demo scenario?** The guide's scenario asks about the federal request, matching funds and a benefit-cost analysis for a capital project. The extraction holds the pieces M4 needs: minimum request checks for rural ($1M) and urban ($5M) capital projects (each citing pages 6 and 15), a $25M maximum (pages 3 and 15), federal-share limits (80 percent urban, 100 percent rural/APP/HDC), four non-federal-match rules, applicant-type rules, a mandatory BCA requirement, seven NEPA items and the submission deadline. **Caveat for M4:** the BCA requirement cites only page 23, has `programVariant` null and is flagged `needs_review`, because the "capital projects only" statement is on page 14 and different batches disagreed. A human should confirm that BCA applies to capital projects only before M4 relies on it.

**Tests and build.** `npm run build` exit 0; `npm run test:run` **290 passed, 0 skipped, 0 failed** (24 files). New tests cover: citation verification (every branch), numeric-check verification, merging, batching, prompt framing and tag neutralization, the model wrapper (exact request parameters), the pipeline with a scripted stand-in for the model (invented IDs, wrong pages, unsupported claims, truncation, refusals, caching, passes, document selection, hostile text), the evaluation logic, and the CLI arguments. The guard test still finds no program-specific strings in `src/nofo`.

**Known limitations and things I observed**

- **The reference set is not human-verified.** I drafted 25 items (26 quotes; all machine-checked to appear on their pages) by reading the NOFO before writing or running the extractor. Selection, categories and mandatory flags still need a person. Status field: `drafted_from_source_pending_human_review`.
- **The prompt was tuned after seeing evaluation results** (version 1 → 4), including a generic line that cost-share and match rules count as funding requirements. The reference set is therefore not a clean held-out test for the final prompt.
- **Recall varies between runs.** Sampling parameters cannot be set on current models. Across live runs the same prompt family recovered different reference items (for example one run caught the toll-credit rule and a later one did not). `--passes 2` takes the union of two independent passes and raised coverage; it costs about twice as much and leaves more near-duplicates.
- **Code verifies that quotes and numbers are real, not what they mean.** An earlier run produced "minimum share for planning projects: $75 million" from an agency set-aside; the number was in the quote, so the number check passed. The prompt now forbids program-wide totals as checks, but **a `check` on an unreviewed requirement must be treated as advisory**; Milestone 4 should apply checks deterministically only for requirements a human has set to `verified`.
- **Near-duplicates remain** when the same requirement is stated in two places with different sentences (for example two entries for the maximum request, on pages 3 and 15). Merging is deliberately conservative: a missed merge costs reviewer time, a wrong merge hides a requirement.
- **Category and "mandatory" are judgment calls.** Minimum-request rules sit under "Eligibility" in the NOFO but are about money; the model files them under `funding`. The evaluation reports these disagreements separately and does not treat them as errors.
- **Scope leakage.** Some candidates come from the merit-criteria and post-award sections (pages 37–51) despite the prompt; they are cited and verified, so they are not wrong, but they are not all applicant-facing.
- **Bugs found and fixed during this milestone** (each has a regression test): (1) citation verification accepted a quote that sat wholly on page N+1 as "spanning" pages N and N+1, silently keeping the wrong page; (2) merging two requirements that cite one sentence stating both an urban and a rural threshold dropped the rural check and mixed their conditions; (3) the CLI dropped the first argument when `--passes` was absent.
- **Not done:** no HTML/Word extraction has been run on a real document (the unit tests cover section citations); no supplemental BUILD documents were added (your Q14 decision); `evaluation` and `post_award` categories are not extracted.


### M4 — Applicant assessment

- **Work:** `facts.ts`, `checks.ts`, `assess.ts`, `questions.ts`, `advisory.ts`, `service.ts`.
- **Acceptance (maps to guide §9):**

| Guide scenario | Test |
|---|---|
| Plausible state DOT + road project | Applicable applicant/project provisions found, with citations |
| Request conflicts with a verified maximum | Deterministic conflict with citation, not a vague warning |
| Matching funds unknown | `unknown` + a targeted question traceable to a requirement |
| BCA unavailable where required | Application-preparation gap with a source |
| Request amount changes | Affected findings recomputed; **no acquisition, ingestion or extraction call** (asserted via mocks) |
| FAQ clarifies the NOFO | Clarification attached to the requirement; both authority levels shown |
| Unverifiable location/ID | Flagged for review; no invented citation (also covered in M3) |
| Supporting doc contradicts NOFO | `needs_specialist_review` with both citations; neither chosen silently |
| Unsupported/inaccessible document | Coverage message; no pretend processing |
| Second valid opportunity UUID | Same generic pipeline, no special-case logic (covered in M2) |
| Opportunity has no API attachments | Metadata preserved; coverage stated as incomplete/unknown (covered in M2) |
| API invalid or rate-limited | Failure handled gracefully, exact status recorded, nothing invented (covered in M2) |

  - The **demo scenario** ($25M project, $18M request, $7M state funds committed, no BCA) is a test with a mocked LLM. It asserts correct arithmetic, the BCA gap, unresolved items left as `unknown`, a cited conflict or support for each consequential conclusion, and the "preliminary" label. Whether the $18M/72% federal share is within FY2026 limits **depends on the real NOFO values, which I haven't seen.** The test fixture is written after the documents are acquired and the requirements verified.
  - Three scenario tests as the guide asks: plausible, conflict, missing information.

> **Status (Rev 5): implemented, unit-tested (413 tests) and run live; awaiting your review.** Two of the guide's scenario rows are **not** met here (see the table). All results are provisional.

#### M4 implementation record (Rev 5)

**Entry points (no web route yet; that is Milestone 5).** `assessTurn(input, deps)` in `src/nofo/service.ts` takes `{opportunityId, messages (1–40, ≤4,000 characters each), facts?}` and returns the new facts (to send back next turn), the arithmetic, findings with evidence, not-applicable items, up to three questions, and the advisory. CLI for trying it: `npm run nofo:assess -- <uuid> --say "<applicant's words>" [--say "..."] [--facts-file facts.json]` (the facts file carries facts between runs).

**How it works.**
1. **Facts come only from the conversation.** The model reads the latest message (plus up to three before it, so "$18 million" keeps the question it answers) and proposes facts. **Code verifies every fact:** its quote must appear in something the *applicant* said (the assistant's words never count), and a dollar value must be in its quote. Anything else is discarded and reported. A client sends the facts back each turn; they are validated strictly (unknown keys, wrong types, absurd amounts are rejected). The newest statement wins.
2. **Arithmetic is plain code.** Total project cost and the federal request are separate facts. Federal share = (request + other federal) / total. Assumptions (such as "no other federal funds, since none were stated") are always shown, and the amounts are checked for consistency ($18M + $7M = $25M).
3. **Routing, per requirement:** optional wording is skipped; a requirement for the wrong project type is *not applicable*; one with a machine-checkable check is evaluated by code; a free-text condition goes to the model; a deliverable still to prepare stays *unknown* on the application checklist.
4. **Deterministic checks** (`checks.ts`): minimum/maximum request, federal-share limit, minimum match, applicant type, and benefit-cost analysis. A missing fact gives `unknown` and names the fact. A limit whose own text describes exceptions gives `needs_specialist_review` rather than a conflict. A missing required deliverable is a `gap`, not a conflict.
5. **Model interpretation** (`interpret.ts`) is deliberately narrow: it sees only the free-text facts (never the money), must cite which facts it used, and **"supported" or "conflict" with no cited fact is downgraded to unknown** in code. Invented or repeated requirement IDs are ignored. Batches of 12 run four at a time. Results are cached in memory by the free-text facts, so changing an amount causes no model call.
6. **Questions** (`questions.ts`): at most three, from fixed templates over the missing fact, each citing the requirement (and its evidence) that makes the answer matter. Ranked by the most consequential requirement waiting on the answer, then a fixed priority order. Questions are only for facts a stated requirement could not be evaluated without.
7. **Advisory** (`advisory.ts`): written by code from the findings. It folds the same issue stated in several places into one item (e.g. "1 preparation gap (across 4 requirements)"), lists next steps, and always carries the disclaimer.

**Statuses.** The guide's four (`supported`, `conflict`, `unknown`, `needs_specialist_review`) plus a boolean `gap` on a `conflict` meaning "a required deliverable does not exist yet", and a `provisional` flag (true unless a human-verified requirement was judged by plain code; **today everything is provisional**).

**Files added** (under `src/nofo/`): `service.ts`, `advisory.ts`, `assessment/{schemas,arithmetic,facts,checks,interpret,assess,questions,args,cli}.ts`; test support `__fixtures__/assessment.ts`; 11 new test files. **Changed:** `package.json` (script `nofo:assess`), `CLAUDE.md`. Nothing in the extraction, ingestion or existing app was changed.

**Guide scenarios (§9) and where they stand**

| Scenario | Status |
|---|---|
| Plausible state DOT and road project: finds the applicable provisions with evidence | **Met** (tests and live) |
| Requested amount conflicts with a verified maximum: cited conflict, not a vague warning | **Met** (tests and live: "$30,000,000 exceeds the $25,000,000 maximum", page 3) |
| Matching funds unknown: asks a targeted question, marks the condition unknown | **Met** for the match rule (asks the cost/match/commitment question, rule stays unknown). In the live run the question is third in line behind the request and urban/rural. |
| BCA unavailable where required: preparation gap with a source | **Met** (live: reported as a gap, with the notice's own page) |
| Request changes: recalculates affected findings without re-ingestion | **Met**: the request changed from $18M to $30M and back with **0 interpretation calls and about 4 seconds per turn** in one process |
| Official FAQ clarifies the NOFO; supporting document contradicts the NOFO | **Not met.** Only controlling documents were extracted (your Q14 decision), so no FAQ exists to assess against. These two rows need supplemental documents and cross-document comparison, and are open. |
| Unverifiable evidence location; unsupported format | Covered earlier (M3 and M2) |

**Live results (real BUILD requirements, real model).** The guide's scenario in two turns. *Turn 1* (project description only): seven facts read, each with a verified quote from my words; a state applicant supported; two project-type items sent to specialist review; **95 of 100 requirements honestly "not yet evaluated"**; three questions (request, benefit-cost analysis, environmental review in that run; the order was later changed to put urban/rural ahead). *Turn 2* ($18 million requested, $7 million state funds committed, no benefit-cost analysis): federal share **72%**, arithmetic consistent; $18M within the $25M maximum (cited); four benefit-cost-analysis requirements reported as one preparation gap; applicant and project-type conditions supported; it then asked whether the project is urban or rural (which decides the minimum: $5M urban or $1M rural), because that fact was still missing. Turn time dropped from about 64 seconds to about 20 once the four interpretation batches ran concurrently. A short correction ("make it $20 million") was applied correctly when sent with its conversation; sent alone, without the question it answers, the model correctly declined to guess what the amount referred to.

**Limitations and things to know**

- **Everything is provisional.** No requirement is human-verified, so no deterministic result can be called settled, and every model judgment is provisional by design. A way for a person to mark requirements `verified` has **not** been built; today it means editing `requirements.json` by hand.
- **Model interpretations vary between runs.** The same facts produced "supported" in one run and "needs specialist review" in another for two project-type items. The in-process cache keeps results stable within a running server, but the CLI starts fresh each time. Nothing is persisted on disk on purpose (no project data is stored).
- **Wrong or missing urban/rural, grant category, or applicant type changes which rules apply.** The assessment never assumes them; it asks.
- **Exceptions are not modeled.** A federal-share limit that has an exception (for example a special area designation) goes to specialist review if exceeded, because the program-specific concept is deliberately not hard-coded.
- **Applicant-type matching is by wording** (for example "state" against "States and the District of Columbia"); a non-match goes to specialist review, never to a conflict.
- **Near-duplicate requirements** from M3 appear as several findings (for example four benefit-cost-analysis items); the advisory folds them, the findings list does not.
- **A deliverable judged by the model** ("level of design stated") can blur "the applicant has this information" with "the application will include it". It is provisional.
- **Match questions come after the more consequential ones** because of the three-question cap.
- **Not built:** an HTTP route and chat integration (M5); document upload; a persistent facts store; cross-document conflict detection.

### M5 — Chat integration and browser demo (adjusted for Rev 2; otherwise unchanged)

- **Work:** `routes/nofo.ts`, `api-server.ts` mount, `chat.html`/`chat.js`/`nofo.js`/`api.js`/`style.css`, `docs/NOFO_DEMO.md`.
- **Rev 2 adjustments:** the selector lists **ingested packages by UUID** (BUILD is the main demo, but nothing is hardcoded); the coverage status and reasons are shown; the source drawer reads page text from `normalized.json`; "open original" uses an allow-listed route that serves the stored original (PDF only, `nosniff`) because API download URLs may be expiring (§3.10).
- **Acceptance:**
  - In a real browser: select opportunity → describe project → answer questions → findings update → citation drawer shows the verified quote and a real source link → correct a fact and see findings change.
  - Existing chat mode still works as before (quick manual regression: a search question).
  - Route tests: validation limits, rate limit, unknown opportunity 404, no stack traces in errors.
  - Honest failure states visible (missing or unsupported document, invalid model output).
  - `tsc` and `test:run` green; limitations documented.
  - **Backup:** a screen recording of a passing run and a rehearsal on the actual demo machine and network.


#### M5 implementation record (Rev 6)

**What was built.** The chat page has two modes. **Search grants** is the original panel, moved into a wrapper and otherwise unchanged. **Assess a project** is new: choose an ingested opportunity, describe the project, answer follow-up questions, read the preliminary assessment, open the source behind a finding, remove a fact. `?mode=nofo&opportunity=<uuid>` deep-links into it.

**API (`src/web/routes/nofo.ts`, mounted at `/api/nofo`).** Read-only over the local packages; nothing fetches from Simpler, parses a document or extracts requirements.

| Route | Purpose |
|---|---|
| `GET /opportunities` | Ingested packages with coverage, document count and a requirements summary; `ready` means requirements exist. |
| `GET /opportunities/:id/documents/:docId/pages/:page` and `.../sections/:section` | The stored text of one page or section, with the title, authority, file name, official URL (http/https only) and whether the original is available. |
| `GET /opportunities/:id/documents/:docId/original` | The stored PDF only, resolved through the manifest, served as `application/pdf` with `nosniff`, a restrictive CSP, `same-origin` resource policy and a server-generated file name; bytes that are not actually a PDF are never served. |
| `POST /assess` | One `assessTurn`. Its own rate limit (default 10/min, the chat env vars); reads have a separate, higher limit. 503 when no model key is configured. |

Strict validation (UUID, document-ID pattern, numeric page, section pattern), generic error messages (no paths, stack traces or CLI commands), and no logging of message text or facts (tested). `src/nofo/sources.ts` holds the read helpers; `AssessmentError` gained a `code` so the route can return 400 or 404, and `assessTurn` gained an optional `readMessage: false` (re-assess the given facts without reading the message again), used when a fact is removed or the opportunity is switched.

**Frontend (additive only; `common.js`, `chat.js` and `api.js` untouched).** `public/js/nofo-util.js` (pure helpers, unit-tested), `public/js/nofo.js` (DOM code; every string from the server or user is set with `textContent`), additive CSS, and `chat.html` markup. Facts are shown as chips with the user's own quote and a Remove button. Findings are cards with status badges (a missing deliverable is a *preparation gap*, never a *conflict*), a **Provisional** tag, the quoted passage and a source drawer (focus trap, Esc, focus returns). The drawer highlights the quote in the stored page by matching letters and digits the way the server verifies quotes, and says so if it cannot find it. Unknown requirements are collapsed and labelled "unknown is not a pass or a fail". The conversation window sent is the last 12 messages, and the assistant turn kept in it includes the questions asked, so a short answer keeps its context. After a fact is removed, earlier messages are no longer sent, so the removed statement is not read again.

**Verification.**
- **Automated:** 31 route tests (listing, page/section text, original-PDF headers and refusals, path traversal, validation, rate limiting, 503/404 messages, no logging of message text), 13 tests for the browser helpers (loaded into a VM the way a page loads them). Suite: **457 tests pass** (413 before), `npm run build` clean.
- **Real browser:** a Chrome DevTools Protocol script (not committed; no new dependency) drove headless Chromium against the built server and the live BUILD requirements with real model calls: default mode unchanged, deep link, opportunity info, Enter-to-send, both turns of the demo scenario, facts with quotes, federal share 72%, BCA as a preparation gap, source drawer with highlighted quote, the original PDF served as a PDF, Esc and focus return, fact removal, switching to Wildlife Crossings with the same facts, no horizontal overflow at 390 px, back to search mode. 30 checks; all passed except the console-error check, whose only entry was a pre-existing missing `/favicon.ico` (404). Turns took about 24 seconds each.
- **Bug found by the browser run, fixed:** the deep link did not preselect the opportunity because the address bar was rewritten before the link was read. The link is now read once at start-up.

**Not done / limitations** (also in `docs/NOFO_DEMO.md`): not exercised in Safari or Firefox, with a screen reader, or on a real phone; the "send a search question" regression was checked structurally (the original form and panel are present and enabled) but not by sending a live search message; the screen recording and rehearsal on the demo machine are yours to do; the FAQ and contradiction scenarios still need supplemental documents; nothing can be marked `verified` from the screen; the conversation is lost on reload.

---

## 6. Testing strategy

| Layer | How |
|---|---|
| Unit (default `npm run test:run`) | **M2:** client, UUID validation, download safeguards, adapters, classification, coverage, caching (full list in §5 M2). Later: normalization, citation verification, checks, fact merge, question ranking, ID/path validation, response-token resolution. **Inject `fetch`; mock `getAnthropicClient`**; no network in the default suite. |
| Fixtures | Tiny **synthetic** PDF and HTML fixtures with known text, and API-response fixtures shaped from the verified OpenAPI schema. Labeled synthetic. Never fabricate "official" text and present it as real. |
| Live acquisition checks | Manual, with a real key: two opportunities, re-run for cache, three source-reference spot-checks each (M2 protocol). Recorded in this plan. Not part of `npm test`. |
| Route tests | Express app + a small HTTP helper (see `project-discovery`'s `src/web/test-http.ts` for a pattern; we write our own, as the branch is not merged). |
| Gold-set evaluation | `npm run nofo:eval` (manual, real data): coverage, unsupported claims, citation correctness, reviewer corrections count. |
| LLM smoke | One real call each for fact extraction, assessment and advisory against the demo scenario, run by hand before rehearsals. |
| Browser | Manual run of the full flow; the guide's checkpoint is the real browser, not just API responses. |

For the mission-impact benchmark in guide §10: record actual time-to-requirements with and without the tool on a small sample. **Do not report hypothetical savings as results.**

---

## 7. Risks and mitigations (ranked)

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | **Supplemental official sources are not reachable by automation, and BUILD's API package is only the NOFO.** *(Rev 2.1: the API key is in hand and works.)* The agency page (BUILD landing page) returned **403** to automation. FAQs, checklists or amendments for BUILD would have to be downloaded manually. | High / medium (core demo needs only the NOFO; the FAQ scenarios need more) | Supplemental sources accept manual files (`manual_file`, with sha256), kept at M2 P1. Coverage honestly reads `api_listed_processed` with its completeness note. You decide whether to add FAQs (Q14). If a live run is blocked, **document the blocker, don't claim a pass.** |
| R2 | **No human-verified reference set → extraction accuracy cannot be fully validated**; this is the guide's "central technical risk". *(Rev 4: partly mitigated.)* | High / blocks a *confirmed* M3 gate | A 25-item reference set now exists, but **I drafted it from the source text; a person must verify it** (`verifiedBy` is null). Citations are verified by code regardless, so the open risk is selection, category and wording judgments, not invented evidence. |
| R3 | **PDF text extraction quality** (multi-column layout, tables, headers/footers, hyphenation, footnotes) breaks quote matching and headings. | Medium / high | Test on the real NOFO early in M2. Shared `normalize()`. Fuzzy-match fallback. Heading detection falls back to page-only citations. |
| R4 | **Conditional applicability** (capital vs planning; urban vs rural; thresholds differing by category) produces wrong findings if flattened. | Medium / high | `programVariant` and the `grantCategory`/`areaType` facts are first-class. If the category is unknown, the finding is `unknown` and a question is asked. |
| R5 | **Schedule: 7 working days, 4 milestones, no float, and M2 is larger in Rev 2.** | High / high | Strict gates and the revised cut list (§8). P0/P1/P2 inside M2. Parallelize the gold set. Freeze on 11/12. |
| R6 | **LLM nondeterminism and latency at demo time.** Three sequential calls per turn could feel slow or fail on stage. | Medium / high | Temperature 0, cached extraction, in-memory response cache for the rehearsed scenario, visible progress state, backup recording, rehearsal on the demo machine. The demo needs **no Simpler key or network** (packages are on disk). |
| R7 | **Hallucinated requirements or facts.** | Medium / high | Citation verification, user-quote verification, Zod, "reject, don't repair" for unsupported items, gold-set eval. |
| R8 | **Model ID / gateway problems** (previous incident in `doc/plan_1.md`). | Low-Medium / high | M3 begins with a one-call smoke test against the configured model and gateway. |
| R9 | **New dependency issues** (Node floor, transitive vulns, license). | Low / medium | Exact-pin, audit, dynamic import in the CLI only. |
| R10 | **Stale `dist/`, broken `data/` zip, tracked `.data/` file, pre-existing high-severity advisories** could cause confusing demo-day behavior. | Medium / medium | Clean build at the start of M2; housekeeping decisions in §9 Q6. |
| R11 | **Scope creep** from the other branch or from "nice" features (a discovery UI, an ingest route). | Medium / high | §8 list. Each milestone reviewed before the next. |
| R12 | **`download_path` form.** *(Rev 2.1: largely resolved.)* All 12 observed attachments were public, unsigned `https` URLs on `files.simpler.grants.gov` that need no key. The API does not promise this. | Low / medium | Keep the presigned and relative-path handling and the strip-query rule. Store originals locally and plan durable links through our own copy (§3.10). Never send the key to the files host. |
| R13 | **BUILD availability in Simpler.** *(Rev 2.1: resolved for BUILD.)* It exists (archived), is retrievable by UUID, and has the NOFO PDF attached. The second opportunity could still differ in unexpected ways. | Low / medium | The three candidates in §3.11 cover a PDF+DOCX mix, a multi-PDF Q&A set and a zero-attachment case. Do not invent coverage. |
| R14 | **Misclassified authority** (a form treated as the NOFO, or an amendment missed) leads to citing the wrong document as controlling. | Medium / high | Conservative heuristic with `unclassified` as the default, manual overrides, M3/M4 never treat `unclassified` as controlling, and coverage is `partial` if no controlling document parsed. |
| R15 | **Documents change after extraction** (amendments, replaced attachments). | Low-Medium / medium | Manifest records `updated_at` and sha256; `sourceManifestHash` marks `requirements.json` stale; `removed_upstream` entries are kept. |
| R16 | **Simpler API changes** ("in active development"). | Low / medium | Zod validates the fields we rely on and fails loudly with the status and a clear message; the spec snapshot is re-checked at M2 start. |
| R17 | **Dependency installs fail in this repo** (Rev 3, verified). An expired `~/.npmrc` token causes HTTP 401 against the public registry, and the committed lockfile pins 470 packages to a private JFrog mirror, with `node_modules` out of sync with it. Anyone without mirror access cannot run `npm ci` or add a package. | High / blocks M2 gate and any new dependency | The user installs the two pinned packages with working credentials (command in the M2 record). Longer term, decide how the lockfile should be handled (separate decision; not changed here). |

---

## 8. Recommendations to simplify the MVP

1. **No multi-agent orchestration for NOFO mode.** The workflow is sequential. A single route calling `service.assessTurn()` is easier to test and demo than classify → retrieve → draft. The existing agents stay untouched for the search mode.
2. **Do not merge `project-discovery`.** It adds sessions, cookies, project CRUD and a separate UI, all of which the guide excludes. Facts live in the conversation and a client-held `facts` object. We may copy its Vitest setup pattern.
3. **Packages on disk are the registry** (Rev 2, replacing "hardcode a one-entry registry"). No opportunity is hardcoded anywhere. The selector in M5 reads whatever has been ingested.
4. **CLI-only ingestion; no ingestion web route and no new discovery UI.** Direct UUID input is the required path. The search helper and legacy-ID resolver are P2 and only exist to find UUIDs.
5. **Process PDF and thin HTML; register everything else.** XLSX/DOCX/ZIP/GIS are downloaded, hashed and marked `unsupported_format`. No parsing, no extraction, no OCR (the guide allows "identify that it's required").
6. **Never say "complete".** Coverage is `none`, `partial` or `api_listed_processed`, with reasons.
7. **Restrict deterministic checks to ~6 kinds** (§3.4). The rest stays LLM-judged or `needs_specialist_review`.
8. **Extract only the four in-scope categories.** Aim for roughly the 40–80 requirements that matter to the demo path rather than exhaustive coverage.
9. **No streaming, no websockets, no persistence beyond JSON files.**
10. **Optional stretch (only after M5 is green):** expose `assess_project_against_nofo` as a read-only MCP tool through `tool-schemas.ts`/`tool-executor.ts`. It is cheap because of the `service.ts` facade, but it is not needed for the demo and widens the tool surface.

**Cut list if we fall behind (cut in this order).** *Revised in Rev 2: the Rev 1 first cut, "HTML ingestion", is now part of the guide's M2 gate, so it moves to "keep it thin".*

1. `nofo:find` search helper and `--legacy-id` resolver (M2 P2)
2. Curated supplemental URL fetching (keep manual local files only) (M2 P1)
3. Cross-document conflict detection (keep it as a documented limitation)
4. LLM interpretation of non-deterministic requirements (list them as "needs review" instead)
5. Editable facts chips (keep read-only)
6. Source drawer original-PDF link (fall back to plain text citations with page numbers)

**Never cut:** citation verification, `unknown` semantics, honest coverage reporting, the "second real opportunity through the same pipeline" gate, and the "preliminary" labeling.

---

## 9. Decisions and questions for you

**Superseded by Rev 2**

- ~~Q1: which documents make up the curated BUILD package~~: the pipeline now discovers a package's documents from Simpler.Grants.gov by UUID. Manual files remain a fallback (see Q14).

**Decisions recorded in Rev 3**

- **Q12, second opportunity: approved.** Use the Wildlife Crossings Pilot Program (`41eb2492-6242-49f8-89ae-17d15c068be4`) as the second integration test. It is accessible through Simpler.Grants.gov (verified live: opportunity and both attachments). It exists to prove ingestion works across opportunities without program-specific logic. Had it been unavailable, another real opportunity would have been chosen and the reason documented.
- **Q14, supplemental BUILD documents: not yet.** M2 focuses on automatic retrieval and processing through Simpler.Grants.gov. The design supports later manual additions and official URLs (`supplemental.json`, implemented and tested but unused), and potential missing sources are recorded in each manifest. BUILD FAQs, checklists and amendments will be added in M3 if needed.
- **Q13, package commit policy: decided.** Support an offline demo with validated, reproducible fixtures and selected demo documents. Commit small stable fixtures and manifests, and source documents only where appropriate and practical. Do not automatically commit downloaded caches, credentials, temporary files, oversized artifacts or unnecessary API responses. Live ingestion still supports arbitrary valid UUIDs. Implemented as described in §3.2 (`data/opportunities/` ignored; deliberate `git add -f` for demo packages).
- **Q15, `CLAUDE.md`: updated** to the generic Simpler.Grants.gov ingestion scope, concise, referencing the guide and this plan.

**New in Rev 2**

11. ~~**Simpler.Grants.gov API key.**~~ **Resolved (Rev 2.1).** You supplied a key; it works. I stored it in your **gitignored** `.env` as `SIMPLER_GRANTS_API_KEY` (tell me if you prefer another name). Because it was pasted into this chat session, consider rotating it after the demo, or sooner if the session transcript is shared.
12. ~~**Second opportunity: please confirm.**~~ **Resolved in Rev 3 (approved; see above).** *Original text:* BUILD's UUID is found (`4d8f5775-ff01-4a6f-ab4e-b125899043b3`). I recommend **FHWA-WCPP-26-002**, Fiscal Year 2026 Wildlife Crossings Pilot Program (`41eb2492-6242-49f8-89ae-17d15c068be4`): PDF NOFO plus a DOCX template, so it tests both parsing and honest "unsupported format" reporting. Optional extra live checks: the zero-attachment `FR-RLD-26-001` and the four-PDF NHTSA ITSE opportunity (§3.11). Do you want a different one?
13. ~~**Package commit policy.**~~ **Resolved in Rev 3 (see above).** *Original text:* Should `data/opportunities/<uuid>/` for the two test opportunities be committed so the demo runs offline? They are public documents. My default: commit manifests and normalized JSON, and commit originals only if the total stays under about 25 MB. Otherwise gitignore the originals and keep their checksums in the manifest.
14. ~~**Supplemental BUILD documents.**~~ **Resolved in Rev 3 (not yet; see above).** *Original text:* BUILD's Simpler package contains **only the NOFO PDF**. Do you want official FAQs, checklists or amendments added as curated supplemental sources? They would need to be downloaded manually (the agency site returns 403 to automation) and would go in through `supplemental.json` as `manual_file`, with recorded checksums. They are needed for the guide's "FAQ clarifies the NOFO" and "supporting document contradicts the NOFO" scenarios, but not for the core demo.
15. ~~**`CLAUDE.md`.**~~ **Resolved in Rev 3 (updated).** *Original text:* It predates Rev 2 (§2.4 #8). Do you want it updated to the new scope (UUID-based opportunity, minimal ID/search adapter allowed, HTML plus registered formats)? I have left it untouched.

**Still open from Rev 1**

3. **Demo scope within BUILD.** I assume the demo is a **capital grant**, with area type (urban/rural) treated as unknown until asked. Please confirm, since thresholds may differ by category.
4. **Model.** Add an optional `ANTHROPIC_EXTRACTION_MODEL` so the offline extraction can use a stronger model than the chat default? Is the `ANTHROPIC_BASE_URL` gateway in use for this work?
5. **Node floor.** OK to require Node ≥ 22.13 for the offline ingest CLI only (dev machine is v24.11.1; the runtime server is unaffected)?
6. **Housekeeping**, as separate small commits or left alone: rebuild `dist/`, untrack and ignore `.data/projects.json`, run `npm audit fix` for the existing advisories, remove or replace the invalid `data/*.zip`.
8. **Gold set.** Who verifies 15–25 requirements against the real documents, and by when (target 11/6–11/9)?
9. **Hosting.** Assume a local laptop demo (no deployment architecture)? If deployed, the Node 18 Dockerfile example in `doc/DEPLOYMENT.md` is outdated for our needs.
10. **Branch name.** Stay on `nofo`, or rename to the guide's `feature/nofo-advisor-mvp`?

*(Rev 1's Q2 "commit raw PDFs" is folded into Q13; Q7 "add `CLAUDE.md`" is resolved, and Q15 covers its update.)*

---

## 10. Acceptance criteria

**Milestone 1 (Rev 1)**

- [x] Entire guide read; scope, exclusions and acceptance scenario captured.
- [x] Codebase audited: Express routes, MCP tools, Anthropic integration, chat pipeline, `chat.html`/`chat.js`/`common.js`, storage and cache, config, tests, docs, git branches.
- [x] Current implementation compared with the guide's target architecture (§2.3).
- [x] Reusable functionality and the minimum new components identified (§2.2, §3.3).
- [x] Architecture proposed for ingestion, requirements extraction, assessment and advisory (§3).
- [x] Challenges, dependencies and unnecessary complexity identified (§4, §7, §8).
- [x] Files, dependencies, milestones, testing strategy and acceptance criteria documented (§3.3, §4, §5, §6).

**Rev 2 (this revision)**

- [x] Updated guide read; the change to M2 (generic Simpler.Grants.gov acquisition) identified and everything else preserved.
- [x] Simpler.Grants.gov API contract checked against the official OpenAPI spec; verified and unverified items separated (§3.11).
- [x] **Rev 2.1:** Step 0 live checks done with the supplied key. BUILD located, its attachment and download behavior verified, and second-opportunity candidates identified (§3.11). The key is stored only in the gitignored `.env`.
- [x] Plan revised: data layout, modules, types, API, security, frontend, dependencies, M2/M3/M5, calendar, tests, risks, cut list, questions.
- [x] **No application code modified.** Only `docs/NOFO_MVP_PLAN.md` changed.
- [x] Revised Milestone 2 approved, with decisions Q12–Q15 recorded (Rev 3).

**Rev 3 (Milestone 2 implementation)**

- [x] Generic, tested acquisition and ingestion pipeline implemented; no program-specific code (guard test); CLI entry point; docs and `CLAUDE.md` updated.
- [x] Live acquisition verified on FY2026 BUILD, Wildlife Crossings and a zero-attachment opportunity.
- [x] **PDF parsing verified on real documents** (Rev 3.1: BUILD 51 pages, Wildlife Crossings 24 pages, page addressing confirmed against printed TOCs and quote spot-checks). The HTML adapter is verified by unit tests only: neither real opportunity attaches an HTML document. R17 resolved by the install (lockfile change awaits your review).
- [x] **Rev 3.2:** Word (.docx) adapter added and verified live on the Wildlife Crossings template (179 tests, 0 skipped; coverage now `api_listed_processed`).
- [ ] Optional, open: visual page-render comparison (needs a PDF renderer) and exact-pinning of `pdfjs-dist`, `cheerio` and `mammoth`.

**Rev 4 (Milestone 3)**

- [x] Extraction service built on the generic M2 package (no BUILD-specific paths or IDs; guard test green); runs on BUILD and Wildlife Crossings.
- [x] Zod-validated requirements with category, description, mandatory/conditional status, applicability, evidence needed and sources; cached as `requirements.json` with review statuses.
- [x] Citations validated against ingested content in code: invented document IDs, nonexistent locations and unsupported quotes are rejected (118 of 118 stored sources re-verify; 4 candidates rejected on the final BUILD run).
- [x] Unit tests plus an evaluation fixture of 25 reference requirements from the actual BUILD NOFO; 290 tests pass.
- [ ] **A human verifies the reference set**, and reviews the 23 `needs_review` BUILD requirements (and the BCA applicability).
- [x] Milestone 3 reviewed and committed (`2971c6e`); Milestone 4 started at your request.

- [ ] **Your review of Milestone 2**, and approval before any Milestone 3 work.

### Not verified

- The Simpler.Grants.gov API: 429/rate-limit behavior, whether `download_path` is always a public unsigned URL, and the human-facing page URL pattern. (Rev 2.1 verified with a key: auth, BUILD's presence and status, attachment listing, download behavior, the legacy-ID lookup and the status enum.)
- **The contents of the FY2026 BUILD NOFO.** I downloaded the PDF (718,157 bytes, `%PDF-1.7`) but have not parsed or read it, so its text quality, layout, thresholds and deadlines are unverified.
- Runtime behavior: I did not start the server, call the Anthropic API, or exercise the existing search/chat in a browser. The latency figures are estimates from call counts.
- The `@anthropic-ai/sdk` `helpers/zod` compatibility with Zod 3.25.76.
- Whether the configured model ID and gateway currently work.
- The 60/min and 10,000/day rate limit and the Login.gov/PIV key process come from the developer page as summarized by WebFetch.

### Files and sources inspected

`NOFO_MVP_CLAUDE_CODE_IMPLEMENTATION_GUIDE.md` (original and the `583c2e3` update, diffed), `CLAUDE.md`, `package.json`, `tsconfig.json`, `.gitignore`, `.env.example` and the variable *names* in `.env` (values not read), `src/web/*`, `src/web/chat/*`, `src/mcp/*`, `src/server.ts`, `src/clients/*`, `src/config/config.ts`, `src/utils/validators.ts`, `src/types/index.ts`, `src/cache/cache-manager.ts`, `src/data/*`, `src/tools/search-grants.ts`, `public/chat.html`, `public/js/{chat,api,common}.js`, `public/css/style.css`, `README.md`, `doc/*`, git history and the `project-discovery` branch, the stale `dist/` tree, `.data/projects.json` (structure only), the Simpler.Grants.gov OpenAPI spec (`https://api.simpler.grants.gov/openapi.json`) and developer page (`https://simpler.grants.gov/developers`).

**Rev 5 (Milestone 4)**

- [x] Assessment service built on the validated M3 requirements: facts from conversation (verified against the applicant's words), deterministic numeric checks, narrow model interpretation, ranked follow-up questions, code-written advisory; no separate project-profile interface; no definitive eligibility determinations.
- [x] Three scenarios tested (plausible, verified conflict, missing information), plus the checkpoint: changing a fact changes the affected findings without reprocessing the notice, and missing information is `unknown`, never a pass or fail. 413 tests pass.
- [ ] **Open:** the FAQ-clarifies-the-notice and supporting-document-contradicts-the-notice scenarios (need supplemental documents and cross-document comparison).
- [ ] **Open:** a human verifies the M3 reference set and reviews flagged requirements; a way to mark requirements `verified`.
- [ ] **Your review of Milestone 4**, and approval before any Milestone 5 work. Nothing from M5 has been started.

**Rev 6 (Milestone 5)**

- [x] Assessment services integrated into `chat.html`: select an ingested opportunity by UUID, describe a project, answer follow-up questions, see findings, gaps, source references and next steps; existing chat preserved; no framework, no separate app.
- [x] Route tests and helper tests; **457 tests pass**; `npm run build` clean.
- [x] Full workflow exercised in a real browser against the live BUILD requirements (see the M5 implementation record).
- [x] Limitations documented in `docs/NOFO_DEMO.md` and the M5 record.
- [ ] **Open:** a live search message sent in the browser (regression), other browsers, accessibility with a screen reader, the screen recording and a rehearsal on the demo machine.
- [ ] **Open (carried over):** human verification of the M3 reference set and flagged requirements; a way to mark requirements `verified`; the FAQ and contradiction scenarios.
- [ ] **Your review of Milestone 5.** Nothing beyond M5 has been started.
