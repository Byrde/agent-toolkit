/**
 * Workspace config loader.
 *
 * Reads `.agent-toolkit.json` from the project directory.
 * No cascade, no global config — single file per project.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type WorkspaceConfig,
  type LocalConfig,
  DEFAULT_CONFIG,
  DEFAULT_LOCAL_CONFIG,
} from "./domain/manifest.js";

export const CONFIG_FILE = ".agent-toolkit.json";
export const LOCAL_CONFIG_FILE = ".agent-toolkit.local.json";

export function getConfigPath(cwd?: string): string {
  return resolve(cwd ?? process.cwd(), CONFIG_FILE);
}

async function readJsonFile(path: string): Promise<unknown | undefined> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") return undefined;
    throw new Error(`Failed to read config at ${path}: ${(err as Error).message}`);
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertConfigShape(value: unknown, path: string): Partial<WorkspaceConfig> {
  if (!isPlainObject(value)) {
    throw new Error(`Config at ${path} must be a JSON object`);
  }
  if (value.servers !== undefined && !isPlainObject(value.servers)) {
    throw new Error(`"servers" in ${path} must be an object`);
  }
  return value as Partial<WorkspaceConfig>;
}

/**
 * Load the workspace config from `.agent-toolkit.json` in the given directory.
 * Returns defaults when no config file exists.
 */
export async function loadConfig(cwd?: string): Promise<WorkspaceConfig> {
  const configPath = getConfigPath(cwd);
  const raw = await readJsonFile(configPath);

  if (raw === undefined) {
    return { ...DEFAULT_CONFIG, servers: {} };
  }

  const partial = assertConfigShape(raw, configPath);
  const servers = partial.servers ?? {};

  return {
    servers,
    instructions: partial.instructions,
  };
}

// ---------------------------------------------------------------------------
// Local config — per-project identity pinning
// ---------------------------------------------------------------------------

export function getLocalConfigPath(cwd?: string): string {
  return resolve(cwd ?? process.cwd(), LOCAL_CONFIG_FILE);
}

function assertLocalConfigShape(value: unknown, path: string): Partial<LocalConfig> {
  if (!isPlainObject(value)) {
    throw new Error(`Local config at ${path} must be a JSON object`);
  }
  if (value.identity !== undefined && !isPlainObject(value.identity)) {
    throw new Error(`"identity" in ${path} must be an object`);
  }
  return value as Partial<LocalConfig>;
}

/**
 * Load the local config from `.agent-toolkit.local.json` in the given directory.
 * Returns empty defaults when no local config file exists.
 */
export async function loadLocalConfig(cwd?: string): Promise<LocalConfig> {
  const localPath = getLocalConfigPath(cwd);
  const raw = await readJsonFile(localPath);

  if (raw === undefined) {
    return { ...DEFAULT_LOCAL_CONFIG };
  }

  const partial = assertLocalConfigShape(raw, localPath);
  return {
    identity: partial.identity,
  };
}

/**
 * Write the local config to `.agent-toolkit.local.json` in the given directory.
 * Merges with any existing file to preserve manually-set entries.
 */
export async function writeLocalConfig(
  localConfig: LocalConfig,
  cwd?: string,
): Promise<string> {
  const localPath = getLocalConfigPath(cwd);

  let existing: LocalConfig = {};
  try {
    existing = await loadLocalConfig(cwd);
  } catch {
    // start fresh if existing file is corrupt
  }

  const merged: LocalConfig = {
    identity: {
      ...existing.identity,
      ...localConfig.identity,
    },
  };

  await writeFile(localPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return localPath;
}
