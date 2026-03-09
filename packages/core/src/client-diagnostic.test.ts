import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_CLI_SPECS,
  checkCliAvailable,
  diagnosticServerNames,
  buildDiagnosticPrompt,
  runDiagnostic,
  buildValidationPrompt,
  runValidation,
  runClientDiagnostic,
  extractJson,
} from "./client-diagnostic.js";
import type { ClientTarget, ProviderIdentities } from "./domain/manifest.js";
import type { WorkspaceConfig } from "./domain/manifest.js";

describe("CLIENT_CLI_SPECS", () => {
  const expectedClients: ClientTarget[] = [
    "cursor",
    "claude-code",
    "copilot",
    "codex",
    "gemini-cli",
  ];

  it("contains entries for all supported clients", () => {
    for (const client of expectedClients) {
      assert.ok(CLIENT_CLI_SPECS[client], `Missing spec for ${client}`);
    }
  });

  it("each spec has required fields", () => {
    for (const [client, spec] of Object.entries(CLIENT_CLI_SPECS)) {
      assert.ok(spec.binary, `${client}: missing binary`);
      assert.ok(
        Array.isArray(spec.headlessFlag) && spec.headlessFlag.length > 0,
        `${client}: headlessFlag must be a non-empty array`,
      );
      assert.ok(spec.installHint, `${client}: missing installHint`);
    }
  });

  it("cursor spec includes non-interactive flags", () => {
    const spec = CLIENT_CLI_SPECS["cursor"];
    assert.ok(spec.extraFlags, "cursor should have extraFlags");
    assert.ok(spec.extraFlags!.includes("--trust"), "cursor should include --trust");
  });

  it("cursor spec has mcpFlags with --approve-mcps", () => {
    const spec = CLIENT_CLI_SPECS["cursor"];
    assert.ok(spec.mcpFlags, "cursor should have mcpFlags");
    assert.ok(spec.mcpFlags!.includes("--approve-mcps"), "cursor mcpFlags should include --approve-mcps");
  });

  it("claude-code spec includes permission bypass flag", () => {
    const spec = CLIENT_CLI_SPECS["claude-code"];
    assert.ok(spec.extraFlags, "claude-code should have extraFlags");
    assert.ok(
      spec.extraFlags!.includes("--dangerously-skip-permissions"),
      "claude-code should include --dangerously-skip-permissions",
    );
  });
});

