/**
 * Gitignore management — maintains a fenced section of toolkit-managed
 * entries in the project's .gitignore file.
 *
 * The fenced section is delimited by BEGIN/END markers. Content outside
 * the markers is never touched. On re-run the fenced section is replaced
 * in place, making the operation idempotent.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const BEGIN_MARKER = "# BEGIN agent-toolkit managed — do not edit this section";
const END_MARKER = "# END agent-toolkit managed";

/** All files the toolkit may generate, regardless of which client is active. */
const MANAGED_ENTRIES = [
  // MCP config files
  ".cursor/mcp.json",
  ".mcp.json",
  ".vscode/mcp.json",
  ".codex/config.toml",
  ".gemini/settings.json",
  // Agent instruction files
  ".cursor/rules/agent-toolkit.mdc",
  ".github/copilot-instructions.md",
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  // Local config (secrets, tokens)
  ".agent-toolkit.local.json",
];

export { BEGIN_MARKER, END_MARKER, MANAGED_ENTRIES };

function buildFencedBlock(entries: readonly string[]): string {
  return [BEGIN_MARKER, ...entries, END_MARKER].join("\n");
}

/**
 * Insert or replace the toolkit-managed fenced section in a .gitignore string.
 * Returns the updated content. Pure function — no I/O.
 */
export function upsertGitignoreSection(
  existing: string,
  entries: readonly string[] = MANAGED_ENTRIES,
): string {
  const block = buildFencedBlock(entries);

  const beginIdx = existing.indexOf(BEGIN_MARKER);
  const endIdx = existing.indexOf(END_MARKER);

  if (beginIdx !== -1 && endIdx !== -1) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + END_MARKER.length);
    return before + block + after;
  }

  const trimmed = existing.trimEnd();
  if (trimmed.length === 0) return block + "\n";
  return trimmed + "\n\n" + block + "\n";
}

/**
 * Read the project .gitignore (or start from empty), upsert the
 * toolkit-managed section, and write it back. Creates the file if absent.
 */
export async function updateGitignore(cwd?: string): Promise<string> {
  const projectDir = cwd ?? process.cwd();
  const gitignorePath = resolve(projectDir, ".gitignore");

  let existing: string;
  try {
    existing = await readFile(gitignorePath, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      existing = "";
    } else {
      throw err;
    }
  }

  const updated = upsertGitignoreSection(existing);
  await writeFile(gitignorePath, updated, "utf-8");
  return gitignorePath;
}
