/**
 * Instruction Writer Context — writes agent instructions to
 * client-specific file formats.
 *
 * Two strategies:
 * 1. Dedicated file (Cursor): full file replacement with frontmatter.
 * 2. Fenced section (Claude Code, Copilot, Codex, Gemini):
 *    insert/replace content between markers, preserving user content.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { ConfigFileResult } from "./config-generator.js";

// ---------------------------------------------------------------------------
// Fenced section markers
// ---------------------------------------------------------------------------

const BEGIN_MARKER = "<!-- BEGIN agent-toolkit -->";
const END_MARKER = "<!-- END agent-toolkit -->";

export { BEGIN_MARKER, END_MARKER };

// ---------------------------------------------------------------------------
// Fenced section utility (pure)
// ---------------------------------------------------------------------------

/**
 * Insert or replace a fenced section in a Markdown string.
 * Content outside the markers is never touched.
 * If no markers exist, the fenced section is appended.
 */
export function upsertFencedSection(
  existing: string,
  content: string,
): string {
  const block = [BEGIN_MARKER, content, END_MARKER].join("\n");

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

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw err;
  }
}

async function ensureWriteFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Client instruction file paths
// ---------------------------------------------------------------------------

export interface InstructionTarget {
  relativePath: string;
  strategy: "dedicated" | "fenced";
}

export const INSTRUCTION_TARGETS: Record<string, InstructionTarget> = {
  cursor: { relativePath: ".cursor/rules/agent-toolkit.mdc", strategy: "dedicated" },
  "claude-code": { relativePath: "CLAUDE.md", strategy: "fenced" },
  copilot: { relativePath: ".github/copilot-instructions.md", strategy: "fenced" },
  codex: { relativePath: "AGENTS.md", strategy: "fenced" },
  "gemini-cli": { relativePath: "GEMINI.md", strategy: "fenced" },
};

// ---------------------------------------------------------------------------
// Cursor: dedicated .mdc file with YAML frontmatter
// ---------------------------------------------------------------------------

const CURSOR_FRONTMATTER = [
  "---",
  "alwaysApply: true",
  "description: Agent toolkit orchestration — MCP server usage, cross-server workflows, and context-gathering guidance.",
  "---",
].join("\n");

function buildCursorMdc(instructions: string): string {
  return CURSOR_FRONTMATTER + "\n" + instructions + "\n";
}

export function generateCursorInstructions(instructions: string): ConfigFileResult {
  const target = INSTRUCTION_TARGETS.cursor;
  return {
    path: target.relativePath,
    content: buildCursorMdc(instructions),
  };
}

export async function writeCursorInstructions(
  instructions: string,
  cwd?: string,
): Promise<ConfigFileResult> {
  const target = INSTRUCTION_TARGETS.cursor;
  const fullPath = resolve(cwd ?? process.cwd(), target.relativePath);
  const content = buildCursorMdc(instructions);
  await ensureWriteFile(fullPath, content);
  return { path: fullPath, content };
}

// ---------------------------------------------------------------------------
// Fenced-section writers (Claude Code, Copilot, Codex, Gemini)
// ---------------------------------------------------------------------------

async function generateFencedInstructions(
  client: string,
  instructions: string,
  cwd?: string,
): Promise<ConfigFileResult> {
  const target = INSTRUCTION_TARGETS[client];
  if (!target || target.strategy !== "fenced") {
    throw new Error(`No fenced instruction target for client: ${client}`);
  }
  const fullPath = resolve(cwd ?? process.cwd(), target.relativePath);
  const existing = await readFileOrEmpty(fullPath);
  const content = upsertFencedSection(existing, instructions);
  return { path: fullPath, content };
}

async function writeFencedInstructions(
  client: string,
  instructions: string,
  cwd?: string,
): Promise<ConfigFileResult> {
  const result = await generateFencedInstructions(client, instructions, cwd);
  await ensureWriteFile(result.path, result.content);
  return result;
}

// -- Claude Code -------------------------------------------------------------

export function generateClaudeCodeInstructions(
  instructions: string,
  cwd?: string,
): Promise<ConfigFileResult> {
  return generateFencedInstructions("claude-code", instructions, cwd);
}

export function writeClaudeCodeInstructions(
  instructions: string,
  cwd?: string,
): Promise<ConfigFileResult> {
  return writeFencedInstructions("claude-code", instructions, cwd);
}

// -- Copilot -----------------------------------------------------------------

export function generateCopilotInstructions(
  instructions: string,
  cwd?: string,
): Promise<ConfigFileResult> {
  return generateFencedInstructions("copilot", instructions, cwd);
}

export function writeCopilotInstructions(
  instructions: string,
  cwd?: string,
): Promise<ConfigFileResult> {
  return writeFencedInstructions("copilot", instructions, cwd);
}

// -- Codex -------------------------------------------------------------------

export function generateCodexInstructions(
  instructions: string,
  cwd?: string,
): Promise<ConfigFileResult> {
  return generateFencedInstructions("codex", instructions, cwd);
}

export function writeCodexInstructions(
  instructions: string,
  cwd?: string,
): Promise<ConfigFileResult> {
  return writeFencedInstructions("codex", instructions, cwd);
}

// -- Gemini CLI --------------------------------------------------------------

export function generateGeminiInstructions(
  instructions: string,
  cwd?: string,
): Promise<ConfigFileResult> {
  return generateFencedInstructions("gemini-cli", instructions, cwd);
}

export function writeGeminiInstructions(
  instructions: string,
  cwd?: string,
): Promise<ConfigFileResult> {
  return writeFencedInstructions("gemini-cli", instructions, cwd);
}

// ---------------------------------------------------------------------------
// Unified writer — dispatches to the correct strategy by client
// ---------------------------------------------------------------------------

export async function generateInstructions(
  client: string,
  instructions: string,
  cwd?: string,
): Promise<ConfigFileResult> {
  const target = INSTRUCTION_TARGETS[client];
  if (!target) {
    throw new Error(`Unknown instruction target: ${client}`);
  }
  if (target.strategy === "dedicated") {
    const fullPath = resolve(cwd ?? process.cwd(), target.relativePath);
    const content = buildCursorMdc(instructions);
    return { path: fullPath, content };
  }
  return generateFencedInstructions(client, instructions, cwd);
}

export async function writeInstructions(
  client: string,
  instructions: string,
  cwd?: string,
): Promise<ConfigFileResult> {
  const target = INSTRUCTION_TARGETS[client];
  if (!target) {
    throw new Error(`Unknown instruction target: ${client}`);
  }
  if (target.strategy === "dedicated") {
    return writeCursorInstructions(instructions, cwd);
  }
  return writeFencedInstructions(client, instructions, cwd);
}
