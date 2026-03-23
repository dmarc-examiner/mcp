# @dmarc-examiner/mcp

Official MCP (Model Context Protocol) plugin for [DMARC Examiner](https://dmarc-examiner.com). Connect your DMARC monitoring data to AI assistants like Claude Desktop, Claude Code, and Cursor.

## Quick Setup

### Option 1: Remote URL (Recommended)

Most MCP clients support remote HTTP servers directly. Add this to your MCP configuration:

```json
{
  "mcpServers": {
    "dmarc-examiner": {
      "url": "https://mcp.dmarc-examiner.com/mcp"
    }
  }
}
```

### Option 2: npx (for clients without remote HTTP support)

```json
{
  "mcpServers": {
    "dmarc-examiner": {
      "command": "npx",
      "args": ["-y", "@dmarc-examiner/mcp"]
    }
  }
}
```

## Configuration by Client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "dmarc-examiner": {
      "url": "https://mcp.dmarc-examiner.com/mcp"
    }
  }
}
```

### Claude Code

```bash
claude mcp add dmarc-examiner --transport http https://mcp.dmarc-examiner.com/mcp
```

### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "dmarc-examiner": {
      "url": "https://mcp.dmarc-examiner.com/mcp"
    }
  }
}
```

## Authorization

On first use, your MCP client will open a browser window to authorize access. You'll need to:

1. Log in to your DMARC Examiner account
2. Select which organization to connect
3. Approve the requested permissions (scopes)

## Available Tools

| Tool | Description | Scope Required |
|------|-------------|----------------|
| `list_domains` | List all monitored domains | `domains:read` |
| `get_domain` | Get details of a specific domain | `domains:read` |
| `list_reports` | List DMARC reports with filtering | `reports:read` |
| `get_report` | Get a detailed report with records | `reports:read` |
| `get_report_statistics` | Get report statistics by country/ASN | `reports:read` |
| `export_report_csv` | Export a report as CSV | `reports:export` |
| `list_alerts` | List security alerts | `alerts:read` |
| `dismiss_alert` | Dismiss an alert | `alerts:manage` |

## Scopes

| Scope | Description |
|-------|-------------|
| `domains:read` | View monitored domains |
| `reports:read` | View reports and statistics |
| `reports:export` | Export reports to CSV |
| `alerts:read` | View alerts |
| `alerts:manage` | Manage alerts (dismiss) |

## Documentation

For detailed documentation, visit: https://dmarc-examiner.com/docs/settings/mcp-integration

## Support

- Documentation: https://dmarc-examiner.com/docs
- Email: support@dmarc-examiner.com
