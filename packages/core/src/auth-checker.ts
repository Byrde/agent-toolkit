import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ProviderIdentities } from "./domain/manifest.js";

export interface AuthStatus {
  provider: string;
  authenticated: boolean;
  identity?: string;
  expectedIdentity?: string;
  identityMismatch?: boolean;
  error?: string;
  remediation?: string;
}

export type AuthChecker = (expectedIdentity?: Record<string, unknown>) => Promise<AuthStatus>;

const checkerRegistry: Record<string, AuthChecker> = {
  github: checkGitHubAuth,
  gcp: checkGcpAuth,
  terraform: checkTerraformAuth,
  atlassian: checkAtlassianAuth,
};

export async function checkAuth(
  providers: string[],
  identities?: ProviderIdentities,
): Promise<AuthStatus[]> {
  return Promise.all(providers.map((provider) => {
    const checker = checkerRegistry[provider];
    if (!checker) {
      return Promise.resolve({
        provider,
        authenticated: false,
        error: `No auth checker for provider "${provider}"`,
        remediation: "This provider is not yet supported by the auth doctor.",
      });
    }
    const expected = identities?.[provider] as Record<string, unknown> | undefined;
    return checker(expected);
  }));
}

export function registerAuthChecker(provider: string, checker: AuthChecker): void {
  checkerRegistry[provider] = checker;
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

function exec(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(command, args, (error, stdout, stderr) => {
      const exitCode = error && "code" in error ? (error.code as number) : error ? 1 : 0;
      resolve({ stdout, stderr, exitCode });
    });
  });
}

export async function checkGitHubAuth(
  expectedIdentity?: Record<string, unknown>,
): Promise<AuthStatus> {
  const provider = "github";

  let result: { stdout: string; stderr: string; exitCode: number };
  try {
    result = await exec("gh", ["auth", "status"]);
  } catch {
    return {
      provider,
      authenticated: false,
      error: "The `gh` CLI is not installed or not on PATH.",
      remediation: "Install the GitHub CLI: brew install gh  — then run: gh auth login",
    };
  }

  const combined = result.stdout + "\n" + result.stderr;

  if (result.exitCode !== 0) {
    return {
      provider,
      authenticated: false,
      error: "GitHub CLI reports not authenticated.",
      remediation: "Run: gh auth login",
    };
  }

  const identity = parseGitHubIdentity(combined);
  const expectedAccount = typeof expectedIdentity?.account === "string"
    ? expectedIdentity.account
    : undefined;

  if (expectedAccount && identity && !identity.includes(expectedAccount)) {
    return {
      provider,
      authenticated: true,
      identity: identity,
      expectedIdentity: expectedAccount,
      identityMismatch: true,
      error: `Authenticated as "${identity}" but expected account "${expectedAccount}".`,
      remediation: `Run: gh auth login — and authenticate as ${expectedAccount}.`,
    };
  }

  return {
    provider,
    authenticated: true,
    identity: identity ?? undefined,
  };
}

