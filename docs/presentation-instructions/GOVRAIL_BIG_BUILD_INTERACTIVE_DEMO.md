# GovRail + GrantFlow AI — Big Build 3.0 Interactive Presentation & Demo

> **Implementation brief for Claude Code**  
> **Target branch:** `nofo` in `marvoey/transportation-grants`  
> **Deliverable:** A self-contained, interactive, browser-based presentation integrated into the existing GrantFlow web application, plus a rehearsable **four-minute** video script.  
> **Submission requirement:** The final recorded video must be **2–5 minutes**, include **talking head + application walkthrough + impact**, and contain **no CUI or real client-sensitive data**.

## 1. Objective and positioning

Build an engaging, **presenter-controlled Big Build walkthrough** rather than a static slide deck or a replacement for GrantFlow. It must visually explain the **general-purpose GovRail architecture**, reveal **GrantFlow as the working proof of concept**, transition into the **real Find Grants and Assess a Project interfaces**, and close with **clearly labeled modeled government productivity benefits**.

**The message to remember:**

- **GovRail is the innovation:** an evidence-grounded AI guidance harness that orchestrates LLM reasoning, deterministic code, source evidence, and guided interaction.
- **GrantFlow AI is the working MVP:** a transportation-grant application that demonstrates the GovRail approach in both grant discovery and project-specific NOFO assessment.
- **Government productivity is the value:** reduced applicant research/assessment effort and plausible downstream reduction of federal clarification and rework during deadline-driven funding cycles.

The solution provides **preliminary, human-reviewed guidance**, not official eligibility determinations, award predictions, automated grant applications, or autonomous decisions. The broader GovRail use cases are **potential extensions**, not implemented applications.

## 2. Recommended framework: Reveal.js

