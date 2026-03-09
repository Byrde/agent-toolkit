# Testability Guide

This document describes how AI verifies each feature through shell-based execution.

## Verification Methods

### Quick Reference
| Feature | Verification Command | Type |
| :--- | :--- | :--- |
| Config schema & loader | `npm test -w @byrde/agent-toolkit-core` | Standard |
| Workflow hints resolution | `npm test -w @byrde/agent-toolkit-core` | Standard |
| GitHub auth check | `node --import tsx --test --test-name-pattern "checkGitHubAuth" packages/core/src/auth-checker.test.ts` | Standard |
| GitHub auth check (live) | `npx agent-toolkit doctor` | User-in-the-Loop |
| GCP auth check | `node --import tsx --test --test-name-pattern "checkGcpAuth" packages/core/src/auth-checker.test.ts` | Standard |
| GCP auth check (live) | `npx agent-toolkit doctor` | User-in-the-Loop |
| Terraform auth check | `node --import tsx --test --test-name-pattern "checkTerraformAuth" packages/core/src/auth-checker.test.ts` | Standard |
| Terraform auth check (live) | `npx agent-toolkit doctor` | User-in-the-Loop |
| Atlassian auth check | `node --import tsx --test --test-name-pattern "checkAtlassianAuth" packages/core/src/auth-checker.test.ts` | Standard |
| Atlassian auth check (live) | `npx agent-toolkit doctor` | User-in-the-Loop |
| Doctor CLI command | `npx agent-toolkit doctor --help && npx agent-toolkit doctor --client cursor` | Standard + User-in-the-Loop |
| Init command (interactive) | `npx agent-toolkit init` | User-in-the-Loop |
| Build instructions from config | `node --import tsx --test --test-name-pattern "buildInstructions" packages/cli/src/cli.test.ts` | Standard |
| Cursor config generation | See [Standard: Cursor Config Generation] | Standard |
| Claude Code config generation | See [Standard: Claude Code Config Generation] | Standard |
| VS Code config generation | See [Standard: VS Code Config Generation] | Standard |
| Gitignore fencing | See [Standard: Gitignore Fencing] | Standard |
| Config merge strategy | See [Standard: Config Merge] | Standard |
| Init CLI command (end-to-end) | See [User-in-the-Loop: Init Command] | User-in-the-Loop |
| Cursor instructions writer | `node --import tsx --test --test-name-pattern "writeCursorInstructions" packages/core/src/instruction-writer.test.ts` | Standard |
| Claude Code instructions writer | `node --import tsx --test --test-name-pattern "writeClaudeCodeInstructions" packages/core/src/instruction-writer.test.ts` | Standard |
| VS Code instructions writer | `node --import tsx --test --test-name-pattern "writeVsCodeInstructions" packages/core/src/instruction-writer.test.ts` | Standard |
| Codex instructions writer | `node --import tsx --test --test-name-pattern "writeCodexInstructions" packages/core/src/instruction-writer.test.ts` | Standard |
| Gemini instructions writer | `node --import tsx --test --test-name-pattern "writeGeminiInstructions" packages/core/src/instruction-writer.test.ts` | Standard |
| Fenced section utility | `node --import tsx --test --test-name-pattern "upsertFencedSection" packages/core/src/instruction-writer.test.ts` | Standard |
| Unified instruction dispatcher | `node --import tsx --test --test-name-pattern "writeInstructions" packages/core/src/instruction-writer.test.ts` | Standard |
| Local config loader | `node --import tsx --test --test-name-pattern "loadLocalConfig\|getLocalConfigPath" packages/core/src/config-loader.test.ts` | Standard |
| Identity mismatch detection | `node --import tsx --test --test-name-pattern "identity mismatch\|identity pinning" packages/core/src/auth-checker.test.ts` | Standard |
| GitHub account listing | `node --import tsx --test --test-name-pattern "parseGitHubAccounts" packages/core/src/auth-checker.test.ts` | Standard |
| Extract pinnable identity | `node --import tsx --test --test-name-pattern "extractPinnableIdentity" packages/core/src/auth-checker.test.ts` | Standard |
| Write local config | `node --import tsx --test --test-name-pattern "writeLocalConfig" packages/core/src/config-loader.test.ts` | Standard |
| Identity capture in init (live) | `npx agent-toolkit init` | User-in-the-Loop |
| Per-project account selection (live) | See [User-in-the-Loop: Identity Pinning] | User-in-the-Loop |
| Client config verification | `node --import tsx --test --test-name-pattern "verifyClientConfig" packages/core/src/config-generator.test.ts` | Standard |
| Init verification step (live) | `npx agent-toolkit init` | User-in-the-Loop |
| Doctor verification (live) | `npx agent-toolkit doctor --client cursor` | User-in-the-Loop |
| Zero-bleed isolation | `node --import tsx --test packages/core/src/isolation.test.ts` | Standard |
| Client CLI registry & availability | `node --import tsx --test --test-name-pattern "ClientCliSpec\|checkCliAvailable" packages/core/src/client-diagnostic.test.ts` | Standard |
| Diagnostic runner | `node --import tsx --test --test-name-pattern "runDiagnostic" packages/core/src/client-diagnostic.test.ts` | Standard |
| Validation runner | `node --import tsx --test --test-name-pattern "runValidation" packages/core/src/client-diagnostic.test.ts` | Standard |
| Client diagnostic orchestrator | `node --import tsx --test --test-name-pattern "runClientDiagnostic" packages/core/src/client-diagnostic.test.ts` | Standard |
| Client diagnostic in init (live) | `npx agent-toolkit init` | User-in-the-Loop |
| Client diagnostic in doctor (live) | `npx agent-toolkit doctor --client cursor` | User-in-the-Loop |
| LLM instruction prompt builder | `node --import tsx --test --test-name-pattern "buildInstructionPrompt" packages/core/src/instruction-generator.test.ts` | Standard |
| LLM instruction generator | `node --import tsx --test --test-name-pattern "generateLlmInstructions" packages/core/src/instruction-generator.test.ts` | Standard |
| LLM instruction generation in init (live) | `npx agent-toolkit init` | User-in-the-Loop |

