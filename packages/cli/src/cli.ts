import { writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Command } from "commander";
import { checkbox, confirm, input, password, select } from "@inquirer/prompts";
import {
  loadConfig,
  loadLocalConfig,
  writeLocalConfig,
  checkAuth,
  checkTerraformAuth,
  resolveTerraformEmail,
  listGitHubAccounts,
  listGcpAccounts,
  extractPinnableIdentity,
  generateCursorConfig,
  writeCursorConfig,
  generateClaudeCodeConfig,
  writeClaudeCodeConfig,
  generateCopilotConfig,
  writeCopilotConfig,
  generateCodexConfig,
  writeCodexConfig,
  generateGeminiConfig,
  writeGeminiConfig,
  generateInstructions,
  writeInstructions,
  updateGitignore,
  verifyClientConfig,
  extractEmbeddedTokens,
  checkCliAvailable,
  checkDockerAvailable,
  serverUsesDocker,
  runDiagnostic,
  runValidation,
  generateLlmInstructions,
  resolveTokens,
  getServerDefaults,
  CONFIG_FILE,
  LOCAL_CONFIG_FILE,
  type WorkspaceConfig,
  type ClientTarget,
  type ServerDeclaration,
  type ConfigFileResult,
  type VerificationResult,
  type ClientDiagnosticResult,
  type AuthStatus,
  type LocalConfig,
  type ProviderIdentities,
  type ResolvedTokens,
} from "@byrde/agent-toolkit-core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

let _verbose = false;

export function setVerbose(v: boolean): void {
  _verbose = v;
}

function debug(...args: unknown[]): void {
  if (_verbose) console.log(...args);
}

const KNOWN_SERVERS = ["atlassian", "gcp", "github", "terraform"] as const;
const KNOWN_CLIENTS: ClientTarget[] = ["claude-code", "codex", "copilot", "cursor", "gemini-cli"];

interface CredentialGuide {
  label: string;
  description: string;
  howToGet: string;
  secret: boolean;
}

