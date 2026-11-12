# GrantFlow AI — Big Build 3.0 Demo Runbook (Updated $15M Scenario)

**Narrative:** From government search to AI-guided consultation  
**Tagline:** **Start with the project. Not the program.**  
**Target:** **2:50 (170 seconds)**; Big Build requires an **MP4, 2–3 minutes, with talking head**.  
**Source:** User-supplied updated Find Grants screenshot (fictional city police department, $15M request); current `nofo` GitHub branch inspected November 12, 2026 (commit `8ee47e7566a84798c94268608b6720ed8f6c1902`); uploaded Big Build submission guidelines.  
**Format:** Talking head (~15–20 seconds total), then primarily real GrantFlow application footage. The five-scene companion HTML is a framing/recording aid; **the video should show the real app** for discovery and assessment.

## Fixed scenario and accuracy guardrails

**Use the following exact project statements when recording discovery:**

1. `Our police department wants money to try a new traffic safety enforcement program to cut speeding and drunk driving.`
2. When asked the federal-request question, respond: `We would request $15 million in federal funds.`

The screenshot shows GrantFlow recognizing **Safety**, **City or township government** (its inference, not independently verified), and **$15 million federal request**. It reports **11 listings checked**, five primary matches shown and six further listings accessible. Its leading match is the **Innovative Traffic Safety Enforcement (ITSE) Grant Program**, with a **listed maximum award of $20 million**; this covers the stated $15 million request **at the listing level only**. The **FY 2027 Crash Causal Factors Program** is marked with a **$500,000 maximum**, below the request. Neither listing proves actual program eligibility or award likelihood.

The screenshot's prep summary shows **14 documents, 226 PDF pages, about 74,200 words, 254 requirements, and 53 additional documents/forms**, based on a set of five prepared opportunities. Treat these as **screen-recorded counts**, not independently verified measurements of grant universe coverage or completeness. For the ITSE listing the screenshot displays *“Prepare this opportunity for assessment”*, so the screenshot alone does not show a completed ITSE assessment. The current repo offers recorded demo playback and simulated preparation, and **the bundled `public/demo/demo-run.json` is for $1.8M, not this $15M scenario**. Do not mix their narration or outputs. Re-record the exact $15M journey if including a downstream ITSE assessment.

## Detailed video script — exact actions and narration

### 0:00–0:20 | Problem and scale (20 seconds)
**SHOW:** Camera/talking head for 7 seconds, then home page at `http://localhost:3000/`. Highlight the right-side funding count tiles, especially **1,450 open/forecasted** and **839 listing state/county/city eligibility**. This is a **saved November 11, 2026 snapshot**; show its timestamp. Do not claim it represents all current open opportunities.

**SAY:**
> “When you visit a doctor, you don't search hundreds of treatments. You describe your situation. Government employees often do the opposite: guess keywords, set filters, and sift through long grant lists. This saved snapshot shows over fourteen hundred open or forecasted opportunities.”

**JUDGING:** Mission problem + scale, relatable analogy, clear beneficiary.

### 0:20–0:33 | The innovation (13 seconds)
**SHOW:** Pan to **“Start with the project. Not the program.”** Click **Find grants** on homepage; land on the actual Find Grants tab. Avoid a standalone GovRail slide.

**SAY:**
> “GrantFlow reverses that experience. Instead of making users learn the funding system, it begins by understanding the transportation project—like a guided consultation.”

**JUDGING:** Innovation, reframed interaction model.

### 0:33–0:59 | Guided consultation (26 seconds)
**SHOW / DO (precise):** In Find Grants, paste project sentence #1 above. Click **Find grants**. Capture the actual prompt asking **“Roughly how much federal funding would you request?”** Type sentence #2. Click **Send**. Use authentic recorded screen footage to cut out API waiting; no fabricated conversation.

**SAY:**
> “Here's a fictional city police department trying to reduce speeding and drunk driving. I describe the problem in plain language. GrantFlow doesn't require a program name—it asks an important follow-up: how much funding do we need? I tell it fifteen million dollars.”

**JUDGING:** Functional guided interaction, simple user story, innovation.

### 0:59–1:27 | Project understanding and explained shortlist (28 seconds)
**SHOW / DO:** Scroll just enough to show **“What I understood from your description”**: Safety, city or township government, and $15M. Then show the **“Opportunities, best fit first”** section and the top ITSE card. Emphasize **“Maximum award ($20 million) covers your stated request ($15 million)”**. Pan to the Crash Causal Factors result and **“Maximum award ($500K) is below your stated request ($15 million)”**. Keep text large; do not attempt full-page capture at small scale.

**SAY:**
> “Now we can see what GrantFlow understood: the project type, applicant, and fifteen-million-dollar request. It ranks possible opportunities and explains why. ITSE looks relevant, and its listed twenty-million-dollar maximum covers our request. But the next program caps awards at five hundred thousand—well below what we need. These are informed starting points, not eligibility decisions.”

**JUDGING:** Explainable results, relevant caution, immediately useful screening.

