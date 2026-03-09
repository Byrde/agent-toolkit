import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildInstructionPrompt,
  generateLlmInstructions,
  deriveInterToolChains,
} from "./instruction-generator.js";
import { CLIENT_CLI_SPECS } from "./client-diagnostic.js";
import type { WorkspaceConfig, ProviderIdentities } from "./domain/manifest.js";

const basicConfig: WorkspaceConfig = {
  servers: {
    github: { settings: { usageNotes: "CI and code review" } },
    terraform: { settings: { usageNotes: "Manages GCP infra" } },
  },
};

const configWithSettings: WorkspaceConfig = {
  servers: {
    github: { settings: { usageNotes: "CI pipelines", ci: true, codeReview: true } },
    terraform: { settings: { backend: "gcs", ci: "github-actions" } },
  },
};

const configWithScoping: WorkspaceConfig = {
  servers: {
    github: {
      settings: {
        organization: "badal",
        repositories: ["platform-agent-toolkit"],
        usageNotes: "Code hosting",
      },
    },
    terraform: {
      settings: {
        organization: "badal",
        workspaces: ["staging", "prod"],
      },
    },
  },
};

const configWithToolsets: WorkspaceConfig = {
  servers: {
    github: { toolsets: ["repos", "issues", "pull_requests"], settings: { usageNotes: "Code hosting" } },
    gcp: { toolsets: ["cloud-run", "gke"] },
  },
};

// ---------------------------------------------------------------------------
// buildInstructionPrompt
// ---------------------------------------------------------------------------

describe("buildInstructionPrompt", () => {
  it("includes configured server names", () => {
    const prompt = buildInstructionPrompt(basicConfig);
    assert.ok(prompt.includes("github"), "should mention github");
    assert.ok(prompt.includes("terraform"), "should mention terraform");
  });

  it("includes usage notes for servers that have them", () => {
    const prompt = buildInstructionPrompt(basicConfig);
    assert.ok(prompt.includes("CI and code review"), "should include github usage notes");
    assert.ok(prompt.includes("Manages GCP infra"), "should include terraform usage notes");
  });

  it("omits usage notes for servers without them", () => {
    const config: WorkspaceConfig = {
      servers: { github: {}, gcp: {} },
    };
    const prompt = buildInstructionPrompt(config);
    assert.ok(prompt.includes("github"), "should list github");
    assert.ok(prompt.includes("gcp"), "should list gcp");
    assert.ok(!prompt.includes("undefined"), "should not contain 'undefined'");
  });

  it("includes scoping context from server settings", () => {
    const prompt = buildInstructionPrompt(configWithScoping);
    assert.ok(prompt.includes("organization: badal"), "should include github org");
    assert.ok(prompt.includes("platform-agent-toolkit"), "should include repo name");
    assert.ok(prompt.includes("staging, prod"), "should include terraform workspaces");
  });

  it("includes workflow context from server settings", () => {
    const prompt = buildInstructionPrompt(configWithSettings);
    assert.ok(prompt.includes("backend: gcs"), "should include terraform backend");
    assert.ok(prompt.includes("ci: github-actions"), "should include terraform ci");
  });

  it("requests client-agnostic markdown output", () => {
    const prompt = buildInstructionPrompt(basicConfig);
    assert.ok(prompt.includes("client-agnostic"), "should request client-agnostic output");
    assert.ok(prompt.includes("Markdown"), "should mention Markdown format");
  });

  it("asks for per-server guidance and cross-server orchestration", () => {
    const prompt = buildInstructionPrompt(basicConfig);
    assert.ok(prompt.includes("Per-server guidance"), "should ask for per-server guidance");
    assert.ok(prompt.includes("Cross-server orchestration"), "should ask for cross-server orchestration");
    assert.ok(prompt.includes("Context-gathering"), "should ask for context-gathering patterns");
  });

  it("includes pinned identities when provided", () => {
    const identities: ProviderIdentities = {
      github: { account: "mallaire77" },
      gcp: { account: "dev@example.com" },
    };
    const prompt = buildInstructionPrompt(basicConfig, identities);
    assert.ok(prompt.includes("Pinned Identities"), "should have identities section");
    assert.ok(prompt.includes("mallaire77"), "should include github account");
    assert.ok(prompt.includes("dev@example.com"), "should include gcp account");
  });

  it("omits identities section when no identities provided", () => {
    const prompt = buildInstructionPrompt(basicConfig);
    assert.ok(!prompt.includes("Pinned Identities"), "should not have identities section");
  });

  it("omits identities section when identities object is empty", () => {
    const prompt = buildInstructionPrompt(basicConfig, {});
    assert.ok(!prompt.includes("Pinned Identities"), "should not have identities section");
  });

  it("includes toolsets when declared on a server", () => {
    const prompt = buildInstructionPrompt(configWithToolsets);
    assert.ok(prompt.includes("repos"), "should include repos toolset");
    assert.ok(prompt.includes("issues"), "should include issues toolset");
    assert.ok(prompt.includes("pull_requests"), "should include pull_requests toolset");
    assert.ok(prompt.includes("cloud-run"), "should include cloud-run toolset");
    assert.ok(prompt.includes("Enabled toolsets"), "should label toolsets");
  });

  it("includes semantic descriptions for settings fields", () => {
    const prompt = buildInstructionPrompt(configWithSettings);
    assert.ok(prompt.includes("where Terraform state is stored"), "should describe terraform backend");
    assert.ok(prompt.includes("CI system that runs terraform plan/apply"), "should describe terraform ci");
  });

  it("includes derived inter-tool chains for terraform + github-actions", () => {
    const prompt = buildInstructionPrompt(configWithSettings);
    assert.ok(prompt.includes("Derived Inter-Tool Workflows"), "should have chains section");
    assert.ok(prompt.includes("Terraform CI is GitHub Actions"), "should have terraform-github chain");
    assert.ok(prompt.includes("terraform plan"), "chain should mention plan");
    assert.ok(prompt.includes("terraform apply"), "chain should mention apply");
  });

  it("instructs LLM to focus only on enabled toolsets", () => {
    const prompt = buildInstructionPrompt(configWithToolsets);
    assert.ok(prompt.includes("focus ONLY on those toolsets"), "should instruct LLM to scope to toolsets");
  });

  it("tells LLM that auth is handled by init", () => {
    const prompt = buildInstructionPrompt(basicConfig);
    assert.ok(prompt.includes("agent-toolkit init"), "should reference agent-toolkit init");
    assert.ok(prompt.includes("Do NOT include setup"), "should tell LLM not to include setup");
  });
});

