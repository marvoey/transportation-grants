# Big Build demo video script: timed show, do and say for the 2:50 walkthrough

**Theme:** From searching government programs to consulting about a project  
**Tagline:** **Start with the project. Not the program.**  
**Target video:** 2:50 (maximum 3:00), MP4, including a brief talking-head introduction and close.  
**Video source:** The real application at `http://localhost:3000/` and `/chat.html` — **no PowerPoint, Reveal.js, or `big-build.html` scenes**.  
**Scenario:** Fictional city police department seeking **$15 million** for traffic safety enforcement.  
**Code basis:** GitHub `marvoey/transportation-grants`, `nofo` branch, reviewed November 12, 2026; updated user screenshot.  

## Before recording — set up the application

1. Open `http://localhost:3000/` in a clean browser window. Use normal zoom or slightly enlarged text so the right-hand statistics and grant cards are readable. Hide developer trays and personal browser information.
2. Have the **Find grants** page ready to start with these two exact messages:
   - **Project:** `Our police department wants money to try a new traffic safety enforcement program to cut speeding and drunk driving.`
   - **Answer to funding question:** `We would request $15 million in federal funds.`
3. Confirm your live responses match the screenshot before narrating numerical values: the homepage may show a *saved count* from Simpler.Grants.gov. The provided screenshot shows **1,450 open or forecasted opportunities** and **839 listing state, county, or city governments as eligible applicants**, with a saved-count date. Never call these a current live count unless the screen confirms a live refresh.
4. On the provided $15M screenshot, GrantFlow recognized **Safety**, **City or township government** (its inference from the description, not independently verified) and a **$15 million federal request**. **11 listings** were checked: five primary matches shown and six further listings behind the button. ITSE ranks first with a **$20M listed maximum** that covers the request, **at the listing level only**; FY2027 Crash Causal Factors has a **$500K listed maximum**, below the request. A listed maximum that covers the request is favorable, not a conflict; the material warning is the $500K. Neither listing proves program eligibility or award likelihood. If the live ranking differs, point to the actual visible results rather than claiming a fixed ordering.
5. Prepare a genuine **assessment of this same $15M scenario** against the selected ITSE notice in advance. The bundled `public/demo/demo-run.json` is now the recording of exactly this case (2026-11-12: a city police department, a $15 million request, two Find grants turns and four Assess turns against ITSE; `demo-run-itse-speeding.json` is a copy). The other `public/demo/demo-run-*.json` files are different cases (a different request, or another program) and must not be passed off as this run. To use one, copy it over `demo-run.json`. In demo mode the text you type is not interpreted, so type the exact messages above. If you cannot prepare and verify a matching assessment, use the alternate 1:43–2:12 narration below.
6. Test that **View source** opens a real official passage. If using the application's replay mode (`?demo=1`; `?demo=record` captures a run; `?demo_speed=2` replays faster) or simulated preparation (Settings tray), keep its on-screen label visible and describe it truthfully as a recording or **SIMULATED PREPARATION**: it does not download or parse anything at that moment. For the strongest video, capture one real run first, then edit out network delays.
7. From the floating menu (bottom-left) open the **demo script window**, which shows this script scene by scene, and the **projects and answers window**, whose Projects and Answers tabs have Copy buttons that type into the app's question box. Keep both beside the app. The small round toggle at the bottom-right hides the drawer tabs for a clean screen. After editing this file, run `npm run demo:script` to rebuild what the window shows.

## Exact timed walkthrough — show / do / say

### 0:00–0:22 — The problem: start on the real homepage

**SHOW/DO:** Talking head for approximately 5 seconds, then cut directly to **the actual GrantFlow homepage** at `localhost:3000`. Rest the pointer over the funding-opportunity statistics on the right. Do not open any presentation slide.

**SAY:**

> “When you visit a doctor, you don't search hundreds of treatments. You explain your situation, and they ask questions. Government employees looking for grants often do the opposite. As you can see on the GrantFlow home page, even a saved count shows more than fourteen hundred open or forecasted opportunities. Finding the right program means guessing keywords, applying filters, and reading long notices.”

**DIRECTING NOTE:** The homepage specifically labels the statistics as a saved count, with its date. Leave that label visible. The statistic describes the broader funding search space, not specifically the number of DOT grants.

