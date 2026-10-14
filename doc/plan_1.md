# Natural-language chat search for the public web interface

## Context

Right now the only way for an AI to use this project's grant-search tools conversationally is through an MCP client like Claude Code/Desktop, which other people (website visitors) don't have. The web interface (`public/*.html`) only offers structured forms. The goal is to add a chat-style box to the web interface so any visitor can type free text (e.g. "transit grants over $1M for cities") and get an AI-synthesized answer, backed by the exact same tool functions already used by the MCP server and the REST API — without requiring Claude Code/Desktop.

This reuses the project's existing "dual interface, shared core" architecture (documented in `doc/ARCHITECTURE.md`) and extends it with a third interface: an LLM-mediated chat, implemented with the Anthropic Messages API's tool-use feature running server-side (the Anthropic API key never reaches the browser).

Model: **Claude Sonnet 5** (`claude-sonnet-5`) — good balance of tool-use accuracy and cost for a public-facing feature.

> **Note (post-implementation)**: this plan originally specified the invalid
> model ID `claude-sonnet-5-5`, which caused `/api/chat` to fail with an
> `INTERNAL_ERROR` until fixed in `src/config/config.ts` and `.env.example`.
> The correct ID is `claude-sonnet-5`, as implemented.

## Approach

### 1. Extract shared tool schema + dispatch (small refactor, behavior-preserving)

Currently the 4 tool JSON schemas and the `switch(name)` dispatch logic live only inline in [src/server.ts](../src/server.ts) (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers). The chat feature needs the same schemas (reshaped for Anthropic's `input_schema` key) and the same dispatch. Rather than duplicating ~100 lines, extract:

- **`src/mcp/tool-schemas.ts`** — exports `TOOL_SCHEMAS`, an array of `{ name, description, inputSchema }` for the 4 tools, moved verbatim out of `server.ts`.
- **`src/mcp/tool-executor.ts`** — exports `async function executeTool(name: string, args: unknown)`, containing the existing `switch` body: validates `args` with the matching Zod schema from `src/utils/validators.ts` (`SearchGrantsSchema`, `GetGrantDetailsSchema`, `CheckEligibilitySchema`, `TrackDeadlinesSchema`), throws `GrantServerError('VALIDATION_ERROR', message, false)` on failure, otherwise calls the matching tool function (`searchDOTGrants`, `getGrantDetails`, `checkEligibility`, `trackUpcomingDeadlines`) and returns its result.

Update `src/server.ts` to import and use both — `tools: TOOL_SCHEMAS` in the list handler, and `await executeTool(name, args)` (wrapped in the existing try/catch → `formatErrorResponse`) in the call handler. **No behavioral change** to the MCP server; verify with `claude mcp list` / a sample tool call afterward.

### 2. Anthropic client + config

- Add dependency: `@anthropic-ai/sdk`.
- **`src/clients/anthropic-client.ts`** — `getAnthropicClient()` singleton, following the same pattern as `src/clients/sam-opportunities.ts`.
- **`src/config/config.ts`** — add an `anthropic` block to `Config` (interface in `src/types/index.ts`): `{ apiKey?: string; model: string; maxTokens: number }`, read as `process.env.ANTHROPIC_API_KEY` (no default), `process.env.ANTHROPIC_MODEL || 'claude-sonnet-5'`, `parseInt(process.env.ANTHROPIC_MAX_TOKENS || '1024', 10)`.
  - **Important difference from `SAM_API_KEY`**: do **not** throw in `loadConfig()` if the key is missing — that would break the entire app (search/eligibility/deadlines pages too) for anyone who hasn't set this new key. Instead, the chat route itself checks `config.anthropic.apiKey` and throws `GrantServerError('MISSING_CONFIG', 'ANTHROPIC_API_KEY is required for chat...', false)` lazily, which the existing `errorHandler` already maps to a 503 (`getStatusCode`'s `MISSING_CONFIG` case).
- Add `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_MAX_TOKENS` to `.env.example` with a comment, following the existing section style.

### 3. Chat endpoint — `POST /api/chat`