// ---------------------------------------------------------------------------
// deriveInterToolChains
// ---------------------------------------------------------------------------

describe("deriveInterToolChains", () => {
  it("derives terraform + github-actions chain when both servers present", () => {
    const chains = deriveInterToolChains(configWithSettings);
    const tfChain = chains.find((c) => c.trigger.includes("Terraform CI"));
    assert.ok(tfChain, "should derive terraform CI chain");
    assert.ok(tfChain!.steps.some((s) => s.includes("plan")), "should mention plan");
    assert.ok(tfChain!.steps.some((s) => s.includes("apply")), "should mention apply");
  });

  it("derives code review chain when github.codeReview is true", () => {
    const chains = deriveInterToolChains(configWithSettings);
    const reviewChain = chains.find((c) => c.trigger.includes("Code review"));
    assert.ok(reviewChain, "should derive code review chain");
    assert.ok(reviewChain!.steps.some((s) => s.includes("branch")), "should mention branching");
  });

  it("derives jira chain when github.issueTracker is jira and atlassian is configured", () => {
    const config: WorkspaceConfig = {
      servers: {
        github: { settings: { issueTracker: "jira" } },
        atlassian: {},
      },
    };
    const chains = deriveInterToolChains(config);
    const jiraChain = chains.find((c) => c.trigger.includes("Jira"));
    assert.ok(jiraChain, "should derive jira chain");
    assert.ok(jiraChain!.steps.some((s) => s.includes("Jira ticket")), "should reference Jira tickets");
  });

  it("does not derive terraform chain when github is not configured", () => {
    const config: WorkspaceConfig = {
      servers: { terraform: { settings: { ci: "github-actions" } } },
    };
    const chains = deriveInterToolChains(config);
    assert.ok(!chains.some((c) => c.trigger.includes("Terraform CI")), "should not derive chain without github server");
  });

  it("returns empty array when no settings configured", () => {
    const chains = deriveInterToolChains(basicConfig);
    assert.equal(chains.length, 0, "should return no chains");
  });
});

// ---------------------------------------------------------------------------
// generateLlmInstructions
// ---------------------------------------------------------------------------

describe("generateLlmInstructions", () => {
  it("throws when CLI is not available", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "nonexistent-binary-xyz-12345",
    };
    try {
      await assert.rejects(
        () => generateLlmInstructions("claude-code", basicConfig),
        (err: Error) => {
          assert.ok(err.message.includes("not available"));
          return true;
        },
      );
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("invokes the CLI and returns trimmed output", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "/bin/sh",
      headlessFlag: ["-c", "echo '## github\n\nUse for PRs and CI.\n'"],
      streamFlag: undefined,
      modelFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const result = await generateLlmInstructions("claude-code", basicConfig);
      assert.ok(result.includes("## github"), "should contain server heading");
      assert.ok(result.includes("Use for PRs and CI"), "should contain instructions");
      assert.ok(!result.endsWith("\n\n"), "should be trimmed");
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("passes prompt containing server names to the CLI", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "echo",
      headlessFlag: [],
      streamFlag: undefined,
      modelFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const output = await generateLlmInstructions("claude-code", basicConfig);
      assert.ok(output.includes("github"), "prompt passed to echo should contain github");
      assert.ok(output.includes("terraform"), "prompt passed to echo should contain terraform");
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("passes identities in the prompt to the CLI", async () => {
    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "echo",
      headlessFlag: [],
      streamFlag: undefined,
      modelFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const identities: ProviderIdentities = { github: { account: "mallaire77" } };
      const output = await generateLlmInstructions(
        "claude-code", basicConfig, undefined, undefined, identities,
      );
      assert.ok(output.includes("mallaire77"), "prompt should contain pinned identity");
      assert.ok(output.includes("Pinned Identities"), "prompt should contain identities section");
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });

  it("streams output to onData callback", async () => {
    const ndjson = [
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"## github\\n\\nBest practices"}]}}',
      '{"type":"result","subtype":"success","result":"## github\\n\\nBest practices"}',
    ].join("\n") + "\n";

    const origSpec = CLIENT_CLI_SPECS["claude-code"];
    CLIENT_CLI_SPECS["claude-code"] = {
      ...origSpec,
      binary: "/bin/sh",
      headlessFlag: ["-c", `printf '%s' '${ndjson.replace(/'/g, "'\\''")}'`],
      streamFlag: ["--stream"],
      modelFlag: undefined,
      extraFlags: undefined,
    };
    try {
      const chunks: string[] = [];
      const result = await generateLlmInstructions(
        "claude-code",
        basicConfig,
        undefined,
        (chunk) => chunks.push(chunk),
      );
      assert.ok(result.includes("## github"), "should return result");
      assert.ok(chunks.length > 0, "should have streamed chunks");
    } finally {
      CLIENT_CLI_SPECS["claude-code"] = origSpec;
    }
  });
});
