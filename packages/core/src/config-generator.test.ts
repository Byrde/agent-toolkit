import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseToml } from "smol-toml";
import {
  TOOLKIT_PREFIX,
  CODEX_TOOLKIT_PREFIX,
  buildMcpServers,
  buildCursorServers,
  mergeMcpConfig,
  mergeCursorConfig,
  generateCursorConfig,
  writeCursorConfig,
  generateClaudeCodeConfig,
  writeClaudeCodeConfig,
  buildCopilotServers,
  mergeCopilotConfig,
  generateCopilotConfig,
  writeCopilotConfig,
  buildCodexServers,
  mergeCodexConfig,
  generateCodexConfig,
  writeCodexConfig,
  generateGeminiConfig,
  writeGeminiConfig,
  verifyClientConfig,
  extractEmbeddedTokens,
  type McpConfig,
  type CursorMcpConfig,
  type CopilotMcpConfig,
  type CopilotStdioServer,
  type CopilotHttpServer,
  type CodexConfig,
  type CodexHttpServer,
} from "./config-generator.js";
import type { WorkspaceConfig } from "./domain/manifest.js";

describe("buildCursorServers", () => {
  it("builds entries for known servers using defaults", () => {
    const config: WorkspaceConfig = {
      servers: { github: {}, terraform: {} },
    };
    const servers = buildCursorServers(config);

    assert.ok(servers["agent-toolkit:github"]);
    assert.equal(
      (servers["agent-toolkit:github"] as { command: string }).command,
      "npx",
    );
    assert.ok(servers["agent-toolkit:terraform"]);
  });

  it("uses user-provided command/args/env overrides", () => {
    const config: WorkspaceConfig = {
      servers: {
        github: {
          command: "my-gh-server",
          args: ["--port", "3000"],
          env: { MY_TOKEN: "secret" },
        },
      },
    };
    const servers = buildCursorServers(config);
    const entry = servers["agent-toolkit:github"] as {
      command: string;
      args: string[];
      env: Record<string, string>;
    };

    assert.equal(entry.command, "my-gh-server");
    assert.deepEqual(entry.args, ["--port", "3000"]);
    assert.deepEqual(entry.env, { MY_TOKEN: "secret" });
  });

  it("uses url for remote servers", () => {
    const config: WorkspaceConfig = {
      servers: {
        github: { url: "https://mcp.example.com/github" },
      },
    };
    const servers = buildCursorServers(config);
    const entry = servers["agent-toolkit:github"] as { url: string };

    assert.equal(entry.url, "https://mcp.example.com/github");
  });

  it("inlines env vars into Docker args for docker-based servers", () => {
    const config: WorkspaceConfig = {
      servers: { terraform: {} },
    };
    const tokens = { terraform: { TFE_TOKEN: "test-token-123" } };
    const servers = buildMcpServers(config, tokens);
    const entry = servers["agent-toolkit:terraform"] as {
      command: string;
      args: string[];
      env?: Record<string, string>;
    };

    assert.equal(entry.command, "docker");
    assert.ok(entry.args.includes("-e"));
    assert.ok(entry.args.includes("TFE_TOKEN=test-token-123"));
    assert.equal(entry.args[entry.args.length - 1], "hashicorp/terraform-mcp-server:0.4.0");
    assert.equal(entry.env, undefined);
  });

  it("builds atlassian npx entry with mcp-remote (OAuth, no auth header)", () => {
    const config: WorkspaceConfig = { servers: { atlassian: {} } };
    const servers = buildMcpServers(config);
    const entry = servers["agent-toolkit:atlassian"] as { command: string; args: string[] };

    assert.equal(entry.command, "npx");
    assert.ok(entry.args.includes("mcp-remote@latest"));
    assert.ok(entry.args.includes("https://mcp.atlassian.com/v1/mcp"));
    assert.ok(!entry.args.some(a => a.includes("Authorization")));
  });
});

