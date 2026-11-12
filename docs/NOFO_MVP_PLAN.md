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

---

## 11. Milestone 6: project-description-first "Find grants" flow (Phases A, B and C implemented; tests for C and the progress display not yet run)

**Scope change (you decided, 2026-11-04).** Discovery and a web ingestion route were out of scope in the guide and `CLAUDE.md`; both documents are amended. The prepare route (Phase C) runs the existing ingest and extract CLIs as child processes so parsing stays out of the web-server process. A new "Find grants" tab is first and the default; Assess and the old SAM.gov chat tabs stay.

**Phase A: filters and search, done (checkpoint).** No UI, route or prepare route yet.

*Live probe of `POST /v1/opportunities/search` (read-only, 2026-11-04).* What it showed, and what the code does about it:

| Finding | Consequence |
|---|---|
| Only **11** DOT opportunities were open (posted 9, forecasted 2). All DOT records: 1,502. | Pulling every open DOT listing is one cheap call and is always done. |
| `query: "bridge"` returned **0** of the 11 open DOT listings. | A keyword-only search misses broad programs. Keywords run next to the broad pull, and ranking decides. |
| `applicant_type: state_governments` cut a historical DOT result set from 307 to 89, and every RAISE/BUILD record lists applicant type `other`. | Applicant type is **scored, never filtered**. The `SearchRequestBody` type does not allow it. |
| `funding_category` is unreliable (crash-data NOFO tagged `arts`; 7 of 11 open DOT listings tagged `transportation`). | A small score nudge, and a filter only in the cross-agency widening pass. |
| `query` over 100 characters returns HTTP 422. `page_size` 100 works. `|` and quoted phrases work; `query_operator` OR/AND both accepted. | Queries are built in code, capped at 100 characters, phrases quoted. |
| Open sub-agency codes seen: `DOT-FHWA`, `DOT-FRA`, `DOT-NHTSA`, `DOT-FMCSA`, `DOT-FAA-*`, `DOT-DOT X-50`. `top_level_agency: DOT` matches all. | `top_level_agency` is the agency anchor. |
| The FY2026 BUILD record is about 91st of the 100 newest closed/archived DOT records, and the generic word "infrastructure" matched aviation, rail and port programs as well as it matched BUILD. | Historical mode pulls 100 newest plus a keyword search. Ranking penalizes programs for a different mode (aviation, rail, port, transit, bike/ped, wildlife) than the project's. |

*Built:* `SimplerGrantsClient.postJson` (same host guard, redirects, retries, size cap as GET); `src/nofo/simpler/search.ts` (narrow request type, per-item response parsing); `src/nofo/discovery/` (`profile.ts`, `filters.ts`, `search.ts`, `rank.ts`, `service.ts`, `cli.ts`, `default-source.ts`); `npm run nofo:find`. Fixtures: `data/fixtures/simpler-search-dot-open.json` (36 KB) and `simpler-search-dot-historical.json` (44 KB), trimmed real responses (text cut to 400 characters, contact fields removed).

*Question policy, enforced in code:* one required question only on the first message and only if no project type is found; otherwise search at once with up to two optional refinements; none from the third message on; "Show grants now" never asks. A list is always returned. (Superseded by the guided questions described at the end of this section: questions now come before the first search.)

*Live results (real API + model):* a Virginia DOT bridge project with `--historical` returns the Competitive Highway Bridge Program, the Type 3 Highway Bridge program, a PROTECT program, **FY 2026 National Infrastructure Investments (BUILD)** and a rail-bridge restoration. A county wildlife overpass returns the FY2026 Wildlife Crossings Pilot Program first ("closes in 11 days"). A vague first message asks one question.

*Tests:* 526 pass (95 new across `simpler/search`, `discovery/filters|profile|rank|service`); `npm run build` clean. The `generic.guard` test caught program names in my code comments; reworded.

