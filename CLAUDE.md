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
- Milestone 6 adds a front door: the user describes the project and the app builds Simpler search
  filters and shows a short list (4-5) of opportunities to consider. It keeps asking its questions
  (project type, applicant, federal request; two at a time) until they are answered, always offers
  "Search now" to skip them, and always ends with a list at the message limit. Assess is a consultation in
  three stages, at most one per message: who you are and whether the notice applies, whether the money works,
  whether you are ready by default, but the model plans the stages for each grant (`npm run nofo:stages`, saved as
  stages.json, run automatically after extraction; code checks it, forces everything about who may apply into the
  first stage, and falls back to the three defaults) (at most 10 questions in a stage); after the last stage what
  is still open stays unknown and can be answered from the Answers drawer. Each turn says what changed since the last message (code, from the
  statuses the page sends back) and the results lead with "where you stand" (code), not a requirement count. It
  offers "I don't know yet" to set questions aside.
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
  to other hosts). PDF/HTML parsing happens only in the ingestion path, never inside the web
  server process. The web "prepare" route (Milestone 6) runs the ingest and extract CLIs as
  child processes with a fixed argv and no shell.
- New dependencies: check the repo first, choose maintained packages, pin exact versions, and
  tell the user before adding them. Never override the user's npm credentials or registry
  settings to get an install through; ask instead.
- Do not rewrite or break unrelated existing functionality.

## MVP scope
1. A selected opportunity identified by a Simpler.Grants.gov UUID.
2. Retrieve opportunity details and the official attachments the API lists; allow manually
   curated supplemental sources (`supplemental.json`) added later.
3. Ingest PDF, HTML and Word (.docx); register every other format honestly as unparsed.
4. Extract structured, source-linked requirements.
5. Compare requirements against project facts the user gives in conversation.
6. Identify conflicts and missing information; ask targeted follow-up questions.
7. Provide a preliminary, evidence-backed assessment with verifiable citations.
8. (Milestone 6) From a project description, search Simpler.Grants.gov and present a short,
   explained list of opportunities to consider, then let the user prepare one for assessment.

## Out of scope
- Grant triage or ranking by competitiveness; a general-purpose discovery platform. The Milestone 6
  shortlist is a preliminary starting point, not a recommendation or an eligibility determination.
- Application drafting, GIS analysis, benefit-cost calculations (only identify that a BCA is required)
- Definitive eligibility determinations or award predictions
- Complex autonomous multi-agent orchestration; production deployment architecture
- OCR, arbitrary web crawling, spreadsheet/formula validation, a separate project-profile page
- Ingestion refresh (`--refresh`) or arbitrary-URL ingestion from the web. The Milestone 6 prepare
  route accepts only a UUID that appeared in a recent discover result, runs one job at a time, and
  is capped per day.

## Milestones (one at a time, in order)
1. Repository audit and plan (done)
2. Generic opportunity acquisition and ingestion (`npm run nofo:ingest -- <uuid>`)
3. Requirements extraction (`npm run nofo:extract -- <uuid>`, `npm run nofo:eval -- <uuid>`; BUILD FAQs/checklists/amendments may be added as supplemental sources)
4. Applicant assessment and follow-up questions (`assessTurn` in `src/nofo/service.ts`; `npm run nofo:assess -- <uuid> --say "..."`)
5. Chat integration and browser demo
6. Project-description-first "Find grants" flow (`npm run nofo:find -- "<description>"`,
   `POST /api/nofo/discover`, `POST /api/nofo/prepare`). Filter rules: hard-filter only on
   reliable fields (DOT agency, status, project-term query); applicant type, award size, cost
   sharing and funding category are scored in code, not filtered, because upstream metadata is
   often null or `other` (BUILD lists applicant type `other`). Ranking and the "why it may fit"
   text are written by code, not a model. Two model-written pieces sit beside the list: the short
   plain-language explanation of the search shown after the questions (built from the applicant's
   words, the exact request and the counts), and a conversational reply that introduces the list
   (built from what was understood, the first listings with the reasons and cautions code wrote, and
   the open question; it never recommends a program or speaks of eligibility). Both are checked in
   code (no links, markup or eligibility claims; numbers only as given), labelled as model-written,
   and replaced by a code template if they fail the checks (`src/nofo/reply-check.ts`).

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
- A requirement's `check` (a machine-checkable number or document) is only as good as its `reviewStatus`.
  Code verifies that the number is in the quote, not that it means what the model says (the model once
  turned an agency set-aside into a "minimum request"). The assessment always computes checks, but marks
  a result `provisional` unless a human has set the requirement to `verified`. Model interpretations are
  always provisional. Never present a provisional result as settled.
- Distinguish **unknown** from **not eligible**. Missing information is `unknown`: never a pass, never a fail.
  Project facts come only from what the applicant said, each with a verbatim quote verified against the
  applicant's own words (never the assistant's). A required deliverable that does not exist yet is a
  preparation `gap`, not an eligibility conflict. The findings, their sources, the follow-up questions and
  the advisory (headline and next steps) are written by code, never by a model. The conversational reply
  that opens an Assess turn is the one model-written piece, and it is kept separate: the model is shown only
  what code has already checked (the stated facts, the findings with their status, the questions), never the
  notice; code rejects any text with a dollar amount or number not in that material, a verdict on the
  applicant (eligible, ineligible, qualified, cannot apply), a prediction or recommendation, markup, links or
  internal ids, a missing question when one is due, or findings it was not shown; a rejected reply is
  replaced by a code template (`src/nofo/reply-check.ts`, `src/nofo/assessment/reply.ts`). It is labelled
  as written by the language model, preliminary, and never presented as settled.
- Assess asks two kinds of follow-up question. **Fixed questions** are templates over a fact the app reads
  (`questions.ts`). **Detail questions** are made from the notice's own requirements that no fixed question
  covers (`detail-questions.ts`): code chooses the requirements (unknown, mandatory, no code check, ranked
  eligibility > funding > readiness > checklist, checklist items grouped by topic), the model decides what kind
  of question fits each one (yes/no, a choice of 2 to 4 options each marked meets / does not meet / unclear, a
  number with the comparison the requirement states, or a short description) and words it from the
  requirement's own text, with a one-line reason shown to the person. Code checks everything it returns (same
  checks as the replies; a number's figure must be in the requirement's own text, so "four" counts; a choice
  needs distinct options of which one meets) and any failure falls back to the yes/no template. An answer is
  the applicant's own statement with a verbatim quote verified against the applicant's words (`answers.ts`; a
  number must be in the quote, a description is the quote itself). It only changes a requirement that is still
  unknown (never a code check or a model reading): a number is compared by code, a choice counts as its option
  was marked, a description goes to specialist review; it is always provisional, and the finding quotes the
  question beside it. A spec that comes back from the page is re-checked against the requirement's text.
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
- LLM calls use structured outputs (`output_config.format`), not forced tool use, and send no sampling,
  thinking or tool parameters (several current models reject them). The model proposes; code verifies
  citations, numbers and document IDs. A reference set drafted by the assistant is NOT human-verified.
- Untrusted file names are display-only: storage names and IDs are server-generated. Detect file
  type from content, not from the declared MIME type or extension.
- Escape all rendered output (`textContent` / `escapeHtml`). Do not log user message text or
  project facts. Return generic error messages.
- Write tests for critical behaviors using local fixtures; inject `fetch` and mock LLM calls.
  Skipped tests must be visible and explained.
- `public/js/common.js` contains NUL bytes and cannot be edited with the Edit/Write tools.
  Put new frontend code in new files.
