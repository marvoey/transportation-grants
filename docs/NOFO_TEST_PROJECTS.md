# Test project descriptions for "Find grants" and "Assess a project"

Twenty-six **fictitious** project descriptions. The first sixteen are realistic: ten detailed ones, **two for each of the five open U.S. DOT listings whose notice documents are downloaded and extracted** in `data/opportunities/`, and six short, vague ones. The last ten (17 to 26) are stress tests built to fill the findings list; see the section after the short ones. Paste one into the Find grants box, or copy it from the **Samples** tab on the right edge of the page. Every place, number and fact is invented. The program facts they rely on (who can apply, what is funded, the money, the rules) are in `docs/NOFO_FACT_SHEETS.md`, with page numbers.

For each program there are two projects that **would apply**: one is missing **one** thing a real applicant could still fix, and one is missing **two**. The gaps are preparation gaps, not eligibility conflicts, so Assess should report them as missing or unknown and not as a reason the project cannot apply. Everything else in each description is meant to line up with the notice, so Assess has real things to confirm.

| # | Program | Applicant | Gaps |
|---|---|---|---|
| 1 | FY2026 Wildlife Crossings Pilot Program | county underpasses | 1 |
| 2 | FY2026 Wildlife Crossings Pilot Program | regional authority overpass | 2 |
| 3 | FY 2027 Crash Causal Factors Program | Ohio highway patrol | 1 |
| 4 | FY 2027 Crash Causal Factors Program | Missouri highway patrol | 2 |
| 5 | State Process for Informing Consumers of Recalls Program | Washington motor vehicle agency | 1 |
| 6 | State Process for Informing Consumers of Recalls Program | New Mexico motor vehicle division | 2 |
| 7 | Innovative Traffic Safety Enforcement (ITSE) Grant Program | city police speed enforcement | 1 |
| 8 | Innovative Traffic Safety Enforcement (ITSE) Grant Program | county sheriff distracted driving | 2 |
| 9 | FAA Aviation Research Grants Program | university composites | 1 |
| 10 | FAA Aviation Research Grants Program | nonprofit weather decisions | 2 |

Tips:

- **Leave "Include closed and archived" unticked.** These are about open listings. Find grants lists every open U.S. DOT opportunity (about a dozen), best fit first, with listings that have no notice document last.
- The CLI runs the same code: `npm run nofo:find -- "<description>"`.
- Searching is limited to 10 requests a minute by default.
- Results change as listings open and close. The Wildlife Crossings Pilot Program closes **2026-11-16** and the Recalls and ITSE programs have questions and application dates in the next few months (see the fact sheets). The notes below are what I saw on **2026-11-11** against the live Simpler.Grants.gov data, not a promise.
- Model reading varies a little between runs (for example which search words it picks), so a ranking can move by a place. Each description was run once, and the Washington and short Recalls ones several times.
- Award sizes: the Simpler.Grants.gov listing can show the notice's total pool as an award range. The descriptions use the per-award ranges the notices state (Recalls $300,000 to $500,000, ITSE $500,000 to $2 million).

---

## 1. Wildlife Crossings: county underpasses (1 gap)

> Our county road and bridge department in northwestern Wyoming wants to build two wildlife underpasses with about three miles of wildlife fencing on a state highway where mule deer and pronghorn are hit by vehicles every migration season. We have ten years of crash and carcass data and a letter of support from the state wildlife agency. The total project cost is $12.5 million and we would request $10 million in federal funds, with the county and state wildlife funds covering the other $2.5 million. We consulted the state highway department and have its letter, but it has not yet agreed to administer the grant. Design is 30 percent complete.

Program: **FY2026 Wildlife Crossings Pilot Program**. A rural county, a 20 percent match that exactly meets the minimum, consultation with the state highway department documented. One gap: the State DOT has not agreed to administer the grant.

Seen on 2026-11-11 (open listings only): The Wildlife Crossings program first, a likely match. It read a county applicant, a $10 million federal request and a $12.5 million total cost. The listing closes **2026-11-16**, so the tool flags a short deadline.

