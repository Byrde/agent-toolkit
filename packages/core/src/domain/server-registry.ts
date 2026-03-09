/**
 * Default MCP server definitions for known servers.
 *
 * Each entry describes how to launch the server (npx or docker)
 * and which environment variables carry auth tokens.
 */

import type { ServerName } from "./manifest.js";

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpServerDefaults {
  command?: string;
  args?: string[];
  url?: string;
  envMapping: Record<string, string>;
  /** For URL-based servers: maps HTTP header names to envMapping keys. */
  headerMapping?: Record<string, string>;
  /**
   * Raw credential env vars the CLI should prompt for.
   * When present, the CLI uses these for credential collection instead of
   * envMapping keys — decoupling "what the user provides" from "what gets
   * injected into the config template" (e.g. Basic auth computed values).
   */
  promptKeys?: Record<string, string>;
  /**
   * When true, this server is excluded from the headless AI-client diagnostic.
   * Useful for servers that authenticate via browser-based OAuth and cannot
   * be verified in a non-interactive CLI session.
   */
  skipDiagnostic?: boolean;
}

const KNOWN_DEFAULTS: Record<string, McpServerDefaults> = {
  github: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envMapping: { GITHUB_PERSONAL_ACCESS_TOKEN: "GITHUB_PERSONAL_ACCESS_TOKEN" },
  },
  gcp: {
    command: "npx",
    args: ["-y", "@google-cloud/gcloud-mcp"],
    envMapping: {},
  },
  terraform: {
    command: "docker",
    args: ["run", "-i", "--rm", "hashicorp/terraform-mcp-server:0.4.0"],
    envMapping: { TFE_TOKEN: "TFE_TOKEN" },
  },
  atlassian: {
    command: "npx",
    args: ["-y", "mcp-remote@latest", "https://mcp.atlassian.com/v1/mcp"],
    envMapping: {},
  },
};

export function getServerDefaults(name: ServerName): McpServerDefaults | undefined {
  return KNOWN_DEFAULTS[name];
}

export function isKnownServer(name: string): boolean {
  return name in KNOWN_DEFAULTS;
}

export function shouldSkipDiagnostic(name: string): boolean {
  return KNOWN_DEFAULTS[name]?.skipDiagnostic === true;
}

/**
 * Returns true when the resolved launch command for a server is `docker`.
 * Checks the explicit declaration first, then falls back to registry defaults.
 */
export function serverUsesDocker(
  name: string,
  declaration?: { command?: string; url?: string },
): boolean {
  if (declaration?.command) return declaration.command === "docker";
  if (declaration?.url) return false;
  return KNOWN_DEFAULTS[name]?.command === "docker";
}
