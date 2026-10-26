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
   Unchanged from before.

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
   message. Otherwise returns `{ reply, toolCalls }` as JSON — the same
   response shape as before this change, so
   [public/js/chat.js](../public/js/chat.js) needed no updates.

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
  retrieval iterations + 1 draft call).
