import { execFile, spawn } from "node:child_process";
import { resolve } from "node:path";
import type { ClientTarget, WorkspaceConfig, ProviderIdentities } from "./domain/manifest.js";
import { shouldSkipDiagnostic } from "./domain/server-registry.js";

// ---------------------------------------------------------------------------
// Value Objects
// ---------------------------------------------------------------------------

export interface ClientCliSpec {
  binary: string;
  headlessFlag: string[];
  streamFlag?: string[];
  modelFlag?: string[];
  extraFlags?: string[];
  mcpFlags?: string[];
  workspaceFlag?: string;
  installHint: string;
}

export type DiagnosticDataCallback = (chunk: string) => void;

export interface SpawnCliResult {
  output: string;
  stdout: string;
  stderr: string;
}

export interface CliAvailability {
  available: boolean;
  path?: string;
  remediation?: string;
}

export interface DiagnosticToolResult {
  tool: string;
  listed: boolean;
  paraphraseAccurate: boolean;
  basicCommandPassed: boolean;
  accountCorrect: boolean;
  details: string;
}

export interface ClientDiagnosticResult {
  cliAvailable: boolean;
  cliRemediation?: string;
  diagnosticRaw?: string;
  validationRaw?: string;
  tools: DiagnosticToolResult[];
  overallPass: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const CLIENT_CLI_SPECS: Record<ClientTarget, ClientCliSpec> = {
  "claude-code": {
    binary: "claude",
    headlessFlag: ["-p"],
    streamFlag: ["--output-format", "stream-json", "--verbose"],
    modelFlag: ["--model", "sonnet"],
    extraFlags: ["--dangerously-skip-permissions"],
    installHint: "Install Claude Code: npm install -g @anthropic-ai/claude-code",
  },
  cursor: {
    binary: "agent",
    headlessFlag: ["-p"],
    streamFlag: ["--output-format", "stream-json", "--stream-partial-output"],
    modelFlag: ["--model", "composer-1.5"],
    extraFlags: ["--trust", "--yolo"],
    mcpFlags: ["--approve-mcps"],
    workspaceFlag: "--workspace",
    installHint: "Install Cursor CLI: curl https://cursor.com/install -fsS | bash",
  },
  copilot: {
    binary: "copilot",
    headlessFlag: ["-p"],
    installHint:
      "Install GitHub Copilot CLI: npm install -g @github/copilot",
  },
  codex: {
    binary: "codex",
    headlessFlag: ["exec"],
    modelFlag: ["--model", "gpt-5.1-codex"],
    extraFlags: ["--full-auto"],
    installHint: "Install Codex: npm install -g @openai/codex",
  },
  "gemini-cli": {
    binary: "gemini",
    headlessFlag: ["-p"],
    extraFlags: ["--output-format", "text"],
    installHint: "Install Gemini CLI: npm install -g @google/gemini-cli",
  },
};

// ---------------------------------------------------------------------------
// CLI Availability
// ---------------------------------------------------------------------------

export async function checkCliAvailable(
  client: ClientTarget,
): Promise<CliAvailability> {
  const spec = CLIENT_CLI_SPECS[client];
  if (!spec) {
    return {
      available: false,
      remediation: `Unknown client "${client}". Supported: ${Object.keys(CLIENT_CLI_SPECS).join(", ")}`,
    };
  }

  try {
    const path = await which(spec.binary);
    return { available: true, path };
  } catch {
    return {
      available: false,
      remediation: spec.installHint,
    };
  }
}

function which(binary: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("which", [binary], (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

// ---------------------------------------------------------------------------
// Arg Builder
// ---------------------------------------------------------------------------

interface BuildCliArgsOptions {
  streaming?: boolean;
  disableMcps?: boolean;
}

function buildCliArgs(
  spec: ClientCliSpec,
  prompt: string,
  cwd?: string,
  options: BuildCliArgsOptions = {},
): { args: string[]; resolvedCwd: string } {
  const resolvedCwd = resolve(cwd ?? process.cwd());
  return {
    args: [
      ...spec.headlessFlag,
      prompt,
      ...(options.streaming ? spec.streamFlag! : []),
      ...(spec.modelFlag ?? []),
      ...(spec.extraFlags ?? []),
      ...(!options.disableMcps ? (spec.mcpFlags ?? []) : []),
      ...(spec.workspaceFlag ? [spec.workspaceFlag, resolvedCwd] : []),
    ],
    resolvedCwd,
  };
}

// ---------------------------------------------------------------------------
// Diagnostic Runner
// ---------------------------------------------------------------------------

const DIAGNOSTIC_TIMEOUT_MS = 120_000;

const BASIC_COMMANDS: Record<string, string> = {
  github: "List your GitHub repositories (just the first 3)",
  gcp: "Show the active authenticated account, then list your GCP projects (just the first 3)",
  terraform: "Show your Terraform workspaces",
  atlassian: "List your Atlassian projects (just the first 3)",
};

export function diagnosticServerNames(config: WorkspaceConfig): string[] {
  return Object.keys(config.servers).filter((name) => !shouldSkipDiagnostic(name));
}

export function buildDiagnosticPrompt(config: WorkspaceConfig): string {
  const serverNames = diagnosticServerNames(config);
  const commandInstructions = serverNames
    .map((name) => {
      const cmd = BASIC_COMMANDS[name] ?? `Run a basic read-only command for ${name}`;
      return `- ${name}: ${cmd}`;
    })
    .join("\n");

  return [
    "You are running a diagnostic check for the agent-toolkit.",
    "Respond in plain, readable text. Do not use JSON or code fences.",
    "",
    "You should have MCP tools available for these servers: " + serverNames.join(", "),
    "",
    "For each server above:",
    "1. Briefly describe what the MCP tools for this server let you do (paraphrase in your own words — do not just list tool names).",
    "2. Run this read-only test command to verify the tool works:",
    commandInstructions,
    "3. IMPORTANT: You MUST explicitly report the exact authenticated account or identity the tool is using.",
    "   Do NOT just say 'authenticated' or 'configured' — state the actual account value.",
    "   Examples of what to report:",
    "   - GitHub: the authenticated username (e.g. 'octocat')",
    "   - GCP: the active account email (e.g. 'user@example.com') — run a command like `gcloud auth list` or equivalent to discover this",
    "   - Terraform: the organization name and host (e.g. 'MyOrg on app.terraform.io')",
    "   - Atlassian: the authenticated email (e.g. 'user@example.com')",
    "4. Report the test command output or error.",
    "",
    "If a tool is not available, say so and move on to the next server.",
    "Write your findings clearly so a human can read them.",
  ].join("\n");
}

export async function runDiagnostic(
  client: ClientTarget,
  config: WorkspaceConfig,
  cwd?: string,
  onData?: DiagnosticDataCallback,
): Promise<string> {
  const availability = await checkCliAvailable(client);
  if (!availability.available) {
    throw new Error(
      `CLI for "${client}" is not available. ${availability.remediation ?? ""}`,
    );
  }

  const spec = CLIENT_CLI_SPECS[client];
  const prompt = buildDiagnosticPrompt(config);
  const streaming = !!(onData && spec.streamFlag);
  const { args, resolvedCwd } = buildCliArgs(spec, prompt, cwd, { streaming });

  // Always pass onData so stderr is forwarded in real-time even for
  // non-streaming clients (e.g. codex). For streaming clients, NDJSON
  // text deltas from stdout are also forwarded.
  const { output, stdout } = await spawnCli(
    spec.binary,
    args,
    resolvedCwd,
    onData,
  );
  // stderr was already forwarded in real-time by spawnCli.
  // Forward stdout post-completion for non-streaming clients only —
  // streaming clients already emitted stdout deltas via NDJSON parsing.
  if (!streaming && onData && stdout) {
    onData(stdout);
  }
  return output;
}

interface NdjsonEvent {
  text?: string;
  result?: string;
}

function parseNdjsonLine(line: string): NdjsonEvent {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return {};
  }

  if (event.type === "assistant" && event.message) {
    const msg = event.message as Record<string, unknown>;
    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const part of content) {
        if (typeof part.text === "string") {
          parts.push(part.text);
        }
      }
      if (parts.length > 0) return { text: parts.join("") };
    }
  }

  if (event.type === "result" && typeof event.result === "string") {
    return { result: event.result };
  }

  return {};
}

/**
 * Build a clean env for headless CLI spawns by stripping IDE-specific
 * variables. Prevents child processes from detecting an IDE and
 * attempting companion extension connections.
 */
function buildCleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("VSCODE_") || key.startsWith("CURSOR_")) {
      delete env[key];
    }
  }
  if (env.TERM_PROGRAM === "vscode") {
    delete env.TERM_PROGRAM;
    delete env.TERM_PROGRAM_VERSION;
  }
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

