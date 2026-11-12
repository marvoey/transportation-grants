# Where the AI model is used in GrantFlow and how code checks it

This document explains, in plain language, which steps of the app use an AI model, what the model is asked to do, and what ordinary code does instead. It covers ingestion (Milestone 2), requirements extraction (3), applicant assessment (4, now a staged consultation), and the Find grants front door (6). Prompt versions are given so the text can be matched to a code revision. It was last brought up to date on 2026-11-12.

## The short version

The app uses a model in **twelve places** (twelve separate prompts). In every one the pattern is the same: **the model proposes or words something; code verifies it, and a template written by code is used if the model is missing, fails or does not pass the checks.** Nothing the model says is accepted as a quote, a number, a page, a document ID, a requirement or a fact until code has checked it against the source text or the applicant's own words.

| Where | Entry point | Model's job | Prompt version | What code does with it |
|---|---|---|---|---|
| **Extraction** (once per grant, offline) | `npm run nofo:extract -- <uuid>` | Reads the notice and proposes structured requirements, each with a verbatim quote | 4 | Checks every quote, page and number; drops what fails |
| **Stage plan** (once per grant, offline) | `npm run nofo:stages -- <uuid>`, and after extraction | Reads all the requirements and proposes 2 to 3 conversation stages (title, reason, which requirements belong) | 1 | Validates ids, forces who-may-apply into stage 1, falls back to the default three stages |
| **Find: profile** | `POST /api/nofo/discover` | Reads the applicant's description into a small profile (project types, applicant type, request, search words) | 1 | Every value needs a verbatim quote; the search filters and ranking are code |
| **Find: explanation** | same | Writes a short plain-language note on what the search looked for | 1 | Checked text, or a template |
| **Find: reply** | same | Writes the conversational message that introduces the list | 3 | Checked text (`reply-check.ts`), or a template |
| **Find: project description** | `POST /api/nofo/project-description` | Joins what was said into one description to pre-fill Assess | none | Every number must already be in the applicant's words |
| **Assess: facts** | `assessTurn` (`POST /api/nofo/assess`, `npm run nofo:assess`) | Reads the project facts the applicant stated | 2 | Each fact needs a verbatim quote from the applicant's own words |
| **Assess: answers** | same | Reads the applicant's answers to the detail questions | 4 | Quote verified; a number must be in the quote; only moves a requirement that is still unknown |
| **Assess: interpretation** | same | Judges free-text conditions against the stated facts | 2 | Must name a fact it relied on; always provisional |
| **Assess: detail questions** | same | Decides what kind of question fits a requirement (yes/no, choice, number, description) and words it | 2 | Checks wording and numbers; falls back to a yes/no template |
| **Assess: reply** and **example reply** | same | Writes the conversational reply that opens each turn, and a made-up example answer for the Answers drawer | 9 and 2 | Checked text, or a template |

Not model work at all: downloading and parsing documents, requirement evaluation, all dollar and percentage checks, finding statuses, "where you stand", "what changed", the fixed follow-up questions, which questions are asked and in which stage, the shortlist's ranking and its reasons and cautions, the advisory, and the evaluation of extraction.

## How the model is called (shared by every step)

All model calls go through one small wrapper, `src/nofo/llm.ts`.

- **Provider and SDK:** Anthropic, through the existing Anthropic client. Requests go to api.anthropic.com unless `ANTHROPIC_BASE_URL` points to a gateway.
- **Model:** `ANTHROPIC_EXTRACTION_MODEL` if set, otherwise `ANTHROPIC_MODEL` (default `claude-sonnet-5`). There is one model setting for every step.
- **Effort:** `ANTHROPIC_EXTRACTION_EFFORT` (`low` to `max`, or `off`); default `medium`. It applies to every call.
- **Structured output:** every call asks for JSON that matches a schema (`output_config.format`). It does not use forced tool calls. No temperature, thinking or tool parameters are sent, because several current models reject them.
- **No state:** each call is a single message with a fixed system prompt and one user message. There are no tools, no agents, no retrieval index and no conversation memory on the server. The page sends back what a turn needs (facts, answers, questions just asked, the stage reached, earlier statuses).
- **Key handling:** `ANTHROPIC_API_KEY` is read from the local `.env`. If it is missing, extraction stops with a clear error; Find grants and Assess keep working with code templates and keyword reading (see "If the model is not available").
- **Errors:** an API failure produces a generic `LlmError` that never includes the prompt text. The CLIs and the server do not log document text, user messages or project facts.
- **Testability:** the pipeline depends only on an injectable `LlmFn`, so the unit tests use mock models and never touch the network.

