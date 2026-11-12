# GrantFlow AI concept of operations: from government search to AI-guided consultation

**Big Build 3.0 | Concept of Operations**

*From Government Search to AI-Guided Consultation*

## PROBLEM STATEMENT

Government employees usually start with a mission need, not a grant program name. A transportation agency may know it needs to replace an unsafe bridge or improve a congested interchange, but finding federal funding means learning where to search, guessing the right keywords, choosing among numerous filters, and repeatedly adjusting searches that return either too many opportunities or too few. Even after locating a promising program, staff must interpret lengthy Notices of Funding Opportunity (NOFOs) and determine how the requirements apply to their specific project.

This is a system-centered experience: employees must first understand how government programs are organized before they can make progress on the project itself. The effort competes with project delivery, disproportionately burdens smaller agencies with limited grant-writing capacity, and can generate follow-up questions and avoidable rework for federal program staff.

The opportunity is to reverse the interaction. Much like a consultation begins by understanding a person’s situation rather than asking them to search a catalog of treatments, funding discovery should begin by understanding the project—not by expecting applicants to master the program catalog.

## SOLUTION: GRANTFLOW AI

GrantFlow AI is a working, project-first guidance application for state and local transportation agencies. Its central innovation is the shift from keyword-and-filter searching to an AI-guided consultation: the applicant describes what they want to accomplish, the system asks clarifying questions, identifies potentially relevant funding, and helps assess what a specific notice means for that project.

Find Grants: The applicant describes the transportation project in everyday language. GrantFlow identifies useful project facts—including applicant type, project category, stage, and anticipated federal request—and asks for missing details when they matter. It searches current listings from Simpler.Grants.gov and produces an explainable shortlist with fit signals and cautions. Users can skip clarification and search immediately; the list is a starting point, not an eligibility ruling.

Assess a Project: The applicant carries the project context into a selected opportunity. GrantFlow uses requirements extracted from official NOFO documents to evaluate stated project facts, distinguish apparently supported conditions from possible conflicts, preparation gaps, and unknowns, and ask targeted follow-up questions. As the applicant provides more information, it reassesses the findings. The application links findings to quoted source passages so users can inspect the underlying notice.

The novelty claimed is the integrated consultation experience—not the invention of language models, search, or rules engines. Behind the experience, language interpretation, structured checks, source-quotation verification, and guarded findings support repeatable guidance. The current TypeScript/Node.js MVP demonstrates discovery, document preparation, and preliminary project assessment. It is not a production service; extracted requirements may be incomplete or need human verification. It does not decide eligibility, predict awards, or submit applications.

## IMPACT & VALUE CASE

Less search friction: Rather than repeatedly testing keywords and filters, applicants can describe a project once, answer relevant questions, and review a concise, explained set of possible matches. This is a demonstrated workflow improvement; the number of clicks or minutes saved has not yet been measured.

Faster preliminary assessment: A scenario analysis based on an actual NHTSA grant package estimates 6–10 staff hours for a manual initial review compared with a projected 2–3 hours using GrantFlow. At the midpoints, this represents 5.5 hours of potential capacity freed per assessment—approximately 69%, or roughly 70%, less active effort. These figures are modeled, not measured outcomes.

Potential mission-scale benefit: In an illustrative cycle with 300 applicants and 50% adoption, 150 assisted assessments multiplied by 5.5 hours would free approximately 825 applicant hours (roughly 800) for project planning and preparation. Better-prepared applicants could also reduce clarification exchanges and rework for federal administrators, but that benefit requires validation.

Pilot measurement: Compare the same project against the same opportunity using conventional keyword/filter search, a standard document-chat workflow, and GrantFlow. Track time and search iterations to a useful shortlist, opportunity relevance, preliminary assessment time, requirement coverage, citation accuracy, follow-up questions, and human review effort. This will establish whether the consultation experience delivers meaningful productivity gains.

## FUTURE STATE

With agency feedback and stronger human-verified requirement libraries, GrantFlow could offer persistent project profiles, collaboration across applicant teams, notices and amendments monitoring, and better handoffs to grant professionals. The longer-term opportunity is to apply the same objective-first consultation pattern to other government processes where people must find applicable programs and interpret complex requirements. Those extensions are possibilities, not capabilities demonstrated by this MVP.

