# Web Interface User Guide

## Getting Started

### Accessing the Interface

1. Start the web server:
```bash
cd /path/to/webmcp
npm run start:web
```

2. Open your browser to: **http://localhost:3000**

### Who This Is For

This tool helps DOT grant applicants find and apply for federal transportation funding:
- State DOTs
- City governments
- County governments
- Tribal nations
- Metropolitan Planning Organizations (MPOs)
- Public transit agencies

## Features

### 1. Search Grants

**Purpose**: Find active DOT grant opportunities you can apply for right now

**Location**: http://localhost:3000/search.html

**How to Use**:

1. **Select Applicant Type** (optional)
   - Choose your organization type from dropdown
   - Filters to grants you're eligible for

2. **Set Funding Range** (optional)
   - Minimum Amount: Smallest grant you'd apply for
   - Maximum Amount: Largest grant you can handle

3. **Enter Keywords** (optional)
   - Examples: "highway", "transit", "bridge", "safety"
   - Searches titles and descriptions

4. **Set Deadline Range** (optional)
   - Deadline After: Earliest deadline to show
   - Deadline Before: Latest deadline to show

5. **Click "Search Grants"**

**Results Show**:
- Grant title and organization
- Award amount
- Deadline date
- Brief description
- Links to view details or apply

**Tips**:
- Start broad (no filters) to see all opportunities
- Narrow down if you get too many results
- Save promising grants to review later

### 2. Check Eligibility

**Purpose**: Find out which DOT programs your organization qualifies for

**Location**: http://localhost:3000/eligibility.html

**How to Use**:

1. **Select Your Organization Type**
   - State, City, County, Tribal, MPO, or Transit Agency

2. **Click "Check Eligibility"**

**Results Show**:
- **Green badge (Eligible)**: You can apply
- **Yellow badge (Conditional)**: You may qualify with restrictions
- **Red badge (Not Eligible)**: Not eligible

Each result includes:
- Program name and number (CFDA code)
- Why you are/aren't eligible
- Requirements if eligible
- Match requirements if applicable

**Example**: 
- Transit Agencies → Green for "Federal Transit Capital Investment (20.500)"
- Cities → Yellow for "INFRA Grants (20.933)" with conditions

**When to Use This**:
- Planning your grant strategy
- Understanding program requirements
- Before spending time on an application

### 3. Track Deadlines

**Purpose**: Monitor upcoming grant deadlines so you don't miss opportunities

**Location**: http://localhost:3000/deadlines.html

**How to Use**:

1. **Adjust Time Range**
   - Slider: 7, 14, 30, 60, or 90 days ahead
   - Shows grants closing in that window

2. **Filter by Applicant Type** (optional)
   - Only show deadlines for your organization type

3. **Review Timeline**

**Timeline Shows**:
- Grants sorted by deadline (soonest first)
- Days remaining countdown
- Grant title and amount
- Link to view details

**Color Coding**:
- **Red**: Urgent (7 days or less)
- **Yellow**: Soon (8-14 days)
- **Green**: More time (15+ days)

**Tips**:
- Check weekly to stay current
- Set reminders for urgent deadlines
- Allow 2-4 weeks minimum for quality applications

### 4. Grant Details

**Purpose**: Get comprehensive information about a specific grant program

**Location**: http://localhost:3000/details.html

**How to Access**:
- Click "View Details" from search results
- Click grant title from deadline timeline
- Direct URL: `details.html?id=GRANT_ID`

**Information Shown**:
- Program title and organization
- Full description
- Eligibility requirements
- Application procedures
- Deadlines and important dates
- Funding amounts (min/max/average)
- Match requirements
- Contact information
- Link to apply on SAM.gov

**Actions**:
- **Apply Button**: Opens SAM.gov application
- **Check Eligibility**: Jumps to eligibility checker

### 5. Chat (Ask in Plain English)

**Purpose**: Ask grant questions in natural language instead of filling out forms

**Location**: http://localhost:3000/chat.html

**How to Use**:

1. Type a question in plain English, e.g. "transit grants over $1M for cities"
2. Press Enter or click Send
3. The assistant calls the same search/eligibility/deadline tools behind
   the scenes and replies with a formatted answer (headings, bullet lists,
   links to grant details)
4. Keep asking follow-up questions — it remembers the conversation

**Note**: This feature requires the site administrator to have configured
an `ANTHROPIC_API_KEY`. If it's not configured, the chat page will show an
error but every other page keeps working normally.

### 6. Homepage

**Location**: http://localhost:3000/

**Features**:
- Quick navigation to all five tools
- Overview of capabilities
- Feature descriptions
- Getting started guide

## Navigation

**Top Menu Bar** (on all pages):
- **Home**: Return to homepage
- **Search Grants**: Find opportunities
- **Check Eligibility**: Verify qualification
- **Track Deadlines**: Monitor closing dates
- **Chat**: Ask grant questions in plain English
- **About**: System information

## Common Workflows

### Scenario 1: New User Looking for Any Grants

1. Go to **Search Grants**
2. Select your **Applicant Type**
3. Don't set other filters (see everything)
4. Click **Search**
5. Browse results
6. Click **View Details** on interesting grants
7. Use **Check Eligibility** to verify qualification

### Scenario 2: Looking for Specific Type of Funding

1. Go to **Search Grants**
2. Enter **Keywords** (e.g., "bridge repair")
3. Set **Funding Range** based on project size
4. Click **Search**
5. Review results
6. Check **Track Deadlines** to prioritize