**Use [Reveal.js](https://revealjs.com/) (pinned npm dependency) for the presentation shell.** It provides responsive HTML slides, keyboard/click navigation, incremental fragments, speaker notes, slide progress, and deep links. It fits the current **Express + static HTML/CSS/vanilla JavaScript** architecture without adding React, Next.js, or a separate SPA build system.

### Proposed integration

- Entry route: **`/big-build.html`** served by existing Express static hosting from `public/`.
- Create `public/big-build.html`, `public/css/big-build.css`, and `public/js/big-build.js`.
- Install a pinned `reveal.js` version through `package.json` and **serve the compiled assets locally** from a controlled `/vendor/reveal/` path (either copy distribution assets to `public/vendor/reveal/` as part of a reproducible build step or configure a narrowly scoped Express static mount). **No CDN dependency for the recorded demo.**
- Preserve the current `public/index.html`, `public/chat.html`, `public/js/discover.js`, and `public/js/nofo.js` behavior. Do not refactor the working grant application merely to build the presentation.
- Use Reveal.js speaker notes or a separate Presenter Notes mode for narration, cue timing, and demo actions. Audience view stays clean and uncluttered.
- Make slide state controllable by keyboard, mouse, and on-screen next/back buttons. Use `?slide=...`/Reveal slide hash links for direct rehearsal.
- Include a prominent **Launch Live GrantFlow** button on the demonstration slide that opens `chat.html?mode=nofo` in a new tab. Include a second direct link to `chat.html?mode=discover` **only if** that mode matches the app's current routing; verify from code. If the correct discovery route differs, use the actual supported route.
- Optionally implement a `?mode=record` query string that hides nonessential controls and animations for clean screen capture, **without hiding disclaimers**.
- Use readable type and a 16:9 slide layout. Prefer accessible animations with `prefers-reduced-motion` support and sensible text contrast.

### Existing image assets to use

The two architecture graphics were produced earlier in this Big Build project. Include them **as two distinct slides**, not a composite:

1. **General architecture (GovRail independent of grants):** `public/img/big-build/govrail-architecture-general.png`
2. **GrantFlow application architecture (GovRail → Find Grants / Assess a Project):** `public/img/big-build/govrail-grantflow-architecture.png`

If these files are not already in the repo, add the supplied PNG assets under those names. **Do not silently replace them with internet image search results or fabricate architecture illustrations.** Use meaningful alt text. The general architecture shows inputs → GovRail's hybrid reasoning/rules/evidence/guidance → structured findings/evidence/next steps/human decisions, with *example* workflows. The application graphic shows the same pattern implemented in GrantFlow's discovery and assessment flows.

> Keep the general diagram general. Do not imply GovRail is already an independently packaged SDK, public service, or production platform; the current MVP demonstrates shared architectural principles across two workflows.

## 3. Presentation storyboard: ~4 minutes

| Section | Timestamp | Approx. duration | Visual / interaction |
|---|---|---:|---|
| 1. Government problem | 0:00–0:30 | 30 sec | Talking head then a long NOFO preview / application-volume context |
| 2. GovRail innovation | 0:30–1:00 | 30 sec | **General GovRail architecture graphic** with staged emphasis |
| 3. GrantFlow proof of concept | 1:00–1:25 | 25 sec | **GovRail + GrantFlow architecture graphic**, then home screen |
| 4. Project-first discovery | 1:25–1:50 | 25 sec | Actual **Find Grants** screen or authentic recorded screen capture |
| 5. Requirements assessment | 1:50–3:15 | 85 sec | Actual **Assess a Project** screen; main demonstration |
| 6. Impact at scale | 3:15–3:45 | 30 sec | Animated impact slide with **modeled** figures |
| 7. Closing | 3:45–4:00 | 15 sec | Talking head; GovRail + GrantFlow branding |

The architecture sections should **not** overwhelm the actual demonstration. The assessment segment is the centerpiece. A filmed walkthrough of the live app is acceptable if processing latency makes a real-time sequence impractical; **do not label pre-recorded results as live**.

## 4. Full narration and screen directions

### 0:00–0:30 — Government productivity problem

**On screen:** Presenter on camera. Cut to a lengthy public NOFO or a simple visual showing one applicant multiplied across hundreds of applications. Do not imply application volume is uniform across every program.

**Narration:**

> Federal grants help state and local governments deliver critical infrastructure. But before applying, staff must interpret complex funding requirements and determine how they apply to their specific projects.
>
> That can consume an entire workday. Now multiply the effort across hundreds of applicants working toward the same deadline.
>
> Federal administrators face the other side of that complexity: concentrated application volumes, clarification requests, and potentially avoidable rework.
>
> What if we could reduce that burden on both sides?

**Presenter cue:** Show a simple transition from **one project assessment** to **a funding round**. No unsupported claim about the percentage of applications submitted in the last week.

### 0:30–1:00 — GovRail: the core innovation

**On screen:** The **GENERAL** GovRail architecture graphic, full screen. Animate/pan emphasis first on **LLM Reasoning**, then **Deterministic Code**, then **Evidence Grounding** and **Guided Interaction**. Do not replace the original diagram with a grant-specific variant.

**Narration:**

> We developed GovRail, an evidence-grounded AI guidance harness for complex, requirements-driven workflows.
>
> It combines the reasoning capabilities of large language models with the reliability of deterministic code.
>
> AI interprets language and context. Code applies explicit rules, validates facts, and controls the process. Evidence grounding links findings back to their sources, while guided questions help resolve what's missing.
>
> The result is structured guidance that supports human decisions rather than replacing them.

**Presenter cue:** Say **“harness”**, not “autonomous agent platform.” No MCP-server or tool-calling claim is necessary for the current web workflow.

### 1:00–1:25 — GrantFlow: the working proof of concept

**On screen:** Switch to the **GOVRAIL + GRANTFLOW** architecture graphic. Highlight the two application workflows (**Find Grants**, **Assess a Project**). Transition to actual GrantFlow homepage.

**Narration:**

> To demonstrate GovRail, we built GrantFlow AI—a working proof of concept for federal grant discovery and assessment.
>
> It applies this hybrid architecture across two workflows. First, it helps identify potentially relevant opportunities from the government's actual project. Then, more importantly, it guides applicants through assessing that project against a funding notice's requirements.
>
> Here's how it works.

**Presenter cue:** The graphic must clearly convey **GovRail = underlying approach**, **GrantFlow = demonstrated application**. Do not claim independent SDK-level reusability.

### 1:25–1:50 — Project-first grant discovery

**On screen:** Actual GrantFlow **Find Grants** screen. Use a fictional but realistic transportation project. Enter prewritten text or use a carefully captured authentic run. Show a clarification and a resulting shortlist if available.

**Narration:**

> GrantFlow starts with the transportation project, not a grant program or set of keywords.
>
> The language model helps interpret the description and clarify the relevant project facts. Deterministic ranking code then evaluates candidate opportunities and explains their potential relevance.
>
> But discovery is just the entry point. The real challenge is understanding what a specific funding notice means for the project.

**Presenter cue:** Discovery results are **possible matches**, not eligibility guarantees. Prioritize speed and clarity; don't spend 30 seconds waiting for a search.

### 1:50–3:15 — Project-specific NOFO assessment (the key demo)

**On screen:** Actual GrantFlow **Assess a Project** tab with an **already prepared official funding notice**. Show source-package coverage or preparation status briefly. Enter the same fictional project's details.

**Narration:**

> This is where the GovRail approach becomes especially valuable.
>
> A federal funding notice may contain dozens of pages of requirements, restrictions, and supporting instructions. GrantFlow processes available official documents into structured requirements that can be evaluated against a particular project.
>
> I'll describe the project and answer a targeted question about the applicant, funding request, or readiness.

**[Action: Display an actual follow-up question. Provide a truthful fictional-project answer.]**

> Notice that GrantFlow distinguishes conditions that appear supported, potential conflicts, preparation gaps, and information that is still unknown.

**[Action: Show a real **deterministic** finding, ideally a monetary threshold or cost-sharing rule.]**

> For explicit conditions, such as a funding limit or matching requirement, deterministic code checks the facts against the stated rule. There's no reason to ask a language model to guess whether a number meets a threshold.

**[Action: Show a real **LLM-interpreted** finding, if the prepared case supports one.]**

> Other requirements depend on nuanced language and project context. That's where constrained LLM interpretation helps—while the application still controls the permissible findings and preserves uncertainty.

**[Action: Open the official source quotation / document page for a real finding.]**

> Each finding links back to the official source, so users can inspect the evidence. And when information is missing, GrantFlow asks targeted follow-up questions instead of inventing a confident answer.
>
> That's GovRail in practice: reasoning, deterministic checks, evidence, and guidance working together—with the applicant in control.

**Presenter cues and guardrails:**

- Select **one specific prepared NOFO** that succeeds in the app. If using the NHTSA Innovative Traffic Safety Enforcement notice, verify the **actual NOFO and all relevant Q&A attachments were ingested**; do not narrate Q&A-based restrictions not in GrantFlow's source package.
- Demonstrate a deterministic funding rule and an interpretive requirement **only if both actually appear in the selected assessment**. Don't fabricate an AI-generated finding for the recording.
- Present model interpretation as **provisional**. Explain that `unknown` is not a rejection and a preparation gap is not automatically an eligibility conflict.
- The software evaluates structured requirements and previously provided facts. It **does not certify eligibility**, submit applications, or review federal submissions on behalf of a federal agency.
- Source completeness is limited to available/curated documents; if coverage is partial, show it or choose a better-prepared demo opportunity.

### 3:15–3:45 — Productivity and funding-cycle scale

**On screen:** A clean impact slide using **big numerals** and a conspicuous label: **“Illustrative model — not measured results.”** Display **6–10 hours → 2–3 hours**, **approximately 70% less active assessment effort**, **300 applications**, **50% scenario adoption**, and **~800 applicant staff hours potentially freed**. Mention potential federal impact verbally, not as proven savings.

**Narration:**

> Our preliminary workflow model estimates six to ten hours for a manual assessment, compared with a projected two to three hours using GrantFlow—approximately seventy percent less active effort.
>
> In a funding round receiving three hundred applications, if half the applicants use GrantFlow, that translates to roughly eight hundred applicant staff hours potentially freed within one funding cycle.
>
> Better-prepared applicants could also reduce clarification requests and avoidable rework during the federal review period. These estimates are modeled, not yet measured.

**Presenter cues:**

- **Math:** midpoint manual = 8 hours; assisted = 2.5 hours; difference = 5.5 hours; percentage = 68.75%, rounded to **~70%**; 300 × 50% × 5.5 = **825**, rounded to **~800 hours**.
- **The federal-side 15-hour scenario** may be included in speaker notes or a secondary expandable view, but don't portray it as an observed outcome: 150 assisted applicants × 40% assumed exchange incidence × 25% avoided × 1 hour = 15 hours, under simplifying assumptions.
- The **300-application round** is a reasonable illustrative scenario informed by historic DOT volumes, not an average across all grants. SMART FY 2024 received 308 applications; RAISE FY 2024 received 1,048 eligible applications (verify original authoritative sources before publishing as cited facts).
- Staff hours freed indicate **potential capacity value**, not automatically cash budget savings. Exclude unmeasured prep/verification overhead from achieved claims; explicitly say the estimates require validation.

### 3:45–4:00 — Closing

**On screen:** Return to presenter on camera, with GovRail + GrantFlow AI logos. Fade to concise final tagline.

**Narration:**

> GovRail is our innovation. GrantFlow is the working proof of concept.
>
> Together, they show how evidence-grounded AI guidance can reduce administrative complexity at scale, improve government productivity, and give people more time to deliver on their mission.

**Final on-screen line:** **“GovRail: grounded reasoning. GrantFlow: government productivity in action.”**

## 5. Interactive presentation behavior

Implement an interactive experience for **presenter rehearsal, judge viewing, and video recording**. At minimum:

1. **Slide controls:** previous/next, progress indicator, keyboard navigation, and a discrete home/index link.
2. **Architecture emphasis:** Reveal.js fragments or CSS highlight states to spotlight the four GovRail capabilities while keeping the original images readable. Use overlays, not edited or invented claims.
3. **App transition:** clear **Open GrantFlow** control with a return-to-presentation path; if desired, also add a modal providing links to the real discovery and assessment tabs.
4. **Presenter notes:** narration, timestamps, transition cues, and disclaimers for each section. Presenter-only UI must not leak into audience/recording mode.
5. **Productivity interaction:** an optional **scenario calculator** (applications, adoption percentage, hours saved per assessment) using transparent deterministic JavaScript and a clearly visible “Illustrative model” label. Defaults: 300 applications, 50% adoption, 5.5 hours saved. Do not suggest the calculator measures usage or achieved savings.
6. **Safe fallback:** the presentation should function offline with stored visual assets; the **live demo** may need Anthropic and Simpler.Grants.gov credentials/network access. If live APIs are unavailable, show a clearly labeled **authentic pre-recorded walkthrough or previously captured real output**, never fake an operational result.
7. **Accessibility:** alt text, keyboard focus, visible buttons, readable text (including recording at 1080p), responsive slide sizing, and reduced-motion support.
8. **Branding:** use the existing GovRail and GrantFlow logos already present in `public/img/logos/`. Keep visual style consistent with the current app; don't redesign the core application.

## 6. Implementation sequence for Claude Code

1. **Inspect** `public/index.html`, `public/chat.html`, `public/css/`, `public/js/`, `src/web/api-server.ts`, `package.json`, and the current docs to determine exact URL conventions and styles. Preserve existing behavior.
2. Add Reveal.js as a **pinned**, locally served dependency with deterministic installation. Do not add a second major app framework.
3. Create a single `public/big-build.html` with 7 major presentation sections, using Reveal.js fragments where helpful.
4. Add the architecture graphics from the supplied assets at the two expected paths. Check for their existence and report missing files instead of substituting stock imagery.
5. Implement speaker notes and a recording mode. Show timestamps or cues only to the presenter.
6. Add direct handoff links into existing GrantFlow workflows. Verify all deep links against the current app's route handling.
7. Build the optional scenario model from constants/input controls; use integer presentation rounding without changing its underlying math.
8. Make the real demo **preparation checklist** available as a presenter-only slide/notes: prepared NOFO, real citations verified, fictional project script, deterministic and interpretive examples, source coverage, and backup recording.
9. Validate in a browser at 1920×1080 and a laptop resolution; check slide overflow, focus order, working links, speaker notes, timing, and reduced motion.
10. Run available application tests/build, fix presentation-specific problems, and report preexisting unrelated failures separately.

## 7. Acceptance criteria

- `GET /big-build.html` opens a polished, fully navigable presentation **within the current web app**.
- Both architecture graphics are present in the required order: **general GovRail**, then **GovRail + GrantFlow**.
- No false claims of MCP tool calling, autonomous agent execution, independent GovRail SDK status, automatic eligibility decisions, production readiness, or measured savings.
- The recorded script fits within **2–5 minutes** with talking-head material, actual app walkthrough, and an impact statement.
- The assessment demo shows at least **one real source-backed finding**, with a working source link, and correctly distinguishes unknowns/gaps/conflicts. A rule-based vs model-assisted contrast is included only when the chosen actual case supports it.
- All productivity estimates are displayed as **illustrative projections**. The default scale example matches the ConOps: **300 applications**, **50% adoption**, **~800 potentially freed applicant hours**; federal benefit remains conditional.
- No CUI, secrets, live API keys, genuine client records, or misleading mock outputs appear in the demo.
- No regression to the existing Find Grants or Assess a Project pages.

## 8. Source documents / project alignment

Check the in-repository documents while implementing:

- `docs/GovRail_GrantFlow_Big_Build_ConOps.md` — current competition message and modeled benefits.
- `docs/GovRail_GrantFlow_Presentation_Demo_Guide.md` — presenter prep, prior timing guidance, and claims discipline.
- `docs/NOFO_DEMO.md` — an existing, tested example of the assessment UI and known limitations.
- `src/nofo/discovery/rank.ts` — code-driven ranking.
- `src/nofo/assessment/assess.ts`, `checks.ts`, `interpret.ts`, `questions.ts` — deterministic evaluation, constrained model interpretation, and source-related questioning.
- `src/nofo/advisory.ts` — deterministic construction of the preliminary advisory.
- `src/nofo/ingest/coverage.ts` — source-package completeness limitations.

**Do not use the older SAM.gov or MCP functionality as the demo's main story.** The modern `nofo` browser flows use Express endpoints, Simpler.Grants.gov, Anthropic models, and deterministic TypeScript services. GovRail is best demonstrated through **code-controlled orchestration and evidence-grounded guidance**, not by claiming an autonomous tool-calling agent.

---

**Requested deliverable from Claude Code:** Implement the presentation in-repository, provide a URL and instructions for presenter mode and recording mode, list any missing image assets or demo fixtures, and summarize tests and verified behavior. Do **not** invent running assessment output or claim a recording has been produced unless it has actually been captured.