### 1:27–1:44 | From discovery to assessment preparation (17 seconds)
**SHOW / DO:** On the results screen, point at the lavender **documents processed** strip (14 documents, 226 pages, ~74,200 words, 254 requirements in the screenshot) and the **Prepare this opportunity for assessment** button on ITSE. Click only if you have time; jump to an authentic pre-prepared, completed assessment of **the same $15M fictional case**. If a prepare animation is replayed, label it **SIMULATED PREPARATION**; it does not download or parse anything at that moment.

**SAY:**
> “This goes beyond search. GrantFlow can read official notices and supporting documents, extract requirements, and move the same project into an assessment. The prepared files let us examine what a candidate program actually requires.”

**JUDGING:** Execution, official documents, discovery-to-assessment workflow.

### 1:44–2:13 | Evidence-backed project assessment (29 seconds)
**SHOW / DO:** Ideally use an actual **newly recorded $15M ITSE assessment**. Show the preliminary summary, a genuine question about missing information, a real finding, and click **View source** to show the official passage. The repository's old demo recording uses a **different $1.8M case**; do not display it while saying $15M. If the matching assessment isn't recorded, show the real **prepared requirements view** instead and narrate capability rather than a fabricated result. The source page must open from actual stored official documents.

**SAY — only if matching actual assessment appears:**
> “Next, GrantFlow checks what we've said against the extracted notice requirements. It distinguishes potential issues from information we haven't supplied and asks targeted follow-up questions. Each finding can be traced to the actual source passage. It's preliminary guidance for human review—not an automatic eligibility decision.”

**FALLBACK SAY — if no same-case assessment result exists:**
> “From here, GrantFlow prepares the official notice for project-specific assessment, extracting the requirements and retaining source passages. With a completed assessment, it can ask what remains unknown and show evidence-backed findings. That requires human verification.”

**JUDGING:** Honest execution claim, evidence, guided assessment, responsible boundaries.

### 2:13–2:40 | Quantified mission impact (27 seconds)
**SHOW:** Minimal graphic over clean app image or presentation's Impact scene. Permanently visible qualification **“ILLUSTRATIVE MODEL — NOT MEASURED”**. Visual: **Manual preliminary assessment 6–10 h → projected assisted 2–3 h**, **~70% midpoint reduction**, **300 × 50% × 5.5 = 825 ≈ 800 applicant hours** potentially freed.

**SAY:**
> “We modeled the impact of faster preliminary assessment: six to ten staff hours manually versus a projected two to three with assistance, about seventy percent less active effort. In a hypothetical three-hundred-application round, with half using GrantFlow, that's roughly eight hundred applicant hours potentially freed. These are estimates—not yet measured results—and discovery savings aren't included.”

**JUDGING:** Mission value, scale, honest assumptions and measurement.

### 2:40–2:50 | Close (10 seconds)
**SHOW:** Camera briefly, then product tagline **“Start with the project. Not the program.”**

**SAY:**
> “GrantFlow moves government funding from searching to consulting—less time navigating programs, more time advancing projects. Start with the project. Not the program.”

**JUDGING:** Clear memorable ending, human mission focus.

## Recording checklist / editorial decisions

- [ ] Screen resolution legible at 1080p: crop into the current card/section; do not use a tall 580-pixel-wide screenshot as full-frame evidence.
- [ ] The first project input and the **$15M** answer match the screenshot exactly.
- [ ] **ITSE $20M** is a favorable *listed maximum*, **NOT a $20M vs $25M conflict**; **Crash Causal Factors $500K** is the material warning.
- [ ] If showing ITSE assessment, prepare and record a matching **$15M** assessment; existing `public/demo/demo-run.json` contains **$1.8M**.
- [ ] Actual recorded demo playback is clearly labeled, not called live. `?demo=record` captures a run; `?demo=1` replays `public/demo/demo-run.json`; `?demo_speed=2` accelerates playback. If using Settings > Simulate preparing, plainly label **simulated**.
- [ ] Never claim all extracted requirements are verified, that all source documents were captured, or that a grant award/eligibility has been determined.
- [ ] Homepage stats are a saved dated snapshot. Counts of downloaded documents / extracted requirements are **system counts, not a benchmark of accuracy or staff-hours saved**.
- [ ] Keep narration 170 seconds or slightly under; MP4 2–3 min and talking head required. Sanitize all personal/client/CUI details. Deadline Nov 13, 2026, 11:59 PM ET.

## Why this covers Big Build judging

| Category | What the film demonstrates |
|---|---|
| **Mission Impact & Value** | Large cumbersome search space, earlier funding-range screening, modeled assessment savings, plausible scale and how to validate |
| **Innovation** | Start with project, not keyword filters; system asks relevant questions, then explains matches and cautions |
| **Execution** | Functioning application with public grants data, ranked shortlist, document processing, provisional assessments and source citations when demonstrable |
| **Storytelling** | One fictional city police department; one stated $15M request; one compelling relevant match and one clear warning; close on memorable phrase |

## Developer handoff

Presentation companion: **`big-build.html`**, a self-contained five-scene framing/impact deck featuring crops of the **actual user-supplied app screenshots**. Scenes are mapped to this script; speaker notes are accessible via **S**. Replace `public/big-build.html` in the repository, or open the file directly. The clickable **Open GrantFlow** buttons require the local app at `http://localhost:3000/`. The scenes are for transitions and narrative support—use **real app footage** for the primary demonstration.
