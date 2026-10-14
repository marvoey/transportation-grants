# SAM.gov Get Opportunities API Guide

## Current Implementation

Your system uses the **Get Opportunities v2 API** at:
```
https://api.sam.gov/opportunities/v2/search
```

## API Parameters Being Used

### Required Parameters
- `api_key` - Your SAM.gov API key
- `postedFrom` - Start date (MM/DD/YYYY format)
- `postedTo` - End date (MM/DD/YYYY format)

### Optional Parameters
- `limit` - Max results per request (default: 100, max: 1000)
- `offset` - Pagination offset (default: 0)
- `keyword` - Search term (e.g., "highway", "transit")

## Current Search Flow

1. **Date Range**: System searches from 1 year back to 6 months ahead
2. **Keyword**: Passes your search term (e.g., "highway")
3. **Filtering**: After fetching, filters for DOT grants only
4. **Caching**: Results cached for 6 hours

## Rate Limits

**Free/Public Account**: 100 requests per day
**Federal Account**: 1,000 requests per day

Quota resets on a rolling 24-hour window — check `GET /api/health` for your
current usage and reset time rather than a point-in-time snapshot here.

## How to Get More Data

### Option 1: Adjust Date Range (Reduce API Calls)
Edit: `src/clients/sam-opportunities.ts` (the `daysBack`/`daysAhead` defaults,
currently around line 213)

```typescript
// Current (searches 1 year back + 90 days ahead)
const { daysBack = 365, daysAhead = 90, keywords: keyword, limit = 100 } = params;

// Narrow to 90 days total (saves API calls)
const { daysBack = 60, daysAhead = 30, keywords: keyword, limit = 100 } = params;
```

### Option 2: Increase Limit Per Request
Currently fetching 100 results max. SAM.gov allows up to 1,000:

```typescript
// Change limit from 100 to 1000
limit: 1000  // instead of 100
```

### Option 3: Use Pagination
For more than 1,000 results, use offset:

```typescript
// First 1000 results
{ limit: 1000, offset: 0 }

// Next 1000 results
{ limit: 1000, offset: 1000 }
```

### Option 4: Mock Mode for Development (already implemented)
Set `DATA_SOURCE=mock` in `.env` — this is the default. It serves 5 sample
DOT grants from `src/data/mock-data.ts` with no API calls and no rate
limits. Great for development and demos; see `src/data/mock-data.ts` to add
or edit sample grants.

### Option 5: Local XML Extract (already implemented, no API key needed)
Set `DATA_SOURCE=local` in `.env`, then run:
```bash
npm run build
npm run update-grants
```
This downloads SAM.gov's daily `GrantsDBExtractYYYYMMDDv2.zip` from
`https://www.grants.gov/xml-extract` (via `src/data/xml-extractor.ts`),
parses it for DOT grants, and stores results locally (`src/data/local-provider.ts`)
for the app to query with no API limits. Free, no rate limits, updated daily —
just re-run `npm run update-grants` to refresh.

## Available Filters in API

The Get Opportunities API supports these filters:

### Organization Filters
- `department` - Filter by department name
- `subTier` - Sub-agency filter
- `office` - Office filter

### Type Filters
- `type` - Opportunity type
- `postedFrom` / `postedTo` - Date range
- `responseDeadlineFrom` / `responseDeadlineTo` - Deadline range

### Search Filters
- `keyword` - Keyword search
- `noticeId` - Specific notice ID

### Response Control
- `limit` - Results per page (max 1000)
- `offset` - Pagination offset
- `sortBy` - Sort field
- `sortOrder` - ASC or DESC

## Example API Calls

### 1. Simple Keyword Search
```bash
curl "https://api.sam.gov/opportunities/v2/search?api_key=YOUR_KEY&postedFrom=01/01/2026&postedTo=12/31/2026&keyword=highway&limit=100"
```

### 2. Filter by Department
```bash
curl "https://api.sam.gov/opportunities/v2/search?api_key=YOUR_KEY&postedFrom=01/01/2026&postedTo=12/31/2026&department=Department%20of%20Transportation&limit=100"
```

### 3. Get Specific Notice
```bash
curl "https://api.sam.gov/opportunities/v2/search?api_key=YOUR_KEY&noticeId=NOTICE_ID"
```

## Optimize Your Usage

### Current Issue
Each search is 1 API call when `DATA_SOURCE=api`. Switch to `mock` or
`local` (see Options 4-5 above) to avoid consuming your daily quota during
development/testing.

### Solutions

**1. Use Cache More Effectively**
Cache is set to 6 hours. Repeated searches use cache.

**2. Retries Are Already Disabled**
`src/clients/sam-opportunities.ts` sets `maxRetries: 0` (around line 102) —
a failed request already doesn't retry, so it doesn't cost extra quota.

## Check Your Usage

Visit your API dashboard:
https://open.gsa.gov/api/get-opportunities-public-api/

## Official Documentation

SAM.gov Get Opportunities API:
https://open.gsa.gov/api/get-opportunities-public-api/

API Console (test queries):
https://open.gsa.gov/api/get-opportunities-public-api/#getting-started
