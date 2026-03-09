/**
 * Config Generation Context — produces client-specific MCP config files.
 *
 * This module handles:
 * 1. Building MCP server entries from WorkspaceConfig
 * 2. Merging with existing client config (preserving user-added servers)
 * 3. Writing the result to the correct location
 *
 * Cursor and Claude Code share the same { mcpServers } schema; only the
 * file path differs (.cursor/mcp.json vs .mcp.json at project root).
 *
 * Copilot (VS Code) uses a different schema: { servers, inputs } where
 * servers require a `type` field and inputs provide interactive token prompts.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { WorkspaceConfig, ServerDeclaration, ServerName } from "./domain/manifest.js";
import type { ResolvedTokens } from "./auth-checker.js";
import {
  type McpServerEntry,
  getServerDefaults,
  type McpServerDefaults,
  isKnownServer,
} from "./domain/server-registry.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Prefix used to identify toolkit-managed servers in client config files. */
export const TOOLKIT_PREFIX = "agent-toolkit:";

/**
 * Codex requires server names to match ^[a-zA-Z0-9_-]+$ (no colons).
 * This prefix replaces the colon with a hyphen for Codex compatibility.
 */
export const CODEX_TOOLKIT_PREFIX = "agent-toolkit-";

// ---------------------------------------------------------------------------
// Shared MCP config types (Cursor and Claude Code use the same schema)
// ---------------------------------------------------------------------------

export interface McpUrlEntry {
  url: string;
  headers?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerEntry | McpUrlEntry>;
}

/** @deprecated Use McpConfig instead. Kept for backward compatibility. */
export type CursorMcpConfig = McpConfig;

// ---------------------------------------------------------------------------
// Config file result (for dry-run and writing)
// ---------------------------------------------------------------------------

export interface ConfigFileResult {
  path: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Building MCP server entries (shared across all clients)
// ---------------------------------------------------------------------------

function resolveHeaders(
  defaults: McpServerDefaults,
  resolvedEnv?: Record<string, string>,
): Record<string, string> | undefined {
  if (!defaults.headerMapping) return undefined;
  const headers: Record<string, string> = {};
  for (const [headerName, envKey] of Object.entries(defaults.headerMapping)) {
    const value = resolvedEnv?.[envKey] ?? process.env[defaults.envMapping[envKey] ?? envKey];
    if (value) headers[headerName] = value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * For Docker-based servers, inline env vars as `-e KEY=VALUE` Docker args
 * rather than relying on env-block passthrough, which is unreliable across
 * MCP clients. The last element of defaults.args is assumed to be the image.
 */
function buildDockerEntry(
  defaults: McpServerDefaults,
  env: Record<string, string>,
): McpServerEntry {
  const baseArgs = [...(defaults.args ?? [])];
  const imageArg = baseArgs.pop()!;
  const envArgs: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    envArgs.push("-e", `${key}=${value}`);
  }
  return { command: "docker", args: [...baseArgs, ...envArgs, imageArg] };
}

function buildServerEntry(
  name: ServerName,
  declaration: ServerDeclaration,
  resolvedEnv?: Record<string, string>,
): McpServerEntry | McpUrlEntry | undefined {
  if (declaration.url) {
    return { url: declaration.url };
  }

  if (declaration.command) {
    const entry: McpServerEntry = {
      command: declaration.command,
      args: declaration.args ?? [],
    };
    if (declaration.env && Object.keys(declaration.env).length > 0) {
      entry.env = declaration.env;
    }
    return entry;
  }

  const defaults = getServerDefaults(name);
  if (!defaults) return undefined;

  if (defaults.url) {
    const entry: McpUrlEntry = { url: defaults.url };
    const headers = resolveHeaders(defaults, resolvedEnv);
    if (headers) entry.headers = headers;
    return entry;
  }

  if (!defaults.command) return undefined;

  const env: Record<string, string> = {};
  for (const [envKey, envVar] of Object.entries(defaults.envMapping)) {
    const value = resolvedEnv?.[envKey] ?? process.env[envVar];
    if (value) {
      env[envKey] = value;
    }
  }

  if (defaults.command === "docker") {
    return buildDockerEntry(defaults, env);
  }

  const consumedByArgs = new Set<string>();
  const resolvedArgs = (defaults.args ?? []).map((arg) =>
    arg.replace(/\$\{(\w+)\}/g, (_, key) => {
      const value = env[key];
      if (value) {
        consumedByArgs.add(key);
        return value;
      }
      return "";
    }),
  );

  const remainingEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!consumedByArgs.has(key)) {
      remainingEnv[key] = value;
    }
  }

