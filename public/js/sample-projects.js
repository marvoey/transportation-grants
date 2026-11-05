/**
 * Fictional project descriptions for trying the Find grants and Assess tabs, shown in the slide-out tray
 * (samples-drawer.js). The text is the same as docs/NOFO_TEST_PROJECTS.md, which is the place to edit it; a test
 * (src/web/sample-projects.test.ts) fails if the two drift apart. Every place, number and fact is invented.
 */
window.SampleProjects = [
  {
    "id": "sample-1",
    "title": "State DOT bridge replacement (the demo case)",
    "note": "a state applicant, a clear project type, total cost kept apart from the federal request, construction-ready.",
    "text": "We are the Virginia Department of Transportation and we want to replace a structurally deficient two-lane bridge carrying a rural state route over a river in the southwest part of the state. The bridge was built in 1958 and is posted for reduced loads, which forces school buses and farm trucks onto a long detour. Total project cost is about $40 million and we would request $25 million in federal funds. Preliminary engineering and environmental review are complete and the state has committed the remaining match."
  },
  {
    "id": "sample-2",
    "title": "County wildlife overpass",
    "note": "a county applicant, two project types (wildlife and roadway), an early stage, a short deadline.",
    "text": "Our county public works department in southwestern Montana wants to build a wildlife overpass and about four miles of wildlife fencing along a two-lane highway where elk and mule deer are regularly hit by vehicles. The corridor is rural and connects two large blocks of national forest. We estimate the total project cost at $14 million and expect to request about $11 million in federal funds. We have a completed corridor study and a letter of support from the state wildlife agency, but design has not started."
  },
  {
    "id": "sample-3",
    "title": "City bike and pedestrian network",
    "note": "a city applicant, a project type that general infrastructure programs also fund.",
    "text": "The City of Greenville wants to build a connected network of protected bike lanes and widened sidewalks linking downtown, the hospital district, and two low-income neighborhoods that currently have no safe walking or biking route. The project is about 6 miles in an urban area. Total cost is estimated at $18 million and we plan to request $12 million in federal funds. We have a completed bike and pedestrian master plan and are starting 30 percent design."
  },
  {
    "id": "sample-4",
    "title": "Regional transit authority, electric buses",
    "note": "a special-district applicant (a transit authority), a vehicle purchase rather than construction.",
    "text": "We are a regional transit authority serving three counties and we want to replace 24 aging diesel buses with battery-electric buses and build a charging depot at our maintenance facility. The total project cost is about $32 million and we would request $22 million in federal funds. Our board has approved the fleet plan and committed local match from a dedicated sales tax, but the depot design is not complete."
  },
  {
    "id": "sample-5",
    "title": "County road-over-railroad overpass",
    "note": "three project types at once (rail, bridge, safety), a large project with a smaller federal request.",
    "text": "Our county wants to build a grade separation, an overpass, where a busy county road crosses a main freight railroad line. The crossing is blocked by long trains for hours each day, which delays ambulances and school buses, and there have been three crashes in the last five years. The project is in a small city and its rural surroundings. Estimated total cost is $55 million and we would request $25 million in federal funds. The railroad has agreed in principle to the project and environmental review is under way."
  },
  {
    "id": "sample-6",
    "title": "Tribal government road safety",
    "note": "a tribal applicant, plain everyday wording with no program names and no dollar figures, planning rather than construction.",
    "text": "Our tribe has about 40 miles of roads on the reservation that are in poor condition, with no guardrails, faded striping and several dangerous curves. Several people have been seriously hurt in crashes. We do not have an engineer on staff and have not done any planning or studies. We need money to figure out what to fix first and then to fix it."
  },
  {
    "id": "sample-7",
    "title": "Short: main street in bad shape",
    "note": "a city applicant implied but not named, a roadway project, no amounts, no stage.",
    "text": "We're a small town and our main street is falling apart. We need help paying to fix it."
  },
  {
    "id": "sample-8",
    "title": "Short: old county bridge",
    "note": "a county applicant, a bridge project, nothing else. Compare with the full bridge description above: the list should be similar, with more optional questions.",
    "text": "Our county has an old bridge that needs to be replaced and we can't afford it on our own."
  },
  {
    "id": "sample-9",
    "title": "Short: bike lanes near schools",
    "note": "an applicant that is not stated, bike and pedestrian plus safety wording.",
    "text": "We want to add bike lanes and sidewalks around our schools so kids can get there safely."
  },
  {
    "id": "sample-10",
    "title": "Short: new buses",
    "note": "a transit applicant, a vehicle purchase, phrased as a question.",
    "text": "Our transit agency needs to replace some old buses. Is there any funding for that?"
  },
  {
    "id": "sample-11",
    "title": "Short: dangerous intersections",
    "note": "a safety project with no mode, no amounts, no applicant type beyond \"city\".",
    "text": "There are a few intersections in our city where people keep getting hurt. We want to do something about it."
  },
  {
    "id": "sample-12",
    "title": "Short: no project type at all",
    "note": "no project type, so this is the one case where the tool should ask a required question. The list should still appear once you answer, or when you choose **Show grants now**.",
    "text": "We're a county government and we have a transportation project we'd like to get funded."
  }
];
