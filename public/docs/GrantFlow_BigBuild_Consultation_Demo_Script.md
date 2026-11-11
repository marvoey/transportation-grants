# GrantFlow AI — Big Build 3.0 Demo Video

**Theme:** From Search to Consultation  
**Target runtime:** 2:45 (must remain within 2–3 minutes)  
**Submission format:** MP4, talking-head introduction/closing plus recorded application walkthrough  
**Repository reviewed:** `marvoey/transportation-grants`, branch `nofo` (November 11, 2026)  
**Core innovation:** Start with the transportation project and guide the applicant toward potential funding opportunities and evidence-backed, project-specific requirements assessment, rather than expecting the applicant to navigate programs and search filters first.

## 0:00–0:30 — The problem: search makes the user do the work

**Visual:** On camera. Show a simple illustration of many search filters/program listings, then return to presenter.

**Narration:**

> When you visit a doctor, you don't begin by searching a database of treatments. You describe your situation, answer a few questions, and get guidance about what to do next.
>
> But government employees often do the opposite: guess keywords, adjust filters, sift through results, and interpret lengthy funding notices before finding what fits their project.
>
> We asked: what if finding funding worked more like a consultation than a search engine?

## 0:30–0:42 — Introducing GrantFlow

**Visual:** GrantFlow homepage, then select **Find grants**.

**Narration:**

> Meet GrantFlow AI. Instead of starting with a grant program, we start with what the agency wants to accomplish: its transportation project.

## 0:42–1:18 — Guided discovery

**Visual:** Real **Find grants** screen. Enter a prepared fictional transportation project. Show a real clarifying question, an answer, then a real shortlist with an explanation and caution. Prefer a genuine captured run to waiting for an API response.

**Narration:**

> I'll describe a fictional transportation improvement project in plain language.
>
> GrantFlow identifies project facts and asks focused questions about the applicant, project readiness, or funding needs.
>
> It searches funding opportunities and presents possible matches with explanations and cautions.
>
> No program expertise or maze of filters required.

## 1:18–2:05 — From discovery to an informed assessment

**Visual:** Select **Assess a project** for a prepared notice; use the app's genuine handoff if it is ready. Show a real assessment, a requirement-driven follow-up question, an updated finding after providing a fact, and **View source**. For the existing FY2026 BUILD example, label the notice **Archived / historical demonstration**. Do not claim it is currently open.

**Narration:**

> Finding a possible grant is only the first step. What does its notice mean for this project?
>
> GrantFlow assesses the project against documented funding requirements.
>
> It separates what appears supported from possible conflicts, preparation gaps, and information still unknown.
>
> When facts are missing, it asks requirement-linked questions and updates findings as we answer.
>
> We can open the source behind each finding.
>
> GrantFlow prepares better-informed decisions; it does not make official eligibility or award determinations.

## 2:05–2:35 — Mission impact and value

**Visual:** Simple impact graphic. Persistent label: **Illustrative model — not measured results**.

**Narration:**

> Our preliminary model estimates six to ten hours for a manual assessment, versus two to three using GrantFlow—roughly seventy percent less active effort.
>
> In a hypothetical round of three hundred applications, with half the applicants adopting it, that represents roughly eight hundred applicant staff hours potentially freed. Better-prepared applicants could also mean less federal clarification and rework.
>
> These are scenarios we would validate in a pilot, not measured savings.

## 2:35–2:50 — Future state and closing

**Visual:** Talking head with GrantFlow branding and a simple closing statement: **Start with the project. Not the program.**

**Narration:**

> GrantFlow demonstrates a bigger shift: government services that start by understanding the mission need, then guide people through applicable programs and requirements.
>
> Start with the project. Not the program.

---

## Production directions for Claude / editor

1. **Retire the GovRail-centered narrative.** Do not show the general or GrantFlow-specific GovRail architecture slides in the 2–3 minute submission video. GovRail may remain named in technical documentation, but it is not the headline or innovation claim.
2. **Use the existing Reveal.js presentation infrastructure** (`public/big-build.html`, `public/css/big-build.css`, `public/js/big-build.js`) if updating the interactive deck. Make a short GrantFlow-first variant; do not replace or break working applicant-facing pages.
3. **Make consultation visual and behavioral.** The centerpiece is a genuine loop: project description → targeted clarification → explained shortlist → selected notice → requirement-linked question → updated preliminary finding → source passage.
4. **Authenticity:** All application screens must be actual outputs of the running MVP or clearly labeled recordings of actual runs. Never fabricate an application finding, claim a response is live when prerecorded, or use any client data, CUI, API keys, or sensitive material.
5. **Demo preparation:** The FY2026 BUILD notice used in `docs/NOFO_DEMO.md` is archived. Label it historical. Confirm that the chosen opportunity is prepared, its source documents are available, and the selected sample project yields a real follow-up and source-backed finding before recording.
6. **Pacing:** Limit the consultation metaphor to the opening 30 seconds. Give most screen time to the project-first discovery and evidence-backed assessment. Edit out delays and use clean audio. Target 2:45–2:50, but rehearse with a timer and ensure the final MP4 is under 3:00.
7. **Value qualification:** The 70% and ~800-hour scenarios apply to *preliminary assessment*, not an experimentally measured end-to-end discovery time reduction. Show **Modeled, not measured** visibly throughout the impact slide.
8. **Judge-facing focus:** Problem → Solution → Mission impact → Future state. No deep explanation of LLMs, deterministic code, MCP, or technical plumbing unless asked later.

## Evidence in the current code

- `public/chat.html`: **Find grants** and **Assess a project** user experiences.
- `src/nofo/discovery/service.ts`: project information, targeted discovery questions, and opportunity searching.
- `src/nofo/discovery/rank.ts`: deterministic rankings with reasons and cautions.
- `public/js/discover.js`: opportunity preparation and handoff into assessment.
- `src/nofo/service.ts`, `src/nofo/assessment/assess.ts`, `src/nofo/assessment/questions.ts`: project-specific reassessment, findings, and requirement-linked follow-up questions.
- `src/nofo/citations.ts`, `public/js/nofo.js`: source verification and source-view interaction.
- `docs/NOFO_DEMO.md`: historical FY2026 BUILD example and recording preparation.

**Submission checklist:** MP4, 2–3 min, talking head, no CUI, sanitized public/dummy data. Submit with the team’s ConOps and required HackX/team forms by **November 13, 2026, 11:59 PM ET**. The uploaded submission guide is the source for these requirements.