const CREDENTIAL_GUIDES: Record<string, CredentialGuide> = {
  GITHUB_PERSONAL_ACCESS_TOKEN: {
    label: "GitHub personal access token",
    description: "A token that authenticates requests to the GitHub API on your behalf.",
    howToGet: "Create one at https://github.com/settings/tokens — or run `gh auth token` if you have the GitHub CLI.",
    secret: true,
  },
  TFE_TOKEN: {
    label: "Terraform Cloud API token",
    description: "An API token for authenticating with Terraform Cloud or Terraform Enterprise.",
    howToGet: "Run `terraform login`, or create one at https://app.terraform.io/app/settings/tokens.",
    secret: true,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function configPath(cwd?: string): string {
  return resolve(cwd ?? process.cwd(), CONFIG_FILE);
}

async function configExists(cwd?: string): Promise<boolean> {
  try {
    await readFile(configPath(cwd), "utf-8");
    return true;
  } catch {
    return false;
  }
}

function printDoctorTable(statuses: Awaited<ReturnType<typeof checkAuth>>): boolean {
  const providerWidth = Math.max(10, ...statuses.map((s) => s.provider.length));
  const statusWidth = 8;
  const divider = "-".repeat(providerWidth + statusWidth + 20);

  console.log(`\n  ${"Provider".padEnd(providerWidth)}  Status    Identity / Error`);
  console.log(`  ${divider}`);

  for (const s of statuses) {
    const status = s.identityMismatch ? "MISMATCH" : s.authenticated ? "OK" : "FAIL";
    const detail = s.identityMismatch
      ? (s.error ?? "")
      : s.authenticated
        ? (s.identity ?? "")
        : (s.error ?? "unknown error");
    console.log(`  ${s.provider.padEnd(providerWidth)}  ${status.padEnd(statusWidth)}  ${detail}`);
    if ((!s.authenticated || s.identityMismatch) && s.remediation) {
      console.log(`  ${"".padEnd(providerWidth)}            ↳ ${s.remediation}`);
    }
  }
  console.log();

  return statuses.every((s) => s.authenticated && !s.identityMismatch);
}

// ---------------------------------------------------------------------------
// Verification table printer
// ---------------------------------------------------------------------------

function printVerifyTable(result: VerificationResult): boolean {
  if (!result.fileExists) {
    console.log(`  ${result.client}: config not found at ${result.configPath}`);
    console.log(`  ${"".padEnd(result.client.length)}  ↳ Run \`agent-toolkit init --client ${result.client}\` to generate it.`);
    return false;
  }

  const serverWidth = Math.max(8, ...result.entries.map((e) => e.server.length));
  const keyWidth = Math.max(20, ...result.entries.map((e) => e.expectedKey.length));
  const divider = "-".repeat(serverWidth + keyWidth + 18);

  console.log(`\n  ${result.client} (${result.configPath})\n`);
  console.log(`  ${"Server".padEnd(serverWidth)}  ${"Expected Key".padEnd(keyWidth)}  Status`);
  console.log(`  ${divider}`);

  for (const entry of result.entries) {
    const status = entry.status === "ok" ? "OK" : "MISSING";
    console.log(`  ${entry.server.padEnd(serverWidth)}  ${entry.expectedKey.padEnd(keyWidth)}  ${status}`);
    if (entry.status === "missing") {
      console.log(`  ${"".padEnd(serverWidth)}  ${"".padEnd(keyWidth)}  ↳ Run \`agent-toolkit init --client ${result.client}\` to install.`);
    }
  }
  console.log();

  return result.entries.every((e) => e.status === "ok");
}

// ---------------------------------------------------------------------------
// Diagnostic streaming display
// ---------------------------------------------------------------------------

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const LINE_PREFIX = `${DIM}  │ `;
const CLEAR_LINE = "\r\x1b[2K";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const WAIT_MESSAGES = [
  "Warming up the neural pathways…",
  "Consulting the digital oracle…",
  "Good things come to those who wait…",
  "Patience is a virtue, debugging is an art…",
  "Asking the bits to line up nicely…",
  "Convincing electrons to cooperate…",
  "Brewing a fresh pot of inference…",
];

const CURSOR_UP = "\x1b[1A";

function createSpinner(): { start(): void; stop(): void } {
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let rendered = false;
  const msg = WAIT_MESSAGES[Math.floor(Math.random() * WAIT_MESSAGES.length)];

  return {
    start() {
      timer = setInterval(() => {
        const f = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
        if (rendered) {
          process.stderr.write(`\r${CURSOR_UP}${CLEAR_LINE}`);
        }
        process.stderr.write(
          `${DIM}  │ ${f} ${msg}${RESET}\n${CLEAR_LINE}${DIM}  └─ loading${RESET}`,
        );
        rendered = true;
        frame++;
      }, 80);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      if (rendered) {
        process.stderr.write(`${CLEAR_LINE}\r${CURSOR_UP}${CLEAR_LINE}`);
      }
    },
  };
}

function createStreamWriter(): (chunk: string) => void {
  let atLineStart = true;

  return (chunk: string) => {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (ch === "\n") {
        process.stderr.write(`${RESET}\n`);
        atLineStart = true;
      } else {
        if (atLineStart) {
          process.stderr.write(LINE_PREFIX);
          atLineStart = false;
        }
        process.stderr.write(ch);
      }
    }
  };
}

async function runSpinnerPhase<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let frame = 0;
  const msg = WAIT_MESSAGES[Math.floor(Math.random() * WAIT_MESSAGES.length)];
  const timer = setInterval(() => {
    const f = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
    process.stderr.write(`${CLEAR_LINE}${DIM}  ${f} ${label} — ${msg}${RESET}`);
    frame++;
  }, 80);

  try {
    const result = await fn();
    clearInterval(timer);
    process.stderr.write(`${CLEAR_LINE}${DIM}  ✓ ${label}${RESET}\n`);
    return result;
  } catch (err) {
    clearInterval(timer);
    process.stderr.write(`${CLEAR_LINE}${DIM}  ✗ ${label}${RESET}\n`);
    throw err;
  }
}

