# GrantFlow: DOT Grant Decision Advisor — overview, setup and usage

Start with the project, not the program. GrantFlow helps a state or local agency with a transportation project work out which federal funding opportunities are worth a look, and what a specific notice of funding opportunity (NOFO) means for them, before they apply.

It has two connected parts in one web app, plus the original MCP server:

- **Find grants.** Describe the project in plain words. The app asks a few follow-up questions (project type, applicant, federal request), searches Simpler.Grants.gov for U.S. Department of Transportation opportunities, and shows a short list with the reasons each may fit and the things to watch out for.
- **Assess a project.** Pick an opportunity whose documents have been prepared and describe the project. The app holds a short consultation in up to three stages (who you are and whether the notice applies, whether the money works, whether you are ready), compares what you said with the notice's requirements, shows what appears supported, what may conflict and what is still unknown, and links each finding to the original passage.
- **MCP server and original pages.** The earlier tools for searching DOT grants, checking eligibility and tracking deadlines (SAM.gov data) are still there; see [the legacy section](#the-original-mcp-server-and-grant-pages).

Everything it produces is **preliminary**. It is decision preparation, not an eligibility determination, a recommendation or an award prediction. Missing information is shown as *unknown*, never as a pass or a fail.

## How it works, in short

- Opportunities are identified by a **Simpler.Grants.gov opportunity UUID**. The official documents are downloaded and parsed once ("prepared"), the requirements are extracted with a source quote for each, and everything is stored as local files under `data/opportunities/<uuid>/`.
- A language model is used to read and to word things, never to decide. Code checks every quote, number and document reference, and the findings, questions and advisory are written by code. Wherever the model writes text, code checks it and a template replaces it if it fails. The details, step by step, are in [where the AI model is used and how code checks it](docs/NOFO_AI_USAGE.md).
- The evidence chain is: advisory conclusion → finding → structured requirement → original source document.
- No grant is hard-coded. The FY2026 BUILD notice is the main test case and Wildlife Crossings the second; any prepared opportunity works the same way.

## Quick start

**Prerequisites:** Node.js 20 or higher (recommended), and these keys in a local `.env` file (never commit it):

| Key | Needed for |
|---|---|
| `SIMPLER_GRANTS_API_KEY` | Searching Simpler.Grants.gov and preparing an opportunity (get one at https://simpler.grants.gov/developers) |
| `ANTHROPIC_API_KEY` | Extracting requirements, and the model-written parts of Find grants and Assess. Without it the pages still run with keyword reading and template text. |
| `SAM_API_KEY` | Only the original SAM.gov pages and MCP server (see below) |

```bash
npm install
cp .env.example .env      # then edit .env and add your keys
npm run build
npm run start:web         # or: npm run dev:web (auto-reload)
```

Open http://localhost:3000 (change the port with `WEB_PORT`). The Find grants and Assess tabs are on `/chat.html`; Assess is also `chat.html?mode=nofo`, and you can link straight to an opportunity with `chat.html?mode=nofo&opportunity=<uuid>`.

### Preparing an opportunity

In the app, choose **Prepare this opportunity** on a listing (it needs both the Simpler and Anthropic keys, runs one job at a time, and is capped per day by `PREPARE_DAILY_LIMIT`, default 5). Or prepare one from the command line:

```bash
npm run nofo:ingest  -- <uuid>              # download and parse the official documents (no model used)
npm run nofo:extract -- <uuid> --passes 2   # extract requirements with quotes; also plans the assessment stages
npm run nofo:stages  -- <uuid>              # (re)plan the stages for this grant only
npm run nofo:eval    -- <uuid>              # compare the extraction with a reference set (no model used)
```

An opportunity appears in the Assess selector when its package exists and it has extracted requirements. `data/opportunities/` is a git-ignored cache; commit a small, stable demo package deliberately with `git add -f`. At request time the server only reads those files.

Try the flows without the browser:

```bash
npm run nofo:find   -- "Our county wants a wildlife crossing where deer are hit"
npm run nofo:assess -- <uuid> --say "We are a state DOT planning ..."
npm run nofo:stats                                  # what has been prepared
```

## Demo mode and presenting

- **Demo mode** replays a recorded run in the browser with no API calls, downloads or parsing: open `/chat.html?demo=1` (`?demo=0` turns it off, `?demo=record` captures a new recording). A small play icon at the bottom-right always says the run is a recording, not live. "Simulate preparing" shows the preparation progress for opportunities whose documents are already downloaded.
- The **floating menu** (bottom-left) opens the **demo script window**: a separate window with the timed script (SHOW/DO, SAY, DIRECTING NOTE), the sample projects and suggested answers, each with a Copy button that types into the app. A small toggle at the bottom-right hides the drawer tabs for a clean screen. After editing `docs/GrantFlow_BigBuild_Live_App_Demo_Script.md`, run `npm run demo:script` to rebuild what the window shows.
- `/big-build-v2.html` is the Big Build presentation companion (framing and impact scenes; the video itself shows the real app); `/docs` shows the project's markdown documents in the browser.

See [the demo guide](docs/NOFO_DEMO.md) for the operator steps and known limitations.

## Configuration

Set in `.env` (see `.env.example` for all of them and their defaults):

| Variable | Purpose |
|---|---|
| `WEB_PORT` | Port of the web server (default 3000) |
| `ANTHROPIC_MODEL`, `ANTHROPIC_EXTRACTION_MODEL`, `ANTHROPIC_EXTRACTION_EFFORT` | Model and effort for every model step (the extraction variables take priority) |
| `ANTHROPIC_BASE_URL` | Route model calls through a gateway instead of api.anthropic.com |
| `SIMPLER_GRANTS_BASE_URL`, `SIMPLER_TIMEOUT_MS`, `SIMPLER_MAX_RETRIES` | Simpler.Grants.gov client |
| `PREPARE_DAILY_LIMIT`, `PREPARE_INGEST_TIMEOUT_MS`, `PREPARE_EXTRACT_TIMEOUT_MS` | The web "prepare" button |
| `NOFO_DATA_DIR`, `NOFO_MAX_DOWNLOAD_BYTES`, `NOFO_MAX_PACKAGE_BYTES` | Where prepared packages live and download caps |
| `CORS_ORIGINS`, `CHAT_RATE_LIMIT_REQUESTS`, `LOG_LEVEL` | Web server behaviour |

Applicants should not enter confidential information: the text of a conversation is sent to the model provider for each turn, though the server does not store it or log message text.

## Deploying on Vercel

Vercel runs code as serverless functions, so there is no start command and `npm run start:web` is not used there. Instead `api/index.js` exports the Express app as one function and `vercel.json` sets it up. Vercel runs `npm run build` (the TypeScript compile into `dist/`), serves `public/` as static files, and sends `/api/*` and `/docs` to the function.

- **Branch:** deploy a branch whose `package-lock.json` resolves from the public npm registry (`nofo` does). A lock file that points at a private registry makes Vercel's `npm install` fail with a 401.
- **Environment variables** (Project Settings → Environment Variables): `ANTHROPIC_API_KEY`, `SIMPLER_GRANTS_API_KEY`, and `CACHE_DIR=/tmp/.cache` (the deployed filesystem is read-only except `/tmp`). Optionally `DATA_SOURCE`, `CORS_ORIGINS` and the rate-limit settings from `.env.example`.
- **Prepared opportunities:** `data/opportunities/` is git-ignored, so a deployment only has the packages that were committed on purpose with `git add -f data/opportunities/<uuid>`. Five are committed (ITSE, Wildlife Crossings, Crash Causal Factors, Recalls and FAA research, about 12 MB); add another the same way. Without any, the Assess selector is empty; demo mode and Find grants still work.
- **What does not work there:** the real **Prepare this opportunity** (it runs the ingest and extract commands as child processes and writes to disk); turn on "Simulate preparing" in Settings for opportunities that are already committed. The rate limiters and caches live in memory, so they reset between function instances. A function call is capped at 60 seconds (`maxDuration` in `vercel.json`).
- For anything that needs a long-running server or a writable disk, use a host that runs `npm run build` then `npm run start:web` (set `WEB_PORT` to the port it gives you).

## Project layout

```
src/
├── nofo/                 NOFO features
│   ├── simpler/          Simpler.Grants.gov client (native fetch)
│   ├── acquire/, ingest/ Download, file-type detection, PDF/HTML/Word parsing, coverage
│   ├── extraction/       Requirements extraction and verification
│   ├── discovery/        Find grants: profile, filters, ranking, reply
│   ├── assessment/       Assess: facts, checks, questions, stages, replies
│   ├── prepare/          The web "prepare" job manager
│   ├── service.ts        assessTurn, the Assess turn
│   └── reply-check.ts    Checks on model-written text
├── web/                  Express server, routes (/api/nofo, /docs, ...) and front-end tests
├── mcp/, tools/, clients/, cache/  The original MCP server and SAM.gov code
└── config/, types/, utils/
public/                   The front end (plain HTML, CSS and JavaScript, no framework)
data/opportunities/       Prepared opportunity packages (git-ignored cache)
data/fixtures/            Small stable test fixtures
docs/                     Documentation
scripts/                  Small build helpers
```

## Development

```bash
npm run build         # TypeScript build
npx tsc --noEmit -p . # type-check only
npm test              # Vitest (watch mode); npm run test:run runs once
npm run lint
npm run format
```

Tests use local fixtures with injected `fetch` and mocked model calls; they never touch the network. The conventions for contributors (and for Claude Code) are in [the development instructions](CLAUDE.md).

## The original MCP server and grant pages

The project began as a Model Context Protocol (MCP) server for U.S. DOT grant applicants, using SAM.gov, the Assistance Listings and USASpending.gov data. It is still included:

```bash
npm start             # the MCP server (after npm run build)
npm run dev           # the MCP server with auto-reload
```

It exposes four tools: `search_dot_grants` (filters by applicant type, amount, keywords and deadlines), `get_grant_details` (by notice ID or CFDA program number), `check_eligibility` (for an applicant type) and `track_upcoming_deadlines`. The matching web pages use the same code. Applicant types are state, city, county, tribal, MPO and transit agency.

It needs `SAM_API_KEY` unless `DATA_SOURCE` is `mock` (five built-in sample grants, no key) or `local` (a downloaded extract, `npm run update-grants`). Responses are cached under `.cache/` (programs for 7 days, opportunities for 6 hours) and SAM.gov calls are rate-limited (`SAM_RATE_LIMIT_REQUESTS`, default 100 per day). Common programs it knows include 20.205 (Federal-Aid Highway), 20.500 and 20.507 (transit), 20.106 (Airport Improvement) and 20.600 (State and Community Highway Safety).

## Documentation

The documents are in [`docs/`](docs/). The app serves them, with this README and the development instructions, as one list at `/docs`, presentation and demo material first and development material last:

- **[GrantFlow AI concept of operations](docs/BigBuild3_GrantFlow_ConOps.md)**: from government search to AI-guided consultation
- **[Big Build demo video script](docs/GrantFlow_BigBuild_Live_App_Demo_Script.md)**: the timed show, do and say for the 2:50 walkthrough
- **[Running and presenting the demo](docs/NOFO_DEMO.md)**: setup, demo mode, the presenter window and a walkthrough
- **[Big Build 3.0 submission guide](docs/BIG_BUILD_SUBMISSION_GUIDELINES.md)**: tracks, deliverables and the deadline
- **[Where the AI model is used in GrantFlow and how code checks it](docs/NOFO_AI_USAGE.md)**: every model step, what it is asked to do and what code verifies
- **[Fact sheets for the prepared funding opportunities](docs/NOFO_FACT_SHEETS.md)** and **[sample project descriptions for testing](docs/NOFO_TEST_PROJECTS.md)**
- **[Design, risks and change log](docs/NOFO_MVP_PLAN.md)**: the architecture plan and a record of every change
- **[Development instructions](CLAUDE.md)**: the rules for working on the code

## Support

- **This project:** open an issue in this repository.
- **Grant programs:** contact the agency office listed in the opportunity.
- **SAM.gov APIs:** https://open.gsa.gov/api/get-opportunities-public-api/

## License

MIT
