# NOFO MVP — Repository Audit and Implementation Plan (Milestone 1)

| | |
|---|---|
| **Status** | Milestone 1 deliverable — **awaiting review. No application code has been modified.** |
| **Written** | 2026-11-04 (Wed) |
| **Branch audited** | `nofo` @ `397cced` (= `main` + the guide + `.data/projects.json`) |
| **Demo deadline** | 2026-11-13 (Fri) — **7 working days after plan approval, no float** |
| **Source of truth** | `NOFO_MVP_CLAUDE_CODE_IMPLEMENTATION_GUIDE.md` (scope, exclusions, acceptance scenario) |

The only file created by this milestone is this one. I ran read-only commands (file reads, `git`, `npx tsc --noEmit`, `npx vitest run`, `npm view`, `npm audit`) and one WebFetch. I did not start the server, call the Anthropic API, or exercise the browser.

---

## 1. Executive summary

**The existing app is a good base.** It is a small, clean TypeScript/Express/MCP app (about 3,600 lines under `src/`) with three patterns we can reuse directly:

- **Route pattern:** Zod validation → `asyncHandler` → `successResponse`.
- **Structured LLM output:** a forced `tool_choice` call that returns schema-shaped JSON (`classifier-agent.ts`).
- **Stateless chat:** the browser holds the history and the server holds no sessions.

**What is missing is almost everything the NOFO workflow needs.** Today there is:

- no document ingestion
- no PDF or HTML parsing library
- no durable artifact store (the cache is TTL-based and keyed by hash)
- no test files at all on this branch
- no concept of a "selected opportunity" or "project facts"

**Recommended approach.** The NOFO feature is a **sequential, mostly deterministic pipeline inside one new module (`src/nofo/`)**:

1. **Offline** (CLI, run once, outputs committed): parse the curated documents into page-addressed JSON, then extract requirements with the LLM and verify every citation by string-matching against the page text.
2. **At request time:** one new endpoint takes `{opportunityId, messages, facts}` and runs fact extraction (LLM) → deterministic checks → batched LLM interpretation of the rest → question ranking → advisory narrative. The server renders the citations from structured data, never from model prose.
3. **Frontend:** a mode on the existing `chat.html` plus one new JS file.

**What I would not build:** multi-agent orchestration for NOFO mode, a database, sessions, file uploads, a project-profile page, or merging the unmerged `project-discovery` branch. See §8.

**Highest risks (detail in §7):**

1. The official documents cannot be fetched by automation. My WebFetch of the BUILD landing page returned **403**. I have not seen the real FY2026 documents, so page counts, layout and thresholds are unverified.
2. The gold set (15–25 manually verified requirements) needs human time. It is on the critical path and cannot be done by the LLM.
3. The schedule has no slack: 7 working days for 4 implementation milestones.

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
| Frontend | `chat.html` plus `chat.js` (81 lines). `common.js` has `escapeHtml`, `sanitizeUrl` and an allow-list `renderMarkdown` (h2/h3/p/br/strong/em/code/ul/ol/li/a; http(s) links only). | `public/` |
| Storage | `CacheManager` writes hashed-key JSON files with a TTL under `.cache/` (gitignored). The Grants.gov extract uses `data/`. | `src/cache/cache-manager.ts`, `src/data/xml-extractor.ts` |
| Tests | **None.** No `*.test.ts`, no `vitest.config.ts`. `npx vitest run` exits 1 with "No test files found". | — |
| Baseline | `npx tsc --noEmit` passes (exit 0). | — |

### 2.2 Reuse vs. new

| Need | Reuse | New (minimum) |
|---|---|---|
| HTTP surface | Router/envelope/`asyncHandler`/`errorHandler`; `chatRateLimiter` pattern | `routes/nofo.ts`, mount in `api-server.ts` |
| Structured LLM output | Forced-tool-choice pattern, `getAnthropicClient()`, `getConfig()` | One helper (`nofo/llm.ts`): call + Zod parse + one retry, with a per-call `max_tokens` override (the global default of 1024 is too small for extraction) |
| Validation | Zod, `validateParams` | `nofo/schemas.ts` |
| Frontend | `chat.html`, `chat.js`, `renderMarkdown`, `escapeHtml`, `sanitizeUrl`, `style.css` | Mode toggle in `chat.html`, a small hook in `chat.js`, new `nofo.js` |
| Persistence | Plain JSON files (matches the guide) | `data/nofo/<opportunityId>/…` committed artifacts. **Not** the TTL `CacheManager`: extraction output must be durable and reviewable. |
| PDF/HTML parsing | — | PDF parser and HTML parser (§4) |
| Tests | Vitest is installed | `vitest.config.ts`, test setup, fixtures |
| MCP | Shared schemas/executor | Nothing required for the MVP (optional stretch, §8) |

