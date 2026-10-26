# `chat.ts` — Chat Route Explained

This covers [src/web/routes/chat.ts](../src/web/routes/chat.ts), which
implements `POST /api/chat` — a chat endpoint that lets users ask
natural-language questions about DOT transportation grants, answered by
Claude with tool access.

## Flow

1. **Setup** ([chat.ts:14-28](../src/web/routes/chat.ts#L14-L28)) — defines a
   system prompt instructing the model to stick to facts from tool results
   (not guess at grant details), and converts the MCP server's existing tool
   schemas (`TOOL_SCHEMAS`) into the format the Anthropic SDK expects
   (`ANTHROPIC_TOOLS`). This reuses the same tools/dispatch logic as the
   project's MCP server.

2. **Request validation** ([chat.ts:39-52](../src/web/routes/chat.ts#L39-L52))
   — validates the incoming body against `ChatRequestSchema` and checks that
   an Anthropic API key is configured, erroring out early if either fails.

3. **Agentic loop** ([chat.ts:62-103](../src/web/routes/chat.ts#L62-L103)) —
   calls `anthropic.messages.create` with the conversation history, system
   prompt, and tool definitions, up to `MAX_TOOL_ITERATIONS` (5) times:
   - If Claude's response doesn't request a tool
     (`stop_reason !== 'tool_use'`), it extracts the text blocks as the final
     `reply` and breaks out of the loop.
   - Otherwise, it appends the assistant's tool-use message to `messages`,
     executes each requested tool via `executeTool` (catching and formatting
     errors so Claude can see them), and appends the results as a
     `tool_result` user message — then loops again so Claude can use those
     results.

4. **Fallback and response**
   ([chat.ts:105-109](../src/web/routes/chat.ts#L105-L109)) — if the loop
   exhausts all 5 iterations without a final text reply (e.g., Claude keeps
   calling tools), it returns a generic "couldn't finish" message. Otherwise
   it sends the reply back as JSON.

## Notable design points

- The 5-iteration cap bounds cost/latency regardless of how many tool calls
  Claude chains together.
- It reuses the MCP tool schemas/executor rather than duplicating tool
  definitions — so any tool available via MCP is also available in chat.
- Tool execution errors are caught per-tool and fed back to Claude as
  formatted error content rather than crashing the request.