### Scenario 3: Planning Grant Strategy

1. Go to **Check Eligibility**
2. Select your **Organization Type**
3. Review all programs you qualify for
4. Note program numbers for eligible programs
5. Go to **Search Grants**
6. Look for active opportunities in those programs

### Scenario 4: Avoiding Missed Deadlines

1. Go to **Track Deadlines**
2. Set range to **30 days**
3. Review upcoming deadlines
4. Prioritize based on:
   - Days remaining
   - Grant amount
   - Eligibility status
   - Application requirements

## Understanding Results

### Grant Card Layout

```
┌─────────────────────────────────────────┐
│ Grant Title                              │
│ Department • Office                      │
├─────────────────────────────────────────┤
│ Amount: $5,000,000                       │
│ Deadline: 2026-12-31                     │
│ (60 days remaining)                      │
├─────────────────────────────────────────┤
│ Description preview...                   │
├─────────────────────────────────────────┤
│ [View Details]  [Apply on SAM.gov]      │
└─────────────────────────────────────────┘
```

### Eligibility Badge Colors

- **🟢 Green (Eligible)**: You meet all requirements
- **🟡 Yellow (Conditional)**: May qualify with conditions
- **🔴 Red (Not Eligible)**: Does not accept your organization type
- **⚪ Gray (Unknown)**: Insufficient information

### Deadline Urgency

- **🔴 Urgent**: 7 days or less - Apply NOW
- **🟡 Soon**: 8-14 days - Start application
- **🟢 Time**: 15+ days - Begin planning

## Troubleshooting

### No Results Found

**Possible Causes**:
- Filters too restrictive
- No active opportunities matching criteria
- Data source is empty

**Solutions**:
- Remove some filters
- Widen funding range
- Extend deadline range
- Try different keywords

### "Rate Limit Exceeded" Error

**Cause**: Too many API requests (100/day limit)

**Solutions**:
- Wait until tomorrow (quota resets daily)
- System automatically caches results
- Contact administrator about mock data mode

### Page Won't Load

**Check**:
1. Is web server running? (`npm run start:web`)
2. Correct URL? (http://localhost:3000)
3. Browser console for errors (F12)

### Search Is Slow

**Normal Response Times**:
- First search: 300-500ms (API call)
- Repeat search: <10ms (cached)

**If Slower**:
- Check internet connection
- SAM.gov API may be slow
- Server logs show request times

### Missing Grant Information

**Note**: Data quality depends on source:
- Some grants have incomplete information
- Mock data has limited sample grants
- Real API has full government data

**Solutions**:
- View details page for more information
- Check SAM.gov directly for official data
- Contact grant program office for clarification

## Tips for Success

### Best Practices

1. **Check Regularly**: New opportunities posted weekly
2. **Start Early**: Allow 2-4 weeks for applications
3. **Read Requirements**: Eligibility isn't everything
4. **Verify on SAM.gov**: Always confirm details officially
5. **Contact Program Office**: Ask questions before applying

### Maximizing Your Search

**Use Keywords Effectively**:
- "highway" - Road projects
- "transit" - Public transportation
- "bridge" - Bridge repair/construction
- "safety" - Safety improvements
- "rural" - Rural area projects
- "planning" - Planning grants

**Filter by Amount**:
- Small projects: $100K - $1M
- Medium projects: $1M - $10M
- Large projects: $10M+

**Watch Deadlines**:
- Set up calendar reminders
- Check timeline weekly
- Note pre-application requirements

## Data Sources

### Current Mode: Mock Data

The system is currently using **sample data** with 5 example DOT grants:

1. **INFRA Grant** - $50M - Infrastructure projects
2. **Transit Capital** - $25M - Transit systems
3. **Highway Safety** - $10M - Safety improvements
4. **Tribal Transportation** - $5M - Tribal projects
5. **Airport Improvement** - $15M - Airport infrastructure

**Eligibility data** includes rules for all 6 applicant types.

**Note**: This is demonstration data. For real grant searches, administrator should set `DATA_SOURCE=api` in `.env`.

### Switching to Live Data

**Administrators**: Change `.env` configuration:
```bash
DATA_SOURCE=api  # Use real SAM.gov API
```

Then restart server:
```bash
npm run start:web
```

## Mobile Access

The interface is **responsive** and works on:
- Desktop browsers
- Tablets
- Mobile phones

**Mobile Tips**:
- Navigation menu collapses to hamburger icon
- Forms stack vertically
- Tap cards to expand details
- Swipe to scroll timelines

## Printing and Saving

**Print Grant Details**:
- Open details page
- Use browser print (Ctrl+P / Cmd+P)
- Select "Save as PDF" if needed

**Save Searches**:
- Bookmark search URLs (filters included in URL)
- Export results (copy/paste into spreadsheet)

## Getting Help

**For Tool Issues**:
- Check this guide
- View browser console (F12) for errors
- Contact system administrator

**For Grant Questions**:
- Use contact information in grant details
- Visit transportation.gov
- Call DOT program office directly

**For Application Help**:
- Visit grants.gov
- Contact SAM.gov support
- Work with grant writing consultant

## Additional Resources

- **DOT Grants Portal**: https://www.transportation.gov/grants
- **SAM.gov**: https://sam.gov/
- **Grants.gov**: https://www.grants.gov/
- **USASpending.gov**: https://www.usaspending.gov/