### 2.3 Gap analysis against the guide's target architecture

| Guide component | Current state | Plan |
|---|---|---|
| Opportunity Document Service | absent | `src/nofo/{manifest,ingest/*,store}.ts` |
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
5. **Logger and config coupling.** `logger.*` calls `getConfig()` on every call, and `loadConfig()` throws if `SAM_API_KEY` is unset. Any CLI or test that touches `logger` needs that env var. Tests need a setup file that sets a dummy value. `project-discovery` has `src/test-setup.ts` for the same reason. Ingestion/extraction CLIs must either set it or avoid `logger`.
6. **`public/js/common.js` contains 8 NUL bytes.** They are most likely the placeholder tokens in `renderInline`, and the file works. But the Edit/Write tooling refuses to modify it. **Plan: do not edit `common.js`**; new frontend code goes in a new file.
7. **Existing hardening gaps (pre-existing, not caused by this work):**
   - `ChatRequestSchema` has no max on message count or content length.
   - CORS falls back to `'*'` with `credentials:true` when `CORS_ORIGINS` is unset.
   - `logger.info` logs tool inputs.
   - `npm audit --omit=dev` reports high-severity advisories (`body-parser` DoS, `follow-redirects`, plus `fast-uri`), all marked fixable with `npm audit fix`.
   - New NOFO endpoints will not inherit these gaps (§3.9). Fixing the old ones is a separate decision for you.
8. **No `CLAUDE.md` exists** (the guide §3 asks for one), and the branch is `nofo`, not `feature/nofo-advisor-mvp`. I'd keep `nofo`, unless you want the guide's name.
9. **`doc/` vs `docs/`:** existing documentation is in `doc/`; you asked for `docs/NOFO_MVP_PLAN.md`, so `docs/` is new. NOFO docs go in `docs/`.
10. **Model ID history:** `doc/plan_1.md` records an earlier invalid model ID that caused `INTERNAL_ERROR`. M3 starts with a one-call smoke test of the configured model, before any batch extraction.
11. **Node version.** The dev machine runs Node v24.11.1. The README says "Node 18+" and the Dockerfile example uses `node:18-alpine`. The newest PDF library line requires Node ≥ 22.13 (§4). Since PDF parsing only happens in the offline CLI (§3.1), the runtime server is unaffected.

### 2.5 Guide-vs-repo discrepancies

- The guide says to run `npm test` as a baseline. Here that fails because there are no tests, and bare `vitest` starts watch mode. We will add a `test:run` script (`vitest run`).
- The guide's suggested `NofoRequirement` type is a good start but lacks fields needed for the guide's own scenarios: a verified-citation flag, program category (capital/planning), and a machine-checkable constraint. See §3.4.
- The guide's demo says "chosen capital-grant category". The applicability model must therefore carry the grant category and rural/urban status, or the BCA and match findings will be wrong. I have not seen the FY2026 NOFO, so I cannot say which thresholds differ by category. This must be confirmed in M2.

---

## 3. Proposed architecture

### 3.1 Principles

1. **Two phases.** *Offline* (parse documents, extract and verify requirements; outputs are committed JSON) and *online* (assess a project against those cached requirements). The NOFO is never re-parsed or re-extracted per request, and the runtime server never imports the PDF library.
2. **The LLM proposes; code verifies.** Citations, arithmetic, document IDs, page numbers and numeric thresholds are checked in code. We never ask the model to grade itself.
3. **Server owns the evidence chain.** The model's prose may reference requirement IDs only. The server resolves them to verified quotes, page numbers and source links. A citation therefore cannot be invented in prose.
4. **Unknown ≠ fail.** Missing facts produce `unknown`, plus a ranked question.
5. **Stateless.** The browser holds the conversation and the current `ProjectFacts`; the server holds nothing between turns. No database, no sessions, no cookies.
6. **Single module, no new frameworks.** Everything lives in `src/nofo/`, with one route file and one frontend file.

### 3.2 Data layout (committed; no database)

```
data/nofo/fy2026-build/
  manifest.json            # curated documents: id, title, url, format, authority, fiscalYear,
                           #   version/date, sha256, local path, expected page count
  raw/<docId>.pdf|html     # originals, so ingestion is reproducible (size/commit decision: §9 Q2)
  normalized/<docId>.json  # { documentId, pages:[{page, text, headings:[...]}] }  (HTML: sections)
  requirements.json        # extracted + verified requirements (schemaVersion, generatedAt, model)
  gold.json                # human-verified reference set (15–25) used by the eval script
```

The manifest `authority` is `controlling` (NOFO and amendments), `official_guidance` (FAQs, checklists, templates) or `applicant` (not used in the MVP; applicant facts come from chat). It also carries `supersedes?` and `fiscalYear`, so supporting material can never silently override the NOFO.

