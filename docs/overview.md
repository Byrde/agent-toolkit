# Software Development Project: Agent Toolkit

## Overview

### 1. Project Name

- **Agent Toolkit**

### 2. Project Description

- A CLI-driven developer tool that configures MCP servers and generates best-practice agent instructions for any AI coding client, scoped strictly to the project directory. Developers declare what tools they use and how they use them; the toolkit wires everything up and teaches the AI client how to use those tools effectively — individually and in combination.

### 3. Project Vision

- You open your AI coding client in a project directory and it immediately knows your tools: your GitHub repo, your Terraform workspaces, your cloud resources, your issue tracker, your design tool. It doesn't just have access — it knows *when* to use each tool, *what context* to pull, and *how* to chain them together for real workflows. You say "check the deployment status" and it knows to look at Terraform state in GCS, cross-reference with the GitHub Actions run, and summarize the result. All of this from a single config file and one CLI command. Open a different directory without a config? Plain AI session, zero bleed.

### 4. Problem Statement

- AI coding assistants support MCP integrations, but configuring them is manual and fragile: finding the right server, choosing the right toolsets, injecting tokens, and writing useful agent instructions. Worse, even when servers are configured, the AI doesn't know *how* to use them well — it doesn't know which tool to reach for in a given situation, what context to gather first, or how to combine tools for multi-step workflows. The result is that MCP servers get configured but underused, and the AI remains a code-completion tool instead of a genuine workflow partner.

### 5. Target Audience

- **Primary Audience:** Software engineers who use AI coding tools (Cursor, Claude Code, VS Code + Copilot, Codex, Gemini CLI) and want them deeply integrated with their development workflow tools.
- **Secondary Audience:** Engineering leads and platform teams who want to standardize AI tooling configuration across projects with minimal per-developer friction.

### 6. Key Features

- - **Workspace Config:** A declarative config file (`.agent-toolkit.json`) checked into a project repo that specifies which MCP servers to enable, how they're configured, and how the AI should use them. Captures workflow-level intent (e.g., "Terraform uses GCS backend, deployed via GitHub Actions") that drives intelligent instruction generation.
- - **Multi-Client Config Generation:** Reads the workspace config and generates project-level MCP configuration for the developer's AI coding client (Cursor, Claude Code, VS Code + Copilot, Codex, Gemini CLI). All generated files live in the project directory — no global config, no bleed between projects.
- - **Auth Doctor:** Validates that the developer's local authentication is correctly configured for each required MCP server before generating config, with guided remediation on failure.
- - **Intelligent Agent Instructions:** A maintained library of orchestration prompts that teach the AI client how to use each MCP server effectively and how to chain them for multi-step workflows. Instructions are context-aware: they adapt based on the workspace config (e.g., if Terraform uses a GCS backend, the instructions know to check GCS for state). Stored in a canonical format and transpiled into each client's native instruction format (`.cursor/rules/`, `CLAUDE.md`, `.github/copilot-instructions.md`, `AGENTS.md`, `GEMINI.md`).
- - **Onboarding CLI:** A single `init` command handles both initial repository setup and individual developer onboarding. On first run it walks the developer through server selection and writes `.agent-toolkit.json`; on subsequent runs it offers to reconfigure any step. The flow is: configure → doctor → install client config → heartbeat. Supports non-interactive use via flags for CI and scripting. A standalone `doctor` command provides verification and guided remediation at any time.
- - **AI Client Heartbeat:** After config installation, the toolkit invokes the AI client's CLI in headless mode to verify end-to-end functionality: the AI can see its configured MCP tools, accurately describe how to use each one, and execute basic commands. A second CLI instance independently validates the diagnostic output using a judge/evaluator pattern. Runs as part of both `init` and `doctor` — no separate command or flag needed.
- - **Project-Level Scoping:** Everything the toolkit produces is scoped to the project directory. An AI client session in a directory without a toolkit config is completely unaffected.

### 7. Technology Stack

- **Runtime:** Node.js (>=20), TypeScript (ESM)
- **Package Management:** npm workspaces (monorepo)
- **Distribution:** npm package (`npx agent-toolkit`)
- **External Dependencies:** Maintained MCP servers (GitHub, Terraform, Atlassian, GCP) — consumed, not built
- **Auth Validation:** Shells out to CLI tools (`gh auth status`, `gcloud auth`, etc.) or validates tokens
- **Config Targets:** JSON/Markdown file generation for client-specific formats

