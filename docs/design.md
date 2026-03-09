# Domain-Driven Design (DDD) Strategy

### 1. Ubiquitous Language Glossary


| Term                     | Definition                                                                                                                                                                                                                                                                         | Aliases                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **Workspace Config**     | A declarative JSON file (`.agent-toolkit.json`) checked into a project repo that specifies which MCP servers to enable, their settings, and workflow-level hints that drive instruction generation.                                                                                | `config`, `toolkit config`                  |
| **MCP Server**           | An external process that exposes tools to AI agents via the Model Context Protocol. The toolkit configures maintained third-party servers; it does not build them (Phase 1).                                                                                                       | `server`, `integration`                     |
| **AI Coding Client**     | A specific AI coding tool (Cursor, Claude Code, VS Code + Copilot, Codex, Gemini CLI) with its own MCP config format and instruction file format.                                                                                                                                  | `client`, `client target`                   |
| **Config Fragment**      | A generated JSON block representing one MCP server's configuration for a specific client. Multiple fragments are merged into the client's config file.                                                                                                                             | `server config`                             |
| **Agent Instructions**   | Orchestration prompts that teach the AI how to use MCP tools effectively — individually and in combination. Stored canonically and transpiled per client. Adapt based on workspace config context.                                                                                 | `rules`, `prompts`, `orchestration prompts` |
| **Workflow Hint**        | A declaration in the workspace config that captures how tools relate in the developer's workflow (e.g., "Terraform deploys via GitHub Actions with GCS backend"). Drives conditional instruction generation.                                                                       | `workflow context`, `integration hint`      |
| **Auth Check**           | Validation that a developer's local credentials are valid for a given MCP server before config is generated.                                                                                                                                                                       | `doctor check`, `auth validation`           |
| **Toolset**              | A named group of capabilities within an MCP server (e.g., GitHub's `repos`, `issues`, `pull_requests`). The workspace config specifies which toolsets to enable.                                                                                                                   | `tool group`                                |
| **Project-Level Config** | MCP configuration scoped to a single project directory (e.g., `.cursor/mcp.json`), ensuring toolkit config doesn't bleed into unrelated directories.                                                                                                                               | `workspace config`, `local config`          |
| **Transpilation**        | Converting canonical agent instructions into a client-specific format (`.cursor/rules/*.mdc`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`).                                                                                                           | `instruction generation`                    |
| **Instruction Template** | A canonical, client-agnostic instruction definition that includes: trigger conditions, tool chain steps, required context, and conditional sections activated by workflow hints.                                                                                                   | `canonical instruction`                     |
| **Client CLI Spec**      | A registry entry mapping an AI coding client to its CLI binary name, headless invocation flags, and JSON output flags. Used by the heartbeat to invoke the client programmatically.                                                                                                | `cli spec`, `cli registry entry`            |
| **Heartbeat**            | A diagnostic that invokes the AI coding client's CLI in headless mode to verify it can see configured MCP tools, understands how to use them, and can execute basic commands. Uses a judge/evaluator pattern: one CLI instance runs the diagnostic, a second validates the output. | `AI client heartbeat`, `deep diagnostic`    |
| **Diagnostic Prompt**    | A structured prompt sent to the AI client CLI during heartbeat. Instructs the AI to list visible MCP tools, paraphrase their usage, and execute minimal read-only commands. Requests JSON output for reliable parsing.                                                             | `heartbeat prompt`                          |
| **Validation Prompt**    | A structured prompt sent to a second AI client CLI instance during heartbeat. Provides expected answers (from workspace config) and the diagnostic output, asks the validator to judge correctness per tool.                                                                       | `judge prompt`, `evaluator prompt`          |


### 2. Core Domain and Bounded Context

- **Core Domain:** Intelligent MCP configuration and instruction generation — translating a declarative workspace config into client-specific, project-scoped MCP server configs and context-aware agent instructions.
- **Bounded Contexts:**
  - - **Config Context:** Responsible for loading, validating, and resolving the workspace config. Understands the config schema, defaults, and which servers/toolsets/workflow hints apply. Resolves the config from `.agent-toolkit.json` in the project directory.
  - - **Auth Context:** Responsible for validating local developer credentials against each required MCP server. Knows how to check `gh auth status`, verify cloud tokens, test service connectivity. Provides remediation guidance on failure.
  - - **Config Generation Context:** Responsible for producing client-specific MCP config files. Knows the JSON schema for each AI coding client and how to merge fragments into existing config files without clobbering user additions. All output is project-directory-scoped.
  - - **Instruction Context:** The core differentiator. Responsible for maintaining a library of canonical instruction templates and rendering them into client-specific formats. Instructions are context-aware: workflow hints from the workspace config activate conditional sections (e.g., if Terraform uses a GCS backend, include GCS-specific guidance). This context produces the "intelligence" — the prompts that make the AI competent at using its tools.
  - - **Heartbeat Context:** Responsible for end-to-end verification that the AI coding client can actually see and use its configured MCP tools. Knows how to invoke each client's CLI in headless mode, build diagnostic and validation prompts from the workspace config, and parse structured responses. Uses a judge/evaluator pattern: one CLI instance exercises the tools, a second independently validates the results. Provides remediation when the CLI is unavailable, tools are not visible, or usage understanding is incorrect.

### 3. Aggregates

- **WorkspaceConfig Aggregate**
  - **Aggregate Root:** `WorkspaceConfig`
  - **Entities:** `ServerDeclaration`, `ToolsetSelection`
  - **Value Objects:** `ConfigPath`, `WorkflowHint`, `ServerIdentifier`
  - **Description:** Represents the fully resolved configuration for a project directory. Enforces that server declarations reference known MCP servers, toolset selections are valid for their server, and workflow hints are well-formed. Loaded from `.agent-toolkit.json` in the project root.
- **AuthReport Aggregate**
  - **Aggregate Root:** `AuthReport`
  - **Entities:** `ProviderAuthCheck`
  - **Value Objects:** `AuthResult`, `RemediationStep`
  - **Description:** Represents the result of validating all required auth providers for the resolved config. Determines whether config generation should proceed (all checks pass) or halt (with actionable remediation).
- **ClientConfig Aggregate**
  - **Aggregate Root:** `ClientConfigBundle`
  - **Entities:** `ConfigFragment`, `InstructionFile`
  - **Value Objects:** `ClientTarget`, `ConfigFilePath`, `MergeStrategy`
  - **Description:** Represents the complete set of files to write for a given AI coding client. Enforces that fragments don't conflict, that existing user config is preserved during merge, and that instruction files match the client's expected format and location. For clients with a single instruction file, uses fenced sections (`<!-- BEGIN agent-toolkit -->` / `<!-- END agent-toolkit -->`) to isolate toolkit-managed content.
- **InstructionSet Aggregate**
  - **Aggregate Root:** `InstructionSet`
  - **Entities:** `InstructionTemplate`
  - **Value Objects:** `TriggerCondition`, `ToolChainStep`, `ConditionalSection`, `WorkflowHintRef`
  - **Description:** Represents the canonical library of agent instructions. Each template defines when it applies, what tools it chains, and which sections are conditionally activated by workflow hints. The InstructionSet resolves which templates apply for a given workspace config and renders them for transpilation.
- **HeartbeatReport Aggregate**
  - **Aggregate Root:** `HeartbeatReport`
  - **Entities:** `HeartbeatToolResult`
  - **Value Objects:** `ClientCliSpec`, `DiagnosticPrompt`, `ValidationPrompt`, `HeartbeatResult`
  - **Description:** Represents the result of invoking the AI client CLI to verify MCP tool visibility, usage understanding, and basic command execution. `ClientCliSpec` maps each `ClientTarget` to its binary, headless flags, and JSON output flags. The diagnostic phase produces raw CLI output; the validation phase judges it against expected answers derived from the workspace config. Each `HeartbeatToolResult` carries per-tool verdicts (listed, paraphrase accurate, basic command passed). The aggregate determines overall pass/fail and surfaces remediation for failures (CLI not installed, tools not visible, incorrect usage understanding, command failures).