describe("mergeCursorConfig", () => {
  it("preserves user-added servers", () => {
    const existing: CursorMcpConfig = {
      mcpServers: {
        "my-custom-server": { command: "echo", args: ["hi"] },
      },
    };
    const toolkit = {
      "agent-toolkit:github": { command: "npx", args: ["-y", "gh-server"] },
    };
    const merged = mergeCursorConfig(existing, toolkit);

    assert.ok(merged.mcpServers["my-custom-server"]);
    assert.ok(merged.mcpServers["agent-toolkit:github"]);
  });

  it("replaces stale toolkit servers", () => {
    const existing: CursorMcpConfig = {
      mcpServers: {
        "agent-toolkit:github": { command: "old-cmd", args: [] },
        "user-server": { command: "echo", args: [] },
      },
    };
    const toolkit = {
      "agent-toolkit:github": { command: "new-cmd", args: ["--new"] },
    };
    const merged = mergeCursorConfig(existing, toolkit);

    assert.equal(
      (merged.mcpServers["agent-toolkit:github"] as { command: string }).command,
      "new-cmd",
    );
    assert.ok(merged.mcpServers["user-server"]);
  });

  it("removes toolkit servers no longer in config", () => {
    const existing: CursorMcpConfig = {
      mcpServers: {
        "agent-toolkit:github": { command: "npx", args: [] },
        "agent-toolkit:terraform": { command: "npx", args: [] },
      },
    };
    const toolkit = {
      "agent-toolkit:github": { command: "npx", args: [] },
    };
    const merged = mergeCursorConfig(existing, toolkit);

    assert.ok(merged.mcpServers["agent-toolkit:github"]);
    assert.equal(merged.mcpServers["agent-toolkit:terraform"], undefined);
  });
});

describe("generateCursorConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-cursor-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates config merging with existing file", async () => {
    await mkdir(join(tmpDir, ".cursor"), { recursive: true });
    const existing: CursorMcpConfig = {
      mcpServers: {
        "user-server": { command: "echo", args: ["hi"] },
      },
    };
    await writeFile(
      join(tmpDir, ".cursor", "mcp.json"),
      JSON.stringify(existing),
    );

    const config: WorkspaceConfig = {
      servers: { github: {} },
    };
    const result = await generateCursorConfig(config, tmpDir);

    assert.ok(result.path.endsWith(".cursor/mcp.json"));
    const parsed = JSON.parse(result.content) as CursorMcpConfig;
    assert.ok(parsed.mcpServers["user-server"]);
    assert.ok(parsed.mcpServers["agent-toolkit:github"]);
  });

  it("generates config when no existing file", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "toolkit-cursor-empty-"));
    try {
      const config: WorkspaceConfig = {
        servers: { github: {}, terraform: {} },
      };
      const result = await generateCursorConfig(config, emptyDir);
      const parsed = JSON.parse(result.content) as CursorMcpConfig;

      assert.ok(parsed.mcpServers["agent-toolkit:github"]);
      assert.ok(parsed.mcpServers["agent-toolkit:terraform"]);
      assert.equal(Object.keys(parsed.mcpServers).length, 2);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("writeCursorConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-cursor-write-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .cursor directory and writes config", async () => {
    const config: WorkspaceConfig = {
      servers: { github: {} },
    };
    const result = await writeCursorConfig(config, tmpDir);

    const written = await readFile(result.path, "utf-8");
    const parsed = JSON.parse(written) as CursorMcpConfig;
    assert.ok(parsed.mcpServers["agent-toolkit:github"]);
  });
});

// ---------------------------------------------------------------------------
// Claude Code config generation
// ---------------------------------------------------------------------------

describe("generateClaudeCodeConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-claude-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates .mcp.json at project root", async () => {
    const config: WorkspaceConfig = {
      servers: { github: {}, terraform: {} },
    };
    const result = await generateClaudeCodeConfig(config, tmpDir);

    assert.ok(result.path.endsWith(".mcp.json"));
    assert.ok(!result.path.includes(".cursor"));
    const parsed = JSON.parse(result.content) as McpConfig;
    assert.ok(parsed.mcpServers["agent-toolkit:github"]);
    assert.ok(parsed.mcpServers["agent-toolkit:terraform"]);
    assert.equal(Object.keys(parsed.mcpServers).length, 2);
  });

  it("merges with existing .mcp.json", async () => {
    const existing: McpConfig = {
      mcpServers: {
        "user-server": { command: "echo", args: ["hi"] },
      },
    };
    await writeFile(join(tmpDir, ".mcp.json"), JSON.stringify(existing));

    const config: WorkspaceConfig = {
      servers: { github: {} },
    };
    const result = await generateClaudeCodeConfig(config, tmpDir);
    const parsed = JSON.parse(result.content) as McpConfig;

    assert.ok(parsed.mcpServers["user-server"]);
    assert.ok(parsed.mcpServers["agent-toolkit:github"]);
  });
});