function parseGitHubIdentity(output: string): string | null {
  const match = output.match(/Logged in to \S+ account (\S+)/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// GCP
// ---------------------------------------------------------------------------

export async function checkGcpAuth(
  expectedIdentity?: Record<string, unknown>,
): Promise<AuthStatus> {
  const provider = "gcp";

  let result: { stdout: string; stderr: string; exitCode: number };
  try {
    result = await exec("gcloud", ["auth", "print-access-token"]);
  } catch {
    return {
      provider,
      authenticated: false,
      error: "The `gcloud` CLI is not installed or not on PATH.",
      remediation:
        "Install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install — then run: gcloud auth login",
    };
  }

  if (result.exitCode !== 0) {
    return {
      provider,
      authenticated: false,
      error: "GCP CLI reports no active credentials.",
      remediation: "Run: gcloud auth login",
    };
  }

  const identity = await resolveGcpIdentity();
  const expectedAccount = typeof expectedIdentity?.account === "string"
    ? expectedIdentity.account
    : undefined;

  if (expectedAccount && identity && identity !== expectedAccount) {
    return {
      provider,
      authenticated: true,
      identity,
      expectedIdentity: expectedAccount,
      identityMismatch: true,
      error: `Authenticated as "${identity}" but expected account "${expectedAccount}".`,
      remediation: `Run: gcloud config set account ${expectedAccount}`,
    };
  }

  return {
    provider,
    authenticated: true,
    identity: identity ?? undefined,
  };
}

async function resolveGcpIdentity(): Promise<string | null> {
  try {
    const result = await exec("gcloud", ["config", "get-value", "account"]);
    const account = result.stdout.trim();
    if (account && account !== "(unset)") {
      return account;
    }
  } catch {
    // identity is best-effort
  }
  return null;
}

// ---------------------------------------------------------------------------
// Terraform Cloud
// ---------------------------------------------------------------------------

const DEFAULT_TFE_HOST = "app.terraform.io";
const CREDENTIALS_PATH = join(homedir(), ".terraform.d", "credentials.tfrc.json");

export async function checkTerraformAuth(
  expectedIdentity?: Record<string, unknown> | string,
): Promise<AuthStatus> {
  const provider = "terraform";

  const host = typeof expectedIdentity === "string"
    ? expectedIdentity
    : (typeof expectedIdentity?.host === "string" ? expectedIdentity.host : DEFAULT_TFE_HOST);

  const token = resolveTerraformToken(host) ?? (await readCredentialsFile(host));

  if (!token) {
    return {
      provider,
      authenticated: false,
      error: `No Terraform Cloud token found for ${host}.`,
      remediation:
        `Run: terraform login${host !== DEFAULT_TFE_HOST ? ` ${host}` : ""} — ` +
        `or set the ${tfeEnvVarName(host)} environment variable.`,
    };
  }

  const email = await resolveTerraformEmail(host, token);
  const expectedEmail = typeof expectedIdentity === "object"
    ? (typeof expectedIdentity?.email === "string" ? expectedIdentity.email : undefined)
    : undefined;

  if (expectedEmail && email && email !== expectedEmail) {
    return {
      provider,
      authenticated: true,
      identity: email,
      expectedIdentity: expectedEmail,
      identityMismatch: true,
      error: `Authenticated as "${email}" but expected "${expectedEmail}".`,
      remediation: `Run: terraform login${host !== DEFAULT_TFE_HOST ? ` ${host}` : ""} — and authenticate as ${expectedEmail}.`,
    };
  }

  return {
    provider,
    authenticated: true,
    identity: email ?? host,
  };
}

function tfeEnvVarName(host: string): string {
  return `TF_TOKEN_${host.replace(/\./g, "_")}`;
}

function resolveTerraformToken(host: string): string | null {
  return process.env[tfeEnvVarName(host)] ?? null;
}

async function readCredentialsFile(host: string): Promise<string | null> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, "utf-8");
    const data = JSON.parse(raw);
    const token = data?.credentials?.[host]?.token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function resolveTerraformEmail(
  host: string,
  token: string,
): Promise<string | null> {
  try {
    const res = await fetch(`https://${host}/api/v2/account/details`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.api+json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: { attributes?: { email?: string } } };
    const email = data?.data?.attributes?.email;
    return typeof email === "string" ? email : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Atlassian — OAuth 2.1 browser flow; no programmatic auth check possible
// ---------------------------------------------------------------------------

export async function checkAtlassianAuth(
  _expectedIdentity?: Record<string, unknown>,
): Promise<AuthStatus> {
  return {
    provider: "atlassian",
    authenticated: true,
    identity: "OAuth",
  };
}

// ---------------------------------------------------------------------------
// Account Listing — rich providers
// ---------------------------------------------------------------------------

export interface ProviderAccount {
  account: string;
  active: boolean;
  host?: string;
}

export async function listGitHubAccounts(): Promise<ProviderAccount[]> {
  let result: { stdout: string; stderr: string; exitCode: number };
  try {
    result = await exec("gh", ["auth", "status"]);
  } catch {
    return [];
  }

  const combined = result.stdout + "\n" + result.stderr;
  return parseGitHubAccounts(combined);
}

export function parseGitHubAccounts(output: string): ProviderAccount[] {
  const accounts: ProviderAccount[] = [];
  const lines = output.split("\n");

  let currentHost: string | undefined;
  for (const line of lines) {
    const hostMatch = line.match(/Logged in to (\S+)/);
    if (hostMatch) {
      currentHost = hostMatch[1];
    }

    const accountMatch = line.match(/Logged in to (\S+) account (\S+)/);
    if (accountMatch) {
      accounts.push({
        account: accountMatch[2],
        host: accountMatch[1],
        active: line.includes("✓"),
      });
    }
  }

  return accounts;
}

export async function listGcpAccounts(): Promise<ProviderAccount[]> {
  let result: { stdout: string; stderr: string; exitCode: number };
  try {
    result = await exec("gcloud", ["auth", "list", "--format=json"]);
  } catch {
    return [];
  }

  if (result.exitCode !== 0) return [];

  try {
    const entries = JSON.parse(result.stdout);
    if (!Array.isArray(entries)) return [];

    return entries
      .filter((e: Record<string, unknown>) => typeof e.account === "string")
      .map((e: Record<string, unknown>) => ({
        account: e.account as string,
        active: e.status === "ACTIVE",
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Token Resolution — extract actual tokens from CLI auth for MCP config
// ---------------------------------------------------------------------------

export type ResolvedTokens = Record<string, Record<string, string>>;

type TokenResolver = (identity?: Record<string, unknown>) => Promise<Record<string, string>>;

const tokenResolvers: Record<string, TokenResolver> = {
  github: resolveGitHubTokens,
  terraform: resolveTerraformTokens,
  atlassian: resolveAtlassianTokens,
};

export async function resolveTokens(
  providers: string[],
  identities?: ProviderIdentities,
): Promise<ResolvedTokens> {
  const tokens: ResolvedTokens = {};

  for (const provider of providers) {
    const resolver = tokenResolvers[provider];
    if (!resolver) continue;
    const identity = identities?.[provider] as Record<string, unknown> | undefined;
    const resolved = await resolver(identity);
    if (Object.keys(resolved).length > 0) {
      tokens[provider] = resolved;
    }
  }

  return tokens;
}

async function resolveGitHubTokens(
  identity?: Record<string, unknown>,
): Promise<Record<string, string>> {
  const args = ["auth", "token"];
  const account = typeof identity?.account === "string" ? identity.account : undefined;
  if (account) args.push("--user", account);

  try {
    const result = await exec("gh", args);
    const token = result.stdout.trim();
    if (result.exitCode !== 0 || !token) return {};
    return { GITHUB_PERSONAL_ACCESS_TOKEN: token };
  } catch {
    return {};
  }
}

async function resolveTerraformTokens(
  identity?: Record<string, unknown>,
): Promise<Record<string, string>> {
  const host = typeof identity?.host === "string" ? identity.host : DEFAULT_TFE_HOST;
  const token = resolveTerraformToken(host) ?? (await readCredentialsFile(host));
  return token ? { TFE_TOKEN: token } : {};
}

async function resolveAtlassianTokens(
  _identity?: Record<string, unknown>,
): Promise<Record<string, string>> {
  return {};
}

// ---------------------------------------------------------------------------
// Identity Extraction — convert AuthStatus to pinnable identity
// ---------------------------------------------------------------------------

export function extractPinnableIdentity(
  status: AuthStatus,
): Record<string, unknown> | undefined {
  if (!status.authenticated || !status.identity) return undefined;

  switch (status.provider) {
    case "github":
      return { account: status.identity };
    case "gcp":
      return { account: status.identity };
    case "terraform":
      // identity is the email (if resolved) or host; not useful as a standalone pin
      return undefined;
    case "atlassian":
      return undefined;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Docker Daemon
// ---------------------------------------------------------------------------

export interface DockerStatus {
  available: boolean;
  daemonRunning: boolean;
  error?: string;
  remediation?: string;
}

export async function checkDockerAvailable(): Promise<DockerStatus> {
  const versionResult = await exec("docker", ["--version"]);
  if (versionResult.exitCode !== 0) {
    return {
      available: false,
      daemonRunning: false,
      error: "Docker is not installed or not on PATH.",
      remediation: "Install Docker: https://docs.docker.com/get-docker/",
    };
  }

  const infoResult = await exec("docker", ["info"]);
  if (infoResult.exitCode !== 0) {
    return {
      available: true,
      daemonRunning: false,
      error: "Docker is installed but the daemon is not running.",
      remediation: "Start Docker Desktop, or run: sudo systemctl start docker",
    };
  }

  return { available: true, daemonRunning: true };
}

