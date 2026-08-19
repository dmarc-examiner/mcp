#!/usr/bin/env node

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
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
 * Reuses stored tokens, refreshing them if needed, and never opens a browser.
 *
 * The server answers `initialize` and `tools/list` without a token, so a fresh
 * install can start, be inspected and list its tools before anyone authorizes.
 * Demanding a browser round trip up front would block that: an MCP client is
 * waiting on its `initialize`, and an automated environment has no browser at
 * all — which is why Glama's build test could never start this server.
 */
async function resumeAuthorization(provider: CliOAuthProvider): Promise<void> {
  if (!provider.tokens()) return;

  try {
    await auth(provider, { serverUrl: MCP_SERVER_URL });
  } catch (error) {
    log(`Stored credentials could not be refreshed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Runs the full authorization, opening a browser and waiting for the callback.
 *
 * Called on demand: either explicitly via `login`, or the first time the server
 * rejects a request that needs a token — in practice a tool call, where the
 * user has just asked for something and a pause to authorize is expected.
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
  await resumeAuthorization(provider);

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
  // A request the server will not serve unauthenticated comes back as a 401,
  // which the transport surfaces as UnauthorizedError. That is the moment to
  // send the user to the browser — not at startup, when nobody has asked for
  // anything yet. The original message is replayed once tokens are in hand so
  // the client's call completes rather than failing and needing a retry.
  let authorizing: Promise<void> | undefined;

  const forward = async (message: JSONRPCMessage): Promise<void> => {
    try {
      await upstream.send(message);
    } catch (error) {
      if (!(error instanceof UnauthorizedError)) throw error;

      authorizing ??= authorize(provider).finally(() => {
        authorizing = undefined;
      });
      await authorizing;
      await upstream.send(message);
    }
  };

  downstream.onmessage = (message: JSONRPCMessage) => {
    void forward(message).catch((error: Error) => shutdown(`upstream send failed: ${error.message}`));
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