What Assess should show (from the extracted requirements and `docs/NOFO_FACT_SHEETS.md`; I have not run Assess on this description): The non-federal share is $2.5 million of $12.5 million, exactly the 20 percent minimum, so the cost-share check should be supported, not a conflict. Consultation with the State highway agency is documented (a letter). The **State DOT has not agreed to administer the grant**, which should show as a preparation gap. The WCPP application template and SAM.gov registration are not mentioned, so they should show as unknown.

## 2. Wildlife Crossings: regional authority overpass (2 gaps)

> We are a regional transportation authority in northern Utah and we want to build a wildlife overpass and about eight miles of wildlife fencing along a four-lane highway that cuts through a deer and elk migration route, where collisions have caused serious injuries and several deaths over the past decade. The total project cost is $30 million and we would request $22 million in federal funds, with the rest from state and local funds that are already committed. The state highway department was consulted and has agreed to administer the grant, and design is 60 percent complete. We have not yet planned for cost overruns, and we have not identified who will pay to maintain the structure after it is built.

Program: **FY2026 Wildlife Crossings Pilot Program**. A regional transportation authority, a 27 percent match, the State DOT consulted and agreed to administer. Two gaps: no plan for cost overruns, and no maintenance funding.

Seen on 2026-11-11 (open listings only): The Wildlife Crossings program first. It read the regional transportation authority as a special district, with a $22 million request and a $30 million total cost.

What Assess should show (from the extracted requirements and `docs/NOFO_FACT_SHEETS.md`; I have not run Assess on this description): The non-federal share is $8 million of $30 million (27 percent), above the minimum. The State highway agency was consulted and agreed to administer. The two gaps are the **missing plan for cost overruns** and the **missing funding for long-term maintenance**, both parts of the readiness assessment for financial completeness.

## 3. Crash Causal Factors: Ohio highway patrol (1 gap)

> We are a state highway patrol in Ohio and we want to take part in the federal study of fatal crashes involving large trucks (Class 7 and 8). Our existing crash reconstruction unit has investigated fatal truck crashes for more than ten years, and all twelve of its troopers hold the North American Standard Part A and B inspection certification. We would request about $480,000 over the study period for overtime and data-collection equipment, with no matching funds. We have not yet gathered the historical overtime records we need to support our overtime estimate.

Program: **FY 2027 Crash Causal Factors Program**. A state highway patrol in a participating state, an existing reconstruction unit whose troopers are all certified, a request under the $500,000 ceiling. One gap: the historical overtime records are not yet gathered.

Seen on 2026-11-11 (open listings only): The Crash Causal Factors program first. It read a state applicant and a $480,000 request.

What Assess should show (from the extracted requirements and `docs/NOFO_FACT_SHEETS.md`; I have not run Assess on this description): Ohio is a participating State; $480,000 is under the $500,000 ceiling; no match is required; all twelve troopers hold the inspection certification and the unit already exists, so none of those should be a problem. The gap is the **historical basis for the overtime estimate**.

## 4. Crash Causal Factors: Missouri highway patrol (2 gaps)

> We are a state highway patrol in Missouri and we want to join the federal study of fatal crashes involving large trucks. Our crash reconstruction team has handled fatal truck crashes for years, but only four of its twelve troopers hold the North American Standard Part A and B inspection certification, and we have not yet talked to the state agency that leads our commercial vehicle safety program about how our proposal fits the state plan. We would request about $390,000 over the study period for overtime and data-collection equipment, with no matching funds. Our overtime estimate is based on three years of records.

Program: **FY 2027 Crash Causal Factors Program**. A state highway patrol in a participating state, a request under the ceiling, an overtime estimate with a historical basis. Two gaps: only some troopers hold the inspection certification, and no coordination yet with the State lead agency.

Seen on 2026-11-11 (open listings only): The Crash Causal Factors program first. It read a state applicant and a $390,000 request.

What Assess should show (from the extracted requirements and `docs/NOFO_FACT_SHEETS.md`; I have not run Assess on this description): Missouri is a participating State; $390,000 is under the ceiling; no match; the overtime estimate has a three-year basis. The two gaps are that **only four of twelve troopers hold the inspection certification** (the notice requires every funded investigation to include inspections by certified officers) and **no coordination yet with the State lead agency**.

## 5. Recalls: Washington motor vehicle agency (1 gap)

