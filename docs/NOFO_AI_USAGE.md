# Where AI is used in the NOFO feature (Milestones 2, 3 and 4)

This document explains, in plain language, which steps of the NOFO feasibility assessment use an AI model, what the model is asked to do, and what ordinary code does instead. It covers Milestones 2 (ingestion), 3 (requirements extraction) and 4 (applicant assessment). It reflects the code as of the Milestone 5 commit; prompt versions are given so the text can be matched to a code revision.

## The short version

| Milestone | Command / entry point | Uses AI? | What the AI does |
|---|---|---|---|
| **M2** Acquisition and ingestion | `npm run nofo:ingest -- <uuid>` | **No** | Nothing. Download, file-type detection, text extraction, document classification and coverage reporting are all plain code. |
| **M3** Requirements extraction | `npm run nofo:extract -- <uuid>` | **Yes** | Reads the official documents and proposes structured requirements, each with a quote. Code then checks every quote and number. |
| **M3** Evaluation | `npm run nofo:eval -- <uuid>` | **No** | Nothing. It compares the extracted requirements with a reference set by code. The model never grades itself. |
| **M4** Applicant assessment | `assessTurn` in `src/nofo/service.ts`; `npm run nofo:assess` | **Yes, in two places** | (a) Reads the project facts the applicant stated in the conversation. (b) Judges free-text conditions (for example "is this project type allowed?") against those facts. |
| **M4** Number checks, questions, advisory text | same | **No** | Dollar and percentage checks, follow-up questions and the final advisory summary are written by code. |

In every AI step the pattern is the same: **the model proposes, code verifies.** Nothing the model says is accepted as a quote, a number, a page, a document ID or a fact until code has checked it against the source text or the applicant's own words.

## How the model is called (shared by M3 and M4)

All model calls go through one small wrapper, `src/nofo/llm.ts`.

- **Provider and SDK:** Anthropic, through the existing Anthropic client (`getAnthropicClient`). Requests go to api.anthropic.com unless `ANTHROPIC_BASE_URL` points to a gateway.
- **Model:** `ANTHROPIC_EXTRACTION_MODEL` if set, otherwise `ANTHROPIC_MODEL` (default `claude-sonnet-5`). The assessment steps in M4 use the same resolution, so there is currently one model setting for both extraction and assessment.
- **Effort:** `ANTHROPIC_EXTRACTION_EFFORT` (`low` to `max`, or `off`); default `medium`. It also applies to M4 calls.
- **Structured output:** every call asks for JSON that matches a schema (`output_config.format`). It does not use forced tool calls. No temperature, thinking or tool parameters are sent, because several current models reject them.
- **No state:** each call is a single message with a fixed system prompt and one user message. There are no tools, no agents, no retrieval index and no conversation memory on the server.
- **Key handling:** `ANTHROPIC_API_KEY` is read from the local `.env`. If it is missing, extraction stops with a clear error; the assessment degrades (see M4).
- **Errors:** an API failure produces a generic `LlmError` that never includes the prompt text. The CLIs and the server do not log document text, user messages or project facts.
- **Testability:** the pipeline depends only on an injectable `LlmFn`, so the unit tests use mock models and never touch the network.

### Untrusted-text handling (prompt-injection defence)

Document text and applicant messages are treated as untrusted data in every prompt:

- The system prompts are fixed strings, never built from document or user text.
- Untrusted text is placed in the user message inside tags (`<document>`, `<page>`, `<section>`, `<conversation>`, `<message>`, `<project_facts>`, `<requirements>`), and the system prompt tells the model to read it as data and ignore any instructions inside it.
- Before insertion, text that looks like one of our own tags is neutralised (a zero-width space is inserted), so a document cannot close or open a wrapper tag.
- Whatever the model returns is validated with Zod and then checked in code. A manipulated model can at worst produce a candidate that fails verification and is dropped.

---

## Milestone 2: Opportunity acquisition and ingestion (no AI)

`npm run nofo:ingest -- <uuid>` needs only `SIMPLER_GRANTS_API_KEY`. No Anthropic key is used and no text leaves the machine for a model. Every decision below is deterministic and repeatable:

