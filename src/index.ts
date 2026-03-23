#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_SERVER_URL = 'https://mcp.dmarc-examiner.com/mcp';

async function main(): Promise<void> {
  const transport = new StreamableHTTPClientTransport(
    new URL(MCP_SERVER_URL),
  );

  const client = new Client({
    name: 'dmarc-examiner-mcp',
    version: '1.0.0',
  });

  await client.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start DMARC Examiner MCP plugin:', error);
  process.exit(1);
});