describe("writeClaudeCodeConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-claude-write-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes .mcp.json to project root", async () => {
    const config: WorkspaceConfig = {
      servers: { github: {} },
    };
    const result = await writeClaudeCodeConfig(config, tmpDir);

    const written = await readFile(result.path, "utf-8");
    const parsed = JSON.parse(written) as McpConfig;
    assert.ok(parsed.mcpServers["agent-toolkit:github"]);
    assert.equal(result.path, join(tmpDir, ".mcp.json"));
  });
});

// ---------------------------------------------------------------------------
// Copilot config generation
// ---------------------------------------------------------------------------

describe("buildCopilotServers", () => {
  it("builds stdio entries with type field and generates input prompts for missing env vars", () => {
    const saved = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    try {
      const config: WorkspaceConfig = {
        servers: { github: {} },
      };
      const { servers, inputs } = buildCopilotServers(config);
      const entry = servers["agent-toolkit:github"] as CopilotStdioServer;

      assert.equal(entry.type, "stdio");
      assert.equal(entry.command, "npx");
      assert.ok(entry.env);
      assert.ok(entry.env!.GITHUB_PERSONAL_ACCESS_TOKEN.startsWith("${input:"));

      assert.equal(inputs.length, 1);
      assert.equal(inputs[0].type, "promptString");
      assert.equal(inputs[0].password, true);
    } finally {
      if (saved !== undefined) process.env.GITHUB_PERSONAL_ACCESS_TOKEN = saved;
    }
  });

  it("uses runtime env value when available instead of input reference", () => {
    const saved = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    process.env.GITHUB_PERSONAL_ACCESS_TOKEN = "ghp_test123";
    try {
      const config: WorkspaceConfig = {
        servers: { github: {} },
      };
      const { servers, inputs } = buildCopilotServers(config);
      const entry = servers["agent-toolkit:github"] as CopilotStdioServer;

      assert.equal(entry.env!.GITHUB_PERSONAL_ACCESS_TOKEN, "ghp_test123");
      assert.equal(inputs.length, 0);
    } finally {
      if (saved !== undefined) {
        process.env.GITHUB_PERSONAL_ACCESS_TOKEN = saved;
      } else {
        delete process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
      }
    }
  });

  it("builds http entry for url-based servers", () => {
    const config: WorkspaceConfig = {
      servers: {
        github: { url: "https://mcp.example.com/github" },
      },
    };
    const { servers, inputs } = buildCopilotServers(config);
    const entry = servers["agent-toolkit:github"] as CopilotHttpServer;

    assert.equal(entry.type, "http");
    assert.equal(entry.url, "https://mcp.example.com/github");
    assert.equal(inputs.length, 0);
  });

  it("inlines env vars into Docker args for docker-based servers", () => {
    const config: WorkspaceConfig = {
      servers: { terraform: {} },
    };
    const tokens = { terraform: { TFE_TOKEN: "test-token-456" } };
    const { servers, inputs } = buildCopilotServers(config, tokens);
    const entry = servers["agent-toolkit:terraform"] as CopilotStdioServer;

    assert.equal(entry.type, "stdio");
    assert.equal(entry.command, "docker");
    assert.ok(entry.args!.includes("-e"));
    assert.ok(entry.args!.includes("TFE_TOKEN=test-token-456"));
    assert.equal(entry.args![entry.args!.length - 1], "hashicorp/terraform-mcp-server:0.4.0");
    assert.equal(entry.env, undefined);
    assert.equal(inputs.length, 0);
  });

  it("uses input reference in Docker args when token is missing", () => {
    const saved = process.env.TFE_TOKEN;
    delete process.env.TFE_TOKEN;
    try {
      const config: WorkspaceConfig = {
        servers: { terraform: {} },
      };
      const { servers, inputs } = buildCopilotServers(config);
      const entry = servers["agent-toolkit:terraform"] as CopilotStdioServer;

      assert.equal(entry.command, "docker");
      const envArgIdx = entry.args!.indexOf("-e");
      assert.ok(envArgIdx >= 0);
      assert.ok(entry.args![envArgIdx + 1].startsWith("TFE_TOKEN=${input:"));
      assert.equal(entry.env, undefined);
      assert.equal(inputs.length, 1);
      assert.equal(inputs[0].password, true);
    } finally {
      if (saved !== undefined) process.env.TFE_TOKEN = saved;
    }
  });

});