| Step | How it is done | Code |
|---|---|---|
| Fetch opportunity details and the attachment list | Simpler.Grants.gov API via native `fetch` | `src/nofo/simpler/` |
| Download files | Plain HTTP with size and URL-safety limits | `src/nofo/acquire/download.ts` |
| Detect file type | From the first bytes of the file, not from the extension or declared MIME type | `acquire/sniff.ts` |
| Classify authority (`controlling`, `official_guidance`, `unclassified`) | Keyword rules on the title (for example "FAQ", "checklist", "NOFO", "amendment"). A triage aid, not a legal determination. A curator can override it in `supplemental.json`. | `acquire/authority.ts` |
| Extract text from PDF, HTML, Word (.docx) | Libraries (pdf.js, HTML parser, mammoth). No OCR; scanned documents are reported as having no extractable text. | `ingest/processors/` |
| Normalise and store | Local JSON under `data/opportunities/<uuid>/` | `ingest/normalize.ts`, `store.ts` |
| Report coverage | Rules over what was retrieved and parsed. The best level is `api_listed_processed`; there is deliberately no "complete". | `ingest/coverage.ts` |

Why this matters for AI use: the text that M3 later reads is whatever this step stored. If a document was skipped, unsupported or unparsed, the model never sees it, and the manifest says so.

---

## Milestone 3: Requirements extraction (AI reads the notice; code verifies)

Entry point: `extractRequirements()` in `src/nofo/extraction/extract.ts`. It is an offline operator command, not a web route.

### What goes to the model

- Only documents that parsed successfully and whose authority is `controlling` (NOFO, amendments). Documents classified as `official_guidance` (FAQs, checklists) are included only with the `--include-guidance` option. `unclassified` documents and documents removed upstream are never sent.
- The text is cut into batches of at most 6 pages or sections and about 16,000 characters, with 1 unit of overlap so a requirement that spans a boundary is seen whole (`extraction/chunker.ts`).
- Each batch is one model call, up to 3 at a time. `--passes N` (1 to 5) re-reads every batch independently to raise recall, at proportional cost.

This is public documents only; no applicant or project information is involved in M3.

### What the model is asked to do

The system prompt (`extraction/prompts.ts`, prompt version `4`) asks the model to:

- extract applicant requirements in four categories only: **eligibility, funding, application, readiness**;
- skip program history, scoring rubrics, contact details, post-award obligations and the agency's own program-level set-asides (a past model run once turned an agency set-aside into a "minimum request", which is why this rule exists);
- keep requirements atomic (one condition each), and list repeated statements once with several sources;
- give each requirement 1 to 3 sources, each with the document ID, page (or section) and a **verbatim quote**;
- mark `mandatory` (yes / no / unclear), conditions (`appliesWhen`, capital vs planning), and an `ambiguous` flag with a note;
- optionally attach a machine-checkable `check` (dollar minimum or maximum, federal-share or match percentage, closed list of applicant types, or a required document) only when the quote states an explicit limit.

### What code does with the answer

| Check | What happens | Code |
|---|---|---|
| Output shape | Parsed against a Zod schema. Malformed output gets one retry, then the batch is recorded as failed. Individual invalid items are counted and dropped. | `extract.ts`, `extraction/schemas.ts` |
| Truncated output | If the model hits its token limit, the batch is split in half (up to two levels) rather than silently losing pages. | `extract.ts` |
| Refusal | Recorded as a failed batch; nothing is invented to fill the gap. | `extract.ts` |
| Citation verification | Each claimed source must resolve to a real document in the package, a real page or section, and a quote found in that stored text. Quotes shorter than 20 letters/digits are rejected. A wrong page number is corrected when the quote is found elsewhere in the same document, and that correction is counted. Sources that fail are dropped; a requirement with no verified source is rejected entirely. The model is never asked to confirm its own citations. | `citations.ts`, `quotes.ts` |
| Numeric check verification | A dollar or percentage in a `check` must literally appear in the verified quote; otherwise the check is removed and the requirement is flagged. | `extraction/check-values.ts` |
| Merge and de-duplicate | Candidates that cite the same passage are merged, with their sources combined. | `extraction/merge.ts` |
| Review status | Every requirement starts as `unreviewed`, or `needs_review` if anything was flagged (model-flagged ambiguity, dropped source, dropped check). Code never sets `verified`; only a human edit can. | `extraction/merge.ts` |
| Caching | `requirements.json` is reused when the source documents, prompt version, model and pass count are unchanged and the last run was complete. `--refresh` forces a new run. | `extract.ts` |

