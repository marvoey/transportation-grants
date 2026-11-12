# DOT Grants MCP Server

A Model Context Protocol (MCP) server that provides tools for U.S. Department of Transportation (DOT) grant applicants to search opportunities, check eligibility, and track deadlines.

## Features

- **Search Grant Opportunities**: Find DOT grants by applicant type, funding amount, keywords, and deadlines
- **Get Grant Details**: Retrieve comprehensive information about specific programs and opportunities
- **Check Eligibility**: Determine if your organization qualifies for DOT grant programs
- **Track Deadlines**: Monitor upcoming grant deadlines to stay on top of applications

## Supported Applicant Types

- **State**: State governments and state agencies
- **City**: Cities, municipalities, and townships
- **County**: County governments
- **Tribal**: Federally recognized tribal governments and Native American organizations
- **MPO**: Metropolitan Planning Organizations and regional planning organizations
- **Transit Agency**: Public transit systems and transportation authorities

## Prerequisites

- Node.js 18 or higher
- SAM.gov API key (free)

## Installation

### 1. Clone or Download

```bash
cd /path/to/webmcp
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Get SAM.gov API Key

1. Visit [SAM.gov API](https://open.gsa.gov/api/get-opportunities-public-api/)
2. Create a free account at SAM.gov if you don't have one
3. Navigate to your profile settings
4. Copy your API key from the API section

### 4. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your SAM.gov API key:

```bash
SAM_API_KEY=your_actual_api_key_here
```

### 5. Build the Project

```bash
npm run build
```

## Usage

### Running the Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

### NOFO applicant assessment (chat page, "Assess a project")

Pick an already-ingested funding opportunity, describe a transportation project, and get a preliminary, source-cited read of what the notice means for you. Operator setup (`npm run nofo:ingest`, `npm run nofo:extract`), the demo script and known limitations are in [docs/NOFO_DEMO.md](docs/NOFO_DEMO.md); the design is in [docs/NOFO_MVP_PLAN.md](docs/NOFO_MVP_PLAN.md).

### MCP Tools

The server exposes four MCP tools:

#### 1. `search_dot_grants`

Search for DOT grant opportunities with optional filters.

**Parameters:**
- `applicantType` (optional): `state`, `city`, `county`, `tribal`, `mpo`, or `transit_agency`
- `minAmount` (optional): Minimum grant amount in dollars
- `maxAmount` (optional): Maximum grant amount in dollars
- `keywords` (optional): Keywords to search in titles and descriptions
- `deadlineAfter` (optional): ISO date or MM/DD/YYYY
- `deadlineBefore` (optional): ISO date or MM/DD/YYYY

**Example:**
```
Search for transit agency grants over $1 million
```

#### 2. `get_grant_details`

Get comprehensive details about a specific grant program or opportunity.

**Parameters:**
- `opportunityId` (optional): SAM.gov notice ID
- `programNumber` (optional): CFDA code (e.g., "20.205")

**Note:** Provide either `opportunityId` OR `programNumber`.

**Example:**
```
Get details for program 20.205 (Highway Planning and Construction)
```

#### 3. `check_eligibility`

Check if an applicant type is eligible for DOT programs.

**Parameters:**
- `applicantType` (required): `state`, `city`, `county`, `tribal`, `mpo`, or `transit_agency`
- `opportunityId` (optional): Check specific opportunity
- `programNumber` (optional): Check specific program (CFDA code)

**Example:**
```
Check if tribal governments are eligible for DOT grants
```

#### 4. `track_upcoming_deadlines`

List grants with upcoming deadlines, sorted by deadline (soonest first).

**Parameters:**
- `daysAhead` (optional): Number of days to look ahead (default: 30, max: 365)
- `applicantType` (optional): Filter by applicant type

**Example:**
```
Show grant deadlines in the next 60 days for MPOs
```

## Data Sources

The server uses three official U.S. government APIs:

1. **SAM.gov Opportunities API** - Active grant opportunities
2. **SAM.gov Assistance Listings API** - Program details and eligibility (DOT code: 6900)
3. **USASpending.gov API** - Historical awards data (DOT code: 069)

## Caching

The server implements intelligent caching to respect API rate limits:

- **Assistance Listings**: 7-day cache (programs change infrequently)
- **Opportunities**: 6-hour cache (updated frequently)
- **Rate Limit Tracking**: 24-hour rolling window

Cached data is stored in `.cache/` directory.

## Configuration

All configuration options are available via environment variables (see `.env.example`):

- `SAM_API_KEY` - **Required**: Your SAM.gov API key
- `SAM_RATE_LIMIT_REQUESTS` - Max requests per day (default: 100)
- `CACHE_DIR` - Cache directory location (default: `.cache`)
- `LOG_LEVEL` - Logging verbosity: `debug`, `info`, `warn`, `error` (default: `info`)

## Common DOT Grant Programs

- **20.205** - Highway Planning and Construction (Federal-Aid Highway Program)
- **20.500** - Federal Transit Capital Investment Grants
- **20.507** - Federal Transit Formula Grants
- **20.106** - Airport Improvement Program
- **20.600** - State and Community Highway Safety

## Troubleshooting

### API Key Errors

```
Error: SAM_API_KEY environment variable is required
```

**Solution:** Add your SAM.gov API key to `.env` file.

### Rate Limit Exceeded

```
Rate limit exceeded: 100/100 requests used. Resets in X minutes.
```

**Solution:** Wait for the rate limit window to reset, or upgrade your SAM.gov account for higher limits.

### Network Errors

```
Unable to connect to SAM.gov API
```

**Solution:** Check your internet connection and verify SAM.gov APIs are accessible.

## Development

### Project Structure

```
webmcp/
├── src/
│   ├── index.ts              # Server entry point
│   ├── server.ts             # MCP server setup
│   ├── config/               # Configuration and constants
│   ├── clients/              # API clients
│   ├── cache/                # Caching layer
│   ├── tools/                # MCP tool implementations
│   ├── types/                # TypeScript types
│   └── utils/                # Utilities (errors, validators)
├── .env.example              # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