*Limitations found so far:* ranking quality on broad programs depends on terms the applicant used and on a small vocabulary map (`TYPE_TERMS`, `TYPE_PATTERNS`); BUILD ranks below mode-specific bridge programs for a bridge project, which is intended but means it can drop out of the top five when many bridge programs exist; the human-facing opportunity page URL is still unverified (cards use the listing's own `additional_info_url` only); rate limit (60/min) not observed in practice.

*Not started:* Phase C (prepare route).

**Phase B: route and UI, done.**

- `POST /api/nofo/discover` in `src/web/routes/nofo.ts`: strict Zod input (1-6 user messages, 4,000 characters each), its own rate limiter on the `CHAT_RATE_LIMIT_*` variables, `no-store`, generic errors (503 when `SIMPLER_GRANTS_API_KEY` is missing, retryable 502 when every search fails), no applicant text in logs. A missing Anthropic key is not an error: the keyword reader runs and the response carries a warning. The route adds `readyToAssess` to each shortlist item by checking the local package store.
- UI: a **Find grants** tab on `chat.html`, first and default; **Assess a project** second; the original chat is third, relabelled "Ask about grants" so it is not confused with Find grants. New files `public/js/discover.js` and `public/js/discover-util.js` (pure helpers); `nofo.js` changed only in its mode switch (three modes, `?mode=` absent for the default) and a small `window.NofoApp.openAssess(uuid)` hook so a card opens the Assess tab without a reload. `common.js`, `chat.js` and `api.js` are untouched.
- Cards show status and match badges, plain facts (missing values are said to be missing), "why it may fit" and "watch out for" lines, an official-page link only if the listing has an http(s) one, and either **Assess my project against this** (package already prepared on this server) or the two operator commands. A "How the list was built" disclosure lists every search that ran.
- Tests: 546 pass (20 new in this phase: 9 route, 11 helper); `npm run build` clean.
- **Browser check (headless Chromium, live Simpler.Grants.gov and Anthropic, real server): 30 of 30 checks passed**, covering default tab, the one-question flow, "Show grants now", the VDOT bridge list with BUILD in historical mode, toggling historical, the Wildlife Crossings list and the handoff into the Assess tab with the opportunity preselected, deep links, the original chat tab, typed HTML shown as text and never run, no horizontal scroll at 390 px, and no console errors. Two defects found in screenshots and fixed: the summary was shown twice, and the thread area clipped text on a phone.
- Limitations: a match on only the generic word "infrastructure" is still labelled "Matches your project words" (the reason line says which word matched; this is what lets broad programs such as BUILD appear, and it also lets an unrelated program through occasionally); the conversation is lost on reload; other browsers and a screen reader were not tested.

**Live progress, added after Phase B (you asked for animated progress).** `POST /api/nofo/discover?stream=1` streams one JSON line per step as the code really does it (reading the description, building the search with its words, each request to Simpler.Grants.gov with real counts, scoring), then a final result or error line; the plain call is unchanged. The page shows a spinner, a sliding bar, a step list and an elapsed timer, and honours `prefers-reduced-motion`. Bad input still gets a normal 400 before any stream starts. Progress lines carry labels, counts and search words, never the applicant's own text. Checked in headless Chromium against the live APIs (26 of 26 checks) before the Phase C work; the unit and route tests for it were written but were **not run after the last edits** (you said you would run tests yourself).

**Phase C: prepare route and button, implemented.**

- `POST /api/nofo/prepare {opportunityId}` and `GET /api/nofo/prepare/:id` in `src/web/routes/nofo.ts`. A job is ingest, then extract, run by `src/nofo/prepare/runner.ts` as **child processes of the existing CLIs** (the compiled `.js` if built, else the `.ts` through tsx), with a fixed command line and no shell. The UUID is validated again inside the runner. Only the CLI's own `Error:` line (at most 300 characters) is ever passed back; other output is discarded. Timeouts: 5 minutes for ingest and 20 for extract (`PREPARE_INGEST_TIMEOUT_MS`, `PREPARE_EXTRACT_TIMEOUT_MS`). `--refresh` is not reachable from the web.
- `src/nofo/prepare/manager.ts` holds the safeguards: only an opportunity the server showed in a recent search is accepted (`recent.ts`, six hours, 500 entries), except one that is already prepared, which returns "ready" at once and needs no keys; one job at a time (429, retryable); the same opportunity twice returns the running job; a daily cap on jobs that actually run (`PREPARE_DAILY_LIMIT`, default 5, resets at UTC midnight, 429 not retryable); a missing key is a 503 before anything runs. Job state is in memory, but "ready" is always re-derived from the files on disk. An extract exit code of 3 (partial) is shown as ready with a warning.
- UI: a card for an opportunity that is not prepared shows **Prepare this opportunity for assessment** with a plain explanation of the time and cost, then a live view (spinner, two stages, elapsed time, polling every 3 seconds) that becomes **Assess my project against this** when the job is ready, or an error with **Try again** when it fails. The two operator commands remain under "Prefer to do it by hand?". A new search shows a job that is already running instead of the button.
- **Not verified:** none of Phase C has been run. No tests were run (new files `recent.test.ts`, `runner.test.ts`, `manager.test.ts`, `nofo.prepare.test.ts`, and additions to `discover-util.test.ts`); the build was not run; no real ingest and extract was started from the browser, so the real extraction time and cost through this path are unknown.

**Inspecting the Simpler.Grants.gov traffic (you asked to see the raw response).** A new checkbox, "Show the raw Simpler.Grants.gov requests and responses", sends `inspect: true` with the search. The result then carries `inspection`: for every search, the exact JSON body POSTed, the response body exactly as received, the timing, the record counts and whether a recent result was reused. The page shows each search as a collapsible block with Copy and Download buttons, a "Download everything (JSON)" button, and, on every result card, that listing's raw record as it arrived. The API key is a header and is never recorded in what is returned. It is off by default because the historical pull alone is about 100 listings; raw bodies are kept in the in-memory search cache only for inspected runs, and an inspected run refetches when the cached answer has no raw body. Tests were written (`service.test.ts`, `nofo.discover.test.ts`, `discover-util.test.ts`) but **not run**; the browser was not used to check this change.

**Opportunity page link (you asked for result titles to link to Simpler.Grants.gov).** The public page pattern, open for the first time, is now **verified**: `https://simpler.grants.gov/opportunity/<uuid>` returned HTTP 200 with the page title "Opportunity Listing - FY 2026 National Infrastructure Investments" and "Opportunity Listing - Fiscal Year 2026 Wildlife Crossings Pilot Program" for the two real opportunities tried, and a 404 "Page Not Found" for an unknown ID (2026-11-05). This closes the "human-facing opportunity page URL" item in the earlier list of unverified facts. The server builds the link from the validated UUID only (`src/nofo/simpler/urls.ts`, one named constant), puts it on each shortlist entry as `simplerUrl`, and the card title is a link that opens in a new tab with `rel="noopener noreferrer"`. The program's own page (`additional_info_url`) is still shown separately as "More information from the program". The new tests (`urls.test.ts`, one in `rank.test.ts`) were written but **not run**.

**Live progress on the Assess tab (you asked for the same progress messages and animation as grant search).** `POST /api/nofo/assess?stream=1` streams one JSON line per step as the assessment really runs, then the result (the plain call is unchanged). Steps: loading the requirements (with the real count and title); sending your message to the model to read facts (and how many new facts, and how many proposed facts were discarded for not matching your own words); applying the notice's exact rules (how many requirements do not apply, are optional wording, or need the model); interpreting free-text conditions with the model, with a live "N of M batches done"; and building the findings and follow-up questions. The same spinner, sliding bar, step list and elapsed timer as Find grants; `prefers-reduced-motion` is honoured. Bad input, an opportunity with no extracted requirements, and a missing key are refused with their normal HTTP statuses before any stream starts. Progress lines carry labels and counts, never the applicant's words. Code: `src/nofo/progress.ts` (the shared event type, also used by discovery), `onProgress` in `assess()` and `assessTurn()`, a shared `streamLines` helper in `src/web/routes/nofo.ts` (now also used by `/discover`), and `public/js/progress-panel.js`, a shared panel and stream reader used by `nofo.js`. `discover.js` still has its own copy of the panel code; moving it onto `progress-panel.js` is a small follow-up. The Prepare button already had its own animated stages inside each card. New tests (`service.test.ts`, `nofo.assess-stream.test.ts`) were written but **not run**, and the page was not opened in a browser for this change.

**Sample-project tray (you asked for a slide-out drawer to copy the project descriptions).** A small, muted **Samples** tab sits on the right edge of the page. Clicking it slides a tray out with the twelve fictional project descriptions from `docs/NOFO_TEST_PROJECTS.md` (six detailed, then six short and vague ones that have not been run yet), each with a **Copy** button (clipboard API, with a fallback for non-secure pages; the button and a screen-reader line confirm the copy). The tray is **closed by default**, closes with the tab, the × or Escape, is unreachable by keyboard while closed, and honours `prefers-reduced-motion`. It appears on **Find grants and Assess a project only**: `nofo.js` now records the current mode on `<body data-chat-mode>` and announces a `chatmodechange` event, and the tray hides, and closes, when you switch to the original chat tab. Files: `public/js/sample-projects.js` (data, generated from the docs file), `public/js/samples-drawer.js`, markup in `chat.html`, styles in `style.css`. A test (`src/web/sample-projects.test.ts`, **not run**) fails if the data and the docs file drift apart, and checks that the tray is closed by default. The page was not opened in a browser for this change.

**Suggested-answers tray (you asked for a second drawer with a suggested response to "To sharpen this, tell me:").** One correction to the premise: those follow-up questions are fixed templates written by code (`src/nofo/assessment/questions.ts`), one per group of missing facts, not model text. A second slide-out tray, **Answers**, closed by default, with its tab stacked under **Samples**, appears on the **Assess tab only**. Each time an assessment returns, `nofo.js` announces its questions and known facts in an `assessresult` event, and the tray offers made-up example answers written by code (`public/js/answer-suggestions.js`), never by a model: a complete reply to all the questions for a "well advanced" and for an "early stage" project, and per-question answers (stage-dependent ones such as the benefit-cost analysis, design and environmental review give both versions), each with a Copy button. The answers build on facts already given, and the three amounts always satisfy total = federal request + match, so a suggested reply never contradicts the conversation; with nothing known it uses $40 million total, $25 million request, $15 million match. The tray says plainly that the answers are made up. A dot on the tab shows there is something new; opening one tray closes the other. The shared open/close/copy behaviour moved to `public/js/drawer-kit.js`, and the two trays now use generic `tray-*` CSS classes. New tests (`src/web/answer-suggestions.test.ts`, including a check that every question group the server can ask has a suggestion) were written but **not run**, and the page was not opened in a browser for this change. The Find grants tab's own optional questions are not covered.

**Guided questions and the developer console (Find grants).** You said the page returned results as soon as any prompt was entered and asked for guidance like the Assess tab, plus a developer-console box showing how the Simpler request is built. **Questions:** before searching, the server now asks up to two questions about what is still missing from the profile, in a fixed order (project type, applicant, stage, federal request), as the same "To sharpen this, tell me:" list the Assess tab uses. The wording is a fixed template in `service.ts`; no model writes a question. A description that already covers everything is searched at once. Questions are only asked on the first two messages, never twice (the page sends back the ids it has shown in a new `asked` field), and **Skip the questions and search** always works; from the third message on a list is always returned. This replaces the earlier rule of at most one required question and optional refinements with results; after a skip, unasked questions still appear as optional refinements. `refinementQuestions` and the `questions` field now carry `{ id, text }`. **Console:** a new `console` line type rides the existing NDJSON stream (`{"type":"console","kind","text"}`), written by code in `src/nofo/discovery/console.ts` from the profile, the search plan and the parsed response: the profile fields, each request being built filter by filter with the reason for it (a labelled draft while questions are open, nothing sent), the exact request (method, URL, a masked `X-API-Key` placeholder, the JSON body), a response summary (status, time, `total_records`, first three titles) and the ranked shortlist. It never carries the API key, the applicant's own words or a raw response; the raw responses stay behind the existing inspect checkbox. The page shows it in a dark monospace panel (`public/js/dev-console.js`) with a short line stagger that never holds back results, Copy, Clear, and reduced-motion support. The page also scrolls the progress panel into view when a turn starts, and the input box shrinks once a conversation begins. The CLI (`nofo:find`) now always searches unless `--guided` is given (it cannot remember which questions it asked). **Verified:** `tsc` is clean, and a real browser run against live Simpler.Grants.gov and the model showed the questions, the draft console, the second answer producing a list with the full console, and Start over clearing it. **Not run:** the unit tests I rewrote or added (`service.test.ts`, `nofo.discover.test.ts`, `discover-util.test.ts`); the 10-minute search cache makes a repeated identical turn show "no request sent" in the console, which is correct.

**Suggested answers on Find grants, and the console moved to the top.** The Answers tray now also appears on the Find grants tab. `public/js/answer-suggestions.js` gained the two guided-question kinds it did not have (`projectType`, `phase`; `applicant` and `request` already existed), `discover.js` announces each round's questions in a `findquestions` event (with a known total cost, so suggested amounts stay consistent), and `answers-drawer.js` keeps the latest questions per tab and shows the ones for the tab that is open, so switching between Find grants and Assess shows each tab's own. Start over empties it. The developer console is now the first element of the Find panel, always visible (an empty placeholder until a search starts), exactly three lines tall (older lines scroll inside the box), and pinned to the top of the viewport while the page scrolls; Copy and Clear sit in its title bar. **Verified:** `tsc` clean, and a headless-browser run with a stubbed server response checked the three-line height, scrolling to the newest line, the pinning, the tray's suggestions and copy, switching tabs, and Start over (all passed). **Not run:** the unit tests (`answer-suggestions.test.ts` was updated), and the tray against a real Find grants turn.

**The API call and a plain-language explanation, once the questions are done (Find grants).** When a turn returns a list (no "To sharpen this" questions open), the result now carries `apiCalls` and `explanation`. **API calls:** every request made, as sent: method, address, headers (the key is a placeholder, never the real key), the complete JSON body with all parameters, a ready-to-copy `curl` command that reads the key from `$SIMPLER_GRANTS_API_KEY`, and whether it was really sent, reused from the 10-minute cache or failed (`describeApiCall`/`curlCommand` in `console.ts`). The page shows them as the first card of the results, the keyword search open by default. **Explanation:** a new `src/nofo/discovery/explain.ts` asks the language model (same `LlmFn`, structured output) for a 3-5 sentence message that says what was searched for, which filters were applied and that applicant type, award size and cost sharing only affected the order. It is given only the applicant's messages and the listing titles shown (both in tagged, untrusted blocks) and the exact requests; never the key or raw responses. Code checks the text before it is shown (40-900 characters; no links, markup, lists or eligibility/"will win" claims) and otherwise, or with no model, uses a template written in code; the result says which (`source: model|code`) and the page labels it. It appears as an assistant message in the conversation, with a "Check it against the API call below" note. This is the one model-written piece of the discovery output; ranking and "why it may fit" remain code. It adds one model call per list (about a few hundred tokens out), shown as an "explain" progress step and console line. **Verified:** `tsc` clean; one live run (real Simpler.Grants.gov and model) produced a coherent explanation matching the request shown, the curl command copied correctly, and no page errors. **Not run:** the unit tests (`explain.test.ts` new; `service.test.ts` and `nofo.discover.test.ts` extended).

**All listings and their scores; a drafted project description for Assess (Find grants).** **Scores box:** the result now carries `scored` (up to 200 rows): every scored listing, best first, with its score, match label, whether it is in the shortlist, a plain reason it was left out, and the signals that make up the score. `scoreCandidate` now records each signal as it applies it (`parts`; they add up to `score`), and `describeScored` in `rank.ts` builds the rows. The page shows a collapsed "All N listings that were scored" box directly before "Opportunities worth a closer look", as a table with the signals under each title and shown rows highlighted. No model is involved. **Drafted description:** the "Assess my project against this" button first calls the new `POST /api/nofo/project-description` (same limiter as discovery), which asks the language model (`src/nofo/discovery/describe.ts`) to write one first-person project description from the applicant's own messages only (no grant, no results). Code accepts it only if it is plain text with no links or markup, and every number in it already appears in what the applicant wrote (so a figure cannot be invented, rewritten or swapped); otherwise, or with no model, the applicant's own messages are joined instead, and the response says which (`source`). The page then opens Assess with that text in the first-message box and a note saying who wrote it and to edit it before sending; it is only filled when nothing has been said in Assess yet and never over text the person typed, and Start over or sending clears the note. Assess opens even if the draft call fails. Only what the applicant sends counts as their statement, as before. **Verified:** `tsc` clean, and a live headless-browser run (real Simpler.Grants.gov and model, wildlife description) showed the box collapsed and placed correctly, 11 rows whose signals each summed to the score, shown rows matching the cards, the drafted description keeping $18 million and $12 million separate, the note, and typed text not being overwritten. **Not run:** the unit tests (`describe.test.ts` new; `rank.test.ts` and `nofo.discover.test.ts` extended).

**A taller console, and "how the code and the model built these calls" (Find grants).** The developer console is now nine lines tall (was three), and the offsets for scrolling messages into view under it grew to match. Right after the API calls card there is a new card that explains, for this run, how the parameters were built from what the applicant said. It is written by code (`src/nofo/discovery/trace.ts`) from what really happened, not by the language model, so it cannot drift from the calls above it. It has two parts. **Steps** (each tagged You, Language model or Code): what you sent; the model proposing a profile, with a quote for each fact, and what it does not control (filters, address, parameter names); code checking every proposal against your own words, listing each kept fact with its quote and anything discarded; how the search words were decided (proposed, kept because they are in your words, dropped because they are not, and added by code from its project-type word list; `verifyWire` now returns this as `terms`); how the query string was built (quoted phrases, OR, the 100-character limit, any word left out); the fixed filter rules and why applicant type, award size and cost sharing are never filters; which searches ran and why (including the count that triggered a widening); and that the key and responses never reach the model. **Parameter table:** every parameter of every request with its real value, a source (Fixed rule, Your words, or Your choice for the checkbox) and a reason. Only the verbatim quotes already shown elsewhere on the results appear from the applicant's text. **Verified:** `tsc` clean, and a live headless-browser run showed the console at exactly nine lines, the card second in the results, all three actors, the quotes, and 10 parameter rows with a source and reason each. **Not run:** the unit tests (`trace.test.ts` new; `service.test.ts` extended).


**Demo mode (you asked for a repeatable demo that simulates the progress flows without API calls, downloads or parsing).** Operator steps are in `docs/NOFO_DEMO.md`. There is no "askflow" in the code: the bar you described is the shared progress panel (`public/js/progress-panel.js`, plus a duplicate copy in `public/js/discover.js`), used by Find grants and Assess, and a smaller view for Prepare.

- **How it works.** `public/js/demo-mode.js` wraps `window.fetch` in the browser and answers `/api/nofo` calls from a recording, `public/demo/demo-run.json`, so the real page code runs unchanged. No server code changed. `public/js/demo-util.js` holds the pure parts (recording validation, turn choice by call number, replay timing with each gap capped at 2.5 s, the scripted prepare state, flag parsing).
- **Switching.** `?demo=1` on, `?demo=0` off (remembered in `localStorage`), plus a floating-menu item. `?demo=record` captures a real run in the browser (it passes calls through and keeps only turns that ended in a result), and the menu then offers **Download recording**.
- **Never live by accident.** While on, a badge says "Demo mode: recorded run, not live". A `/api/nofo` request with no recording is refused (HTTP 403) and never sent on; a missing or damaged recording is reported on screen. The only calls passed through are read-only GETs of `/opportunities...` (the "View source" views read local files).
- **Stays on screen.** In demo mode `ProgressPanel.stop()` and the Find grants copy leave a finished panel visible (bar full, every step ticked, "Completed") until the next run clears it. A run that failed or left a step unfinished is hidden as before. A finished Prepare keeps its two ticked steps above the "Prepared" line.
- **Limits.** Replay is sequence-based: typed text is not interpreted. The chosen turn depends only on how many calls came before. Prepare is a timed script, not a job.
- **Tests.** `src/web/demo-util.test.ts` (29 tests) covers the helpers, and loads the real `demo-mode.js`, `progress-panel.js` and `discover-util.js` in a sandbox with a fake network to check that replay never reaches a real API, the turn order, reset, the refusal and passthrough rules, the prepare sequence, recording capture and the finished-panel behaviour.
- **Not done.** The recording has not been captured (it needs real API keys and a person to walk the flow), so `public/demo/demo-run.json` does not exist yet. The pages were not opened in a browser: the replay was checked only through the sandbox tests and by confirming the server serves the new files.

**"No documents listed" on the result cards (you noticed that not all of the listed grants have documents to download).** Of the 11 open U.S. DOT listings, 6 list documents on Simpler.Grants.gov and 5 list none (checked through the API's attachment list; nothing was downloaded). For the 5, Simpler's own pages also say "No documents are currently available", and Grants.gov's public record lists none either. Two of them (the two Amtrak agreements) link to a GrantSolutions application page that offers one assurances template; two have old-format application-package instruction files (`PKG….doc`) on Simpler's file host that are not in the API's attachment list; one is forecast-only with nothing anywhere. None has a notice document. Raw captures are in `data/captures/` (git-ignored: they include agency contact details).

- **Server.** `src/nofo/discovery/documents.ts` reads the attachment list (names and sizes only) for each **shortlisted** listing (4 or 5 detail requests, in parallel, cached for 10 minutes) and sets `documents: { status, count, files }` on each shortlist item. `status` is `listed`, `none` (the API lists none: worded "none listed", never "none exist") or `unknown` (the check failed: never cached, one failure never affects another listing or the search, and a warning is added). File names are untrusted: control and direction-override characters are stripped, they are shortened, and at most 8 are kept. No download link is carried. A new progress step, `documents`, runs between scoring and the explanation. The check is code only (no model) and is skipped when the source cannot list attachments.
- **Screen.** A card with "none listed" explains it, drops the Prepare button (a job that could only fail) and names where else to look: the Simpler.Grants.gov page and, only if the listing gives one, the program's own page, labelled as another website and opened in a new tab. A card with documents shows the count and the file names in a collapsible list. "Unknown" says so and still offers Prepare. An opportunity already prepared on this server shows none of this. The pure wording and link logic is `documentsView` in `public/js/discover-util.js`.
- **Not done.** The demo recording was left alone, so replayed cards carry no document information and look as before until it is re-recorded. The Prepare route does not refuse an opportunity with no documents (the card just does not offer it). A listing whose only document is a Notice of Intent or a template is shown as having documents: the code does not guess from file names whether a file is the notice.
- **Tests.** `src/nofo/discovery/documents.test.ts` (13: cleaning, caps, listed/none/unknown, caching, the step order, skipping), 3 route tests in `nofo.discover.test.ts`, and 6 `documentsView` tests in `discover-util.test.ts`. The four card states were also rendered in headless Chromium from a canned result (no live API calls), with no page errors. Full suite: 835 passed, 9 failed, 1 skipped; the same 9 fail without this change (see the demo-mode note above). The build is clean.

**All listings, best fit first, no-document listings last (you asked for all 11 in the order of the most ideal grant, with listings that have no documents always last).** Find grants no longer picks a shortlist of four or five. Every scored listing is returned, ordered by the code's score for fit to the project description (score ties by title). This replaces the old rule that put "likely" matches first: a "likely" match with a low score now sorts by its score, and nothing is left out for being a weaker match or for a different mode (those carry their own watch-outs). The documents check now covers every returned listing (five lookups at a time, cached), and any listing for which the API lists no documents is moved to the end, keeping the order among them. A listing whose check failed is not moved. Returns are capped at `RESULTS_MAX` (25), which matters only for very large results such as with closed and archived opportunities included, because each returned listing costs one lookup. The summary, the progress messages and the trace text were reworded to match, and the page heading is now "Opportunities, best fit first".

- **Where.** `selectResults` and `RESULTS_MAX` in `src/nofo/discovery/rank.ts` (replacing `selectShortlist`), `documentsLast` and the concurrency limit in `src/nofo/discovery/documents.ts`, the ordering and wording in `src/nofo/discovery/service.ts`.
- **Not tested (tests and the build were paused at your request).** Tests that assert the old four-to-five selection are now out of date, and `rank.test.ts` imports the removed `selectShortlist`. They need updating when tests resume. `widen` still triggers when fewer than four listings match the project words, so a search that widens beyond DOT can return more than the 11 open DOT listings. The demo recordings still show the old four-listing results.

**"No parsed controlling document" when preparing a listing that does have a document (State Electronic Crash Data Collection, `17831514…`).** Cause: its only listed document is a 2023 Notice of Intent. It parsed, but the file-name rule in `src/nofo/acquire/authority.ts` (a NOFO or an amendment is "controlling"; everything else is "unclassified") does not treat a Notice of Intent as the notice, and extraction only reads controlling documents, so it stopped. That is correct behaviour (a Notice of Intent must not be presented as the notice), but the card offered Prepare and then showed the developer message.

- **Before the click.** `describeAttachments` now sets `hasNotice` on a listing's documents, using the same `classifyAuthority` rule extraction uses, so "no notice" on the card means extraction would stop. It is a file-name check, not a reading of the file. A listing with documents but no notice is treated like one with none: no Prepare button, the file names shown, the links to other pages, and it goes last (`cannotPrepare` / `documentsLast`). Progress text and the summary say "no notice document listed".
- **After the click.** `ExtractionError` carries a code, the extract CLI exits **4** for "no parsed controlling document" (new; 0, 2 and 3 are unchanged), and Prepare shows: "The documents listed for this opportunity do not include its notice of funding (a NOFO or an amendment)… The notice may not be published yet, or it may be on another page."
- **Limit.** A real notice with an unusual file name (none of NOFO, notice of funding, funding opportunity announcement, FOA, amendment or modification) would also be reported as "no notice" and would also fail extraction. A curator can still classify it in `supplemental.json`, but the card does not offer Prepare for it. Tests were not run (paused); the type-check passes.

**Home page numbers: "The size of the search" (you asked for numbers on the home page that show how much work a specialist would face screening grants for a specific project).** A new section under the hero shows five counts that Simpler.Grants.gov itself reports, and nothing estimated: **1,450** open or forecasted opportunities (861 open, 589 forecasted), **25** federal agencies publishing them (153 agency offices), **839** that list state, county or city governments as eligible applicants (58%), **11** from the U.S. DOT (the other 1,439 come from other agencies), and **83,505** published in all (82,055 closed or archived). Figures as of 2026-11-11. You chose live numbers, cached, and counts only: no hours, cost or time-saving claim is made (the project has not benchmarked one).

- **Server.** `src/nofo/stats.ts` asks Simpler.Grants.gov four one-result questions and reads the answers from the response's facet counts (the unfiltered `total_records` is capped upstream at 10,000, so the all-time total is the sum of the four status counts). `GET /api/nofo/stats` always answers at once: from its last live count if it has one (refreshed in the background after 6 hours), otherwise from the saved snapshot `data/fixtures/simpler-stats-snapshot.json` (counts only, safe to commit). One refresh at a time, and after a failed refresh no retry for 5 minutes. With no API key it serves the snapshot and makes no requests. Everything read from the API or the file is validated with Zod; with neither, the route says the statistics are not available and the page keeps the section hidden rather than showing made-up numbers. `npm run nofo:stats` recounts and rewrites the snapshot (`--print` only shows it).
- **Page.** `public/index.html`, `public/js/home-stats.js` (renders with `textContent`, counts up once unless reduced motion is preferred) and `public/css/home.css`. The line under the numbers says "Counts reported by Simpler.Grants.gov as of …", or "Saved count from …" when the snapshot is showing, which is the case for the first view after a server start.
- **Notes.** "Agencies" is derived from the agency code (the part before the first hyphen), since the API lists offices, not agencies. The "transportation" funding tag is not used: only 7 open listings carry it, so it would understate the field, which is why the DOT count is shown instead. The numbers sit inside the hero, in a panel to the right of the headline and buttons, so they are above the fold on desktop and laptop windows (measured in headless Chromium: the panel ends at 735 of 900, 716 of 768 and 716 of 720 pixels at 1440×900, 1366×768 and 1280×720). To make room, the hero's top and bottom padding was reduced (4rem/4.5rem to 2.75rem/3rem). Below 900 pixels wide the panel stacks under the text, so on a phone it is below the fold; if the numbers cannot be loaded the hero looks as before.
- **Checks.** Type-check clean; tests (`stats.test.ts`, `home-stats.test.ts`, `nofo.stats.test.ts`) are written but not run (paused). Checked in headless Chromium: first call served the snapshot, the second the live count; tiles show the exact figures; no page errors; no horizontal overflow at phone width.

**Home page hero re-worded to the deck's message (you asked the hero to align with the "search to consultation" idea in `public/big-build-v2.html`, so that the stats support it).** The deck's central message is "From search to consultation": government funding asks people to navigate the system first (keywords, filters, sifting results, reading lengthy notices), so GrantFlow starts with the project, "Start with the project. Not the program."

- **Hero.** A small label, "From search to consultation", the headline "Start with the project. Not the program." (replacing "Know what a funding notice means for your project before you apply"), and the lead: GrantFlow "works like a consultation, not a search engine. Describe your transportation project in plain language, answer a few questions, and get guidance on which funding opportunities may fit and what each notice requires, with every finding linked back to the official source." Every claim in it describes something the app does (guided questions, ranked opportunities with reasons, requirement-linked assessment with sources); "guidance" keeps the preliminary framing, and the preliminary-guidance banner further down the page is unchanged.
- **Stats panel.** Now framed as the burden of starting with a search: "What a search asks you to navigate: a funding search starts with the program: guess keywords, set filters, sift the results, then read each notice that looks relevant. Today that means working through:" followed by the same five live counts, then the pivot "A consultation starts with your project instead, so you don't have to start here." The labels were tightened ("open or forecasted opportunities", "federal agencies publishing them"). The applicant-type tile now says "58% of the total: filtering by applicant type alone still leaves most of the list" (only when the share is 50% or more; otherwise the earlier wording), which is a direct, true illustration of the deck's "too many results" point. Still counts only: no hours, cost or time claim, so the deck's separate "illustrative model, not measured results" slide is not echoed here.
- **Also fixed.** The Find grants card on the home page still said "a short list of U.S. Department of Transportation opportunities", which stopped being true when results became all listings, best fit first. It now says "funding opportunities from Simpler.Grants.gov, starting with U.S. Department of Transportation programs, ranked best fit first".
- **Layout.** Still above the fold at 1440×900, 1366×768 and 1280×720 (panel ends at 706 of 720 pixels); the saved-count line was shortened to stay on one line. Type-check clean; tests not run (paused).

**Find grants: the "Preliminary only" notice is hidden by default, with a Settings tray to show it again (you asked to hide the box for now and add a settings tab to the side tray).** The yellow notice in the Find grants intro card ("Preliminary only. This list is a starting point… Your description is sent to the Anthropic API… the conversation stays in this browser tab.") now ships with the `hidden` attribute (`id="findNotice"` in `public/chat.html`), so it never flashes up on load. A new **Settings** tab sits on the right edge under Samples, Answers and Dev. It opens a tray with one switch, "Preliminary-use notice"; using the switch shows or hides the notice and **closes the tray by itself** (like the Dev switch and the copy buttons). The choice is remembered in this browser (`localStorage` key `grantflow.showFindNotice`; hidden unless the person turned it on; still works for the life of the page when storage is blocked).

- **Files.** `public/js/app-settings.js` (the setting, applied to the notice, announces `appsettingschange`), `public/js/settings-drawer.js` (the tray, built on `DrawerKit` like the Dev tray), tray markup in `public/chat.html`, tab position and switch styles in `public/css/style.css`. The tray is offered on the Find grants view only (it listens for `chatmodechange`), because that is where the notice is. The Assess tab's own "Preliminary only" notice is untouched.
- **Still on the page.** The preliminary disclaimer at the end of every result list (`DISCOVERY_DISCLAIMER`), the home page's preliminary-guidance banner, and the guidance wording in the hero. What is hidden is the data-flow sentence (where the description is sent), so it is worth restoring before a wider audience.
- **Checks.** Type-check clean. `src/web/app-settings.test.ts` is written but not run (paused). Checked in headless Chromium: hidden by default; tab shows and does not overlap the other tabs; the switch shows the notice and the tray closes by itself; the choice survives a reload; hiding works; Escape closes the tray; the tab is not offered on Assess; no page errors.

**Sample project descriptions rewritten for the listings with downloaded notices (you asked to revise all the samples to match the listings that actually have classified documents to parse; open listings only).** `data/opportunities/` holds six packages; five have a notice document (a controlling document), parsed requirements and so can be assessed: the FY2026 Wildlife Crossings Pilot Program, the FY 2027 Crash Causal Factors Program, the Innovative Traffic Safety Enforcement (ITSE) Grant Program, the State Process for Informing Consumers of Recalls Program and the FAA Aviation Research Grants Program. The sixth (State Electronic Crash Data Collection) has only a Notice of Intent, so no sample is written for it. All twelve samples (`public/js/sample-projects.js`, with the same text in `docs/NOFO_TEST_PROJECTS.md`, which a test keeps in step) were replaced, except that the twelfth ("no project type at all") is deliberately unchanged because it exists to exercise the guided questions.

- **The set.** Six detailed: a county wildlife overpass (Wildlife Crossings), a state DOT wildlife project whose non-federal share is 16 percent against the 20 percent minimum (should assess as a conflict), a state patrol joining the truck-crash study (Crash Causal Factors; Ohio is a participating state; $450,000 against the $500,000 ceiling), a sheriff's traffic safety enforcement program (ITSE), a state motor vehicle agency's recall notification process (Recalls) and a university's aviation safety research (FAA). Six short and vague: a tribal wildlife crossing, a state patrol and truck crashes, a police department and speeding/drunk driving, a registration agency and recalls, a university and aviation research, and the generic one. Details are drawn from each program's real eligibility, award range, periods and requirements (from the listing and the extracted requirements), so Assess has real things to confirm, flag or find missing (a missing SAM.gov registration, a required state highway agency consultation, a match share below the minimum, an inspector certification gap).
- **Checked against the live search (open listings only, 2026-11-11).** Each of the eleven program-specific descriptions was run through `npm run nofo:find`: ten rank their intended program first and one (the short recalls description) ranks it second behind the Crash Causal Factors Program, which is tagged as transportation and mentions safety. Two wording fixes came from those runs: ITSE is not tagged as a transportation program and its listing text does not mention speeding, so its descriptions use the program's own words ("traffic safety enforcement"), which moved it from third to first; and the recalls description now says "request the full $1.2 million", because "all of which we would request" was read as no federal request. Model reading varies a little between runs, so a rank can move by a place.
- **Removed.** The Virginia DOT bridge sample ("the demo case") is gone: it matched the FY2026 BUILD notice, which is archived, and you asked for open listings only. The demo script text in `docs/NOFO_DEMO.md` is not touched. `public/big-build.html` (line 386) and `docs/BIG_BUILD_PRESENTATION.md` (line 55) still say "the Virginia DOT samples in `docs/NOFO_TEST_PROJECTS.md`", which is now out of date.
- **Not done.** Assess was not run on the new descriptions, so the notes that say what Assess should show come from the extracted requirements, not from a run. Type-check clean; the sample test was checked by running its rules directly (vitest is paused).

**Ten fictitious projects from the notices, two per listing (you asked to research the five listings with downloaded notices, then generate projects that would apply: one with one gap and one with two).** Instead of building on the listing summaries, I read the program, eligibility, scope, money, timing, application and review sections of all five notices (Wildlife Crossings, Crash Causal Factors, Recalls, ITSE, FAA Aviation Research) and wrote **`docs/NOFO_FACT_SHEETS.md`**: one sheet per grant, every fact with its PDF page number, plus realistic preparation gaps. You confirmed the facts and the ten project concepts before I wrote the descriptions. These replace the previous twelve samples (`public/js/sample-projects.js`, `docs/NOFO_TEST_PROJECTS.md`, `src/web/sample-projects.test.ts`).

- **Corrections the reading produced.** The Simpler.Grants.gov listing's award floor and ceiling can be the notice's total pool: **Recalls** anticipates 3 to 5 awards of $300,000 to $500,000 each (not up to $1.5 million) and **ITSE** 8 to 15 awards of $500,000 to $2 million each (not up to $20 million). The earlier Recalls ($1.2 million) and ITSE ($2.4 million) samples asked for too much; the new ones use the notice ranges. Other rules now used: a local Wildlife Crossings applicant needs the **State DOT to agree to administer the grant**; Crash Causal Factors will not fund new reconstruction teams and requires NAS Part A/B certified officers; ITSE requires a named focus area. Two of my own page citations were wrong and one ITSE date was attributed to the wrong document before I verified them.
- **The ten.** Wildlife Crossings: a Wyoming county (gap: State DOT has not agreed to administer) and a Utah regional authority (gaps: no cost-overrun plan, no maintenance funding). Crash Causal Factors: an Ohio highway patrol (gap: no historical basis for overtime) and a Missouri highway patrol (gaps: only four of twelve troopers certified, not coordinated with the State lead agency). Recalls: a Washington agency (gap: vendor not chosen) and a New Mexico division (gaps: no completion-analysis method, no project manager). ITSE: a city police department (gap: no SAM.gov registration) and a Georgia sheriff (gaps: no evaluation partner or data-collection method, no baseline data). FAA: a public university (gap: SAM.gov being renewed) and a 501(c)(3) institute (gaps: no indirect cost agreement, current and pending support not compiled).
- **Checked against the live search (open listings only, 2026-11-11).** All ten rank their intended program first. The first draft of the Washington Recalls description ranked it third (the model chose "VIN" and "registration" as search words rather than the listing's own "vehicle registration" and "notification"); rewording fixed it and it held on two repeat runs. Search words vary a little between runs, so a rank can move by a place.
- **Short descriptions added back (a follow-up).** The first version of this set had only the ten detailed projects, with no short descriptions. There are now **six short, vague ones** (90 to 146 characters): one in everyday words for each program (a county and deer on a highway; a state patrol and a truck-crash study; a state motor vehicle agency and recall notification; a police department and speeding and drunk driving; a university and aviation research) plus the generic "no project type at all" one, which exercises the guided questions and was not run. The sample set is now sixteen, and `src/web/sample-projects.test.ts` expects ten detailed (two for each of five programs, one with one gap and one with two) and six short. Run against the live search (open listings only), each of the five program-specific short descriptions ranks its program first; the short Recalls description is the most sensitive to wording (three earlier phrasings ranked it second, third or fourth), and ITSE needs the words "traffic safety enforcement" because it is not tagged as a transportation program.
- **Other.** The Virginia DOT bridge sample was already removed (it matched archived BUILD). `public/big-build.html` (line 386) and `docs/BIG_BUILD_PRESENTATION.md` (line 55) still refer to "the Virginia DOT samples".
- **Not done.** Assess was not run on the new descriptions, so the notes saying what Assess should show come from the notices and the extracted requirements. Type-check clean; the sample test's rules were checked by running them directly (vitest is paused).

**Find grants: the downloaded documents, with type and pages, and totals that show the reading a specialist faces (you asked to list the documents, their type and number of pages for grants whose documents are downloaded, and to add other useful stats).**

- **Per card.** A listing whose documents are in `data/opportunities/` now has a "Documents to review" block: a headline ("5 documents, 49 PDF pages, about 22,700 words"), a table of every document with its **type** (PDF, Word), **role** (Notice, Guidance, Other, from the app's authority classification), **pages** and **words**, and a line on the requirements GrantFlow extracted: how many, by category, how many are documents or forms to prepare, how many can be checked automatically against the applicant's facts, and that none has been verified by a person. It also shows the day the files were downloaded. The list of file names from the API check is not repeated on these cards.
- **Strip above the cards.** "6 of these 11 grants have documents downloaded and read": 15 documents, 228 PDF pages, about 74,800 words, 254 requirements to check and 53 documents and forms to prepare (figures for the present downloads), with a note that this is the reading and checking a specialist would do by hand, that GrantFlow has already read it, and that nothing is verified yet.
- **Only counts.** Pages, words and requirement counts come from the stored files; nothing is estimated. **No time or cost is claimed** (no "hours to read"), because that would need an assumption about reading speed and the project has no benchmark. Word counts are rounded to the nearest hundred above 1,000 and labelled approximate. A Word document has no page count, so it shows words only and is left out of the page total. Notice-of-Intent-only packages show their real, small size (State Electronic Crash Data Collection: 1 document, 2 pages) and no requirements line.
- **Server.** `src/nofo/discovery/downloaded.ts` reads the manifest (page counts are already recorded), counts words from the normalized text (cached by file hash), and summarizes the requirements file. `POST /api/nofo/discover` (and its stream) attaches `downloaded` to each shortlisted item and a `downloaded` total to the result, using local files only: no outside request. Files stored here count whether just fetched or already on disk ("cached"); files removed upstream or unread are not counted. Page side: `downloadedView` and `downloadedTotalsView` in `public/js/discover-util.js`, rendering in `public/js/discover.js`, styles in `style.css` and `theme-afs.css`.
- **Checks.** Type-check clean. Ran a real Find grants search in headless Chromium against the real packages: the five prepared listings and the Notice-of-Intent one show the block, the other five show their "No documents listed" notes, no page errors. Tests (`downloaded.test.ts`, additions to `discover-util.test.ts` and `nofo.discover.test.ts`) are written but not run (paused). The demo recordings predate this and show no document blocks until re-recorded.

**Stress-test sample descriptions to fill the Assess findings list (you asked to revise the samples to maximize the finding cards; you chose to add them as a second set).** Ten new fictitious projects (samples 17 to 26, two per listing) were added after the existing sixteen, which are unchanged, so the demo reference to sample 1 in `public/big-build.html` still points at the Wyoming county project. Files: `public/js/sample-projects.js`, `docs/NOFO_TEST_PROJECTS.md` (new section after the short descriptions) and `src/web/sample-projects.test.ts` (counts, and a rule that each program has two "Stress test:" titles).
- **Why the old samples showed no cards.** "Findings to look at first" lists only possible conflicts, preparation gaps and needs-specialist-review items (`buildAdvisory`, `src/nofo/advisory.ts`, at most eight, folded by topic). The old samples were projects that would apply, so sample 1 scored 0 cards (2 supported, 28 not yet evaluated).
- **What produces a card.** Code checks (an amount outside a range, a match under the minimum, an applicant type that does not clearly match) plus the model's reading of free-text conditions. The model sees only the free-text facts: the one- or two-sentence project summary, the activities list, design and environmental status, applicant type, state and area. A problem has to be written as something the project "would include" to reach it; a passing remark is dropped.
- **Run on 2026-11-11** with the real code and model: 5 of 10 reach 7 to 8 cards in every run (samples 4 to 8), two more vary between 5 and 8 (3 and 9), the Wildlife Crossings pair (1 and 2) stays low (2 to 4, the floor being the two code checks), and the FAA individual (10) is the least steady (1 to 8). Scored against the saved notices in `data/opportunities.back.2` (ITSE against the current `data/opportunities`).
- **Limitation.** The same text can give a different count on another run, because the fact-reading step (`src/nofo/assessment/facts.ts`) sometimes returns only the first project phrase as the activities. A prompt change there (list every distinct thing the applicant says the project includes) would likely steady it; not made, because it is an app change you did not ask for.
- **Checks.** Type-check clean. The sample test was not run (paused); its rules were checked by running them directly and all pass. The doc blockquotes match the data file exactly.

**Assess findings refined using the "Stress test: Crash Causal Factors, Colorado patrol" sample (2026-11-12; you asked to refine the generated findings and the consultation, fixing wrong findings first).** A live run showed four faults, all fixed in generic code (no program-specific rules):
- **A false pass on the decisive eligibility rule.** "Applicant must be located in a participating state" was marked supported because the applicant is "a state" (the extracted check lists "Participating State"). Now an eligibility rule about who is on a closed list the notice names (`evaluateClosedList` in `src/nofo/assessment/checks.ts`, topic `applicant_type`, wording such as participating, pre-selected, named in, identified agencies) can never pass on the kind of organization. It is unknown until the applicant says whether it is on the list (new fact `onNoticeList`), and a rule about another kind of applicant (for example "local agencies") is not applicable to a state.
- **An irrelevant question.** "No matching share required" made the app ask about match. A requirement that says nothing is owed is now set aside (`statesNoMatchRequired` in `assess.ts`, shown under skipped). The patterns are deliberately narrow so "match is required; federal funds may not be used as match" is not skipped.
- **Dropped facts.** "We have no historical records…" and "our troopers hold no certification" were lost. A new fact `statedGaps` (things the applicant says it lacks) is read, shown to the interpretation step, and `applicant_capacity` readiness rules now go to it; the run found three certification conflicts and the overtime-history one that it missed before.
- **Wrong "supported".** The interpretation prompt (version 2) now says that a rule that says what must be done is not "supported" just because it applies.
- **New first question.** Group `listed` ("Is yours one of the organizations the notice names?") leads the question order and cites the requirement and page. The Colorado run now gives 10 possible conflicts (was 6), no false pass, and that question instead of the match question.
- **Not done / limits.** The fact `onNoticeList` is the applicant's own statement; it is not checked against the notice's list. Tests were added (`checks`, `assess`, `questions`) but not run (paused). Next: the model-written conversational reply (Assess and Find grants) with code-checked findings kept separate, and the matching `CLAUDE.md` rule change; Find grants' own irrelevant "planning, design or construction-ready" question and the 11-card shortlist (the guide says 4 to 5) are not yet addressed.

**Find grants: no more irrelevant question, and a readable list (2026-11-12; same Colorado patrol run; you chose "best 5, the rest behind a button").**
- **The project-stage question is no longer asked.** "Is the project at the planning, design, or construction-ready stage?" changed nothing: the stage is shown but never filters or scores (checked: no use in `rank.ts` or `filters.ts`), and it only fits construction projects (it was asked of a patrol enforcement and data study). It is still read when the applicant says it. The questions left are project type, applicant and federal request, each of which changes the search or the ranking. `pendingQuestions` in `src/nofo/discovery/service.ts`.
- **Best five first.** The server still returns every scored listing (up to 25), now with `showFirst: 5` (`RESULTS_SHOWN_FIRST`, `rank.ts`) and a summary that says so ("The best 5 are shown below; the other 6 are one click away"). The page shows the first five cards and a "Show the other N listings" button; nothing is thrown away. The documents strip ("N of these M grants have documents downloaded") now adds up the listings on screen and redoes itself when the rest are revealed (`splitResults`, `totalsFor` in `discover-util.js`; `renderResults` in `discover.js`). This replaces the "show all 11" display from earlier today but keeps its ordering rule (listings with no notice document last).
- **Order and labels.** A listing that matches the project's words now always comes before one that does not, whatever its score (before, a weaker Wildlife Crossings listing outranked three matching ones). A program for another mode (rail, aviation, wildlife crossings) stays "likely" only if a specific project word is in its title; "safety" in its description is not enough. For the Colorado patrol the top five are now all matches: the Crash Causal Factors program first, then the drone inspection, traffic safety enforcement, recalls and crash data programs; rail, aviation and wildlife listings are "weaker" and below the button.
- **Not done.** Tests were added or updated (`rank`, `service`, `discover-util`) but not run (paused). The page was not checked in a browser. The demo recordings (`public/demo/*.json`) were made before this and still say "showing all of them"; they show five cards and the button only if their saved results carry no `showFirst` (they do not, so the page shows all of their listings as recorded).

**A conversational reply for Assess and Find grants (2026-11-12; you chose: the model writes a conversational reply, the code-checked findings stay separate; both screens; update the `CLAUDE.md` rule).**
- **What it is.** Assess: the chat message after each turn is now a short, plain, conversational reply (2 to 4 paragraphs) instead of the headline and a list. Find grants: a reply under the list introduces the best listings and asks the open question, or points to "Assess my project against this". The findings, sources, follow-up questions, advisory and the list with its reasons and cautions are unchanged and still written by code, shown separately and labelled so. Each reply says whether it was written by the language model or a template.
- **What the model sees.** Only material code has already produced: the stated facts, the findings (most serious first, with plain-language status and the notice page), the questions and counts (Assess); the understood project, the first five listings with their code-written reasons and cautions, the open question and counts (Find). Never the notice text. The applicant's own message is passed as delimited, untrusted data.
- **What code checks** (`src/nofo/reply-check.ts`, shared): plain text of bounded length and paragraphs; no markup, links, lists or internal ids; no verdict on the applicant (eligible, ineligible, qualified, cannot apply), prediction or recommendation; every dollar amount and number must appear in the material (or be a count code supplied); a question mark when a question is due; the findings or listings it says it relied on (`mentions`) must be ones it was shown, and at least one. Any failure replaces it with a template written from the same material, and the result carries a fixed `fallbackReason` (for example `number`, `verdict`, `no_question`, `length`, `no_model`) so a fallback is visible in the CLI, the progress line and the developer console. Words the model chooses cannot be proven true by code; the prompt restricts them and the page labels the reply as model-written and preliminary.
- **Rule change.** `CLAUDE.md` now allows these two model-written replies under those checks (the findings and advisory stay code-written).
- **Where.** `src/nofo/assessment/reply.ts` (Assess), `src/nofo/discovery/reply.ts` (Find grants), result fields `reply` on `assessTurn` and `POST /api/nofo/discover`, `public/js/nofo.js` and `public/js/discover.js` (display), `npm run nofo:assess` and `nofo:find` (print it).
- **Seen on the Colorado patrol sample.** The Assess reply leads with the $500,000 ceiling against the $1.4 million request, groups the certification points, mentions the five-versus-four projects limit and ends by asking whether the patrol is one of the organizations the notice names. Across four live runs while the prompt and limits were being tuned, the model's text passed the checks in two; the other two were rejected (once for omitting the question, once for length) and the template was shown instead, so the checks and the fallback worked as designed. The prompt and the length limit were then adjusted; the last run passed. While that "is yours one of those named" question is open, nothing about who may apply is offered as consistent.
- **Not done / limits.** Tests were added (`reply-check`, `assessment/reply`, `discovery/reply`) but not run (paused), and the existing service and progress tests were adjusted for the extra model call and not run. Both replies add one model call per turn (a few seconds). The Find questions stage (before a list) still uses the code-written questions without a reply. The reply can vary run to run, and it may still reword a finding slightly (for example "per project" for "per award"); the findings below it are the reference.

**Replies hold up in a real conversation (2026-11-12; you replied "Yes" on Find grants and the reply made no sense; you chose "context-aware reply plus a button").**
- **Three faults found in your screenshot.** (1) The reply said "L1 lines up well… L2… L3": the checker's internal-id test only knew the Assess handles `F`/`Q`, not the Find handle `L`. (2) It ended with a rhetorical question ("Would you like to pick one…?") that the app cannot act on. (3) Find grants sent only the applicant's messages, so "Yes" was read as a second project description and the model wrote the introduction again, with no idea what it had said before.
- **Checker** (`src/nofo/reply-check.ts`): handles `F`, `L` and `Q` are rejected; a new `forbidQuestion` limit rejects any question mark when no question is open (`unexpected_question`). Both replies use it.
- **Find grants reply.** The page now sends the reply it showed last turn (`previousReply`, at most 2,000 characters, untrusted); the model sees it, and the applicant's latest message, as delimited context on a follow-up only. The allowed numbers are built from code-produced material only (the previous reply and the applicant's own words cannot introduce a number). Prompt rules: ask a question only when one is given; on a follow-up that adds no project information ("yes", "thanks") do not repeat the introduction, answer in about 50 words and point to the next step; name listings by title, never by handle. Template: a short "Thanks. Nothing in that changes the list…" for follow-ups.
- **The button.** Under each Find reply, "Assess my project against <closest listing>" scrolls to that listing's card and clicks the card's own action (Prepare, the simulated prepare, or Assess), so a reply never needs a "yes". Cards carry `data-opportunity-id` for this.
- **Assess reply.** It now also sees the assistant's previous message (from the conversation the page already sends), is told to acknowledge a bare answer without repeating itself, may not ask a question unless one is open, accepts the question handles `Q1…` in `mentions` (not counted as findings), and gets money in the facts written as dollars so a quoted amount is checked against the same text.
- **CLI.** `npm run nofo:find -- "<description>" --say "Yes" --previous-reply "<last reply>"` tries a follow-up; the Assess CLI cannot (it sends only applicant messages).
- **Seen live (Colorado patrol).** First Find reply: no handle, no question, points to the button. Follow-up "Yes": a shorter reply that does not reopen the whole introduction (it still re-named the two top programs before the prompt was tightened to about 50 words; not re-run). Assess reply: leads with the ceiling, groups the certification points, ends with the "named in the notice" question. The model still says "per project" for "per award" in places.
- **Not done / limits.** Tests were added or updated (`reply-check`, both reply modules, `discover-util`) but not run (paused). The browser was not checked by me. A follow-up still re-runs the (cached) search and shows the list again; a typed question about one listing ("tell me about the second one") is answered only from the listing data the model was shown, or not at all.

**Questions repeat until answered, with a visible skip (2026-11-12; you asked it to keep asking until it has all the answers; you chose "keep asking, with a visible skip").**
- **Find grants.** The rule "ask on the first two messages only, never twice" is gone (`GUIDED_ROUNDS` removed). An unanswered question is asked again on the next message, two at a time, in the fixed order project type, applicant, federal request. The page no longer reports shown questions as `asked`; `asked` now means "the applicant chose to skip these" (the field is unchanged, so callers and tests that send it still suppress those questions). A repeat round says "Thanks. I still need a little more to rank the list well…". The ends: the always-visible "Search now" button, and the message limit (`MAX_USER_MESSAGES`, 6): the last message always gets a list.
- **How many rounds.** At most 2 if every question is answered (three questions, two per round, so the list appears on the third message). If answers are missed the question repeats, up to the 6-message limit (so up to 5 rounds).
- **Assess.** It already asked on every turn while a requirement waited on a fact (up to 3 questions, ten possible groups, so at most 4 rounds if all ten were open; the Colorado sample needs 1; the 40-message conversation limit is the ceiling). New: an "I don't know yet" button under the questions, in the chat message and the questions card, sends `skipFacts` (facts set aside; `AssessInputSchema`, `buildQuestions(…, skip)`). No question is asked about those facts again, the requirements waiting on them stay **unknown** (never a pass or a fail), other questions are still asked, and a new opportunity or Start over clears the list.
- **Rule change.** `CLAUDE.md` no longer says Find grants "stops asking questions after a bounded number of turns".
- **Not done.** Tests were updated or added (`service`, `questions`) but not run (paused); the page was not checked in a browser. A question whose answer the model cannot read (for example a vague amount) will be asked again, by design; "Search now" or "I don't know yet" is the way out.

**No optional "Update the list" once everything is answered (2026-11-12; you asked for it).** On Find grants, when the list is shown and no question is open, the optional text box ("Optional: add detail to refine the list.") and the "Update the list" button are hidden (`syncForm` in `public/js/discover.js`, using the new `state.openQuestions`). The "Include closed and archived" checkbox is hidden with them (you asked); Start over stays. After "Search now" the optional questions are still open, so the box stays so they can be answered. Not checked in a browser; no test covers it.

**The "Include closed and archived opportunities" checkbox is developer-only (2026-11-12; you chose developer mode only).** It no longer shows on the Find grants page unless developer mode is on (it carries `dev-only dev-section-apicalls`, the same section as the raw-requests option, so no new section was added). The hints that pointed to it were reworded for everyone else: the no-results summary and template now suggest describing the project in more detail, and the "Tick … above" line is shown only in developer mode. Checked in a headless browser: hidden with developer mode off, visible with it on. The earlier hide-when-finished code stays (it also applies in developer mode). Searching closed and archived listings is still available from the command line (`--historical`).

**Progress under the message just sent (2026-11-12; you asked for it).** While a Find grants turn runs, the progress panel (steps, bar, timer) now appears inside the conversation, directly under the applicant's message, instead of below the form (`progressStart` in `public/js/discover.js` moves the panel to the end of the thread each turn; it hides when the turn is done and the reply is added after it; in demo mode the finished panel stays there). Checked in a headless browser with a delayed mocked response: during the turn the thread was [user message, progress panel], the panel visible and below the message; afterwards hidden. The Assess tab already shows its progress in its own panel and was not changed.

**Jump buttons under the final Find grants reply (2026-11-12; you asked for them).** The reply that comes with the list now has three buttons: "Go to what I understood", "Go to the opportunities, best fit first", and "Go to the closest listing: <title>". Each scrolls to its part of the page and moves focus there (`jumpTo`, `jumpButton`, `closestButton` in `public/js/discover.js`; the two sections carry the ids `findUnderstood` and `findOpportunities`, and each listing card carries `data-opportunity-id`). The listing button no longer clicks the card's Prepare/Assess action; it only goes to the listing, where "Assess my project against this" (or Prepare) is on the card. A button is left out if its target is not on the page (for example no "what I understood" card when no facts were read). The reply wording was changed to match ("use the buttons under my message to jump to the list…", `src/nofo/discovery/reply.ts`). Checked in a headless browser with a mocked result: three buttons, each scrolls its target into view and receives focus. No test covers the buttons; the earlier mock replies in `reply.test.ts` still say "the button under my message", which is harmless.

**Assess progress inside the conversation (2026-11-12; you asked for it).** On the Assess tab the progress panel (steps, bar, timer) now sits in the "Describe your project" panel, directly under the message just sent, instead of in a separate card below it (`runTurn` in `public/js/nofo.js` moves `#nofoProgress` to the end of the messages each turn; it hides when the turn is done and the reply is added after it). Checked in a headless browser with the real opportunity list and a delayed mocked assessment: during the turn the messages were [intro, your message, progress panel] with the panel visible below your message; afterwards the panel was hidden and the reply followed it. Same behavior as Find grants.

**Detail questions made from the notice's requirements, and suggested answers in the drawer (2026-11-12; you asked for it; wording model-worded and code-checked; eligibility, funding and readiness first, then checklist items).**
- **Why.** The fixed questions only cover facts the app can read, so a requirement such as "State Highway Agency Consultation Documentation Required" or "Maximum four projects per application" stayed "not yet evaluated" (26 of 30 on the Oregon screenshot) and never produced a question.
- **Choosing** (`src/nofo/assessment/detail-questions.ts`, `detailCandidates`): unknown, mandatory findings with no missing fact, no machine check and no earlier answer, ranked eligibility, then funding, then readiness, then checklist; universal rules before conditional ones; near-identical titles asked once. Checklist (application) items are grouped by topic into one question that an answer stands for (up to four titles, worded by code: "Does your application meet these notice requirements: …?"). Fixed questions come first; detail questions fill the rest of the three per turn.
- **Wording** (`writeDetailQuestions`): the model rewrites a requirement as one yes/no question where "yes" means the applicant meets it; it sees only the requirement's own text, never the applicant. Code checks it with the same checks as the replies (one paragraph, ends with a question, no verdict, every number from the requirement's own text); otherwise a template from the requirement's title and page. Model wording is cached so a question keeps the same words.
- **Answers** (`answers.ts`): the page sends back the detail questions it showed with the next message; the model reads the reply against them, and code keeps an answer only if its quote is in something the **applicant** said and the question was open (a bare "yes" counts only when one question was asked). Stored as the applicant's own statement (`answer`, `quote`, the question as shown, the requirements it covers), validated by Zod (`DetailAnswersSchema`).
- **Effect** (`applyAnswers` in `assess.ts`): only on a requirement that is still unknown, never over a code check or a model reading. Yes = supported; no = possible conflict (eligibility, funding) or preparation gap (readiness, checklist); not sure = unchanged and not asked again. Always provisional, `method: 'answer'`, and the finding quotes the question: "You answered yes to: … That is your own statement; it has not been checked against the notice."
- **Page and drawer.** Answers travel like facts (`state.answers`, `askedDetails`, `skipDetails` in `public/js/nofo.js`), show in "What I am using from your words" as "Detail question" cards with Remove, and "I don't know yet" also sets aside the detail questions on screen. The Answers drawer has a new heading, "Details the notice asks about": each detail question has Yes / No / Not sure suggestions that name their question (`For "<question>": yes, we do.`), usable together; the complete replies use yes for well advanced and no for early.
- **Rule.** `CLAUDE.md` now describes fixed and detail questions and the checks on the model's wording.
- **Seen live (Colorado patrol, terminal).** First run: the "named in the notice" question plus two plain detail questions, each citing its requirement and page. Second run with a typed answer: both answers read with their quotes; the two findings moved (a yes became supported, a no became a possible conflict) with the question quoted; the next questions appeared. Headless browser with mocked results: the question renders, the drawer shows the three suggestions, copying one types it into the box, and the next request carries `asked` and the answers.
- **Rounds.** Three questions a turn. On the Colorado sample about 8 candidates before any checklist items and 6 checklist groups, so 3 to 5 rounds for a full pass; "I don't know yet" ends it at any point.
- **Not done / limits.** Tests were written (`detail-questions`, `answers`, `detail-schemas`, `assess`, `answer-suggestions`) but not run (paused); the existing service tests were adjusted for the extra calls and not run. "Yes means meets" is the model's phrasing and cannot be proved by code, which is why the question is quoted beside every result. Checklist wording is generic ("Does your application meet these notice requirements: …?") and can read stiffly for procedural items such as deadlines. Answers carry the question text the page sends back (display only). The Find grants side is unchanged.

**Suggested answers for every open requirement (2026-11-12; you asked for "an answers suggestion for all the requirements"; you chose "list every open requirement", template wording for those not asked).**
- **What.** The Answers drawer now has a closed section, "All other open requirements (N)", under the questions being asked. It lists every requirement that is still unevaluated (eligibility, funding, readiness and the application checklist), grouped by category, each with the same Yes / No / Not sure suggestions that name their question. On the Colorado sample that is 2 asked and 19 listed.
- **How.** `assessTurn` returns `openDetails`: every other detail candidate (up to 70) as a detail question with its category and its words (the template, or the model's wording if one was written for it earlier); no extra model call. `listedWording` and `Question.category` in `detail-questions.ts`. The page sends the asked questions plus the listed ones back as `asked` (up to 80, the listed ones marked `shown: false`), so a reply that answers any of them is read as an answer, in `readAnswers`.
- **Safeguards.** A bare "yes" is read only as the answer to the one question that was asked in the conversation (never to a listed one). A reply that restates a listed question's own words answers that question, whichever id the model picked (`named` in `answers.ts`); the live run first recorded an answer against a near-identical twin ("…for equipment requests" instead of "…to request equipment"), so that retargeting was added, and near-duplicate titles are now asked once (`similarTitles`, a word-overlap test).
- **Seen.** Headless browser with mocked results: the section shows "(3)" with Funding, Readiness and Application checklist headings; copying a suggestion types it into the box; the next request carries all four entries with the listed ones flagged. Live terminal run: answering a listed requirement with its suggested sentence records the answer against that requirement (with its quote) and moves its finding.
- **Not done / limits.** The listed wording is the plain template ("The notice says "<title>" (page N). Does your project meet this?"), which reads stiffly next to the model's wording for the questions being asked; it improves once a requirement has been asked once (the model wording is cached). A long list (about 20 here) is heavy to scan, hence collapsed. Tests were added (`answers`, `detail-questions`, `detail-schemas`, `answer-suggestions`) but not run (paused).

**One complete reply for all the other open requirements (2026-11-12; you asked for it instead of one-by-one suggestions; no tests were run).**
- **Drawer.** "All other open requirements (N)" now holds three complete replies (yes to all, no/not yet to all, not sure about all) instead of a card per requirement. Each reply is one sentence per requirement, in order, packed to fit one message (3,800 characters); if they do not all fit, the label says "the first N of M". A second, closed heading lists the requirements the replies cover, with their category (`buildOpen` in `public/js/answer-suggestions.js`, `renderOpenRequirements` in `public/js/answers-drawer.js`).
- **Reading it back** (`readSuggestedAnswers` in `src/nofo/assessment/answers.ts`). A long pasted reply is read in plain code, not by the model: each sentence (`For "<question>": yes, we do.`) names its question in full, so it is matched to exactly that question and the sentence is the verbatim quote. This is what the model got wrong earlier with near-identical requirements. The model is called only for anything else written in the message (and not at all when the message is only those sentences); the ones read in code are not sent to it again. The model's output limit was raised for longer replies.
- **Not run.** Per your instruction no tests and no live or browser checks were run; only the type-check (clean). Tests were written for the code reader, the "model only gets what is left" rule, and `buildOpen` (`answers.test.ts`, `answer-suggestions.test.ts`). The page was not looked at, so the layout of the three long reply cards is unchecked.

**The model chooses the kind of detail question (2026-11-12; you asked for it; kinds: yes/no, multiple choice, a number, a short description; "decide where code can, flag the rest").**
- **What changed.** The wording step no longer only rewrites a requirement as a yes/no question. For each requirement the model first decides what kind of question fits, gives a one-line reason (shown under the question as "Asked as a number: …"), and writes it: yes/no for having or doing something; a **choice** (2 to 4 options, each marked meets / does not meet / unclear) when the requirement lists categories; a **number** (with the comparison the requirement states) for a count, amount, percentage or duration; a **description** when a yes/no cannot settle it. `src/nofo/assessment/detail-questions.ts` (`DETAIL_PROMPT_VERSION` 2).
- **Checked in code** (`checkDetailSpec`): the kind is one of the four; the question ends with a question mark (a description may end with a period); a choice has 2 to 4 distinct options of which at least one meets; a number's figure must be in the requirement's own text (`numbers.ts`: digits, commas, amounts with a unit, percentages and number words, so "four" counts); the usual text checks (no verdict, markup or numbers that are not in the requirement). **Any failure falls back to the yes/no template.** Checklist groups and the drawer's listed requirements stay yes/no.
- **Answers by kind** (`answers.ts`, `applyAnswers` in `assess.ts`): yes/no as before; a choice needs a valid option index; a number must appear in the applicant's own quote and is **compared by code** ("You said 5 projects; the notice sets at most 4 projects"); a description is the applicant's own words and goes to **specialist review**; a choice counts as its option was marked; not sure is allowed for any kind. Still only on a requirement that is unknown, never over a code check or a model reading; always provisional, with the question quoted.
- **The spec travels with the page** (`asked[].spec`, `answers[].spec`) and is re-checked against the requirement's text on every request (`sanitizeSpec`), so it cannot make an answer count in a way the notice does not support; an answer whose spec no longer holds is dropped.
- **Drawer.** Suggestions follow the kind: one per option for a choice; a figure that meets the limit and one that does not (with the unit) for a number; a short description and a "still planning" one for a description; each names its question and is read in plain code (`readSuggestedAnswers`, now by kind), so a complete reply with mixed kinds works. The page shows the chosen option, the number, or "Described" on the answer cards.
- **Not done / limits.** Tests were written (`detail-questions`, `answers`, `assess`, `detail-schemas`, `numbers`, `answer-suggestions`) but not run (paused). "Meets" for a choice option is the model's mark and cannot be proved by code, which is why it is shown beside the finding. The open-requirements replies in the drawer stay yes/no. A question's reason and kind are model-written text, shown to the person but never used for a decision.

**A shorter "What I am using from your words" on Assess (2026-11-12; you found it busy and too long; you chose suggestions 1, 2, 3 and 5).**
- **Split.** The facts stay in "What I am using from your words" (cards, unchanged). The answers to the notice's questions moved out into their own closed section, "Your answers to the notice's questions (24) · 22 yes · 1 no · 1 not sure" (`answersPanel` in `public/js/nofo.js`). It opens by itself only for three answers or fewer, and stays as the person left it when the results are redrawn.
- **Compact rows.** Inside, one row per answer under Eligibility, Funding, Readiness and Application checklist: a fixed-width badge (Yes, No, the option chosen, the number, Described, Not sure yet), the requirement's own title (plus "+N related" for a grouped checklist question) and Remove. Clicking a row opens the existing modal with the full question and your own words (`ChipModal.open`).
- **Clear all answers**, with **Undo: restore N cleared answers** (kept until you send a new message, remove one answer, start over or switch opportunity). One click undoes a pasted complete reply.
- **"Not recorded" lines** are now one closed note: "3 statements could not be matched to your words, so they were not used".
- **Checked** in a headless browser with 6 facts, 24 answers and 3 rejected statements (mocked results): the answers section is 78px closed; opened, the groups show 6 rows each; a row opens the modal; Clear all sends no answers and shows the undo note; Undo sends all 24 back. A screenshot of the open section looked clean. Not done: suggestions 4 (compact facts) and 6 (finding status on each row); no test covers the new section.

**The follow-up questions are listed once, in the chat (2026-11-12; you saw the same three questions four times; you chose: put the card with sources inside the chat, and remove the "Tell us:" lines).**
- **Before:** the model's reply, the "To sharpen this, tell me" bullets in the chat, the "Questions that would sharpen this" card with sources, and three "Tell us:" lines in "Suggested next steps".
- **Now:** the questions appear once, under the model's reply in the chat message (`questionsBlock` in `public/js/nofo.js`): each question, the "Asked as a …" line, "Why it matters" with its "View source" link, the keep-asking note and "I don't know yet". The separate card below was removed, and "Suggested next steps" no longer has "Tell us:" lines (`buildAdvisory` in `src/nofo/advisory.ts`; the test was updated, not run). After "Remove" or "I don't know yet" (a re-check with no new message) the "Updated." chat message carries the remaining questions the same way.
- **Left as is:** the model's reply may still put a question in prose (it must end with one), and the Answers drawer is unchanged. The demo recordings in `public/demo` still contain the old "Tell us:" lines (they are replays of earlier runs).

**No copy-one-answer-at-a-time on Assess (2026-11-12; you asked for it).** In the Answers drawer on the Assess tab the "Or one question at a time" and "Details the notice asks about" cards are gone. The drawer shows only complete replies: "Answer everything at once" (one reply that answers every question being asked, for a well-advanced and an early-stage project) and, closed, "All other open requirements" (yes to all, no to all, not sure about all). `show` in `public/js/answers-drawer.js` skips the per-question cards when the mode is Assess; Find grants keeps them. Checked in a headless browser with a mocked result.

**"Or one question at a time" removed from the Answers drawer on both tabs (2026-11-12; you asked for it).** The drawer now offers only complete replies: "Answer everything at once" and, on Assess, the closed "All other open requirements" replies. The per-question copy cards (and their `renderQuestion`) are gone from `public/js/answers-drawer.js`, so this also applies to Find grants, which had kept them. The per-question suggestions are still built in `answer-suggestions.js` because the complete replies are made from them.

**A setting to hide the "Preliminary only" box on Assess (2026-11-12; you asked for it).** The Settings tray is now offered on Assess as well as Find grants, and each tab shows only its own switches (`data-settings-for` groups in `public/chat.html`, `applyMode` in `public/js/settings-drawer.js`). New: "Hide the Preliminary only box" for Assess (`AppSettings.hideAssessNotice` / `setHideAssessNotice`, key `grantflow.hideAssessNotice`, in `public/js/app-settings.js`); the box is shown by default, hidden when the switch is on, and the choice is remembered in the browser. The box now has the id `assessNotice`. Checked in a headless browser: on Assess the tray shows only the Assess switch, turning it on hides the box and survives a reload, and the Find grants tab shows its own two switches. Tests for the setting were added to `src/web/app-settings.test.ts` (not run); the existing test titled "offered with the Find grants view" is now out of date in its wording but its checks still hold.

**Only the well-advanced complete reply in the Answers drawer (2026-11-12; you asked for it).** "Answer everything at once" now shows a single card, "Complete reply" (the well-advanced version); the early-stage reply is no longer offered (`show` in `public/js/answers-drawer.js` filters on `stage === 'advanced'`). `buildReplies` still makes both in `answer-suggestions.js`, so its tests are unchanged. The closed "All other open requirements" replies (yes to all, no to all, not sure about all) are unchanged.

**Assess asks in at most three rounds, each sized from how many requirements are open (2026-11-12; you asked for it; this replaces "keep asking until answered" on Assess).**
- **Rule** (`planQuestionRound` in `src/nofo/assessment/questions.ts`, used in `assessTurn`): the questions still open (fixed ones plus detail questions made from requirements) are spread over the rounds that are left, so 24 open are asked as 8, 8 and 8; a round is never fewer than 3 (when that many are open) nor more than 10. After the third round nothing more is asked: what is still open stays unknown (never a pass or a fail) and can be answered from the Answers drawer ("All other open requirements"). The page carries `round` (request) and gets `questionRound: { round, of, open }` back; a turn that reads a new message starts the next round, while a re-check with no new message (Remove, "I don't know yet") stays in the round on screen. Fixed questions come first in each round, detail questions fill the rest.
- **Page.** The chat says "To sharpen this, tell me (round 1 of 3):", how many more can be asked about later, and after the last round one note that says so and where to answer the rest. The model reply is told to ask only the first one or two and say the others are listed below.
- **Seen live (Colorado sample, terminal).** 23 requirements open: round 1 asked 8 (1 fixed and 7 detail); with nothing answered, rounds 2 and 3 asked 10 each (the cap), and the fourth turn asked none ("round 3 of 3"). Sizes shrink as questions are answered, because they are re-derived from what is still open.
- **Not done.** The page changes were not looked at in a browser; the new tests (`planQuestionRound`, the `round` field) are written but not run. Find grants is unchanged (its questions are three fixed ones, two per round, and it keeps asking until they are answered or you choose "Search now"). `CLAUDE.md` was updated to match.

**Assess as a consultation (2026-11-12; from docs/BigBuild3_GrantFlow_ConOps.md; you chose my suggestions 1 to 4: stages, a consultant-shaped reply, what changed, where you stand).**
- **1. Three stages instead of three sized rounds** (`QUESTION_STAGES`, `pickStage`, `stageOfQuestionGroup`, `stageOfCategory` in `src/nofo/assessment/questions.ts`; `assessTurn`). Stage 1 "Who you are and whether the notice applies to you" (the named-in-the-notice, applicant, area and category questions, and eligibility requirements); stage 2 "Whether the money works" (request, cost and match, funding requirements); stage 3 "Whether you are ready to apply" (readiness items, the checklist). A new message moves on to the next stage that has anything open (empty stages are skipped); a re-check stays in the stage on screen and moves on only when everything in it is answered or set aside; after stage 3 nothing more is asked. At most 10 questions in a stage, the rest stay open and are listed in the Answers drawer. This replaces the earlier size-from-open-count rule. The chat shows "Step 1 of 3: <title>", one sentence on why that comes now (code-written), and how many more come in later steps.
- **2. A consultant-shaped reply** (`REPLY_PROMPT_VERSION` 8, `reply.ts`). The model is given the stage and what changed as code-written blocks and told to follow this shape: what you understood (or what the last answer changed), what matters most right now (one other finding at most; no list of everything), what looks fine in a clause, then a bridge into the next topic from the stage's "why" and the question or two. 90 to 180 words. The template fallback opens with the changes line and the stage's "why".
- **3. What changed** (`src/nofo/assessment/changes.ts`, `diffFindings`). The page sends each finding's last status (`previous`, validated, at most 300) with the next message; code compares: items that became supported are "settled", items that became a conflict or a review item from unknown or supported are "new concerns". The result carries `changes.line` ("Since your last message: 3 items settled (…), and 1 new concern (…).") which is shown in the results and given to the reply to open with.
- **4. Where you stand** (`Standing` in `src/nofo/advisory.ts`). The results lead with a bottom line written by code ("12 things may stand in the way or need a specialist's eye. The most important is …", or "Nothing you have told me stands in the way so far, but N requirements cannot be checked until I know more.") and three tiles (Looks workable, Needs attention, Can't tell yet) instead of "Of 71 requirements considered…". The old headline is still in the result for the CLI and older recordings.
- **Seen live (Colorado sample, terminal).** Turn 1: step 1 with the two eligibility questions, a reply that ends by bridging ("Before we get further into money and staffing details, I want to make sure the notice actually applies to your organization…") and asks the named-in-the-notice question; where you stand "12 things … most important is the award ceiling". Turn 2 (answers given): step 2 with ten funding questions, a reply that opens with what the answers settled, and "CHANGES: 3 items settled (…), and 1 new concern (…)". Headless browser with mocked results: stage header and why, the three tiles, the changes line, the request carrying `round` and `previous`, and the closing note after the last stage.
- **Not done / limits.** The new tests (`pickStage` and the stage maps, `diffFindings`, the `previous` field, the standing line, the stage and changes blocks in the reply) are written but not run. A stage can still ask up to ten questions at once (the funding stage did), which is long for a conversation; the cap could be lowered. The model's replies are still on the dense side. Suggestions 5 to 8 (consultant-voice question framing, specific next steps, a limits statement and a wrap-up summary) are not done. Find grants is unchanged.

**The model plans the question stages for each grant (2026-11-12; you asked whether it could, and chose to build it).**
- **What.** Instead of the same three fixed stages for every grant, one model call reads all the opportunity's requirements (id, title, category, topic, mandatory, "applies when", description cut to 200 characters) plus the ten fixed question groups, and proposes 2 or 3 stages for THIS grant: a title, a one-sentence "why", and which requirements and question groups go in each. It never sees the applicant. `src/nofo/assessment/stages.ts` (`planStages`, `validateStages`, `defaultStagePlan`).
- **Checked in code.** 2 or 3 stages; ids that are not requirements of the notice are dropped; a repeat keeps its first place; whatever the model leaves out is placed by the old static rule; titles and reasons pass the same text checks as the replies (no verdict, markup, or numbers not in the requirements); **every eligibility requirement and the "named in the notice" and "applicant" questions are forced into stage 1**; an unusable proposal gives the default three stages, with a reason code.
- **Saved and reviewable.** `data/opportunities/<uuid>/stages.json` (`PackageStore.readStages` / `writeStages`), with the hash of the requirements it was made from (a changed requirements file makes it stale), `source` ('model' or 'default') and `reviewStatus` (a person can set it to verified by editing the file). `npm run nofo:stages -- <uuid> [--refresh]` makes it; the extraction CLI makes it right after the requirements (best effort), so a grant prepared from the web gets its own stages. **The web server only reads it**: no model call or disk write was added to an Assess turn, and a grant with no plan, or a stale one, uses the three defaults. `questionRound.stage.source` says which was used.
- **Seen live.** Crash Causal Factors: "Confirm the Notice Applies to You" (11 requirements), "Prepare the Application Package" (39), "Work Out the Funding and Cost Rules" (24); Wildlife Crossings: "Confirm who can apply" (7), "Application, funding, and submission requirements" (20), "Readiness and risk factors" (6). So the plans differ by grant, and the model put the checklist-heavy package before the money for the first one. The Colorado sample's step 1 used the plan's title ("Confirm the Notice Applies to You") and asked three questions; without the saved plan it used the default title and asked two.
- **Not done / limits.** The tests (`stages.test.ts`) are written, not run. The other three prepared grants have no plan yet, so they use the defaults until `npm run nofo:stages -- <uuid>` is run for them. The model's order is its judgment and cannot be proved by code beyond the first-stage rule (for example it put the funding rules last for Crash Causal Factors); a person can edit stages.json. `data/opportunities/` is a git-ignored cache, so the generated plans are not committed. Stages are still capped at ten questions each and at three rounds.

**More human suggested answers (2026-11-12; you asked for it).** The Answers drawer's "Complete reply" was a code template ("For '<the whole question>': yes, we do.", one per question), which typed in like a form. Now the language model writes one natural example reply, in the applicant's voice, for the questions being asked.
- **How.** `src/nofo/assessment/suggest.ts` (`writeSuggestedReply`): one model call per turn, run at the same time as the conversational reply. It sees the facts already stated (money as dollars) and each question in order with its type, options and limit, and writes at most 130 words in the first person ("we"), folding each answer into a sentence that says something, mentioning each question's subject, with small believable invented details and no dollar amount that is not already in the facts or the questions. The prompt makes the applicant well prepared (yes with a detail, the option that meets, a figure within the limit, a short description), so it is the same "well advanced" reply as before.
- **Checked in code** (`checkSuggestedReply`, and two new limits in `src/nofo/reply-check.ts`: `allowVerdict` and `skipNumbers`, because the text is the applicant's voice and invented small figures are the point): plain text, at most 1,800 characters and two paragraphs, no markup, links, internal ids or question marks, no dollar amount outside the facts and the questions; a missing space after a sentence is mended. If there is no model or a check fails, the result carries an empty reply with a reason code and **the page uses the old template reply**. The drawer says it is an example written by the language model, made up, and says nothing true about the project.
- **Read back.** A pasted natural reply is read the normal way: the facts reader and the answers reader (prompt version 4 now says an applicant may answer several questions in running prose and to match each part by subject). The Answers drawer's other replies (the closed "All other open requirements") keep the code template, because each sentence there must name its requirement so it can be read without a model.
- **Seen live (Colorado sample, terminal).** The model's reply read like a person (it folded the named-in-the-notice answer and the capacity description into running sentences, with invented but consistent details such as four troopers and ten vehicles) and, sent back as the next message, settled five items and recorded the capacity answer with its quote. It was long (about 190 words) before the limit was tightened to 130; the tightened version was not re-run.
- **Not done / limits.** Find grants' guided-question suggestions are unchanged (they already read as sentences). The new tests (`suggest.test.ts`, the new `reply-check.test.ts` cases) are written, not run. A pasted natural reply is read by the model, so unlike the template it can be misread; the page shows what was recorded in "Your answers".

**Bug fixed: "The request is not valid: it needs an opportunity ID and 1-40 messages…" on the second message (2026-11-12; you reported it with an ITSE reply).** Cause: the id pattern I wrote for the new fields the page sends back (`previous`, `asked`, `skipDetails`, `answers`) was `^req-[0-9a-f]{4,16}$`, but the extractor also makes ids with a suffix when two requirements would collide (`req-f3e1a0c0-2`, `^req-[0-9a-f]{8}(-\d+)?$` in `src/nofo/extraction/schemas.ts`). A grant that has any such id failed validation as soon as the page sent the statuses back with the second message: ITSE (2 such ids) and Recalls (3). The other three prepared grants have none, which is why it had not shown up. Fix: `REQUIREMENT_ID_PATTERN` in `src/nofo/assessment/schemas.ts` now allows the suffix. Reproduced with the CLI on ITSE (the first message, then your reply as the second), found the failing field by validating the saved request, and confirmed the same reply now goes through (4 items settled, step 2 questions). A regression test was added to `detail-schemas.test.ts` (not run). The error text is still the generic one, since the route does not say which field failed; that is why it was hard to see.

**The first Assess reply explains the process (2026-11-12; you asked for it after the stages were planned).** On the first reply of a consultation (no question round yet, the message was read, there is something to ask, and no earlier assistant message) `assessTurn` gives the reply writer the steps planned for this grant (`process`: index and title, only the stages that still have open questions). The model, after showing it understood the project, says in a sentence or two that it will take the steps in order and starts with the first (reply prompt version 9; this first reply may run to 230 words). The same checks apply (the step numbers are in the material, so they are allowed, any other number is rejected), and the code template opens with "Here is how I would like to work: I will take this in N steps (...)". Later replies do not repeat it. Tests were written in `reply.test.ts` and not run.

**The Assess box and Send button go away when nothing is left to ask (2026-11-12; you asked for it).** After each assessment, if the result has no open questions (`questionRound.open === 0` and no questions in the message: everything answered or set aside), `setComposerDone` in `public/js/nofo.js` hides the text box, its label and Send, and shows a short note ("All of the questions have been answered, so there is nothing more to send…"). "Start over" stays. Because the check runs on every result, removing an answer (which re-assesses and reopens a question) brings the box back, and a reset or a change of notice restores it. If questions are still open but the three rounds are used up, the box stays, since the "last of my questions" note points to the Answers drawer. Not tested in a browser; only a syntax check and `tsc`.

**The Assess conversation grows instead of scrolling (2026-11-12; you asked for it).** `#nofoMessages` no longer has the 500 px maximum height and inner scroll (`public/css/style.css`; Find grants' thread is unchanged). A new assistant reply is scrolled to the top of the viewport (smooth, or instant with reduced motion) so its start is not missed (`addMessage` in `public/js/nofo.js`). Not tested in a browser; syntax check only.

**Suggested answers keep the federal request under $20 million (2026-11-12; you asked for it).** The suggested replies to the guided questions (`amounts` in `public/js/answer-suggestions.js`) used a default of $40 million total, $25 million request and $15 million match. The default is now $24 million, $15 million and $9 million, and a request the suggestions make up from other figures (from a stated total alone, or from a stated match alone) is capped at $19 million, with the total or match adjusted so total = request + match still holds. A request the applicant stated, or one that follows by subtraction from a stated total and match, is never changed, so the suggestions still do not contradict the conversation. The placeholder example in the Find grants box now reads $24 million / $15 million. Tests updated and a case added in `answer-suggestions.test.ts` (not run); `tsc` clean; amounts spot-checked in node.

**Demo script window (2026-11-12; you asked for it).** The floating menu has "Open the demo script window" (offered in every mode: demo on, off or recording, and on every page with the menu; it was first demo-mode only), which opens a separate browser window (`/demo-script.html`, sized for beside the app) with, in one place: the exact messages to paste into the app (the project description and the $15 million answer) each with a Copy button, and the live-app demo script one scene at a time (time, SHOW/DO, SAY with a Copy button, DIRECTING NOTE, and the fallback branch where the script has one), with Back/Next, arrow keys and time chips to jump. A collapsed "Before recording" list holds the setup steps.
- **One source.** The markdown (`docs/GrantFlow_BigBuild_Live_App_Demo_Script.md`) stays the only place the script is edited. `npm run demo:script` (`scripts/build-demo-script.mjs`, plain Node) turns it into `public/demo/demo-script.json`, which the window loads. After editing the markdown, run it again; the window says so if the JSON is missing or unreadable.
- **Safe.** Everything is rendered with `textContent`/elements (the markdown's bold and code marks are turned into elements), nothing is sent anywhere, and the window needs no demo mode. Files: `public/demo-script.html`, `public/js/demo-script.js`, `public/css/demo-script.css`, `public/js/floating-menu.js`.
- **Checked.** In headless Chromium over a static server: the page loads with no console errors, both Copy buttons put the right text on the clipboard, Next/chips move between the 8 scenes. Not checked: the popup opening from the menu in a real browser (a popup blocker could stop it; the menu click is a user action so it should be allowed). No unit tests for the converter.

**Copy in the script window types into the app (2026-11-12; you asked for it).** The Copy button next to each message in the demo script window now also types the message into the question box of the app window that opened it (Find grants or Assess, whichever is showing), through the app's own `DrawerKit.fillQuestion` (the same human-paced typing within 3 seconds as the Samples and Answers trays, replacing what is in the box), and still copies it to the clipboard. The SAY text keeps a plain Copy. If the window was not opened from the app's menu, the app page is closed, or its box is not available (another tab, or a request running), the message is only copied and the window says why. `window.opener` is read in a try/catch; the two windows are the same origin. Checked in headless Chromium with two pages: the project message typed into the Find box and was on the clipboard, the second message replaced it, and a directly opened script page fell back to the clipboard with the explanation. Not checked: Assess's box, or a real popup in a desktop browser.

**Samples and Answers tabs in the script window (2026-11-12; you asked for it).** The presenter window (`/demo-script.html`) now has three tabs: Script, Samples and Answers. The trays on the app page are unchanged.
- **Samples:** the same sample projects as the tray (`sample-projects.js`), with a filter box. Copy types the description into the app's question box (replacing what is there) and copies it, like the tray.
- **Answers:** the same made-up replies as the Answers tray, built with `answer-suggestions.js` from what the app last asked: the model-written "Complete reply" (or the template one) and the closed "All other open requirements" replies. It shows the answers for whichever tab the app has open (Find grants or Assess) and says so. A purple dot on the tab marks new suggestions while you are on another tab.
- **How the answers get there.** `public/js/presenter-link.js` (app page, loaded after the Answers tray) listens to the same two events the tray does (`assessresult`, `findquestions`) plus the tab change, and sends the latest state over a same-origin `BroadcastChannel` ('grantflow-presenter'), including when the window says hello. Nothing leaves the browser, and the app does not need the window open. Only plain data is sent (a JSON round trip). Reading the answers needs any open app page, not the opener; typing into the app's box still needs the window opened from the app's menu (`window.opener`), otherwise Copy only copies.
- **Code.** `public/js/demo-script-tabs.js` renders the two tabs; `demo-script.js` has the tab switching and shares its copy helpers as `window.DemoScriptKit`. The status line moved to a bar at the bottom. The arrow keys move between scenes only on the Script tab. The tabs repeat a little of the tray's rendering code (`answers-drawer.js` is tied to the tray's elements).
- **Checked** in headless Chromium with an app page and the popup: 26 samples, the filter (5 for "deer"), Copy typed a sample into the Find box; the Answers tab said nothing yet, then after a simulated `findquestions` event showed the reply and typed it into the box; the dot showed while on another tab. Not checked: a real Assess run, or the real popup in a desktop browser.

**"Paste into the app" removed from the script window (2026-11-12; you asked for it, now that the Samples and Answers tabs are there).** The Script tab no longer has the card with the two exact messages; its rendering, styles and the check for them in the loader are gone. The messages are still in `public/demo/demo-script.json` and in the "Before recording" list, and the project description is among the Samples and the funding answer comes from the Answers tab. The SAY blocks keep their clipboard-only Copy.

**A small toggle to hide the drawer tabs (2026-11-12; you asked for it).** A small round button at the bottom-right of the app page (`public/js/tray-toggle.js`, styles in `style.css`) hides the edge tabs of the slide-out trays (Samples, Answers, Dev, Settings) for a clean screen, and shows them again. It sets a `hide-tray-tabs` class on `<body>`; the choice is remembered in this browser (localStorage, in a try/catch). A tray that is open keeps its tab so it can still be closed (it also has its own close button). It sits just under the trays' layer, so an open tray covers it, and it is faint until hovered. It is not added on a page with no trays. Checked in headless Chromium: all four tabs visible, hidden after a click, still hidden after a reload, and back after a second click; no console errors. Not checked: how it looks while recording, or with the presenter window.

**Old `doc/` folder removed (2026-11-12; you said all of it was outdated).** The 14 files in `doc/` (the original architecture, chat route, MCP flow and usage, deployment, SAM API and web interface guides, an old multi-agent plan and dated copies) described the MCP-era app and nothing in the code or the other docs depended on them. They are deleted from the working tree and remain in git history. The README's Documentation section linked to some of them (and by paths that never existed); it now lists the current `docs/` files. The `/docs` viewer still lists `doc/` when it exists and shows nothing for it when it does not, so no code changed. Not touched: the README's body (it still describes the MCP server and SAM.gov tools), and the other files in `docs/` (the GovRail ConOps and presentation guide, `links-for-styling.md`, `presentation-instructions/`).
