---
name: sync-architecture-docs
description: Audit doc/*.md in the transportation-grants project against the current chat pipeline implementation (src/web/routes/chat.ts, src/web/chat/*, src/mcp/*) and flag which docs are stale. Use when asked to review, audit, or sync architecture/docs after changing the chat route or tool wiring.
---

# Sync architecture docs

Documentation under `doc/` describes the chat route and MCP tool wiring in
several places. When that implementation changes, these docs can silently
go stale. Audit them before assuming they're current.

## Steps

1. **Find candidate docs.** From the repo root:
   ```bash
   grep -l -iE "chat\.ts|agentic loop|MAX_TOOL_ITERATIONS|SYSTEM_PROMPT|bounded.*loop|single.*(prompt|call)|classify|retrieval|drafting" doc/*.md
   ```
   This catches docs describing the chat route's internals, not just ones
   that mention "chat" in passing.

2. **For each match, read the current implementation** it's describing —
   typically `src/web/routes/chat.ts`, `src/web/chat/types.ts`,
   `src/web/chat/classifier-agent.ts`, `src/web/chat/retrieval-agent.ts`,
   `src/web/chat/drafting-agent.ts`, `src/mcp/tool-schemas.ts`, and
   `src/mcp/tool-executor.ts` — and compare line-by-line against what the
   doc claims (number of Claude calls, tool scoping, system prompt intent,
   response shape, iteration caps).

3. **Classify each doc:**
   - **Accurate** — no action needed.
   - **Stale** — describes behavior that no longer matches the code.
     Needs an update.
   - **Historical** — explicitly presented as a point-in-time record of a
     past design (e.g. `plan_1.md`, referenced elsewhere as "the original
     design"). These are intentionally not kept current — leave them
     alone.

4. **Report a table**: doc → status → what's stale (if anything) — don't
   edit anything yet unless the user has already asked you to fix issues,
   not just find them.

5. **If asked to fix the stale docs**, update only the sections that are
   actually wrong, preserving each doc's existing structure and tone
   (e.g. `CHAT_ROUTE.md`'s "Flow" / "Notable design points" sections,
   `ARCHITECTURE.md`'s numbered component list and ASCII diagram). Update
   cross-doc links/anchors too if a heading you changed is linked from
   another doc (e.g. `MCP_REQUEST_FLOW.md` linking into
   `ARCHITECTURE.md`'s Component 4 anchor).