### Untrusted-text handling (prompt-injection defence)

Document text and applicant messages are treated as untrusted data in every prompt:

- The system prompts are fixed strings, never built from document or user text.
- Untrusted text is placed in the user message inside tags (`<document>`, `<page>`, `<conversation>`, `<applicant_messages>`, `<project_facts>`, `<requirements>`, `<previous_reply>`, and so on), and the system prompt tells the model to read it as data and ignore any instructions inside it.
- Before insertion, text that looks like one of our own tags is neutralised (a zero-width space is inserted), so a document cannot close or open a wrapper tag.
- Whatever the model returns is validated with Zod and then checked in code. A manipulated model can at worst produce a candidate that fails verification and is dropped.

### Checking model-written text (`src/nofo/reply-check.ts`)

Four steps write words for a person to read: the Find explanation and reply, the Assess reply, and the example reply. The model cannot be proven right about words, so code limits what it may say, and the page labels the text as written by the language model and preliminary. A text passes only if it is plain, a bounded length and number of paragraphs, and has:

- no links, markup or internal ids (requirement ids, finding or listing handles);
- no dollar amount or other number that is not in the material the model was shown (the material is what code produced, never the notice for a reply), apart from small counts code supplies;
- no verdict on the applicant (eligible, ineligible, qualified, "cannot apply"), no prediction and no recommendation;
- a question when one is due and none when it is not;
- only findings or listings it was actually shown.

A text that fails any check is replaced by a template written from the same material, and the result records a short reason code (for example `number`, `verdict`, `no_question`) so a fallback is visible, never silent. The example reply is the one place invented small figures are allowed, because it is made-up applicant speech and is labelled that way.

---

## Ingestion (Milestone 2): no AI

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

Why this matters for AI use: the text that extraction later reads is whatever this step stored. If a document was skipped, unsupported or unparsed, the model never sees it, and the manifest says so.

---

## Requirements extraction (Milestone 3): AI reads the notice; code verifies

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

## Find grants: a project description first (Milestone 6)

Entry point: `POST /api/nofo/discover` (`src/nofo/discovery/service.ts`), also `npm run nofo:find -- "<description>"`. The applicant describes the project; the app builds Simpler.Grants.gov search filters and shows a short list of opportunities to consider. It is a starting point, not a recommendation or an eligibility decision.

```
applicant description
   |
   v
1. Read a profile                 <-- AI (profile.ts)    + quotes verified; keyword reader if no model
   |
   v
2. Guided questions (project type, applicant, federal request; two at a time)  --> code
   |
   v
3. Filters and search             --> code (filters.ts, search.ts): hard-filter only on reliable fields
   |
   v
4. Score and rank                 --> code (rank.ts): applicant type, award size, cost share, category;
   |                                  the "why it may fit" and "watch out" lines are written by code
   v
5. Explanation of the search      <-- AI (explain.ts)    + checked text, or template
   Conversational reply           <-- AI (reply.ts)      + checked text, or template
```

- **Profile.** The model reads only the applicant's messages and records project types, applicant type, phase, the federal request, total cost, state and up to four search words. Every value needs a **verbatim quote** from the applicant that code finds in their words; values without one are discarded, and search words must be supported by what the applicant wrote. When no model is configured, a keyword reader produces the profile, with the matched words as the quotes.
- **Filters and ranking are code.** Only reliable fields (DOT agency, status, the project-term query) are hard filters. Applicant type, award size, cost sharing and funding category are scored, not filtered, because upstream metadata is often null or `other`. A request above a listing's maximum award is a caution written by code.
- **Explanation and reply.** The explanation is built from the applicant's words, the exact request the app made and the counts. The reply is built from what was understood, the first listings with the reasons and cautions code wrote, and the open question. Neither sees the notices, so neither can add a requirement, number or date. Neither recommends a program or speaks of eligibility. Both pass the text checks above or are replaced by a template.
- **Project description.** `POST /api/nofo/project-description` joins what the applicant said into one description to pre-fill the Assess box. The model writes it from the applicant's own messages only, and every number in it must already appear in what they wrote. If it fails, their own messages are joined. They read and can edit it, and only what they send counts as their statement.
- **Prepare.** "Prepare this opportunity" runs the ingest and extract commands (and the stage plan) as child processes with a fixed argument list and no shell, for a UUID that appeared in a recent search, one job at a time, capped per day. Extraction is the only model use there.

