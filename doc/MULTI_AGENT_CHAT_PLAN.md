# Multi-agent chat pipeline — implementation plan

## Context

[`src/web/routes/chat.ts`](../src/web/routes/chat.ts) currently runs **one**
Claude instance in a single agentic tool-use loop (up to
`MAX_TOOL_ITERATIONS` = 5) with one system prompt that has to
simultaneously: figure out what the user is asking, decide which of the 4
MCP tools to call (`search_dot_grants`, `get_grant_details`,
`check_eligibility`, `track_upcoming_deadlines`), and write the final
conversational reply.

This plan splits that single prompt into a query-classifier → retrieval →
drafting multi-agent pipeline, so each stage (classification, tool-driven
fact gathering, and answer composition) is narrower and independently
testable, instead of one prompt doing all three jobs.

The existing `POST /api/chat` response contract (`{ reply, toolCalls }`)
and the [`public/js/chat.js`](../public/js/chat.js) frontend are preserved
as-is — this is a backend orchestration change only, no frontend changes
needed.

## Approach

Replace the single loop in `chat.ts` with three orchestrated Claude calls,
each with one job, wired together in the route handler:

### 1. Classifier agent — new `src/web/chat/classifier-agent.ts`
- One Claude call per request, using a forced `tool_choice` on a small
  local `classify_intent` tool (not part of the shared `TOOL_SCHEMAS` —
  this is routing logic, not a domain tool) with an enum field:
  `search | eligibility | deadlines | details | general`.
- Forcing tool choice makes the output a deterministic, structured field
  instead of parsing intent out of free text.
- Input: full `messages` history (cheap — just one short call), so a
  follow-up like "what about tribal governments?" still classifies
  correctly using prior context.
- Output: `Intent`.

### 2. Retrieval agent — new `src/web/chat/retrieval-agent.ts`
- Reuses the current tool-loop structure from `chat.ts` (today's
  lines ~62–105: call `anthropic.messages.create` with tools, execute
  requested tools via `executeTool` from `src/mcp/tool-executor.ts`,
  feed `tool_result`s back, repeat up to `MAX_TOOL_ITERATIONS`), but:
  - Tools are scoped per intent via an `INTENT_TOOLS` map, e.g.
    `eligibility → [check_eligibility, get_grant_details]`,
    `search → [search_dot_grants, get_grant_details]`,
    `deadlines → [track_upcoming_deadlines]`,
    `details → [get_grant_details]`, `general → []`.
  - System prompt is rewritten to instruct the model to gather and
    summarize concrete facts (figures, IDs, dates) rather than write a
    user-facing final answer — its output is treated as intermediate
    "gathered facts," not the reply shown to the user.
  - For `general` intent, skip the Claude call entirely (no tools to
    call) and return empty facts.
- Returns `{ facts: string, toolCalls: Array<{ name, input }> }`.
- `toolCalls` is passed straight through to the existing response shape
  unchanged, so the frontend's tool-call display keeps working.

### 3. Drafting agent — new `src/web/chat/drafting-agent.ts`
- One Claude call, **no tools** (can't hallucinate new tool calls — it
  can only use facts it was given). Facts are appended to the *system*
  prompt (not as an extra `user` message) to avoid breaking the Anthropic
  API's required user/assistant role alternation.
- System prompt focused purely on composing the final reply: friendly
  tone, cite the gathered facts, and if `facts` is empty, handle
  greetings/off-topic questions directly or say it can only help with DOT
  grant questions.
- Input: full `messages` history plus the retrieval agent's `facts`.
- Output: final `reply` string.

### 4. Orchestration — `src/web/routes/chat.ts`
Replace the current loop body with:
```ts
const intent = await classifyIntent(messages);
const { facts, toolCalls } = await runRetrieval(intent, messages);
const reply = await draftReply(messages, facts);
res.json(successResponse({ reply, toolCalls }));
```
Existing request validation and the `ANTHROPIC_API_KEY` missing-config
check at the top of the handler are unchanged.

### 5. Shared types
Add `Intent` and `INTENT_TOOLS` to a new `src/web/chat/types.ts`, imported
by the classifier and retrieval agents, so the enum isn't duplicated.

### 6. Update `doc/CHAT_ROUTE.md`
Rewrite to describe the new 3-stage pipeline (classifier → retrieval →
drafting) in place of the current single-loop description, keeping the
doc's existing structure (Flow / Notable design points).

## Files touched
- New: `src/web/chat/types.ts`, `src/web/chat/classifier-agent.ts`,
  `src/web/chat/retrieval-agent.ts`, `src/web/chat/drafting-agent.ts`
- Modified: `src/web/routes/chat.ts` (orchestration only), `doc/CHAT_ROUTE.md`
- Unchanged: `public/js/chat.js`, `public/css/style.css`,
  `src/mcp/tool-schemas.ts`, `src/mcp/tool-executor.ts`,
  `src/clients/anthropic-client.ts`

## Verification
1. `npm run build` — confirm TypeScript compiles.
2. `npm run dev:web`, then `curl -X POST /api/chat` with one message per
   intent to confirm correct routing and that `toolCalls` only contains
   tools from that intent's allowed set (check `logger.info` tool-call
   log lines):
   - "What transit agency grants are open right now?" → `search`
   - "Is a tribal government eligible for highway planning funds?" → `eligibility`
   - "What's due in the next 30 days?" → `deadlines`
   - "Tell me about CFDA 20.205" → `details`
   - "Hi, what can you help with?" → `general`, no tool calls
3. Spot-check 2–3 of the same questions against the current (pre-change)
   single-loop behavior to confirm answer quality isn't a regression.

## Why this approach (vs. staying single-prompt)

Per the earlier discussion on when to invest in this: this is worth doing
once failures or prompt-maintenance friction start clustering around a
specific sub-task (e.g. eligibility answers consistently off, or prompt
edits for one behavior regressing another). If that hasn't happened yet,
it's reasonable to hold off and keep the current single-loop
implementation — this document exists so the approach is ready to execute
when/if that signal shows up, not as a signal that it should execute now.