describe("checkCliAvailable", () => {
  it("returns available: true with path when binary exists", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = { ...origSpec, binary: "node" };
    try {
      const result = await checkCliAvailable("claude-code");
      assert.equal(result.available, true);
      assert.ok(result.path, "expected a path");
      assert.ok(result.path!.includes("node"), "path should contain 'node'");
      assert.equal(result.remediation, undefined);
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("returns available: false with remediation when binary is missing", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "nonexistent-binary-xyz-12345",
    };
    try {
      const result = await checkCliAvailable("claude-code");
      assert.equal(result.available, false);
      assert.equal(result.path, undefined);
      assert.ok(result.remediation, "expected remediation");
      assert.ok(
        result.remediation!.includes("Claude Code"),
        "remediation should mention the client",
      );
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });
});

// ---------------------------------------------------------------------------
// Diagnostic Runner
// ---------------------------------------------------------------------------

const testConfig: WorkspaceConfig = {
  servers: {
    github: {},
    terraform: { settings: { host: "app.terraform.io" } },
  },
};

describe("diagnosticServerNames", () => {
  it("includes all configured servers when none are skipped", () => {
    const config: WorkspaceConfig = {
      servers: { github: {}, atlassian: {}, terraform: {} },
    };
    const names = diagnosticServerNames(config);
    assert.ok(names.includes("github"));
    assert.ok(names.includes("terraform"));
    assert.ok(names.includes("atlassian"));
  });

  it("returns all servers from test config", () => {
    const names = diagnosticServerNames(testConfig);
    assert.deepEqual(names, ["github", "terraform"]);
  });
});

describe("buildDiagnosticPrompt", () => {
  it("includes configured server names in the prompt", () => {
    const prompt = buildDiagnosticPrompt(testConfig);
    assert.ok(prompt.includes("github"), "prompt should mention github");
    assert.ok(prompt.includes("terraform"), "prompt should mention terraform");
  });

  it("includes basic command instructions for known servers", () => {
    const prompt = buildDiagnosticPrompt(testConfig);
    assert.ok(
      prompt.includes("repositories") || prompt.includes("repos"),
      "prompt should include GitHub basic command",
    );
    assert.ok(
      prompt.includes("workspaces"),
      "prompt should include Terraform basic command",
    );
  });

  it("requests plain text output", () => {
    const prompt = buildDiagnosticPrompt(testConfig);
    assert.ok(prompt.includes("plain"), "prompt should request plain text");
    assert.ok(!prompt.includes("Return EXACTLY this JSON"), "prompt should not request JSON structure");
  });

  it("asks for authenticated identity per tool", () => {
    const prompt = buildDiagnosticPrompt(testConfig);
    assert.ok(prompt.includes("identity"), "prompt should ask about identity");
    assert.ok(prompt.includes("authenticated"), "prompt should mention authenticated account");
  });
});

describe("runDiagnostic", () => {
  it("throws when CLI is not available", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "nonexistent-binary-xyz-12345",
    };
    try {
      await assert.rejects(
        () => runDiagnostic("claude-code", testConfig),
        (err: Error) => {
          assert.ok(err.message.includes("not available"));
          return true;
        },
      );
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("invokes the CLI with correct headless and extra flags", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "echo",
      headlessFlag: ["HEADLESS"],
      streamFlag: undefined,
      extraFlags: ["--extra-test"],
    };
    try {
      const output = await runDiagnostic("claude-code", testConfig);
      assert.ok(output.includes("HEADLESS"), "output should contain headless flag");
      assert.ok(output.includes("--extra-test"), "output should contain extra flag");
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("throws on non-zero exit", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "false",
      headlessFlag: [],
      streamFlag: undefined,
      extraFlags: undefined,
    };
    try {
      await assert.rejects(
        () => runDiagnostic("claude-code", testConfig),
        (err: Error) => {
          assert.ok(err.message.includes("exited with error"));
          return true;
        },
      );
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("streams text deltas from NDJSON when onData is provided", async () => {
    const ndjson = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello "}]}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"world"}]}}',
      '{"type":"result","subtype":"success","result":"hello world"}',
    ].join("\n") + "\n";

    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "/bin/sh",
      headlessFlag: ["-c", `printf '%s' '${ndjson.replace(/'/g, "'\\''")}'`],
      streamFlag: ["--stream"],
      extraFlags: undefined,
    };
    try {
      const chunks: string[] = [];
      const output = await runDiagnostic("claude-code", testConfig, undefined, (chunk) => {
        chunks.push(chunk);
      });
      assert.equal(output, "hello world", "should return the result from the result event");
      assert.ok(chunks.join("").includes("hello "), "should stream text deltas");
      assert.ok(chunks.join("").includes("world"), "should stream all deltas");
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("deduplicates cumulative streaming output", async () => {
    const ndjson = [
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello "}]}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello world"}]}}',
      '{"type":"result","subtype":"success","result":"hello world"}',
    ].join("\n") + "\n";

    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "/bin/sh",
      headlessFlag: ["-c", `printf '%s' '${ndjson.replace(/'/g, "'\\''")}'`],
      streamFlag: ["--stream"],
      extraFlags: undefined,
    };
    try {
      const chunks: string[] = [];
      const output = await runDiagnostic("claude-code", testConfig, undefined, (chunk) => {
        chunks.push(chunk);
      });
      assert.equal(output, "hello world", "should return the result from the result event");
      assert.equal(chunks.join(""), "hello world", "cumulative content should be deduplicated");
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("skips full retransmission of already-seen text", async () => {
    const ndjson = [
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello "}]}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello world"}]}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hello world"}]}}',
      '{"type":"result","subtype":"success","result":"hello world"}',
    ].join("\n") + "\n";

    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "/bin/sh",
      headlessFlag: ["-c", `printf '%s' '${ndjson.replace(/'/g, "'\\''")}'`],
      streamFlag: ["--stream"],
      extraFlags: undefined,
    };
    try {
      const chunks: string[] = [];
      const output = await runDiagnostic("claude-code", testConfig, undefined, (chunk) => {
        chunks.push(chunk);
      });
      assert.equal(output, "hello world");
      assert.equal(chunks.join(""), "hello world", "retransmitted text should not appear twice");
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("falls back to raw stdout when no onData callback", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "/bin/sh",
      headlessFlag: ["-c", "echo plain-text-output"],
      streamFlag: ["--stream"],
      extraFlags: undefined,
    };
    try {
      const output = await runDiagnostic("claude-code", testConfig);
      assert.ok(output.includes("plain-text-output"), "should return raw stdout without streaming");
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("forwards captured output via onData for non-streaming clients", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "/bin/sh",
      headlessFlag: ["-c", "echo diagnostic-output-here"],
      streamFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const chunks: string[] = [];
      const output = await runDiagnostic("claude-code", testConfig, undefined, (chunk) => {
        chunks.push(chunk);
      });
      assert.ok(output.includes("diagnostic-output-here"), "should return the output");
      assert.ok(
        chunks.join("").includes("diagnostic-output-here"),
        "should forward captured output via onData even without streamFlag",
      );
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("falls back to stderr when stdout is empty", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "/bin/sh",
      headlessFlag: ["-c", "echo stderr-content >&2"],
      streamFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const output = await runDiagnostic("claude-code", testConfig);
      assert.ok(
        output.includes("stderr-content"),
        "should return stderr when stdout is empty",
      );
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("forwards stderr in real-time for non-streaming clients", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "/bin/sh",
      headlessFlag: ["-c", "echo stderr-live >&2"],
      streamFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const chunks: string[] = [];
      await runDiagnostic("claude-code", testConfig, undefined, (chunk) => {
        chunks.push(chunk);
      });
      assert.ok(
        chunks.join("").includes("stderr-live"),
        "should forward stderr in real-time via onData even without streamFlag",
      );
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });
});

// ---------------------------------------------------------------------------
// Validation Runner
// ---------------------------------------------------------------------------

describe("buildValidationPrompt", () => {
  it("includes expected server names and diagnostic output", () => {
    const prompt = buildValidationPrompt("diagnostic report here", testConfig);
    assert.ok(prompt.includes("github"), "should mention github");
    assert.ok(prompt.includes("terraform"), "should mention terraform");
    assert.ok(prompt.includes("diagnostic report here"), "should include diagnostic output");
  });

  it("requests JSON output with the expected shape", () => {
    const prompt = buildValidationPrompt("{}", testConfig);
    assert.ok(prompt.includes("JSON"), "should request JSON");
    assert.ok(prompt.includes('"listed"'), "should describe listed field");
    assert.ok(prompt.includes('"paraphraseAccurate"'), "should describe paraphraseAccurate field");
    assert.ok(prompt.includes('"basicCommandPassed"'), "should describe basicCommandPassed field");
    assert.ok(prompt.includes('"accountCorrect"'), "should describe accountCorrect field");
  });

  it("includes expected identities when provided", () => {
    const identities: ProviderIdentities = {
      github: { account: "octocat" },
      terraform: { host: "app.terraform.io" },
    };
    const prompt = buildValidationPrompt("{}", testConfig, identities);
    assert.ok(prompt.includes("octocat"), "should include expected GitHub account");
    assert.ok(prompt.includes("app.terraform.io"), "should include expected Terraform host");
    assert.ok(prompt.includes(".agent-toolkit.local.json"), "should reference local config");
  });

  it("omits identity section when no identities provided", () => {
    const prompt = buildValidationPrompt("{}", testConfig);
    assert.ok(!prompt.includes(".agent-toolkit.local.json"), "should not reference local config without identities");
  });
});

describe("extractJson", () => {
  it("extracts JSON from plain text containing a JSON object", () => {
    const text = 'Here is the result:\n{ "tools": [], "overallPass": true }\nDone.';
    const result = extractJson(text);
    assert.ok(result, "should find JSON");
    assert.deepEqual(result!.tools, []);
    assert.equal(result!.overallPass, true);
  });

  it("extracts JSON from a CLI envelope with nested result string", () => {
    const inner = JSON.stringify({
      tools: [{ tool: "github", listed: true, paraphraseAccurate: true, basicCommandPassed: true, accountCorrect: true, details: "ok" }],
      overallPass: true,
    });
    const envelope = JSON.stringify({ type: "result", subtype: "success", result: inner });
    const result = extractJson(envelope);
    assert.ok(result, "should unwrap envelope");
    assert.ok(Array.isArray(result!.tools), "should have tools array");
    assert.equal((result!.tools as Array<{ tool: string }>)[0].tool, "github");
    assert.equal(result!.overallPass, true);
  });

  it("returns undefined for text with no JSON", () => {
    assert.equal(extractJson("no json here"), undefined);
  });

  it("handles top-level JSON with tools directly", () => {
    const json = JSON.stringify({ tools: [{ tool: "gcp", listed: false }], overallPass: false });
    const result = extractJson(json);
    assert.ok(result, "should parse directly");
    assert.equal(result!.overallPass, false);
  });
});

describe("runValidation", () => {
  it("parses structured JSON response into ClientDiagnosticResult", async () => {
    const validJson = JSON.stringify({
      tools: [
        { tool: "github", listed: true, paraphraseAccurate: true, basicCommandPassed: true, accountCorrect: true, details: "ok" },
        { tool: "terraform", listed: true, paraphraseAccurate: true, basicCommandPassed: false, accountCorrect: true, details: "timeout" },
      ],
      overallPass: false,
    });

    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "echo",
      headlessFlag: [],
      streamFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const result = await runValidation("claude-code", "diag output", {
        servers: { github: {}, terraform: {} },
      });
      assert.equal(result.cliAvailable, true);
      assert.ok(Array.isArray(result.tools));
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("returns partial results when JSON parsing fails", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "echo",
      headlessFlag: ["not-json-at-all"],
      streamFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const result = await runValidation("claude-code", "diag output", testConfig);
      assert.equal(result.cliAvailable, true);
      assert.equal(result.overallPass, false);
      assert.ok(result.error, "should have an error message");
      assert.equal(result.tools.length, 2, "should have fallback entries for each server");
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("returns per-tool verdicts from valid JSON", async () => {
    const validJson = JSON.stringify({
      tools: [
        { tool: "github", listed: true, paraphraseAccurate: true, basicCommandPassed: true, accountCorrect: true, details: "all good" },
        { tool: "terraform", listed: true, paraphraseAccurate: false, basicCommandPassed: true, accountCorrect: true, details: "paraphrase off" },
      ],
      overallPass: false,
    });

    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "/bin/sh",
      headlessFlag: ["-c", `echo '${validJson}'`],
      streamFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const result = await runValidation("claude-code", "diag output", testConfig);
      assert.equal(result.cliAvailable, true);
      assert.equal(result.tools.length, 2);
      assert.equal(result.tools[0].tool, "github");
      assert.equal(result.tools[0].listed, true);
      assert.equal(result.tools[0].paraphraseAccurate, true);
      assert.equal(result.tools[0].basicCommandPassed, true);
      assert.equal(result.tools[0].accountCorrect, true);
      assert.equal(result.tools[1].tool, "terraform");
      assert.equal(result.tools[1].paraphraseAccurate, false);
      assert.equal(result.overallPass, false);
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("reports accountCorrect: false when identity mismatches", async () => {
    const validJson = JSON.stringify({
      tools: [
        { tool: "github", listed: true, paraphraseAccurate: true, basicCommandPassed: true, accountCorrect: false, details: "wrong account" },
        { tool: "terraform", listed: true, paraphraseAccurate: true, basicCommandPassed: true, accountCorrect: true, details: "ok" },
      ],
      overallPass: false,
    });

    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "/bin/sh",
      headlessFlag: ["-c", `echo '${validJson}'`],
      streamFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const identities: ProviderIdentities = { github: { account: "octocat" } };
      const result = await runValidation("claude-code", "diag output", testConfig, undefined, undefined, identities);
      assert.equal(result.tools[0].accountCorrect, false);
      assert.equal(result.tools[1].accountCorrect, true);
      assert.equal(result.overallPass, false);
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("defaults accountCorrect to true when field is absent in response", async () => {
    const validJson = JSON.stringify({
      tools: [
        { tool: "github", listed: true, paraphraseAccurate: true, basicCommandPassed: true, details: "ok" },
      ],
      overallPass: true,
    });

    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "/bin/sh",
      headlessFlag: ["-c", `echo '${validJson}'`],
      streamFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const result = await runValidation("claude-code", "diag output", { servers: { github: {} } });
      assert.equal(result.tools[0].accountCorrect, true, "should default to true when not present");
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });
});

// ---------------------------------------------------------------------------
// Client Diagnostic Orchestrator
// ---------------------------------------------------------------------------

describe("runClientDiagnostic", () => {
  it("short-circuits with CLI remediation when binary is not available", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "nonexistent-binary-xyz-12345",
    };
    try {
      const result = await runClientDiagnostic("claude-code", testConfig);
      assert.equal(result.cliAvailable, false);
      assert.ok(result.cliRemediation, "should have remediation");
      assert.equal(result.overallPass, false);
      assert.equal(result.tools.length, 0);
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("handles diagnostic failure gracefully", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "false",
      headlessFlag: [],
      streamFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const result = await runClientDiagnostic("claude-code", testConfig);
      assert.equal(result.cliAvailable, true);
      assert.equal(result.overallPass, false);
      assert.ok(result.error, "should have error message");
      assert.ok(result.error!.includes("Diagnostic failed"));
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("runs diagnostic then validation in sequence", async () => {
    const validJson = JSON.stringify({
      tools: [
        { tool: "github", listed: true, paraphraseAccurate: true, basicCommandPassed: true, accountCorrect: true, details: "ok" },
        { tool: "terraform", listed: true, paraphraseAccurate: true, basicCommandPassed: true, accountCorrect: true, details: "ok" },
      ],
      overallPass: true,
    });

    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "/bin/sh",
      headlessFlag: ["-c", `echo '${validJson}'`],
      streamFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const result = await runClientDiagnostic("claude-code", testConfig);
      assert.equal(result.cliAvailable, true);
      assert.equal(result.overallPass, true);
      assert.equal(result.tools.length, 2);
      assert.ok(result.diagnosticRaw, "should have diagnostic raw output");
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });
});