---

## Assess: a staged consultation (Milestone 4, extended)

Entry point: `assessTurn()` in `src/nofo/service.ts`, served at `POST /api/nofo/assess` (streamed progress) and as `npm run nofo:assess -- <uuid> --say "..."`. It is stateless: each call receives the conversation and the state the page keeps (facts, answers, questions just asked, the stage reached, earlier statuses) and returns the updated result. The server stores nothing. It reads only the saved `requirements.json` and `stages.json`; it never fetches or re-extracts the notice.

The conversation is a consultation in at most three stages, at most one per message (who you are and whether the notice applies; whether the money works; whether you are ready, but planned per grant, see below), with at most ten questions in a stage. After the last stage, what is still open stays `unknown` and can be answered from the Answers drawer. The applicant can set questions aside ("I don't know yet"). Each turn says what changed since the last message (written by code from the statuses the page sends back), and the results lead with "where you stand" (written by code), not a requirement count.

```
applicant message
   |
   v
1. Read facts                       <-- AI (facts.ts)          + quotes verified against the applicant's words
   Read answers to open questions   <-- AI (answers.ts)        + quotes verified; only moves unknown requirements
   |
   v
2. Route each requirement:
     numeric / document check       --> code (checks.ts, arithmetic.ts)
     free-text condition            <-- AI (interpret.ts)      + code validates; always provisional
     everything else                --> "unknown"
   |
   v
3. Standing, changes, advisory      --> code (advisory.ts, changes.ts)
   |
   v
4. Pick the stage and questions     --> code (questions.ts, stages.ts):
     fixed questions                    templates over a fact the app reads
     detail questions                   <-- AI wording (detail-questions.ts): code picks the requirements,
   |                                        the model picks the kind of question and words it
   v
5. Conversational reply             <-- AI (reply.ts)          + checked text, or template
   Example reply for the drawer     <-- AI (suggest.ts)        + checked text, or the template reply
```

### Stage plan (AI, once per grant, offline)

File: `src/nofo/assessment/stages.ts` (prompt version `1`); `npm run nofo:stages -- <uuid> [--refresh]`, and run automatically after extraction. Instead of the same three topics for every grant, the model reads **all of the notice's requirements** (id, title, category, topic, mandatory, "applies when", description cut to 200 characters) and the ten fixed question groups, and proposes 2 or 3 stages for this grant, each with a plain title, a one-sentence reason spoken to the applicant, and which requirements and question groups belong to it. It never sees the applicant.

Code validates the plan: 2 or 3 stages; ids that are not in the notice are dropped; a repeated id keeps its first place; whatever the model leaves out is placed by the old static rule; titles and reasons pass the text checks; **every eligibility requirement and the "named in the notice" and "applicant" questions are forced into stage 1**; an unusable plan gives the default three stages. The plan is saved as `data/opportunities/<uuid>/stages.json` with the hash of the requirements it was made from (a changed requirements file makes it stale), and a person can review or edit it. **The web server only reads it**; a grant with no plan, or a stale one, uses the default three stages.

### AI call: reading project facts

File: `src/nofo/assessment/facts.ts` (prompt version `2`).

- **Input:** the latest applicant message plus up to three messages before it, so a short reply such as "yes" keeps the question it answers, inside `<conversation>` tags.
- **Task:** record only what the applicant said, in a fixed list of fact slots (applicant type, state, capital vs planning, urban vs rural, total project cost, requested federal amount, other federal funds, non-federal match, whether match is committed, benefit-cost analysis, project description, activities, design status, environmental status). The prompt forbids guessing and forbids using the assistant's words as facts, and keeps "total project cost" and "federal request" separate.
- **Verification in code, per fact:** a verbatim quote from a *user* message in the window (assistant messages never count); a dollar amount must appear in its quote; the result must fit the Zod schema; anything else goes to a `rejectedFacts` list.
- **If the model is unavailable,** the turn continues with the facts already known and a warning.

### AI call: reading answers to the questions

File: `src/nofo/assessment/answers.ts` (prompt version `4`). When detail questions were asked, the model reads the applicant's reply against them, and an applicant may answer several in running prose. An answer is the applicant's own statement with a verbatim quote verified against the applicant's words (a number must be in the quote; a description is the quote itself). It changes only a requirement that is **still unknown**, never a code check or a model reading: a number is compared by code, a choice counts as its option was marked, a description goes to specialist review. It is always provisional, and the finding quotes the question beside it. A reply copied from the Answers drawer is also read this way, and drawer sentences are read in code first.