describe("mergeCopilotConfig", () => {
  it("preserves user-added servers and inputs", () => {
    const existing: CopilotMcpConfig = {
      servers: {
        "my-server": { type: "stdio", command: "echo", args: ["hi"] },
      },
      inputs: [
        { type: "promptString", id: "my-key", description: "My API Key" },
      ],
    };
    const toolkitServers = {
      "agent-toolkit:github": {
        type: "stdio" as const,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
      },
    };
    const toolkitInputs = [
      { type: "promptString" as const, id: "agent-toolkit:GITHUB_PERSONAL_ACCESS_TOKEN", description: "GITHUB_PERSONAL_ACCESS_TOKEN for github", password: true },
    ];
    const merged = mergeCopilotConfig(existing, toolkitServers, toolkitInputs);

    assert.ok(merged.servers["my-server"]);
    assert.ok(merged.servers["agent-toolkit:github"]);
    assert.equal(merged.inputs!.length, 2);
    assert.equal(merged.inputs![0].id, "my-key");
    assert.equal(merged.inputs![1].id, "agent-toolkit:GITHUB_PERSONAL_ACCESS_TOKEN");
  });

  it("removes stale toolkit servers and inputs on re-run", () => {
    const existing: CopilotMcpConfig = {
      servers: {
        "agent-toolkit:github": { type: "stdio", command: "npx", args: [] },
        "agent-toolkit:terraform": { type: "stdio", command: "npx", args: [] },
      },
      inputs: [
        { type: "promptString", id: "agent-toolkit:GITHUB_PERSONAL_ACCESS_TOKEN", description: "old", password: true },
        { type: "promptString", id: "agent-toolkit:TFE_TOKEN", description: "old", password: true },
      ],
    };
    const toolkitServers = {
      "agent-toolkit:github": { type: "stdio" as const, command: "npx", args: ["--new"] },
    };
    const toolkitInputs = [
      { type: "promptString" as const, id: "agent-toolkit:GITHUB_PERSONAL_ACCESS_TOKEN", description: "new", password: true },
    ];
    const merged = mergeCopilotConfig(existing, toolkitServers, toolkitInputs);

    assert.ok(merged.servers["agent-toolkit:github"]);
    assert.equal(merged.servers["agent-toolkit:terraform"], undefined);
    assert.equal(merged.inputs!.length, 1);
    assert.equal(merged.inputs![0].description, "new");
  });
});

describe("generateCopilotConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-copilot-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates .vscode/mcp.json with servers key (not mcpServers)", async () => {
    const config: WorkspaceConfig = {
      servers: { github: { url: "https://mcp.example.com/github" } },
    };
    const result = await generateCopilotConfig(config, tmpDir);

    assert.ok(result.path.endsWith(".vscode/mcp.json"));
    const parsed = JSON.parse(result.content) as CopilotMcpConfig;
    assert.ok(parsed.servers);
    assert.ok(parsed.servers["agent-toolkit:github"]);
    assert.equal((parsed as unknown as Record<string, unknown>).mcpServers, undefined);
  });

  it("merges with existing .vscode/mcp.json", async () => {
    await mkdir(join(tmpDir, ".vscode"), { recursive: true });
    const existing: CopilotMcpConfig = {
      servers: {
        "user-server": { type: "stdio", command: "echo", args: ["hi"] },
      },
    };
    await writeFile(
      join(tmpDir, ".vscode", "mcp.json"),
      JSON.stringify(existing),
    );

    const config: WorkspaceConfig = {
      servers: { github: { url: "https://mcp.example.com/github" } },
    };
    const result = await generateCopilotConfig(config, tmpDir);
    const parsed = JSON.parse(result.content) as CopilotMcpConfig;

    assert.ok(parsed.servers["user-server"]);
    assert.ok(parsed.servers["agent-toolkit:github"]);
  });
});

