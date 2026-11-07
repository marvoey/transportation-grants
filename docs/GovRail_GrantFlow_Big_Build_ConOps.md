# GovRail + GrantFlow AI

*Big Build 3.0 | Concept of Operations | Grounded AI Guidance for Government*

## 1. Mission Need and Value

State and local governments spend substantial time identifying federal funding opportunities and interpreting complex Notices of Funding Opportunity (NOFOs). Determining how requirements apply to planned transportation projects demands manual research, specialized expertise, and repeated clarification.

Scale and deadlines compound the burden. Competitive DOT programs can receive hundreds of applications per funding round: SMART received 308 applications in FY 2024, and RAISE received 1,048 eligible applications that year. Applicants work against fixed deadlines while federal administrators manage concentrated review workloads and questions.

The mission opportunity is productivity on both sides of the federal grants process: less assessment effort for state and local applicants, with the potential for fewer avoidable questions and rework for federal administrators.

## 2. The Solution: GrantFlow AI

GrantFlow AI is an AI-powered solution that transforms federal grant discovery and assessment into a precise, automated, project-driven process, connecting state and local transportation projects to relevant funding opportunities and the evidence needed to make informed funding decisions.

**Grant Discovery:** Starts with a project description, asks targeted questions, identifies potentially relevant opportunities, and explains the matches.

**Grant Assessment:** Compares applicant-provided project facts with structured requirements from official NOFO documents, highlighting supported conditions, potential conflicts, preparation gaps, and unanswered questions with source references.

GrantFlow provides preliminary guidance, not definitive eligibility determinations or automated funding decisions.

## 3. The Innovation: GovRail

GovRail is an AI guidance harness combining the reasoning capabilities of large language models with the reliability of structured, deterministic code to guide complex, requirements-driven government workflows.

**LLM reasoning:** Interprets project descriptions and complex language, asks clarifying questions, and explains findings.

**Deterministic code:** Applies explicit checks, structures outputs, and constrains conclusions.

**Evidence grounding:** Links findings to official sources and distinguishes missing information from conflicts.

**Guided interaction:** Uses identified gaps to direct meaningful next questions and actions.

GrantFlow demonstrates this hybrid approach across discovery and assessment. The innovation is not simply faster answers: models interpret and guide, code enforces explicit rules, and people retain decision authority.

## 4. Execution

GrantFlow is a working web application connecting federal opportunity discovery with project-specific NOFO assessment. It uses Simpler.Grants.gov listings, structured document extraction, deterministic checks, and constrained LLM interpretation to produce evidence-supported preliminary findings. The implementation uses TypeScript, Node.js, and Anthropic AI. The demonstrated GovRail approach is reusable across two workflows; it is not yet presented as an independent, general-purpose platform.

## 5. Mission Impact and Measurement

**Applicant productivity:** A scenario analysis of an actual NHTSA grant and supporting documents estimates 6–10 staff hours for manual preliminary assessment versus a projected 2–3 hours with GrantFlow: approximately 70% less active effort, or 5–6 hours potentially freed per assessment.

**Impact at scale:** For a 300-application funding round, if half use GrantFlow, roughly 800 applicant staff hours could be freed within that funding cycle.

**Federal productivity:** Better-informed applicants could reduce repeat inquiries and avoidable rework during concentrated review periods. Under an illustrative scenario of 40 clarification exchanges per 100 applicants, 50% adoption, 25% fewer exchanges, and one federal staff hour per exchange, a 300-application round could free approximately 15 federal staff hours. Broader effects remain unquantified.

**Measurement:** All savings are modeled, not observed. Validation will compare time, requirement coverage, accuracy, citation quality, human verification effort, and federal clarification rates.

## 6. Broader Mission Potential

GovRail’s guided, evidence-grounded approach could extend beyond transportation grants to other federal assistance and requirements-intensive workflows—reducing administrative complexity at scale and returning staff capacity to mission delivery.