### 0:22–0:34 — Introduce the innovation

**SHOW/DO:** Keep the homepage visible. Point to the headline **“Start with the project. Not the program.”** Click **Find grants**.

**SAY:**

> “GrantFlow reverses that process. Instead of starting with a program, we start with the project—and let the application guide the consultation.”

### 0:34–0:57 — Describe the project and answer the system's question

**SHOW/DO:** In the real **Find grants** tab, enter the exact project message above and click **Find grants**. Show GrantFlow asking **“Roughly how much federal funding would you request?”** Then type the exact `$15 million` response and submit. Cut only waiting time, not the meaningful question-and-answer sequence.

**SAY:**

> “Here's our fictional city police department. We want to reduce speeding and drunk driving. I describe that goal in plain language—no program name or filters. GrantFlow asks a useful follow-up: how much federal funding are we requesting? Fifteen million dollars.”

### 0:57–1:27 — What GrantFlow understood; explained matches and warnings

**SHOW/DO:** Scroll to **“What I understood from your description.”** Briefly highlight **Safety**, **City or township government**, and **$15 million**. Continue to **“Opportunities, best fit first.”** Pause on **ITSE** and its statement that the **$20M maximum covers the $15M request**. Scroll to **FY2027 Crash Causal Factors Program**, showing the warning that its **$500K maximum is below the request**.

**SAY:**

> “Now look at what GrantFlow understood: project type, applicant, and funding need. It searches the actual government listings and explains the matches. The Innovative Traffic Safety Enforcement program looks relevant; its listed twenty-million-dollar maximum covers our request. But another program caps awards at five hundred thousand. GrantFlow flags that mismatch immediately. These are possible matches, not eligibility decisions.”

**DIRECTING NOTE:** Do not describe ITSE as “eligible,” “approved,” or certain to fund the project. The application infers the applicant type from the description; it does not validate that status independently.

### 1:27–1:43 — Show the work behind the shortlist and move into assessment

**SHOW/DO:** In the actual results screen, briefly highlight the **documents downloaded/read** panel. In the supplied screenshot this shows **14 documents, 226 PDF pages, approximately 74,200 words, 254 extracted requirements and 53 additional documents/forms** across five prepared opportunities. Then show **Prepare this opportunity for assessment** on the ITSE card; if already prepared for your recording, use **Assess my project against this** and open the actual **Assess a project** tab.

**SAY:**

> “And the workflow doesn't stop at discovery. GrantFlow can prepare official grant documents and extract their requirements, then carry the project directly into an assessment. You can see the documents and requirement counts right here.”

**DIRECTING NOTE:** The counts are the application's prepared-document inventory, **not proof that every requirement is correct or human-verified**. Do not spend video time watching a full preparation run. If **Simulate preparing** is on, its progress is a simulation over already-prepared documents and must be identified as such.

### 1:43–2:12 — Show the actual Assess a project experience

**SHOW/DO:** In the real **Assess a project** tab, show the selected ITSE notice, the project-specific preliminary assessment, a genuine follow-up question about missing information, and one **View source** action that opens an official source passage. Use the **same fictional $15M scenario**. If necessary, splice together authentic footage recorded earlier using this same scenario, with no invented findings.

**SAY — ONLY WHEN THE MATCHING ASSESSMENT IS VISIBLE:**

> “Here, the application compares our project facts with the notice's requirements. It separates what appears supported, possible conflicts, and what we still don't know. Instead of making up an answer, it asks what information is missing. And when we open a finding, we can inspect the original source passage. This is decision preparation, not an official eligibility ruling.”

**FALLBACK — IF THE MATCHING $15M ASSESSMENT IS NOT AVAILABLE:**

**SHOW/DO:** Remain on the real ITSE card, document inventory, and the actual **Assess a project** tab. Do not display unrelated $1.8M output while speaking about $15M.

**SAY:**

> “Selecting an opportunity takes us beyond the search list. GrantFlow prepares the official documents and structures their requirements for project-specific review. The assessment workflow is designed to identify unresolved questions, show preliminary findings, and connect them to source passages. Final eligibility remains with the program office.”