### 3.3 Module and file plan

**New files**

| File | Purpose |
|---|---|
| `src/nofo/schemas.ts` | Zod schemas and inferred types: Manifest, NormalizedDocument, Requirement, ProjectFacts, Finding, AssessResponse. Single source of truth. |
| `src/nofo/store.ts` | Read-only access to `data/nofo/…`. **Allow-lists IDs** (`^[a-z0-9-]{1,64}$` and must exist in the manifest). User input is never joined into a path. |
| `src/nofo/manifest.ts` | Load and validate the manifest; list coverage (which documents are ingested, which are missing). |
| `src/nofo/ingest/pdf.ts` | Page-by-page text extraction (+ heading heuristics by font size), dynamic-imported. |
| `src/nofo/ingest/html.ts` | Section-aware HTML → text. |
| `src/nofo/ingest/normalize.ts` | Whitespace/hyphenation/unicode/header-footer normalization, **shared with citation matching** so both sides use identical rules. |
| `src/nofo/ingest/cli.ts` | `npm run nofo:ingest`: verify sha256 against the manifest, parse, write `normalized/`. Reports unsupported or inaccessible documents explicitly and never fabricates content. |
| `src/nofo/llm.ts` | `callStructured({system, user, tool, schema, maxTokens})`: forced `tool_choice`, Zod parse, one repair retry, then a typed failure. |
| `src/nofo/extraction/{prompts,extract}.ts` + `cli.ts` | `npm run nofo:extract`: bounded page-window batches → candidate requirements → citation verification → dedupe → `requirements.json`. |
| `src/nofo/citations.ts` | `verifyCitation()` and `verifyAll()` (§3.5). |
| `src/nofo/assessment/facts.ts` | `ProjectFacts` schema, merge rules, and the fact-extraction call (with user-quote verification). |
| `src/nofo/assessment/checks.ts` | Deterministic evaluators for machine-checkable constraints (§3.6). |
| `src/nofo/assessment/assess.ts` | Applicability filter, deterministic checks, batched LLM interpretation of the rest, in-memory cache keyed by hash(facts, requirementsVersion). |
| `src/nofo/assessment/questions.ts` | Rank and cap follow-up questions (§3.7). |
| `src/nofo/advisory.ts` | Narrative summary and next steps from findings only; requirement-ID token resolution. |
| `src/nofo/service.ts` | Facade: `listOpportunities()`, `getSourcePage()`, `assessTurn()`. Routes and (optionally) MCP call only this. |
| `src/web/routes/nofo.ts` | HTTP endpoints (§3.8). |
| `public/js/nofo.js` | Mode UI, facts panel, findings cards, source drawer. Uses `textContent`/`escapeHtml` only. |
| `vitest.config.ts`, `src/test-setup.ts` | Test config (`include: src/**/*.test.ts`) and a dummy `SAM_API_KEY`. |
| `src/nofo/**/*.test.ts` + `src/nofo/__fixtures__/*` | Tests and local fixtures. |
| `scripts` entry `nofo:eval` (`src/nofo/eval/run-eval.ts`) | Compares `requirements.json` to `gold.json`; reports coverage and citation accuracy. Not part of `npm test`. |
| `docs/NOFO_DEMO.md` (M5) | Demo script, known limitations, benchmark notes. |
| `CLAUDE.md` (start of M2, if approved) | Merges the guide's project instructions. |

**Modified files (small, additive)**

| File | Change |
|---|---|
| `package.json` / lockfile | New deps (§4); scripts `nofo:ingest`, `nofo:extract`, `nofo:eval`, `test:run`. |
| `src/web/api-server.ts` | `import nofoRouter`; mount `/api/nofo` behind a rate limiter (reuse the chat limiter shape, same env vars). |
| `src/config/config.ts` + `.env.example` | Optional `nofo` block: `NOFO_DATA_DIR` (default `data/nofo`), `ANTHROPIC_EXTRACTION_MODEL` (default = `ANTHROPIC_MODEL`), `NOFO_MAX_TOKENS`. Existing `Config` interface in `src/types/index.ts` gains the matching fields. |
| `public/chat.html` | Mode switch ("Grant search" ↔ "Assess a project against FY2026 BUILD"), opportunity selector, facts panel and findings container, script tag. |
| `public/js/chat.js` | ~10-line hook: when NOFO mode is active, delegate the submit to `nofo.js`. Default behavior unchanged. |
| `public/js/api.js` | Add `assessNofo()`, `getNofoSourcePage()`, `listNofoOpportunities()`. |
| `public/css/style.css` | Styles for the facts panel and finding cards (additive). |
| `tsconfig.json` | Exclude `**/*.test.ts` from `tsc` output so tests don't ship in `dist/` (optional; `project-discovery` did not). |
| `README.md`, `doc/ARCHITECTURE.md` | Short NOFO section (M5). |

