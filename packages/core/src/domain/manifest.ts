/**
 * WorkspaceConfig aggregate — the declarative configuration
 * for which MCP servers, toolsets, and agent instructions
 * a project requires.
 */

// ---------------------------------------------------------------------------
// Value Objects
// ---------------------------------------------------------------------------

export type ServerName =
  | "github"
  | "terraform"
  | "atlassian"
  | "gcp"
  | (string & {});

export type ClientTarget =
  | "cursor"
  | "claude-code"
  | "copilot"
  | "codex"
  | "gemini-cli";

// ---------------------------------------------------------------------------
// Typed Server Settings — per-provider scoping + workflow context
// ---------------------------------------------------------------------------

export interface GitHubSettings {
  organization?: string;
  repositories?: string[];
  ci?: boolean;
  codeReview?: boolean;
  issueTracker?: "github" | "jira" | (string & {});
  usageNotes?: string;
  [key: string]: unknown;
}

export interface GcpSettings {
  projects?: string[];
  region?: string;
  services?: string[];
  usageNotes?: string;
  [key: string]: unknown;
}

export interface TerraformSettings {
  organization?: string;
  projects?: string[];
  workspaces?: string[];
  backend?: "gcs" | "s3" | "azurerm" | "remote" | "local" | (string & {});
  ci?: "github-actions" | "gitlab-ci" | "cloud-build" | (string & {});
  stateUrl?: string;
  usageNotes?: string;
  [key: string]: unknown;
}

export interface AtlassianSettings {
  site?: string;
  projects?: string[];
  usageNotes?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface ServerDeclaration {
  toolsets?: string[];
  settings?: Record<string, unknown>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

// ---------------------------------------------------------------------------
// Backward-compatible workflow hint types (deprecated — use server settings)
// ---------------------------------------------------------------------------

/** @deprecated Use TerraformSettings instead. */
export type TerraformWorkflowHints = TerraformSettings;

/** @deprecated Use GitHubSettings instead. */
export type GitHubWorkflowHints = GitHubSettings;

/** @deprecated Use GcpSettings instead. */
export type GcpWorkflowHints = GcpSettings;

/** @deprecated Use AtlassianSettings instead. */
export type AtlassianWorkflowHints = AtlassianSettings;

/** @deprecated Use server settings instead of workflows. */
export type KnownWorkflowHints = {
  terraform?: TerraformSettings;
  github?: GitHubSettings;
  gcp?: GcpSettings;
  atlassian?: AtlassianSettings;
};

/** @deprecated Use server settings instead of workflows. */
export type WorkflowHints = KnownWorkflowHints & {
  [key: string]: Record<string, unknown> | undefined;
};

export interface InstructionPreferences {
  include?: string[];
  exclude?: string[];
}

// ---------------------------------------------------------------------------
// Local Config — per-project account/identity pinning
// ---------------------------------------------------------------------------

export interface GitHubIdentity {
  account?: string;
}

export interface GcpIdentity {
  account?: string;
}

export interface TerraformIdentity {
  host?: string;
  email?: string;
}

export interface AtlassianIdentity {
  email?: string;
}

export type KnownProviderIdentities = {
  github?: GitHubIdentity;
  gcp?: GcpIdentity;
  terraform?: TerraformIdentity;
  atlassian?: AtlassianIdentity;
};

export type ProviderIdentities = KnownProviderIdentities & {
  [key: string]: Record<string, unknown> | undefined;
};

export interface LocalConfig {
  identity?: ProviderIdentities;
}

export const DEFAULT_LOCAL_CONFIG: LocalConfig = {};

// ---------------------------------------------------------------------------
// Aggregate Root
// ---------------------------------------------------------------------------

export type ServerMap = Partial<Record<ServerName, ServerDeclaration>> &
  Record<string, ServerDeclaration>;

export interface WorkspaceConfig {
  servers: ServerMap;
  /** @deprecated Scoping and workflow context now lives in each server's settings. */
  workflows?: WorkflowHints;
  instructions?: InstructionPreferences;
}

// ---------------------------------------------------------------------------
// Built-in defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: WorkspaceConfig = {
  servers: {},
};
