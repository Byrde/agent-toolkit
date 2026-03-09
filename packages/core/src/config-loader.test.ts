import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import { loadConfig, loadLocalConfig, writeLocalConfig, getConfigPath, getLocalConfigPath, CONFIG_FILE, LOCAL_CONFIG_FILE } from "./config-loader.js";
import type { WorkspaceConfig, LocalConfig } from "./domain/manifest.js";

describe("getConfigPath", () => {
  it("returns config path relative to cwd", () => {
    const path = getConfigPath("/some/project");
    assert.equal(path, "/some/project/.agent-toolkit.json");
  });
});

describe("loadConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns default config when no config file exists", async () => {
    const config = await loadConfig(tmpDir);
    assert.deepEqual(config.servers, {});
  });

  it("loads project-level config with server settings", async () => {
    const projectConfig: Partial<WorkspaceConfig> = {
      servers: {
        github: {
          toolsets: ["default", "actions"],
          settings: { organization: "my-org", repositories: ["repo-a"] },
        },
        terraform: {
          settings: { organization: "acme", workspaces: ["staging"] },
        },
      },
    };
    await writeFile(
      join(tmpDir, CONFIG_FILE),
      JSON.stringify(projectConfig),
    );

    const config = await loadConfig(tmpDir);
    const github = config.servers.github;
    assert.ok(github, "github server should be present");
    assert.deepEqual(github.toolsets, ["default", "actions"]);
    assert.deepEqual(github.settings, { organization: "my-org", repositories: ["repo-a"] });
    assert.deepEqual(config.servers.terraform?.settings, { organization: "acme", workspaces: ["staging"] });
  });

  it("accepts config with no settings", async () => {
    const noSettings = { servers: { github: {} } };
    await writeFile(join(tmpDir, CONFIG_FILE), JSON.stringify(noSettings));
    const config = await loadConfig(tmpDir);
    assert.equal(config.servers.github?.settings, undefined);
  });

  it("rejects non-object config files", async () => {
    await writeFile(join(tmpDir, CONFIG_FILE), '"not an object"');
    await assert.rejects(
      () => loadConfig(tmpDir),
      /must be a JSON object/,
    );
  });
});

describe("getLocalConfigPath", () => {
  it("returns local config path relative to cwd", () => {
    const path = getLocalConfigPath("/some/project");
    assert.equal(path, "/some/project/.agent-toolkit.local.json");
  });
});

describe("loadLocalConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-local-test-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty defaults when no local config file exists", async () => {
    const config = await loadLocalConfig(tmpDir);
    assert.equal(config.identity, undefined);
  });

  it("loads local config with provider identities", async () => {
    const localConfig: LocalConfig = {
      identity: {
        github: { account: "octocat" },
        gcp: { account: "dev@example.com" },
        terraform: { host: "app.terraform.io" },
        atlassian: { email: "dev@example.com" },
      },
    };
    await writeFile(
      join(tmpDir, LOCAL_CONFIG_FILE),
      JSON.stringify(localConfig),
    );

    const config = await loadLocalConfig(tmpDir);
    assert.deepEqual(config.identity?.github, { account: "octocat" });
    assert.deepEqual(config.identity?.gcp, { account: "dev@example.com" });
    assert.deepEqual(config.identity?.terraform, { host: "app.terraform.io" });
    assert.deepEqual(config.identity?.atlassian, { email: "dev@example.com" });
  });

  it("rejects non-object local config files", async () => {
    await writeFile(join(tmpDir, LOCAL_CONFIG_FILE), '"not an object"');
    await assert.rejects(
      () => loadLocalConfig(tmpDir),
      /must be a JSON object/,
    );
  });
});

describe("writeLocalConfig", () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "toolkit-write-local-"));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes local config as formatted JSON", async () => {
    const config: LocalConfig = {
      identity: {
        github: { account: "octocat" },
      },
    };

    const path = await writeLocalConfig(config, tmpDir);
    assert.ok(path.endsWith(LOCAL_CONFIG_FILE));

    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed.identity.github, { account: "octocat" });
  });

  it("merges with existing local config", async () => {
    const existing: LocalConfig = {
      identity: {
        github: { account: "octocat" },
        atlassian: { email: "old@example.com" },
      },
    };
    await writeFile(
      join(tmpDir, LOCAL_CONFIG_FILE),
      JSON.stringify(existing),
    );

    const update: LocalConfig = {
      identity: {
        gcp: { account: "new@example.com" },
        atlassian: { email: "new@example.com" },
      },
    };
    await writeLocalConfig(update, tmpDir);

    const loaded = await loadLocalConfig(tmpDir);
    assert.deepEqual(loaded.identity?.github, { account: "octocat" });
    assert.deepEqual(loaded.identity?.gcp, { account: "new@example.com" });
    assert.deepEqual(loaded.identity?.atlassian, { email: "new@example.com" });
  });

  it("creates file when none exists", async () => {
    const freshDir = await mkdtemp(join(tmpdir(), "toolkit-write-local-fresh-"));
    try {
      const config: LocalConfig = {
        identity: { terraform: { host: "app.terraform.io" } },
      };
      const path = await writeLocalConfig(config, freshDir);
      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw);
      assert.deepEqual(parsed.identity.terraform, { host: "app.terraform.io" });
    } finally {
      await rm(freshDir, { recursive: true, force: true });
    }
  });
});