### Testing

Run the server in development mode:

```bash
npm run dev
```

Test with Claude Code or any MCP client that can invoke:
- `search_dot_grants`
- `get_grant_details`
- `check_eligibility`
- `track_upcoming_deadlines`

### Linting and Formatting

```bash
npm run lint
npm run format
```

## License

MIT

## Support

For issues with:
- **This server**: Open an issue in this repository
- **SAM.gov APIs**: Visit [SAM.gov API support](https://open.gsa.gov/api/get-opportunities-public-api/)
- **Grant programs**: Contact the DOT agency office listed in grant details

## Documentation

The project documents are in [`docs/`](docs/) and are also served in the web app at `/docs`.

- **[NOFO_MVP_PLAN.md](docs/NOFO_MVP_PLAN.md)** - The audit, architecture, risks and a record of every change to the NOFO assessment work
- **[NOFO_DEMO.md](docs/NOFO_DEMO.md)** - How to run the demo, including demo mode (a replayed recording)
- **[NOFO_FACT_SHEETS.md](docs/NOFO_FACT_SHEETS.md)** and **[NOFO_TEST_PROJECTS.md](docs/NOFO_TEST_PROJECTS.md)** - The prepared grants and the sample projects used to test them
- **[BigBuild3_GrantFlow_ConOps.md](docs/BigBuild3_GrantFlow_ConOps.md)** - The concept of operations for the consultation
- **[GrantFlow_BigBuild_Live_App_Demo_Script.md](docs/GrantFlow_BigBuild_Live_App_Demo_Script.md)** - The timed demo script (shown in the presenter window)

## Web Interface

In addition to the MCP server, this project includes a **web interface** for direct browser access:

```bash
npm run start:web
# Visit http://localhost:3000
```

The web interface provides:
- **Search Grants** - Find opportunities with filters
- **Check Eligibility** - Verify qualification for programs
- **Track Deadlines** - Monitor upcoming due dates  
- **Grant Details** - Comprehensive program information

See [NOFO_DEMO.md](docs/NOFO_DEMO.md) for how to run the demo.

## Resources

- [DOT Grants Portal](https://www.transportation.gov/grants)
- [SAM.gov](https://sam.gov/)
- [Grants.gov](https://www.grants.gov/)
- [USASpending.gov](https://www.usaspending.gov/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
