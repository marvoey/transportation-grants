# Big Build 3.0 — DOT Grant Decision Advisor
## Claude Code Implementation Guide for VS Code

**Purpose:** Repository-ready development brief and step-by-step implementation prompts for continuing work on [`marvoey/transportation-grants`](https://github.com/marvoey/transportation-grants) using Claude Code in VS Code.

**Primary instruction to Claude Code:** **Do not start writing application code when you first read this document.** Start with **Milestone 1: Repository audit and implementation plan**. Inspect the actual repository, verify assumptions, create `docs/NOFO_MVP_PLAN.md`, and stop for review. Implement later milestones one at a time only when instructed.

**Competition objective:** Demonstrate NOFO-grounded, applicant-specific analysis of an existing transportation project against an already-selected federal funding opportunity. Milestone 2 accepts a **generic Simpler.Grants.gov opportunity UUID**, obtained from a search result or direct input, and retrieves available official documents without grant-specific code. Broad grant matching, triage, and discovery UX remain outside this MVP.

---

# 1. Recommended Approach

Continue developing the existing transportation-grants repository in VS Code using Claude Code, with a **disciplined, milestone-based process**.

Use Claude Code as the lead implementation assistant, while the human developer serves as product owner and technical architect. Provide intended behavior, constraints, and acceptance criteria; then have Claude inspect the repository and propose how to implement each milestone.

**Do not hand Claude the entire Big Build concept and ask it to build everything at once.** That is likely to result in unnecessary architecture, changes to working functionality, and difficult-to-debug code.

The MVP is a **NOFO-driven applicant feasibility advisor**, not a general-purpose grant search chatbot. Its user is a state or local government agency with an **existing transportation project and an already-selected funding opportunity**. It should help answer:

> We have this transportation project and are considering this funding opportunity. What does the NOFO mean for us, what important information is missing, and what do we need to investigate before deciding whether to apply?

The final live scenario uses a hypothetical Virginia DOT capital improvement project evaluated against actual FY2026 BUILD documents. **BUILD is a primary test fixture, never a hardcoded opportunity dependency.** The same acquisition pipeline must also work for a second real opportunity. FY2026 BUILD is a **historical demonstration case**, not a claim of currently open funding.

---

# 2. Preserve the Existing Technology Stack

The repository's `package.json` has been verified as using **TypeScript, Node.js, Express, Anthropic's SDK, MCP, Zod, and Vitest**. There is no compelling reason to replace these technologies for the NOFO Analysis MVP.

| Existing technology | Intended use |
|---|---|
| TypeScript / Node.js | Implement NOFO processing and assessment services |
| Express.js | Add API endpoints for document processing and assessment |
| Anthropic SDK | Extract requirements, interpret evidence, and generate advice |
| MCP SDK | Retain existing grant tools and integrate additional capabilities where useful |
| Zod | Validate structured extraction and assessment results |
| Vitest | Test requirement extraction, citations, and assessment behavior |
| Existing `chat.html` | Applicant-facing conversation and assessment interface |

Do **not** introduce React, Next.js, LangChain, LangGraph, or a Python-based application framework unless the repository audit reveals a concrete and compelling reason. Avoid adding a database or Python backend initially. Preprocessed NOFO documents and extracted requirements can be persisted as local files and JSON for the competition prototype.

Milestone 2 also needs a Simpler.Grants.gov API client and generic opportunity-document acquisition pipeline. One practical parsing addition will be a PDF library, plus limited HTML parsing and eventually XLSX support. Choose compatible dependencies only after inspecting existing code. Never commit API credentials.

**Authoritative source for dependencies:** [`package.json`](https://github.com/marvoey/transportation-grants/blob/main/package.json). The actual checked-out repository takes precedence over this guide if it has changed.

---

# 3. Set Up Claude Code Safely in VS Code

1. Open the existing repository in VS Code.
2. Use the official [Claude Code VS Code extension](https://code.claude.com/docs/en/vs-code) or Claude Code in VS Code's integrated terminal.
3. Before making changes, create a dedicated branch and establish the existing baseline:

```bash
git checkout -b feature/nofo-advisor-mvp
npm install
npm run build
npm test
```

If the application already has failing tests, record them; do not misattribute preexisting failures to the new changes.

4. Add a root-level `CLAUDE.md` containing the project instructions below. Claude Code reads `CLAUDE.md` as persistent project guidance. If a `CLAUDE.md` already exists, **merge the new instructions carefully** rather than overwriting existing rules.
5. Start in Plan Mode for the repository audit; review the plan before allowing implementation.

## Proposed `CLAUDE.md` Content

Copy the following into the root-level `CLAUDE.md` (or merge into an existing one):

```markdown
# DOT Grant Decision Advisor — Development Instructions

## Project objective
Extend the existing transportation-grants application
with a NOFO-driven applicant assessment capability.

The user is a state or local government agency
considering an already identified federal funding
opportunity for an existing transportation project.

## Technology constraints
- Preserve TypeScript, Node.js, Express and MCP.
- Reuse the existing Anthropic integration.
- Reuse chat.html wherever practical.
- Prefer Zod for structured output validation.
- Use Vitest for testing.
- Do not introduce a new frontend framework.
- Do not introduce a database without justification.
- Do not rewrite unrelated application functionality.

## MVP scope
1. Work with a selected funding opportunity identified by a Simpler.Grants.gov UUID; no grant-specific hardcoding.
2. Retrieve opportunity details and available official attachments; allow manually curated supplemental sources.
3. Ingest PDF and HTML content, and register unsupported formats without implying coverage.
4. Extract structured, source-linked requirements.
5. Compare requirements against user-provided project facts.
6. Identify conflicts and missing information.
7. Ask targeted follow-up questions.
8. Provide a preliminary evidence-backed assessment.

## Not in scope
- Broad grant matching or a new discovery interface (a minimal ID/search-result adapter is allowed)
- Automated application drafting
- Comprehensive GIS analysis
- Benefit-cost calculations
- Definitive eligibility determinations
- Complex autonomous multi-agent orchestration
- Production deployment architecture

## Engineering rules
- Inspect existing code before proposing changes.
- Create an implementation plan before modifying code.
- Implement one milestone at a time.
- Do not invent NOFO requirements or citations.
- Preserve original document references.
- Distinguish unknown from not eligible.
- Write tests for critical behaviors.
- Run build and tests after each milestone.
- Summarize changed files and remaining limitations.
```

This should prevent architectural drift during later sessions.

---

# 4. The Target MVP and Architectural Boundaries

The MVP must demonstrate a **complete but narrowly scoped** workflow:

1. The applicant selects an **already identified opportunity** using a Simpler.Grants.gov UUID (from search results or direct input). The system ingests its available official documents and allows curated supplemental sources. **FY2026 BUILD is the primary demonstration fixture, not a hardcoded dependency.**
2. The applicant describes an existing transportation project.
3. The system identifies **applicable** NOFO requirements and the evidence for them.
4. The system asks targeted, consequential questions (such as intended federal request, matching funds, or benefit-cost analysis availability).
5. The system identifies supported conditions, conflicts, unknowns, and requirements needing specialist review.
6. The system returns a short preliminary feasibility assessment with **verifiable source references** and suggested next actions.

**The defining evidence chain is:**

> Advisory conclusion → Assessment finding → Structured requirement → Original source document.

### Multi-document opportunity packages

A funding opportunity is **not just a NOFO PDF**. A source package may include:

- Controlling documents: official NOFO and formal amendments.
- Official explanatory materials: application checklists, FAQs, guidance, instructions and templates.
- Applicant-provided materials: project descriptions, budgets, plans, studies and other facts supplied by the applicant.

Preserve the distinction between authority levels and fiscal-year versions. A supporting FAQ must not silently override a controlling NOFO or amendment. Identify conflicting statements and flag them for human review.

### Document formats

- **MVP ingestion:** Discover/download available attachments through the opportunity detail API; parse digital PDF and HTML. Preserve document IDs, original URLs, checksums, headings, pages (where available), and original text.
- **Limited/optional:** Download and register XLSX/DOCX and other attachment types; parse workbook names/instructions only if essential to a chosen scenario.
- **Explicitly out of scope:** Comprehensive spreadsheets/formula validation, GIS/shapefile processing, arbitrary web crawling, scanned-document OCR pipelines, application-form submission and full document-management workflows.
- It is sufficient to identify that the application **requires** an Excel BCA or spatial file; the system does not need to calculate the BCA or process the spatial file.

### Core technical responsibilities

**Opportunity Document Service:** Simpler.Grants.gov API client; UUID-based resolver; generic attachment acquisition; curated supplemental references; local manifest/cache; page/section-aware normalized content; source identity, retrieval status and authority metadata. The service must report partial coverage rather than silently declaring a package complete.

**Requirements Intelligence Service:** LLM-based extraction in bounded sections; Zod-validated requirements; applicability conditions; supporting evidence and citation validation; cached extraction output with review status.

**Applicant Assessment Service:** Compare project facts with requirements; supported/conflict/unknown/needs-specialist-review statuses; simple deterministic numeric checks; flag ambiguous conditions; reassess when facts change.

**Advisory Service:** Explain material findings; ask a few high-value questions; recommend investigative next steps; distinguish preliminary assessment from official eligibility determination.

**Web Integration:** Extend the existing `chat.html`. Do not build a new project-profile page or replace the frontend framework.

### Suggested types — adapt to existing code

```typescript
type NofoRequirement = {
  id: string;
  opportunityId: string;
  category:
    | "eligibility"
    | "funding"
    | "application"
    | "readiness"
    | "evaluation"
    | "post_award";
  title: string;
  description: string;
  mandatory: boolean | null;
  appliesWhen: string[];
  evidenceNeeded: string[];
  sources: Array<{
    documentId: string;
    page?: number;
    section?: string;
    text: string;
  }>;
  reviewStatus: "unreviewed" | "verified" | "needs_review";
};

type RequirementAssessment = {
  requirementId: string;
  status: "supported" | "conflict" | "unknown" | "needs_specialist_review";
  explanation: string;
  projectFactsUsed: string[];
  sourceDocumentIds: string[];
};
```

Use these as conceptual contracts only; do not duplicate types unnecessarily if the repo already contains equivalent abstractions.

---

# 5. Development Plan: Five Milestones

Build in this order and **stop at the end of each milestone for review and a commit**.

| Milestone | Scope | Deliverable | Phase gate |
|---|---|---|---|
| 1. Audit and plan | Inspect architecture, routes, chat, AI, MCP, storage and tests | `docs/NOFO_MVP_PLAN.md`; **no application code changes** | Review and approve proposed changes |
| 2. Generic opportunity ingestion | Accept Simpler.Grants.gov UUID; fetch metadata, download available attachments, process PDF/HTML; record other formats and gaps | Reusable opportunity manifest, local cache and normalized source content | Run BUILD and a second opportunity without grant-specific code |
| 3. Requirements extraction | AI extracts and classifies source-grounded requirements | Validated requirements JSON and evaluation fixtures | Critical requirements and citations verified against sources |
| 4. Applicant assessment | Compare project facts with requirements and ask questions | Tested assessment service | Correctly identifies supported/conflict/unknown in scenarios |
| 5. Chat integration | Add selected opportunity and assessment workflow to existing chat | Working end-to-end demonstration | Successful browser flow, build and tests |

Do not begin frontend changes until the requirements extraction service is working reliably. The central technical risk is not UI rendering: it is **correct extraction and evidence traceability**.

---

# 6. Exact Claude Code Prompts

Run the following prompts **sequentially**, not together. The first prompt should run in **Plan Mode**. Allow Claude to inspect the actual repository before implementation.

## Milestone 1 — Repository Audit (do not modify application code)

```text
Review this entire repository to determine how best to implement a NOFO-driven applicant assessment MVP.

The objective is to allow a state DOT to analyze a selected federal funding opportunity against an existing transportation project.

Identify the current application architecture, web routes, chat implementation, Anthropic integration, MCP tools, data storage conventions, and tests.

Recommend the smallest changes necessary to add document ingestion, requirement extraction, project-specific assessment, and source-backed advice.

Preserve the existing technology stack and functionality.

Create docs/NOFO_MVP_PLAN.md containing the proposed architecture, files to modify or add, dependencies, implementation milestones, risks, and acceptance criteria.

Do not modify application code yet.
```

### Audit review guidance

Inspect the plan before approving code changes. Challenge proposals for:

- A new frontend framework.
- A major rewrite or duplicate backend architecture.
- A new database without a concrete need.
- Autonomous multi-agent orchestration for a sequential workflow.
- New functionality unrelated to applicant-specific NOFO assessment.

## Milestone 2 — Generic Opportunity Acquisition and Document Ingestion

**This replaces the original BUILD-specific ingestion step.** The same code must accept a Simpler.Grants.gov opportunity UUID returned by a search result or supplied directly; it must not contain program-specific branches. The BUILD opportunity is used only as a test case.

```text
Read NOFO_MVP_CLAUDE_CODE_IMPLEMENTATION_GUIDE.md, CLAUDE.md (if present), and docs/NOFO_MVP_PLAN.md before starting.

Implement Milestone 2 as a GENERIC Opportunity Document Acquisition and Ingestion Service based on Simpler.Grants.gov. Update docs/NOFO_MVP_PLAN.md to reflect this agreed change before implementation; do not replace the rest of the plan or add unrelated features.

OBJECTIVE
Given a Simpler.Grants.gov opportunity UUID from a search result or direct input, retrieve opportunity details and available attachments, process supported document types, and save a traceable, reusable opportunity package. No opportunity-specific code. FY2026 BUILD is a PRIMARY TEST, not a hardcoded input.

1. Verify API contract first
- Consult current official API documentation: https://simpler.grants.gov/developers
- Base URL: https://api.simpler.grants.gov
- Verify the exact request/response schemas and authentication for search (POST /v1/opportunities/search) and detail (GET /v1/opportunities/{opportunity_id}), including attachment metadata and the supported download mechanism. Do not guess attachment fields, public URLs, or pagination behavior.
- Keep API keys server-side in environment variables; do not commit credentials.

2. Reusable API client and opportunity resolver
- Reuse existing TypeScript HTTP utilities where sensible.
- Implement getOpportunity(opportunityId: string) using a validated UUID.
- Normalize title, official opportunity number, source UUID, agency, status/dates, description, funding metadata and document references when available.
- Add timeouts, bounded retries/backoff, useful error responses and rate-limit handling.
- Preserve the official opportunity number separately from the API UUID.

3. Input contract and minimal selection
- Implement ingestOpportunity(opportunityId: string) as the stable entry point.
- Accept an ID originating from existing search results or direct UUID input. Provide a minimal test CLI or API route; a search-result adapter is optional if existing search can supply the ID cleanly.
- Do not build a new grant-search UI, grant matching, triage, or a general discovery feature.

4. Generic document acquisition
- Inspect the detail response for attachments and download those available by the documented mechanism.
- Validate file type, bytes, maximum download size, and safe filename/path. Avoid path traversal; do not log sensitive headers.
- Treat individual download failures as per-document statuses instead of failing or claiming that the entire package was processed.
- Do not assume every opportunity contains attachments or that the API hosts all supplemental materials.

5. Format adapters
- Process digital PDF with page-aware text extraction; process HTML preserving headings, links, and original source URLs.
- Download/register XLSX, DOCX, ZIP, GIS and other files, but record unsupported or unparsed content honestly.
- Implement an extensible adapter contract without introducing a generic document platform.
- No OCR, GIS analysis, spreadsheet calculation or application writing.

6. Traceable, cached package
- Save to a structure like data/opportunities/{opportunityId}/ containing opportunity metadata, a document manifest, original files (when downloaded), extracted content, retrieval timestamps, original URLs, SHA-256 checksums, format, source authority classification and processing statuses/errors.
- Separate Simpler.Grants.gov attachments from manually curated official agency supplemental sources. Support adding supplemental URLs/files through configuration; do not autonomously crawl sites.
- Cache previously acquired documents; do not redownload/reparse unchanged items unnecessarily. State when coverage is partial or unknown.

7. Tests and integration verification
- Unit-test invalid UUID, unknown opportunity, zero attachments, malformed API response, download failure, unsupported format, unsafe filename, and cached repeat ingestion using local fixtures.
- Live-test FY2026 BUILD and ONE OTHER REAL opportunity ID with different attachments, proving both use exactly the same pipeline.
- If credentials or API availability block live testing, document the blocker. Do not claim it passed.
- Verify document identifiers and source references resolve to actual ingested content.

8. Deliverables and stop rule
- Generic Simpler.Grants.gov client, UUID resolver, ingestOpportunity entry point, format adapters, persisted manifest/content and automated tests.
- Update docs/NOFO_MVP_PLAN.md with actual routes, added/changed files, response shape, API/download behavior, supported formats, acquisition results for both opportunities, and limitations.
- Run npm run build and relevant npm tests. Report exact results.
- DO NOT implement Milestone 3 requirements extraction, project assessment, advisory logic, a new chat UI, or a database.
- STOP after Milestone 2 for review.
```

**Milestone 2 checkpoint:** Supply two *different* real Simpler.Grants.gov UUIDs. Can the same pipeline fetch each opportunity, acquire its available attachments, preserve original locations/provenance, parse supported files, and accurately report missing or unsupported documents? If not, do not proceed. **Requirement extraction itself belongs to Milestone 3**; Milestone 2 only needs trustworthy source content and locations.

### Opportunity identifier and package contracts (conceptual)

```typescript
interface OpportunitySource {
  getOpportunity(id: string): Promise<Opportunity>;
  getAttachments(id: string): Promise<Attachment[]>;
}

interface DocumentProcessor {
  supports(mimeType: string, filename: string): boolean;
  process(file: Buffer): Promise<NormalizedDocument>;
}

// Public workflow entrypoint; adapt actual return types to the repository.
async function ingestOpportunity(opportunityId: string): Promise<OpportunityPackage>;
```

Do not equate an official funding opportunity *number* with the Simpler.Grants.gov UUID. Search results should pass the returned UUID into the ingestion boundary. The acquisition pipeline must remain independent of program identity and document type, with adapters handling the latter.

## Milestone 3 — NOFO Requirements Intelligence

```text
Implement a NOFO requirements extraction service using the existing Anthropic SDK.

Process normalized document sections in bounded batches and return Zod-validated requirements.

Each requirement must include a category, description, mandatory or conditional status, applicability conditions, evidence needed, and references to the original source.

Extract eligibility, financial, application submission, and selected project readiness requirements.

Validate citation references against the ingested source content. Reject invented document IDs, nonexistent locations, and unsupported requirement claims.

Cache extracted requirements as JSON. Support a review status for ambiguous findings.

Create unit tests and a small evaluation fixture representing 15–25 manually verified requirements from the actual BUILD documents. The extraction service must consume the generic Milestone 2 package and must not rely on BUILD-specific paths or IDs.

Do not implement project assessment or modify the user interface in this milestone.
```

**Milestone 3 checkpoint:** Nicely formatted JSON is not enough. Evaluate accuracy, material completeness for the selected scenarios, and source traceability. Do not let the same LLM's self-assessment substitute for reference-document verification. If a manually verified gold set is not yet available, report that limitation explicitly.

## Milestone 4 — Applicant Assessment and Follow-up Questions

```text
Implement a project-specific NOFO assessment service using the validated requirements produced in Milestone 3.

The user is a state DOT evaluating an existing transportation project for FY2026 BUILD funding.

Accept project facts provided during a conversation. Compare them with applicable requirements. For each requirement, return supported, conflict, unknown, or needs specialist review, along with the supporting evidence.

Generate targeted follow-up questions only when additional information could materially affect the assessment.

Use deterministic checks for explicit numeric constraints and LLM interpretation for more complex conditions.

Test three scenarios: a plausible project, a project with a verified requirement conflict, and a project with missing information.

Do not create a separate project-profile interface or issue definitive eligibility determinations.
```

**Milestone 4 checkpoint:** Changing a project fact should appropriately change affected findings without reprocessing the NOFO. Missing information is **unknown**, not an automatic failure or pass.

## Milestone 5 — Existing Chat Integration and Browser Demo

```text
Integrate the completed NOFO assessment services into the existing chat.html experience.

Allow the user to select an already ingested opportunity by UUID (FY2026 BUILD for the main demo), describe an existing transportation project, answer targeted follow-up questions, and view a preliminary assessment.

Present eligibility findings, financial and readiness gaps, supporting source references, and suggested next actions.

Preserve the existing chat functionality and visual design. Do not introduce a frontend framework or build a separate project management application.

Test the complete workflow in the browser, run automated tests and the TypeScript build, and document any unresolved limitations.
```

**Milestone 5 checkpoint:** Verify the actual browser flow, not only API responses. Confirm that each material finding links to a real source, and failures/ambiguities are shown honestly.

---

# 7. Claude Code Development Routine

For **every** milestone:

1. Start in Plan Mode when the work involves architectural choices.
2. Review the proposed changed files and dependencies before implementation.
3. Implement **only** the current milestone.
4. Require successful build and relevant automated tests, or clear documentation of any existing/fresh failure.
5. Personally inspect the actual application or representative output.
6. Commit working changes before moving to the next milestone.
7. Ask Claude to summarize changed files, test results, assumptions, limitations, and deferred items.

Keep work in the same feature branch, with **separate commits** for each milestone. Claude Code's browser-assisted integration may be used for final interaction testing where available; otherwise verify through the local browser manually.

Do not tell Claude Code to silently resolve ambiguous federal requirements. It should flag them for human review and show citations.

---

# 8. Final Competition Demo Scenario

Use **one** consistent acceptance scenario:

A Virginia DOT project manager describes a **hypothetical $25 million roadway modernization project**. The app has ingested the official FY2026 BUILD NOFO and selected supporting documents through the generic Simpler.Grants.gov UUID-based pipeline (plus any explicitly curated supplemental official sources).

The applicant explains that the project includes intersection redesign, pedestrian improvements, and signals; the project is at preliminary design; and federal discretionary funding is being considered.

The advisor asks, based on actual documented BUILD requirements:

- How much federal funding is being requested?
- Whether state/non-federal matching funds are available or committed.
- Whether a benefit-cost analysis has been completed.
- Other questions only when the applicable source requirement supports them.

If the user answers **$18 million requested, $7 million in state funds committed, no completed BCA**, the advisor should:

- Verify simple arithmetic and applicable funding thresholds, with the **correct source/caveats**.
- Identify the missing benefit-cost analysis as an application preparation gap if the chosen capital-grant category requires it.
- Keep unresolved project, matching, and readiness provisions as **unknown** until there is evidence.
- Provide actionable investigative next steps.
- Attach a verifiable NOFO or official guidance citation to each consequential requirement-based conclusion.
- Clearly label the output **preliminary**, not a binding eligibility determination.

This is the **entire applicant-facing demo**. Separately, demonstrate generic acquisition using a second opportunity UUID. Do not spend MVP time on broad grant matching, application generation, project portfolio management, or comprehensive file-format support.

The source documents must be genuine. The requirement extraction must be accurate for the validated scope. The findings should change correctly when the applicant supplies new facts.

---

# 9. Required Tests and Quality Gates

At minimum, ensure the implementation supports these cases:

| Scenario | Expected behavior |
|---|---|
| Plausible state DOT applicant and road project | Finds the applicable applicant/project provisions with evidence |
| Requested federal amount conflicts with a verified maximum | Surfaces a cited conflict, not a vague warning |
| Matching funds unknown | Asks a targeted question and marks the condition unknown |
| BCA unavailable where required | Identifies the application preparation gap with a source |
| Project funding request changes | Recalculates affected findings without re-ingestion |
| Official FAQ clarifies the NOFO | Associates clarification with requirement and preserves source authority |
| Evidence location or document ID cannot be verified | Flags for review and does not invent a citation |
| Supporting document apparently contradicts controlling NOFO | Flags conflict for human review; does not silently choose one |
| Unsupported format or inaccessible document | Reports missing coverage; does not pretend content was processed |
| Second valid opportunity UUID | Uses the same generic acquisition pipeline without special-case program logic |
| Opportunity has no API attachments | Preserves metadata and states document coverage is incomplete/unknown |
| API response invalid or rate-limited | Handles failure gracefully and records exact status without inventing data |

Focus on **requirements coverage, factual accuracy, citation accuracy, reviewer corrections, and end-to-end reliability**, not only successful API calls.

### Evidence and safety rules

- Never invent requirements, citations, page numbers, section references, or document availability.
- Citation IDs must resolve to ingested source content.
- Do not conflate a project cost with a federal funding request.
- Do not conflate eligibility, application completeness, project readiness, and competitiveness.
- Do not treat conditional or ambiguous requirements as universal requirements.
- Preserve fiscal year, program category, and document-version context.
- Avoid definitive eligibility decisions or predictions of grant awards.
- Fail visibly and conservatively when evidence is missing.

---

# 10. Judging / Mission Impact Measurement

Mission Impact & Value is stated in the Big Build project discussions as **40% of the competition score**. Emphasize actual applicant productivity, not merely the existence of an AI chat experience.

Benchmark these tasks if feasible:

**Task A — Requirements identification:** Given the FY2026 BUILD package, how much human time is needed to identify the relevant requirements for the example project, with and without the advisor?

**Task B — Applicant assessment:** Given known project facts and the requirements, how much human time is needed to identify critical issues and produce a reviewable preliminary assessment?

Measure:

- Time required, including human verification.
- Requirement coverage compared with the manually verified reference set.
- Unsupported or incorrect findings.
- Citation correctness.
- Reviewer corrections.

**Do not present hypothetical time savings as achieved outcomes.** A small, credible benchmark is more compelling than an unverified claim of automation savings.

The broader AFS value proposition is a reusable approach for interpreting complex federal requirements and applying them to real applicant circumstances, with potential to reduce repetitive analyst work and delivery cost.

---

# 11. What Success Looks Like

The MVP succeeds when a user can:

1. Open the existing chat application.
2. Select an opportunity already ingested by its Simpler.Grants.gov UUID (FY2026 BUILD for the main demonstration).
3. Describe an existing state DOT transportation project.
4. Receive questions derived from relevant NOFO requirements.
5. Answer questions and see the assessment update.
6. Inspect preliminary findings, gaps, and suggested next steps.
7. Open or verify the authoritative evidence behind material conclusions.

**The key deliverable is not a list of grants or a generic NOFO summary. It is a project-specific, evidence-backed preliminary application feasibility assessment, built on a generic opportunity-ID-driven document pipeline.**

---

# 12. Start Here — First Claude Code Session

After adding this file to your repository and the root `CLAUDE.md` instructions above, open Claude Code in VS Code and run this **single initial prompt**:

```text
Read NOFO_MVP_CLAUDE_CODE_IMPLEMENTATION_GUIDE.md and the repository's CLAUDE.md, if present.

Our agreed Big Build MVP is a NOFO-driven application feasibility advisor, not a grant search tool. The user has already selected an opportunity and has an existing transportation project. Milestone 2 must ingest any selected opportunity by Simpler.Grants.gov UUID; BUILD is a test, not hardcoded behavior.

Begin with Milestone 1 ONLY. Inspect the repository thoroughly and create docs/NOFO_MVP_PLAN.md as specified in the guide. Verify the proposed architecture against the current code. Preserve existing functionality and do not modify application code yet.

At the end, summarize reuse opportunities, proposed changes, risks, open questions and Milestone 1 acceptance criteria. Stop and wait for plan review before implementing Milestone 2.
```

**Recommended immediate next action:** Audit and approve Claude's generated `NOFO_MVP_PLAN.md`, then proceed milestone by milestone. In the limited competition window, prioritize proven NOFO-grounded analysis over additional infrastructure or interface polish.

---

## Reference Links

- [Existing GitHub repository](https://github.com/marvoey/transportation-grants)
- [Repository package.json](https://github.com/marvoey/transportation-grants/blob/main/package.json)
- [Claude Code in VS Code](https://code.claude.com/docs/en/vs-code)
- [Simpler.Grants.gov developer documentation](https://simpler.grants.gov/developers)
- [Simpler.Grants.gov API base URL](https://api.simpler.grants.gov)
- [FY2026 BUILD NOFO landing page](https://www.transportation.gov/BUILDgrants/NOFO)

**Documentation note:** The proposed paths and type contracts in this guide are design suggestions. Claude Code must inspect the actual repository before deciding where new modules belong. Do not treat a suggested file path as evidence that a module already exists.
