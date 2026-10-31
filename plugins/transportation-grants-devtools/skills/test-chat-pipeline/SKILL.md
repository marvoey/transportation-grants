---
name: test-chat-pipeline
description: Test the transportation-grants DOT chat pipeline (classify → retrieve → draft) end-to-end by exercising all 5 intents via curl and checking tool-call scoping against src/web/chat/types.ts. Use when asked to test, verify, or check the /api/chat route or chat feature in this project.
---

# Test the chat pipeline

`POST /api/chat` (`src/web/routes/chat.ts`) runs a 3-stage pipeline:
classify → retrieve (tool-scoped per intent) → draft. Verify it end-to-end
by exercising all 5 intents and checking tool scoping.

## Steps

1. **Check environment.** Confirm `.env` has `ANTHROPIC_API_KEY` set, and
   either `SAM_API_KEY` or `DATA_SOURCE=mock` (mock avoids SAM.gov rate
   limits during testing).

2. **Make sure port 3000 is free.** Run `lsof -i :3000`. If a stale node
   process is already listening, `kill` it before starting a new one —
   otherwise the new server fails with `EADDRINUSE` and every request
   below will hit the old process's behavior instead of the one under
   test.

3. **Start the dev server:** `npm run dev:web`.

4. **Run one curl per intent**, each as a single line (a line break
   inside the quoted JSON string breaks the shell's quoting):

   ```bash
   curl -s -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"What transit agency grants are open right now?"}]}' | jq
   curl -s -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"Is a tribal government eligible for highway planning funds?"}]}' | jq
   curl -s -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"What'\''s due in the next 30 days?"}]}' | jq
   curl -s -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"Tell me about CFDA 20.205"}]}' | jq
   curl -s -X POST http://localhost:3000/api/chat -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"Hi, what can you help with?"}]}' | jq
   ```

5. **Check each response's `toolCalls`** against the intent → tool
   mapping in `src/web/chat/types.ts` (`INTENT_TOOLS`):
   - search → only `search_dot_grants` / `get_grant_details`
   - eligibility → only `check_eligibility` / `get_grant_details`
   - deadlines → only `track_upcoming_deadlines`
   - details → only `get_grant_details`
   - general → `toolCalls: []` (no tool calls at all — retrieval is
     skipped entirely for this intent)

6. **Cross-check the dev server's log output** for `[INFO] Retrieval tool
   call: ...` lines — these should match the `toolCalls` seen in each
   response.

7. **Report results per intent**: pass/fail, and call out anything that
   called an out-of-scope tool, returned a 500, or returned an empty
   reply. If something fails, check the dev server's terminal for the
   stack trace (a clean `npm run build` first rules out a TypeScript
   issue vs. a runtime one).