describe("writeCopilotConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-copilot-write-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .vscode directory and writes config", async () => {
    const config: WorkspaceConfig = {
      servers: { github: { url: "https://mcp.example.com/github" } },
    };
    const result = await writeCopilotConfig(config, tmpDir);

    const written = await readFile(result.path, "utf-8");
    const parsed = JSON.parse(written) as CopilotMcpConfig;
    assert.ok(parsed.servers["agent-toolkit:github"]);
    assert.equal(result.path, join(tmpDir, ".vscode", "mcp.json"));
  });
});

// ---------------------------------------------------------------------------
// Codex config generation
// ---------------------------------------------------------------------------

describe("buildCodexServers", () => {
  it("builds stdio entries from known server defaults", () => {
    const config: WorkspaceConfig = {
      servers: { github: {} },
    };
    const tokens = { github: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_test" } };
    const servers = buildCodexServers(config, tokens);
    const entry = servers["agent-toolkit-github"] as { command: string; args: string[]; env?: Record<string, string> };

    assert.equal(entry.command, "npx");
    assert.ok(entry.args.includes("@modelcontextprotocol/server-github"));
    assert.equal(entry.env!.GITHUB_PERSONAL_ACCESS_TOKEN, "ghp_test");
  });

  it("uses hyphen prefix instead of colon for Codex compatibility", () => {
    const config: WorkspaceConfig = {
      servers: { github: {}, terraform: {} },
    };
    const tokens = { github: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_test" }, terraform: { TFE_TOKEN: "tfe_test" } };
    const servers = buildCodexServers(config, tokens);
    const keys = Object.keys(servers);

    for (const key of keys) {
      assert.ok(key.startsWith(CODEX_TOOLKIT_PREFIX), `key "${key}" should start with "${CODEX_TOOLKIT_PREFIX}"`);
      assert.ok(!key.includes(":"), `key "${key}" must not contain a colon`);
      assert.match(key, /^[a-zA-Z0-9_-]+$/);
    }
  });

  it("transforms url entries to use http_headers instead of headers", () => {
    const config: WorkspaceConfig = {
      servers: {
        github: { url: "https://mcp.example.com/github" },
      },
    };
    const servers = buildCodexServers(config);
    const entry = servers["agent-toolkit-github"] as CodexHttpServer;

    assert.equal(entry.url, "https://mcp.example.com/github");
    assert.equal((entry as unknown as { headers?: unknown }).headers, undefined);
  });

  it("inlines env vars into Docker args for docker-based servers", () => {
    const config: WorkspaceConfig = {
      servers: { terraform: {} },
    };
    const tokens = { terraform: { TFE_TOKEN: "tfe_codex_test" } };
    const servers = buildCodexServers(config, tokens);
    const entry = servers["agent-toolkit-terraform"] as { command: string; args: string[] };

    assert.equal(entry.command, "docker");
    assert.ok(entry.args.includes("-e"));
    assert.ok(entry.args.includes("TFE_TOKEN=tfe_codex_test"));
  });
});

describe("mergeCodexConfig", () => {
  it("preserves user-added servers", () => {
    const existing: CodexConfig = {
      mcp_servers: {
        "my-server": { command: "echo", args: ["hi"] },
      },
    };
    const toolkit = {
      "agent-toolkit-github": { command: "npx", args: ["-y", "gh-server"] },
    };
    const merged = mergeCodexConfig(existing, toolkit);

    assert.ok(merged.mcp_servers!["my-server"]);
    assert.ok(merged.mcp_servers!["agent-toolkit-github"]);
  });

  it("replaces stale toolkit servers and preserves top-level config", () => {
    const existing: CodexConfig = {
      model: "gpt-5.1-codex-mini",
      mcp_servers: {
        "agent-toolkit-github": { command: "old-cmd", args: [] },
        "user-server": { command: "echo", args: [] },
      },
    };
    const toolkit = {
      "agent-toolkit-github": { command: "new-cmd", args: ["--new"] },
    };
    const merged = mergeCodexConfig(existing, toolkit);

    assert.equal(
      (merged.mcp_servers!["agent-toolkit-github"] as { command: string }).command,
      "new-cmd",
    );
    assert.ok(merged.mcp_servers!["user-server"]);
    assert.equal(merged.model, "gpt-5.1-codex-mini");
  });

  it("removes toolkit servers no longer in config", () => {
    const existing: CodexConfig = {
      mcp_servers: {
        "agent-toolkit-github": { command: "npx", args: [] },
        "agent-toolkit-terraform": { command: "docker", args: [] },
      },
    };
    const toolkit = {
      "agent-toolkit-github": { command: "npx", args: [] },
    };
    const merged = mergeCodexConfig(existing, toolkit);

    assert.ok(merged.mcp_servers!["agent-toolkit-github"]);
    assert.equal(merged.mcp_servers!["agent-toolkit-terraform"], undefined);
  });

  it("cleans up legacy colon-prefixed servers during merge", () => {
    const existing: CodexConfig = {
      mcp_servers: {
        "agent-toolkit:github": { command: "old-cmd", args: [] },
        "user-server": { command: "echo", args: [] },
      },
    };
    const toolkit = {
      "agent-toolkit-github": { command: "new-cmd", args: ["--new"] },
    };
    const merged = mergeCodexConfig(existing, toolkit);

    assert.equal(merged.mcp_servers!["agent-toolkit:github"], undefined);
    assert.ok(merged.mcp_servers!["agent-toolkit-github"]);
    assert.ok(merged.mcp_servers!["user-server"]);
  });
});

describe("generateCodexConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-codex-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates .codex/config.toml with mcp_servers using hyphen prefix", async () => {
    const config: WorkspaceConfig = {
      servers: { github: {} },
    };
    const tokens = { github: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_gen" } };
    const result = await generateCodexConfig(config, tmpDir, tokens);

    assert.ok(result.path.endsWith(".codex/config.toml"));
    const parsed = parseToml(result.content) as unknown as CodexConfig;
    assert.ok(parsed.mcp_servers);
    assert.ok(parsed.mcp_servers!["agent-toolkit-github"]);
    assert.equal(parsed.mcp_servers!["agent-toolkit:github"], undefined);
  });

  it("merges with existing .codex/config.toml", async () => {
    await mkdir(join(tmpDir, ".codex"), { recursive: true });
    const existingToml = [
      'model = "gpt-5.1-codex-mini"',
      "",
      '[mcp_servers."user-server"]',
      'command = "echo"',
      'args = ["hi"]',
      "",
    ].join("\n");
    await writeFile(join(tmpDir, ".codex", "config.toml"), existingToml);

    const config: WorkspaceConfig = {
      servers: { github: {} },
    };
    const tokens = { github: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_merge" } };
    const result = await generateCodexConfig(config, tmpDir, tokens);
    const parsed = parseToml(result.content) as unknown as CodexConfig;

    assert.ok(parsed.mcp_servers!["user-server"]);
    assert.ok(parsed.mcp_servers!["agent-toolkit-github"]);
    assert.equal(parsed.model, "gpt-5.1-codex-mini");
  });
});

describe("writeCodexConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-codex-write-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .codex directory and writes valid TOML", async () => {
    const config: WorkspaceConfig = {
      servers: { github: {} },
    };
    const tokens = { github: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_write" } };
    const result = await writeCodexConfig(config, tmpDir, tokens);

    assert.equal(result.path, join(tmpDir, ".codex", "config.toml"));
    const written = await readFile(result.path, "utf-8");
    const parsed = parseToml(written) as unknown as CodexConfig;
    assert.ok(parsed.mcp_servers!["agent-toolkit-github"]);
  });
});

// ---------------------------------------------------------------------------
// Gemini CLI config generation
// ---------------------------------------------------------------------------

describe("generateGeminiConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-gemini-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates .gemini/settings.json with mcpServers using toolkit prefix", async () => {
    const config: WorkspaceConfig = {
      servers: { github: {} },
    };
    const tokens = { github: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_gemini" } };
    const result = await generateGeminiConfig(config, tmpDir, tokens);

    assert.ok(result.path.endsWith(".gemini/settings.json"));
    const parsed = JSON.parse(result.content) as McpConfig;
    assert.ok(parsed.mcpServers);
    assert.ok(parsed.mcpServers["agent-toolkit:github"]);
  });

  it("merges with existing .gemini/settings.json", async () => {
    await mkdir(join(tmpDir, ".gemini"), { recursive: true });
    const existing = JSON.stringify({
      mcpServers: { "user-server": { command: "echo", args: ["hi"] } },
    });
    await writeFile(join(tmpDir, ".gemini", "settings.json"), existing);

    const config: WorkspaceConfig = {
      servers: { github: {} },
    };
    const tokens = { github: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_merge" } };
    const result = await generateGeminiConfig(config, tmpDir, tokens);
    const parsed = JSON.parse(result.content) as McpConfig;

    assert.ok(parsed.mcpServers["user-server"]);
    assert.ok(parsed.mcpServers["agent-toolkit:github"]);
  });
});

describe("writeGeminiConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-gemini-write-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .gemini directory and writes valid JSON", async () => {
    const config: WorkspaceConfig = {
      servers: { github: {} },
    };
    const tokens = { github: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_write" } };
    const result = await writeGeminiConfig(config, tmpDir, tokens);

    assert.equal(result.path, join(tmpDir, ".gemini", "settings.json"));
    const written = await readFile(result.path, "utf-8");
    const parsed = JSON.parse(written) as McpConfig;
    assert.ok(parsed.mcpServers["agent-toolkit:github"]);
  });
});