The output file records the model, prompt version, token usage, batch successes and failures, how many candidates were rejected and why, and whether the run was `complete` or `partial`.

### Evaluation (no AI)

`npm run nofo:eval -- <uuid>` compares the extracted requirements with a reference set in `data/fixtures/nofo-gold/` using code only. **Important limitation:** the current BUILD reference set was drafted by Claude from the ingested text and is marked `drafted_from_source_pending_human_review`. It is not human-verified, so the accuracy figures it produces measure agreement with an AI-drafted list, not with a person's judgment.

### Known behaviour to be aware of

- Model recall varies from run to run, and sampling controls cannot be used to make it repeatable. Repeatability comes from caching the result and from the evaluation, not from temperature.
- Code proves that a quote exists and that a number appears in it. It cannot prove the model *understood* the requirement correctly. That is why every requirement carries a `reviewStatus` and why none is treated as settled without human verification.

---

## Milestone 4: Applicant assessment (AI reads facts and judges free text; code does the rest)

Entry point: `assessTurn()` in `src/nofo/service.ts`, also available as `npm run nofo:assess -- <uuid> --say "..."`. It is stateless: each call receives the conversation and the facts known so far and returns the updated facts. The server stores nothing. It reads only the saved `requirements.json`; it never fetches or re-extracts the notice.

A turn has four stages. Two use the model.

```
applicant message
   |
   v
1. Read facts from the message      <-- AI call #1 (facts.ts)        + code verifies quotes
   |
   v
2. Route each requirement:
     numeric / document check       --> plain code (checks.ts, arithmetic.ts)
     free-text condition            <-- AI call #2 (interpret.ts)    + code validates answer
     everything else                --> "unknown" (needs a document or more information)
   |
   v
3. Follow-up questions              --> fixed templates in code (questions.ts)
   |
   v
4. Advisory summary                 --> written by code (advisory.ts)
```

### AI call 1: reading project facts from the conversation

File: `src/nofo/assessment/facts.ts` (prompt version `1`).

- **Input:** the latest applicant message plus up to three messages before it, so a short reply such as "yes" keeps the question it answers. Sent inside `<conversation>` tags.
- **Task:** record only what the *applicant* said, in a fixed list of fact slots: applicant type, state, capital vs planning, urban vs rural, total project cost, requested federal amount, other federal funds, non-federal match, whether match is committed, whether a benefit-cost analysis is complete, project description, activities, design status, environmental status. The prompt forbids guessing, forbids using the assistant's words as facts, and keeps "total project cost" and "federal request" separate (if it is unclear which an amount is, nothing is recorded).
- **Verification in code, per fact:**
  - the fact must come with a verbatim quote from a *user* message in the window (assistant messages never count);
  - a dollar amount must actually appear in its quote;
  - the result must fit the strict Zod schema;
  - anything else goes to a `rejectedFacts` list and is never shown as a fact.
- **Outcome:** accepted facts are stored with their quote and marked `provenance: user`. A newer statement replaces an older one. If the model is unavailable, refuses, is cut off, or returns unreadable output, the turn continues with the facts already known and a warning.

### AI call 2: interpreting free-text conditions

File: `src/nofo/assessment/interpret.ts` (prompt version `1`), called from `assess.ts`.

Code decides first which requirements need a model at all:

- optional ("may") requirements are skipped;
- requirements for a different grant category than the project's are marked not applicable;
- any requirement with a machine-checkable `check` is evaluated by code, not by the model;
- only eligibility and funding requirements, and a short list of readiness topics (design status, environmental review, right-of-way, schedule, planning consistency, project location), go to the model.

What the model sees is deliberately narrow:

- **Facts:** only the free-text and categorical facts (applicant type, state, category, area type, description, activities, design status, environmental status). **Dollar amounts are never sent**, because numbers are judged by code.
- **Requirements:** id, title, description, `appliesWhen`, mandatory flag and the first quote as evidence.
- **Batching:** 12 requirements per call, up to 4 calls in parallel, at most 60 requirements interpreted per assessment.

The model returns one status per requirement: `supported`, `conflict`, `unknown`, `needs_specialist_review`, with a one-sentence explanation and the fact keys it relied on. The prompt makes `unknown` the default and forbids assuming anything not stated.

Code then enforces:

