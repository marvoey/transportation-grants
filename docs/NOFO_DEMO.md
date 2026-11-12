# Running and presenting the demo: setup, demo mode, presenter window and walkthrough

A state or local agency has a transportation project. **Find grants** takes a plain-language description, asks a few questions and shows a short list of federal opportunities worth a look, with the reasons and cautions. **Assess a project** takes an opportunity that has been prepared and holds a short consultation: *what does the notice mean for us, what is missing, and what should we look into before applying?* Every result is **preliminary**.

**Demo case today:** a fictional city police department that wants to cut speeding and drunk driving and would request $15 million, assessed against the Innovative Traffic Safety Enforcement (ITSE) notice. The timed 2:50 version is in [the timed demo script](GrantFlow_BigBuild_Live_App_Demo_Script.md). The original case (a hypothetical Virginia DOT interchange project against the real FY2026 BUILD notice) still works if BUILD is prepared; BUILD is archived in Simpler.Grants.gov, so it is a historical demonstration, **not a claim that funding is open**. Nothing in the code is specific to either: any prepared opportunity works the same way. The opportunities prepared on this machine, and the sample projects that test them, are in [the fact sheets for the prepared opportunities](NOFO_FACT_SHEETS.md) and [the sample project descriptions](NOFO_TEST_PROJECTS.md).

## Before the demo (operator, needs the API keys in `.env`)

```bash
npm install
npm run build
WEB_PORT=3000 npm run start:web      # needs ANTHROPIC_API_KEY (and SIMPLER_GRANTS_API_KEY for a live search) at request time
```

To prepare an opportunity, either press **Prepare this opportunity** on its listing in Find grants (needs both keys, one job at a time, capped per day by `PREPARE_DAILY_LIMIT`), or run the commands:

```bash
npm run nofo:ingest  -- <opportunity-uuid>              # needs SIMPLER_GRANTS_API_KEY; downloads and parses the official documents
npm run nofo:extract -- <opportunity-uuid> --passes 2   # needs ANTHROPIC_API_KEY; writes requirements.json and plans the stages (stages.json)
```

An opportunity appears in the Assess selector when its package exists under `data/opportunities/<uuid>/` **and** it has extracted requirements; one that was ingested but not extracted is listed as "not ready". A grant prepared before the stage plan existed uses the default three stages until `npm run nofo:stages -- <uuid>` is run for it.

Open `http://localhost:3000/chat.html` (Find grants and Assess are tabs), or link straight to Assess: `chat.html?mode=nofo&opportunity=<uuid>`.

### Making the demo independent of the network

`data/opportunities/` is a git-ignored cache. To keep a known-good package for a demo machine, commit it deliberately and only if it is small and stable:

```bash
git add -f data/opportunities/<uuid>/
```

At request time the server only reads those files. It never calls Simpler.Grants.gov and never parses a document. Find grants and Assess still need the Anthropic API for the model-written parts, and Find grants needs the Simpler API to search, unless you use demo mode below.

## Demo mode: a repeatable replay with no API calls, downloads or parsing

For a presentation you can replay a recorded run of the real screens. Find grants, Prepare and Assess show their real progress steps on a timer, and nothing is sent to the Simpler.Grants.gov API or the Anthropic API, nothing is downloaded and nothing is parsed. The page code is the real page code: `public/js/demo-mode.js` answers the `/api/nofo` calls from a recording instead of the server.

**Record once (needs the API keys, and a network).**

1. Start the server (`npm run dev:web`) and open `http://localhost:3000/chat.html?demo=record`. A red badge says "Recording mode".
2. Walk the demo path once with a **fictional project** (the Samples tray has them): describe the project, answer the clarifying question, get the shortlist, **Prepare** an opportunity, **Assess my project against this**, and answer the follow-up questions through all the stages. Do not use real client data: the recording keeps the project text and the results.
3. Do not reload the page while recording (a reload keeps what was captured, but start-to-finish in one page is safest). Open the floating menu (☰), choose **Download recording**, and save the file as `public/demo/demo-run.json`. Commit it deliberately.

A turn is only recorded if it finished with a result, so a failed attempt is skipped. Record the happy path in the order you will present it.

**The recordings.** Only `public/demo/demo-run.json` is replayed. It currently holds the 2026-11-12 recording of the $15 million city police case: two Find grants turns (the description, then the funding answer, with 11 listings) and four Assess turns against ITSE. The other `public/demo/demo-run-*.json` files are recordings of other cases (a bike project, ITSE, Wildlife Crossings and others, with different requests); copy one over `demo-run.json` to replay it, and never narrate one case over another's screens.

**Replay.**

- The floating menu (☰) links to all three entry points, each opening in a new tab: **Open the app in demo mode** (`?demo=1`), **Open the app live (demo mode off)** (`?demo=0`) and **Record a demo run** (`?demo=record`). The demo and live links change the setting remembered by the browser, so reload any tab that was already open.
- Open `http://localhost:3000/chat.html?demo=1`. A badge says **"Demo mode: recorded run, not live"**, and it stays on screen: a replayed answer must never be presented as live. `?demo=0` (or the floating-menu item "Demo mode: On (turn off)") goes back to the live app. The choice is remembered in the browser.
- The first question gets the first recorded turn, the second gets the second, and so on, counted separately for Find grants and for Assess. **The text you type is not interpreted**, so follow the recorded script. After the last recorded turn the last one repeats. Floating menu, **Restart demo**, reloads the page and starts again from the first turn.
- Each progress panel replays the recorded steps at the recorded pace, with any long wait shortened to 2.5 seconds. When a run completes the panel **stays on screen with every step ticked** and "Completed", with the results below it. The next question clears it. `?demo_speed=2` replays twice as fast.
- **Prepare** is scripted (about 5 seconds to download and read, then about 7 seconds to extract, then ready) and does not start a job.
- **View source** still works because it reads the local `data/opportunities/` files through the server (no external call). The server must be running, but it needs no network and no API keys. Anything else under `/api/nofo` is refused with "Demo mode has no recording for this request".
- If `public/demo/demo-run.json` is missing or damaged, the screen says so. It never falls back to a live call.

