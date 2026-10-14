# Sample Prompts for webmcp (Claude Code)

Example prompts you can type directly in a Claude Code chat to invoke the
`webmcp` MCP server's tools.

These same prompt styles also work if you type them into the chat box at
`/chat.html` on the website — it calls the same four tools, just over HTTP
to the Anthropic API instead of over the MCP stdio protocol.

## Search grants

```
Search DOT grants for transit agencies with keywords "transit", minimum amount $1,000,000 and maximum amount $100,000,000
```

```
Use the webmcp search_dot_grants tool to find transit grants between $1M and $100M
```

## Eligibility

```
Check grant eligibility for a city government on opportunity ID <id>
```

## Grant details

```
Get details for DOT grant program number 20.205
```

## Deadlines

```
Show upcoming DOT grant deadlines in the next 30 days
```
