# Plan: preparing GrantFlow for judges and the public

Status (2026-11-12): **Phase 1 implemented; Phases 2 to 7 not started.** The plan comes from reading the code. Items marked "not verified" were not traced.

Phase 1 as built: `src/web/auth/admin-session.ts` (password check, signed cookie, `requireAdmin`), `src/web/routes/admin.ts` (`POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/session`), the login page `public/admin-login.html`, and a fix in `error-handler.ts` so a rejected JSON body is never logged (it can hold the password). Needs `ADMIN_PASSWORD` (12+ characters) and the new `ADMIN_SESSION_SECRET` (32+ characters). Nothing is gated by it yet: `requireAdmin` is not applied to any route until Phase 2. Type-checked and smoke-tested by hand; the new vitest files (`admin-session.test.ts`, `admin.test.ts`) have not been run because tests are paused.

## Goals

1. The public menu shows only the Documentation links. Everything else is visible only after logging in with the password in the `ADMIN_PASSWORD` environment variable.
2. Without a login, the site always simulates preparing opportunities (downloading and reading documents). It never downloads, extracts or spends model calls for an anonymous visitor.
3. Every model call has a fallback that works when the model fails, is slow or is not configured.
4. Anything else that must be closed before judges and the public see the site.

## What the code review found

1. **Hiding menu links does not protect the pages.** Everything in `public/` is a public file, including `demo-script.html`, `demo-projects.html`, `big-build-v2.html` and the demo recordings in `public/demo/`. On Vercel, `public/` is served straight from the CDN and never reaches Express, so Express middleware cannot gate those files. Admin-only pages have to move out of `public/` and be served by the function.
2. **`ADMIN_PASSWORD` is only a line in `.env.example`.** No code reads it and there are no sessions. Vercel functions keep no state, so login must be a signed cookie.
3. **"Simulate" is a browser setting and does not cover the costly path.** It lives in localStorage (`app-settings.js`, default on) and only replays opportunities that are already prepared (`prepare-replay.js`). `POST /api/nofo/prepare` is open to anyone and spends Simpler and Anthropic quota. Real preparing also cannot work on Vercel: the filesystem is read-only, the function is capped at 60 seconds, and extraction runs as a child process for up to 20 minutes.
4. **The old SAM-era routes are public.** `/api/chat` makes Anthropic calls with no limit beyond the rate limiter, and `/api/grants`, `/api/eligibility`, `/api/deadlines` and `/api/health` are open. The chat UI appears no longer to use them (not verified).
5. **CORS and headers are loose.** CORS is `*` with `credentials: true`. Only `/docs` sends a CSP; the rest of the site sends no security headers.
6. **Spend limits do not hold on serverless.** The rate limiters and the daily prepare cap are in memory, so they are per instance and reset on a cold start.
7. **Developer details go to every visitor.** Streamed "console" lines and API-call details are sent to every client and only hidden with CSS.
8. **Model calls have no time limit of their own.** No timeout is set in `src/nofo/llm.ts` or `src/clients/anthropic-client.ts`. If the SDK default is minutes long (believed, not verified for this version), a hung call reaches Vercel's 60-second cap and ends the function before any fallback can run.
9. **`/docs` publishes more than may be wanted.** It lists every `.md` file in `docs/` plus `README.md` and `CLAUDE.md`, including the plan and `BIG_BUILD_SUBMISSION_GUIDELINES.md`, which contains a named individual's work email. **This file is listed there too once deployed** (see Phase 6).
10. **The repo has leftovers.** `.data/projects.json` (project data from the old app) and `.claude/settings.local.json` are tracked. A quick scan found no Anthropic keys in tracked files or history; it was not exhaustive.

### Model-call fallbacks today

| Piece | Current fallback | Gap |
|---|---|---|
| Find: profile, describe, explain, reply | Keyword reader or code template | None |
| Assess: stages, detail questions, reply, suggest | Defaults, yes/no template, code template | None |
| Assess: facts and answers | Empty result plus a warning | The applicant's message is silently not recorded |
| Assess: interpret | Returns `ok:false` | The caller was not traced (not verified) |
| `POST /api/nofo/assess` | None | Returns 503 when there is no key, although the service can run without a model |
| `/api/chat` | None | Hard error |
| Front end | Shows `e.message` | No "degraded" notice and no switch to the recorded demo |

## Plan

### Phase 1: admin login (server side)

