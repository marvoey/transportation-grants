# Project Discovery Workspace — Implementation Plan

Repository: `marvoey/transportation-grants`  
Last updated: November 1, 2026  
Status: proposed design; implementation requires a separate instruction.

## 1. Purpose and source boundaries

Build `public/project.html` as a dedicated Project Discovery Workspace. An AI discovery agent helps an applicant turn a rough transportation idea into a structured, editable, persistent project profile. The applicant then opens `chat.html?projectId=<id>` to explore grants using that profile.

The workspace is a project authoring tool: its durable output is the profile, not the conversation. Grant chat remains the place for opportunities, eligibility exploration, details, and deadlines.

### Current state of the repository

Inspected in the local tree (branch `main`, commit `edc1656`):

- TypeScript, Express, Zod, the Anthropic SDK, `@modelcontextprotocol/sdk`, `express-rate-limit`, and Vitest are dependencies. `@types/node` is `^20`; `package.json` has no `engines` field; the local runtime is Node 24.
- `public/chat.html` loads `common.js`, `api.js`, and `chat.js`. `askChat(messages)` in `public/js/api.js` sends `{ messages }` to `POST /api/chat`; the browser keeps chat history in memory.
- `src/web-index.ts` starts `src/web/api-server.ts`, which mounts grant, eligibility, deadlines, and chat routes and serves `public/`.
- `POST /api/chat` (`src/web/routes/chat.ts`) is a three-stage pipeline: `classifyIntent(messages)` → `runRetrieval(intent, messages)` → `draftReply(messages, facts)`, in `src/web/chat/`. Retrieval calls only the MCP tools allowed for the classified intent (`INTENT_TOOLS` in `src/web/chat/types.ts`). Drafting appends the gathered facts to the system prompt. The request body is validated by `ChatRequestSchema` in `src/utils/validators.ts`.
- Chat has a dedicated IP-based rate limiter (`CHAT_RATE_LIMIT_*`). Responses use `successResponse` / `errorResponse` from `src/web/middleware/error-handler.ts`.
- CORS is configured as `origin: process.env.CORS_ORIGINS?.split(',') || '*'` with `credentials: true`.
- `ApplicantType` in `src/types/index.ts` is `state | city | county | tribal | mpo | transit_agency` and is also the enum of the `check_eligibility` tool.
- Not present: any authentication or session code, any database, any `*.test.ts` file, `CLAUDE.md`/`AGENTS.md`, and any deployment configuration. The README links to a `DEPLOYMENT.md` that does not exist in the repository.

This was a targeted inspection, not a full architecture or security audit. Everything else that a stage depends on must be verified in that stage. All new paths and contracts below are proposals.

### Default decisions

These defaults are the plan. Stage 0 confirms them against the actual deployment; it does not re-decide them. Deviating requires a recorded reason.