- **`src/utils/validators.ts`** — add `ChatRequestSchema = z.object({ messages: z.array(z.object({ role: z.enum(['user','assistant']), content: z.string() })).min(1) })`.
- **`src/web/routes/chat.ts`** — new router, mounted as `app.use('/api/chat', chatRouter)` in `src/web/api-server.ts` alongside the other routers.
  - `validateParams(ChatRequestSchema, req.body)`, same 400 pattern as other routes.
  - Checks `config.anthropic.apiKey` is set (503 if not, per above).
  - Builds the Anthropic `tools` array by mapping `TOOL_SCHEMAS` → `{ name, description, input_schema: inputSchema }`.
  - Runs a bounded agentic loop (cap at 5 iterations to bound cost/latency):
    ```
    messages = req.body.messages  (client-maintained history, text-only)
    system = "You are a helpful assistant for the DOT Grants site. Use the
              provided tools to answer questions about grant opportunities,
              eligibility, and deadlines. Only state facts that come from
              tool results — don't guess at specific grants, amounts, or
              deadlines."
    loop (max 5 times):
      response = anthropic.messages.create({ model, max_tokens, system, tools, messages })
      if response.stop_reason !== 'tool_use': break
      messages.push({ role: 'assistant', content: response.content })
      for each tool_use block in response.content:
        result = await executeTool(block.name, block.input)   // reuse from step 1
        tool_results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
      messages.push({ role: 'user', content: tool_results })
    reply = concatenate text blocks from the final response.content
    ```
  - Responds `successResponse({ reply })` — only the final text goes back; intermediate tool-use turns are internal to this one request and are **not** persisted in the client's visible history (keeps the client-side state trivial: a flat array of `{role, content: string}`).
  - Anthropic/API errors wrapped so no raw SDK error details leak to the client (consistent with `doc/ARCHITECTURE.md`'s "error messages don't expose internal details").
- **Basic abuse protection**: since this is the one endpoint that spends real money per request and is explicitly for "other people," add `express-rate-limit` scoped to just this route (e.g. 10 requests/minute per IP, configurable via `CHAT_RATE_LIMIT_REQUESTS`/`CHAT_RATE_LIMIT_WINDOW_MS` env vars, mirroring the existing SAM rate-limit env var naming style).

### 4. Frontend — chat page

- **`public/chat.html`** — new page, same header/nav/container structure as the other pages (add `<li><a href="/chat.html">Chat</a></li>` to the nav `<ul>` on `index.html`, `search.html`, `eligibility.html`, `deadlines.html`, `details.html`, and add the reciprocal full nav to `chat.html`). Body: a `.card` containing a `#chatMessages` div (scrollable message list) and a form with a text input + Send button.
- **`public/js/api.js`** — add `askChat(messages)`:
  ```js
  async function askChat(messages) {
    return await apiFetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
  }
  ```
- **`public/js/chat.js`** — new, follows `search.js`'s shape:
  - Keeps a module-level `let history = []` array of `{role, content}`.
  - On submit: push the user's message, render it (via `escapeHtml`, reusing `common.js`), `showLoading` state on the message list, call `askChat(history)`, push `{role:'assistant', content: reply}` on success, render it; on failure render an error bubble (don't push a bad entry into `history`).
- **`public/css/style.css`** — add minimal `.chat-message`, `.chat-message.user`, `.chat-message.assistant` rules consistent with existing `.card`/`.loading`/`.error` classes (no new design system, just enough to visually distinguish the two speakers).

## Verification

1. `npm run build` succeeds (TypeScript compiles cleanly with the new files/refactor).
2. **MCP parity check** (confirms step 1's refactor didn't change behavior): run `claude mcp list` → still shows `webmcp` connected; ask Claude Code a grant question in chat and confirm `search_dot_grants` still works as before.
3. **Chat endpoint, direct**: with `dist/` rebuilt and `ANTHROPIC_API_KEY` set in `.env`, `npm run start:web`, then `curl -X POST localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"transit grants over 1 million for cities"}]}'` → expect a JSON `{success:true, data:{reply: "..."}}` with a sensible synthesized answer.
4. **Missing-key behavior**: temporarily unset `ANTHROPIC_API_KEY`, confirm `/api/chat` returns a 503 with a clear error, and that `/search.html` and other existing pages still work normally (proves the lazy-check design didn't break the rest of the app).
5. **Browser walkthrough**: open `http://localhost:3000/chat.html`, send a multi-turn conversation (e.g. "transit grants over $1M" then a follow-up "what about for tribal governments instead?"), confirm the chat renders both turns and the assistant's answers look grounded in real tool results (cross-check one against `/search.html`'s results for the same filters).
6. **Rate limit**: send >10 requests/minute from a script/browser and confirm the 11th gets a 429, and that this limit doesn't affect `/api/grants/search` etc.