## Standard Verifications

### Config Schema & Loader
```bash
npm test -w @byrde/agent-toolkit-core
```
**Expected Output**: All config-related tests pass. Covers:
- `loadConfig` returns defaults when no `.agent-toolkit.json` exists
- `loadConfig` loads a project-level `.agent-toolkit.json` and returns typed `WorkspaceConfig`
- Workflow hints are parsed and available on the config object
- Invalid configs produce clear validation errors

### Auth Checker (dispatch + GitHub + GCP + Terraform)
```bash
node --import tsx --test --test-name-pattern "checkAuth|checkGitHubAuth|checkGcpAuth|checkTerraformAuth" packages/core/src/auth-checker.test.ts
```
**Expected Output**: All auth-related tests pass. Covers:
- `checkAuth` returns unsupported error for unknown providers
- `checkAuth` dispatches to registered GitHub, GCP, and Terraform checkers
- `registerAuthChecker` allows custom checker registration
- `checkGitHubAuth` returns valid `AuthStatus` with identity when authenticated
- `checkGcpAuth` returns valid `AuthStatus`; reports identity (active account) when authenticated
- `checkTerraformAuth` returns valid `AuthStatus`; resolves token from env var or credentials file
- `checkTerraformAuth` reports not authenticated for unknown hosts with correct remediation
- `checkAtlassianAuth` returns authenticated when `ATLASSIAN_EMAIL` and `ATLASSIAN_API_TOKEN` are set
- `checkAtlassianAuth` reports not authenticated with remediation when env vars are missing

### Cursor Config Generation (unit tests)
```bash
node --import tsx --test --test-name-pattern "buildCursorServers|generateCursorConfig|writeCursorConfig" packages/core/src/config-generator.test.ts
```
**Expected Output**: All Cursor config generation tests pass. Covers:
- `buildCursorServers` builds entries for known servers using defaults
- `buildCursorServers` uses user-provided command/args/env overrides
- `buildCursorServers` uses url for remote servers
- `generateCursorConfig` merges with existing `.cursor/mcp.json`
- `generateCursorConfig` works when no existing file
- `writeCursorConfig` creates `.cursor/` directory and writes config

### Claude Code Config Generation (unit tests)
```bash
node --import tsx --test --test-name-pattern "generateClaudeCodeConfig|writeClaudeCodeConfig" packages/core/src/config-generator.test.ts
```
**Expected Output**: All Claude Code config generation tests pass. Covers:
- `generateClaudeCodeConfig` produces `.mcp.json` at the project root (not inside `.cursor/`)
- `generateClaudeCodeConfig` merges with existing `.mcp.json`
- `writeClaudeCodeConfig` writes `.mcp.json` to the project root

