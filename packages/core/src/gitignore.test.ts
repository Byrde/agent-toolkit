import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  upsertGitignoreSection,
  updateGitignore,
  BEGIN_MARKER,
  END_MARKER,
  MANAGED_ENTRIES,
} from "./gitignore.js";

describe("upsertGitignoreSection", () => {
  it("appends fenced section to existing content", () => {
    const existing = "node_modules/\ndist/\n";
    const result = upsertGitignoreSection(existing);

    assert.ok(result.includes("node_modules/"));
    assert.ok(result.includes("dist/"));
    assert.ok(result.includes(BEGIN_MARKER));
    assert.ok(result.includes(END_MARKER));
    for (const entry of MANAGED_ENTRIES) {
      assert.ok(result.includes(entry));
    }
  });

  it("replaces existing fenced section in place", () => {
    const existing = [
      "node_modules/",
      "",
      BEGIN_MARKER,
      ".cursor/mcp.json",
      END_MARKER,
      "",
      "# user comment at end",
    ].join("\n");

    const result = upsertGitignoreSection(existing, [".cursor/mcp.json", ".mcp.json", ".vscode/mcp.json"]);

    assert.ok(result.includes("node_modules/"));
    assert.ok(result.includes("# user comment at end"));
    assert.ok(result.includes(".mcp.json"));
    assert.ok(result.includes(".vscode/mcp.json"));
    const beginCount = result.split(BEGIN_MARKER).length - 1;
    assert.equal(beginCount, 1, "should have exactly one fenced section");
  });

  it("creates content from empty string", () => {
    const result = upsertGitignoreSection("");

    assert.ok(result.startsWith(BEGIN_MARKER));
    assert.ok(result.includes(END_MARKER));
    assert.ok(result.endsWith("\n"));
  });
});

describe("updateGitignore", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-gitignore-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .gitignore when none exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "toolkit-gi-new-"));
    try {
      const path = await updateGitignore(dir);
      const content = await readFile(path, "utf-8");

      assert.ok(content.includes(BEGIN_MARKER));
      assert.ok(content.includes(".cursor/mcp.json"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves existing content and appends fenced section", async () => {
    await writeFile(join(tmpDir, ".gitignore"), "node_modules/\n", "utf-8");

    await updateGitignore(tmpDir);
    const content = await readFile(join(tmpDir, ".gitignore"), "utf-8");

    assert.ok(content.includes("node_modules/"));
    assert.ok(content.includes(BEGIN_MARKER));
    assert.ok(content.includes(".mcp.json"));
  });

  it("is idempotent on repeated calls", async () => {
    await updateGitignore(tmpDir);
    const first = await readFile(join(tmpDir, ".gitignore"), "utf-8");

    await updateGitignore(tmpDir);
    const second = await readFile(join(tmpDir, ".gitignore"), "utf-8");

    assert.equal(first, second);
  });
});
