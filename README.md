# mcp-epa-envirofacts

US EPA Envirofacts MCP.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `facilities_by_zip` | List EPA-regulated facilities in a US ZIP code from the EPA Facility Registry Service (FRS). Returns each facility once with all the EPA programs (RCRAINFO, NPDES, AIRS, TRI, etc.) it's regulated under. Keyless. |
| `facilities_by_state` | List EPA-regulated facilities in a US state (and optionally a city) from the EPA Facility Registry Service (FRS). Returns each facility once with all the EPA programs it is regulated under. Keyless. |
| `get_facility` | Look up one EPA-regulated facility by its FRS Registry ID. Returns the facility detail plus a programs[] array listing every EPA program (RCRAINFO, NPDES, AIRS, TRI, etc.) the site is regulated under. Keyless. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "epa-envirofacts": {
      "url": "https://gateway.pipeworx.io/epa-envirofacts/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Epa Envirofacts data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
