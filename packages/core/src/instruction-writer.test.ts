import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  upsertFencedSection,
  writeCursorInstructions,
  writeClaudeCodeInstructions,
  writeCopilotInstructions,
  writeCodexInstructions,
  writeGeminiInstructions,
  writeInstructions,
  BEGIN_MARKER,
  END_MARKER,
} from "./instruction-writer.js";

const SAMPLE_INSTRUCTIONS = "## MCP Servers\n\nUse GitHub for PRs and issues.";

// ---------------------------------------------------------------------------
// upsertFencedSection (pure)
// ---------------------------------------------------------------------------

describe("upsertFencedSection", () => {
  it("appends fenced section to existing content", () => {
    const existing = "# My Project\n\nSome user content.\n";
    const result = upsertFencedSection(existing, SAMPLE_INSTRUCTIONS);

    assert.ok(result.includes("# My Project"));
    assert.ok(result.includes("Some user content."));
    assert.ok(result.includes(BEGIN_MARKER));
    assert.ok(result.includes(END_MARKER));
    assert.ok(result.includes(SAMPLE_INSTRUCTIONS));
  });

  it("replaces existing fenced section in place", () => {
    const existing = [
      "# My Project",
      "",
      BEGIN_MARKER,
      "Old instructions here.",
      END_MARKER,
      "",
      "# User section at end",
    ].join("\n");

    const result = upsertFencedSection(existing, SAMPLE_INSTRUCTIONS);

    assert.ok(result.includes("# My Project"));
    assert.ok(result.includes("# User section at end"));
    assert.ok(result.includes(SAMPLE_INSTRUCTIONS));
    assert.ok(!result.includes("Old instructions here."));
    const beginCount = result.split(BEGIN_MARKER).length - 1;
    assert.equal(beginCount, 1, "should have exactly one fenced section");
  });

  it("creates content from empty string", () => {
    const result = upsertFencedSection("", SAMPLE_INSTRUCTIONS);

    assert.ok(result.startsWith(BEGIN_MARKER));
    assert.ok(result.includes(END_MARKER));
    assert.ok(result.includes(SAMPLE_INSTRUCTIONS));
    assert.ok(result.endsWith("\n"));
  });

  it("is idempotent on repeated calls", () => {
    const first = upsertFencedSection("", SAMPLE_INSTRUCTIONS);
    const second = upsertFencedSection(first, SAMPLE_INSTRUCTIONS);
    assert.equal(first, second);
  });
});

// ---------------------------------------------------------------------------
// writeCursorInstructions (dedicated file)
// ---------------------------------------------------------------------------

describe("writeCursorInstructions", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-cursor-instr-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .cursor/rules/agent-toolkit.mdc with frontmatter", async () => {
    const result = await writeCursorInstructions(SAMPLE_INSTRUCTIONS, tmpDir);
    const content = await readFile(result.path, "utf-8");

    assert.ok(content.startsWith("---\n"));
    assert.ok(content.includes("alwaysApply: true"));
    assert.ok(content.includes(SAMPLE_INSTRUCTIONS));
    assert.ok(result.path.endsWith(".cursor/rules/agent-toolkit.mdc"));
  });

  it("overwrites on re-run (idempotent)", async () => {
    await writeCursorInstructions(SAMPLE_INSTRUCTIONS, tmpDir);
    const first = await readFile(
      join(tmpDir, ".cursor", "rules", "agent-toolkit.mdc"),
      "utf-8",
    );

    await writeCursorInstructions("Updated instructions.", tmpDir);
    const second = await readFile(
      join(tmpDir, ".cursor", "rules", "agent-toolkit.mdc"),
      "utf-8",
    );

    assert.ok(!second.includes(SAMPLE_INSTRUCTIONS));
    assert.ok(second.includes("Updated instructions."));
    assert.ok(first !== second);
  });
});

// ---------------------------------------------------------------------------
// Fenced-section writers
// ---------------------------------------------------------------------------