### VS Code Config Generation (unit tests)
```bash
node --import tsx --test --test-name-pattern "buildVsCodeServers|mergeVsCodeConfig|generateVsCodeConfig|writeVsCodeConfig" packages/core/src/config-generator.test.ts
```
**Expected Output**: All VS Code config generation tests pass. Covers:
- `buildVsCodeServers` builds stdio entries with `type` field and generates `inputs` for missing env vars
- `buildVsCodeServers` uses runtime env value when available instead of input reference
- `buildVsCodeServers` builds http entry for url-based servers
- `mergeVsCodeConfig` preserves user-added servers and inputs
- `mergeVsCodeConfig` removes stale toolkit servers and inputs on re-run
- `generateVsCodeConfig` produces `.vscode/mcp.json` with `servers` key (not `mcpServers`)
- `generateVsCodeConfig` merges with existing `.vscode/mcp.json`
- `writeVsCodeConfig` creates `.vscode/` directory and writes config

### Gitignore Fencing (unit tests)
```bash
node --import tsx --test packages/core/src/gitignore.test.ts
```
**Expected Output**: All gitignore fencing tests pass. Covers:
- `upsertGitignoreSection` appends fenced section to existing content
- `upsertGitignoreSection` replaces existing fenced section in place (idempotent)
- `upsertGitignoreSection` creates content from empty string
- `updateGitignore` creates `.gitignore` when none exists
- `updateGitignore` preserves existing content and appends fenced section
- `updateGitignore` is idempotent on repeated calls

### Config Merge
```bash
node --import tsx --test --test-name-pattern "mergeCursorConfig" packages/core/src/config-generator.test.ts
```
**Expected Output**: Tests verify that existing user servers are preserved, toolkit-managed servers (prefixed `agent-toolkit:`) are updated in place, and removed config servers are cleaned up.

### Build Instructions from Config
```bash
node --import tsx --test --test-name-pattern "buildInstructions" packages/cli/src/cli.test.ts
```
**Expected Output**: All buildInstructions tests pass. Covers:
- `buildInstructions` generates markdown with server headings and usage notes
- `buildInstructions` lists servers without notes when usage notes are empty
- `buildInstructions` returns empty string when no servers configured

### Instruction Writers (all clients)
```bash
node --import tsx --test packages/core/src/instruction-writer.test.ts
```
**Expected Output**: All instruction writer tests pass. Covers:
- `upsertFencedSection` appends fenced section to existing content
- `upsertFencedSection` replaces existing fenced section in place (idempotent)
- `upsertFencedSection` creates content from empty string
- `upsertFencedSection` is idempotent on repeated calls
- `writeCursorInstructions` creates `.cursor/rules/agent-toolkit.mdc` with YAML frontmatter
- `writeCursorInstructions` overwrites on re-run (dedicated file strategy)
- `writeClaudeCodeInstructions` creates `CLAUDE.md` with fenced section
- `writeClaudeCodeInstructions` preserves user content and replaces fenced section on re-run
- `writeVsCodeInstructions` creates `.github/copilot-instructions.md` with fenced section
- `writeCodexInstructions` creates `AGENTS.md` with fenced section
- `writeGeminiInstructions` creates `GEMINI.md` with fenced section
- `writeInstructions` dispatches to correct writer by client name
- `writeInstructions` throws for unknown client

### Local Config Loader
```bash
node --import tsx --test --test-name-pattern "loadLocalConfig|getLocalConfigPath" packages/core/src/config-loader.test.ts
```
**Expected Output**: All local config tests pass. Covers:
- `getLocalConfigPath` returns path relative to cwd
- `loadLocalConfig` returns empty defaults when no `.agent-toolkit.local.json` exists
- `loadLocalConfig` loads provider identities from local config file
- `loadLocalConfig` rejects non-object local config files

### GitHub Account Listing
```bash
node --import tsx --test --test-name-pattern "parseGitHubAccounts" packages/core/src/auth-checker.test.ts
```
**Expected Output**: All account listing tests pass. Covers:
- `parseGitHubAccounts` parses single account from `gh auth status` output
- `parseGitHubAccounts` parses multiple accounts across hosts
- `parseGitHubAccounts` returns empty array for unparseable output