  const entry: McpServerEntry = {
    command: defaults.command,
    args: resolvedArgs,
  };
  if (Object.keys(remainingEnv).length > 0) {
    entry.env = remainingEnv;
  }
  return entry;
}

/**
 * Build the toolkit-managed mcpServers map from a WorkspaceConfig.
 * Each server is keyed with the `agent-toolkit:` prefix.
 * When `resolvedTokens` are provided, they are used as the primary
 * source for env vars (falling back to process.env).
 */
export function buildMcpServers(
  config: WorkspaceConfig,
  resolvedTokens?: ResolvedTokens,
): Record<string, McpServerEntry | McpUrlEntry> {
  const servers: Record<string, McpServerEntry | McpUrlEntry> = {};

  const sortedNames = Object.keys(config.servers).sort();
  for (const name of sortedNames) {
    const declaration = config.servers[name];
    if (!declaration) continue;
    const entry = buildServerEntry(name, declaration, resolvedTokens?.[name]);
    if (entry) {
      servers[`${TOOLKIT_PREFIX}${name}`] = entry;
    }
  }

  return servers;
}

/** @deprecated Use buildMcpServers instead. */
export const buildCursorServers = buildMcpServers;

// ---------------------------------------------------------------------------
// Merge strategy (shared — same { mcpServers } schema)
// ---------------------------------------------------------------------------

/**
 * Merge toolkit-managed servers into an existing MCP config.
 * - User-added servers (without the toolkit prefix) are preserved.
 * - Toolkit-managed servers are replaced with the new entries.
 * - Toolkit servers that are no longer in the workspace config are removed.
 */
export function mergeMcpConfig(
  existing: McpConfig,
  toolkitServers: Record<string, McpServerEntry | McpUrlEntry>,
): McpConfig {
  const merged: Record<string, McpServerEntry | McpUrlEntry> = {};

  for (const [key, value] of Object.entries(existing.mcpServers)) {
    if (!key.startsWith(TOOLKIT_PREFIX)) {
      merged[key] = value;
    }
  }

  for (const [key, value] of Object.entries(toolkitServers)) {
    merged[key] = value;
  }

  return { mcpServers: merged };
}

/** @deprecated Use mergeMcpConfig instead. */
export const mergeCursorConfig = mergeMcpConfig;

// ---------------------------------------------------------------------------
// Read existing config (shared)
// ---------------------------------------------------------------------------

async function readExistingMcpConfig(
  configPath: string,
): Promise<McpConfig> {
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.mcpServers === "object" &&
      parsed.mcpServers !== null
    ) {
      return parsed as McpConfig;
    }
    return { mcpServers: {} };
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return { mcpServers: {} };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Cursor: .cursor/mcp.json
// ---------------------------------------------------------------------------

/**
 * Generate the Cursor MCP config for a workspace.
 * Returns the file path and serialized content without writing to disk.
 */
export async function generateCursorConfig(
  config: WorkspaceConfig,
  cwd?: string,
  resolvedTokens?: ResolvedTokens,
): Promise<ConfigFileResult> {
  const projectDir = cwd ?? process.cwd();
  const configPath = resolve(projectDir, ".cursor", "mcp.json");

  const toolkitServers = buildMcpServers(config, resolvedTokens);
  const existing = await readExistingMcpConfig(configPath);
  const merged = mergeMcpConfig(existing, toolkitServers);
  const content = JSON.stringify(merged, null, 2) + "\n";

  return { path: configPath, content };
}

/**
 * Generate and write the Cursor MCP config for a workspace.
 * Creates the `.cursor/` directory if it doesn't exist.
 */
export async function writeCursorConfig(
  config: WorkspaceConfig,
  cwd?: string,
  resolvedTokens?: ResolvedTokens,
): Promise<ConfigFileResult> {
  const result = await generateCursorConfig(config, cwd, resolvedTokens);
  await mkdir(dirname(result.path), { recursive: true });
  await writeFile(result.path, result.content, "utf-8");
  return result;
}

// ---------------------------------------------------------------------------
// Claude Code: .mcp.json (project root)
// ---------------------------------------------------------------------------

/**
 * Generate the Claude Code MCP config for a workspace.
 * Returns the file path and serialized content without writing to disk.
 */