| Decision | Default |
| --- | --- |
| Identity | Server-issued anonymous session: opaque random ID in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` over HTTPS), mapped to `ownerId` server-side. A project is reachable only from the session that created it. The cookie is persistent (default `Max-Age` one year), not a browser-session cookie, so closing the browser does not lose projects. A session is created only by `POST /api/projects`. Clearing the cookie loses access; document this to users. Sign-in is out of scope. |
| Store | SQLite with versioned, repeatable migrations, behind the `project-store` interface. Driver chosen in Stage 0 for the pinned Node version (add an `engines` field). File path from `PROJECT_DB_PATH`, outside `public/`, gitignored. Assumes a single instance with a persistent volume. |
| Blocking condition | If the deployment target has no persistent volume or runs multiple instances, stop and ask before exposing project data. This is the only default that is allowed to block. |
| Discovery execution | Synchronous request/response with a bounded timeout (`DISCOVERY_TIMEOUT_MS`, default 30000). No `202` or status endpoint in MVP. |
| Model access | Reuse `getAnthropicClient()` and the configured model. Discovery has its own max-token setting (`DISCOVERY_MAX_TOKENS`) because the chat default of 1024 is sized for prose replies. |
| Retention | Projects, messages, and suggestion batches are kept until the user deletes the project; deletion is a hard delete of all dependent rows. Archived projects are retained. Idempotency records expire after 24 hours. No automatic expiry of anonymous sessions in MVP; record this as a known limitation. |
| Feature flag | `PROJECT_DISCOVERY_ENABLED`, default off. When off, `/api/projects*` returns the standard 404, `project.html` and its scripts are not served (the static handler would otherwise expose them), and navigation links are not rendered. |
| CORS and CSRF | Project routes and project-aware chat are same-origin only. Replace the `*` default with an explicit allowlist for these routes. State-changing requests must carry an `Origin` header that matches the allowlist and `Content-Type: application/json`; otherwise `403 ORIGIN_REJECTED`. |
| Abuse and cost | Anonymous sessions are free to create, so a per-session limit alone is bypassable by clearing cookies. Model-calling routes also get an IP-based limiter (like the existing chat limiter) and a global daily discovery-turn cap (`DISCOVERY_DAILY_LIMIT`) that returns `503 AI_UNAVAILABLE` when reached. Per-session request limits use `PROJECT_RATE_LIMIT_*` and `DISCOVERY_RATE_LIMIT_*` variables with conservative defaults set in Stage 1. Also cap projects per session (default 25) and messages per project (default 200). |
| User notice | The workspace shows a short notice that conversation and profile content is stored on the server, sent to the AI provider to generate suggestions, and permanently removed when the project is deleted. |

## 2. Product scope

### MVP — must-have

Ship none of the MVP without these.

1. Create, list, open, rename, edit, and explicitly delete projects.
2. Persist structured profiles and discovery conversation history on the server across reloads and restarts.
3. Guide discovery through short, targeted questions and visible missing information.
4. Show AI-proposed profile changes for review before applying them.
5. Support direct editing without an AI request.
6. Calculate completeness deterministically.
7. Open grant chat with a selected project and visible context.
8. Preserve existing chat behavior when no project is selected.
9. Safeguards: server-derived ownership on every operation, schema validation of every write, optimistic revision checks, same-origin/CSRF protection, per-session and per-IP rate limits, a global daily discovery cap, bounded agent calls, and script-safe rendering of all user and model text.

### MVP — should-have

Cut these first if scope must shrink. Cutting them must not weaken a must-have.

1. Archive and restore.
2. The `ready` status and the “Review readiness” action (completeness and missing-field display stay).
3. Per-project token/spend budgets (the global daily cap and rate limits are must-have).
4. A durable idempotency table for every write. Idempotency for project creation and discovery turns is must-have; the other writes are protected by revision checks alone if this is cut.
5. Cursor pagination for project lists and messages (a fixed bounded limit is acceptable first).

### Deferred

Document uploads and extraction, grant applications/submissions, collaboration roles, autonomous grant selection, complex GIS, external CRM integrations, and a standalone agent deployment. Do not add a frontend framework or separate service solely for this feature.

## 3. Workspace experience

Desktop layout:

```text
Header: navigation | project selector | New project
Project title | Draft / Ready / Archived | Saved / Saving / Error
+----------------------------------+------------------------------------+
| Discovery guide                  | Project profile                    |
| Current discovery step           | Section navigation + completeness  |
| Focused conversation             | Applicant and location             |
| Suggested questions              | Need, scope, outcomes              |
| Reply composer                   | Budget, match, schedule, readiness |
|                                  | Evidence, unknowns, assumptions     |
|                                  | Review suggested changes           |
+----------------------------------+------------------------------------+
Footer actions: Save status | Review readiness | Explore grants
```

The left pane guides thinking; the right pane is the authoritative saved artifact. Keep profile sections visible and editable while the conversation progresses. A project list may be a selector or drawer rather than a third permanent pane.

Discovery steps: applicant and location → problem and beneficiaries → activities and outcomes → cost and match → schedule and readiness → review. Users can skip, return, say “unknown,” or edit any section. Ask one or two high-value questions per turn. Never force a long questionnaire before the user sees value.

On small screens use accessible Guide / Profile tabs, retain input and scroll position, and show pending changes on the Profile tab. Provide labels, keyboard operation, visible focus, descriptive errors, status announcements, and sufficient contrast. Do not rely on color alone for readiness.

Required states: no projects; loading; new draft; incomplete profile; AI thinking; suggestions available; saving; saved; failed save with retry; stale revision; AI unavailable; no session (a cleared cookie makes earlier projects unreachable, explained plainly); deleted/missing project; archived project. Manual editing remains usable when AI fails.

“Explore grants” saves pending direct edits first. Incomplete projects may continue after a clear explanation of missing context; completeness is not an eligibility gate. Never navigate on a failed save. Archive makes a project read-only until restored; delete requires an explicit user action with a clear confirmation.

## 4. Architecture and responsibilities

```text
project.html + project.js
   → project/discovery HTTP routes
      → identity and project authorization
      → project service + schema validation
         → durable project store
         → discovery agent → existing server-side model client

chat.html?projectId=...
   → existing POST /api/chat + optional projectId
      → authorized profile lookup → bounded context builder
      → existing classify → retrieve → draft pipeline (context passed to retrieve and draft)