**Explicitly untouched:** `src/tools/*`, `src/clients/sam-*`, `src/mcp/*`, `src/server.ts`, `src/web/chat/*`, the other routes and HTML pages, and `common.js`.

### 3.4 Core types (adapted from the guide; Zod is the source of truth)

```ts
Requirement = {
  id, opportunityId,
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

- Only the facts the demo needs are typed. `applicantType`, `grantCategory`, `areaType` (urban/rural), `totalProjectCostUsd`, `requestedFederalUsd`, `nonFederalMatchUsd` and `matchCommitted`, `bcaCompleted`, `designStatus`, `environmentalStatus`. Everything else is free text for the LLM path.
- `Predicate` and `Check` cover only a handful of kinds, each with a deterministic evaluator and unit tests: `applicant_type_in`, `amount_min`/`amount_max` (federal request), `federal_share_max_pct`/`match_min_pct`, and `document_required` (e.g. BCA). Anything the extractor cannot express this way stays a plain, LLM-judged requirement.
- Money is stored as integer USD. `totalProjectCostUsd` and `requestedFederalUsd` are distinct fields. The guide says not to conflate them, and the arithmetic check `request + match vs. total` is deterministic.

### 3.5 Citation verification (the central quality gate)

For each source on each extracted requirement, code checks, in order:

1. `documentId` exists in the manifest (else **reject the source**).
2. `page` is within the document's page range (else reject).
3. `quote` appears, after `normalize()`, in that page's text (**pass → `verified:true`**).
4. If not on that page but found on another page of the same document → **fix the location, set `locationCorrected:true`**.
5. Otherwise → **drop the source**. A requirement with no surviving source is **rejected**, and counted in the extraction report.

HTML sources use the section ID instead of a page number. All of this is string matching and needs no LLM. The normalizer is the weak point: PDF text extraction can reorder columns or break words. It is therefore tested early against the real NOFO in M2, and fuzzy matching is a documented fallback if needed.

### 3.6 Deterministic vs. LLM judgment

- **Deterministic (code):** applicant type membership, request vs. min/max, federal share % vs. cap, match % vs. minimum, `request + match = total`, document-required flags (BCA), and the `unknown` rule (a missing fact makes the finding `unknown`, never pass or fail).
- **LLM (batched, Zod-validated):** requirements with no machine-checkable `check`. The model sees the requirement (with its verified quote) and the relevant facts, wrapped in delimiters as **data**, and must return a status, a one-sentence explanation, and the fact keys it used. The code rejects any status that cites facts which don't exist. An LLM-only `conflict` is shown as **"Potential conflict — verify"**. Only deterministic conflicts are shown as plain "Conflict".
- **Cross-document authority conflicts** (the guide's "FAQ vs NOFO" scenarios): compare `check` values for the same `topic` across authority levels in code. If they differ, flag `needs_specialist_review` and show both citations; **never pick one**. Non-numeric contradictions are a stretch goal (§8).

### 3.7 Questions

The code ranks candidate questions: requirements that are `unknown` solely because a typed fact is missing, ordered by (mandatory first, deterministic-check first, requirement `category`). It asks at most 3 per turn, and each question names the requirement it comes from. The question text is a template over the fact key, not free LLM generation. This guarantees every question traces to a source (the guide: "only when the applicable source requirement supports them").

### 3.8 API (new; all JSON, stateless, no cookies)

| Endpoint | Purpose |
|---|---|
| `GET /api/nofo/opportunities` | List opportunities with coverage: documents ingested/missing, requirement counts by reviewStatus. |
| `GET /api/nofo/opportunities/:id/documents/:docId/pages/:page` | Page text plus source URL and authority, for the "verify evidence" drawer. `:id`/`:docId` allow-listed; `:page` bounded integer. |
| `POST /api/nofo/assess` | Body `{opportunityId, messages[≤40, content ≤4000 chars], facts?}` → `{facts, findings[], questions[], advisory:{summary,nextSteps[]}, coverage, disclaimer}`. Strict Zod schema; unknown keys rejected. |

The per-turn LLM call budget is: fact extraction (1, small) → interpretation of non-deterministic requirements (1–3 batches, skipped if the relevant facts are unchanged) → advisory narrative (1). I estimate roughly 10–20 s per turn from that call count, which I have **not measured**. Unchanged facts hit the in-memory cache, so a repeat is instant. Changing one fact recomputes only what depends on it, and NOFO parsing and extraction are not rerun.

### 3.9 Security and safety design (per Optimizely secure-coding checklist)

- **Prompt-injection boundary.** The system prompt is fixed and separate from content. Document text, user messages and facts are passed inside delimiters as untrusted data. Models never receive tools that can act. The only tool is the forced "record results" schema. No MCP tools are reachable from NOFO mode.
- **Output validation in code.** Zod on every model output, plus citation verification, plus requirement-ID token resolution. Unknown tokens are stripped and flagged.
- **Fact provenance.** Each LLM-extracted fact must carry a `userQuote` that is verified as a substring of a *user* message. Otherwise it is discarded. This stops the model from inventing project facts.
- **Input limits (new endpoints).** Max messages/lengths as above, request body size left at the Express default (100 kB), and the same IP rate limit as chat. Rate limits are monitoring-first in spirit: start at the chat defaults (10/min) and tune from demo rehearsals.
- **No upload surface.** The MVP accepts no files. This removes upload/parser-exploit and stored-content risks. Applicant materials arrive as typed chat text only.
- **No runtime outbound fetches.** Documents are fetched/placed offline. There is no URL-taking endpoint, so no SSRF surface. Source URLs shown to users come from the manifest and are filtered by `sanitizeUrl` (http(s) only).
- **Path safety.** Allow-listed IDs resolved through the manifest; no user input in file paths.
- **Rendering.** Findings, quotes and explanations render via `textContent` or `escapeHtml`. Anything markdown-ish goes through the existing allow-list `renderMarkdown`. No new raw-HTML sinks.
- **Logging.** NOFO routes log IDs, counts and status codes only, **not** message text or project facts. Errors use the existing generic handler.
- **Dependencies.** Exact-pinned versions (no `^`) for the new libraries, lockfile committed, `npm audit` run before and after, licenses checked (§4). I recommend also running `npm audit fix` for the existing high-severity advisories as a separate commit, with your approval.
- **Data.** The demo project is hypothetical. A visible banner reminds users not to enter confidential or personal information. Project text is sent to the Anthropic API (or the configured gateway).

### 3.10 Frontend flow (reuses `chat.html`)

1. The user switches the mode, and the single opportunity is preselected. A banner shows "Preliminary assessment — not an official eligibility determination" and the document coverage ("N of M documents ingested").
2. The user describes the project. Each turn, `nofo.js` posts `{messages, facts}` and renders: a **Facts I'm using** panel (editable chips; the user can correct a fact and the assessment updates), **finding cards** grouped by status (conflict / unknown / needs review / supported) with citation chips, **up to 3 follow-up questions**, and a short **next steps** list.
3. A citation chip opens a drawer with the verified quote, document title and authority, page, and a link to the official source (PDF `#page=N` when applicable).
4. Honest failure states: documents not ingested, extraction rejected N requirements, the model returned invalid output → a visible message and no invented content.

