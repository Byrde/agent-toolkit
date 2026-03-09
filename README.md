# Agent Toolkit

AI coding assistants support MCP integrations, but configuring them is manual and the AI doesn't know how to use them well. Agent Toolkit fixes both problems. Declare what tools you use in a config file, run one command, and your AI client gets properly configured MCP servers *and* best-practice instructions that teach it how to use those tools — individually and together.

Everything is project-scoped. Open a configured project and your AI is fully wired. Open a different directory and nothing bleeds through.

## Usage

Interactive wizard that configures MCP servers, agent instructions, and auth for your AI client.

```bash
npx agent-toolkit init [options]
  --cwd <path>       Project directory (defaults to cwd)
  --client <target>  AI client: cursor, claude-code, copilot, codex, gemini-cli
  -v, --verbose      Enable debug output
```

Restart your IDE when it finishes. On subsequent runs, `init` detects your existing config and offers to reconfigure.

## Troubleshooting

Validates auth, client config, and end-to-end MCP connectivity for a configured project.

```bash
npx agent-toolkit doctor [options]
  --cwd <path>       Project directory (defaults to cwd)
  --client <target>  AI client: cursor, claude-code, copilot, codex, gemini-cli
  --json             Machine-readable JSON output
  -v, --verbose      Enable debug output
```

## Reference

### Supported servers


| Server        | Transport | Auth mechanism                           |
| ------------- | --------- | ---------------------------------------- |
| **GitHub**    | npx       | `GITHUB_PERSONAL_ACCESS_TOKEN` via `gh`  |
| **GCP**       | npx       | `gcloud` application-default credentials |
| **Terraform** | Docker    | `TFE_TOKEN` or credentials file          |
| **Atlassian** | npx       | OAuth (browser-based)                    |


### Supported AI clients


| Client          | MCP config path         | Instruction format                         |
| --------------- | ----------------------- | ------------------------------------------ |
| **Cursor**      | `.cursor/mcp.json`      | `.cursor/rules/agent-toolkit.mdc`          |
| **Claude Code** | `.mcp.json`             | `CLAUDE.md` (fenced section)               |
| **Copilot**     | `.vscode/mcp.json`      | `.github/copilot-instructions.md` (fenced) |
| **Codex**       | `.codex/config.toml`    | `AGENTS.md` (fenced section)               |
| **Gemini CLI**  | `.gemini/settings.json` | `GEMINI.md` (fenced section)               |


## Consuming as a Git Submodule

For quick testing without publishing to npm, add the toolkit as a submodule:

```bash
git submodule add <repo-url> .agent-toolkit
cd .agent-toolkit && npm install && cd ..
```

Then invoke the CLI directly from source — no build step required:

```bash
.agent-toolkit/bin/agent-toolkit doctor
.agent-toolkit/bin/agent-toolkit init --client cursor
```

## Development

This is an npm workspaces monorepo. Requires Node.js >= 20.

```bash
npm install            # Install dependencies
npm run build          # Build all packages
npm run typecheck      # Typecheck all packages
npm test               # Run all tests
```

