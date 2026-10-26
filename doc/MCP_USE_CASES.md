# Why the MCP server, given the web interface is already public

This project exposes grant tools three ways (see
[ARCHITECTURE.md](./ARCHITECTURE.md)): an MCP server (`src/index.ts`,
`src/server.ts`) for MCP clients, structured HTML forms, and a chat box —
the latter two both served over plain HTTP by the Express web app. Since
the web interface is already public and requires no special client, it's
worth asking what the MCP server actually buys on top of that. Three
concrete reasons:

## 1. Different audience and workflow context

Someone already working inside Claude Desktop or Claude Code — e.g. a
grant writer researching options while drafting their application — can
look up grants, eligibility, and deadlines without leaving their AI
assistant or switching to a browser tab. More importantly, in that
session they can combine this project's tools with *other* MCP servers or
local files Claude also has access to (their own org's documents, a
calendar server, etc.) — something the isolated public web chat can't do,
since it only has these 4 tools and nothing else.

## 2. Who pays for the LLM calls

This is the most concrete difference. The public web chat's Claude calls
are billed to *this project's* `ANTHROPIC_API_KEY` — that's exactly why
`src/web/routes/chat.ts` has its own rate limiter
(`CHAT_RATE_LIMIT_REQUESTS`/`CHAT_RATE_LIMIT_WINDOW_MS`, default
10 requests/min per IP) to cap the site owner's Anthropic spend.

MCP usage via someone's own Claude Desktop/Code is billed to *their*
Claude subscription instead — the MCP server itself only returns tool
data (grant search results, eligibility checks, etc.); no LLM call happens
on the project's side at all in that path. So MCP access scales to any
number of users at zero marginal cost to the project owner, while the web
chat does not.

## 3. No deployment required

A developer with just the repo can run `npm start` and get full tool
access through their own Claude client, without needing the Express web
server (`npm run start:web`) running or deployed anywhere.

## Summary

The MCP server isn't redundant with the public web interface — it's a
separate, free-to-operate channel for people already working inside an AI
assistant, while the web interface (forms or chat) is the channel for
anyone with just a browser and no MCP client.