> We are a state motor vehicle agency in Washington and we want to build a notification process for open safety recalls at vehicle registration. When an owner registers or renews, we would check the vehicle against recall data, tell the owner right then online or at the counter, and later analyze how many recalls get fixed. We would request about $450,000 over the 33-month project, with no matching funds. We have the staff and registration system to run it, a project manager named, a draft of the notification language and a plan to measure completed recalls, but we have not yet chosen the vendor that will supply our recall data.

Program: **State Process for Informing Consumers of Recalls Program**. A state vehicle-registration agency, a request inside the $300,000 to $500,000 range, with a project manager, draft notification language and a measurement plan. One gap: the recall-data vendor is not chosen.

Seen on 2026-11-11 (open listings only): The Recalls program first, on two repeat runs. It read a state applicant and a $450,000 request. With the first draft ("checks each vehicle’s VIN against open safety recalls") it ranked third behind the drone-inspection and Crash Causal Factors programs, because the model chose "VIN" and "registration" as search words rather than the listing’s own "vehicle registration" and "notification". The text now says "notification process for open safety recalls at vehicle registration".

What Assess should show (from the extracted requirements and `docs/NOFO_FACT_SHEETS.md`; I have not run Assess on this description): A State agency that registers vehicles is eligible; $450,000 is inside the anticipated $300,000 to $500,000; 33 months matches the notice; there is a named project manager, draft notification language and a measurement plan. The gap is the **recall-data vendor**, which the project plan must name.

## 6. Recalls: New Mexico motor vehicle division (2 gaps)

> We are a state motor vehicle division in New Mexico and we want to notify owners of open safety recalls when they register or renew their vehicles, by checking each VIN against recall data and showing the notice online, by mail and at our field offices. We would request about $500,000 for the 33-month project, with no matching funds. We have a recall data source and draft notification language, and our registration system can store the recall status of each vehicle. We have not yet worked out how we will analyze whether the recalls actually get fixed, and we have not named a project manager or planned the staffing.

Program: **State Process for Informing Consumers of Recalls Program**. A state vehicle-registration agency, a request at the top of the anticipated range, a recall data source and draft notification language. Two gaps: no method for analyzing completed recalls, and no project manager or staffing plan.

Seen on 2026-11-11 (open listings only): The Recalls program first. It read a state applicant and a $500,000 request.

What Assess should show (from the extracted requirements and `docs/NOFO_FACT_SHEETS.md`; I have not run Assess on this description): $500,000 is the top of the anticipated range; a recall data source and draft notification language exist. The two gaps are the **missing method for analyzing completed recalls** (the notice requires one) and the **missing project manager and staffing plan**.

## 7. ITSE: city police speed enforcement (1 gap)

> Our city police department wants to run a new, innovative traffic safety enforcement program aimed at speeding and aggressive driving on our ten highest-crash corridors. We would use crash and speed data to decide where and when to patrol, adjust the patrols as crash patterns change, and test the approach so that other departments can repeat it. A state university has agreed to evaluate the results, and we have three years of crash data for the corridors. We would request about $1.8 million over three years and hope to apply in the March 2027 round. We have not yet registered in SAM.gov.

Program: **Innovative Traffic Safety Enforcement (ITSE) Grant Program**. A city police department, a named focus area (speeding and aggressive driving), a university evaluation partner, a request inside the anticipated range, for the March 2027 phase. One gap: no SAM.gov registration.

Seen on 2026-11-11 (open listings only): The ITSE program first. It read a city applicant and a $1.8 million request. ITSE is not tagged as a transportation program and its listing text does not mention speeding, so the description uses the program’s own words, "traffic safety enforcement".

What Assess should show (from the extracted requirements and `docs/NOFO_FACT_SHEETS.md`; I have not run Assess on this description): A city may apply; the focus areas (speeding and aggressive driving) are named; three years is inside the 60 months allowed; $1.8 million is inside the anticipated $500,000 to $2 million; no match is required; a university is lined up to evaluate. The gap is the **missing SAM.gov registration**. It is meant for the March 1, 2027 phase.

## 8. ITSE: county sheriff distracted driving (2 gaps)

