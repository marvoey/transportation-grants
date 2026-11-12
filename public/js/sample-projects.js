/**
 * Fictitious project descriptions for trying the Find grants and Assess tabs, shown in the slide-out tray
 * (samples-drawer.js). The text is the same as docs/NOFO_TEST_PROJECTS.md, which is the place to edit it; a test
 * (src/web/sample-projects.test.ts) fails if the two drift apart. Every place, number and fact is invented.
 *
 * The tray shows them in array order. First come six short, vague ones (one per program, and one generic with no
 * project type). Then ten "Stress test" projects, two per program (the two Crash Causal Factors ones first), written to
 * produce as many finding cards as possible on the Assess tab: each runs into many rules in its notice (an ineligible applicant,
 * an amount outside the range, banned costs, a duplicate application). Each problem is phrased as something the
 * project "would include", because the fact-reading step picks those phrases up and drops passing remarks.
 *
 * Then there are two for each of the five open listings whose notice documents are downloaded in data/opportunities
 * (Wildlife Crossings, Crash Causal Factors, Recalls, ITSE, FAA Aviation Research): a project that would apply but is
 * missing one thing, and one that is missing two. The program facts come from docs/NOFO_FACT_SHEETS.md.
 */
window.SampleProjects = [
  {
    "id": "sample-11",
    "title": "Short: deer on our highway",
    "note": "A county applicant and a wildlife crossing in plain words: no program name, no amounts, no stage. Written for the Wildlife Crossings Pilot Program.",
    "text": "Our county wants fencing and a wildlife crossing on a highway where deer keep getting hit."
  },
  {
    "id": "sample-12",
    "title": "Short: big-truck crash study",
    "note": "A state law enforcement applicant (a state patrol), phrased as a question. Written for the Crash Causal Factors Program.",
    "text": "Our state patrol wants to join a federal study of fatal crashes involving big trucks. Is there funding for the extra work?"
  },
  {
    "id": "sample-13",
    "title": "Short: recall notices at registration",
    "note": "A state vehicle-registration agency and a recall notification process, phrased as a question. Written for the State Process for Informing Consumers of Recalls Program.",
    "text": "Our state motor vehicle agency wants to inform owners of open safety recalls at vehicle registration. Is there funding for a notification process?"
  },
  {
    "id": "sample-14",
    "title": "Short: speeding and drunk driving",
    "note": "A local law enforcement applicant (a police department) and an enforcement program, nothing else. Written for the ITSE Grant Program.",
    "text": "Our police department wants money to try a new traffic safety enforcement program to cut speeding and drunk driving."
  },
  {
    "id": "sample-15",
    "title": "Short: aviation research",
    "note": "A university applicant, which this program accepts but a state or local transportation agency would not be. Written for the FAA Aviation Research Grants Program.",
    "text": "Our university wants funding for aviation safety research, like stronger materials for aircraft."
  },
  {
    "id": "sample-16",
    "title": "Short: no project type at all",
    "note": "No project type, so the tool should ask what kind of project it is (and who the applicant is) before searching. The list should still appear once you answer, or when you choose “Skip the questions and search”.",
    "text": "We're a county government and we have a transportation project we'd like to get funded."
  },
  {
    "id": "sample-19",
    "title": "Stress test: Crash Causal Factors, Colorado patrol",
    "note": "Crash Causal Factors Program. A state patrol in a State that is not in the study sample, a $1.4 million request over the $500,000 ceiling, a new reconstruction unit, patrol vehicles and routine expenses, passenger-car crashes, five projects in one application and a duplicate submission.",
    "text": "We are the Colorado state highway patrol and we want to take part in the federal study of fatal crashes involving large trucks. The project would include creating a brand new crash reconstruction unit, since we have none today, buying ten new patrol vehicles, covering our routine operating expenses, investigating serious crashes involving pickup trucks and passenger cars, submitting five separate projects in one application, and filing a duplicate of an application we already submitted. We would request about $1.4 million, with no matching funds. We have no historical records to support our overtime estimate and our troopers hold no truck inspection certification."
  },
  {
    "id": "sample-20",
    "title": "Stress test: Crash Causal Factors, for-profit company",
    "note": "Crash Causal Factors Program. A for-profit company in a State that is not in the study sample, a $900,000 request over the ceiling, its own new investigation team, a vehicle fleet, routine expenses, passenger-car crashes, five projects in one application and a resubmission.",
    "text": "We are a for-profit trucking safety consulting company in Oregon and we want to join the federal study of fatal crashes involving large trucks. The project would include setting up our own crash investigation team, buying a vehicle fleet, covering routine operating expenses, investigating crashes involving passenger cars, submitting five separate projects in one application, and resubmitting an application we already submitted once before. We would request about $900,000 over the study period, with no matching funds. We have not talked to any state agency about it."
  },
  {
    "id": "sample-17",
    "title": "Stress test: Wildlife Crossings, private ranch crossing",
    "note": "Wildlife Crossings Pilot Program. A private ranching company (not a listed applicant type), an 8 percent match against the 20 percent minimum, work started before any award, earlier spending counted as match, no State highway department consultation, no budget or schedule, a duplicate application and a late paper copy.",
    "text": "We are a private ranching company in central Montana with a wildlife crossing project on a state highway that crosses our land, where elk and mule deer are hit by vehicles every migration season. The project would include building two underpasses with about three miles of fencing, starting construction next month before any award and being reimbursed later, counting money we already spent on a first underpass last spring as match, going ahead without consulting the state highway department, leaving out the project budget and schedule, submitting this same application twice, and mailing a paper copy after the deadline. The total project cost is $12.5 million and we would request $11.5 million in federal funds, and can contribute only $1 million ourselves."
  },
  {
    "id": "sample-18",
    "title": "Stress test: Wildlife Crossings, nonprofit foundation overpass",
    "note": "Wildlife Crossings Pilot Program. A private conservation nonprofit asking for 100 percent federal funding with no match, work started before any award, earlier spending counted as match, no State highway department consultation, no budget or schedule, a late paper copy, no cost-overrun plan and no maintenance funding.",
    "text": "We are a private conservation nonprofit foundation in northern Utah with a wildlife crossing project on a four-lane highway that cuts through a deer and elk migration route. The project would include building a wildlife overpass with about eight miles of fencing, starting construction before any award and being reimbursed later, counting money we spent last year as match, going ahead without consulting the state highway department, leaving out the project budget and schedule, and mailing a paper application after the deadline. The total project cost is $30 million and we would request all $30 million in federal funds, and can contribute $0 ourselves. We have no plan for cost overruns and nobody has agreed to pay for maintenance."
  },
  {
    "id": "sample-21",
    "title": "Stress test: Recalls, county tax collector",
    "note": "State Process for Informing Consumers of Recalls Program. A county office (not a State agency), a $650,000 request over the $500,000 top of the range, lobbying, overseas-made kiosks, a covered-technology vendor, a prior award under this program and two applications.",
    "text": "We are a county tax collector's office in Florida and we want to build a notification process for open safety recalls at vehicle registration. We would request about $650,000 over the 33-month project, with no matching funds. The project would include lobbying the state legislature to require recall notices, buying overseas-made kiosks for our offices, paying a second vendor that uses covered telecommunications equipment, applying again after the award we already received under this program two years ago, and submitting two applications from our office. We have no project manager, no timeline and no recall data vendor."
  },
  {
    "id": "sample-22",
    "title": "Stress test: Recalls, New Mexico division",
    "note": "State Process for Informing Consumers of Recalls Program. A State agency (eligible), but a $180,000 request under the $300,000 low end, a prior award under this program, an undisclosed conflict of interest, lobbying, overseas-made kiosks, a covered-technology subcontractor and no work breakdown or timeline.",
    "text": "We are a state motor vehicle division in New Mexico and we want to notify owners of open safety recalls when they register or renew their vehicles. We would request about $180,000 for the 33-month project, with no matching funds. The project would include applying again as a state that already received an award under this recall program, buying our recall data from a company owned by our director's brother without disclosing that relationship, lobbying the legislature for recall notice funding, buying overseas-made kiosks, subcontracting to a vendor that uses covered telecommunications equipment, and leaving out a work breakdown and timeline."
  },
  {
    "id": "sample-23",
    "title": "Stress test: ITSE, city police",
    "note": "ITSE Grant Program. A city police department, a $3.5 million request over the $2 million top and an 80-month project over the 60-month limit, no focus area, foreign-made cameras from a covered-technology vendor, lobbying, two applications and no SAM.gov registration.",
    "text": "Our city police department wants to run a new, innovative traffic safety enforcement program. We would request about $3.5 million for an 80-month project. The project would include general extra patrols with no specific focus area, buying foreign-made license plate reading cameras from a vendor that uses covered telecommunications equipment, lobbying the city council for a speed camera ordinance, filing two applications from our department in the same phase, and applying without an active SAM.gov registration. We have no plan to evaluate the results."
  },
  {
    "id": "sample-24",
    "title": "Stress test: ITSE, county sheriff",
    "note": "ITSE Grant Program. A county sheriff, a $350,000 request under the $500,000 low end, lobbying, imported equipment, a covered-technology subcontractor, an undisclosed conflict of interest, two applications, no SAM.gov registration, no evaluation partner and no baseline crash data.",
    "text": "Our county sheriff's office in rural Georgia wants to run an innovative traffic safety enforcement program to reduce distracted driving. We would request about $350,000. The project would include lobbying county commissioners for a distracted driving ordinance, buying imported patrol equipment, paying a subcontractor that uses covered telecommunications equipment, refusing to disclose a conflict of interest with our evaluator, filing two applications in the same phase, and applying without an active SAM.gov registration. We have no partner to evaluate the results and no baseline crash data."
  },
  {
    "id": "sample-25",
    "title": "Stress test: FAA research, for-profit company",
    "note": "FAA Aviation Research Grants Program. A for-profit company (not a college or nonprofit), a wind tunnel and a test facility only, a continuation of an existing grant, a training course, no SAM.gov registration, entertainment and alcohol costs, pre-award spending and profit counted as cost sharing.",
    "text": "We are a for-profit aerospace company, not a university or nonprofit, and we want funding for aircraft composite research. The project would include buying a new wind tunnel, building a test facility, continuing a grant we already hold, running a pilot training course for students, applying without an active SAM.gov registration, charging entertainment and alcohol costs to the grant, spending money before the award and charging it to the grant, and counting our expected profit as cost sharing. We would request about $2.5 million, mostly for the equipment and the building."
  },
  {
    "id": "sample-26",
    "title": "Stress test: FAA research, independent consultant",
    "note": "FAA Aviation Research Grants Program. An individual applicant, a flight-training curriculum and airport terminal work, equipment, a contract proposal instead of a grant proposal, a continuation of an existing grant, no SAM.gov registration, entertainment and alcohol costs and no indirect cost agreement.",
    "text": "I am an independent consultant, not part of any university, and I want a grant for myself for aviation safety work. The project would include developing a flight training curriculum, helping expand a regional airport terminal, buying equipment, sending a contract proposal instead of a grant proposal, continuing a grant I already hold, applying without an active SAM.gov registration, and charging entertainment and alcohol costs to the grant. I would request about $400,000. I have no indirect cost agreement."
  },
  {
    "id": "sample-1",
    "title": "Wildlife Crossings: county underpasses (1 gap)",
    "note": "Wildlife Crossings Pilot Program. A rural county, a 20 percent match that exactly meets the minimum, consultation with the state highway department documented. One gap: the State DOT has not agreed to administer the grant.",
    "text": "Our county road and bridge department in northwestern Wyoming wants to build two wildlife underpasses with about three miles of wildlife fencing on a state highway where mule deer and pronghorn are hit by vehicles every migration season. We have ten years of crash and carcass data and a letter of support from the state wildlife agency. The total project cost is $12.5 million and we would request $10 million in federal funds, with the county and state wildlife funds covering the other $2.5 million. We consulted the state highway department and have its letter, but it has not yet agreed to administer the grant. Design is 30 percent complete."
  },
  {
    "id": "sample-2",
    "title": "Wildlife Crossings: regional authority overpass (2 gaps)",
    "note": "Wildlife Crossings Pilot Program. A regional transportation authority, a 27 percent match, the State DOT consulted and agreed to administer. Two gaps: no plan for cost overruns, and no maintenance funding.",
    "text": "We are a regional transportation authority in northern Utah and we want to build a wildlife overpass and about eight miles of wildlife fencing along a four-lane highway that cuts through a deer and elk migration route, where collisions have caused serious injuries and several deaths over the past decade. The total project cost is $30 million and we would request $22 million in federal funds, with the rest from state and local funds that are already committed. The state highway department was consulted and has agreed to administer the grant, and design is 60 percent complete. We have not yet planned for cost overruns, and we have not identified who will pay to maintain the structure after it is built."
  },
  {
    "id": "sample-3",
    "title": "Crash Causal Factors: Ohio highway patrol (1 gap)",
    "note": "Crash Causal Factors Program. A state highway patrol in a participating state, an existing reconstruction unit whose troopers are all certified, a request under the $500,000 ceiling. One gap: the historical overtime records are not yet gathered.",
    "text": "We are a state highway patrol in Ohio and we want to take part in the federal study of fatal crashes involving large trucks (Class 7 and 8). Our existing crash reconstruction unit has investigated fatal truck crashes for more than ten years, and all twelve of its troopers hold the North American Standard Part A and B inspection certification. We would request about $480,000 over the study period for overtime and data-collection equipment, with no matching funds. We have not yet gathered the historical overtime records we need to support our overtime estimate."
  },
  {
    "id": "sample-4",
    "title": "Crash Causal Factors: Missouri highway patrol (2 gaps)",
    "note": "Crash Causal Factors Program. A state highway patrol in a participating state, a request under the ceiling, an overtime estimate with a historical basis. Two gaps: only some troopers hold the inspection certification, and no coordination yet with the State lead agency.",
    "text": "We are a state highway patrol in Missouri and we want to join the federal study of fatal crashes involving large trucks. Our crash reconstruction team has handled fatal truck crashes for years, but only four of its twelve troopers hold the North American Standard Part A and B inspection certification, and we have not yet talked to the state agency that leads our commercial vehicle safety program about how our proposal fits the state plan. We would request about $390,000 over the study period for overtime and data-collection equipment, with no matching funds. Our overtime estimate is based on three years of records."
  },
  {
    "id": "sample-5",
    "title": "Recalls: Washington motor vehicle agency (1 gap)",
    "note": "State Process for Informing Consumers of Recalls Program. A state vehicle-registration agency, a request inside the $300,000 to $500,000 range, with a project manager, draft notification language and a measurement plan. One gap: the recall-data vendor is not chosen.",
    "text": "We are a state motor vehicle agency in Washington and we want to build a notification process for open safety recalls at vehicle registration. When an owner registers or renews, we would check the vehicle against recall data, tell the owner right then online or at the counter, and later analyze how many recalls get fixed. We would request about $450,000 over the 33-month project, with no matching funds. We have the staff and registration system to run it, a project manager named, a draft of the notification language and a plan to measure completed recalls, but we have not yet chosen the vendor that will supply our recall data."
  },
  {
    "id": "sample-6",
    "title": "Recalls: New Mexico motor vehicle division (2 gaps)",
    "note": "State Process for Informing Consumers of Recalls Program. A state vehicle-registration agency, a request at the top of the anticipated range, a recall data source and draft notification language. Two gaps: no method for analyzing completed recalls, and no project manager or staffing plan.",
    "text": "We are a state motor vehicle division in New Mexico and we want to notify owners of open safety recalls when they register or renew their vehicles, by checking each VIN against recall data and showing the notice online, by mail and at our field offices. We would request about $500,000 for the 33-month project, with no matching funds. We have a recall data source and draft notification language, and our registration system can store the recall status of each vehicle. We have not yet worked out how we will analyze whether the recalls actually get fixed, and we have not named a project manager or planned the staffing."
  },
  {
    "id": "sample-7",
    "title": "ITSE: city police speed enforcement (1 gap)",
    "note": "Innovative Traffic Safety Enforcement (ITSE) Grant Program. A city police department, a named focus area (speeding and aggressive driving), a university evaluation partner, a request inside the anticipated range, for the March 2027 phase. One gap: no SAM.gov registration.",
    "text": "Our city police department wants to run a new, innovative traffic safety enforcement program aimed at speeding and aggressive driving on our ten highest-crash corridors. We would use crash and speed data to decide where and when to patrol, adjust the patrols as crash patterns change, and test the approach so that other departments can repeat it. A state university has agreed to evaluate the results, and we have three years of crash data for the corridors. We would request about $1.8 million over three years and hope to apply in the March 2027 round. We have not yet registered in SAM.gov."
  },
  {
    "id": "sample-8",
    "title": "ITSE: county sheriff distracted driving (2 gaps)",
    "note": "Innovative Traffic Safety Enforcement (ITSE) Grant Program. A rural county sheriff’s office, a named focus area (distracted driving), a four-year project, registered in SAM.gov. Two gaps: no evaluation partner or data-collection method, and no baseline crash data.",
    "text": "Our county sheriff’s office in rural Georgia wants to run an innovative traffic safety enforcement program to reduce distracted driving on county roads where several serious crashes have involved phones. We would pair patrols with a community awareness effort run with local schools and employers over four years, and we want other agencies to be able to copy it. We would request about $1.2 million. We have registered in SAM.gov, but we have not yet found a partner to evaluate the results or decided how we will collect the data, and we have not assembled baseline crash data."
  },
  {
    "id": "sample-9",
    "title": "FAA research: university composites (1 gap)",
    "note": "FAA Aviation Research Grants Program. A public university, aircraft structural safety research, 36 months, equipment as only part of the budget, an indirect cost agreement in place. One gap: SAM.gov registration is still being renewed.",
    "text": "We are the aviation engineering department at a public university and we want to carry out a three-year research project on how composite materials in aircraft structures age and fail, to improve aircraft safety. We would request about $1.8 million over 36 months, mostly for faculty time, graduate researchers and testing, with about $300,000 for a fatigue testing machine, and we plan to share part of the cost. We have a negotiated indirect cost agreement, a draft project summary and biographical sketches for our key researchers. Our university’s SAM.gov registration is still being renewed."
  },
  {
    "id": "sample-10",
    "title": "FAA research: nonprofit weather decisions (2 gaps)",
    "note": "FAA Aviation Research Grants Program. A 501(c)(3) research institute, human factors and weather research, 24 months, registered in SAM.gov. Two gaps: no negotiated indirect cost agreement, and current and pending support not compiled.",
    "text": "We are a nonprofit 501(c)(3) research institute and we want to study how pilots make decisions in deteriorating weather, using flight simulator experiments, to improve aviation safety. We would request about $900,000 over 24 months, mostly for researcher salaries and simulator time. We are registered in SAM.gov and have our key personnel and a draft description of the work, but we do not yet have a negotiated indirect cost agreement, and we have not yet compiled our current and pending support."
  }
];
