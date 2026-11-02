# Chat route — the multi-agent pipeline explained

This covers [src/web/routes/chat.ts](../src/web/routes/chat.ts), which
implements `POST /api/chat` — a chat endpoint that lets users ask
natural-language questions about DOT transportation grants, answered by
Claude with tool access.

The route is a thin orchestrator over three single-purpose Claude calls,
each in its own module under [src/web/chat/](../src/web/chat/):

```
POST /api/chat
  │
  ├─ 1. classifyIntent()        src/web/chat/classifier-agent.ts
  │
  ├─ 2. runRetrieval(intent)    src/web/chat/retrieval-agent.ts
  │       (uses src/mcp/tool-schemas.ts + tool-executor.ts)
  │
  └─ 3. draftReply(facts)       src/web/chat/drafting-agent.ts
```

## Flow

1. **Request validation** ([chat.ts](../src/web/routes/chat.ts)) — validates
   the incoming body against `ChatRequestSchema` and checks that an
   Anthropic API key is configured, erroring out early if either fails.
   The body may also carry an optional `projectId` (a UUID); see
   [Project context](#project-context-optional) below. Without it, nothing
   about the pipeline changes.

2. **Classify** — [classifier-agent.ts](../src/web/chat/classifier-agent.ts)
   makes one Claude call with a forced `tool_choice` on a local
   `classify_intent` tool, so the result is a deterministic field rather
   than text to parse. The full conversation history is passed in, so a
   follow-up like "what about tribal governments?" still classifies
   correctly using prior context. Output is one of:
   `search | eligibility | deadlines | details | general`
   (defined in [types.ts](../src/web/chat/types.ts)).

3. **Retrieve** — [retrieval-agent.ts](../src/web/chat/retrieval-agent.ts)
   runs a bounded agentic tool-use loop (same shape as the project's
   original single-loop design: call `anthropic.messages.create`, execute
   any `tool_use` blocks via `executeTool()` from
   [src/mcp/tool-executor.ts](../src/mcp/tool-executor.ts), feed results
   back, repeat up to `MAX_TOOL_ITERATIONS` = 5), but scoped to only the
   tools relevant to the classified intent via the `INTENT_TOOLS` map in
   `types.ts` (e.g. `eligibility` only sees `check_eligibility` and
   `get_grant_details`, not all 4 tools). Its system prompt asks it to
   gather and summarize facts, not write a final answer — that output is
   treated as intermediate `facts`, not the user-facing `reply`. For the
   `general` intent there are no tools to call, so this step is skipped
   entirely and returns empty facts.

4. **Draft** — [drafting-agent.ts](../src/web/chat/drafting-agent.ts) makes
   one final Claude call with **no tool access**, so it can't invent new
   tool calls — it can only use the facts it was handed. The facts are
   appended to the *system* prompt (not as an extra `user` message) to
   avoid breaking the Anthropic API's required user/assistant role
   alternation. If no facts were gathered (the `general` case), it answers
   greetings/off-topic questions directly or explains it can only help
   with DOT grant questions.

5. **Response** ([chat.ts](../src/web/routes/chat.ts)) — if drafting
   somehow returns no text, falls back to a generic "couldn't finish"
   message. Otherwise returns `{ reply, toolCalls }` as JSON. When a
   project was used the response also carries
   `context: { projectId, revision }`.

## Project context (optional)

`POST /api/chat` accepts `{ messages, projectId? }`. When `projectId` is set
(and `PROJECT_DISCOVERY_ENABLED=true`), the route:

1. requires a same-origin JSON request (`Origin` header + `Content-Type:
   application/json`, else `403 ORIGIN_REJECTED`), because the request now
   carries a session cookie;
2. resolves ownership **only** from the session cookie and loads the saved
   profile (`ProjectService.getProject`). Missing, deleted, foreign, no
   session and feature-off are one indistinguishable
   `404 PROJECT_NOT_FOUND`; the model is never called in that case;
3. builds a bounded, delimited, markup-escaped context with
   [project-context.ts](../src/projects/project-context.ts) (default cap
   2,000 characters, `PROJECT_CONTEXT_MAX_CHARS`): a text block (facts,
   unknowns and unconfirmed assumptions listed separately) plus a small
   structured subset (`applicantType`, `state`, `modes`).

Where it enters the pipeline:

| Stage | Receives | Notes |
| --- | --- | --- |
| Classify | nothing | Routing uses the conversation only, so profile text cannot influence which tools are enabled |
| Retrieve | structured subset, in the system prompt | Default values for tool arguments only. `INTENT_TOOLS` is unchanged: the profile never adds, removes or authorizes a tool. If the applicant type is unknown the model is told not to guess |
| Draft | text block, appended to the system prompt after the facts | Labeled applicant-provided and untrusted; one extra rule says to use it only to tailor and prioritize, never as a source of grant names, amounts, deadlines or eligibility, and to ask for the applicant type if it is missing |

Chat only reads the profile; it never changes it. The page
([chat.js](../public/js/chat.js)) shows the project name, readiness and missing
context with a link back to the workspace, resets the conversation when the
selected project changes, and shows "Project updated — this conversation now
uses revision N" when a later response reports a different revision (the
server loads the latest profile on every request, so there is no polling).
A project that cannot be loaded blocks sending until the user explicitly
chooses "Continue without a project". See
[PROJECT_DISCOVERY.md](./PROJECT_DISCOVERY.md).

## Notable design points

- **Why split into three calls**: a single prompt had to simultaneously
  classify intent, decide which tools to call, and write the final answer.
  Splitting those into three narrower calls makes each stage independently
  testable and lets tool access be scoped per intent instead of exposing
  all 4 tools to every request. See
  [MULTI_AGENT_CHAT_PLAN.md](./MULTI_AGENT_CHAT_PLAN.md) for the full
  rationale and when this tradeoff (extra latency/LLM calls) is worth it.
- The 5-iteration cap in the retrieval step bounds cost/latency regardless
  of how many tool calls Claude chains together, same as before.
- Retrieval reuses the MCP tool schemas/executor rather than duplicating
  tool definitions — so any tool available via MCP is also available in
  chat.
- Tool execution errors are caught per-tool and fed back to Claude as
  formatted error content rather than crashing the request.
- Classification and drafting are both single, non-looping calls, so the
  worst case per request is still bounded (1 classify call + up to 5
  retrieval iterations + 1 draft call). Project context adds no calls.
- [chat.characterization.test.ts](../src/web/routes/chat.characterization.test.ts)
  pins the no-project behavior (envelope, stage order, per-intent tool
  scoping, how facts reach the drafter); it is kept unchanged alongside the
  project-aware tests in `chat.project.test.ts`.
