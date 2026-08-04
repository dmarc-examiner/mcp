#!/usr/bin/env node

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import {
  CliOAuthProvider,
  credentialsPath,
  forgetCredentials,
  waitForAuthorizationCode,
} from './auth.js';

const MCP_SERVER_URL = process.env.DMARC_EXAMINER_MCP_URL ?? 'https://mcp.dmarc-examiner.com/mcp';

/** Everything the user sees goes to stderr; stdout carries the JSON-RPC stream. */
function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * Obtains tokens before any traffic is proxied.
 *
 * Authorizing up front rather than reacting to a 401 mid-session matters: the
 * MCP client on the other end of stdio is blocked on its `initialize`, and a
 * browser round trip in the middle of that exchange looks like a hang.
 */
async function authorize(provider: CliOAuthProvider): Promise<void> {
  let result: Awaited<ReturnType<typeof auth>>;

  try {
    result = await auth(provider, { serverUrl: MCP_SERVER_URL });
  } catch (error) {
    // A server that publishes no OAuth metadata is not protected. Refusing to
    // start there would make this unusable against a self-hosted or local
    // endpoint, so carry on unauthenticated and let the server object if it
    // disagrees.
    log(`Continuing without authorization: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  if (result === 'AUTHORIZED') return;

  const code = await waitForAuthorizationCode(() => provider.lastState);
  const exchanged = await auth(provider, { serverUrl: MCP_SERVER_URL, authorizationCode: code });

  if (exchanged !== 'AUTHORIZED') {
    throw new Error('Authorization did not complete');
  }

  log(`Authorized. Credentials stored in ${credentialsPath()}`);
}

/**
 * Pipes JSON-RPC messages between the local client and the remote server.
 *
 * Messages are forwarded verbatim instead of being re-implemented through a
 * Server/Client pair: whatever tools, prompts or capabilities the remote gains,
 * this keeps working without a release here.
 */
async function proxy(): Promise<void> {
  const provider = new CliOAuthProvider();
  await authorize(provider);

  const upstream = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), {
    authProvider: provider,
  });
  const downstream = new StdioServerTransport();

  let closing = false;
  const shutdown = async (reason?: string): Promise<void> => {
    if (closing) return;
    closing = true;
    if (reason) log(reason);
    await Promise.allSettled([upstream.close(), downstream.close()]);
    process.exit(reason ? 1 : 0);
  };

  upstream.onmessage = (message: JSONRPCMessage) => {
    void downstream.send(message).catch((error: Error) => shutdown(`stdio write failed: ${error.message}`));
  };
  downstream.onmessage = (message: JSONRPCMessage) => {
    void upstream.send(message).catch((error: Error) => shutdown(`upstream send failed: ${error.message}`));
  };

  upstream.onclose = () => void shutdown();
  downstream.onclose = () => void shutdown();
  upstream.onerror = (error: Error) => log(`upstream error: ${error.message}`);
  downstream.onerror = (error: Error) => log(`stdio error: ${error.message}`);

  await upstream.start();
  await downstream.start();

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (command === 'logout') {
    forgetCredentials();
    log('Credentials removed.');
    return;
  }

  if (command === 'login') {
    await authorize(new CliOAuthProvider());
    return;
  }

  await proxy();
}

main().catch((error: unknown) => {
  log(`DMARC Examiner MCP failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
