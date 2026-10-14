# How WebMCP is Utilized

## Overview

WebMCP (Web Model Context Protocol) provides DOT grant search capabilities through three interfaces:

1. **MCP Server** - For AI assistants with an MCP client (Claude Code, Claude Desktop)
2. **Web Interface** - For direct human use (search/eligibility/deadlines/details forms)
3. **Chat Box** (`/chat.html`) - Natural-language chat for website visitors who don't have an MCP client; backed server-side by the Anthropic Messages API calling the exact same tool functions described below

This document explains how the **MCP server** is utilized by AI assistants.
Everything here about available tools and what Claude can do with them
applies equally to the chat box — it's the same tools, just reached over
HTTP instead of stdio. See [ARCHITECTURE.md](./ARCHITECTURE.md#4-chat-interface-srcwebroutes-chatts-srcclientsanthropic-clientts-srcmcptool-schemasts-srcmcptool-executorts)
for how that path works.

## What is MCP (Model Context Protocol)?

MCP is a protocol that allows AI assistants to:
- Access external tools and data sources
- Execute functions on your behalf
- Integrate with local and remote systems

Think of it as **giving Claude superpowers** - instead of just generating text, Claude can now search real DOT grant databases, check eligibility, and track deadlines.

## How Claude Uses WebMCP

### Interaction Flow

```
You: "Find highway grants for state DOTs over $10 million"
  ↓
Claude recognizes this requires grant search
  ↓
Claude calls: search_dot_grants
  Parameters: {
    applicantType: "state",
    keywords: "highway", 
    minAmount: 10000000
  }
  ↓
WebMCP Server searches SAM.gov (or mock data)
  ↓
Returns: 3 matching grants
  ↓
Claude presents results in natural language:
  "I found 3 highway grants for states over $10M:
   1. Highway Planning - $50M - Due Dec 31
   2. Interstate Improvement - $25M - Due Nov 15
   3. ..."
```

### Available MCP Tools

Claude has access to 4 tools:

#### 1. `search_dot_grants`
**What Claude can do**:
- "Find transit grants for cities"
- "Search for grants closing this month"
- "Show me infrastructure opportunities over $5 million"
- "Find grants with keyword 'bridge repair'"

**How it works**:
```javascript
{
  tool: "search_dot_grants",
  parameters: {
    applicantType: "city",        // Filters by org type
    minAmount: 5000000,           // Minimum grant size
    keywords: "bridge repair",    // Search terms
    deadlineBefore: "2026-12-31"  // Date filter
  }
}
```

**Returns**: Array of grant opportunities with titles, amounts, deadlines, descriptions

#### 2. `get_grant_details`
**What Claude can do**:
- "Tell me more about Highway Planning program 20.205"
- "What are the details for grant MOCK-DOT-001?"
- "Explain the INFRA grant program"

**How it works**:
```javascript
{
  tool: "get_grant_details",
  parameters: {
    programNumber: "20.205"  // CFDA code
    // OR
    opportunityId: "MOCK-DOT-001"  // SAM.gov notice ID
  }
}
```

**Returns**: Comprehensive program details including eligibility, requirements, contacts, funding amounts

#### 3. `check_eligibility`
**What Claude can do**:
- "Can tribal governments apply for DOT grants?"
- "Am I eligible for INFRA grants as a city?"
- "What programs accept MPO applications?"

**How it works**:
```javascript
{
  tool: "check_eligibility",
  parameters: {
    applicantType: "tribal",           // Required
    programNumber: "20.205"            // Optional: specific program
  }
}
```

**Returns**: Array of eligibility results showing which programs accept that applicant type, with reasoning

#### 4. `track_upcoming_deadlines`
**What Claude can do**:
- "What grant deadlines are coming up?"
- "Show me deadlines in the next 60 days for transit agencies"
- "Which grants are closing soon?"

**How it works**:
```javascript
{
  tool: "track_upcoming_deadlines",
  parameters: {
    daysAhead: 60,              // Look ahead 60 days
    applicantType: "transit_agency"  // Optional filter
  }
}
```

**Returns**: Grants sorted by deadline (soonest first) with countdown information

## Real-World Usage Examples

### Example 1: Grant Discovery Conversation

**You**: "I work for a tribal government. What grants are available?"

**Claude**:
1. Calls `check_eligibility` with `applicantType: "tribal"`
2. Gets list of eligible programs
3. Calls `search_dot_grants` with `applicantType: "tribal"`
4. Gets current opportunities
5. Responds: "As a tribal government, you're eligible for 12 DOT programs. Here are the 3 active opportunities right now: ..."

### Example 2: Deadline Management

**You**: "What's the deadline for the INFRA grant?"

**Claude**:
1. Calls `search_dot_grants` with `keywords: "INFRA"`
2. Finds INFRA grant notice
3. Extracts deadline
4. Responds: "The INFRA grant (notice MOCK-DOT-001) deadline is January 15, 2027. That's 100 days from now."

### Example 3: Strategic Planning

**You**: "Help me plan our grant applications for Q1 2027"

**Claude**:
1. Calls `check_eligibility` for your org type
2. Calls `track_upcoming_deadlines` for next 90 days
3. Calls `get_grant_details` for top matches
4. Creates prioritized list with:
   - Eligibility status
   - Funding amounts
   - Application complexity
   - Deadline urgency
   - Strategic fit

### Example 4: Research Questions

**You**: "Compare Federal Transit Capital Investment vs Formula Grants"

**Claude**:
1. Calls `get_grant_details` for program 20.500 (Capital Investment)
2. Calls `get_grant_details` for program 20.507 (Formula Grants)
3. Analyzes differences
4. Responds with comparison table covering:
   - Eligibility differences
   - Competitive vs formula funding
   - Typical award sizes
   - Application processes

## Benefits of MCP Integration

### For Users

**Before MCP**:
- Manual search on SAM.gov
- Copy/paste program numbers
- Spreadsheet tracking
- Missing deadlines

**With MCP**:
- Natural language questions
- Instant eligibility checks
- Automatic deadline monitoring
- Contextual recommendations

### For AI Assistants (Claude)

**Capabilities Unlocked**:
- Access to real-time DOT grant data
- Accurate, current information (not training data)
- Structured search and filtering
- Eligibility rule checking
- Deadline tracking

**Better than Web Search**:
- Structured data (not just text)
- Consistent format
- Validated eligibility rules
- Cached for speed
- No hallucination of grant details

## Technical Implementation

### How MCP Server Works

**1. Server Startup**:
```bash
npm start
# Starts stdio-based MCP server
# Registers 4 tools with Claude
```

**2. Claude Connection**:
- Claude Code detects MCP server via config
- Connects via stdio (standard input/output)
- Loads tool definitions

**3. Tool Invocation**:
```
Claude decides to use a tool
  ↓
Sends JSON-RPC request via stdio:
  {
    "method": "tools/call",
    "params": {
      "name": "search_dot_grants",
      "arguments": { "applicantType": "state" }
    }
  }
  ↓
MCP Server receives request
  ↓
Validates parameters (Zod schemas)
  ↓
Calls tool function (src/tools/search-grants.ts)
  ↓
Tool queries SAM.gov API (with caching)
  ↓
Returns structured results
  ↓
MCP Server sends JSON-RPC response
  ↓
Claude receives data and formulates answer
```

### Data Flow

```
AI Assistant (Claude)
        ↕ stdio (JSON-RPC)
    MCP Server
        ↕
  Tool Functions
        ↕
    API Clients
        ↕
   ┌────┴─────┬─────────┐
   ↓          ↓         ↓
SAM.gov    Cache    Mock Data
```

### Configuration

**MCP Client Config** (in Claude Code):
```json
{
  "mcpServers": {
    "dot-grants": {
      "command": "node",
      "args": ["/path/to/webmcp/dist/index.js"],
      "env": {
        "SAM_API_KEY": "your-key",
        "DATA_SOURCE": "mock"
      }
    }
  }
}
```

## Checking Your Configuration

Settings are read from `.env` at startup — see `.env.example` for every
supported variable and its default (`DATA_SOURCE` defaults to `mock`). To
check what's actually active, hit `GET /api/health` on the web server or
inspect your own `.env`.

### Available Data

**Mock Mode** (the default):
- 5 sample DOT grants
- Full eligibility rules for 6 applicant types
- No API rate limits
- Instant responses (<5ms)

**To Switch to Real Data**:
```bash
# Edit .env
DATA_SOURCE=api

# Restart MCP server
npm start
```

### Testing the MCP Server

**Method 1: Through Claude Code**

In Claude Code, type:
```
Search for transit grants over $1 million
```

Claude will automatically use the `search_dot_grants` tool.

**Method 2: Direct Tool Call**

In Claude Code, you can also request specific tool usage:
```
Use the check_eligibility tool to see what a city can apply for
```

**Method 3: Complex Queries**

```
I'm a state DOT looking for highway funding. 
Show me what's available, check eligibility, 
and prioritize by deadline.
```

Claude will orchestrate multiple tool calls.

## Advantages Over Web Interface

### MCP Server Benefits

**1. Natural Language**: 
- No form filling
- Conversational interaction
- Context-aware follow-ups

**2. Multi-Step Workflows**:
- Claude orchestrates multiple tools
- Remembers context across questions
- Builds on previous results

**3. Analysis and Synthesis**:
- Compares multiple grants
- Prioritizes by criteria
- Explains complex requirements
- Provides strategic recommendations

**4. Automation Potential**:
- Schedule regular deadline checks
- Monitor new opportunities
- Alert on relevant grants
- Track application status

### When to Use Each Interface

**Use MCP (Claude Code/Desktop)**:
- Research questions
- Strategic planning
- Complex queries
- Comparing options
- Need explanations
- Ongoing dialogue

**Use the Chat Box (`/chat.html`)**:
- Same conversational style as MCP, but you're a website visitor without
  an MCP client set up

**Use Web Interface**:
- Quick lookup
- Browsing opportunities
- Sharing with team
- Printing details
- Visual timeline
- Direct application access

## Future MCP Enhancements

**Planned Features**:

1. **Saved Searches**
   ```javascript
   tool: "save_search",
   parameters: {
     name: "City Infrastructure Grants",
     filters: { applicantType: "city", keywords: "infrastructure" }
   }
   ```

2. **Deadline Alerts**
   ```javascript
   tool: "set_deadline_alert",
   parameters: {
     opportunityId: "...",
     notifyDays: 14
   }
   ```

3. **Application Tracking**
   ```javascript
   tool: "track_application",
   parameters: {
     opportunityId: "...",
     status: "in_progress",
     dueDate: "2027-01-15"
   }
   ```

4. **Historical Awards**
   ```javascript
   tool: "search_past_awards",
   parameters: {
     programNumber: "20.205",
     year: 2025
   }
   ```

## Troubleshooting MCP Connection

### Common Issues

**1. Tool Not Found**
- **Problem**: Claude says "I don't have access to that tool"
- **Solution**: Check MCP server is running (`npm start`)

**2. Connection Error**
- **Problem**: "Failed to connect to MCP server"
- **Solution**: Verify `dist/index.js` exists (run `npm run build`)

**3. Invalid Parameters**
- **Problem**: Tool returns validation error
- **Solution**: Claude misunderstood request; rephrase more clearly

**4. Rate Limit Error**
- **Problem**: "Rate limit exceeded"
- **Solution**: Switch to mock data or wait for quota reset

### Verification

**Check MCP Server is Running**:
```bash
ps aux | grep "node.*index.js"
```

**Check Logs**:
```bash
# Server logs show tool calls
LOG_LEVEL=debug npm start
```

**Test Tool Directly**:

Through Claude Code:
```
Test the search_dot_grants tool with applicant type "state"
```

## Summary

WebMCP's MCP server transforms Claude from a text generator into a **grant research assistant** with:

- **Real-time access** to DOT grant data
- **Structured search** capabilities
- **Eligibility verification** 
- **Deadline monitoring**
- **Natural language** interface
- **Context-aware** assistance

The combination of the MCP server (for AI assistants), the chat box (for
conversational access without an MCP client), and the web interface (for
direct human use) provides **the best of all worlds** - conversational AI
assistance wherever you are, direct access when you prefer it.