> Our county sheriff’s office in rural Georgia wants to run an innovative traffic safety enforcement program to reduce distracted driving on county roads where several serious crashes have involved phones. We would pair patrols with a community awareness effort run with local schools and employers over four years, and we want other agencies to be able to copy it. We would request about $1.2 million. We have registered in SAM.gov, but we have not yet found a partner to evaluate the results or decided how we will collect the data, and we have not assembled baseline crash data.

Program: **Innovative Traffic Safety Enforcement (ITSE) Grant Program**. A rural county sheriff’s office, a named focus area (distracted driving), a four-year project, registered in SAM.gov. Two gaps: no evaluation partner or data-collection method, and no baseline crash data.

Seen on 2026-11-11 (open listings only): The ITSE program first. It read a county applicant and a $1.2 million request.

What Assess should show (from the extracted requirements and `docs/NOFO_FACT_SHEETS.md`; I have not run Assess on this description): A county sheriff may apply; distracted driving is a named focus area; four years is inside the 60 months allowed; $1.2 million is inside the range; SAM.gov registration is done. The two gaps are the **missing evaluation partner and data-collection method** (the notice requires a plan to evaluate effectiveness and allow replication) and the **missing baseline crash data**.

## 9. FAA research: university composites (1 gap)

> We are the aviation engineering department at a public university and we want to carry out a three-year research project on how composite materials in aircraft structures age and fail, to improve aircraft safety. We would request about $1.8 million over 36 months, mostly for faculty time, graduate researchers and testing, with about $300,000 for a fatigue testing machine, and we plan to share part of the cost. We have a negotiated indirect cost agreement, a draft project summary and biographical sketches for our key researchers. Our university’s SAM.gov registration is still being renewed.

Program: **FAA Aviation Research Grants Program**. A public university, aircraft structural safety research, 36 months, equipment as only part of the budget, an indirect cost agreement in place. One gap: SAM.gov registration is still being renewed.

Seen on 2026-11-11 (open listings only): The FAA Aviation Research Grants Program first, then the Joint Center of Excellence for Advanced Materials. It read the applicant as "other" (a university), the project types as aviation and safety, and a $1.8 million request.

What Assess should show (from the extracted requirements and `docs/NOFO_FACT_SHEETS.md`; I have not run Assess on this description): A university is an eligible applicant; 36 months is inside the 12 to 60 months allowed; the research is aircraft safety technology (structural safety and advanced materials); the equipment purchase is only part of the budget; cost sharing is offered but not required; the indirect cost agreement, summary and biographical sketches exist. The gap is the **SAM.gov registration still being renewed**.

## 10. FAA research: nonprofit weather decisions (2 gaps)

> We are a nonprofit 501(c)(3) research institute and we want to study how pilots make decisions in deteriorating weather, using flight simulator experiments, to improve aviation safety. We would request about $900,000 over 24 months, mostly for researcher salaries and simulator time. We are registered in SAM.gov and have our key personnel and a draft description of the work, but we do not yet have a negotiated indirect cost agreement, and we have not yet compiled our current and pending support.

Program: **FAA Aviation Research Grants Program**. A 501(c)(3) research institute, human factors and weather research, 24 months, registered in SAM.gov. Two gaps: no negotiated indirect cost agreement, and current and pending support not compiled.

Seen on 2026-11-11 (open listings only): The FAA Aviation Research Grants Program first. Because few listings matched, the search widened beyond DOT and returned 12 listings, with an EPA program second. It read the applicant as "other" and a $900,000 request.

What Assess should show (from the extracted requirements and `docs/NOFO_FACT_SHEETS.md`; I have not run Assess on this description): A 501(c)(3) research institute is an eligible applicant; 24 months is inside the range; human factors and weather research fit the program areas; SAM.gov registration is done. The two gaps are the **missing negotiated indirect cost agreement** and the **uncompiled current and pending support**.

---

## Short, vague descriptions

Real applicants often type one or two plain sentences. These six are for checking how the tool behaves when there is little to go on: does it still find a sensible list, and does it ask only what it needs? There is one for each program, written in everyday words, plus a generic one with no project type. The first five were run once on 2026-11-11 (the Recalls one three times) and the notes say what happened.

## 11. Short: deer on our highway