---

## 4. Dependencies

Versions below were checked against the npm registry on 2026-11-04. Re-verify at install time, then **pin exactly**.

| Package | Purpose | Registry check | Notes |
|---|---|---|---|
| `pdfjs-dist` | PDF text per page, with positions for headings | latest 6.5.438, Apache-2.0, **Node ≥ 22.13 \|\| ≥ 24**. 5.6.205 supports Node ≥ 20.19. | Mozilla-maintained, page-addressable, no native build. Used only by the offline ingest CLI and dynamic-imported, so the server's Node floor doesn't change. Choose the 6.x vs 5.x line in M2 based on your Node version (dev machine is v24.11.1). |
| `cheerio` | HTML sections → text | 1.2.0, MIT, Node ≥ 20.18.1 | Needed only if HTML documents are in the curated set. **Defer if the package is all PDF.** |
| *(not adding)* `pdf-parse` | — | — | Thin, poorly maintained wrapper over an old pdf.js. Avoid. |
| *(not adding)* `unpdf` | — | 2.1.0, Node ≥ 24 | Unnecessary extra layer, and a higher Node floor. |
| *(not adding)* `zod-to-json-schema` | — | — | Handwrite the 3–4 small tool schemas (the existing pattern), or evaluate the SDK's built-in `helpers/zod` in M3. It may need a different Zod import path (we have Zod 3.25.76). |
| *(not adding)* XLSX library | — | — | Out of scope. |

Dev-only: no new devDependencies expected. A minimal valid PDF for test fixtures can be hand-generated in the test (a short string template), avoiding a PDF-writer dependency.

---

## 5. Milestones, calendar and acceptance criteria

**Calendar (working days to 2026-11-13).** These are my estimates, not measurements.

| Day | Plan |
|---|---|
| Wed 11/4 | **M1** — this plan; your review |
| Thu 11/5 | **M2** — docs acquired and ingested; ingestion tests; commit |
| Fri 11/6 | **M3a** — extraction pipeline + smoke test; start the gold set in parallel |
| Mon 11/9 | **M3b** — full extraction run, gold-set eval, fixes; commit. **M4 starts** |
| Tue 11/10 | **M4** — facts, deterministic checks, questions, scenarios; commit |
| Wed 11/11 | **M5** — endpoint + frontend; browser test |
| Thu 11/12 | Rehearsal, fixes, freeze, backup recording |
| Fri 11/13 | Deadline day, buffer only |

