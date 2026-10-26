# How an MCP Tool Call Flows Through webmcp

This walks through exactly what happens when you type a natural-language
request into a Claude Code chat connected to the `webmcp` MCP server, using
this example prompt:

```
Search DOT grants for transit agencies with keywords "transit", minimum amount $1,000,000 and maximum amount $100,000,000
```

## Step by step

**1. Claude interprets the sentence (no tool call yet)**

Claude reads the sentence and maps it to the `search_dot_grants` tool's
schema (advertised by the server via `ListToolsRequestSchema` in
[src/server.ts](../src/server.ts#L31), sourced from the shared
`TOOL_SCHEMAS` list in
[src/mcp/tool-schemas.ts](../src/mcp/tool-schemas.ts) — the same schemas the
chat interface uses) when it connected. It decides the arguments should be:

```json
{
  "applicantType": "transit_agency",
  "keywords": "transit",
  "minAmount": 1000000,
  "maxAmount": 100000000
}
```

**2. Claude issues a `tools/call` request**

This goes out as JSON-RPC over the stdio pipe Claude Code has open to the
`webmcp` child process (`node dist/index.js`).

**3. The server receives it** — [src/server.ts:36](../src/server.ts#L36)

The `CallToolRequestSchema` handler pulls out `name` and `arguments`, and
hands both to `executeTool(name, args)` in
[src/mcp/tool-executor.ts](../src/mcp/tool-executor.ts). `executeTool`
dispatches on `name` to the matching tool, running `args` through
`validateParams(SearchGrantsSchema, args)` first (Zod validation — the same
schema class the web API route and the chat interface use, just a different
schema instance).

**4. Business logic runs** — [src/tools/search-grants.ts](../src/tools/search-grants.ts)

Identical to the web interface's flow:
- Calls SAM.gov's Opportunities API with `keywords: "transit"`
- Maps raw SAM opportunities into the app's `GrantOpportunity` shape
- Filters by `applicantType: "transit_agency"` (via `APPLICANT_TYPE_MAPPING`)
- Filters by the $1,000,000–$100,000,000 amount range
- Sorts remaining results by deadline, soonest first

**5. Server responds**

The `CallToolRequestSchema` handler wraps the result array as
`{ content: [{ type: "text", text: JSON.stringify(results, null, 2) }] }`
and sends it back over stdio as the JSON-RPC response.

**6. Claude receives the raw JSON text and synthesizes an answer**

Claude parses that JSON (a stringified array of grant objects — title,
organization, amount, deadline, description, link) and writes a
natural-language summary instead of dumping raw JSON.

## How this compares to the web interface

The only difference from clicking "Search" on `search.html` is the front
door and the wire protocol — and the chat box (`/chat.html`) is a third front
door onto the same tools, with Claude's `tool_use` response taking the place
of the MCP `tools/call` request:

| | Web Interface | Claude Code (MCP) | Chat Box (`/chat.html`) |
|---|---|---|---|
| Front door | HTML form | Claude interpreting your sentence | Anthropic Messages API interpreting your sentence |
| Wire protocol | HTTP `fetch()` | stdio / JSON-RPC | HTTP `fetch()` to `/api/chat`, then server-side Anthropic API call |
| Entry point | Express route ([src/web/routes/grants.ts](../src/web/routes/grants.ts#L13)) | `CallToolRequestSchema` handler ([src/server.ts](../src/server.ts#L36)) | `executeTool()` call inside the retrieval agent's scoped tool loop ([src/web/chat/retrieval-agent.ts](../src/web/chat/retrieval-agent.ts)) |

Everything from `searchDOTGrants()` downward is byte-for-byte the same code
path in all three cases — all three now funnel through
[src/mcp/tool-executor.ts](../src/mcp/tool-executor.ts)'s `executeTool()`.
See [CHAT_ROUTE.md](./CHAT_ROUTE.md) for how the chat pipeline's
classify → retrieve → draft stages work.
