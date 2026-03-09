/**
 * Instruction Generator Context — uses AI client CLI in headless mode
 * to generate contextual agent instructions from the workspace config.
 *
 * Builds a prompt from the WorkspaceConfig (servers, settings, usage
 * notes) and invokes the client CLI to produce client-agnostic
 * Markdown instructions covering per-server best practices,
 * cross-server orchestration, and context-gathering guidance.
 */

import type { ClientTarget, WorkspaceConfig, ProviderIdentities } from "./domain/manifest.js";
import { resolve } from "node:path";
import {
  CLIENT_CLI_SPECS,
  checkCliAvailable,
  spawnCli,
  type DiagnosticDataCallback,
} from "./client-diagnostic.js";

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

const GENERATION_TIMEOUT_MS = 180_000;

// ---------------------------------------------------------------------------
// Settings-to-inter-tool chain derivation
// ---------------------------------------------------------------------------

export interface InterToolChain {
  trigger: string;
  steps: string[];
}

function getSettings(config: WorkspaceConfig, server: string): Record<string, unknown> {
  return (config.servers[server]?.settings ?? {}) as Record<string, unknown>;
}

export function deriveInterToolChains(config: WorkspaceConfig): InterToolChain[] {
  const chains: InterToolChain[] = [];
  const servers = Object.keys(config.servers);

  const tfSettings = getSettings(config, "terraform");
  const ghSettings = getSettings(config, "github");
  const gcpSettings = getSettings(config, "gcp");

  if (tfSettings.ci === "github-actions" && servers.includes("github") && servers.includes("terraform")) {
    chains.push({
      trigger: "Terraform CI is GitHub Actions",
      steps: [
        "Create a feature branch for .tf changes",
        "Push and open a PR — GitHub Actions runs `terraform plan`",
        "Review the plan output in the PR checks/comments",
        "On approval and merge, GitHub Actions runs `terraform apply`",
        "Verify the apply succeeded via Terraform workspace status",
      ],
    });
  }

  if (ghSettings.issueTracker === "jira" && servers.includes("atlassian") && servers.includes("github")) {
    chains.push({
      trigger: "Issue tracking is Jira (via Atlassian) with GitHub PRs",
      steps: [
        "Look up the Jira ticket for context before starting work",
        "Reference the Jira ticket key in branch names and PR titles (e.g., `PROJ-123`)",
        "Update the Jira ticket status when the PR is opened, reviewed, and merged",
        "Link the PR URL in the Jira ticket for traceability",
      ],
    });
  }

  if (ghSettings.codeReview && servers.includes("github")) {
    chains.push({
      trigger: "Code review via GitHub PRs",
      steps: [
        "Always create a branch and PR — never push directly to main",
        "Request reviewers and wait for approval before merging",
        "Check CI status before merging",
      ],
    });
  }

  if (gcpSettings.services && tfSettings && servers.includes("gcp") && servers.includes("terraform")) {
    const projects = gcpSettings.projects as string[] | undefined;
    const projectLabel = projects?.length ? projects.join(", ") : "(from config)";
    chains.push({
      trigger: "GCP infrastructure managed by Terraform",
      steps: [
        "Use Terraform to provision/modify GCP resources — do not create them directly",
        "Verify GCP resource state after Terraform apply",
        `Target GCP project(s): ${projectLabel}`,
      ],
    });
  }

  return chains;
}

// ---------------------------------------------------------------------------
// Server description builder (includes toolsets and scoping context)
// ---------------------------------------------------------------------------