export async function generateClaudeCodeConfig(
  config: WorkspaceConfig,
  cwd?: string,
  resolvedTokens?: ResolvedTokens,
): Promise<ConfigFileResult> {
  const projectDir = cwd ?? process.cwd();
  const configPath = resolve(projectDir, ".mcp.json");

  const toolkitServers = buildMcpServers(config, resolvedTokens);
  const existing = await readExistingMcpConfig(configPath);
  const merged = mergeMcpConfig(existing, toolkitServers);
  const content = JSON.stringify(merged, null, 2) + "\n";

  return { path: configPath, content };
}

/**
 * Generate and write the Claude Code MCP config for a workspace.
 */
export async function writeClaudeCodeConfig(
  config: WorkspaceConfig,
  cwd?: string,
  resolvedTokens?: ResolvedTokens,
): Promise<ConfigFileResult> {
  const result = await generateClaudeCodeConfig(config, cwd, resolvedTokens);
  await writeFile(result.path, result.content, "utf-8");
  return result;
}

// ---------------------------------------------------------------------------
// Copilot: .vscode/mcp.json
// ---------------------------------------------------------------------------

export interface CopilotInput {
  type: "promptString";
  id: string;
  description: string;
  password?: boolean;
}

export interface CopilotStdioServer {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface CopilotHttpServer {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export type CopilotServerEntry = CopilotStdioServer | CopilotHttpServer;

export interface CopilotMcpConfig {
  inputs?: CopilotInput[];
  servers: Record<string, CopilotServerEntry>;
}

/**
 * Build Copilot (.vscode/mcp.json) server entries and input variable definitions.
 * Unlike Cursor/Claude Code, this format requires a `type` field on each server
 * and supports `${input:...}` references for env vars backed by an `inputs` array.
 */
export function buildCopilotServers(
  config: WorkspaceConfig,
  resolvedTokens?: ResolvedTokens,
): {
  servers: Record<string, CopilotServerEntry>;
  inputs: CopilotInput[];
} {
  const servers: Record<string, CopilotServerEntry> = {};
  const inputs: CopilotInput[] = [];
  const seenInputIds = new Set<string>();

  const sortedNames = Object.keys(config.servers).sort();
  for (const name of sortedNames) {
    const declaration = config.servers[name];
    if (!declaration) continue;

    const key = `${TOOLKIT_PREFIX}${name}`;
    const providerTokens = resolvedTokens?.[name];

    if (declaration.url) {
      servers[key] = { type: "http", url: declaration.url };
      continue;
    }

    if (declaration.command) {
      const entry: CopilotStdioServer = {
        type: "stdio",
        command: declaration.command,
        args: declaration.args ?? [],
      };
      if (declaration.env && Object.keys(declaration.env).length > 0) {
        entry.env = declaration.env;
      }
      servers[key] = entry;
      continue;
    }

    const defaults = getServerDefaults(name);
    if (!defaults) continue;

    if (defaults.url) {
      const entry: CopilotHttpServer = { type: "http", url: defaults.url };
      const headers = resolveHeaders(defaults, providerTokens);
      if (headers) entry.headers = headers;
      servers[key] = entry;
      continue;
    }

    if (!defaults.command) continue;

    if (defaults.command === "docker") {
      const baseArgs = [...(defaults.args ?? [])];
      const imageArg = baseArgs.pop()!;
      const envArgs: string[] = [];
      for (const [envKey, envVar] of Object.entries(defaults.envMapping)) {
        const value = providerTokens?.[envKey] ?? process.env[envVar];
        if (value) {
          envArgs.push("-e", `${envKey}=${value}`);
        } else {
          const inputId = `${TOOLKIT_PREFIX}${envVar}`;
          envArgs.push("-e", `${envKey}=\${input:${inputId}}`);
          if (!seenInputIds.has(inputId)) {
            seenInputIds.add(inputId);
            inputs.push({
              type: "promptString",
              id: inputId,
              description: `${envVar} for ${name}`,
              password: true,
            });
          }
        }
      }
      servers[key] = {
        type: "stdio",
        command: "docker",
        args: [...baseArgs, ...envArgs, imageArg],
      };
      continue;
    }

    const env: Record<string, string> = {};
    for (const [envKey, envVar] of Object.entries(defaults.envMapping)) {
      const value = providerTokens?.[envKey] ?? process.env[envVar];
      if (value) {
        env[envKey] = value;
      } else {
        const inputId = `${TOOLKIT_PREFIX}${envVar}`;
        env[envKey] = `\${input:${inputId}}`;
        if (!seenInputIds.has(inputId)) {
          seenInputIds.add(inputId);
          inputs.push({
            type: "promptString",
            id: inputId,
            description: `${envVar} for ${name}`,
            password: true,
          });
        }
      }
    }

    const consumedByArgs = new Set<string>();
    const resolvedArgs = (defaults.args ?? []).map((arg) =>
      arg.replace(/\$\{(\w+)\}/g, (_, k) => {
        const value = env[k];
        if (value) {
          consumedByArgs.add(k);
          return value;
        }
        return "";
      }),
    );

    const remainingEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (!consumedByArgs.has(k)) {
        remainingEnv[k] = v;
      }
    }

    const entry: CopilotStdioServer = {
      type: "stdio",
      command: defaults.command,
      args: resolvedArgs,
    };
    if (Object.keys(remainingEnv).length > 0) {
      entry.env = remainingEnv;
    }
    servers[key] = entry;
  }