### AI call: interpreting free-text conditions

File: `src/nofo/assessment/interpret.ts` (prompt version `2`), called from `assess.ts`. Code decides first which requirements need a model: optional ("may") ones are skipped, requirements for another grant category are not applicable, any requirement with a machine-checkable `check` is evaluated by code, and only eligibility and funding requirements and a short list of readiness topics go to the model.

- **Facts sent:** only the free-text and categorical facts. **Dollar amounts are never sent**, because numbers are judged by code.
- **Requirements sent:** id, title, description, `appliesWhen`, mandatory flag and the first quote. Batches of 12, up to 4 in parallel, at most 60 per assessment.
- **Returned:** one status per requirement (`supported`, `conflict`, `unknown`, `needs_specialist_review`), a one-sentence explanation and the fact keys relied on. `unknown` is the default; a rule that says what must be done is not "supported" just because it applies.
- **Enforced in code:** ids must belong to the batch and be used once; `supported` or `conflict` is accepted only if the model names a fact that was provided, otherwise it becomes `unknown`; every model judgment is **provisional**; results are cached in memory by the requirement set and the visible facts.

### AI call: detail questions

File: `src/nofo/assessment/detail-questions.ts` (prompt version `2`). A fixed question is a template over a fact the app knows how to read. A requirement such as "documentation that the state highway agency was consulted" has no such fact, so the requirement itself becomes the question. **Code chooses the requirements** (unknown, mandatory, no code check, ranked eligibility > funding > readiness > checklist, checklist items grouped by topic). **The model decides what kind of question fits** (yes/no, a choice of 2 to 4 options each marked meets / does not meet / unclear, a number with the comparison the requirement states, or a short description) and words it from the requirement's own text, with a one-line reason shown to the person. Code checks everything it returns: the same text checks as the replies, a number's figure must be in the requirement's own text, and a choice needs distinct options of which one meets. Any failure falls back to a yes/no template written from the requirement's title. The spec travels with the page and is re-checked when it comes back. What the model sees here is the notice's own requirement text, never the applicant.

### AI call: the conversational reply and the example reply

Files: `src/nofo/assessment/reply.ts` (prompt version `9`) and `suggest.ts` (version `2`); both run at the same time.

- **Reply.** The model is shown only what code has already checked: the stated facts, the findings with their status, the questions, the stage and what changed, and on the first turn the steps planned for this grant (so it can explain how the consultation will go). It never sees the notice. It writes a short consultant-style reply: what it understood or what the last answer changed, what matters most, what looks fine, and a bridge into the next topic with one or two questions. Code rejects any text with a dollar amount or number not in that material, a verdict, a prediction, markup, links or internal ids, a missing question when one is due, or findings it was not shown. A rejected reply is replaced by a code template. It is labelled as written by the language model and preliminary. The findings, their sources, the follow-up questions and the advisory themselves are never model-written.
- **Example reply.** For the Answers drawer, one natural reply in the applicant's voice with small invented details, consistent with the facts already stated. It is labelled made-up, says nothing true about the project, and falls back to the template reply. When pasted back, it is read like anything the applicant types, so invented details become provisional facts only if the applicant sends them.

### What is deliberately *not* AI in Assess

| Piece | How it works | Code |
|---|---|---|
| Dollar and percentage checks (request vs maximum or minimum, federal share, match) | Arithmetic and comparison over the stated numbers | `assessment/checks.ts`, `arithmetic.ts` |
| Required-document checks (for example a benefit-cost analysis) | Compare the stated fact with the requirement. A deliverable that does not exist yet is a preparation **gap**, not an eligibility conflict. | `assessment/checks.ts` |
| Missing information | Always `unknown`: never a pass and never a fail | `assess.ts` |
| Fixed follow-up questions, which stage, how many | Templates keyed on the missing fact, ranked; at most three stages and ten questions each | `assessment/questions.ts` |
| Where you stand, what changed | Counted and written by code from the statuses | `advisory.ts`, `assessment/changes.ts` |
| Advisory headline and next steps | Assembled by code from the findings; it cannot add a requirement, number or citation that is not in a finding. Always labelled preliminary. | `advisory.ts` |

A deterministic result is also marked provisional unless a human has set that requirement to `verified`.

### Model calls per turn

