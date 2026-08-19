# @dmarc-examiner/mcp

[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tools](https://img.shields.io/badge/tools-21-orange)](#available-tools)

Official MCP (Model Context Protocol) server for [DMARC Examiner](https://dmarc-examiner.com/?utm_source=github&utm_medium=content&utm_campaign=mcp-repo). Query your DMARC monitoring data from AI assistants like Claude Desktop, Claude Code, and Cursor.

## Why

DMARC aggregate reports arrive as compressed XML, one file per receiver per day. Reading them means either opening a dashboard or parsing XML by hand.

This server puts that data behind an MCP connection, so you can ask questions instead:

> *Which sending sources failed DMARC alignment last week?*

> *Show me the domains where SPF passes but DKIM does not.*

> *Export the report for example.com as CSV.*

DMARC Examiner is a DMARC monitoring service with a free tier — you need an account to use this server, but not a paid one.

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

**Adding the server does not require authorizing.** It starts immediately and answers `initialize`, `tools/list` and `ping` without credentials, so your client can list all 21 tools straight away.

A browser opens the first time you call a tool that touches your data. You'll need to:

1. Log in to your DMARC Examiner account
2. Select which organization to connect
3. Approve the requested permissions (scopes)

The call you made is then replayed automatically, so it completes rather than failing.

With **Option 1** the MCP client runs this flow itself. With **Option 2** the package does it: it registers as an OAuth client, opens your browser, and stores the resulting tokens in `~/.dmarc-examiner/mcp-credentials.json` with `0600` permissions. The refresh token is reused on later runs, so the browser step happens once.

> **Why it works this way.** Authorizing on startup is the obvious design and it breaks every automated client: directory checks, scanners and CI have no browser to open, so the server appears to hang and the check times out. We wrote up the failure and the fix, with logs, in [Your Remote MCP Server Will Fail Every Directory Check](https://dmarc-examiner.com/blog/remote-mcp-servers-oauth-directories).

You can also drive it directly:

```bash
npx -y @dmarc-examiner/mcp login    # authorize now, outside your MCP client
npx -y @dmarc-examiner/mcp logout   # forget the stored credentials
```

Set `DMARC_EXAMINER_MCP_URL` to point the package at a different endpoint.

## Available Tools

### Domains

| Tool | Description | Scope |
|------|-------------|-------|
| `list_domains` | List all monitored domains in your organization | `domains:read` |
| `get_domain` | Get details of a specific domain | `domains:read` |
| `check_dmarc` | Inspect the public DMARC record at `_dmarc.<domain>`. Works on any domain, not only your own | `domains:read` |
| `create_domain` | Add a domain. Returns the reporting email and DMARC record to publish in DNS | `domains:manage` |
| `verify_domain` | Re-check DNS to confirm the DMARC record carries your reporting address | `domains:manage` |
| `delete_domain` | Remove a domain from monitoring. Soft delete — historical reports remain | `domains:manage` |

### Aggregate reports (RUA)

| Tool | Description | Scope |
|------|-------------|-------|
| `list_reports` | List DMARC reports with filtering | `reports:read` |
| `get_report` | Get a detailed report with records | `reports:read` |
| `get_report_statistics` | Report statistics by country and ASN | `reports:read` |
| `export_report_csv` | Export a report as CSV | `reports:export` |

### Forensic reports (RUF)

Requires the Pro plan or above; these return 403 otherwise.

| Tool | Description | Scope |
|------|-------------|-------|
| `list_forensic_reports` | List RUF reports with filtering and pagination | `forensic:read` |
| `get_forensic_report` | Full detail of a forensic report, including the failed message envelope | `forensic:read` |
| `get_forensic_reports_statistics` | Counters by failure type, delivery result, source IP with geolocation, and domain | `forensic:read` |
| `get_forensic_reports_summary` | Forensic activity over the last 7 days | `forensic:read` |

### Alerts

| Tool | Description | Scope |
|------|-------------|-------|
| `list_alerts` | List security alerts | `alerts:read` |
| `dismiss_alert` | Dismiss an alert | `alerts:manage` |

### Webhooks

Requires the Pro plan or above; these return 403 otherwise.

| Tool | Description | Scope |
|------|-------------|-------|
| `list_webhooks` | List configured webhook endpoints | `webhooks:read` |
| `create_webhook` | Create an endpoint. The URL must be HTTPS | `webhooks:manage` |
| `update_webhook` | Update the URL, name or active state of an endpoint | `webhooks:manage` |
| `delete_webhook` | Delete an endpoint permanently | `webhooks:manage` |
| `test_webhook` | Send a `webhook.test` event and return the delivery status | `webhooks:manage` |

## Scopes

| Scope | Description |
|-------|-------------|
| `domains:read` | View monitored domains |
| `domains:manage` | Add, verify and remove domains |
| `reports:read` | View reports and statistics |
| `reports:export` | Export reports to CSV |
| `forensic:read` | View forensic (RUF) reports |
| `alerts:read` | View alerts |
| `alerts:manage` | Manage alerts (dismiss) |
| `webhooks:read` | View webhook endpoints |
| `webhooks:manage` | Create, update, delete and test webhooks |

## Documentation

For detailed documentation, visit: https://dmarc-examiner.com/docs/settings/mcp-integration?utm_source=github&utm_medium=content&utm_campaign=mcp-repo

## Support

- Documentation: https://dmarc-examiner.com/docs?utm_source=github&utm_medium=content&utm_campaign=mcp-repo
- Email: support@dmarc-examiner.com

## License

MIT — see [LICENSE](LICENSE).
