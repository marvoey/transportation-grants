# NOFO applicant assessment: demo guide

A state or local agency has a transportation project and has already chosen a federal funding opportunity. The **Assess a project** mode on the chat page answers: *what does the notice mean for us, what is missing, and what should we look into before applying?* Every result is **preliminary**.

Demo case: a hypothetical Virginia DOT project against the real FY2026 BUILD notice. BUILD is archived in Simpler.Grants.gov, so this is a historical demonstration, **not a claim that funding is open**. Nothing in the code is BUILD-specific; any ingested opportunity works the same way (Wildlife Crossings is the second test).

## Before the demo (operator, needs the API keys in `.env`)

```bash
npm install
npm run nofo:ingest  -- <opportunity-uuid>      # needs SIMPLER_GRANTS_API_KEY; downloads and parses the official documents
npm run nofo:extract -- <opportunity-uuid> --passes 2   # needs ANTHROPIC_API_KEY; writes requirements.json
npm run build
WEB_PORT=3000 npm run start:web                 # needs ANTHROPIC_API_KEY at request time
```

The BUILD UUID used in testing is the one in the Simpler.Grants.gov URL for "FY 2026 National Infrastructure Investments" (`DTOS59-26-RA-BUILD`). An opportunity appears in the selector when its package exists under `data/opportunities/<uuid>/` **and** it has extracted requirements; one that was ingested but not extracted is listed as "not ready".

Open `http://localhost:3000/chat.html`, choose **Assess a project**, or link straight to it: `chat.html?mode=nofo&opportunity=<uuid>`.

### Making the demo independent of the network

`data/opportunities/` is a git-ignored cache. To keep a known-good package for a demo machine, commit it deliberately and only if it is small and stable:

```bash
git add -f data/opportunities/<uuid>/
```

At request time the server only reads those files. It never calls Simpler.Grants.gov and never parses a document. The assessment needs the Anthropic API (to read facts from the user's message and to interpret free-text conditions), so a network is still required for that.

### Demo mode: a repeatable replay with no API calls, downloads or parsing

For a presentation you can replay a recorded run of the real screens. Find grants, Prepare and Assess show their real progress steps on a timer, and nothing is sent to the Simpler.Grants.gov API or the Anthropic API, nothing is downloaded and nothing is parsed. The page code is the real page code: `public/js/demo-mode.js` answers the `/api/nofo` calls from a recording instead of the server.

**Record once (needs the API keys, and a network).**

1. Start the server (`npm run dev:web`) and open `http://localhost:3000/chat.html?demo=record`. A red badge says "Recording mode".
2. Walk the demo path once with a **fictional project** (the Samples tray has them): describe the project, answer the clarifying question, get the shortlist, **Prepare** an opportunity, **Assess my project against this**, give a follow-up answer. Do not use real client data: the recording keeps the project text and the results.
3. Do not reload the page while recording (a reload keeps what was captured, but start-to-finish in one page is safest). Open the floating menu (☰), choose **Download recording**, and save the file as `public/demo/demo-run.json`. It is small, so commit it deliberately.

A turn is only recorded if it finished with a result, so a failed attempt is skipped. Record the happy path in the order you will present it.

**Replay.**

- The floating menu (☰) links to all three entry points, each opening in a new tab: **Open the app in demo mode** (`?demo=1`), **Open the app live (demo mode off)** (`?demo=0`) and **Record a demo run** (`?demo=record`). The demo and live links change the setting remembered by the browser, so reload any tab that was already open.
- Open `http://localhost:3000/chat.html?demo=1`. A badge says **"Demo mode: recorded run, not live"**, and it stays on screen: a replayed answer must never be presented as live. `?demo=0` (or the floating-menu item "Demo mode: On (turn off)") goes back to the live app. The choice is remembered in the browser.
- The first question gets the first recorded turn, the second gets the second, and so on. **The text you type is not interpreted**, so follow the recorded script. After the last recorded turn the last one repeats. Floating menu, **Restart demo**, reloads the page and starts again from the first turn.
- Each progress panel replays the recorded steps at the recorded pace, with any long wait shortened to 2.5 seconds. When a run completes the panel **stays on screen with every step ticked** and "Completed", with the results below it. The next question clears it. `?demo_speed=2` replays twice as fast.
- **Prepare** is scripted (about 5 seconds to download and read, then about 7 seconds to extract, then ready) and shows the requirements count from the recording. It does not start a job.
- **View source** still works because it reads the local `data/opportunities/` files through the server (no external call). The server must be running, but it needs no network and no API keys. Anything else under `/api/nofo` is refused with "Demo mode has no recording for this request".
- If `public/demo/demo-run.json` is missing or damaged, the screen says so. It never falls back to a live call.
- The FY2026 BUILD notice is still a historical demonstration case. Label it that way on screen.

## Script (about 5 minutes)

1. **Select** the opportunity. Point out the line under it: number, status, how many requirements were extracted, how many are flagged for review, and that **none has been verified by a person**.
2. **Describe the project**, e.g. *"We are the Virginia Department of Transportation. We want to rebuild a congested urban interchange on I-95 near Richmond with new ramps, auxiliary lanes and better freight access. This is a capital project."*
   - "What I am using from your words" lists each fact with the user's own quote. Remove any with its button; the page re-checks without it.
   - Most requirements are honestly **not yet evaluated** (unknown is neither a pass nor a fail).
   - Up to three follow-up questions appear, each saying which requirement makes it matter.
3. **Answer them**, e.g. *"It is urban. Total cost is $25 million, we are requesting $18 million federal, Virginia has committed $7 million in state match. We have not done a benefit-cost analysis yet."*
   - Federal share 72%, arithmetic consistent, assumptions listed.
   - The missing benefit-cost analysis is a **preparation gap, not an eligibility conflict**.
4. **Open a source** ("View source"): the drawer shows the stored page, highlights the quoted passage, and links to the original PDF at that page and to the official file.
5. **Change the request** (e.g. "actually $30 million"): the affected finding becomes a cited conflict against the maximum; no model call is needed for number changes.
6. **Switch the opportunity** in the selector: the same project facts are re-checked against the other notice.
7. Switch back to **Search grants** to show the original chat is unchanged.

## What the screen is and is not

- Findings carry a status (appears supported / possible conflict / preparation gap / needs specialist review / not yet evaluated) and a **Provisional** tag. Everything is provisional today because no requirement has been human-verified.
- The advisory text is written by code from the findings, never by a model. Quotes, numbers and page numbers are verified in code against the ingested documents.
- The server stores nothing: the conversation and facts live in the browser tab and are sent with each request.

## Known limitations

- **No requirement is human-verified** and there is no screen to verify one (edit `requirements.json` by hand). The reference set behind the extraction accuracy figures was drafted by the assistant, not by a person.
- Model judgments (free-text conditions, fact reading) vary between runs; the server keeps an in-memory cache, so an unchanged description is stable within a running process and resets on restart.
- Only the documents the API lists were processed (coverage is never "complete"). FAQs, amendments and checklists are not included unless added later as supplemental sources, so the "FAQ clarifies the notice" and "document contradicts the notice" scenarios are **not demonstrable yet**.
- The first turn takes about 20-30 seconds (model calls); later turns with unchanged free text are faster.
- Assessment requests are rate limited (default 10 per minute per client, `CHAT_RATE_LIMIT_REQUESTS`).
- The conversation is lost on page reload. Only the last 12 messages are sent.
- Browser verification was done in headless Chromium (desktop and phone width) with a DevTools Protocol script, not in Safari or Firefox, and without a screen reader.
- Not benchmarked against a manual review, so no time-saving claim is made.