### Extract Pinnable Identity
```bash
node --import tsx --test --test-name-pattern "extractPinnableIdentity" packages/core/src/auth-checker.test.ts
```
**Expected Output**: All identity extraction tests pass. Covers:
- Extracts `{ account }` from GitHub identity string
- Extracts `{ account }` from GCP identity string
- Extracts `{ host }` from Terraform identity string
- Extracts `{ email }` from Atlassian identity string
- Returns `undefined` for unauthenticated providers
- Returns `undefined` when identity is missing
- Returns `undefined` for unknown providers

### Write Local Config
```bash
node --import tsx --test --test-name-pattern "writeLocalConfig" packages/core/src/config-loader.test.ts
```
**Expected Output**: All write local config tests pass. Covers:
- Writes local config as formatted JSON
- Merges with existing local config (preserves entries, overwrites conflicts)
- Creates file when none exists

### Identity Mismatch Detection
```bash
node --import tsx --test --test-name-pattern "identity mismatch|identity pinning" packages/core/src/auth-checker.test.ts
```
**Expected Output**: All identity mismatch tests pass. Covers:
- `checkAtlassianAuth` reports `identityMismatch: true` when expected email differs from actual
- `checkAtlassianAuth` does not report mismatch when expected email matches
- `checkAuth` passes identity map to provider checkers
- `checkAuth` works without identity map (backward compatible)

### Client Config Verification
```bash
node --import tsx --test --test-name-pattern "verifyClientConfig" packages/core/src/config-generator.test.ts
```
**Expected Output**: All verification tests pass. Covers:
- `verifyClientConfig` returns all entries as `ok` when config file contains expected server keys
- `verifyClientConfig` returns `missing` for servers not present in config file
- `verifyClientConfig` returns `fileExists: false` when config file does not exist

### Isolation Verification
```bash
node --import tsx --test packages/core/src/isolation.test.ts
```
**Expected Output**: All isolation tests pass. Covers:
- All write functions (3 config generators, 5 instruction writers, gitignore, local config) produce artifacts in the target directory
- A sibling directory remains completely empty (zero files)
- No toolkit artifacts leak outside the target directory into the parent

### Client CLI Registry & Availability Check
```bash
node --import tsx --test --test-name-pattern "ClientCliSpec|checkCliAvailable" packages/core/src/client-diagnostic.test.ts
```
**Expected Output**: All CLI registry and availability tests pass. Covers:
- `CLIENT_CLI_SPECS` contains entries for all supported clients (cursor, claude-code, vscode, codex, gemini-cli)
- Each spec has `binary`, `headlessFlag`, and `jsonFlag` fields
- Cursor spec includes `--trust` and `--approve-mcps` in `extraFlags` for non-interactive operation
- Claude Code spec includes `--dangerously-skip-permissions` in `extraFlags`
- `checkCliAvailable` returns `available: true` with path when binary exists
- `checkCliAvailable` returns `available: false` with remediation when binary is missing

### Diagnostic Runner
```bash
node --import tsx --test --test-name-pattern "runDiagnostic" packages/core/src/client-diagnostic.test.ts
```
**Expected Output**: All diagnostic runner tests pass. Covers:
- `runDiagnostic` invokes the client CLI with correct headless and JSON flags
- `runDiagnostic` builds a diagnostic prompt that includes configured server names
- `runDiagnostic` returns raw CLI output on success
- `runDiagnostic` throws on CLI timeout (60s)
- `runDiagnostic` throws on non-zero exit
- `runDiagnostic` throws when CLI is not available
- `runDiagnostic` streams output to `onData` callback in real-time

### Validation Runner
```bash
node --import tsx --test --test-name-pattern "runValidation" packages/core/src/client-diagnostic.test.ts
```
**Expected Output**: All validation runner tests pass. Covers:
- `runValidation` invokes a second CLI instance with the diagnostic output and expected answers
- `runValidation` builds expected answers from workspace config (tool names, usage summaries)
- `runValidation` parses structured JSON response into `ClientDiagnosticResult`
- `runValidation` returns partial results when JSON parsing fails (falls back to text analysis)
- `runValidation` returns per-tool verdicts: `listed`, `paraphraseAccurate`, `basicCommandPassed`

