# WebMCP Architecture

## Overview

WebMCP is a three-interface system providing DOT grant search tools via:
1. **MCP Server** - For AI assistants like Claude Code/Desktop (stdio protocol)
2. **Web Interface** - Structured HTML forms for direct browser access
3. **Chat Interface** - A natural-language chat box on the website itself (`/chat.html`), backed server-side by the Anthropic Messages API using the exact same tools as the MCP server — so website visitors without an MCP client get the same conversational experience Claude Code users get.

## System Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                            User Interfaces                            │
├──────────────────────┬──────────────────────┬─────────────────────────┤
│  Claude/MCP Clients  │   Web Browsers (UI)   │  Web Browsers (Chat)   │
│  (stdio protocol)    │   http://localhost:3000│  POST /api/chat        │
└──────────┬───────────┴───────────┬───────────┴────────────┬───────────┘
           │                       │                        │
           v                       v                        v
   ┌───────────────┐      ┌─────────────────┐     ┌──────────────────────┐
   │  MCP Server   │      │  Express Web    │     │  Chat Route           │
   │  (stdio)      │      │  Server (HTTP)  │     │  src/web/routes/chat  │
   │  src/index.ts │      │  src/web-index  │     │  (calls Anthropic SDK)│
   └───────┬───────┘      └────────┬────────┘     └───────────┬───────────┘
           │                       │                          │
           │              ┌────────┴──────────┐               │
           │              v                   │               v
           │   ┌─────────────────────┐        │   (same tool schema +
           │   │ src/mcp/tool-schemas │        │    dispatch, invoked by
           │   │ src/mcp/tool-executor│◄───────┼────Claude's tool_use)
           │   └──────────┬───────────┘        │
           └──────────────┤                    │
                           v                    │
                ┌──────────────────────┐        │
                │    Core Tools        │◄───────┘
                │  src/tools/*.ts      │
                │  - search-grants     │
                │  - grant-details     │
                │  - eligibility       │
                │  - deadlines         │
                └──────────┬───────────┘
                           │
            ┌──────────────┼──────────────┐
            v              v              v
       ┌─────────┐  ┌──────────┐  ┌──────────┐
       │SAM.gov  │  │Mock Data │  │ Cache    │
       │API      │  │Local XML │  │ Manager  │
       └─────────┘  └──────────┘  └──────────┘
```

## Components

### 1. MCP Server (`src/index.ts`, `src/server.ts`)

**Purpose**: Exposes tools to AI assistants via Model Context Protocol

**Protocol**: stdio-based communication
**Tools Exposed** (schema/dispatch shared with the chat interface via `src/mcp/tool-schemas.ts` and `src/mcp/tool-executor.ts` — see component 4 below):
- `search_dot_grants` - Search opportunities
- `get_grant_details` - Get detailed information
- `check_eligibility` - Check qualification
- `track_upcoming_deadlines` - Monitor deadlines

**Usage**: 
```bash
npm start
# MCP clients connect via stdio
```

### 2. Web Server (`src/web-index.ts`, `src/web/api-server.ts`)

**Purpose**: HTTP REST API + static file serving

**Endpoints**:
- `GET /` - Homepage
- `GET /search.html` - Search interface
- `GET /eligibility.html` - Eligibility checker
- `GET /deadlines.html` - Deadline timeline
- `GET /details.html` - Grant details
- `GET /chat.html` - Natural-language chat box
- `GET /api/grants/search` - Search API
- `GET /api/grants/details` - Details API
- `GET /api/eligibility/check` - Eligibility API
- `GET /api/deadlines` - Deadlines API
- `POST /api/chat` - Chat API (rate-limited separately, see component 4)
- `GET /api/health` - Health check

**Usage**:
```bash
npm run start:web
# Visit http://localhost:3000
```

### 3. Core Tools (`src/tools/*.ts`)

**Shared Logic**: The MCP server, the web API routes, and the chat route all call these functions

**Design Principle**: Write once, use everywhere
- MCP server imports and calls them directly (via `src/mcp/tool-executor.ts`)
- Web API routes import and call them directly
- The chat route calls them too, via the same `tool-executor.ts` dispatch Claude's `tool_use` responses trigger
- Zero duplication of business logic

**Files**:
- `search-grants.ts` - Opportunity search with filters
- `grant-details.ts` - Comprehensive grant information
- `eligibility.ts` - Qualification checking
- `deadlines.ts` - Deadline tracking and sorting

### 4. Chat Interface (`src/web/routes/chat.ts`, `src/clients/anthropic-client.ts`, `src/mcp/tool-schemas.ts`, `src/mcp/tool-executor.ts`)

**Purpose**: Lets website visitors ask grant questions in plain English without an MCP client, via `POST /api/chat`

**How it works**:
- `src/mcp/tool-schemas.ts` exports the 4 tool schemas (name/description/input schema) shared with the MCP server
- `src/mcp/tool-executor.ts` exports `executeTool(name, args)` — validates args with the same Zod schemas as the web/MCP routes and dispatches to the matching function in `src/tools/*.ts`
- `chat.ts` runs a bounded agentic loop (max 5 iterations) against the Anthropic Messages API: send the conversation + tool schemas, execute any `tool_use` blocks via `executeTool()`, feed results back, repeat until Claude replies with text
- The Anthropic API key never reaches the browser — all calls happen server-side

**Guardrails**:
- `ANTHROPIC_API_KEY` is optional at startup (unlike `SAM_API_KEY`) — if unset, every other page keeps working and only `/api/chat` returns a 503
- A dedicated rate limiter (`CHAT_RATE_LIMIT_REQUESTS`/`CHAT_RATE_LIMIT_WINDOW_MS`, default 10 req/min per IP) protects against runaway Anthropic spend, separate from the SAM.gov rate limit

**See also**: [MCP_REQUEST_FLOW.md](./MCP_REQUEST_FLOW.md) for a step-by-step trace, and [plan_1.md](./plan_1.md) for the original design.

### 5. API Clients (`src/clients/*.ts`)

**SAM Opportunities Client** (`sam-opportunities.ts`):
- Searches DOT opportunities via SAM.gov API
- Implements rate limiting and caching
- Falls back to mock/local data when configured

**SAM Assistance Client** (`sam-assistance.ts`):
- Fetches program details and eligibility rules
- Uses CFDA codes (e.g., 20.205)
- Caches for 7 days (programs change slowly)

**Anthropic Client** (`anthropic-client.ts`):
- Singleton Anthropic SDK client used only by the chat route
- Lazily constructed so apps without `ANTHROPIC_API_KEY` set never try to initialize it

### 5. Data Sources

**Three modes** (configured via `DATA_SOURCE` env var):

**api** - Live SAM.gov API (default for production)
```bash
DATA_SOURCE=api
```
- Real-time data
- 100 requests/day limit
- 6-hour cache

**mock** - Built-in sample data (default for development)
```bash
DATA_SOURCE=mock
```
- 5 sample DOT grants
- Eligibility rules for all 6 applicant types
- No API calls, no rate limits
- Perfect for testing

**local** - Downloaded XML extract (experimental)
```bash
DATA_SOURCE=local
```
- Daily XML download from Grants.gov
- No API limits
- Requires running `npm run update-grants`

### 6. Cache Manager (`src/cache/cache-manager.ts`)

**Features**:
- File-based caching in `.cache/` directory
- TTL-based expiration (6 hours for opportunities, 7 days for programs)
- Rate limit tracking (24-hour rolling window)
- Separate namespaces (sam_opportunities, sam_assistance)

**Reduces**:
- API calls by 80%+ for repeated queries
- Response times from 500ms to <10ms

### 7. Web Frontend (`public/`)

**Stack**: Vanilla HTML/CSS/JavaScript (no build step)

**Pages**:
- `index.html` - Homepage with feature cards
- `search.html` - Search form with filters
- `eligibility.html` - Eligibility checker
- `deadlines.html` - Timeline visualization
- `details.html` - Detailed grant view
- `chat.html` - Natural-language chat box (talks to `POST /api/chat`)

**JavaScript**:
- `api.js` - Centralized API client
- `common.js` - Utilities (formatting, errors, markdown rendering for chat replies)
- `search.js` - Search page logic
- `eligibility.js` - Eligibility page logic
- `deadlines.js` - Timeline rendering
- `details.js` - Details page rendering
- `chat.js` - Chat page logic (maintains client-side message history)

**CSS**:
- `style.css` - Complete styling, responsive design

## Data Flow

### Example: User Searches for Grants

**Web Interface Flow**:
```
Browser (search.html)
  → form submit
  → public/js/search.js
  → fetch('/api/grants/search?applicantType=state')
  → Express route (src/web/routes/grants.ts)
  → searchDOTGrants() (src/tools/search-grants.ts)
  → Check cache first
  → If not cached: SAM Opportunities Client
  → SAM.gov API or Mock Data
  → Filter and sort results
  → Cache for 6 hours
  → Return JSON to browser
  → Render as cards
```

**MCP Interface Flow**:
```
Claude Code
  → MCP request: search_dot_grants
  → MCP Server (src/server.ts)
  → searchDOTGrants() (src/tools/search-grants.ts)
  → Same logic as web interface
  → Return structured results to Claude
```

**Chat Interface Flow** (website visitor, no MCP client needed):
```
Browser (chat.html)
  → form submit
  → public/js/chat.js
  → fetch POST /api/chat with full message history
  → Express route (src/web/routes/chat.ts)
  → Anthropic Messages API decides to call search_dot_grants
  → executeTool() (src/mcp/tool-executor.ts)
  → searchDOTGrants() (src/tools/search-grants.ts)
  → Same logic as web interface and MCP server
  → Tool result fed back to Anthropic API
  → Claude synthesizes a natural-language reply
  → Return { reply } JSON to browser
```

## Configuration

### Environment Variables

**Required**:
- `SAM_API_KEY` - SAM.gov API key (only needed if DATA_SOURCE=api)

**Optional**:
- `DATA_SOURCE` - Data mode: api, mock, or local (default: mock)
- `WEB_PORT` - Web server port (default: 3000)
- `LOG_LEVEL` - Logging verbosity (default: info)
- `CACHE_DIR` - Cache directory (default: .cache)
- `SAM_RATE_LIMIT_REQUESTS` - Daily limit (default: 100)
- `CORS_ORIGINS` - Allowed origins (default: *)
- `ANTHROPIC_API_KEY` - Required only for the chat feature (`/chat.html`); every other page and the MCP server work without it
- `ANTHROPIC_MODEL` - Model used for chat (default: `claude-sonnet-5`)
- `ANTHROPIC_MAX_TOKENS` - Max tokens per chat response (default: 1024)
- `CHAT_RATE_LIMIT_REQUESTS` / `CHAT_RATE_LIMIT_WINDOW_MS` - Rate limit on `/api/chat` (default: 10 requests/60s per IP)

### Checking Your Configuration

Settings are read from `.env` at startup — see `.env.example` for every supported variable and its default. There's no persisted "current configuration" snapshot in this doc (it would just go stale); check your own `.env` or hit `GET /api/health` for the live rate-limit/cache status.

## Key Design Decisions

### 1. Three-Interface Architecture
**Why**: MCP for AI assistants with an MCP client, a chat box for website visitors without one, forms for everyone else
**Benefit**: All three reuse the same core tool logic, so behavior stays consistent

### 2. Mock Data Default
**Why**: SAM.gov API has 100/day limit
**Benefit**: Unlimited testing and development

### 3. File-Based Caching
**Why**: Simple, no database needed
**Benefit**: Easy to clear, inspect, and debug

### 4. No Build Step for Frontend
**Why**: Keep it simple for grant applicants
**Benefit**: Easy to customize and deploy

### 5. Shared Tool Functions
**Why**: DRY principle
**Benefit**: Fix bugs once, all three interfaces benefit

### 6. Anthropic Key is Optional, Checked Lazily
**Why**: Unlike `SAM_API_KEY` (required at startup), `ANTHROPIC_API_KEY` is only needed for `/api/chat`
**Benefit**: Deployments that don't want the chat feature (or haven't set up billing for it) still get a fully working site

## Performance

**Typical Response Times**:
- Cached queries: <10ms
- API queries: 300-500ms
- Mock data: <5ms

**Cache Hit Rate**: 80%+ for repeated searches

**Rate Limiting**: 100 requests/day (SAM.gov free tier)

## Security Considerations

- API keys stored in `.env` (not committed)
- CORS configured for localhost in development
- Input validation using Zod schemas
- Error messages don't expose internal details
- No authentication (public data only)
- Chat (`/api/chat`): the Anthropic API key is only ever used server-side and never sent to the browser; the route has its own rate limiter separate from the SAM.gov one; the Anthropic SDK error details are caught and reformatted before reaching the client, same as other routes

## Deployment Architecture

**Development**:
```
localhost:3000 (web)
stdio (MCP)
```

**Production Options**:
1. **Single Server**: Run both MCP and Web
2. **Separate Services**: Deploy web separately
3. **Static + API**: Host frontend on CDN, API on server

## Monitoring

**Health Check**: `GET /api/health`
Returns:
- Server status
- Rate limit usage
- Cache status
- API availability

**Logs**: Console output via Winston logger
- Request logging (HTTP and MCP)
- Error tracking
- API call monitoring
- Cache hit/miss tracking

## Future Enhancements

- Database instead of file cache
- User accounts and saved searches
- Email alerts for deadlines
- Advanced filtering (geographic, categories)
- GraphQL API option
- WebSocket for real-time updates