- Add `POST /api/admin/login`, `POST /api/admin/logout` and `GET /api/admin/session`.
- Compare the password in constant time (SHA-256 digests and `timingSafeEqual`). Fail closed if `ADMIN_PASSWORD` is unset or short.
- A new `ADMIN_SESSION_SECRET` signs the cookie. The cookie carries an expiry of 8 hours or less. Rotating the secret signs everyone out.
- Cookie: HttpOnly, Secure, SameSite=Lax, Path=/. Responses are `Cache-Control: no-store`.
- Rate-limit login with growing delays. Log successes and failures with no password in the log.
- One `requireAdmin` middleware is the only place that checks admin status.
- The login page is a new small file (never `public/js/common.js`).

### Phase 2: public versus admin

- Public menu: Documentation links only. The other entries (presentation companion, demo mode on/off, record, presenter windows, Dev and Settings drawers) appear only after `/api/admin/session` confirms admin.
- Move the pages that should be private into an `admin/` folder outside `public/`, served behind `requireAdmin`. Add the folder to `includeFiles` in `vercel.json`.
- `POST /api/nofo/prepare` refuses real runs without admin. The browser then forces the simulated replay, and the server rule holds even if localStorage is edited.
- Send console and API-call details only to admins.

### Phase 3: attack surface

- Gate `/api/chat`, `/api/grants`, `/api/eligibility` and `/api/deadlines` behind admin, or switch them off with an env flag.
- Strip rate-limit detail from `/api/health`.
- Use a CORS allowlist or same-origin, with no `credentials: true`.
- Add a CSP, HSTS, `nosniff`, `frame-ancestors` and a referrer policy, after checking the pages for inline scripts.
- Set an explicit size limit on `express.json`.
- Turn on Vercel Authentication for preview deployments.

### Phase 4: spend protection

- Use a separate Anthropic key for the public deployment, with a spend cap set in the Anthropic console. That cap is the only limit that holds on serverless.
- Optional: a shared store (Marketplace Redis) for a real global counter. Skip for the deadline.

### Phase 5: model fallback

- Wrap `LlmFn` in one resilient layer: a 15 to 20 second timeout per call, at most one retry, and a whole-turn budget under 45 seconds. After two failures in a row it skips the model for about a minute so visitors are not made to wait.
- Every piece returns its code result plus a `degraded` flag, and the page shows one banner when it is set.
- `/assess` runs without a model instead of returning 503.
- Facts: code reads what it safely can (dollar amounts, button answers) and keeps a message it could not read in the Answers drawer with a clear note. Check that the drawer works without a model.
- If the live path is down, offer a switch to the recorded demo.
- Tests make each piece fail, time out and return garbage, and check the response.

### Phase 6: hygiene

- Untrack `.data/projects.json` and `.claude/settings.local.json`.
- Run a secret scanner (gitleaks or trufflehog) over the full history before anything is pushed to a public remote.
- Decide what `/docs` lists. **Restrict the listing before deploying so this plan and `CLAUDE.md` are not published**, and remove the personal email from the submission guidelines.
- Run `npm audit` and keep dependency versions pinned.
- Add a short privacy note on Find grants and Assess: what is typed is sent to a model provider, so do not enter confidential details.
- Update `docs/NOFO_MVP_PLAN.md`.

### Phase 7: verification

- Run `npx tsc --noEmit -p .` after each phase.
- Test the admin gate: no cookie, a tampered cookie, an expired cookie and unset env vars must all fail closed on every gated route.
- Walk through the whole public flow in a private window with the Anthropic key set to something invalid.

## Minimum cut for the deadline

Phases 1 and 2 (the gate, the menu and the prepare block), the legacy-route gating and CORS fix from Phase 3, the timeout and `/assess` fixes from Phase 5, the spend cap from Phase 4, and the Phase 6 hygiene items. Everything else can follow.

## Decisions needed

1. **"Links in public/docs".** Assumed to mean the Documentation link (`/docs`). Should the demo-mode links (`?demo=1`, replay) stay public, with only recording and the presenter windows private? The recordings must stay fetchable if replay is public.
2. **Unprepared opportunities for public users.** Recommended: the Prepare button is disabled with a short explanation. The replay shows only real prepared packages, and faking one would break the evidence rule in `CLAUDE.md`.
3. **Shared admin password.** This is custom authentication, which Optimizely's checklist normally rules out. The controls in Phase 1 are compensating measures that are acceptable for this event. Anything lasting beyond it should move to SSO.