describe("writeClaudeCodeInstructions", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-claude-instr-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates CLAUDE.md with fenced section when file does not exist", async () => {
    const result = await writeClaudeCodeInstructions(SAMPLE_INSTRUCTIONS, tmpDir);
    const content = await readFile(result.path, "utf-8");

    assert.ok(result.path.endsWith("CLAUDE.md"));
    assert.ok(content.includes(BEGIN_MARKER));
    assert.ok(content.includes(END_MARKER));
    assert.ok(content.includes(SAMPLE_INSTRUCTIONS));
  });

  it("preserves user content and replaces fenced section on re-run", async () => {
    const userContent = "# My Claude Instructions\n\nDo good work.\n";
    await writeFile(join(tmpDir, "CLAUDE.md"), userContent, "utf-8");

    await writeClaudeCodeInstructions(SAMPLE_INSTRUCTIONS, tmpDir);
    const first = await readFile(join(tmpDir, "CLAUDE.md"), "utf-8");
    assert.ok(first.includes("# My Claude Instructions"));
    assert.ok(first.includes(SAMPLE_INSTRUCTIONS));

    await writeClaudeCodeInstructions("New instructions.", tmpDir);
    const second = await readFile(join(tmpDir, "CLAUDE.md"), "utf-8");
    assert.ok(second.includes("# My Claude Instructions"));
    assert.ok(second.includes("New instructions."));
    assert.ok(!second.includes(SAMPLE_INSTRUCTIONS));
  });
});

describe("writeCopilotInstructions", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-copilot-instr-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .github/copilot-instructions.md with fenced section", async () => {
    const result = await writeCopilotInstructions(SAMPLE_INSTRUCTIONS, tmpDir);
    const content = await readFile(result.path, "utf-8");

    assert.ok(result.path.endsWith(".github/copilot-instructions.md"));
    assert.ok(content.includes(BEGIN_MARKER));
    assert.ok(content.includes(SAMPLE_INSTRUCTIONS));
  });
});

describe("writeCodexInstructions", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-codex-instr-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates AGENTS.md with fenced section", async () => {
    const result = await writeCodexInstructions(SAMPLE_INSTRUCTIONS, tmpDir);
    const content = await readFile(result.path, "utf-8");

    assert.ok(result.path.endsWith("AGENTS.md"));
    assert.ok(content.includes(BEGIN_MARKER));
    assert.ok(content.includes(SAMPLE_INSTRUCTIONS));
  });
});

describe("writeGeminiInstructions", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-gemini-instr-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates GEMINI.md with fenced section", async () => {
    const result = await writeGeminiInstructions(SAMPLE_INSTRUCTIONS, tmpDir);
    const content = await readFile(result.path, "utf-8");

    assert.ok(result.path.endsWith("GEMINI.md"));
    assert.ok(content.includes(BEGIN_MARKER));
    assert.ok(content.includes(SAMPLE_INSTRUCTIONS));
  });
});

// ---------------------------------------------------------------------------
// Unified writeInstructions dispatcher
// ---------------------------------------------------------------------------

describe("writeInstructions", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-unified-instr-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("dispatches to Cursor writer for 'cursor' client", async () => {
    const result = await writeInstructions("cursor", SAMPLE_INSTRUCTIONS, tmpDir);
    assert.ok(result.path.endsWith("agent-toolkit.mdc"));
    assert.ok(result.content.includes("alwaysApply: true"));
  });

  it("dispatches to fenced writer for 'claude-code' client", async () => {
    const result = await writeInstructions("claude-code", SAMPLE_INSTRUCTIONS, tmpDir);
    assert.ok(result.path.endsWith("CLAUDE.md"));
    assert.ok(result.content.includes(BEGIN_MARKER));
  });

  it("throws for unknown client", async () => {
    await assert.rejects(
      () => writeInstructions("unknown-client", SAMPLE_INSTRUCTIONS, tmpDir),
      { message: /Unknown instruction target/ },
    );
  });
});