> Our county wants fencing and a wildlife crossing on a highway where deer keep getting hit.

Tests: a county applicant, a wildlife crossing in plain words, no program names, no amounts and no stage. Written for the Wildlife Crossings Pilot Program.

Seen on 2026-11-11 (open listings only): The Wildlife Crossings program first. It read a county applicant and the project type as wildlife crossing, and had no amounts or stage to read.

## 12. Short: big-truck crash study

> Our state patrol wants to join a federal study of fatal crashes involving big trucks. Is there funding for the extra work?

Tests: a state law enforcement applicant, phrased as a question. Written for the Crash Causal Factors Program.

Seen on 2026-11-11 (open listings only): The Crash Causal Factors program first. It read a state applicant and no amounts.

## 13. Short: recall notices at registration

> Our state motor vehicle agency wants to inform owners of open safety recalls at vehicle registration. Is there funding for a notification process?

Tests: a state vehicle-registration agency and a notification process, phrased as a question. Written for the Recalls program.

Seen on 2026-11-11 (open listings only): The Recalls program first on two repeat runs. This is the most sensitive of the short descriptions to wording: three earlier phrasings (for example "tell owners about open safety recalls when they register") ranked it second, third or fourth behind the drone-inspection and Crash Causal Factors programs, depending on which search words the model chose.

## 14. Short: speeding and drunk driving

> Our police department wants money to try a new traffic safety enforcement program to cut speeding and drunk driving.

Tests: a local law enforcement applicant (a police department) and an enforcement program, nothing else. Written for the ITSE Grant Program.

Seen on 2026-11-11 (open listings only): The ITSE program first. It read the applicant as "other" (a police department is not one of the applicant types the tool recognizes) and had no amounts. ITSE is not tagged as a transportation program, so "traffic safety enforcement" matters: without it the program ranked third.

## 15. Short: aviation research

> Our university wants funding for aviation safety research, like stronger materials for aircraft.

Tests: a university applicant, which this program accepts but a state or local transportation agency would not be. Written for the FAA Aviation Research Grants Program.

Seen on 2026-11-11 (open listings only): The FAA Aviation Research Grants Program first, then the Joint Center of Excellence for Advanced Materials. It read the applicant as "other" and the project types as aviation and safety.

## 16. Short: no project type at all

> We're a county government and we have a transportation project we'd like to get funded.

Tests: no project type, so the tool should ask what kind of project it is (and who the applicant is) before searching. The list should still appear once you answer, or when you choose **Skip the questions and search**. This one is deliberately not tied to a program.

Not run for this write-up; unchanged from the earlier set.

---

## Stress tests: projects built to maximize the findings

Ten more fictitious projects, two for each of the same five programs, written so the **Findings to look at first** list on the Assess tab fills up (it shows at most eight). The first ten and the short ones above are projects that would apply; these are not. Each one is an applicant or a project that runs into many rules in the notice, so Assess has many conflicts and review items to show. Use them to see the findings cards, not to check how Find grants ranks programs.

How the cards are chosen: only a possible conflict, a preparation gap or a needs-specialist-review item becomes a card. Supported and not-yet-evaluated items never do. Each problem is written as something the project **would include** ("buying overseas-made kiosks", "lobbying the legislature"), because the tool reads the facts out of those phrases; a passing remark such as "we got an award before" is usually dropped.

How these were run: on 2026-11-11 with the real Assess code and model, one description at a time, counting the cards the page would show. The Wildlife Crossings, Crash Causal Factors, Recalls and FAA descriptions were scored against the saved copies of those notices in `data/opportunities.back.2`; ITSE against the current extraction in `data/opportunities`. **The same text can give a different count on another run**, because the step that reads facts out of the description sometimes drops the list of project components (the Wildlife Crossings pair and the FAA individual are the least steady). The counts below are what I saw, not a promise.

## 17. Stress test: Wildlife Crossings, private ranch crossing

> We are a private ranching company in central Montana with a wildlife crossing project on a state highway that crosses our land, where elk and mule deer are hit by vehicles every migration season. The project would include building two underpasses with about three miles of fencing, starting construction next month before any award and being reimbursed later, counting money we already spent on a first underpass last spring as match, going ahead without consulting the state highway department, leaving out the project budget and schedule, submitting this same application twice, and mailing a paper copy after the deadline. The total project cost is $12.5 million and we would request $11.5 million in federal funds, and can contribute only $1 million ourselves.