  return { servers, inputs };
}

/**
 * Merge toolkit-managed servers into an existing Copilot MCP config.
 * - User-added servers (without the toolkit prefix) are preserved.
 * - Toolkit-managed servers are replaced with the new entries.
 * - User-added inputs (without the toolkit prefix in their id) are preserved.
 * - Toolkit-managed inputs are replaced with the new entries.
 */
export function mergeCopilotConfig(
  existing: CopilotMcpConfig,
  toolkitServers: Record<string, CopilotServerEntry>,
  toolkitInputs: CopilotInput[],
): CopilotMcpConfig {
  const mergedServers: Record<string, CopilotServerEntry> = {};
  for (const [key, value] of Object.entries(existing.servers)) {
    if (!key.startsWith(TOOLKIT_PREFIX)) {
      mergedServers[key] = value;
    }
  }
  for (const [key, value] of Object.entries(toolkitServers)) {
    mergedServers[key] = value;
  }

  const userInputs = (existing.inputs ?? []).filter(
    (inp) => !inp.id.startsWith(TOOLKIT_PREFIX),
  );
  const mergedInputs = [...userInputs, ...toolkitInputs];

  const result: CopilotMcpConfig = { servers: mergedServers };
  if (mergedInputs.length > 0) {
    result.inputs = mergedInputs;
  }
  return result;
}

async function readExistingCopilotConfig(
  configPath: string,
): Promise<CopilotMcpConfig> {
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.servers === "object" &&
      parsed.servers !== null
    ) {
      return parsed as CopilotMcpConfig;
    }
    return { servers: {} };
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return { servers: {} };
    }
    throw err;
  }
}

/**
 * Generate the Copilot MCP config (.vscode/mcp.json) for a workspace.
 * Returns the file path and serialized content without writing to disk.
 */
export async function generateCopilotConfig(
  config: WorkspaceConfig,
  cwd?: string,
  resolvedTokens?: ResolvedTokens,
): Promise<ConfigFileResult> {
  const projectDir = cwd ?? process.cwd();
  const configPath = resolve(projectDir, ".vscode", "mcp.json");

  const { servers, inputs } = buildCopilotServers(config, resolvedTokens);
  const existing = await readExistingCopilotConfig(configPath);
  const merged = mergeCopilotConfig(existing, servers, inputs);
  const content = JSON.stringify(merged, null, 2) + "\n";

  return { path: configPath, content };
}

/**
 * Generate and write the Copilot MCP config (.vscode/mcp.json) for a workspace.
 * Creates the `.vscode/` directory if it doesn't exist.
 */
export async function writeCopilotConfig(
  config: WorkspaceConfig,
  cwd?: string,
  resolvedTokens?: ResolvedTokens,
): Promise<ConfigFileResult> {
  const result = await generateCopilotConfig(config, cwd, resolvedTokens);
  await mkdir(dirname(result.path), { recursive: true });
  await writeFile(result.path, result.content, "utf-8");
  return result;
}

// ---------------------------------------------------------------------------
// Codex: .codex/config.toml
// ---------------------------------------------------------------------------

export interface CodexHttpServer {
  url: string;
  http_headers?: Record<string, string>;
  bearer_token_env_var?: string;
}

export type CodexServerEntry = McpServerEntry | CodexHttpServer;

