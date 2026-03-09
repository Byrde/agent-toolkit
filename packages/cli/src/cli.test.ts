import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildConfig, buildInstructions, writeConfig } from "./cli.js";

describe("buildConfig", () => {
  it("creates server entries with usage notes in settings", () => {
    const config = buildConfig([
      { name: "github", notes: "We use GitHub for CI and code review", settings: {} },
      { name: "terraform", notes: "Manages our GCP infra via Cloud Build", settings: {} },
    ]);

    assert.deepStrictEqual(config, {
      servers: {
        github: { settings: { usageNotes: "We use GitHub for CI and code review" } },
        terraform: { settings: { usageNotes: "Manages our GCP infra via Cloud Build" } },
      },
    });
  });

  it("creates empty server entry when notes are blank and no settings", () => {
    const config = buildConfig([
      { name: "github", notes: "", settings: {} },
    ]);

    assert.deepStrictEqual(config, {
      servers: {
        github: {},
      },
    });
  });

  it("trims whitespace and newlines from notes", () => {
    const config = buildConfig([
      { name: "github", notes: "\n  CI pipelines and PR reviews  \n\n", settings: {} },
    ]);

    assert.deepStrictEqual(config, {
      servers: {
        github: { settings: { usageNotes: "CI pipelines and PR reviews" } },
      },
    });
  });

  it("treats whitespace-only notes as empty", () => {
    const config = buildConfig([
      { name: "gcp", notes: "   \n\n  ", settings: {} },
    ]);

    assert.deepStrictEqual(config, {
      servers: {
        gcp: {},
      },
    });
  });

  it("handles multiple servers with mixed notes", () => {
    const config = buildConfig([
      { name: "github", notes: "Code review", settings: {} },
      { name: "gcp", notes: "", settings: {} },
      { name: "terraform", notes: "Infra as code", settings: {} },
    ]);

    assert.deepStrictEqual(config, {
      servers: {
        github: { settings: { usageNotes: "Code review" } },
        gcp: {},
        terraform: { settings: { usageNotes: "Infra as code" } },
      },
    });
  });

  it("returns empty servers for empty input", () => {
    const config = buildConfig([]);
    assert.deepStrictEqual(config, { servers: {} });
  });

  it("merges scoping settings with usage notes", () => {
    const config = buildConfig([
      {
        name: "github",
        notes: "CI and PRs",
        settings: { organization: "badal", repositories: ["platform-agent-toolkit"] },
      },
      {
        name: "terraform",
        notes: "",
        settings: { organization: "badal", workspaces: ["staging", "prod"] },
      },
    ]);

    assert.deepStrictEqual(config, {
      servers: {
        github: {
          settings: {
            organization: "badal",
            repositories: ["platform-agent-toolkit"],
            usageNotes: "CI and PRs",
          },
        },
        terraform: {
          settings: {
            organization: "badal",
            workspaces: ["staging", "prod"],
          },
        },
      },
    });
  });

  it("strips empty arrays and blank strings from settings", () => {
    const config = buildConfig([
      {
        name: "gcp",
        notes: "",
        settings: { projects: [], region: "" },
      },
    ]);

    assert.deepStrictEqual(config, {
      servers: { gcp: {} },
    });
  });
});

describe("buildInstructions", () => {
  it("generates markdown with server headings and usage notes", () => {
    const config = buildConfig([
      { name: "github", notes: "CI and code review", settings: {} },
      { name: "terraform", notes: "Manages GCP infra", settings: {} },
    ]);
    const result = buildInstructions(config);

    assert.ok(result.includes("## github"));
    assert.ok(result.includes("CI and code review"));
    assert.ok(result.includes("## terraform"));
    assert.ok(result.includes("Manages GCP infra"));
  });

  it("lists servers without notes when usage notes are empty", () => {
    const config = buildConfig([
      { name: "github", notes: "", settings: {} },
      { name: "gcp", notes: "", settings: {} },
    ]);
    const result = buildInstructions(config);

    assert.ok(result.includes("## github"));
    assert.ok(result.includes("## gcp"));
    assert.ok(!result.includes("undefined"));
  });

  it("returns empty string when no servers configured", () => {
    const result = buildInstructions({ servers: {} });
    assert.strictEqual(result, "");
  });
});

describe("writeConfig", () => {
  let tmpDir: string;

  it("writes config as formatted JSON to the target path", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-cli-test-"));
    try {
      const config = buildConfig([
        { name: "github", notes: "CI and code review", settings: { organization: "badal" } },
        { name: "gcp", notes: "", settings: {} },
      ]);

      const writtenPath = await writeConfig(config, tmpDir);

      assert.ok(writtenPath.endsWith(".agent-toolkit.json"));

      const raw = await readFile(writtenPath, "utf-8");
      const parsed = JSON.parse(raw);

      assert.deepStrictEqual(parsed, {
        servers: {
          github: { settings: { organization: "badal", usageNotes: "CI and code review" } },
          gcp: {},
        },
      });

      assert.ok(raw.endsWith("\n"), "file should end with newline");
      assert.ok(raw.includes("\n  "), "file should be formatted with indentation");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("overwrites existing config on re-run", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-cli-test-"));
    try {
      const config1 = buildConfig([{ name: "github", notes: "v1 notes", settings: {} }]);
      await writeConfig(config1, tmpDir);

      const config2 = buildConfig([
        { name: "github", notes: "v2 notes", settings: {} },
        { name: "terraform", notes: "Added later", settings: { organization: "acme" } },
      ]);
      const writtenPath = await writeConfig(config2, tmpDir);

      const raw = await readFile(writtenPath, "utf-8");
      const parsed = JSON.parse(raw);

      assert.deepStrictEqual(parsed, {
        servers: {
          github: { settings: { usageNotes: "v2 notes" } },
          terraform: { settings: { organization: "acme", usageNotes: "Added later" } },
        },
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