Program: **FY2026 Wildlife Crossings Pilot Program**. A private ranching company (not a listed applicant type), an 8 percent match against the 20 percent minimum, work started before any award, earlier spending counted as match, no State highway department consultation, no budget or schedule, a duplicate application and a late paper copy.

Seen on 2026-11-11 (see the note above on how this was run): 2 to 4 cards across three runs.

## 18. Stress test: Wildlife Crossings, nonprofit foundation overpass

> We are a private conservation nonprofit foundation in northern Utah with a wildlife crossing project on a four-lane highway that cuts through a deer and elk migration route. The project would include building a wildlife overpass with about eight miles of fencing, starting construction before any award and being reimbursed later, counting money we spent last year as match, going ahead without consulting the state highway department, leaving out the project budget and schedule, and mailing a paper application after the deadline. The total project cost is $30 million and we would request all $30 million in federal funds, and can contribute $0 ourselves. We have no plan for cost overruns and nobody has agreed to pay for maintenance.

Program: **FY2026 Wildlife Crossings Pilot Program**. A private conservation nonprofit asking for 100 percent federal funding with no match, work started before any award, earlier spending counted as match, no State highway department consultation, no budget or schedule, a late paper copy, no cost-overrun plan and no maintenance funding.

Seen on 2026-11-11 (see the note above on how this was run): 2 cards in two runs.

## 19. Stress test: Crash Causal Factors, Colorado patrol

> We are the Colorado state highway patrol and we want to take part in the federal study of fatal crashes involving large trucks. The project would include creating a brand new crash reconstruction unit, since we have none today, buying ten new patrol vehicles, covering our routine operating expenses, investigating serious crashes involving pickup trucks and passenger cars, submitting five separate projects in one application, and filing a duplicate of an application we already submitted. We would request about $1.4 million, with no matching funds. We have no historical records to support our overtime estimate and our troopers hold no truck inspection certification.

Program: **FY 2027 Crash Causal Factors Program**. A state patrol in a State that is not in the study sample, a $1.4 million request over the $500,000 ceiling, a new reconstruction unit, patrol vehicles and routine expenses, passenger-car crashes, five projects in one application and a duplicate submission.

Seen on 2026-11-11 (see the note above on how this was run): 5 to 8 cards across three runs.

## 20. Stress test: Crash Causal Factors, for-profit company

> We are a for-profit trucking safety consulting company in Oregon and we want to join the federal study of fatal crashes involving large trucks. The project would include setting up our own crash investigation team, buying a vehicle fleet, covering routine operating expenses, investigating crashes involving passenger cars, submitting five separate projects in one application, and resubmitting an application we already submitted once before. We would request about $900,000 over the study period, with no matching funds. We have not talked to any state agency about it.

Program: **FY 2027 Crash Causal Factors Program**. A for-profit company in a State that is not in the study sample, a $900,000 request over the ceiling, its own new investigation team, a vehicle fleet, routine expenses, passenger-car crashes, five projects in one application and a resubmission.

Seen on 2026-11-11 (see the note above on how this was run): 8 cards in all three runs.

## 21. Stress test: Recalls, county tax collector

> We are a county tax collector's office in Florida and we want to build a notification process for open safety recalls at vehicle registration. We would request about $650,000 over the 33-month project, with no matching funds. The project would include lobbying the state legislature to require recall notices, buying overseas-made kiosks for our offices, paying a second vendor that uses covered telecommunications equipment, applying again after the award we already received under this program two years ago, and submitting two applications from our office. We have no project manager, no timeline and no recall data vendor.

Program: **State Process for Informing Consumers of Recalls Program**. A county office (not a State agency), a $650,000 request over the $500,000 top of the range, lobbying, overseas-made kiosks, a covered-technology vendor, a prior award under this program and two applications.

Seen on 2026-11-11 (see the note above on how this was run): 7 to 8 cards across three runs.

## 22. Stress test: Recalls, New Mexico division

