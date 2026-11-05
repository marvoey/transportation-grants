# Test project descriptions for "Find grants"

Twelve realistic, **fictional** project descriptions (six detailed, six short and vague) for trying the Find grants tab in `chat.html`
(`npm run start:web`, then open `/chat.html`). Paste one into the box. They vary the project type,
the applicant, the money and how far along the project is. Every place, number and fact is invented.

Tips:

- Most of these need **Include closed and archived** ticked. Only about a dozen U.S. DOT
  opportunities are open at any time, so open-only searches often have nothing relevant. Try each
  one both ways.
- The CLI runs the same code: `npm run nofo:find -- "<description>" [--historical]`.
- Searching is limited to 10 requests a minute by default.
- Results change as listings open and close. The notes below are what I saw on **2026-11-05**
  against the live Simpler.Grants.gov data, not a promise.

---

## 1. State DOT bridge replacement (the demo case)

> We are the Virginia Department of Transportation and we want to replace a structurally deficient two-lane bridge carrying a rural state route over a river in the southwest part of the state. The bridge was built in 1958 and is posted for reduced loads, which forces school buses and farm trucks onto a long detour. Total project cost is about $40 million and we would request $25 million in federal funds. Preliminary engineering and environmental review are complete and the state has committed the remaining match.

Tests: a state applicant, a clear project type, total cost kept apart from the federal request,
construction-ready.

Seen on 2026-11-05:

- **Open only:** nothing relevant. No open U.S. DOT listing is for bridges. The two results shown
  were weak (a drone-inspection program and a crash-data program).
- **With closed and archived:** the Competitive Highway Bridge Program, the Type 3 Highway Bridge
  program, a PROTECT program, FY 2026 National Infrastructure Investments (BUILD) and a rail-bridge
  restoration. BUILD can then be assessed against this project.

## 2. County wildlife overpass

> Our county public works department in southwestern Montana wants to build a wildlife overpass and about four miles of wildlife fencing along a two-lane highway where elk and mule deer are regularly hit by vehicles. The corridor is rural and connects two large blocks of national forest. We estimate the total project cost at $14 million and expect to request about $11 million in federal funds. We have a completed corridor study and a letter of support from the state wildlife agency, but design has not started.

Tests: a county applicant, two project types (wildlife and roadway), an early stage, a short
deadline.

Seen on 2026-11-05:

- **Open only:** the FY 2026 Wildlife Crossings Pilot Program comes first (the listing closes
  2026-11-16, so the tool flags a short deadline). The rest were weak matches. This program is
  already prepared in the local data, so its card has the **Assess my project** button.
- **With closed and archived:** the same program first, then unrelated bridge, maritime and
  resilience programs.

## 3. City bike and pedestrian network

> The City of Greenville wants to build a connected network of protected bike lanes and widened sidewalks linking downtown, the hospital district, and two low-income neighborhoods that currently have no safe walking or biking route. The project is about 6 miles in an urban area. Total cost is estimated at $18 million and we plan to request $12 million in federal funds. We have a completed bike and pedestrian master plan and are starting 30 percent design.

Tests: a city applicant, a project type that general infrastructure programs also fund.

Seen on 2026-11-05:

- **Open only:** no matching program. The two "closest" results were not relevant.
- **With closed and archived:** mostly information-center, education and enforcement programs, not
  capital construction. This is a case where the shortlist is weak, which makes it a good one for
  judging how honest the match labels and watch-outs are.

## 4. Regional transit authority, electric buses

> We are a regional transit authority serving three counties and we want to replace 24 aging diesel buses with battery-electric buses and build a charging depot at our maintenance facility. The total project cost is about $32 million and we would request $22 million in federal funds. Our board has approved the fleet plan and committed local match from a dedicated sales tax, but the depot design is not complete.

Tests: a special-district applicant (a transit authority), a vehicle purchase rather than
construction.

Seen on 2026-11-05:

- **Open only:** nothing relevant.
- **With closed and archived:** poor matches (a transit-oriented-development planning program, an
  advanced technology program, a transit-in-parks program, and an unrelated pipeline-safety one).
  No transit capital programs appeared at all, which suggests they are not in the DOT listings
  this search covers. I have not checked why.

