import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

/**
 * Loopback port for the authorization callback.
 *
 * Fixed rather than random because the redirect URI is registered with the
 * authorization server during dynamic client registration; a different port on
 * the next run would no longer match what was registered.
 */
const CALLBACK_PORT = 33418;
const CALLBACK_PATH = '/callback';
const REDIRECT_URL = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

const STORE_PATH = join(homedir(), '.dmarc-examiner', 'mcp-credentials.json');

interface StoredCredentials {
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformationMixed;
}

function read(): StoredCredentials {
  try {
    return JSON.parse(readFileSync(STORE_PATH, 'utf8')) as StoredCredentials;
  } catch {
    return {};
  }
}

function write(credentials: StoredCredentials): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(STORE_PATH, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

export function forgetCredentials(): void {
  rmSync(STORE_PATH, { force: true });
}

export function credentialsPath(): string {
  return STORE_PATH;
}

/**
 * OAuth provider for a command line client.
 *
 * The code verifier and the CSRF state stay in memory: they are only valid for
 * the single authorization exchange happening in this process. Tokens and the
 * registered client survive on disk so the browser dance happens once, not on
 * every start.
 */
export class CliOAuthProvider implements OAuthClientProvider {
  private credentials: StoredCredentials = read();
  private verifier?: string;

  lastState?: string;

  readonly redirectUrl = REDIRECT_URL;

  readonly clientMetadata: OAuthClientMetadata = {
    client_name: 'DMARC Examiner MCP',
    redirect_uris: [REDIRECT_URL],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.credentials.clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.credentials.clientInformation = clientInformation;
    write(this.credentials);
  }

  tokens(): OAuthTokens | undefined {
    return this.credentials.tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.credentials.tokens = tokens;
    write(this.credentials);
  }

  state(): string {
    this.lastState = randomUUID();
    return this.lastState;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.verifier) {
      throw new Error('No PKCE code verifier for this authorization attempt');
    }
    return this.verifier;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') this.credentials = {};
    if (scope === 'tokens' || scope === 'all') delete this.credentials.tokens;
    if (scope === 'client' || scope === 'all') delete this.credentials.clientInformation;
    if (scope === 'verifier' || scope === 'all') this.verifier = undefined;
    write(this.credentials);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // stderr, never stdout: stdout carries the JSON-RPC stream and any stray
    // byte there corrupts the protocol for the MCP client.
    process.stderr.write(
      `\nAuthorize DMARC Examiner in your browser:\n  ${authorizationUrl.href}\n\n`,
    );
    openInBrowser(authorizationUrl.href);
  }
}

function openInBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';

  try {
    spawn(command, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' })
      .on('error', () => {})
      .unref();
  } catch {
    // Opening a browser is a convenience; the URL is already on stderr.
  }
}

/**
 * Serves the loopback redirect and resolves with the authorization code.
 *
 * Rejects on an `error` response from the authorization server, and on a state
 * mismatch — the SDK does not check state, so this is the only thing standing
 * between the flow and a CSRF-swapped code.
 */
export function waitForAuthorizationCode(
  expectedState: () => string | undefined,
  timeoutMs = 300_000,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }

      const params = url.searchParams;
      const finish = (status: number, body: string) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }).end(
          `<!doctype html><meta charset="utf-8"><title>DMARC Examiner</title>
           <body style="font:16px system-ui;padding:3rem;max-width:32rem;margin:auto">${body}</body>`,
        );
        clearTimeout(timer);
        server.close();
      };

      if (params.get('error')) {
        // The error description comes from a third party — surface the code
        // only, never render the server's text back into the page.
        finish(400, '<h1>Authorization failed</h1><p>You can close this tab.</p>');
        reject(new Error(`Authorization server returned: ${params.get('error')}`));
        return;
      }

      if (params.get('state') !== expectedState()) {
        finish(400, '<h1>Authorization failed</h1><p>You can close this tab.</p>');
        reject(new Error('State mismatch on the OAuth callback: refusing the code'));
        return;
      }

      const code = params.get('code');
      if (!code) {
        finish(400, '<h1>Authorization failed</h1><p>You can close this tab.</p>');
        reject(new Error('No authorization code in the callback'));
        return;
      }

      finish(200, '<h1>Connected</h1><p>You can close this tab and go back to your client.</p>');
      resolve(code);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for authorization'));
    }, timeoutMs);
    timer.unref();

    server.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`Port ${CALLBACK_PORT} is busy; free it and try again`)
          : error,
      );
    });

    server.listen(CALLBACK_PORT, '127.0.0.1');
  });
}
