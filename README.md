# Agent Toolkit

[![npm](https://img.shields.io/npm/v/@byrde/agent-toolkit)](https://www.npmjs.com/package/@byrde/agent-toolkit)
[![license](https://img.shields.io/npm/l/@byrde/agent-toolkit)](./LICENSE)

Configure MCP servers and generate intelligent agent instructions for any AI coding client. Declare what tools you use in a config file, run one command, and your AI client gets properly configured MCP servers *and* best-practice instructions that teach it how to use those tools — individually and together.

Everything is project-scoped. Open a configured project and your AI is fully wired. Open a different directory and nothing bleeds through.

## Usage

```bash
npx @byrde/agent-toolkit init [options]
```

| Option | Description |
|---|---|
| `--cwd <path>` | Project directory. Defaults to the current working directory. |
| `--client <target>` | AI client: `cursor`, `claude-code`, `copilot`, `codex`, `gemini-cli`. Prompted interactively when omitted. |
| `-v, --verbose` | Enable debug output. |

On the first run the wizard walks you through server selection and writes `.agent-toolkit.json`. On subsequent runs it offers to reconfigure. Restart your IDE when it finishes.

### Troubleshooting

```bash
npx @byrde/agent-toolkit doctor [options]
```

| Option | Description |
|---|---|
| `--cwd <path>` | Project directory. Defaults to the current working directory. |
| `--client <target>` | AI client: `cursor`, `claude-code`, `copilot`, `codex`, `gemini-cli`. |
| `--json` | Machine-readable JSON output. |
| `-v, --verbose` | Enable debug output. |

Validates auth, client config, and end-to-end MCP connectivity for a configured project.

## Supported servers

| Server | Transport | Auth mechanism |
|---|---|---|
| **GitHub** | npx | `GITHUB_PERSONAL_ACCESS_TOKEN` via `gh` |
| **GCP** | npx | `gcloud` application-default credentials |
| **Terraform** | Docker | `TFE_TOKEN` or credentials file |
| **Atlassian** | npx | OAuth (browser-based) |

## Supported AI clients

| Client | MCP config path | Instruction format |
|---|---|---|
| **Cursor** | `.cursor/mcp.json` | `.cursor/rules/agent-toolkit.mdc` |
| **Claude Code** | `.mcp.json` | `CLAUDE.md` (fenced section) |
| **Copilot** | `.vscode/mcp.json` | `.github/copilot-instructions.md` (fenced) |
| **Codex** | `.codex/config.toml` | `AGENTS.md` (fenced section) |
| **Gemini CLI** | `.gemini/settings.json` | `GEMINI.md` (fenced section) |

## Git submodule usage

For quick testing without publishing to npm, add the toolkit as a submodule:

```bash
git submodule add <repo-url> .agent-toolkit
cd .agent-toolkit && npm install && cd ..
```

Then invoke the CLI directly from source:

```bash
.agent-toolkit/bin/agent-toolkit init --client cursor
.agent-toolkit/bin/agent-toolkit doctor
```

## Development

npm workspaces monorepo. Requires Node.js >= 20.

```bash
npm install
npm run build
npm run typecheck
npm test
```