> We are a state motor vehicle division in New Mexico and we want to notify owners of open safety recalls when they register or renew their vehicles. We would request about $180,000 for the 33-month project, with no matching funds. The project would include applying again as a state that already received an award under this recall program, buying our recall data from a company owned by our director's brother without disclosing that relationship, lobbying the legislature for recall notice funding, buying overseas-made kiosks, subcontracting to a vendor that uses covered telecommunications equipment, and leaving out a work breakdown and timeline.

Program: **State Process for Informing Consumers of Recalls Program**. A State agency (eligible), but a $180,000 request under the $300,000 low end, a prior award under this program, an undisclosed conflict of interest, lobbying, overseas-made kiosks, a covered-technology subcontractor and no work breakdown or timeline.

Seen on 2026-11-11 (see the note above on how this was run): 7 cards in all three runs.

## 23. Stress test: ITSE, city police

> Our city police department wants to run a new, innovative traffic safety enforcement program. We would request about $3.5 million for an 80-month project. The project would include general extra patrols with no specific focus area, buying foreign-made license plate reading cameras from a vendor that uses covered telecommunications equipment, lobbying the city council for a speed camera ordinance, filing two applications from our department in the same phase, and applying without an active SAM.gov registration. We have no plan to evaluate the results.

Program: **Innovative Traffic Safety Enforcement (ITSE) Grant Program**. A city police department, a $3.5 million request over the $2 million top and an 80-month project over the 60-month limit, no focus area, foreign-made cameras from a covered-technology vendor, lobbying, two applications and no SAM.gov registration.

Seen on 2026-11-11 (see the note above on how this was run): 8 cards in all three runs.

## 24. Stress test: ITSE, county sheriff

> Our county sheriff's office in rural Georgia wants to run an innovative traffic safety enforcement program to reduce distracted driving. We would request about $350,000. The project would include lobbying county commissioners for a distracted driving ordinance, buying imported patrol equipment, paying a subcontractor that uses covered telecommunications equipment, refusing to disclose a conflict of interest with our evaluator, filing two applications in the same phase, and applying without an active SAM.gov registration. We have no partner to evaluate the results and no baseline crash data.

Program: **Innovative Traffic Safety Enforcement (ITSE) Grant Program**. A county sheriff, a $350,000 request under the $500,000 low end, lobbying, imported equipment, a covered-technology subcontractor, an undisclosed conflict of interest, two applications, no SAM.gov registration, no evaluation partner and no baseline crash data.

Seen on 2026-11-11 (see the note above on how this was run): 8 cards in all three runs.

## 25. Stress test: FAA research, for-profit company

> We are a for-profit aerospace company, not a university or nonprofit, and we want funding for aircraft composite research. The project would include buying a new wind tunnel, building a test facility, continuing a grant we already hold, running a pilot training course for students, applying without an active SAM.gov registration, charging entertainment and alcohol costs to the grant, spending money before the award and charging it to the grant, and counting our expected profit as cost sharing. We would request about $2.5 million, mostly for the equipment and the building.

Program: **FAA Aviation Research Grants Program**. A for-profit company (not a college or nonprofit), a wind tunnel and a test facility only, a continuation of an existing grant, a training course, no SAM.gov registration, entertainment and alcohol costs, pre-award spending and profit counted as cost sharing.

Seen on 2026-11-11 (see the note above on how this was run): 5 to 8 cards across three runs.

## 26. Stress test: FAA research, independent consultant

> I am an independent consultant, not part of any university, and I want a grant for myself for aviation safety work. The project would include developing a flight training curriculum, helping expand a regional airport terminal, buying equipment, sending a contract proposal instead of a grant proposal, continuing a grant I already hold, applying without an active SAM.gov registration, and charging entertainment and alcohol costs to the grant. I would request about $400,000. I have no indirect cost agreement.

Program: **FAA Aviation Research Grants Program**. An individual applicant, a flight-training curriculum and airport terminal work, equipment, a contract proposal instead of a grant proposal, a continuation of an existing grant, no SAM.gov registration, entertainment and alcohol costs and no indirect cost agreement.

Seen on 2026-11-11 (see the note above on how this was run): 1 to 8 cards across three runs, the least steady of the set.

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