**Simulated preparing without demo mode.** In the Settings tray (on by default), "Prepare this opportunity" for an opportunity whose documents are already downloaded on this server shows a simulated progress and then the document overview. Nothing is downloaded or sent, and it is labelled as a simulation. Turn it off to run a real job.

## Presenting with the demo script window

The floating menu has **Open the demo script window**, a separate window to keep beside the app:

- **Script** tab: the timed script scene by scene (SHOW/DO, SAY with a Copy button, DIRECTING NOTE, and the fallback branch). It is built from the live-app script by `npm run demo:script`, so edit the markdown, not the JSON.
- **Samples** and **Answers** tabs: the same sample projects and suggested answers as the trays on the page. **Copy** types the text into the app's question box at a human pace (within 3 seconds) and copies it too. This needs the window to have been opened from the app's menu, with Find grants or Assess showing.
- A small round toggle at the bottom-right of the app page hides the trays' edge tabs for a clean screen.
- The Settings tray also has switches for the "Preliminary only" notices.

## Walkthrough (about 5 minutes)

1. **Find grants.** Describe a project in plain words (the Samples tray has fictional ones). The progress panel shows the real steps. GrantFlow asks up to two questions at a time (project type, applicant, federal request); "Search now" skips them. Show **What I understood from your description**, then **Opportunities, best fit first**: five listings with the reasons it may fit and the cautions, the rest behind a button, and the documents already downloaded and read. The conversational reply above the list is written by the language model, checked by code and labelled as such; it never recommends a program or speaks of eligibility.
2. **Prepare and assess.** On a listing choose **Prepare this opportunity for assessment** (or, if it is prepared, **Assess my project against this**). The project description carries over into the Assess box.
3. **Select** the opportunity on the Assess tab. Point out the line under it: number, status, how many requirements were extracted, how many are flagged for review, and that **none has been verified by a person**.
4. **Describe the project** and send it.
   - "What I am using from your words" lists each fact with the user's own quote. Remove any with its button; the page re-checks without it.
   - The first reply explains how the consultation will go: up to three steps planned for this notice ("Step 1 of 3: ..."), one at a time, each with its reason.
   - **Where you stand** leads the results (looks workable / needs attention / can't tell yet), and "Findings to look at first" follow. Most requirements are honestly **not yet evaluated**: unknown is neither a pass nor a fail.
5. **Answer the questions.** Some are fixed questions about a fact the app reads, and some are made from the notice's own requirements (yes/no, a choice, a number, or a short description). Each says which requirement makes it matter and links its source. You can type, or open the **Answers** tray and copy the **Complete reply**, an example written by the language model that is made up for trying the app out. "I don't know yet" sets a question aside. After each message a line says **what changed** since the last one.
   - A missing benefit-cost analysis is a **preparation gap, not an eligibility conflict**.
6. **After the last step**, whatever is still open stays unknown and can be answered from the Answers tray under "All other open requirements". When nothing is left to ask, the question box and Send button go away.
7. **Open a source** ("View source"): the drawer shows the stored page, highlights the quoted passage, and links to the original PDF at that page and to the official file.
8. **Change the request** (for example to an amount above the notice's maximum): the affected finding becomes a cited conflict; no model call is needed for number changes.
9. **Switch the opportunity** in the selector: the same project facts are re-checked against the other notice.

## What the screen is and is not

- Findings carry a status (appears supported / possible conflict / preparation gap / needs specialist review / not yet evaluated) and a **Provisional** tag. Everything is provisional today because no requirement has been human-verified.
- The findings, their sources, the follow-up questions, "where you stand", "what changed" and the advisory are written by code from the stated facts and the notice. Quotes, numbers and page numbers are verified in code against the ingested documents.
- The language model writes only words: the reply that opens each turn (and the Find grants reply and explanation), the wording of the detail questions, and the example reply in the Answers tray. Code checks all of it, replaces it with a template if it fails, and labels it as model-written. See [where the AI model is used and how code checks it](NOFO_AI_USAGE.md).
- The server stores nothing: the conversation, facts and answers live in the browser tab and are sent with each request.

## Known limitations

- **No requirement is human-verified** and there is no screen to verify one (edit `requirements.json` by hand). The reference set behind the extraction accuracy figures was drafted by the assistant, not by a person. A stage plan is not reviewed either.
- Model output varies between runs. The server keeps an in-memory cache, so an unchanged description is stable within a running process and resets on restart; extraction results and stage plans are saved, so they stay the same until refreshed.
- Only the documents the API lists were processed (coverage is never "complete"). FAQs, amendments and checklists are not included unless added later as supplemental sources, so the "FAQ clarifies the notice" and "document contradicts the notice" scenarios are **not demonstrable yet**.
- A turn makes several model calls (facts, interpretation, question wording, the reply and an example reply), so it takes noticeably longer than a code-only check; the progress panel shows the steps.
- Assessment requests are rate limited (default 10 per minute per client, `CHAT_RATE_LIMIT_REQUESTS`), and "Prepare" is capped per day.
- The conversation is lost on page reload. Only the last 12 messages are sent.
- Demo mode replays a fixed recording: it does not interpret what you type.
- Browser verification was done in headless Chromium (desktop and phone width), not in Safari or Firefox, and without a screen reader.
- Not benchmarked against a manual review, so no time-saving claim is made; the impact numbers in the script are an illustrative model.