If the team observes the 11/11 federal holiday, M5 slips by a day into the buffer. Treat the plan as having **zero float**; the cut list in §8 is how we protect the demo.

### M2 — Document ingestion

- **Preconditions:** you supply the final document list and the files (§9 Q1). `rm -rf dist && npm run build`, add `vitest.config.ts`, `test-setup.ts` and `test:run`, add `CLAUDE.md`.
- **Work:** `manifest.json`, `store.ts`, `normalize.ts`, `ingest/pdf.ts` (+ `html.ts` only if needed), `ingest/cli.ts`, tests with local fixtures.
- **Acceptance (guide checkpoint):**
  - `npm run nofo:ingest` produces `normalized/<docId>.json` for every available document; page count matches the manifest's expectation.
  - **For 3 hand-picked requirements in the real NOFO, the exact sentence can be located by page number via the normalized JSON.** If not, we do not proceed.
  - An unavailable or unsupported document is reported as missing coverage and is not silently skipped.
  - Tests: PDF fixture → pages; HTML fixture → sections; hyphenation/whitespace normalization; sha256 mismatch fails; unknown ID rejected; path traversal attempt rejected.
  - `tsc` clean; `test:run` green.
- **Report back:** changed files, parsing limitations (tables, columns, headers/footers), sources needing manual review.

### M3 — Requirements extraction

- **Work:** `llm.ts`, `extraction/*`, `citations.ts`, `requirements.json`, `gold.json`, `nofo:eval`.
- **Scope:** eligibility, funding/financial, application-submission and selected readiness requirements. `evaluation` and `post_award` are extracted only as reference, never as assessment targets in the MVP.
- **Acceptance:**
  - **100%** of surviving sources have `verified:true` (by construction). The report lists how many candidate requirements and sources were rejected.
  - Zero requirements without a verified source.
  - Against the human-verified gold set (15–25), the eval script reports **coverage** and **citation accuracy**. Target: all gold items recovered, or each miss explained and fixed. If no gold set exists yet, the milestone report **states that limitation explicitly** rather than substituting model self-assessment.
  - Ambiguous items carry `reviewStatus:'needs_review'` and `mandatory:null`.
  - Re-running extraction is reproducible (temperature 0; output diffed).
  - Tests (mocked LLM): schema rejection, invented document ID rejected, wrong page corrected, unsupported quote dropped, dedupe across chunks, batch boundaries.
- **Critical path:** a human must write or verify the gold set from the actual documents. See §7 R2.

### M4 — Applicant assessment

- **Work:** `facts.ts`, `checks.ts`, `assess.ts`, `questions.ts`, `advisory.ts`, `service.ts`.
- **Acceptance (maps to guide §9):**

| Guide scenario | Test |
|---|---|
| Plausible state DOT + road project | Applicable applicant/project provisions found, with citations |
| Request conflicts with a verified maximum | Deterministic conflict with citation, not a vague warning |
| Matching funds unknown | `unknown` + a targeted question traceable to a requirement |
| BCA unavailable where required | Application-preparation gap with a source |
| Request amount changes | Affected findings recomputed; **no ingestion or extraction call** (asserted via mocks) |
| FAQ clarifies the NOFO | Clarification attached to the requirement; both authority levels shown |
| Unverifiable location/ID | Flagged for review; no invented citation (also covered in M3) |
| Supporting doc contradicts NOFO | `needs_specialist_review` with both citations; neither chosen silently |
| Unsupported/inaccessible document | Coverage message; no pretend processing |

  - The **demo scenario** ($25M project, $18M request, $7M state funds committed, no BCA) is a test with a mocked LLM. It asserts correct arithmetic, the BCA gap, unresolved items left as `unknown`, a cited conflict or support for each consequential conclusion, and the "preliminary" label. Whether the $18M/72% federal share is within FY2026 limits **depends on the real NOFO values, which I haven't seen.** The test fixture is written after M2/M3 provide the verified numbers.
  - Three scenario tests as the guide asks: plausible, conflict, missing information.

### M5 — Chat integration and browser demo

- **Work:** `routes/nofo.ts`, `api-server.ts` mount, `chat.html`/`chat.js`/`nofo.js`/`api.js`/`style.css`, `docs/NOFO_DEMO.md`.
- **Acceptance:**
  - In a real browser: select opportunity → describe project → answer questions → findings update → citation drawer shows the verified quote and a real source link → correct a fact and see findings change.
  - Existing chat mode still works as before (quick manual regression: a search question).
  - Route tests: validation limits, rate limit, unknown opportunity 404, no stack traces in errors.
  - Honest failure states visible (missing document, invalid model output).
  - `tsc` and `test:run` green; limitations documented.
  - **Backup:** a screen recording of a passing run and a rehearsal on the actual demo machine and network.