export interface CodexConfig {
  mcp_servers?: Record<string, CodexServerEntry>;
  [key: string]: unknown;
}

function isUrlEntry(entry: McpServerEntry | McpUrlEntry): entry is McpUrlEntry {
  return "url" in entry && !("command" in entry);
}

/**
 * Build Codex (.codex/config.toml) server entries from WorkspaceConfig.
 * Reuses the shared buildMcpServers for STDIO entries and transforms
 * HTTP entries to use Codex's `http_headers` field instead of `headers`.
 */
export function buildCodexServers(
  config: WorkspaceConfig,
  resolvedTokens?: ResolvedTokens,
): Record<string, CodexServerEntry> {
  const shared = buildMcpServers(config, resolvedTokens);
  const codexServers: Record<string, CodexServerEntry> = {};

  for (const [key, entry] of Object.entries(shared)) {
    const codexKey = key.replace(TOOLKIT_PREFIX, CODEX_TOOLKIT_PREFIX);
    if (isUrlEntry(entry)) {
      const codexEntry: CodexHttpServer = { url: entry.url };
      if (entry.headers) {
        codexEntry.http_headers = entry.headers;
      }
      codexServers[codexKey] = codexEntry;
    } else {
      codexServers[codexKey] = entry;
    }
  }

  return codexServers;
}

/**
 * Merge toolkit-managed servers into an existing Codex config.
 * Preserves all non-toolkit entries (both mcp_servers and top-level config).
 */
export function mergeCodexConfig(
  existing: CodexConfig,
  toolkitServers: Record<string, CodexServerEntry>,
): CodexConfig {
  const existingServers = existing.mcp_servers ?? {};
  const merged: Record<string, CodexServerEntry> = {};

  for (const [key, value] of Object.entries(existingServers)) {
    if (!key.startsWith(CODEX_TOOLKIT_PREFIX) && !key.startsWith(TOOLKIT_PREFIX)) {
      merged[key] = value as CodexServerEntry;
    }
  }
  for (const [key, value] of Object.entries(toolkitServers)) {
    merged[key] = value;
  }

  const result = { ...existing };
  result.mcp_servers = merged;
  return result;
}

async function readExistingCodexConfig(
  configPath: string,
): Promise<CodexConfig> {
  try {
    const raw = await readFile(configPath, "utf-8");
    return parseToml(raw) as unknown as CodexConfig;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    return {};
  }
}

/**
 * Generate the Codex MCP config (.codex/config.toml) for a workspace.
 * Returns the file path and serialized content without writing to disk.
 */
export async function generateCodexConfig(
  config: WorkspaceConfig,
  cwd?: string,
  resolvedTokens?: ResolvedTokens,
): Promise<ConfigFileResult> {
  const projectDir = cwd ?? process.cwd();
  const configPath = resolve(projectDir, ".codex", "config.toml");

  const toolkitServers = buildCodexServers(config, resolvedTokens);
  const existing = await readExistingCodexConfig(configPath);
  const merged = mergeCodexConfig(existing, toolkitServers);
  const content = stringifyToml(merged as Record<string, unknown>) + "\n";

  return { path: configPath, content };
}

/**
 * Generate and write the Codex MCP config (.codex/config.toml) for a workspace.
 * Creates the `.codex/` directory if it doesn't exist.
 */
export async function writeCodexConfig(
  config: WorkspaceConfig,
  cwd?: string,
  resolvedTokens?: ResolvedTokens,
): Promise<ConfigFileResult> {
  const result = await generateCodexConfig(config, cwd, resolvedTokens);
  await mkdir(dirname(result.path), { recursive: true });
  await writeFile(result.path, result.content, "utf-8");
  return result;
}

// ---------------------------------------------------------------------------
// Gemini CLI: .gemini/settings.json
// ---------------------------------------------------------------------------

/**
 * Generate the Gemini CLI MCP config (.gemini/settings.json) for a workspace.
 * Uses the same { mcpServers } schema as Cursor and Claude Code.
 * Returns the file path and serialized content without writing to disk.
 */
export async function generateGeminiConfig(
  config: WorkspaceConfig,
  cwd?: string,
  resolvedTokens?: ResolvedTokens,
): Promise<ConfigFileResult> {
  const projectDir = cwd ?? process.cwd();
  const configPath = resolve(projectDir, ".gemini", "settings.json");

  const toolkitServers = buildMcpServers(config, resolvedTokens);
  const existing = await readExistingMcpConfig(configPath);
  const merged = mergeMcpConfig(existing, toolkitServers);
  const content = JSON.stringify(merged, null, 2) + "\n";

  return { path: configPath, content };
}

