# Big Build presentation: how to run and record it

A presenter-controlled Reveal.js deck inside the GrantFlow web app. It explains the general **GovRail** architecture, shows **GrantFlow** as the working proof of concept, hands off to the real *Find grants* and *Assess a project* screens, and closes with clearly labelled **modeled** productivity figures. The brief it implements is `docs/presentation-instructions/GOVRAIL_BIG_BUILD_INTERACTIVE_DEMO.md`.

It is a presentation shell, not a replacement for GrantFlow. No existing page was changed.

## URLs

Start the app (`npm run build && WEB_PORT=3000 npm run start:web`), then:

| View | URL | What it is |
|---|---|---|
| Audience | `http://localhost:3000/big-build.html` | Clean slides, on-screen back/next buttons, progress bar, slide numbers, a "GrantFlow home" link. |
| Presenter | `http://localhost:3000/big-build.html?mode=presenter` | Adds the **preparation checklist** slide and a **timing badge** on each slide. Press **S** for the speaker view (narration, timestamps, cues, guardrails). |
| Record | `http://localhost:3000/big-build.html?mode=record` | For screen capture: no controls, progress bar, slide numbers or home link, no transitions, no speaker view, no presenter slide. **The disclaimers stay visible.** |

Jump to a slide with a hash: `#/problem`, `#/govrail`, `#/grantflow`, `#/find-grants`, `#/assess`, `#/impact`, `#/closing`.

Keys: arrow keys, space, Page Up/Down, **F** full screen, **Esc** overview. The calculator's number boxes keep their own keys.

## Slides and timing (about 4 minutes)

| # | Slide | Time | Notes |
|---|---|---|---|
| 1 | Government problem | 0:00-0:30 | Talking head first, then this slide. Fragments: one project, a funding round, the federal side, the question. |
| 2 | GovRail (general architecture) | 0:30-1:00 | Four spotlight fragments: LLM reasoning, deterministic code, evidence grounding, guided interaction. |
| 3 | GrantFlow (GovRail + GrantFlow architecture) | 1:00-1:25 | Spotlights Find Grants, then Assess a Project. |
| 4 | Project-first discovery | 1:25-1:50 | **Open GrantFlow: Find grants** opens `/chat.html` in a new tab. |
| 5 | Requirements assessment | 1:50-3:15 | **Launch Live GrantFlow** opens `/chat.html?mode=nofo&opportunity=4d8f5775-ff01-4a6f-ab4e-b125899043b3` (FY2026 BUILD) in a new tab. The centerpiece. |
| 6 | Impact at scale | 3:15-3:45 | Big numerals, an always-visible "Illustrative model, not measured results" banner, and a scenario calculator. |
| 7 | Closing | 3:45-4:00 | Talking head over this slide, then the tagline. |

The full narration is in each slide's speaker notes (it is the brief's section 4 script).

**Handoff to the app and back:** the app opens in a new tab so this tab keeps its place. Close or switch back to the presentation tab to continue.

## The scenario calculator

Inputs: applications in the round, adoption %, hours saved per assessment. Defaults are 300, 50% and 5.5 h. The arithmetic is in `public/js/big-build-model.js` and has no hidden steps:

- Per assessment: midpoint manual 8 h vs. projected 2.5 h = 5.5 h saved = 68.75%, shown as **~70%**.
- One round: 300 x 50% = 150 assisted assessments; 150 x 5.5 h = **825 h**, shown as **~800 h**.
- Rounding is display-only; the exact number is shown in the calculator line.
- Federal side (hypothesis only, in the collapsed "Assumptions and arithmetic" panel and the notes): 150 x 40% x 25% x 1 h = 15 h under simplifying assumptions.

It models a scenario. It does not measure usage or achieved savings, and the slide says so.

## Before you record: live demo preparation

Also available as the presenter-only checklist slide. In short:

1. The FY2026 BUILD package is prepared on the recording machine (`data/opportunities/<uuid>/` with extracted requirements), and its coverage line is shown. BUILD is archived: present it as a **historical demonstration, not open funding**.
2. `ANTHROPIC_API_KEY` is set (assessment turns need it; a first turn takes roughly 20-30 s). Find grants also needs `SIMPLER_GRANTS_API_KEY`.
3. A fictional project script is ready (the Virginia DOT samples in `docs/NOFO_TEST_PROJECTS.md` and `docs/NOFO_DEMO.md`). No real client data or CUI.
4. A real follow-up question, a real deterministic finding (funding limit or cost share) and one real source link are verified in a rehearsal. Show an interpreted finding only if the real assessment contains one.
5. A backup exists: an authentic recording or captured real output, **labelled as recorded**, for use if a live call fails. Never present a recording as live.
6. The Dev tray is off and no keys or personal data are on screen.

## What is not included

- **No video has been recorded** and no screen capture of Find grants or Assess a project has been added to the deck. Slide 4 notes where one would go; nothing is faked.
- The brief's NHTSA enforcement example is not used: that notice is not in `data/opportunities/`. FY2026 BUILD was chosen instead.
- The 308 / 1,048 historical application counts (SMART, RAISE) appear only in speaker notes, marked "verify before citing".
- GovRail's other example workflows (regulatory compliance, procurement review, program eligibility) are in the supplied diagram as potential uses and are described that way.

## Files

- `public/big-build.html`, `public/css/big-build.css`, `public/js/big-build.js`, `public/js/big-build-model.js`
- `public/img/big-build/govrail-architecture-general.png`, `govrail-grantflow-architecture.png`: copies of the supplied graphics in `docs/presentation-instructions/`, unedited. The spotlight boxes are CSS overlays positioned by percentage.
- `public/vendor/reveal/`: Reveal.js, copied from `node_modules` by `npm run presentation:vendor` (needs the pinned `reveal.js` dependency) and committed so no CDN or `node_modules` is needed to present.
- `scripts/copy-reveal.mjs`, `src/web/big-build.test.ts`