### Client Diagnostic Orchestrator
```bash
node --import tsx --test --test-name-pattern "runClientDiagnostic" packages/core/src/client-diagnostic.test.ts
```
**Expected Output**: All client diagnostic orchestrator tests pass. Covers:
- `runClientDiagnostic` short-circuits with CLI remediation when binary is not available
- `runClientDiagnostic` runs diagnostic then validation in sequence
- `runClientDiagnostic` returns `overallPass: true` when all tools pass all criteria
- `runClientDiagnostic` returns `overallPass: false` with per-tool details on partial failure
- `runClientDiagnostic` handles diagnostic failure gracefully (reports error, does not throw)
- `runClientDiagnostic` handles validation failure gracefully (reports error, does not throw)

### LLM Instruction Prompt Builder
```bash
node --import tsx --test --test-name-pattern "buildInstructionPrompt" packages/core/src/instruction-generator.test.ts
```
**Expected Output**: All prompt builder tests pass. Covers:
- `buildInstructionPrompt` includes configured server names
- `buildInstructionPrompt` includes usage notes for servers that have them
- `buildInstructionPrompt` omits usage notes for servers without them
- `buildInstructionPrompt` includes workflow hints when present
- `buildInstructionPrompt` omits workflow section when no workflows configured
- `buildInstructionPrompt` requests client-agnostic Markdown output
- `buildInstructionPrompt` asks for per-server guidance and cross-server orchestration

### LLM Instruction Generator
```bash
node --import tsx --test --test-name-pattern "generateLlmInstructions" packages/core/src/instruction-generator.test.ts
```
**Expected Output**: All instruction generator tests pass. Covers:
- `generateLlmInstructions` throws when CLI is not available
- `generateLlmInstructions` invokes the CLI and returns trimmed output
- `generateLlmInstructions` passes prompt containing server names to the CLI
- `generateLlmInstructions` streams output to `onData` callback

## User-in-the-Loop Verifications

### Doctor Command (Auth Checks)
**AI Setup**:
```bash
npx agent-toolkit doctor --cwd . --client cursor
```

**User Action Required**:
> Review the doctor output table. Confirm that:
> - Each required provider shows authenticated or provides clear remediation
> - For any failing checks, follow the printed remediation steps and re-run.
> - If `--client` is omitted, an interactive prompt asks which client to use.

**AI Verification** (after user confirms completion):
```bash
npx agent-toolkit doctor --cwd . --json
```
**Expected Result**: JSON output with all required providers showing `"authenticated": true`.

### Init Command
**AI Setup**:
```bash
npx agent-toolkit init --cwd .
```

**User Action Required**:
> Follow the interactive prompts: select servers, optionally enter usage notes.
> Auth checks run without identity expectations (availability-only) — mismatches from a previous pinning do not block init.
> After auth checks pass, observe the identity pinning step:
> - For GitHub/GCP: if multiple accounts are authenticated, a picker should appear (pre-selecting the previously pinned account if one exists). If single account, a confirm prompt.
> - For Terraform/Atlassian: a confirm prompt showing the detected identity.
> - On re-run, previously pinned values appear as defaults — the user can re-select.
> Verify that `.agent-toolkit.local.json` was created with the pinned identities.
> Select AI client when prompted.
> If config already exists, confirm or decline reconfiguration when prompted.
> Verify that `.agent-toolkit.json` was created/updated with the expected content.
> Verify that client-specific config files were created/updated in the project directory.
> Restart the IDE and verify MCP servers appear in the IDE's MCP panel.

**AI Verification** (after user confirms completion):
```bash
cat .cursor/mcp.json | python3 -m json.tool
cat .agent-toolkit.local.json | python3 -m json.tool
cat .cursor/rules/agent-toolkit.mdc
```
**Expected Result**: Valid JSON with `mcpServers` containing the servers declared in the config. Local config contains pinned identities. Instruction file contains rendered orchestration prompts.

### Identity Pinning (Per-Project Account Selection)

#### Doctor validates against pinned identities
**AI Setup**:
```bash
rm -rf /tmp/toolkit-identity-test && mkdir -p /tmp/toolkit-identity-test
echo '{"servers":{"github":{},"atlassian":{}}}' > /tmp/toolkit-identity-test/.agent-toolkit.json
echo '{"identity":{"github":{"account":"wrong-user"},"atlassian":{"email":"wrong@example.com"}}}' > /tmp/toolkit-identity-test/.agent-toolkit.local.json
npx agent-toolkit doctor --cwd /tmp/toolkit-identity-test --client cursor
```