```

Create a logically separate discovery agent with its own prompt, response schema, and tests. Reuse `getAnthropicClient()`, `getConfig()`, the `successResponse`/`errorResponse` envelope, and the logger. The discovery agent does not need a separate process or any of the grant assistant's MCP tools.

The project service owns writes and revision checks. The agent can propose field updates and questions; it cannot directly overwrite profiles, delete projects, change ownership, or submit applications. Grant chat reads a profile snapshot and does not silently mutate it.

Proposed organization (new files follow the existing `src/web/...` and `src/utils/...` layout; the repository has no test files yet, so tests are colocated as `*.test.ts`):

| Path | Responsibility |
| --- | --- |
| `public/project.html` | Workspace shell and accessible sections |
| `public/js/project.js` | Project state, editor, discovery, suggestion review |
| `public/css/project.css` | Scoped responsive workspace styling |
| `public/js/api.js` | Project/discovery helpers; optional `projectId` on `askChat` |
| `src/projects/schemas.ts` | Shared runtime validation and inferred types (Zod); reuses `ApplicantType` |
| `src/projects/field-paths.ts` | Allowlisted field paths and change operations (Appendix A) |
| `src/projects/project-service.ts` | CRUD, revisions, readiness, permissions |
| `src/projects/project-store.ts` | Durable storage abstraction (SQLite implementation) |
| `src/projects/project-context.ts` | Safe, bounded grant-chat context |
| `src/web/discovery/discovery-agent.ts` | Discovery prompt, orchestration, output validation |
| `src/web/routes/projects.ts` | Project and discovery HTTP handlers |
| `src/web/middleware/session.ts` | Anonymous session, origin check |
| `src/web/api-server.ts` | Route registration, feature flag, CORS for project routes |
| `src/web/routes/chat.ts`, `src/web/chat/retrieval-agent.ts`, `src/web/chat/drafting-agent.ts` | Optional project lookup; context passed to retrieval and drafting (see §9) |
| `src/utils/validators.ts` | `ChatRequestSchema` gains optional `projectId` |
| `public/chat.html`, `public/js/chat.js` | Project context banner and selection |

## 5. Structured project model

Use a versioned runtime schema, preferably existing Zod conventions. Persist explicit nulls for unknown scalar values. Distinguish unknown from zero, false, and an empty answer. Reject unknown update fields; do not persist arbitrary model JSON.

Illustrative persisted record (the implementation must define and test the complete schema):

```json
{
  "id": "server-generated-uuid",
  "ownerId": "server-derived-principal",
  "schemaVersion": 1,
  "revision": 1,
  "status": "draft",
  "createdAt": "2026-11-01T20:00:00Z",
  "updatedAt": "2026-11-01T20:00:00Z",
  "profile": {
    "name": "Main Street safety improvements",
    "summary": null,
    "applicant": { "name": null, "type": null, "partners": [] },
    "location": { "state": null, "county": null, "city": null, "serviceArea": null },
    "need": { "problem": null, "evidence": [], "beneficiaries": [] },
    "scope": { "modes": [], "activities": [], "assets": [], "phase": null },
    "outcomes": [],
    "budget": {
      "currency": "USD",
      "totalCostCents": null,
      "requestedFundingCents": null,
      "matchAmountCents": null,
      "matchSources": [],
      "estimateBasis": null
    },
    "schedule": { "startDate": null, "endDate": null, "milestones": [] },
    "readiness": {
      "planningStatus": null,
      "designStatus": null,
      "environmentalStatus": null,
      "rightOfWayStatus": null
    },
    "constraints": [],
    "unknowns": [],
    "assumptions": []
  },
  "fieldMetadata": {},
  "readinessAssessment": {
    "ruleVersion": 1,
    "completeCount": 0,
    "requiredCount": 6,
    "missingFields": [],
    "warnings": []
  }
}
```

Additional definitions:

- `status`: `draft | ready | archived`; server validates transitions. Ready means reviewed for discovery, never grant-qualified. Entering `ready` requires the six completeness items and an explicit user action. If any later mutation leaves a `ready` project with fewer than six complete items, the server reverts it to `draft` in the same transaction and the response says so (`statusChanged: true`). Allowed transitions: `draft → ready`, `ready → draft`, `draft|ready → archived`, `archived → draft`; anything else is `422 INVALID_TRANSITION`. While `archived`, PATCH, discovery turns, and suggestion apply are rejected with `422 PROJECT_ARCHIVED`; reads, status restore, and delete still work.
- Applicant types: reuse `ApplicantType` from `src/types/index.ts` (`state | city | county | tribal | mpo | transit_agency`). Null represents unknown. An applicant who fits none of these (for example a nonprofit or port authority) is recorded with `applicant.type: null` and an explanatory entry in `constraints`; it is never silently mapped to an eligible type, and chat will not call `check_eligibility` for it. Such a project cannot reach six of six completeness or `ready`, but it can still open grant chat because completeness is not a gate.
- Evidence item: `{ id, description, sourceUrl: string|null, suppliedBy: user|agent, verified: boolean }`. `verified` is read-only in MVP (no verification workflow exists): it is always `false` and cannot be set by the agent or by PATCH. Only `http`/`https` URLs are accepted for `sourceUrl`.
- Object list items (evidence, outcomes, milestones, assumptions) each carry a server-generated `id` so changes can address them. The outcome and milestone shapes below gain that `id`.
- `unknowns`: a list of allowlisted field paths (Appendix A) the user has explicitly said they do not know. The agent does not re-ask them, and readiness reports them as “unknown” rather than “missing”. An unknown never counts as complete.
- Outcome: `{ id, description, metric: string|null, baseline: number|null, target: number|null, unit: string|null }`.
- Milestone: `{ id, name, date: YYYY-MM-DD|null }`.
- Assumption: `{ id, text, confirmed: boolean }`. Unconfirmed assumptions do not count toward completeness. An agent-proposed assumption is always added with `confirmed: false`; only a direct user edit can set it to `true`.
- Field metadata keyed by allowlisted profile paths: `{ source: user_edit|accepted_suggestion, messageId: string|null, confirmedAt: ISO timestamp|null }`.
- Discovery message: `{ id, projectId, role: user|assistant, content, createdAt, requestId }`; separate table/collection, chronological order and bounded pagination.
- Change (used in PATCH bodies, agent output, and suggestion batches): `{ op: set|add|update|remove, path, value?, itemId? }`; see Appendix A for which operations each path allows. In a stored suggestion, a change also carries a server-generated `id` (several changes can share a path, for example two `add` operations on `outcomes`), `rationale`, `sourceMessageIds`, `basis`, and `disposition: pending|applied|dismissed|conflict`. `basis` is the precondition checked at apply time: for `set`, the path's value when the batch was created; for `update` and `remove`, the target item's value (the item having been deleted is a conflict); for `add`, none, because additions do not conflict with concurrent edits (an `add` of a string already in the list is skipped as a duplicate, not an error).
- Suggestion batch: `{ id, projectId, baseRevision, state: pending|applied|dismissed|stale, changes, createdAt }`. Lifecycle:
  - A project has at most one `pending` batch. Creating a new batch marks the previous pending one `stale`.
  - `apply` with selected change IDs: each selected change is applied only if its `basis` precondition still holds; otherwise its disposition is `conflict` and it is not applied. Unselected changes become `dismissed`. If at least one change applied, the batch is `applied`; if none applied because all conflicted, it is `stale`.
  - `dismiss` (or an apply with no selection) sets every change to `dismissed` and the batch to `dismissed`.
  - Applying never blocks merely because the project revision moved; it blocks per change on `basis`. The write itself still uses `expectedRevision` (see §6).

Validation rules: a PATCH applies all of its changes or none, and accepts at most 50 changes; trim and bound strings; cap list lengths, message length and total request size; validate dates and safe nonnegative integer cents; end date cannot precede start date; supplied requested funding or match cannot exceed supplied total cost. Do not require match plus requested funding to equal total cost because other sources may exist. Only paths and operations in Appendix A are accepted; prohibit owner, IDs, timestamps, revision, computed scores, `verified`, `budget.currency`, and arbitrary JSON paths. Finalize enum values and numeric/string limits in Stage 1.

Completeness is server-calculated over six required items: project name, applicant type, location (state plus service area/city/county), problem, at least one activity, and at least one outcome description. A field counts only when user supplied or accepted. Display the count and specific missing fields; budget and readiness unknowns produce separate warnings. Recompute after every accepted mutation. Mark ready only after these six items and explicit user review; allow reverting to draft. The zero-filled assessment above is a shape example, not a valid computed assessment for every profile.

## 6. Persistence, ownership, and concurrency

The repository has no database, so the default is SQLite with migrations and transactions on a single instance with a persistent volume (see §1). Choose the driver in Stage 0 for the pinned Node version. If the deployment has multiple instances or no persistent volume, stop per the blocking condition in §1. Never use the grant cache (`.cache/`) or browser storage as the authoritative project database.

Minimum entities: sessions, projects, discovery_messages, suggestion_batches, discovery_requests (discovery turns: busy lock and turn idempotency), idempotency_records (all other writes). Store the profile as a JSON document validated by the Zod schema on every read and write, with `schemaVersion` driving migrations of stored profiles; keep status, revision, owner, and timestamps as real columns. Index owner + updatedAt and project + message timestamp. Migrations must be repeatable and preserve existing projects; provide backup and restore instructions before production rollout. Keep database files outside `public/` and out of version control. Persist profile and accepted-suggestion state in one transaction. Persist turn records coherently; avoid holding a database transaction open across a model call.

Use server-derived identity on every CRUD, discovery, acceptance, and chat-context lookup, as set by the default decisions in §1 (anonymous session; no sign-in exists in the repository). `POST /api/projects` issues a session if none exists. `GET /api/projects` without a session returns an empty list and creates nothing (so crawlers cannot fill the sessions table); every other project-scoped request without a valid session fails with `401 SESSION_REQUIRED`. Do not treat a UUID or a supplied `ownerId` as authorization. The current CORS default (`*` with `credentials: true`) must not apply to project routes; see §1.

Every mutation supplies `expectedRevision`; update with compare-and-swap and increment revision atomically. Return `409 REVISION_CONFLICT` on stale writes and offer reload/reapply, preserving local edits. Deleting a project and dependent records must be atomic. A model response that arrives after its project was deleted is discarded and never written.

Idempotency: every write supplies a client-generated `requestId`. Records are scoped to `owner + operation + requestId` (plus `projectId` when the operation has one; project creation has none) and stored with a hash of the request body. A replay with the same body returns the stored result; the same `requestId` with a different body returns `409 IDEMPOTENCY_CONFLICT`. Records expire after 24 hours.

Discovery turn ordering (one active turn per project):

1. Check idempotency, then compare `expectedRevision` with the project. A stale revision returns `409 REVISION_CONFLICT` before anything is stored or sent to the model.
2. In one transaction, store the user message and a `discovery_requests` row in state `in_progress`. This row is the per-project busy lock; a second turn while one is `in_progress` returns `409 DISCOVERY_BUSY`.
3. Call the model with no transaction open.
4. In one transaction, store the assistant message and suggestion batch (marking any previous pending batch stale) and set the request `complete`. If the project no longer exists, discard the result.
5. On timeout, provider error, or invalid output, set the request `failed`. The user message remains stored and visible with a retry action; the profile is untouched. A retry with the same `requestId` re-runs the model call; it does not duplicate the message. A replay of a `complete` request returns the stored result without calling the model.

An `in_progress` row older than `DISCOVERY_TIMEOUT_MS` plus a grace period is treated as failed so a crashed server cannot lock a project.

## 7. Proposed HTTP contracts

Reuse the current envelope (`successResponse` / `errorResponse`): success `{ "success": true, "data": ... }`; failure `{ "success": false, "error": "Human-readable message", "code": "...", "retryable": false }`.

| Method and route | Request | Result |
| --- | --- | --- |
| `POST /api/projects` | `{ name, requestId }` | 201, new project |
| `GET /api/projects` | `cursor`, bounded `limit`, optional status | owned summaries + nextCursor |
| `GET /api/projects/:id` | — | project + readiness |
| `PATCH /api/projects/:id` | `{ expectedRevision, requestId, changes: [Change] }` (see Appendix A) | validated updated project; `statusChanged` if it reverted from `ready` |
| `POST /api/projects/:id/status` | `{ expectedRevision, requestId, status }` | validated transition |
| `DELETE /api/projects/:id?expectedRevision=N&requestId=...` | no body (query parameters only; some proxies drop DELETE bodies) | 200, `{ deleted: true }` |
| `GET /api/projects/:id/discovery/messages` | cursor + bounded limit | persisted messages |
| `GET /api/projects/:id/discovery/suggestions` | optional state | pending/reviewable batches |
| `POST /api/projects/:id/discovery` | `{ message, expectedRevision, requestId }` | assistant message + suggestion batch + current readiness |
| `POST /api/projects/:id/discovery/suggestions/:suggestionId/apply` | `{ expectedRevision, requestId, acceptedChangeIds }` | updated project, batch with per-change dispositions |
| `POST /api/projects/:id/discovery/suggestions/:suggestionId/dismiss` | `{ requestId }` | dismissed batch |
| `POST /api/chat` | existing `{ messages }` plus optional `projectId` | existing reply/toolCalls plus optional context metadata |

Apply is a one-time review of a batch; the lifecycle (per-change `basis` check, `conflict`/`dismissed` dispositions, resulting batch state) is defined in §5. Selected changes that pass the check apply atomically in one transaction. Only changes from the stored validated batch may be accepted, never client-supplied values; revalidate the resulting full profile. An empty selection is treated as dismiss. At most one discovery turn runs per project (ordering and busy lock are in §6). Discovery is synchronous (see §1): the request returns the assistant message and batch, or a failure the client can retry.

Status codes and error codes (existing codes reused; new ones proposed):

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Invalid JSON, unknown field, forbidden path, bound exceeded |
| 401 | `SESSION_REQUIRED` | No valid session for a project-scoped request |
| 403 | `ORIGIN_REJECTED` | State-changing request from a disallowed origin |
| 404 | `PROJECT_NOT_FOUND` | Missing, deleted, or not owned by this session (indistinguishable); also returned for suggestions, and for all project routes when the feature flag is off |
| 409 | `REVISION_CONFLICT` | `expectedRevision` is stale |
| 409 | `IDEMPOTENCY_CONFLICT` | `requestId` reused with a different body |
| 409 | `DISCOVERY_BUSY` | A turn is already in progress for this project |
| 409 | `SUGGESTION_STALE` | Batch is not `pending`, or every selected change conflicted |
| 422 | `INVALID_TRANSITION` | Status change not allowed (e.g. `ready` with incomplete profile) |
| 422 | `INVALID_PROFILE` | Resulting profile fails validation or a cross-field rule |
| 422 | `PROJECT_ARCHIVED` | Write or discovery attempted on an archived project |
| 429 | `RATE_LIMIT_EXCEEDED` | Existing code; per-session limiter for project routes |
| 502 | `AGENT_INVALID_OUTPUT` | Model output failed validation after the allowed repair attempt |
| 503 | `AI_UNAVAILABLE` / `MISSING_CONFIG` | Provider or configuration unavailable |
| 504 | `AGENT_TIMEOUT` | Exceeded `DISCOVERY_TIMEOUT_MS` |

Return safe messages without internal prompts, secrets, or raw provider exceptions. Set `retryable` to `true` only for 429, 503, 504, and `DISCOVERY_BUSY`.

## 8. Discovery agent behavior

Inputs are server-loaded profile, computed missing fields, bounded persisted conversation, and the current user message. The browser must not supply trusted instructions, ownership, or authoritative profile context.

Prompt responsibilities:

- Help describe a transportation project accurately and progressively.
- Ask targeted questions about missing or ambiguous information.
- Preserve unknowns and distinguish user statements from assumptions.
- Explain why a question matters using plain language.
- Propose only changes grounded in user input; never invent budgets, dates, evidence, eligibility, or commitments.
- Do not overwrite confirmed information without calling attention to the change.
- Do not claim to save changes before application succeeds.
- Do not perform opportunity search in MVP; offer the grant-chat handoff when useful.

Constrain output to a validated structure:

```json
{
  "reply": "What safety problem are you trying to address?",
  "questions": [{ "field": "need.problem", "text": "Where are the main safety concerns?" }],
  "proposedChanges": [
    { "op": "add", "path": "assumptions", "value": { "text": "Applicant is a city government" }, "rationale": "User mentioned the city council." }
  ],
  "suggestedNextStep": "problem_beneficiaries"
}
```

- `proposedChanges` uses the same `Change` shape and Appendix A rules as PATCH, minus server-set fields. Assumptions the agent infers are proposed as `add` changes to `assumptions` (always unconfirmed), so there is no separate top-level `assumptions` key.
- `questions[].field` must be an allowlisted path from Appendix A. `suggestedNextStep` is one of `applicant_location | problem_beneficiaries | activities_outcomes | cost_match | schedule_readiness | review`, matching the discovery steps in §3.

Validate all keys, field paths, operations, values, lengths, and cross-field rules server-side. Attach server-generated IDs, `basis` values, and source message references after validation. Invalid output produces no profile mutation and a recoverable error. At most one bounded repair attempt may be used; retries must respect request idempotency and cost budgets.

Separate system instructions from user/profile/tool data. Treat all profile text as untrusted data even after user acceptance. The agent has no arbitrary URL fetching, file access, write tools, or secrets. Limit turns, history size, output tokens, elapsed time, per-identity requests and spend; do not rely only on the existing chat IP limiter. Log request IDs, duration, outcome, and usage with sensitive content redacted. Keep provider credentials server-side.

## 9. Integration with grant chat

1. Save the current profile, then navigate using `URLSearchParams` to `/chat.html?projectId=<id>`.
2. Chat reads the ID, fetches the authorized project, and shows name, readiness, missing context, and an Edit project link.
3. Each chat request sends only `messages` and optional `projectId` (`ChatRequestSchema` gains an optional UUID `projectId`; `askChat(messages, projectId)` adds it to the body only when set). The server independently resolves ownership from the session and loads the current profile.
4. A dedicated context builder (`src/projects/project-context.ts`) produces two things, bounded in size (default cap about 2,000 characters; the cap is configurable and tested): a short delimited text block of relevant fields, with facts, unknowns, and unconfirmed assumptions listed separately; and a small structured subset (`applicantType`, `state`, `modes`) for retrieval. Profile JSON is never shown as the normal user interface.
5. Where the context enters the existing `classifyIntent` → `runRetrieval` → `draftReply` pipeline:
   - **Classifier:** unchanged. Routing uses the conversation only, so profile text cannot influence which tools are enabled.
   - **Retrieval:** receives the structured subset so tool arguments (for example `applicantType` for `check_eligibility`, state for search) can default from the project. The `INTENT_TOOLS` allowlist is unchanged; the profile never adds, removes, or authorizes a tool. If `applicant.type` is null, the model must ask rather than guess.
   - **Drafting:** receives the text block appended to the system prompt in a clearly delimited section next to the gathered facts, labeled as applicant-provided and untrusted. The drafting prompt gains one rule: use the profile only to tailor and prioritize the answer, never as a source of grant names, amounts, deadlines, or eligibility.
6. Existing tool calls and response rendering are retained. With no `projectId`, the route's behavior is unchanged.
7. Invalid, inaccessible, or deleted IDs return `404 PROJECT_NOT_FOUND`; the chat page shows a recoverable context error and offers explicit continuation without the project. Never silently answer as if context loaded.
8. The response gains `context: { projectId, revision }`. The client remembers the revision from the first response of a conversation. Because the server loads the latest profile on every request, a later response with a different revision means the profile changed mid-conversation: the page then shows a notice (“Project updated — this conversation now uses revision N”) and offers to start a fresh conversation. The notice therefore arrives with the next response; no polling is used. Selecting a different project always resets the conversation to prevent context mixing.
9. Chat has read-only access to profile context. Suggested changes link back to the workspace.

Do not put profile contents in query strings. Do not interpret profile text as permission to invoke additional tools. Grant matching and eligibility statements must remain grounded in existing grant data and checked requirements; discovery completeness establishes neither eligibility nor funding likelihood.

## 10. Staged implementation and gates

### Stage 0 — Repository reconnaissance and decisions

Read applicable repository instructions (none were present when this plan was written; do not create any), the README, and the chat route and its three agents. Confirm the deployment target and whether it offers a persistent volume on a single instance. Choose the SQLite driver for the pinned Node version and add `engines`. Confirm the Vitest setup (no test files exist yet; `npm test -- --run` is expected to work with defaults). Confirm current working-tree changes before editing. Identify existing UI patterns in `public/` worth reusing.

Confirm each default in the §1 table, or record a justified deviation.

Gate: a short implementation map listing verified files, commands, and the confirmed defaults. The only condition that blocks work is the one stated in §1 (no persistent volume, or multiple instances); resolve it before exposing project data.

### Stage 1 — Domain and persistence

Implement schemas, migration, store, ownership boundary, optimistic concurrency, idempotency, field provenance, and readiness calculation. Add service tests and restart persistence tests.

Gate: two principals cannot access each other's projects; edits survive restart; conflicting writes do not overwrite; failed transactions leave consistent state.

### Stage 2 — CRUD API and manual workspace

Add API routes, navigation, project selector, responsive two-pane page, direct editor, save/retry/conflict states, archive/restore/delete. Keep schema/UI names consistent. Scope styling to avoid regressions in existing pages.

Gate: a user can author and reopen a project without AI; refresh and save failures do not falsely report success; full keyboard workflow works.

### Stage 3 — Discovery agent and review

Add prompt, model response validation, bounded conversation persistence, suggestions with per-field review, apply/dismiss, stale-batch handling, rate/usage limits, and timeout/retry states.

Gate: a realistic multi-turn discovery produces a useful profile; unsupported or malformed model output never mutates it; accepted user edits cannot be overwritten by late responses.

### Stage 4 — Chat handoff

Before changing the route, add a characterization test of current no-project chat behavior (stub the model and MCP calls). Then extend `askChat` and `ChatRequestSchema` compatibly; add context banner, authorized lookup, context builder, pipeline wiring per §9, project switching, revision metadata, and missing-project recovery.

Gate: grant chat uses the selected saved profile; the characterization test passes unchanged; no cross-project context leak; the profile cannot change which tools run.

### Stage 5 — Release validation and operations

Run focused tests, regression checks, build/lint, responsive/accessibility review, and a controlled model smoke test using approved credentials. Document configuration, migration, retention/deletion, backup, restore, and support steps. Keep `PROJECT_DISCOVERY_ENABLED` (see §1) off until migrations and authorization are ready. New flag/config names are proposals.

Gate: acceptance checklist complete, deployment storage persists through restarts, rollback rehearsed, and remaining limitations documented. Enable only after release approval under the repository's normal process.

## 11. Testing and acceptance criteria

Use Vitest for deterministic logic and service/API behavior; reuse any existing browser test tooling. Add a browser runner only if needed and justified. Stub model calls for routine CI. Use synthetic projects and no live grant/model API calls in deterministic tests.

| Area | Required evidence |
| --- | --- |
| Schemas | Unknown/null versus zero; invalid dates/enums; money overflow; forbidden paths; oversized input; cross-field rejection |
| Readiness | Six-item rules; accepted versus unconfirmed values; warnings; ready/draft transitions |
| Storage | CRUD, migration, restart, transactional failure, dependent deletion, archive/restore |
| Isolation and sessions | Another principal cannot list/read/edit/delete/discover/apply or use project context in chat; cookie flags and lifetime; missing or mismatched `Origin` rejected; no session row created by `GET`; per-session and per-IP limits; daily cap; project and message caps |
| Concurrency | Two edits from one revision; accepted suggestion racing manual edit (per-change `basis` conflict); delete during model response; duplicate request replay; `DISCOVERY_BUSY`; stuck `in_progress` request recovery; `ready` reverting to `draft` after an edit |
| Agent | Grounded extraction fixture; conflicting user information; explicit unknown; prompt injection text; malformed output; timeout/quota; no mutation on failure |
| UI | Empty state, selector, direct edits, retry, stale edit preservation, review/apply/dismiss, save-before-handoff, mobile tabs and keyboard use |
| Chat | Optional projectId compatibility, context content and size, revision metadata and mid-chat revision notice, invalid/deleted ID, project switch reset, unchanged classifier input, `INTENT_TOOLS` unaffected by profile text, existing tool behavior |
| Rendering | User/model text and evidence links cannot execute scripts or unsafe URLs |
| Operations | Persistent deployment volume/database, backup/restore, feature flag off, sanitized logs |

Definition of done:

- [ ] A new applicant can create a project from a short idea and see a structured profile beside the guide.
- [ ] AI suggestions visibly show proposed changes and require review before profile mutation.
- [ ] Direct edits and accepted changes survive browser reload and server restart.
- [ ] Missing fields, unknowns, assumptions, and saved status are honest and actionable.
- [ ] Multiple projects remain distinct, including conversations and chat context.
- [ ] Ownership checks cover every project-dependent operation.
- [ ] A saved project opens grant chat with the correct profile and revision.
- [ ] No-project chat and existing grant pages retain their behavior.
- [ ] Model failures leave manual authoring operational and profiles intact.
- [ ] Automated checks pass or pre-existing failures are explicitly separated and documented.
- [ ] Documentation records configuration, migrations, retention, recovery, and limitations.

## 12. Claude Code execution guidance

This document is a plan, not authorization to modify code. Implement it only when the maintainer explicitly requests that, using the following prompt:

> Implement `doc/PROJECT_DISCOVERY_WORKSPACE_PLAN.md` in `marvoey/transportation-grants`. Start with Stage 0 and read applicable repository instructions. Verify the actual architecture before choosing paths. Preserve existing unrelated work. Implement the stages in order with small, reviewable changes and the stage gates described in the plan. Use the existing TypeScript/Express/plain JavaScript stack and shared server-side model infrastructure. Keep discovery separate from grant chat, validate every proposed profile update, enforce project ownership, and persist data durably. Run focused tests and the existing build/lint checks. Report changed files, validation results, decisions, and remaining limitations. Do not deploy, publish, merge, or make external changes unless separately authorized.

Execution notes:

1. Inspect the lockfile and package manager before installing anything. Do not replace dependencies or reformat unrelated code.
2. Translate the plan into a task checklist tied to verified files; complete and verify one stage before the next.
3. Keep schema, API, agent, and browser field names synchronized. Prefer runtime schema inference over duplicate independent types.
4. Use dependency injection for model calls and storage boundaries so failures and concurrency are testable.
5. Do not create a second general-purpose assistant, embed provider keys in browser assets, or repurpose the grant cache as persistent storage.
6. The repository has no tests yet, so Stage 1 establishes the convention: Vitest, colocated `*.test.ts` files. Scripts in `package.json` are `npm run build`, `npm run lint`, and `npm test -- --run`; `npm run dev:web` serves the app for manual validation. Avoid `npm run format` across unrelated files.
7. Record a checkpoint after each stage: behavior delivered, tests run/results, migration/config effects, and unresolved decisions. Do not claim tests passed if they were not run.
8. Do not modify repository instruction files merely to bypass their requirements. Ask only about the blocking condition in §1; for everything else follow the documented defaults and record any deviation.

## 13. Rollout and rollback

Back up the project database before migrations. Deploy compatible schemas and backend before enabling the workspace and navigation. Smoke-test with two isolated sessions. Enable the workspace only after persistence and ownership checks pass. Monitor save conflicts, model errors, latency, usage, and failed context loads without logging raw profiles.

Rollback by disabling discovery entry points and new model calls, retaining project data, and restoring the previous application version only if schema compatibility permits. Keep legacy `/api/chat` requests functional throughout. Do not automatically drop tables or delete profiles during rollback. Use the tested backup/restore procedure for incompatible migrations.

## Appendix A — Field paths and change operations

A `Change` is `{ op, path, value?, itemId? }`. This appendix is the complete allowlist for PATCH bodies, agent `proposedChanges`, and `questions[].field`. Any other path or operation is rejected with `400 VALIDATION_ERROR` (PATCH) or invalidates the whole agent output. Paths are relative to the record's `profile` object. Enum values and limits are finalized in Stage 1.

**Scalar paths — `op: set`; `value` is the new value, or `null` for unknown (except where noted)**

| Path | Value |
| --- | --- |
| `name` | non-empty string (null not allowed) |
| `summary`, `applicant.name`, `need.problem`, `budget.estimateBasis` | bounded string |
| `applicant.type` | `ApplicantType` |
| `location.state` | two-letter USPS code |
| `location.county`, `location.city`, `location.serviceArea` | bounded string |
| `scope.phase` | enum (Stage 1) |
| `budget.totalCostCents`, `budget.requestedFundingCents`, `budget.matchAmountCents` | safe nonnegative integer cents |
| `schedule.startDate`, `schedule.endDate` | `YYYY-MM-DD` |
| `readiness.planningStatus`, `readiness.designStatus`, `readiness.environmentalStatus`, `readiness.rightOfWayStatus` | enum (Stage 1) |

**String lists — `op: add` or `remove`; `value` is the string (exact match for `remove`)**

`applicant.partners`, `need.beneficiaries`, `scope.modes` (enum), `scope.activities`, `scope.assets`, `budget.matchSources`, `constraints`, `unknowns` (each value must itself be an allowlisted path from this appendix).

**Object lists — `op: add` (value without `id`), `update` (`itemId` plus partial value), `remove` (`itemId`)**

| Path | Editable item fields |
| --- | --- |
| `need.evidence` | `description`, `sourceUrl` (http/https or null). `suppliedBy` is set by the server from the caller (user or agent); `verified` is never settable |
| `outcomes` | `description`, `metric`, `baseline`, `target`, `unit` |
| `schedule.milestones` | `name`, `date` |
| `assumptions` | `text`; `confirmed` can be set to `true` only by a direct user edit, never by an agent change |

**Never changeable through these operations:** `id`, `ownerId`, `schemaVersion`, `revision`, `createdAt`, `updatedAt`, `status` (use the status endpoint), `budget.currency` (fixed to `USD` in MVP), `fieldMetadata`, `readinessAssessment`, and any item `id`.

**Server rules applied with every accepted change**

- Setting an `unknowns` path to a real value removes that path from `unknowns` in the same transaction.
- A `set` on a path whose current value is non-null is shown in the review UI as an overwrite, with the old value (the change's `basis`) beside the new one. It is never applied silently.
- Field metadata, readiness assessment, revision, and any `ready` → `draft` reversion are updated in the same transaction as the profile change.

## Implementation decisions (recorded Nov 1, 2026)

Deviations from the defaults in §1, made at the maintainer's direction:

| Plan default | Decision | Reason |
| --- | --- | --- |
| SQLite store, driver chosen in Stage 0, `engines` field | `JsonFileProjectStore` (a structured JSON file written atomically) behind the same `project-store` interface. No new dependency; no `engines` change. | Maintainer: "Make the store just ephemeral as a structured JSON file". |
| Blocking condition (no persistent volume / multiple instances) | Waived. Ephemeral storage is accepted. | Same instruction. Data is lost if the file is lost (redeploy, ephemeral filesystem); the store supports a single instance only. The workspace notice and docs say so. |
| Database backup/restore | Copy the JSON file (writes are atomic renames, so a copy is consistent). | Follows from the store. |

Stage 0 findings: `doc/DEPLOYMENT.md` does exist (a generic template); `npm run lint` fails before any change here (ESLint 8 has no config); `public/js/common.js` contains NUL bytes and is not modified; the Vitest setup must set `SAM_API_KEY` because the logger calls `getConfig()`.