### 2:12–2:41 — Mission value, still on the application

**SHOW/DO:** Keep the real Assess screen or return to the real Find grants results. For numerical emphasis, use **simple on-video text captions over the application footage**, not a presentation slide: `Manual preliminary assessment: 6–10 hours`; `Projected assisted: 2–3 hours`; `~70% lower active effort (modeled)`; `~800 applicant hours in an illustrative 300-application cycle`. Keep **“ILLUSTRATIVE MODEL — NOT MEASURED”** visible throughout the claim.

**SAY:**

> “The value is staff time back for the mission. Our illustrative model estimates six to ten hours for a manual preliminary assessment, compared with two to three hours with assistance—about seventy percent less active effort. Across a hypothetical three-hundred-application round, at fifty-percent adoption, that could free roughly eight hundred applicant hours. These are projections, not measured savings; discovery savings aren't included.”

**DIRECTING NOTE:** The precise model is midpoint 8 hours versus 2.5 hours, saving 5.5 hours; 300 applications × 50% × 5.5 hours = 825 hours, rounded to about 800. Do not describe this as measured ROI or actual cost savings.

### 2:41–2:50 — Close on the application

**SHOW/DO:** Return to the real GrantFlow homepage headline **“Start with the project. Not the program.”** Optionally cut to talking head for the final sentence. No extra deck or closing slide.

**SAY:**

> “The shift is simple: stop making employees navigate the programs first. Understand their project, guide the questions, and make the next step clearer. Start with the project. Not the program.”

## Efficient editing and filming

- Show the **real homepage and the real Find grants/Assess tabs throughout**. The video is a narrated application demonstration, not a slide presentation.
- Keep app text readable by zooming or cropping to the current section; avoid showing a whole tall page reduced to unreadable size.
- Use jump cuts to skip API waiting, scrolling, and lengthy document preparation. Be candid about any prerecorded response or simulated loading sequence.
- A talking head is required by the supplied Big Build guidelines: include it briefly at the start and optionally at the end.
- If the homepage numbers change or the live search ranks opportunities differently, adjust spoken values to what is **actually visible**.
- Do not mix $15M discovery with the repository's preexisting $1.8M assessment recording; they are materially different project cases.
- Deliver a **2–3 minute MP4**, with no sensitive client/CUI data. Deadline: **Nov 13, 2026, 11:59 PM ET**.

## Recording checklist

- [ ] The first project message and the **$15M** answer match the exact text above.
- [ ] Text is legible at 1080p: crop into the current card or section; never use a tall narrow screenshot as full-frame evidence.
- [ ] The **$20M ITSE maximum** is described as a favorable listed maximum, not a conflict; the **$500K Crash Causal Factors maximum** is the warning.
- [ ] A replayed run is labeled as a recording, never called live; simulated preparation is labeled simulated.
- [ ] Never say that all extracted requirements are verified, that all source documents were captured, or that an award or eligibility has been determined.
- [ ] The homepage statistics are a dated saved snapshot, and the document and requirement counts are **system counts, not a benchmark of accuracy or staff hours saved**.
- [ ] Narration is 170 seconds or slightly under; the MP4 is 2–3 minutes with a talking head; nothing shown is personal, client or CUI data.

**Presentation companion.** `public/big-build-v2.html` is a five-scene framing and impact page (each scene is mapped to a part of this script, with speaker notes on **S**). Use it only for transitions and the impact numbers; the primary demonstration is the real application.

## Judging criteria covered

| Judging dimension | Visual proof inside the actual application |
| --- | --- |
| **Mission Impact & Value** | Homepage search scale; applicant time wasted navigating filters; modeled preliminary assessment savings and a credible pilot-measurement path |
| **Innovation** | Start with the applicant's project; system asks clarifying questions; contextual matching with reasons and warnings |
| **Execution** | Real user interaction, Simpler.Grants.gov results, document inventories, prepared requirements, assessment and real source citation when available |
| **Storytelling** | One fictional police department, one consistent $15M request, a strong potential match, a clearly weaker alternative, and a memorable conclusion |

**Key sentence:** *“GrantFlow doesn't make the government employee understand the funding system before getting started. It begins by understanding their project.”*