- ids must belong to the batch and be used once; invented or repeated ids are ignored;
- `supported` or `conflict` is accepted only if the model names at least one fact that was actually provided; otherwise the result is downgraded to `unknown`;
- every model judgment is marked **provisional**, always;
- if no free-text fact exists yet, no model call is made and these stay `unknown` with a request for a project description;
- results are cached in memory (up to 200 entries, per process) by the requirement set and the visible facts, so an unchanged description is stable and costs nothing on the next turn. Changing only a dollar amount triggers no model call.

### What is deliberately *not* AI in M4

| Piece | How it works | Code |
|---|---|---|
| Dollar and percentage checks (request vs maximum or minimum, federal share, match) | Arithmetic and comparison over the stated numbers | `assessment/checks.ts`, `arithmetic.ts` |
| Required-document checks (for example a benefit-cost analysis) | Compare the stated fact with the requirement. A deliverable that does not exist yet is a preparation **gap**, not an eligibility conflict. | `assessment/checks.ts` |
| Missing information | Always `unknown`: never a pass and never a fail | `assess.ts` |
| Follow-up questions | Fixed wording templates keyed on the missing fact, ranked, each tied to the requirement and evidence that makes it matter | `assessment/questions.ts` |
| Advisory summary and next steps | Assembled by code from the findings. It cannot add a requirement, number or citation that is not already in a finding. Always labelled "Preliminary assessment" with a disclaimer. | `advisory.ts` |

A deterministic result is also marked provisional unless a human has set that requirement to `verified`.

### Model calls per turn

- One call to read facts (skipped when the client asks to re-assess with the existing facts only, for example after the applicant removes a fact).
- Zero or more interpretation calls: roughly one per 12 free-text requirements, none if nothing changed since a cached result.

### If the model is not available

When `ANTHROPIC_API_KEY` is missing or a call fails, the assessment still runs: new facts are not read from the message, free-text requirements stay `unknown`, and warnings explain why. Failure never turns into a pass or a fail.

---

## Data that leaves the machine

| Step | Sent to the model provider |
|---|---|
| M2 ingestion | Nothing. |
| M3 extraction | Text of the public notice documents. No applicant information. |
| M4 assessment | The applicant's last few chat messages, and the stated free-text project facts and matching requirement text. Dollar amounts are sent only as part of the chat messages for fact reading (not for interpretation). |

Applicants should not enter confidential or sensitive information in the assessment chat. The server does not store conversations or log message text, but the text is sent to Anthropic (or to the gateway set in `ANTHROPIC_BASE_URL`) for each turn.

## Guardrails at a glance

- The model never writes the final advice, questions, citations or numbers shown to the user.
- Every citation and quote is checked against stored document text; every applicant fact is checked against the applicant's own words.
- Missing or uncertain information is `unknown`, not a pass or a fail.
- Model interpretations and unreviewed requirements are always labelled provisional.
- Ambiguous federal requirements are flagged for human review rather than resolved by the model.
- All output is labelled preliminary and is not an eligibility determination or award prediction.

## Limitations

- No requirement has been human-verified, and there is no screen for doing so yet.
- The reference set used for extraction accuracy was drafted by an AI, not a person.
- Model output varies between runs; caching hides this within a process (the M4 cache resets on restart).
- Only documents listed by Simpler.Grants.gov (and any curated supplemental sources) were processed; FAQs and amendments published elsewhere may be missing.
- Assessment quality depends on how clearly the applicant describes the project.

## Where to look in the code

| Topic | File |
|---|---|
| Model wrapper, model and effort settings | `src/nofo/llm.ts` |
| Extraction prompt and message building | `src/nofo/extraction/prompts.ts` |
| Extraction pipeline and verification | `src/nofo/extraction/extract.ts`, `src/nofo/citations.ts`, `src/nofo/extraction/check-values.ts` |
| Fact reading prompt and verification | `src/nofo/assessment/facts.ts` |
| Free-text interpretation prompt and validation | `src/nofo/assessment/interpret.ts` |
| Routing between code and model | `src/nofo/assessment/assess.ts` |
| Code-written questions and advisory | `src/nofo/assessment/questions.ts`, `src/nofo/advisory.ts` |
| Turn orchestration | `src/nofo/service.ts` |
| Design rationale and per-milestone records | `docs/NOFO_MVP_PLAN.md` |