## 5. County road-over-railroad overpass

> Our county wants to build a grade separation, an overpass, where a busy county road crosses a main freight railroad line. The crossing is blocked by long trains for hours each day, which delays ambulances and school buses, and there have been three crashes in the last five years. The project is in a small city and its rural surroundings. Estimated total cost is $55 million and we would request $25 million in federal funds. The railroad has agreed in principle to the project and environmental review is under way.

Tests: three project types at once (rail, bridge, safety), a large project with a smaller federal
request.

Seen on 2026-11-05:

- **Open only:** two Amtrak cooperative agreements came up. They match "rail" but a county cannot
  apply for them, and the tool flags that the listed applicant types are only "other".
- **With closed and archived:** the Railroad Crossing Elimination program, the consolidated rail
  infrastructure and safety program, and the Northeast Corridor partnership program. That run
  listed three editions of the Railroad Crossing Elimination program as separate entries. I
  fixed the edition-folding after that run and have **not re-run this one**, so check that those
  editions now appear as one entry.

## 6. Tribal government road safety

> Our tribe has about 40 miles of roads on the reservation that are in poor condition, with no guardrails, faded striping and several dangerous curves. Several people have been seriously hurt in crashes. We do not have an engineer on staff and have not done any planning or studies. We need money to figure out what to fix first and then to fix it.

Tests: a tribal applicant, plain everyday wording with no program names and no dollar figures,
planning rather than construction.

Seen on 2026-11-05:

- **Open only:** weak matches only.
- **With closed and archived:** includes the 2026 Tribal Transportation Program Safety Fund, which
  is a good match, plus training and pollinator programs that are not. The tool should offer
  optional questions about the amount and the project stage, because neither was given.

---

## Short, vague descriptions

Real applicants often type one or two plain sentences. These are for checking how the tool behaves
when there is little to go on: does it still find a sensible list, and does it ask only what it
needs? They have **not been run yet**, so the notes below say what each one is meant to test, not
what it returns.

## 7. Short: main street in bad shape

> We're a small town and our main street is falling apart. We need help paying to fix it.

Tests: a city applicant implied but not named, a roadway project, no amounts, no stage.

## 8. Short: old county bridge

> Our county has an old bridge that needs to be replaced and we can't afford it on our own.

Tests: a county applicant, a bridge project, nothing else. Compare with the full bridge description
above: the list should be similar, with more optional questions.

## 9. Short: bike lanes near schools

> We want to add bike lanes and sidewalks around our schools so kids can get there safely.

Tests: an applicant that is not stated, bike and pedestrian plus safety wording.

## 10. Short: new buses

> Our transit agency needs to replace some old buses. Is there any funding for that?

Tests: a transit applicant, a vehicle purchase, phrased as a question.

## 11. Short: dangerous intersections

> There are a few intersections in our city where people keep getting hurt. We want to do something about it.

Tests: a safety project with no mode, no amounts, no applicant type beyond "city".

## 12. Short: no project type at all

> We're a county government and we have a transportation project we'd like to get funded.

Tests: no project type, so the tool should ask what kind of project it is (and who the applicant is)
before searching. The list should still appear once you answer, or when you choose **Skip the
questions and search**.

---

## What to look for in any run

- **What I understood:** are the project type, applicant and amounts right, and is each one backed
  by words you actually wrote? Total cost and federal request must never be swapped.
- **Why it may fit and Watch out for:** is each line true to the listing? Closed and archived
  programs should always say they are not open for applications.
- **Weak matches:** a card marked "Weaker match" should never read as a recommendation. If the
  list looks like padding, note which description and what you expected.
- **Questions:** nothing is searched on the first message until the tool has asked about what is
  missing: project type first, then applicant, stage and the federal request, two at a time. It
  never asks one twice, asks nothing from the third message on, and **Skip the questions and
  search** always works. A description that already covers everything is searched at once.
- **Developer console:** it should show the profile, each search being built field by field (a
  draft, not sent, while questions are open), the exact request, and a summary of the response.
  The API key must never appear.
- **Handoff:** a card with **Assess my project against this** should open the Assess tab on that
  program. A card without it shows the two commands an operator runs to prepare that program.