---

## 6. Testing strategy

| Layer | How |
|---|---|
| Unit (default `npm run test:run`) | Normalization, citation verification, checks, fact merge, question ranking, ID/path validation, response-token resolution. **Mock `getAnthropicClient`**; no network in CI. |
| Fixtures | Tiny hand-generated PDF and HTML fixtures with known text. Never use fabricated "official" text presented as real. Fixtures are labeled synthetic. |
| Route tests | Express app + a small HTTP helper (see `project-discovery`'s `src/web/test-http.ts` for a pattern; we write our own, as the branch is not merged). |
| Gold-set evaluation | `npm run nofo:eval` (manual, real data): coverage, unsupported claims, citation correctness, reviewer corrections count. |
| LLM smoke | One real call each for fact extraction, assessment and advisory against the demo scenario, run by hand before rehearsals. |
| Browser | Manual run of the full flow; the guide's checkpoint is the real browser, not just API responses. |

For the mission-impact benchmark in guide §10: record actual time-to-requirements with and without the tool on a small sample. **Do not report hypothetical savings as results.**

---

## 7. Risks and mitigations (ranked)

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | **Official documents can't be fetched by automation** (my WebFetch got 403). Real package contents, formats and page counts are unverified. | High / blocks M2 | You download the documents manually into `raw/`. The manifest records URL + sha256. I do not attempt to bypass access controls. Decide the document list on day one (§9 Q1). |
| R2 | **No gold set → no way to validate extraction accuracy**; this is the guide's "central technical risk". | High / blocks the M3 gate | A human reviewer starts the gold set on 11/6 in parallel. Even 15 items beats none. If it slips, say so in the report. |
| R3 | **PDF text extraction quality** (multi-column layout, tables, headers/footers, hyphenation, footnotes) breaks quote matching and headings. | Medium / high | Test on the real NOFO early in M2. Shared `normalize()`. Fuzzy-match fallback. Heading detection falls back to page-only citations. |
| R4 | **Conditional applicability** (capital vs planning; urban vs rural; thresholds differing by category) produces wrong findings if flattened. | Medium / high | `programVariant` and the `grantCategory`/`areaType` facts are first-class. If the category is unknown, the finding is `unknown` and a question is asked. |
| R5 | **Schedule: 7 working days, 4 milestones, no float.** | High / high | Strict milestone gates and the cut list (§8). Freeze on 11/12. |
| R6 | **LLM nondeterminism and latency at demo time.** Three sequential calls per turn could feel slow or fail on stage. | Medium / high | Temperature 0, cached extraction, in-memory response cache for the rehearsed scenario, visible progress state, backup recording, rehearsal on the demo machine. |
| R7 | **Hallucinated requirements or facts.** | Medium / high | Citation verification, user-quote verification, Zod, "reject, don't repair" for unsupported items, gold-set eval. |
| R8 | **Model ID / gateway problems** (previous incident in `doc/plan_1.md`). | Low-Medium / high | M3 begins with a one-call smoke test against the configured model and gateway. |
| R9 | **New dependency issues** (Node floor, transitive vulns, license). | Low / medium | Exact-pin, audit, dynamic import in the CLI only. |
| R10 | **Stale `dist/`, broken `data/` zip, tracked `.data/` file, pre-existing high-severity advisories** could cause confusing demo-day behavior. | Medium / medium | Clean build at the start of M2; housekeeping decisions in §9 Q6. |
| R11 | **Scope creep** from the other branch or from "nice" features. | Medium / high | §8 list. Each milestone reviewed before the next. |

---

## 8. Recommendations to simplify the MVP

1. **No multi-agent orchestration for NOFO mode.** The workflow is sequential. A single route calling `service.assessTurn()` is easier to test and demo than classify → retrieve → draft. The existing agents stay untouched for the search mode.
2. **Do not merge `project-discovery`.** It adds sessions, cookies, project CRUD and a separate UI, all of which the guide excludes. Facts live in the conversation and a client-held `facts` object. We may copy its Vitest setup pattern.
3. **Hardcode a one-entry opportunity registry** (the manifest). No multi-opportunity admin or search.
4. **Start PDF-only.** Add HTML/FAQ only if a needed requirement cannot be sourced from the NOFO itself. Skip XLSX entirely (the guide allows "identify that it's required").
5. **Restrict deterministic checks to ~6 kinds** (§3.4). The rest stays LLM-judged or `needs_specialist_review`.
6. **Extract only the four in-scope categories.** Aim for roughly the 40–80 requirements that matter to the demo path rather than exhaustive coverage.
7. **No streaming, no websockets, no persistence beyond JSON files.**
8. **Optional stretch (only after M5 is green):** expose `assess_project_against_nofo` as a read-only MCP tool through `tool-schemas.ts`/`tool-executor.ts`. It is cheap because of the `service.ts` facade, but it is not needed for the demo and widens the tool surface.

**Cut list if we fall behind (cut in this order):**
1. HTML/FAQ ingestion
2. Cross-document conflict detection (keep it as a documented limitation)
3. LLM interpretation of non-deterministic requirements (list them as "needs review" instead)
4. Editable facts chips (keep read-only)
5. Source drawer (fall back to plain text citations with page numbers)

**Never cut:** citation verification, `unknown` semantics, and the "preliminary" labeling.

---

## 9. Decisions and questions for you (before M2)

1. **Document list.** Which documents make up the curated FY2026 BUILD package (NOFO + amendments + which FAQs/checklists)? Can you download them manually, since automated access returned 403? I will then verify page counts and sha256 into the manifest.
2. **Commit the raw PDFs?** They are public federal documents and make ingestion reproducible, but they bloat the repo. My default is to commit them if the total is under ~25 MB.
3. **Demo scope within BUILD.** I assume the demo is a **capital grant**, with area type (urban/rural) treated as unknown until asked. Please confirm, since thresholds may differ by category.
4. **Model.** Add an optional `ANTHROPIC_EXTRACTION_MODEL` so the offline extraction can use a stronger model than the chat default? Is the `ANTHROPIC_BASE_URL` gateway in use for this work?
5. **Node floor.** OK to require Node ≥ 22.13 for the offline ingest CLI only (dev machine is v24.11.1; the runtime server is unaffected)?
6. **Housekeeping**, as separate small commits or left alone:
   - rebuild `dist/`
   - untrack and ignore `.data/projects.json`
   - run `npm audit fix` for the existing advisories
   - remove or replace the invalid `data/*.zip`
7. **`CLAUDE.md`.** Add it at the start of M2 (merging the guide's text)?
8. **Gold set.** Who verifies 15–25 requirements against the real documents, and by when (target 11/6–11/9)?
9. **Hosting.** Assume a local laptop demo (no deployment architecture)? If deployed, the Node 18 Dockerfile example in `doc/DEPLOYMENT.md` is outdated for our needs.
10. **Branch name.** Stay on `nofo`, or rename to the guide's `feature/nofo-advisor-mvp`?

---

## 10. Milestone 1 acceptance criteria

- [x] Entire guide read; scope, exclusions and acceptance scenario captured.
- [x] Codebase audited: Express routes, MCP tools, Anthropic integration, chat pipeline, `chat.html`/`chat.js`/`common.js`, storage and cache, config, tests, docs, git branches.
- [x] Current implementation compared with the guide's target architecture (§2.3).
- [x] Reusable functionality and the minimum new components identified (§2.2, §3.3).
- [x] Architecture proposed for ingestion, requirements extraction, assessment and advisory (§3).
- [x] Challenges, dependencies and unnecessary complexity identified (§4, §7, §8).
- [x] Files, dependencies, milestones, testing strategy and acceptance criteria documented (§3.3, §4, §5, §6).
- [x] **No application code modified.** Only `docs/NOFO_MVP_PLAN.md` was added.
- [ ] **Your review and approval** (required before M2).

### Not verified

- The actual FY2026 BUILD documents: contents, formats, page counts, thresholds and deadlines.
- Runtime behavior: I did not start the server, call the Anthropic API, or exercise the existing search/chat in a browser. The latency figures are estimates from call counts.
- The `@anthropic-ai/sdk` `helpers/zod` compatibility with Zod 3.25.76.
- Whether the configured model ID and gateway currently work.

### Files and sources inspected

`NOFO_MVP_CLAUDE_CODE_IMPLEMENTATION_GUIDE.md`, `package.json`, `tsconfig.json`, `.gitignore`, `.env.example` (variable names only), `src/web/*`, `src/web/chat/*`, `src/mcp/*`, `src/server.ts`, `src/clients/anthropic-client.ts`, `src/config/config.ts`, `src/utils/validators.ts`, `src/types/index.ts` (error class), `src/cache/cache-manager.ts`, `src/data/*`, `public/chat.html`, `public/js/{chat,api,common}.js`, `public/css/style.css` (chat selectors), `README.md`, `doc/{ARCHITECTURE,plan_1,MULTI_AGENT_CHAT_PLAN,DEPLOYMENT}.md`, git history and the `project-discovery` branch's file list, `vitest.config.ts` and chat route, the stale `dist/` tree, and `.data/projects.json` (structure only).
