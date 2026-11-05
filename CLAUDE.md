# DOT Grant Decision Advisor — Development Instructions

Detailed requirements live in `NOFO_MVP_CLAUDE_CODE_IMPLEMENTATION_GUIDE.md` (the guide).
Read it before starting any milestone. If this file and the guide disagree, the guide wins.
The audit, architecture, risks and per-milestone records are in `docs/NOFO_MVP_PLAN.md`.

## Project objective
Extend the existing transportation-grants app with a **NOFO-driven applicant feasibility
assessment**. The user is a state or local government agency with an existing transportation
project and an already-selected federal funding opportunity. The MVP answers: what does the
NOFO mean for us, what information is missing, and what should we investigate before applying?

- Opportunities are identified by a **Simpler.Grants.gov opportunity UUID** (direct input, or an
  ID from a search result). The UUID is not the official opportunity number: keep them separate.
- **No grant-specific code.** FY2026 BUILD is the primary test fixture and the demo case, and
  Wildlife Crossings is the second integration test. Neither is a hardcoded dependency.
- Demo: hypothetical Virginia DOT project vs. the real FY2026 BUILD documents (a historical
  demonstration case, not a claim of open funding).
- Deadline: **2026-11-13**. Optimize for a reliable demo, not a production platform.
- Core evidence chain: advisory conclusion → assessment finding → structured requirement →
  original source document.

## Technology constraints
- Preserve TypeScript, Node.js, Express, MCP, the Anthropic SDK, Zod and Vitest.
- Reuse the existing Anthropic client, route/error-handler patterns and `chat.html`.
- Zod validates all structured LLM output and everything read from disk or an API.
- Persist NOFO data as local files and JSON under `data/opportunities/<uuid>/`.
- Do **not** add a frontend framework, LangChain/LangGraph, a Python backend, or a database
  without explicit justification and approval.
- The Simpler.Grants.gov client uses native `fetch`, not axios (manual redirects, no key sent
  to other hosts). PDF/HTML parsing happens only in the offline ingestion path, never in the
  web server.
- New dependencies: check the repo first, choose maintained packages, pin exact versions, and
  tell the user before adding them. Never override the user's npm credentials or registry
  settings to get an install through; ask instead.
- Do not rewrite or break unrelated existing functionality.

## MVP scope
1. A selected opportunity identified by a Simpler.Grants.gov UUID.
2. Retrieve opportunity details and the official attachments the API lists; allow manually
   curated supplemental sources (`supplemental.json`) added later.
3. Ingest PDF and HTML; register every other format honestly as unparsed.
4. Extract structured, source-linked requirements.
5. Compare requirements against project facts the user gives in conversation.
6. Identify conflicts and missing information; ask targeted follow-up questions.
7. Provide a preliminary, evidence-backed assessment with verifiable citations.

## Out of scope
- Broad grant matching, triage, or a new discovery UI (a minimal UUID/search-result adapter is
  allowed)
- Application drafting, GIS analysis, benefit-cost calculations (only identify that a BCA is required)
- Definitive eligibility determinations or award predictions
- Complex autonomous multi-agent orchestration; production deployment architecture
- OCR, arbitrary web crawling, spreadsheet/formula validation, a separate project-profile page
- A web route that triggers ingestion (ingestion is an operator CLI because it needs the API key)

## Milestones (one at a time, in order)
1. Repository audit and plan (done)
2. Generic opportunity acquisition and ingestion (`npm run nofo:ingest -- <uuid>`)
3. Requirements extraction (BUILD FAQs/checklists/amendments may be added as supplemental sources here)
4. Applicant assessment and follow-up questions
5. Chat integration and browser demo

Rules:
- **Work on one milestone only, and only when the user asks for it.** Never start the next one.
- Inspect existing code before proposing changes. Plan first for architectural choices.
- Do not begin frontend changes until requirements extraction works reliably.
- Run the TypeScript build and relevant tests at the end of each milestone, and report results
  exactly. Separate pre-existing failures from new ones, and say what was skipped or blocked.
- Live checks that cannot run (missing key, blocked dependency) are reported as blocked, never as passed.
- Commit only when the user asks, one commit per milestone.
- End each milestone with a summary: changed files, test results, assumptions, limitations,
  deferred items. Keep `docs/NOFO_MVP_PLAN.md` current.

## Evidence and safety rules
- Never invent requirements, citations, page numbers, section references or document availability.
- Citation IDs and locations must resolve to ingested source content; verify them in code,
  not by asking the model.
- Preserve fiscal year, program category, document version and authority level
  (NOFO/amendment > official guidance). Never let a FAQ silently override the NOFO;
  flag contradictions for human review.
- Package coverage is `none`, `partial` or `api_listed_processed`, never "complete". Report
  missing, unsupported and unparsed documents, and record sources that may exist but were not acquired.
- Distinguish **unknown** from **not eligible**. Missing information is `unknown`.
- Do not conflate project cost with federal request, or eligibility with application
  completeness, readiness or competitiveness. Do not treat conditional requirements as universal.
- Flag ambiguous federal requirements for human review. Do not resolve them silently.
- Label all output preliminary. Fail visibly and conservatively when evidence is missing.

## Data and secrets
- `SIMPLER_GRANTS_API_KEY` lives in the local `.env` only. Never commit, log or echo it, and never
  put it in the manifest, an error message or a URL. Send it only to the API host.
- `data/opportunities/` is a git-ignored cache. Commit a demo or fixture package deliberately
  (`git add -f`) and only if it is small and stable. Never commit downloaded caches, temporary
  files, oversized artifacts, or raw API responses without a reason.
- `data/fixtures/` holds small stable test fixtures that are safe to commit.
- Live ingestion must work for any valid opportunity UUID.

## Coding standards
- Follow existing conventions: ES modules with `.js` import suffixes, strict TypeScript,
  Zod + `validateParams`, `asyncHandler`, the `successResponse`/`errorResponse` envelope.
- Prefer extending existing services over new infrastructure. Avoid duplicate types.
- Keep changes small and focused. No unrelated refactors.
- Treat API data, document text and user input as untrusted. In prompts, delimit it and never
  treat it as instructions. Validate model output in code.
- Untrusted file names are display-only: storage names and IDs are server-generated. Detect file
  type from content, not from the declared MIME type or extension.
- Escape all rendered output (`textContent` / `escapeHtml`). Do not log user message text or
  project facts. Return generic error messages.
- Write tests for critical behaviors using local fixtures; inject `fetch` and mock LLM calls.
  Skipped tests must be visible and explained.
- `public/js/common.js` contains NUL bytes and cannot be edited with the Edit/Write tools.
  Put new frontend code in new files.
