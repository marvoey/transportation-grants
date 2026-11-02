# Project Discovery Workspace

An applicant describes a transportation idea to an AI discovery guide and ends
up with a **structured, editable, saved project profile**. They then open grant
chat with that profile as context. The profile is the durable output; the
conversation is only how it gets filled in.

- Workspace: `/project.html` (plain HTML/JS, no framework)
- Grant chat with context: `/chat.html?projectId=<id>`
- Design and decisions: [PROJECT_DISCOVERY_WORKSPACE_PLAN.md](./PROJECT_DISCOVERY_WORKSPACE_PLAN.md)
  (including the *Implementation decisions* section at the end)

**The feature is off by default.** Nothing below is reachable until
`PROJECT_DISCOVERY_ENABLED=true`.

## Read this first: storage is ephemeral

Projects, conversations and suggestions are stored in **one JSON file**
(`PROJECT_DB_PATH`, default `.data/projects.json`, git-ignored). This was a
deliberate choice (see the plan's *Implementation decisions*):

- **Single instance only.** The store serializes writes inside one process. Two
  instances (PM2 cluster, several containers) would each have their own copy and
  overwrite each other's file. Do not run this feature behind a load balancer
  with more than one instance.
- **Data lives only as long as the file.** A redeploy that replaces the working
  directory, an ephemeral container filesystem, or a serverless platform loses
  every project. Mount a persistent volume and point `PROJECT_DB_PATH` at it if
  projects must survive deploys.
- **Anonymous sessions.** There is no sign-in. A project is reachable only from
  the browser (cookie) that created it. Clearing cookies, switching browsers or
  resetting the server makes earlier projects unreachable; the workspace says
  so plainly. There is no automatic expiry of anonymous sessions (known
  limitation).
- The workspace shows users a notice that content is stored on the server, sent
  to the AI provider, and permanently removed when a project is deleted.

## Configuration

All optional unless noted. Defaults in parentheses.

| Variable | Purpose |
| --- | --- |
| `PROJECT_DISCOVERY_ENABLED` | **Master switch** (`false`). Off: `/api/projects*` return `404 PROJECT_NOT_FOUND`, `project.html`/`project.js`/`project.css` are not served, the nav link is not rendered, and chat ignores project context (a `projectId` is a 404). |
| `PROJECT_DB_PATH` | JSON store path (`.data/projects.json`). Keep it outside `public/`. |
| `PROJECT_ALLOWED_ORIGINS` | Extra origins allowed to make state-changing project requests, comma-separated. Defaults to `CORS_ORIGINS` (entries other than `*`). Same-origin is always allowed. |
| `PROJECT_MAX_PER_SESSION` (`25`), `PROJECT_MAX_MESSAGES` (`200`) | Caps per session / per project conversation. |
| `PROJECT_RATE_LIMIT_REQUESTS` (`120`) / `PROJECT_RATE_LIMIT_WINDOW_MS` (`60000`) | Per-session limit on project routes. |
| `PROJECT_IP_RATE_LIMIT_REQUESTS` (`300`) / `PROJECT_IP_RATE_LIMIT_WINDOW_MS` | Per-IP limit on project routes. |
| `DISCOVERY_RATE_LIMIT_REQUESTS` (`6`) / `DISCOVERY_RATE_LIMIT_WINDOW_MS` (`60000`) | Per-session limit on model-calling turns. |
| `DISCOVERY_IP_RATE_LIMIT_REQUESTS` (`10`) | Per-IP limit on model-calling turns. Anonymous sessions are free to create, so a per-session limit alone is bypassable. |
| `DISCOVERY_DAILY_LIMIT` (`500`) | Global cap on discovery turns per UTC day; at the cap turns return `503 AI_UNAVAILABLE`. Kept in the store file so a restart does not reset it. |
| `DISCOVERY_TIMEOUT_MS` (`30000`) | Overall time budget for one turn (including the single repair attempt). |
| `DISCOVERY_MAX_TOKENS` (`2048`) | Output tokens per model call (chat's default of 1024 is sized for prose). |
| `DISCOVERY_HISTORY_MESSAGES` (`20`) | Persisted messages sent to the model per turn. |
| `PROJECT_CONTEXT_MAX_CHARS` (`2000`, min 400) | Cap on the profile context passed to grant chat. |
| `ANTHROPIC_API_KEY` | Required for discovery turns and chat. Without it turns fail with `503 MISSING_CONFIG` and nothing is stored; manual editing keeps working. |

The model is `ANTHROPIC_MODEL`, through the shared client
(`ANTHROPIC_BASE_URL` is honored).

## How it fits together

```
project.html + js/project.js
  → /api/projects/*  (src/web/routes/projects.ts)
      → session + same-origin checks (src/web/middleware/session.ts)
      → ProjectService (src/projects/project-service.ts)
          → ProjectStore / JsonFileProjectStore (src/projects/project-store.ts)
          → discovery agent (src/web/discovery/discovery-agent.ts) → Anthropic client

chat.html?projectId=… → POST /api/chat (+projectId) → authorized lookup
  → project-context.ts → retrieval (defaults only) and drafting (tailoring only)
```

| Path | Responsibility |
| --- | --- |
| `src/projects/schemas.ts` | Zod schemas/types for the profile and records |
| `src/projects/field-paths.ts` | Appendix A as data: allowed paths, operations, validation, `applyChanges`, suggestion `basis` |
| `src/projects/readiness.ts` | Deterministic completeness (six items) and warnings |
| `src/projects/project-service.ts` | CRUD, revisions, status, idempotency, discovery turns, review |
| `src/projects/project-store.ts` | Store interface + JSON file implementation + migrations |
| `src/projects/project-context.ts` | Bounded, safe context for grant chat |
| `src/web/discovery/discovery-agent.ts` | Prompt, forced `respond` tool call, output validation |
| `src/web/middleware/session.ts` | Anonymous session cookie, same-origin (CSRF) check |

## Behavior worth knowing

- **Ownership**: the owner is derived from the session cookie on every
  operation; a project UUID or any id in a body is never authorization. Missing,
  deleted and not-owned projects are one indistinguishable `404`.
- **Revisions and conflicts**: every write sends `expectedRevision`; a stale one
  is `409 REVISION_CONFLICT`. The workspace keeps local edits and offers to
  reapply them on top of the newer version.
- **Idempotency**: every write sends a client `requestId`; a replay with the
  same body returns the stored result, a different body is
  `409 IDEMPOTENCY_CONFLICT`. Records expire after 24 hours.
- **The agent only proposes.** A discovery turn stores the conversation and a
  *suggestion batch*; the profile changes only when the user applies selected
  changes. Each change carries a `basis` (what it was proposed against); at
  apply time a change whose basis no longer holds becomes a `conflict` and is
  skipped, so late model output cannot overwrite a user's edit. Overwrites are
  shown with the old value and are never pre-selected.
- **Validation**: all model output is validated against the field-path
  allowlist; one repair attempt is allowed. Invalid output, timeouts and
  provider errors never mutate a profile; the user's message stays with a retry.
- **Completeness is not eligibility.** `ready` means "reviewed for discovery".
  Grant matching still comes only from grant data; the profile only tailors
  chat answers and never changes which tools run.
- **Applicant types** are the existing `state | city | county | tribal | mpo |
  transit_agency`. Anything else is recorded with `applicant.type: null` plus a
  constraint; it is never mapped to an eligible type.

## Retention and deletion

Projects, messages and suggestion batches are kept until the user deletes the
project. Delete is a hard delete of the project and every dependent row in one
transaction (only the delete's own 24-hour replay marker, `{ "deleted": true }`,
remains). Archived projects are retained. A model response that arrives after
its project was deleted is discarded.

## Backup, restore and support

- **Backup**: copy `PROJECT_DB_PATH`. Writes are temp-file + fsync + atomic
  rename, so a copy taken at any moment is a consistent snapshot.
- **Restore**: stop the server, put the file back, start the server.
- **Corrupt file**: on startup an unreadable file is renamed to
  `<path>.corrupt-<timestamp>` and the store starts empty; the error is logged.
  A file written by a *newer* version is refused (the server will not start)
  rather than overwritten.
- **Migrations**: the file has a `fileVersion` and each project a
  `schemaVersion`; pure, repeatable migration functions run on load
  (`FILE_MIGRATIONS`, `PROJECT_MIGRATIONS` in `project-store.ts`). Back up the
  file before deploying a version that bumps either.
- **Whole-file rewrite per write**: file size is bounded by the per-session
  project cap and per-project message cap, which keeps this cheap at small
  scale. It is not designed for a large user base.
- **Logs** contain request ids, durations, outcomes and token counts for
  discovery turns; never profile or conversation content.

## Rollout and rollback

1. Deploy with `PROJECT_DISCOVERY_ENABLED` unset (off) and confirm
   `GET /api/features` reports `projectDiscovery: false`, `/project.html` is
   404 and existing pages/chat behave as before.
2. Decide where `PROJECT_DB_PATH` lives (see the ephemeral-storage notes above).
3. Enable the flag, smoke-test with two separate browser profiles (each must
   see only its own projects), and exercise a discovery turn with approved
   credentials.
4. Monitor `RATE_LIMIT_EXCEEDED`, `AGENT_TIMEOUT`/`AI_UNAVAILABLE`,
   `REVISION_CONFLICT` and failed context loads.

**Rollback**: set `PROJECT_DISCOVERY_ENABLED=false`. Entry points and model
calls stop immediately; the data file is untouched and legacy `/api/chat`
requests keep working. Never delete the file as part of a rollback.

## Known limitations

- Ephemeral, single-instance JSON storage (above).
- Anonymous sessions only; no sign-in, collaboration or cross-device access.
- No automatic expiry of anonymous sessions.
- Discovery is synchronous (one bounded request per turn); there is no status
  endpoint.
- Not covered: document upload/extraction, grant applications, GIS, CRM
  integrations.