async function runDiagnosticWithStreaming(
  client: ClientTarget,
  config: WorkspaceConfig,
  cwd?: string,
  identities?: ProviderIdentities,
): Promise<ClientDiagnosticResult> {
  const availability = await checkCliAvailable(client);
  if (!availability.available) {
    return {
      cliAvailable: false,
      cliRemediation: availability.remediation,
      tools: [],
      overallPass: false,
    };
  }

  // Phase 1: Plain-text diagnostic (streamed to terminal)
  const writer = createStreamWriter();
  console.log(`${DIM}  ┌─ ${client} diagnostic${RESET}`);
  let diagnosticOutput: string;
  {
    const spinner = createSpinner();
    spinner.start();
    const onData = (chunk: string) => { spinner.stop(); writer(chunk); };
    try {
      diagnosticOutput = await runDiagnostic(client, config, cwd, onData);
    } catch (err) {
      spinner.stop();
      process.stderr.write(`${RESET}\n`);
      console.log(`${DIM}  └─ failed${RESET}`);
      return {
        cliAvailable: true,
        tools: [],
        overallPass: false,
        error: `Diagnostic failed: ${(err as Error).message}`,
      };
    }
    spinner.stop();
  }
  process.stderr.write(`${RESET}\n`);
  console.log(`${DIM}  └─ done${RESET}`);

  // Phase 2: Validate diagnostic output (spinner only)
  try {
    const result = await runSpinnerPhase(
      "validating",
      () => runValidation(client, diagnosticOutput, config, cwd, undefined, identities),
    );
    result.diagnosticRaw = diagnosticOutput;
    return result;
  } catch (err) {
    return {
      cliAvailable: true,
      diagnosticRaw: diagnosticOutput,
      tools: [],
      overallPass: false,
      error: `Validation failed: ${(err as Error).message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Client diagnostic table printer
// ---------------------------------------------------------------------------

function printDiagnosticResultTable(result: ClientDiagnosticResult): boolean {
  if (!result.cliAvailable) {
    console.log(`\n  AI client CLI not found.`);
    if (result.cliRemediation) {
      console.log(`  ↳ ${result.cliRemediation}`);
    }
    console.log();
    return false;
  }

  if (result.error) {
    console.log(`\nDiagnostic error: ${result.error}`);
    console.log();
    return false;
  }

  if (result.tools.length === 0) {
    console.log("\n  No tool results from diagnostic.");
    console.log();
    return false;
  }

  const toolWidth = Math.max(6, ...result.tools.map((t) => t.tool.length));
  const divider = "-".repeat(toolWidth + 52);

  console.log(`\n${"Tool".padEnd(toolWidth)}  Listed  Usage  Command  Account  Status`);
  console.log(`  ${divider}`);

  for (const t of result.tools) {
    const listed = t.listed ? "YES" : "NO";
    const usage = t.paraphraseAccurate ? "YES" : "NO";
    const cmd = t.basicCommandPassed ? "YES" : "NO";
    const acct = t.accountCorrect ? "YES" : "NO";
    const allOk = t.listed && t.paraphraseAccurate && t.basicCommandPassed && t.accountCorrect;
    const status = allOk ? "OK" : "FAIL";
    console.log(
      `  ${t.tool.padEnd(toolWidth)}  ${listed.padEnd(6)}  ${usage.padEnd(5)}  ${cmd.padEnd(7)}  ${acct.padEnd(7)}  ${status}`,
    );
    if (!allOk && t.details) {
      console.log(`  ${"".padEnd(toolWidth)}                                      ↳ ${t.details}`);
    }
  }
  console.log();

  return result.overallPass;
}

// ---------------------------------------------------------------------------
// Instruction content builder (static fallback)
// ---------------------------------------------------------------------------

export function buildStaticInstructions(config: WorkspaceConfig): string {
  const serverNames = Object.keys(config.servers);
  if (serverNames.length === 0) return "";

  const lines: string[] = [
    "# MCP Server Instructions",
    "",
    "This project uses the following MCP servers. Use them to assist with development tasks.",
    "",
  ];

  for (const name of serverNames) {
    const decl = config.servers[name];
    const notes = decl?.settings?.usageNotes;
    lines.push(`## ${name}`);
    if (typeof notes === "string" && notes.trim()) {
      lines.push("", notes.trim());
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

/** @deprecated Use buildStaticInstructions — kept for backward compatibility */
export const buildInstructions = buildStaticInstructions;

// ---------------------------------------------------------------------------
// LLM-driven instruction generation with streaming + fallback
// ---------------------------------------------------------------------------

async function generateInstructionsWithLlm(
  client: ClientTarget,
  config: WorkspaceConfig,
  cwd?: string,
  identities?: ProviderIdentities,
): Promise<string> {
  const writer = createStreamWriter();
  console.log(`${DIM}  ┌─ generating instructions via ${client}${RESET}`);

  const spinner = createSpinner();
  spinner.start();

  let result: string;
  try {
    const onData = (chunk: string) => { spinner.stop(); writer(chunk); };
    result = await generateLlmInstructions(client, config, cwd, onData, identities);
  } finally {
    spinner.stop();
  }

  process.stderr.write(`${RESET}\n`);
  console.log(`${DIM}  └─ done${RESET}`);

  return result;
}

function summarizeLlmError(client: ClientTarget, raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("missing bearer")) {
    const hints: Record<string, string> = {
      codex: "Set OPENAI_API_KEY or run `codex auth login`.",
      "claude-code": "Run `claude auth` or set ANTHROPIC_API_KEY.",
      cursor: "Sign in to Cursor or check your API key.",
      copilot: "Run `copilot auth` or check your GitHub token.",
      "gemini-cli": "Run `gemini auth login` or set GEMINI_API_KEY.",
    };
    return `${client} CLI authentication failed (401 Unauthorized). ${hints[client] ?? "Check your API key."}`;
  }
  if (lower.includes("403") || lower.includes("forbidden")) {
    return `${client} CLI authorization failed (403 Forbidden). Check that your API key has the required permissions.`;
  }
  if (lower.includes("timed out")) {
    return `${client} CLI timed out. The model may be overloaded — try again later.`;
  }
  if (lower.includes("not available") || lower.includes("not found") || lower.includes("enoent")) {
    return raw;
  }
  const firstLine = raw.split("\n").find((l) => l.trim().length > 0) ?? raw;
  return firstLine.length > 200 ? firstLine.slice(0, 200) + "…" : firstLine;
}

async function resolveInstructions(
  client: ClientTarget,
  config: WorkspaceConfig,
  cwd?: string,
  identities?: ProviderIdentities,
): Promise<string> {
  try {
    const llmInstructions = await generateInstructionsWithLlm(client, config, cwd, identities);
    if (llmInstructions.trim()) return llmInstructions;
    console.log("\nLLM returned empty output. Falling back to static instructions.\n");
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const summary = summarizeLlmError(client, raw);
    console.log(`\nLLM instruction generation failed: ${summary}`);
    console.log("Falling back to static instructions.\n");
  }
  return buildStaticInstructions(config);
}

// ---------------------------------------------------------------------------
// Install logic
// ---------------------------------------------------------------------------

const CONFIG_GENERATORS: Record<string, {
  generate: (config: WorkspaceConfig, cwd?: string, resolvedTokens?: ResolvedTokens) => Promise<ConfigFileResult>;
  write: (config: WorkspaceConfig, cwd?: string, resolvedTokens?: ResolvedTokens) => Promise<ConfigFileResult>;
}> = {
  cursor: { generate: generateCursorConfig, write: writeCursorConfig },
  "claude-code": { generate: generateClaudeCodeConfig, write: writeClaudeCodeConfig },
  copilot: { generate: generateCopilotConfig, write: writeCopilotConfig },
  codex: { generate: generateCodexConfig, write: writeCodexConfig },
  "gemini-cli": { generate: generateGeminiConfig, write: writeGeminiConfig },
};

async function runInstall(
  config: WorkspaceConfig,
  client: ClientTarget,
  cwd?: string,
  dryRun?: boolean,
  instructions?: string,
  resolvedTokens?: ResolvedTokens,
): Promise<void> {
  debug(`\nTarget client: ${client}`);

  const generator = CONFIG_GENERATORS[client];
  if (!generator) {
    console.log(`Config generation for "${client}" is not yet implemented.`);
    return;
  }

  if (dryRun) {
    const result = await generator.generate(config, cwd, resolvedTokens);
    console.log(`\n[dry-run] Would write ${result.path}:\n`);
    console.log(result.content);
    if (instructions) {
      const instrResult = await generateInstructions(client, instructions, cwd);
      console.log(`\n[dry-run] Would write ${instrResult.path}:\n`);
      console.log(instrResult.content);
    }
    return;
  }

  const result = await generator.write(config, cwd, resolvedTokens);
  debug(`Wrote ${result.path}`);

  if (instructions) {
    const instrResult = await writeInstructions(client, instructions, cwd);
    debug(`Wrote ${instrResult.path}`);
  }

  const gitignorePath = await updateGitignore(cwd);
  debug(`Updated ${gitignorePath}`);
}

// ---------------------------------------------------------------------------
// Configure logic
// ---------------------------------------------------------------------------

export interface ServerInput {
  name: string;
  notes: string;
  settings?: Record<string, unknown>;
}

export function buildConfig(
  serverInputs: ServerInput[],
): WorkspaceConfig {
  const servers: Record<string, ServerDeclaration> = {};
  const sorted = [...serverInputs].sort((a, b) => a.name.localeCompare(b.name));
  for (const { name, notes, settings: extra } of sorted) {
    const merged: Record<string, unknown> = { ...extra };
    if (notes.trim()) merged.usageNotes = notes.trim();

    // Strip empty arrays and blank strings
    for (const [k, v] of Object.entries(merged)) {
      if (v === "" || (Array.isArray(v) && v.length === 0)) delete merged[k];
    }

    servers[name] = Object.keys(merged).length > 0
      ? { settings: merged }
      : {};
  }
  return { servers };
}

export async function writeConfig(
  config: WorkspaceConfig,
  cwd?: string,
): Promise<string> {
  const targetPath = configPath(cwd);
  await writeFile(targetPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return targetPath;
}

function parseCommaSeparated(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

interface ProviderQuestion {
  key: string;
  message: string;
  array?: boolean;
}

const PROVIDER_QUESTIONS: Record<string, ProviderQuestion[]> = {
  github: [
    { key: "organization", message: "github — organization:" },
    { key: "repositories", message: "github — repositories (comma-separated):", array: true },
  ],
  gcp: [
    { key: "projects", message: "gcp — projects (comma-separated):", array: true },
  ],
  terraform: [
    { key: "organization", message: "terraform — organization:" },
    { key: "projects", message: "terraform — projects (comma-separated):", array: true },
    { key: "workspaces", message: "terraform — workspaces (comma-separated):", array: true },
  ],
  atlassian: [
    { key: "site", message: "atlassian — site:" },
    { key: "projects", message: "atlassian — projects:", array: true },
  ],
};

async function askProviderSettings(name: string): Promise<Record<string, unknown>> {
  const questions = PROVIDER_QUESTIONS[name];
  if (!questions) return {};

  const settings: Record<string, unknown> = {};
  for (const q of questions) {
    const raw = await input({ message: q.message });
    if (!raw.trim()) continue;
    settings[q.key] = q.array ? parseCommaSeparated(raw) : raw.trim();
  }
  return settings;
}

async function runConfigure(cwd?: string): Promise<WorkspaceConfig> {
  const selectedServers = await checkbox({
    message: "Which MCP servers does this project use?",
    choices: KNOWN_SERVERS.map((s) => ({ name: s, value: s })),
  });

  if (selectedServers.length === 0) {
    console.log("\nNo servers selected. You can re-run init later.");
    return { servers: {} };
  }

  const serverInputs: ServerInput[] = [];
  for (const name of selectedServers) {
    const settings = await askProviderSettings(name);
    const notes = await input({ message: `${name} — usage notes (optional):` });
    serverInputs.push({ name, notes, settings });
  }

  const config = buildConfig(serverInputs);
  const targetPath = await writeConfig(config, cwd);
  debug(`Config written to ${targetPath}`);

  return config;
}

// ---------------------------------------------------------------------------
// Identity selection
// ---------------------------------------------------------------------------

const PROVIDERS_WITH_LOGIN_FLOW = new Set(["terraform"]);

async function selectIdentities(
  statuses: AuthStatus[],
  existingIdentities?: ProviderIdentities,
): Promise<ProviderIdentities> {
  const identities: ProviderIdentities = {};
  const authenticated = statuses.filter((s) => s.authenticated);
  const failed = statuses.filter((s) => !s.authenticated);

  // Providers with their own login flow handle both auth states
  const selfLogin = failed.filter((s) => PROVIDERS_WITH_LOGIN_FLOW.has(s.provider));
  const needCredentials = failed.filter((s) => !PROVIDERS_WITH_LOGIN_FLOW.has(s.provider));

  for (const status of [...authenticated, ...selfLogin]) {
    const existing = existingIdentities?.[status.provider] as Record<string, unknown> | undefined;
    const pinned = await selectProviderIdentity(status, existing);
    if (pinned) {
      identities[status.provider] = pinned;
    }
  }

  for (const status of needCredentials) {
    const collected = await collectProviderCredentials(status);
    if (collected) {
      identities[status.provider] = collected;
    }
  }

  return identities;
}

async function collectProviderCredentials(
  status: AuthStatus,
): Promise<Record<string, unknown> | undefined> {
  const defaults = getServerDefaults(status.provider);
  if (!defaults) {
    console.log(`\n  ⚠ ${status.provider}: ${status.error ?? "not authenticated"}`);
    if (status.remediation) console.log(`    ↳ ${status.remediation}`);
    return undefined;
  }

  const credentialKeys = Object.keys(defaults.promptKeys ?? defaults.envMapping);
  if (credentialKeys.length === 0) {
    console.log(`\n  ⚠ ${status.provider}: ${status.error ?? "not authenticated"}`);
    if (status.remediation) console.log(`    ↳ ${status.remediation}`);
    return undefined;
  }

  const missing = credentialKeys.filter((k) => !process.env[k]);
  if (missing.length === 0) return {};

  for (const key of missing) {
    const guide = CREDENTIAL_GUIDES[key];
    const isSecret = guide?.secret ?? /token|secret|key|password/i.test(key);
    const collapsedLabel = guide ? `${guide.label}:` : `${status.provider} — ${key}:`;

    let hintLines = 0;
    if (guide) {
      console.log(`\n  ${DIM}${guide.description}${RESET}`);
      console.log(`  ${DIM}↳ ${guide.howToGet}${RESET}`);
      hintLines = 3;
    }

    const promptFn = isSecret ? password : input;
    const value = await promptFn({
      message: guide ? `${guide.label}:` : `${status.provider} — ${key}:`,
    });

    if (!value.trim()) {
      if (hintLines > 0) {
        process.stdout.write(`\x1b[${hintLines + 1}A\x1b[0J`);
      }
      console.log(`  Skipped — ${status.provider} credentials not configured.`);
      return undefined;
    }

    if (hintLines > 0) {
      const display = isSecret ? "(provided)" : value;
      process.stdout.write(`\x1b[${hintLines + 1}A\x1b[0J`);
      console.log(`\x1b[32m✔\x1b[0m \x1b[1m${collapsedLabel}\x1b[0m \x1b[36m${display}\x1b[0m`);
    }

    process.env[key] = value.trim();
  }

  const [recheck] = await checkAuth([status.provider]);
  if (recheck.authenticated) {
    return extractPinnableIdentity(recheck) ?? {};
  }

  return {};
}

async function selectProviderIdentity(
  status: AuthStatus,
  existing?: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  switch (status.provider) {
    case "github":
      return selectGitHubIdentity(status, existing);
    case "gcp":
      return selectGcpIdentity(status, existing);
    case "terraform":
      return selectTerraformIdentity(status, existing);
    default:
      return confirmSimpleIdentity(status, existing);
  }
}

async function selectGitHubIdentity(
  status: AuthStatus,
  existing?: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const accounts = await listGitHubAccounts();
  if (accounts.length === 0) return confirmSimpleIdentity(status, existing);

  const previousAccount = typeof existing?.account === "string" ? existing.account : undefined;
  const defaultAccount = previousAccount ?? accounts.find((a) => a.active)?.account;
  const chosen = await select({
    message: `github — select account:`,
    choices: accounts.map((a) => ({
      name: a.host ? `${a.account} (${a.host})` : a.account,
      value: a.account,
    })),
    default: defaultAccount,
  });
  return { account: chosen };
}

async function selectGcpIdentity(
  status: AuthStatus,
  existing?: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const accounts = await listGcpAccounts();
  if (accounts.length === 0) return confirmSimpleIdentity(status, existing);

  const previousAccount = typeof existing?.account === "string" ? existing.account : undefined;
  const defaultAccount = previousAccount ?? accounts.find((a) => a.active)?.account;
  const chosen = await select({
    message: `gcp — select account:`,
    choices: accounts.map((a) => ({
      name: a.active ? `${a.account} (active)` : a.account,
      value: a.account,
    })),
    default: defaultAccount,
  });
  return { account: chosen };
}

async function selectTerraformIdentity(
  _status: AuthStatus,
  existing?: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const guide = IDENTITY_GUIDES.terraform;
  const previousHost = typeof existing?.host === "string" ? existing.host : undefined;

  console.log(`\n  ${DIM}${guide.description}${RESET}`);

  const host = await input({
    message: `terraform — hostname:`,
    default: previousHost ?? "app.terraform.io",
  });

  if (!host.trim()) return undefined;
  const trimmedHost = host.trim();

  // Collapse hint + prompt into a placeholder while terraform login runs
  process.stdout.write(`\x1b[3A\x1b[0J`);
  console.log(`\x1b[32m✔\x1b[0m \x1b[1mterraform — token:\x1b[0m \x1b[36mlogging in…\x1b[0m`);

  const loginArgs = trimmedHost === "app.terraform.io" ? ["login"] : ["login", trimmedHost];

  // Run terraform login on alternate screen so its interactive output
  // disappears when complete, keeping the main terminal clean.
  process.stdout.write("\x1b[?1049h\x1b[H");
  const result = spawnSync("terraform", loginArgs, { stdio: "inherit" });
  process.stdout.write("\x1b[?1049l");

  // Overwrite placeholder with final status
  process.stdout.write("\x1b[1A\x1b[2K");

  if (result.status !== 0) {
    console.log(`\x1b[32m✔\x1b[0m \x1b[1mterraform — token:\x1b[0m \x1b[31mlogin failed\x1b[0m`);
    console.log(`  ↳ Retry with: terraform login ${trimmedHost}`);
    return { host: trimmedHost };
  }

  const authResult = await checkTerraformAuth({ host: trimmedHost });
  if (!authResult.authenticated) {
    console.log(`\x1b[32m✔\x1b[0m \x1b[1mterraform — token:\x1b[0m \x1b[33mnot found\x1b[0m`);
    console.log(`  ↳ Check credentials for ${trimmedHost}`);
    return { host: trimmedHost };
  }

  console.log(`\x1b[32m✔\x1b[0m \x1b[1mterraform — token:\x1b[0m \x1b[36m(provided)\x1b[0m`);

  const identity: Record<string, string> = { host: trimmedHost };

  if (authResult.identity && authResult.identity !== trimmedHost) {
    identity.email = authResult.identity;
    console.log(`\x1b[32m✔\x1b[0m \x1b[1mterraform — account:\x1b[0m \x1b[36m${authResult.identity}\x1b[0m`);
  }

  return identity;
}

interface IdentityGuide {
  label: string;
  description: string;
  fieldKey: string;
}

const IDENTITY_GUIDES: Record<string, IdentityGuide> = {
  terraform: {
    label: "Terraform Cloud/Enterprise hostname",
    description: "The hostname of your TFC/TFE instance (e.g. app.terraform.io).",
    fieldKey: "host",
  },
  github: {
    label: "GitHub username",
    description: "Your GitHub username.",
    fieldKey: "account",
  },
  gcp: {
    label: "GCP account email",
    description: "Your Google Cloud account email.",
    fieldKey: "account",
  },
};

async function confirmSimpleIdentity(
  status: AuthStatus,
  existing?: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const pinnable = extractPinnableIdentity(status);
  const guide = IDENTITY_GUIDES[status.provider];

  if (!pinnable && !guide) return undefined;

  const fieldKey = pinnable ? Object.keys(pinnable)[0] : guide!.fieldKey;
  const detectedValue = pinnable ? String(Object.values(pinnable)[0]) : undefined;

  const previousValue = typeof existing?.[fieldKey] === "string"
    ? existing[fieldKey] as string
    : undefined;

  const promptLabel = `${status.provider} — ${fieldKey}:`;

  const hintLines = guide ? 2 : 0;
  if (guide) {
    console.log(`\n  ${DIM}${guide.description}${RESET}`);
  }

  const value = await input({
    message: promptLabel,
    default: previousValue ?? detectedValue,
  });

  if (hintLines > 0) {
    process.stdout.write(`\x1b[${hintLines + 1}A\x1b[0J`);
    console.log(`\x1b[32m✔\x1b[0m \x1b[1m${promptLabel}\x1b[0m \x1b[36m${value}\x1b[0m`);
  }

  if (!value.trim()) return undefined;
  return { [fieldKey]: value.trim() };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("agent-toolkit")
  .description("Configure MCP servers and generate intelligent agent instructions for your AI coding client")
  .version("0.1.0")
  .option("-v, --verbose", "Show debug output");

// -- doctor -----------------------------------------------------------------

program
  .command("doctor")
  .description("Diagnose local environment and auth status for configured servers")
  .option("--cwd <path>", "Project directory (defaults to current)")
  .option("--client <target>", "AI coding client (claude-code, codex, copilot, cursor, gemini-cli)")
  .option("--json", "Output results as JSON")
  .action(async (opts) => {
    setVerbose(program.opts().verbose ?? false);
    const cwd = opts.cwd as string | undefined;
    const config = await loadConfig(cwd);
    const localConfig = await loadLocalConfig(cwd);
    const serverNames = Object.keys(config.servers);

    if (serverNames.length === 0) {
      if (opts.json) {
        console.log(JSON.stringify({ servers: [], results: [] }));
      } else {
        console.log("No servers configured. Run `agent-toolkit init` first.");
      }
      return;
    }

    if (opts.json) {
      const jsonClient = opts.client as string | undefined;
      if (jsonClient) {
        const embedded = await extractEmbeddedTokens(jsonClient, config, cwd);
        for (const [key, value] of Object.entries(embedded)) {
          if (!process.env[key]) process.env[key] = value;
        }
      }
      const statuses = await checkAuth(serverNames, localConfig.identity);
      console.log(JSON.stringify(statuses, null, 2));
      const hasFailure = statuses.some((s) => !s.authenticated || s.identityMismatch);
      if (hasFailure) process.exit(1);
      return;
    }

    console.log(`
  ${BOLD}Agent Toolkit — Doctor${RESET}
  ${DIM}Checks that your authentication is valid, your client config is
  installed correctly, and your AI client can actually use its tools.${RESET}
`);

    let client = opts.client as ClientTarget | undefined;
    if (!client) {
      client = await select({
        message: "Which AI coding client do you use?",
        choices: KNOWN_CLIENTS.map((c) => ({ name: c, value: c })),
      });
    }

    // Pre-populate env with tokens embedded in the client config (e.g. headers)
    const embedded = await extractEmbeddedTokens(client, config, cwd);
    for (const [key, value] of Object.entries(embedded)) {
      if (!process.env[key]) process.env[key] = value;
    }

    // Check Docker daemon for servers that need it
    const dockerServers = serverNames.filter((name) =>
      serverUsesDocker(name, config.servers[name]),
    );
    if (dockerServers.length > 0) {
      debug(`Checking Docker (required by ${dockerServers.join(", ")})...`);
      const docker = await checkDockerAvailable();
      if (!docker.available || !docker.daemonRunning) {
        console.log(`\n  Docker    ${docker.available ? "INSTALLED" : "MISSING"}    ${docker.daemonRunning ? "RUNNING" : "NOT RUNNING"}`);
        console.log(`  ${docker.error}`);
        if (docker.remediation) {
          console.log(`  ↳ ${docker.remediation}`);
        }
        console.log();
        process.exit(1);
      }
      debug("  Docker daemon is running.\n");
    }

    // Validate auth + client config
    console.log("Verifying authentication and pinned identities...");
    const statuses = await checkAuth(serverNames, localConfig.identity);
    const authPassed = printDoctorTable(statuses);

    console.log("Verifying client configs...");
    const verifyResult = await verifyClientConfig(client, config, cwd);
    const verifyPassed = printVerifyTable(verifyResult);

    if (!authPassed || !verifyPassed) {
      console.log("\nFix the issues above before running diagnostics.");
      process.exit(1);
    }

    // Client diagnostic (only if auth + client config checks passed)
    console.log("Running AI client diagnostic...\n");
    const diagnostic = await runDiagnosticWithStreaming(client, config, cwd, localConfig.identity);
    const diagnosticPassed = printDiagnosticResultTable(diagnostic);

    if (!diagnosticPassed) process.exit(1);
  });

// -- init -------------------------------------------------------------------

program
  .command("init")
  .description("Set up config, validate auth, and install MCP servers + agent instructions")
  .option("--cwd <path>", "Project directory (defaults to current)")
  .option("--client <target>", "AI coding client (claude-code, codex, copilot, cursor, gemini-cli)")
  .action(async (opts) => {
    setVerbose(program.opts().verbose ?? false);
    const cwd = opts.cwd;

    console.log(`
  ${BOLD}Agent Toolkit${RESET}
  ${DIM}Set up your AI coding client so it knows your tools — your repos,
  cloud resources, issue tracker, design files — and how and when to use them.${RESET}
`);

    // Step 0: Identify client
    let client = opts.client as ClientTarget | undefined;
    if (!client) {
      client = await select({
        message: "Which AI coding client do you use?",
        choices: KNOWN_CLIENTS.map((c) => ({ name: c, value: c })),
      });
    }

    // Step 1: Configure
    let config: WorkspaceConfig;
    if (await configExists(cwd)) {
      debug(`Config found at ${configPath(cwd)}`);
      const reconfigure = await confirm({
        message: `Reconfigure MCP servers (${CONFIG_FILE})?`,
        default: false,
      });
      if (reconfigure) {
        config = await runConfigure(cwd);
      } else {
        config = await loadConfig(cwd);
      }
    } else {
      // console.log("No config found. Starting setup...\n");
      config = await runConfigure(cwd);
    }

    const serverNames = Object.keys(config.servers);
    if (serverNames.length === 0) {
      console.log("No servers configured. Nothing more to do.");
      return;
    }

    // Step 2: Auth check (data-gathering for identity selection)
    const statuses = await checkAuth(serverNames);

    // Step 2b: Identity pinning
    const localConfig = await loadLocalConfig(cwd);
    const existingKeys = Object.keys(localConfig.identity ?? {});
    const identitiesInSync = existingKeys.length > 0
      && serverNames.every((p) => existingKeys.includes(p))
      && existingKeys.every((p) => serverNames.includes(p));

    let identities: ProviderIdentities;

    if (identitiesInSync) {
      const reconfigureAccounts = await confirm({
        message: `Reconfigure user accounts (${LOCAL_CONFIG_FILE})?`,
        default: false,
      });
      if (reconfigureAccounts) {
        identities = await selectIdentities(statuses, localConfig.identity);
      } else {
        identities = localConfig.identity!;
      }
    } else {
      identities = await selectIdentities(statuses, localConfig.identity);
    }

    if (Object.keys(identities).length > 0) {
      const localPath = await writeLocalConfig({ identity: identities }, cwd);
      debug(`Identity config written to ${localPath}`);
    }

    // Step 2b-verify: Re-check auth against pinned identities
    console.log("\nVerifying authentication and pinned identities...");
    const verifyStatuses = await checkAuth(serverNames, identities);
    const authPassed = printDoctorTable(verifyStatuses);
    if (!authPassed) {
      const proceed = await confirm({
        message: "Continue with install despite auth issues?",
        default: true,
      });
      if (!proceed) {
        console.log("Fix the issues above, then re-run: agent-toolkit init");
        process.exit(1);
      }
    }

    // Step 2c: Resolve auth tokens for MCP config
    debug("\nResolving auth tokens...");
    const tokens = await resolveTokens(serverNames, identities);
    const resolvedCount = Object.keys(tokens).length;
    if (resolvedCount > 0) {
      debug(`Resolved tokens for ${Object.keys(tokens).join(", ")}.`);
    } else {
      debug("No tokens resolved. MCP servers may require manual token configuration.");
    }

    // Step 3: Install
    console.log("\nGenerating agent instructions...\n");
    const instructions = await resolveInstructions(client, config, cwd, identities);
    await runInstall(config, client, cwd, false, instructions || undefined, tokens);

    // Step 4: Verify client config was written correctly
    console.log("\nVerifying client configs...");
    const verification = await verifyClientConfig(client, config, cwd);
    const verifyPassed = printVerifyTable(verification);

    if (!verifyPassed) {
      console.log("Fix the issues above, then re-run: agent-toolkit init");
      process.exit(1);
    }

    console.log("Setup complete. Restart your IDE to load the new MCP servers.");
    console.log("Then run `agent-toolkit doctor` to verify everything works end-to-end.");
  });

export { program };