// ---------------------------------------------------------------------------
// Client config verification
// ---------------------------------------------------------------------------

describe("verifyClientConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-verify-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns all entries as ok when config contains expected server keys", async () => {
    const config: WorkspaceConfig = {
      servers: { github: {}, terraform: {} },
    };
    await writeCursorConfig(config, tmpDir);

    const result = await verifyClientConfig("cursor", config, tmpDir);

    assert.equal(result.fileExists, true);
    assert.equal(result.client, "cursor");
    assert.ok(result.configPath.endsWith(".cursor/mcp.json"));
    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0].status, "ok");
    assert.equal(result.entries[1].status, "ok");
  });

  it("returns missing for servers not present in config file", async () => {
    const writeConfig: WorkspaceConfig = { servers: { github: {} } };
    await writeCursorConfig(writeConfig, tmpDir);

    const verifyConfig: WorkspaceConfig = {
      servers: { github: {}, terraform: {} },
    };
    const result = await verifyClientConfig("cursor", verifyConfig, tmpDir);

    assert.equal(result.fileExists, true);
    const githubEntry = result.entries.find((e) => e.server === "github");
    const terraformEntry = result.entries.find((e) => e.server === "terraform");
    assert.equal(githubEntry!.status, "ok");
    assert.equal(terraformEntry!.status, "missing");
  });

  it("returns fileExists false when config file does not exist", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "toolkit-verify-empty-"));
    try {
      const config: WorkspaceConfig = { servers: { github: {} } };
      const result = await verifyClientConfig("cursor", config, emptyDir);

      assert.equal(result.fileExists, false);
      assert.equal(result.entries.length, 1);
      assert.equal(result.entries[0].status, "missing");
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("verifies codex TOML config with mcp_servers entries using hyphen prefix", async () => {
    const codexDir = await mkdtemp(join(tmpdir(), "toolkit-verify-codex-"));
    try {
      const config: WorkspaceConfig = { servers: { github: {} } };
      const tokens = { github: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_verify" } };
      await writeCodexConfig(config, codexDir, tokens);

      const result = await verifyClientConfig("codex", config, codexDir);

      assert.equal(result.fileExists, true);
      assert.ok(result.configPath.endsWith(".codex/config.toml"));
      assert.equal(result.entries.length, 1);
      assert.equal(result.entries[0].server, "github");
      assert.equal(result.entries[0].expectedKey, "agent-toolkit-github");
      assert.equal(result.entries[0].status, "ok");
    } finally {
      await rm(codexDir, { recursive: true, force: true });
    }
  });

  it("verifies gemini-cli JSON config with mcpServers entries using colon prefix", async () => {
    const geminiDir = await mkdtemp(join(tmpdir(), "toolkit-verify-gemini-"));
    try {
      const config: WorkspaceConfig = { servers: { github: {} } };
      const tokens = { github: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_verify" } };
      await writeGeminiConfig(config, geminiDir, tokens);

      const result = await verifyClientConfig("gemini-cli", config, geminiDir);

      assert.equal(result.fileExists, true);
      assert.ok(result.configPath.endsWith(".gemini/settings.json"));
      assert.equal(result.entries.length, 1);
      assert.equal(result.entries[0].server, "github");
      assert.equal(result.entries[0].expectedKey, "agent-toolkit:github");
      assert.equal(result.entries[0].status, "ok");
    } finally {
      await rm(geminiDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Extract embedded tokens
// ---------------------------------------------------------------------------

describe("extractEmbeddedTokens", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-embedded-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns no tokens for atlassian (OAuth, no embedded credentials)", async () => {
    await mkdir(join(tmpDir, ".cursor"), { recursive: true });
    await writeFile(
      join(tmpDir, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "agent-toolkit:atlassian": {
            command: "npx",
            args: ["-y", "mcp-remote@latest", "https://mcp.atlassian.com/v1/mcp"],
          },
        },
      }),
    );

    const config: WorkspaceConfig = { servers: { atlassian: {} } };
    const tokens = await extractEmbeddedTokens("cursor", config, tmpDir);

    assert.equal(Object.keys(tokens).length, 0);
  });

  it("extracts token from env block on command-based entry", async () => {
    await mkdir(join(tmpDir, ".cursor"), { recursive: true });
    await writeFile(
      join(tmpDir, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "agent-toolkit:github": {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_test123" },
          },
        },
      }),
    );

    const config: WorkspaceConfig = { servers: { github: {} } };
    const tokens = await extractEmbeddedTokens("cursor", config, tmpDir);

    assert.equal(tokens["GITHUB_PERSONAL_ACCESS_TOKEN"], "ghp_test123");
  });

  it("extracts token from Docker -e KEY=VALUE args", async () => {
    await mkdir(join(tmpDir, ".cursor"), { recursive: true });
    await writeFile(
      join(tmpDir, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "agent-toolkit:terraform": {
            command: "docker",
            args: ["run", "-i", "--rm", "-e", "TFE_TOKEN=tfe_secret_456", "hashicorp/terraform-mcp-server:0.4.0"],
          },
        },
      }),
    );

    const config: WorkspaceConfig = { servers: { terraform: {} } };
    const tokens = await extractEmbeddedTokens("cursor", config, tmpDir);

    assert.equal(tokens["TFE_TOKEN"], "tfe_secret_456");
  });

  it("returns empty for unknown client", async () => {
    const config: WorkspaceConfig = { servers: { github: {} } };
    const tokens = await extractEmbeddedTokens("unknown-client", config, tmpDir);

    assert.equal(Object.keys(tokens).length, 0);
  });

  it("extracts token from codex TOML env block", async () => {
    const codexDir = await mkdtemp(join(tmpdir(), "toolkit-codex-extract-"));
    try {
      const config: WorkspaceConfig = { servers: { github: {} } };
      const resolved = { github: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_extract_test" } };
      await writeCodexConfig(config, codexDir, resolved);

      const tokens = await extractEmbeddedTokens("codex", config, codexDir);
      assert.equal(tokens["GITHUB_PERSONAL_ACCESS_TOKEN"], "ghp_extract_test");
    } finally {
      await rm(codexDir, { recursive: true, force: true });
    }
  });

  it("extracts token from codex TOML Docker -e args", async () => {
    const codexDir = await mkdtemp(join(tmpdir(), "toolkit-codex-docker-extract-"));
    try {
      const config: WorkspaceConfig = { servers: { terraform: {} } };
      const resolved = { terraform: { TFE_TOKEN: "tfe_extract_codex" } };
      await writeCodexConfig(config, codexDir, resolved);

      const tokens = await extractEmbeddedTokens("codex", config, codexDir);
      assert.equal(tokens["TFE_TOKEN"], "tfe_extract_codex");
    } finally {
      await rm(codexDir, { recursive: true, force: true });
    }
  });
});