export function spawnCli(
  binary: string,
  args: string[],
  cwd?: string,
  onData?: DiagnosticDataCallback,
  timeoutMs: number = DIAGNOSTIC_TIMEOUT_MS,
): Promise<SpawnCliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      env: buildCleanEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let ndjsonResult: string | undefined;
    let lineBuffer = "";
    let accumulatedText = "";

    // Handles both cumulative streaming (each event has full text so far)
    // and delta streaming (each event has only new text).
    // Also detects full retransmissions (text already seen) and skips them.
    const emitTextDelta = onData
      ? (text: string) => {
          if (text.startsWith(accumulatedText)) {
            const delta = text.slice(accumulatedText.length);
            if (delta) onData(delta);
            accumulatedText = text;
          } else if (accumulatedText.startsWith(text)) {
            // Already seen this text or a superset — skip retransmission
          } else {
            onData(text);
            accumulatedText += text;
          }
        }
      : undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      if (!emitTextDelta) return;

      lineBuffer += chunk.toString();
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = parseNdjsonLine(line);
        if (event.text !== undefined) emitTextDelta(event.text);
        if (event.result !== undefined) ndjsonResult = event.result;
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      if (onData) onData(chunk.toString());
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to start CLI: ${err.message}`));
    });

    child.on("close", (code, signal) => {
      if (lineBuffer.trim() && emitTextDelta) {
        const event = parseNdjsonLine(lineBuffer);
        if (event.text !== undefined) emitTextDelta(event.text);
        if (event.result !== undefined) ndjsonResult = event.result;
      }

      const stdout = Buffer.concat(stdoutChunks).toString();
      const stderr = Buffer.concat(stderrChunks).toString();

      if (signal === "SIGTERM" || code === 143) {
        reject(new Error(`CLI timed out after ${timeoutMs / 1000}s`));
        return;
      }
      if (code !== 0 && code !== null) {
        const msg = stderr.trim() || `exited with code ${code}`;
        reject(new Error(`CLI exited with error: ${msg}`));
        return;
      }

      const output = (ndjsonResult ?? stdout) || stderr;
      resolve({ output, stdout, stderr });
    });
  });
}

// ---------------------------------------------------------------------------
// Validation Runner
// ---------------------------------------------------------------------------

export function buildValidationPrompt(
  diagnosticOutput: string,
  config: WorkspaceConfig,
  identities?: ProviderIdentities,
): string {
  const serverNames = diagnosticServerNames(config);
  const expectedTools = serverNames.join(", ");

  const identityLines: string[] = [];
  if (identities && Object.keys(identities).length > 0) {
    identityLines.push(
      "",
      "Expected identities per server (from .agent-toolkit.local.json):",
    );
    for (const name of serverNames) {
      const id = identities[name];
      if (id) {
        const entries = Object.entries(id as Record<string, unknown>)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(", ");
        identityLines.push(`- ${name}: ${entries}`);
      }
    }
    identityLines.push("");
  }

  return [
    "You are a JSON-only validator. Output ONLY a single valid JSON object.",
    "Do not output markdown fences, commentary, explanations, banners, or any other text.",
    "",
    "Expected MCP servers: " + expectedTools,
    ...identityLines,
    "",
    "Diagnostic report (plain text):",
    "---",
    diagnosticOutput,
    "---",
    "",
    "Read the diagnostic report above and, for each expected server, determine:",
    "- listed: Was a tool for this server found and available?",
    "- paraphraseAccurate: Did the diagnostic include a reasonable description of the tool's purpose?",
    "- basicCommandPassed: Did the test command produce real output (not an error or rejection)?",
    "- accountCorrect: Does the reported identity match ALL expected identity fields? " +
      "Each expected identity has named fields (e.g., account, email, host). " +
      "Match each field by its semantics: 'account' or 'email' must match the authenticated user; " +
      "'host' must match the server endpoint the tool connected to (not the user email). " +
      "All expected fields must match for accountCorrect to be true. " +
      "If no expected identity was provided for a server, set to true. " +
      "If no identity was reported but one was expected, set to false.",
    "",
    "Return EXACTLY this JSON structure:",
    '{"tools":[{"tool":"<server_name>","listed":true/false,"paraphraseAccurate":true/false,"basicCommandPassed":true/false,"accountCorrect":true/false,"details":"<brief explanation>"}],"overallPass":true/false}',
    "",
    "No markdown. No extra text. Only the JSON object.",
  ].join("\n");
}

export async function runValidation(
  client: ClientTarget,
  diagnosticOutput: string,
  config: WorkspaceConfig,
  cwd?: string,
  onData?: DiagnosticDataCallback,
  identities?: ProviderIdentities,
): Promise<ClientDiagnosticResult> {
  const spec = CLIENT_CLI_SPECS[client];
  const prompt = buildValidationPrompt(diagnosticOutput, config, identities);
  const streaming = !!(onData && spec.streamFlag);
  const { args, resolvedCwd } = buildCliArgs(spec, prompt, cwd, { streaming, disableMcps: true });

  let raw: string;
  try {
    const result = await spawnCli(spec.binary, args, resolvedCwd, streaming ? onData : undefined);
    raw = result.output;
  } catch (err) {
    return fallbackResult(config, `Validation CLI failed: ${(err as Error).message}`);
  }

  return parseValidationOutput(raw, config);
}

export function extractJson(raw: string): Record<string, unknown> | undefined {
  // Try parsing as a CLI JSON envelope (e.g. {"type":"result","result":"..."})
  try {
    const envelope = JSON.parse(raw);
    if (typeof envelope.result === "string") {
      const inner = JSON.parse(envelope.result);
      if (inner && typeof inner === "object" && "tools" in inner) return inner;
    }
    if (envelope && typeof envelope === "object" && "tools" in envelope) return envelope;
  } catch { /* not a top-level JSON blob */ }

  // Fall back to regex extraction from free-form text
  const match = raw.match(/\{[\s\S]*"tools"[\s\S]*\}/);
  if (!match) return undefined;
  try {
    return JSON.parse(match[0]);
  } catch {
    return undefined;
  }
}

function parseValidationOutput(
  raw: string,
  config: WorkspaceConfig,
): ClientDiagnosticResult {
  const parsed = extractJson(raw);
  if (!parsed) {
    return fallbackResult(config, "No JSON found in validation output", raw);
  }

  try {
    const tools: DiagnosticToolResult[] = [];

    if (Array.isArray(parsed.tools)) {
      for (const t of parsed.tools as Record<string, unknown>[]) {
        tools.push({
          tool: String(t.tool ?? t.name ?? "unknown"),
          listed: Boolean(t.listed),
          paraphraseAccurate: Boolean(t.paraphraseAccurate),
          basicCommandPassed: Boolean(t.basicCommandPassed),
          accountCorrect: t.accountCorrect !== undefined ? Boolean(t.accountCorrect) : true,
          details: String(t.details ?? ""),
        });
      }
    }

    const overallPass =
      typeof parsed.overallPass === "boolean"
        ? parsed.overallPass
        : tools.every((t) => t.listed && t.paraphraseAccurate && t.basicCommandPassed && t.accountCorrect);

    return {
      cliAvailable: true,
      diagnosticRaw: undefined,
      validationRaw: raw,
      tools,
      overallPass,
    };
  } catch {
    return fallbackResult(config, "Failed to parse validation JSON", raw);
  }
}

function fallbackResult(
  config: WorkspaceConfig,
  error: string,
  raw?: string,
): ClientDiagnosticResult {
  const serverNames = diagnosticServerNames(config);
  return {
    cliAvailable: true,
    validationRaw: raw,
    tools: serverNames.map((name) => ({
      tool: name,
      listed: false,
      paraphraseAccurate: false,
      basicCommandPassed: false,
      accountCorrect: false,
      details: error,
    })),
    overallPass: false,
    error,
  };
}

// ---------------------------------------------------------------------------
// Client Diagnostic Orchestrator
// ---------------------------------------------------------------------------

export async function runClientDiagnostic(
  client: ClientTarget,
  config: WorkspaceConfig,
  cwd?: string,
  onData?: DiagnosticDataCallback,
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

  let diagnosticOutput: string;
  try {
    diagnosticOutput = await runDiagnostic(client, config, cwd, onData);
  } catch (err) {
    return {
      cliAvailable: true,
      tools: [],
      overallPass: false,
      error: `Diagnostic failed: ${(err as Error).message}`,
    };
  }

  try {
    const result = await runValidation(client, diagnosticOutput, config, cwd, undefined, identities);
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
