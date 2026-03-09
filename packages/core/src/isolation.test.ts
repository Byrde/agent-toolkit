/**
 * Zero-bleed isolation integration test.
 *
 * Verifies that running all toolkit write functions against a target
 * directory produces artifacts ONLY in that directory — nothing leaks
 * to sibling directories or the system temp root.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  writeCursorConfig,
  writeClaudeCodeConfig,
  writeCopilotConfig,
  writeCodexConfig,
  writeGeminiConfig,
  writeLocalConfig,
  updateGitignore,
  writeCursorInstructions,
  writeClaudeCodeInstructions,
  writeCopilotInstructions,
  writeCodexInstructions,
  writeGeminiInstructions,
} from "./index.js";
import type { WorkspaceConfig, LocalConfig } from "./domain/manifest.js";

const TEST_CONFIG: WorkspaceConfig = {
  servers: { github: {}, terraform: {} },
};

const TEST_LOCAL: LocalConfig = {
  identity: { github: { account: "test-user" } },
};

const TEST_INSTRUCTIONS = "# MCP Server Instructions\n\nUse GitHub for PRs.";

const TOOLKIT_ARTIFACTS = [
  ".cursor/mcp.json",
  ".cursor/rules/agent-toolkit.mdc",
  ".mcp.json",
  ".vscode/mcp.json",
  ".codex/config.toml",
  ".gemini/settings.json",
  ".gitignore",
  ".agent-toolkit.local.json",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
  "AGENTS.md",
  "GEMINI.md",
];

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readdirRecursive(dir: string): Promise<string[]> {
  const entries: string[] = [];
  let items: string[];
  try {
    items = await readdir(dir);
  } catch {
    return entries;
  }
  for (const item of items) {
    const full = join(dir, item);
    const s = await stat(full);
    if (s.isDirectory()) {
      entries.push(...(await readdirRecursive(full)));
    } else {
      entries.push(full);
    }
  }
  return entries;
}

describe("zero-bleed isolation", () => {
  let parentDir: string;
  let projectDir: string;
  let cleanDir: string;

  before(async () => {
    parentDir = await mkdtemp(join(tmpdir(), "toolkit-isolation-"));
    projectDir = join(parentDir, "project");
    cleanDir = join(parentDir, "clean");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(projectDir, { recursive: true });
    await mkdir(cleanDir, { recursive: true });

    await writeCursorConfig(TEST_CONFIG, projectDir);
    await writeClaudeCodeConfig(TEST_CONFIG, projectDir);
    await writeCopilotConfig(TEST_CONFIG, projectDir);
    await writeCodexConfig(TEST_CONFIG, projectDir);
    await writeGeminiConfig(TEST_CONFIG, projectDir);
    await writeLocalConfig(TEST_LOCAL, projectDir);
    await updateGitignore(projectDir);
    await writeCursorInstructions(TEST_INSTRUCTIONS, projectDir);
    await writeClaudeCodeInstructions(TEST_INSTRUCTIONS, projectDir);
    await writeCopilotInstructions(TEST_INSTRUCTIONS, projectDir);
    await writeCodexInstructions(TEST_INSTRUCTIONS, projectDir);
    await writeGeminiInstructions(TEST_INSTRUCTIONS, projectDir);
  });

  after(async () => {
    await rm(parentDir, { recursive: true, force: true });
  });

  it("writes all expected artifacts to the project directory", async () => {
    for (const artifact of TOOLKIT_ARTIFACTS) {
      const fullPath = join(projectDir, artifact);
      assert.ok(
        await exists(fullPath),
        `Expected artifact missing: ${artifact}`,
      );
    }
  });

  it("writes zero files to the sibling clean directory", async () => {
    const files = await readdirRecursive(cleanDir);
    assert.equal(
      files.length,
      0,
      `Clean directory should be empty but contains: ${files.map((f) => f.replace(cleanDir + "/", "")).join(", ")}`,
    );
  });

  it("writes zero toolkit artifacts outside the project directory", async () => {
    const allFiles = await readdirRecursive(parentDir);
    const leakedFiles = allFiles.filter(
      (f) => !f.startsWith(projectDir + "/") && !f.startsWith(cleanDir + "/"),
    );
    assert.equal(
      leakedFiles.length,
      0,
      `Files leaked outside project dir: ${leakedFiles.map((f) => f.replace(parentDir + "/", "")).join(", ")}`,
    );
  });
});