**User Action Required**:
> Review the doctor output table. Confirm that:
> - Providers with mismatched identities show `MISMATCH` status
> - Remediation steps indicate the expected identity and point to `agent-toolkit init` for re-pinning
> - Providers without pinned identities show normal `OK` or `FAIL` status

**AI Verification** (after user confirms):
```bash
npx agent-toolkit doctor --cwd /tmp/toolkit-identity-test --client cursor --json
```
**Expected Result**: JSON output with `identityMismatch: true` for providers where the pinned identity differs from the active one.

#### Init allows re-pinning without mismatch failure
**AI Setup**:
```bash
rm -rf /tmp/toolkit-repin-test && mkdir -p /tmp/toolkit-repin-test
echo '{"servers":{"github":{}}}' > /tmp/toolkit-repin-test/.agent-toolkit.json
echo '{"identity":{"github":{"account":"old-user"}}}' > /tmp/toolkit-repin-test/.agent-toolkit.local.json
npx agent-toolkit init --cwd /tmp/toolkit-repin-test
```

**User Action Required**:
> Confirm that:
> - Auth check passes (no mismatch failure even though pinned account differs from active)
> - Identity pinning step offers re-selection with `old-user` as the default
> - After selecting a new account, `.agent-toolkit.local.json` is updated with the new identity

### Client Diagnostic via Init
**AI Setup**:
```bash
npx agent-toolkit init --cwd .
```

**User Action Required**:
> Complete the interactive prompts (server selection, AI client selection).
> After config installation and verification, observe the client diagnostic step.
> Confirm that:
> - The CLI availability check reports the client binary as found (or provides install remediation if missing)
> - Streaming output from the AI client is visible inline (dimmed, prefixed with `│`) for both diagnostic and validation phases
> - The diagnostic phase reports which MCP tools the AI can see
> - The validation phase reports per-tool verdicts (listed / usage accurate / command OK)
> - If diagnostic fails, `init` still completes successfully (warning only) since config is already installed

**AI Verification** (after user confirms completion):
> Diagnostic results are printed inline with streaming output. Verify the summary table shows expected tools with their status.

### Client Diagnostic via Doctor
**AI Setup**:
```bash
npx agent-toolkit doctor --cwd . --client cursor
```

**User Action Required**:
> Observe the doctor output. After auth checks and config verification, the client diagnostic runs for the specified client.
> Confirm that:
> - Streaming output from the AI client is visible inline (dimmed, prefixed with `│`) during diagnostic and validation
> - Diagnostic summary table appears after the streaming output
> - Each configured tool shows verdicts for: listed, usage accurate, basic command
> - If any tool fails, remediation is printed (e.g., "Restart IDE", "Check MCP server config")
> - `doctor` exits non-zero if diagnostic fails
> - If `--client` is omitted, an interactive prompt asks which client to use

**AI Verification** (after user confirms):
> Re-run doctor and verify all diagnostic checks pass. If a tool consistently fails, check that the MCP server is running and the client can reach it.

### LLM Instruction Generation via Init
**AI Setup**:
```bash
npx agent-toolkit init --cwd .
```

**User Action Required**:
> Complete the interactive prompts (server selection, AI client selection).
> After auth checks pass, observe the instruction generation step.
> Confirm that:
> - Streaming output from the AI client is visible inline (dimmed, prefixed with `│`) during generation
> - Generated instructions contain per-server guidance sections (`## server-name` headings)
> - If multiple servers are configured, a cross-server workflows section is present
> - Instructions are written to the client-specific instruction file
> - If AI client CLI is not available, static fallback instructions are generated instead (with a warning message)

**AI Verification** (after user confirms completion):
```bash
cat .cursor/rules/agent-toolkit.mdc
```
**Expected Result**: File contains generated Markdown instructions with per-server sections and (if multiple servers) cross-server workflow guidance.

## Environment Setup

### Prerequisites
- Node.js >= 20
- npm
- Git
- `gh` CLI (for GitHub auth validation)
- `gcloud` CLI (for GCP auth validation, if GCP servers configured)
- AI client CLI installed (e.g., `claude`, `agent`, `copilot`, `codex`, `gemini`) — required for client diagnostics

### Before Testing
```bash
npm install
npm run build
```

### Cleanup
```bash
rm -rf /tmp/toolkit-isolated /tmp/toolkit-clean /tmp/toolkit-identity-test
```
