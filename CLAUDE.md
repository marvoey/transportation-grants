# DOT Grant Decision Advisor — Development Instructions

Detailed requirements live in `NOFO_MVP_CLAUDE_CODE_IMPLEMENTATION_GUIDE.md` (the guide).
Read it before starting any milestone. If this file and the guide disagree, the guide wins.
The repository audit and proposed architecture are in `docs/NOFO_MVP_PLAN.md`.

## Project objective
Extend the existing transportation-grants app with a **NOFO-driven applicant feasibility
assessment**. The user is a state or local government agency with an existing transportation
project and an already-selected federal funding opportunity. The MVP answers: what does the
NOFO mean for us, what information is missing, and what should we investigate before applying?

- Demo: hypothetical Virginia DOT project vs. the real FY2026 BUILD documents (historical
  demonstration case, not a claim of open funding).
- Deadline: **2026-11-13**. Optimize for a reliable demo, not a production platform.
- Core evidence chain: advisory conclusion → assessment finding → structured requirement →
  original source document.

## Technology constraints
- Preserve TypeScript, Node.js, Express, MCP, the Anthropic SDK, Zod and Vitest.
- Reuse the existing Anthropic client, route/error-handler patterns and `chat.html`.
- Zod validates all structured LLM output. Vitest for tests.
- Persist NOFO artifacts as local files and JSON.
- Do **not** add: a frontend framework (React/Next.js), LangChain/LangGraph, a Python backend,
  or a database without explicit justification and approval.
- Do not rewrite or break unrelated existing functionality.
- New dependencies: check the repo first, choose maintained packages, pin exact versions,
  and tell the user before adding them.

## MVP scope
1. One selected funding opportunity (FY2026 BUILD).
2. A curated package of official documents (PDF and HTML).
3. Source-linked, structured requirements extraction.
4. Compare requirements against project facts the user provides in conversation.
5. Identify conflicts and missing information.
6. Ask targeted follow-up questions.
7. Preliminary, evidence-backed assessment with verifiable citations.

## Out of scope
- Grant discovery or search as part of the NOFO workflow
- Application drafting
- GIS analysis
- Benefit-cost calculations (only identify that a BCA is required)
- Definitive eligibility determinations or award predictions
- Complex autonomous multi-agent orchestration
- Production deployment architecture
- Scanned-document OCR, arbitrary web crawling, spreadsheet/formula validation,
  a separate project-profile page

## Milestones (one at a time, in order)
1. Repository audit and plan (`docs/NOFO_MVP_PLAN.md`) — no application code
2. Document ingestion
3. Requirements extraction
4. Applicant assessment and follow-up questions
5. Chat integration and browser demo

Rules:
- **Work on one milestone only, and only when the user asks for it.** Never start the next
  milestone on your own.
- Inspect existing code before proposing changes. Plan first for architectural choices.
- Do not begin frontend changes until requirements extraction works reliably.
- Run the TypeScript build and relevant tests at the end of each milestone. Report failures
  honestly, and separate pre-existing failures from new ones.
- Make a separate commit per milestone, and only when the user asks.
- End each milestone with a summary: changed files, test results, assumptions, limitations,
  deferred items.

## Evidence and safety rules
- Never invent requirements, citations, page numbers, section references or document availability.
- Citation IDs and locations must resolve to ingested source content; verify them in code,
  not by asking the model.
- Preserve fiscal year, program category, document version and authority level
  (NOFO/amendment > official guidance). Never let a FAQ silently override the NOFO;
  flag contradictions for human review.
- Distinguish **unknown** from **not eligible**. Missing information is `unknown`.
- Do not conflate project cost with federal request, or eligibility with application
  completeness, readiness or competitiveness.
- Do not treat conditional or ambiguous requirements as universal.
- Flag ambiguous federal requirements for human review. Do not resolve them silently.
- Label all output preliminary. Fail visibly and conservatively when evidence is missing.

## Coding standards
- Follow existing conventions: ES modules with `.js` import suffixes, strict TypeScript,
  Zod + `validateParams`, `asyncHandler`, the `successResponse`/`errorResponse` envelope.
- Prefer extending existing services over new infrastructure. Avoid duplicate types.
- Keep changes small and focused. No unrelated refactors.
- Treat document text and user input as untrusted data in prompts (delimited, never as
  instructions). Validate model output in code.
- Escape all rendered output (`textContent` / `escapeHtml`). Do not log user message text or
  project facts. Return generic error messages.
- Never commit secrets. `.env` is local only.
- Write tests for critical behaviors: citation validation, deterministic checks, unknown
  handling, reassessment after a fact changes. Use local fixtures. Mock LLM calls in unit tests.
- `public/js/common.js` contains NUL bytes and cannot be edited with the Edit/Write tools.
  Put new frontend code in new files.