/**
 * Generate and write the Gemini CLI MCP config (.gemini/settings.json).
 * Creates the `.gemini/` directory if it doesn't exist.
 */
export async function writeGeminiConfig(
  config: WorkspaceConfig,
  cwd?: string,
  resolvedTokens?: ResolvedTokens,
): Promise<ConfigFileResult> {
  const result = await generateGeminiConfig(config, cwd, resolvedTokens);
  await mkdir(dirname(result.path), { recursive: true });
  await writeFile(result.path, result.content, "utf-8");
  return result;
}

// ---------------------------------------------------------------------------
// Client config verification
// ---------------------------------------------------------------------------

export interface VerificationEntry {
  server: string;
  expectedKey: string;
  status: "ok" | "missing";
}

export interface VerificationResult {
  client: string;
  configPath: string;
  fileExists: boolean;
  entries: VerificationEntry[];
}

interface ClientConfigSpec {
  path: string;
  schema: string;
  format: "json" | "toml";
}

const CLIENT_CONFIG_PATHS: Record<string, ClientConfigSpec> = {
  cursor: { path: ".cursor/mcp.json", schema: "mcpServers", format: "json" },
  "claude-code": { path: ".mcp.json", schema: "mcpServers", format: "json" },
  copilot: { path: ".vscode/mcp.json", schema: "servers", format: "json" },
  codex: { path: ".codex/config.toml", schema: "mcp_servers", format: "toml" },
  "gemini-cli": { path: ".gemini/settings.json", schema: "mcpServers", format: "json" },
};

/**
 * Verify that a client config file exists and contains the expected
 * toolkit-managed MCP server entries for each declared server.
 */
export async function verifyClientConfig(
  client: string,
  config: WorkspaceConfig,
  cwd?: string,
): Promise<VerificationResult> {
  const spec = CLIENT_CONFIG_PATHS[client];
  const prefix = client === "codex" ? CODEX_TOOLKIT_PREFIX : TOOLKIT_PREFIX;
  if (!spec) {
    return {
      client,
      configPath: "(unknown)",
      fileExists: false,
      entries: Object.keys(config.servers).sort().map((name) => ({
        server: name,
        expectedKey: `${prefix}${name}`,
        status: "missing" as const,
      })),
    };
  }

  const projectDir = cwd ?? process.cwd();
  const fullPath = resolve(projectDir, spec.path);

  let parsed: Record<string, unknown>;
  try {
    const raw = await readFile(fullPath, "utf-8");
    parsed = spec.format === "toml"
      ? parseToml(raw) as Record<string, unknown>
      : JSON.parse(raw);
  } catch {
    return {
      client,
      configPath: fullPath,
      fileExists: false,
      entries: Object.keys(config.servers).sort().map((name) => ({
        server: name,
        expectedKey: `${prefix}${name}`,
        status: "missing" as const,
      })),
    };
  }

  const serversObj = (parsed[spec.schema] ?? {}) as Record<string, unknown>;

  const entries: VerificationEntry[] = Object.keys(config.servers).sort().map((name) => {
    const expectedKey = `${prefix}${name}`;
    return {
      server: name,
      expectedKey,
      status: (expectedKey in serversObj ? "ok" : "missing") as "ok" | "missing",
    };
  });

  return {
    client,
    configPath: fullPath,
    fileExists: true,
    entries,
  };
}

// ---------------------------------------------------------------------------
// Extract embedded tokens from client config
// ---------------------------------------------------------------------------

/**
 * Read a client config file and extract tokens embedded in toolkit-managed
 * server entries back into env-key → value pairs.
 *
 * Tokens may be inlined in three ways depending on server type:
 * - URL entries: headers (via headerMapping)
 * - Command entries: args (via ${VAR} template substitution)
 * - Command entries: env block
 * - Docker entries: -e KEY=VALUE args
 *
 * This lets the doctor verify auth for providers whose tokens were written
 * into the config during init but are not present in the current shell env.
 */