function describeServer(name: string, decl: { toolsets?: string[]; settings?: Record<string, unknown> }): string {
  const parts: string[] = [`- **${name}**`];
  const settings = decl?.settings ?? {};

  const notes = settings.usageNotes;
  if (typeof notes === "string" && notes.trim()) {
    parts[0] += ` — ${notes.trim()}`;
  }

  if (decl?.toolsets && decl.toolsets.length > 0) {
    parts.push(`  - Enabled toolsets: ${decl.toolsets.join(", ")}`);
  }

  const contextFields = Object.entries(settings).filter(
    ([k, v]) => k !== "usageNotes" && v !== undefined && v !== "",
  );
  for (const [k, v] of contextFields) {
    const val = Array.isArray(v) ? v.join(", ") : String(v);
    const desc = SETTING_DESCRIPTIONS[name]?.[k];
    parts.push(desc ? `  - ${k}: ${val} (${desc})` : `  - ${k}: ${val}`);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

export function buildInstructionPrompt(
  config: WorkspaceConfig,
  identities?: ProviderIdentities,
): string {
  const serverNames = Object.keys(config.servers);
  const serverDescriptions = serverNames.map((name) =>
    describeServer(name, config.servers[name] ?? {}),
  );

  const sections: string[] = [
    "You are generating agent instructions for a software development project that uses MCP (Model Context Protocol) servers to give AI coding assistants access to external tools.",
    "",
    "IMPORTANT: All authentication, token configuration, and environment setup is handled by `agent-toolkit init`. Do NOT include setup, installation, or configuration steps in the generated instructions. Focus exclusively on usage guidance — what the AI should DO with these tools, not how to set them up.",
    "",
    "Generate concise, actionable Markdown instructions that an AI coding assistant should follow when using these tools. The output must be client-agnostic (no Cursor-specific, Claude-specific, or other client-specific formatting).",
    "",
    "## Configured MCP Servers",
    "",
    ...serverDescriptions,
  ];

  if (identities && Object.keys(identities).length > 0) {
    sections.push("", "## Pinned Identities", "");
    sections.push("The developer has pinned these accounts for this project. Instructions MUST reference these specific identities where relevant (e.g., \"use account X for GitHub operations\").", "");
    for (const [provider, identity] of Object.entries(identities)) {
      if (!identity || Object.keys(identity).length === 0) continue;
      const pairs = Object.entries(identity)
        .map(([k, v]) => `${k}: ${String(v)}`)
        .join(", ");
      sections.push(`- **${provider}**: ${pairs}`);
    }
  }

  const chains = deriveInterToolChains(config);
  if (chains.length > 0) {
    sections.push("", "## Derived Inter-Tool Workflows", "");
    sections.push("Based on the server settings above, the following cross-tool patterns apply. Your generated instructions MUST include these workflows:", "");
    for (const chain of chains) {
      sections.push(`### ${chain.trigger}`);
      for (let i = 0; i < chain.steps.length; i++) {
        sections.push(`${i + 1}. ${chain.steps[i]}`);
      }
      sections.push("");
    }
  }

  sections.push(
    "",
    "## What to Generate",
    "",
    "Write Markdown instructions covering:",
    "",
    "1. **Per-server guidance**: For each configured server, explain best practices — what to check first, common pitfalls, preferred workflows. When toolsets are specified, focus ONLY on those toolsets — do not generate guidance for capabilities that are not enabled. When a pinned identity exists for a server, include it explicitly in the guidance (e.g., \"authenticate as `user@example.com`\", \"use the `org/repo` account\"). Reference usage notes and scoping context (organization, projects, workspaces, repositories) when present — these define the boundaries the AI should operate within.",
    "2. **Cross-server orchestration** (only if multiple servers are configured): How the tools work together. Use the derived inter-tool workflows above as the basis — expand them into concrete, step-by-step instructions the AI should follow.",
    "3. **Context-gathering patterns**: What context the AI should gather before taking actions (e.g., check PR status before merging, review Terraform plan before applying).",
    "",
    "## Output Rules",
    "",
    "- Use `## Server Name` headings for per-server sections.",
    "- Add a final `## Cross-Server Workflows` section if multiple servers are configured.",
    "- Be concise — focus on what the AI should DO, not general descriptions of what the tools are.",
    "- Do not wrap the output in code fences or add a title heading.",
    "- Do not include preamble or sign-off text — output only the instructions.",
  );

  return sections.join("\n");
}

const SETTING_DESCRIPTIONS: Record<string, Record<string, string>> = {
  github: {
    organization: "GitHub organization to operate within",
    repositories: "repositories the agent should focus on",
    ci: "whether GitHub Actions CI is active",
    codeReview: "whether PRs are used for code review",
    issueTracker: "where issues are tracked — if 'jira', PRs should reference Jira tickets",
  },
  gcp: {
    projects: "GCP project IDs to target",
    region: "default GCP region",
    services: "GCP services in use in this project",
  },
  terraform: {
    organization: "Terraform Cloud/Enterprise organization",
    projects: "Terraform Cloud projects to operate within",
    workspaces: "Terraform workspaces to operate within",
    backend: "where Terraform state is stored",
    ci: "CI system that runs terraform plan/apply",
    stateUrl: "direct URL to the state backend",
  },
  atlassian: {
    site: "Atlassian site hostname",
    projects: "Jira project keys relevant to this repo",
  },
};

// ---------------------------------------------------------------------------
// LLM Instruction Generator
// ---------------------------------------------------------------------------

export async function generateLlmInstructions(
  client: ClientTarget,
  config: WorkspaceConfig,
  cwd?: string,
  onData?: DiagnosticDataCallback,
  identities?: ProviderIdentities,
): Promise<string> {
  const availability = await checkCliAvailable(client);
  if (!availability.available) {
    throw new Error(
      `CLI for "${client}" is not available. ${availability.remediation ?? ""}`,
    );
  }

  const spec = CLIENT_CLI_SPECS[client];
  const prompt = buildInstructionPrompt(config, identities);
  const streaming = !!(onData && spec.streamFlag);
  const resolvedCwd = resolve(cwd ?? process.cwd());
  const workspaceArgs = spec.workspaceFlag ? [spec.workspaceFlag, resolvedCwd] : [];
  const args = [
    ...spec.headlessFlag,
    prompt,
    ...(streaming ? spec.streamFlag! : []),
    ...(spec.modelFlag ?? []),
    ...(spec.extraFlags ?? []),
    ...workspaceArgs,
  ];

  // Always pass onData so stderr is forwarded in real-time even for
  // non-streaming clients. For streaming clients, NDJSON text deltas
  // from stdout are also forwarded.
  const result = await spawnCli(
    spec.binary,
    args,
    resolvedCwd,
    onData,
    GENERATION_TIMEOUT_MS,
  );
  // Forward stdout post-completion for non-streaming clients only —
  // streaming clients already emitted stdout deltas via NDJSON parsing.
  if (!streaming && onData && result.stdout) {
    onData(result.stdout);
  }

  return result.output.trim();
}