- Facts: one call (skipped when the client re-assesses with the existing facts only, for example after the applicant removes a fact).
- Answers: one call when detail questions were open.
- Interpretation: roughly one per 12 free-text requirements, none when nothing changed since a cached result.
- Detail-question wording: one call for the questions being asked now, cached per requirement.
- Reply and example reply: two calls, at the same time.

### If the model is not available

When `ANTHROPIC_API_KEY` is missing or a call fails, nothing turns into a pass or a fail. Find grants uses the keyword reader and the template explanation and reply. Assess does not read new facts from the message, free-text requirements stay `unknown`, detail questions are yes/no templates, and the reply and example reply are the code templates, with warnings and reason codes saying why.

---

## Data that leaves the machine

| Step | Sent to the model provider |
|---|---|
| Ingestion | Nothing. |
| Extraction | Text of the public notice documents. No applicant information. |
| Stage plan | The notice's requirement titles, categories and shortened descriptions. No applicant information. |
| Find grants | The applicant's description and later answers; what code understood from them and the first listings' titles, dates, award maximums and the reasons and cautions code wrote. |
| Assess | The applicant's last few messages; their stated free-text facts and the matching requirement text; the findings' statuses and the questions; requirement text for question wording. Dollar amounts are sent as part of the messages (for fact reading) and in the facts and findings shown to the reply writer, not to the interpretation step. |

Applicants should not enter confidential or sensitive information. The server does not store conversations or log message text, but the text is sent to Anthropic (or to the gateway set in `ANTHROPIC_BASE_URL`) for each turn. In demo mode (`?demo=1`) a recorded run is replayed in the browser and nothing is sent anywhere.

## Guardrails at a glance

- The model never writes the findings, their sources, the follow-up questions, the standing, the advisory or the shortlist's reasons. Where it writes words (replies, explanation, question wording), code checks them and a template replaces them on failure, with the reason visible.
- Every citation and quote is checked against stored document text; every applicant fact and answer is checked against the applicant's own words.
- Missing or uncertain information is `unknown`, not a pass or a fail.
- Model interpretations, answers and unreviewed requirements are always labelled provisional.
- Ambiguous federal requirements are flagged for human review rather than resolved by the model.
- All output is labelled preliminary and is not an eligibility determination, a recommendation or an award prediction.

## Limitations

- No requirement has been human-verified, and there is no screen for doing so yet. A stage plan can be edited by hand but is not reviewed either.
- The reference set used for extraction accuracy was drafted by an AI, not a person.
- Model output varies between runs; caching hides this within a process (the Assess caches reset on restart). Stage plans and extraction results are saved, so they stay the same until refreshed.
- The model's order of stages is its judgment; code only guarantees that everything about who may apply comes first.
- Code proves a quote exists and a number appears in it; it cannot prove the model understood the requirement. Replies and question wording cannot be proven true either, only held to the material.
- Only documents listed by Simpler.Grants.gov (and any curated supplemental sources) were processed; FAQs and amendments published elsewhere may be missing.
- Grants prepared before the stage plan existed use the default three stages until `npm run nofo:stages -- <uuid>` is run for them.
- Quality depends on how clearly the applicant describes the project.

## Where to look in the code

| Topic | File |
|---|---|
| Model wrapper, model and effort settings | `src/nofo/llm.ts` |
| Checks on model-written text | `src/nofo/reply-check.ts` |
| Extraction prompt, pipeline and verification | `src/nofo/extraction/prompts.ts`, `extract.ts`, `src/nofo/citations.ts`, `extraction/check-values.ts` |
| Stage plan | `src/nofo/assessment/stages.ts`, `stages-cli.ts` |
| Find grants: profile, filters, ranking, explanation, reply | `src/nofo/discovery/profile.ts`, `filters.ts`, `rank.ts`, `explain.ts`, `reply.ts`, `describe.ts`, `service.ts` |
| Assess: facts, answers, interpretation | `src/nofo/assessment/facts.ts`, `answers.ts`, `interpret.ts` |
| Assess: routing between code and model, checks | `src/nofo/assessment/assess.ts`, `checks.ts` |
| Assess: questions and stages | `src/nofo/assessment/questions.ts`, `detail-questions.ts` |
| Assess: replies | `src/nofo/assessment/reply.ts`, `suggest.ts` |
| Code-written standing, changes and advisory | `src/nofo/advisory.ts`, `src/nofo/assessment/changes.ts` |
| Turn orchestration | `src/nofo/service.ts` |
| Design rationale and per-change records | `docs/NOFO_MVP_PLAN.md` |