export async function extractEmbeddedTokens(
  client: string,
  config: WorkspaceConfig,
  cwd?: string,
): Promise<Record<string, string>> {
  const spec = CLIENT_CONFIG_PATHS[client];
  if (!spec) return {};

  const projectDir = cwd ?? process.cwd();
  const fullPath = resolve(projectDir, spec.path);

  let parsed: Record<string, unknown>;
  try {
    const raw = await readFile(fullPath, "utf-8");
    parsed = spec.format === "toml"
      ? parseToml(raw) as Record<string, unknown>
      : JSON.parse(raw);
  } catch {
    return {};
  }

  const serversObj = (parsed[spec.schema] ?? {}) as Record<string, unknown>;
  const tokens: Record<string, string> = {};
  const isCodex = client === "codex";
  const prefix = isCodex ? CODEX_TOOLKIT_PREFIX : TOOLKIT_PREFIX;

  for (const name of Object.keys(config.servers)) {
    if (!isKnownServer(name)) continue;
    const defaults = getServerDefaults(name);
    if (!defaults) continue;

    const key = `${prefix}${name}`;
    const entry = serversObj[key] as Record<string, unknown> | undefined;
    if (!entry) continue;

    if (defaults.headerMapping) {
      const headerKey = isCodex ? "http_headers" : "headers";
      const headers = entry[headerKey] as Record<string, string> | undefined;
      if (headers) {
        for (const [headerName, envKey] of Object.entries(defaults.headerMapping)) {
          const value = headers[headerName];
          if (typeof value === "string" && value.length > 0) {
            tokens[envKey] = value;
          }
        }
      }
    }

    // Command entries: extract from env block
    const entryEnv = entry.env as Record<string, string> | undefined;
    if (entryEnv) {
      for (const envKey of Object.keys(defaults.envMapping)) {
        const value = entryEnv[envKey];
        if (typeof value === "string" && value.length > 0) {
          tokens[envKey] = value;
        }
      }
    }

    // Command entries: extract from args via ${VAR} template matching
    const templateArgs = defaults.args;
    const actualArgs = entry.args as string[] | undefined;
    if (templateArgs && actualArgs) {
      extractTokensFromArgs(templateArgs, actualArgs, defaults.envMapping, tokens);
    }
  }

  return tokens;
}

/**
 * Match actual args against template args to recover substituted values.
 * Handles both `${VAR}` placeholders and Docker `-e KEY=VALUE` patterns.
 */
function extractTokensFromArgs(
  templateArgs: string[],
  actualArgs: string[],
  envMapping: Record<string, string>,
  tokens: Record<string, string>,
): void {
  // Template-based: compare template and actual args positionally
  if (templateArgs.length === actualArgs.length) {
    for (let i = 0; i < templateArgs.length; i++) {
      const extracted = matchTemplateArg(templateArgs[i], actualArgs[i]);
      if (extracted) {
        for (const [varName, value] of Object.entries(extracted)) {
          if (varName in envMapping) {
            tokens[varName] = value;
          }
        }
      }
    }
  }

  // Docker -e KEY=VALUE: scan actual args for env vars
  const envKeys = new Set(Object.keys(envMapping));
  for (let i = 0; i < actualArgs.length; i++) {
    if (actualArgs[i] === "-e" && i + 1 < actualArgs.length) {
      const eqIdx = actualArgs[i + 1].indexOf("=");
      if (eqIdx > 0) {
        const k = actualArgs[i + 1].slice(0, eqIdx);
        const v = actualArgs[i + 1].slice(eqIdx + 1);
        if (envKeys.has(k) && v.length > 0) {
          tokens[k] = v;
        }
      }
    }
  }
}

/**
 * Given a template arg like `"Authorization: Bearer ${TOKEN}"` and
 * an actual arg like `"Authorization: Bearer abc123"`, returns
 * `{ TOKEN: "abc123" }`. Returns undefined if no placeholders or no match.
 */
function matchTemplateArg(
  template: string,
  actual: string,
): Record<string, string> | undefined {
  const varPattern = /\$\{(\w+)\}/;
  const match = varPattern.exec(template);
  if (!match) return undefined;

  const prefix = template.slice(0, match.index);
  const suffix = template.slice(match.index + match[0].length);

  if (!actual.startsWith(prefix)) return undefined;
  if (suffix.length > 0 && !actual.endsWith(suffix)) return undefined;

  const value = suffix.length > 0
    ? actual.slice(prefix.length, actual.length - suffix.length)
    : actual.slice(prefix.length);

  if (!value || value.length === 0) return undefined;

  return { [match[1]]: value };
}
