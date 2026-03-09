import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  checkAuth,
  checkGitHubAuth,
  checkGcpAuth,
  checkTerraformAuth,
  checkAtlassianAuth,
  registerAuthChecker,
  parseGitHubAccounts,
  extractPinnableIdentity,
  checkDockerAvailable,
} from "./auth-checker.js";
import type { AuthStatus } from "./auth-checker.js";
import { serverUsesDocker } from "./domain/server-registry.js";

describe("checkAuth dispatch", () => {
  it("returns unsupported error for unknown providers", async () => {
    const [result] = await checkAuth(["nonexistent"]);
    assert.equal(result.provider, "nonexistent");
    assert.equal(result.authenticated, false);
    assert.match(result.error!, /No auth checker/);
    assert.ok(result.remediation);
  });

  it("dispatches to registered checker for github", async () => {
    const results = await checkAuth(["github"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].provider, "github");
    assert.equal(typeof results[0].authenticated, "boolean");
  });

  it("supports custom checkers via registerAuthChecker", async () => {
    const fakeChecker = async (): Promise<AuthStatus> => ({
      provider: "custom",
      authenticated: true,
      identity: "test-user",
    });

    registerAuthChecker("custom", fakeChecker);
    const [result] = await checkAuth(["custom"]);
    assert.equal(result.authenticated, true);
    assert.equal(result.identity, "test-user");
  });
});

describe("checkGitHubAuth", () => {
  it("returns an AuthStatus with provider 'github'", async () => {
    const result = await checkGitHubAuth();
    assert.equal(result.provider, "github");
    assert.equal(typeof result.authenticated, "boolean");

    if (result.authenticated) {
      assert.ok(result.identity, "authenticated result should include identity");
      assert.ok(!result.identity!.includes(" on "), "identity should be just the username");
    } else {
      assert.ok(result.error, "failed result should include error");
      assert.ok(result.remediation, "failed result should include remediation");
    }
  });
});

describe("checkGcpAuth", () => {
  it("returns an AuthStatus with provider 'gcp'", async () => {
    const result = await checkGcpAuth();
    assert.equal(result.provider, "gcp");
    assert.equal(typeof result.authenticated, "boolean");

    if (result.authenticated) {
      // identity is best-effort; may be undefined if account is unset
      if (result.identity) {
        assert.equal(typeof result.identity, "string");
      }
    } else {
      assert.ok(result.error, "failed result should include error");
      assert.ok(result.remediation, "failed result should include remediation");
    }
  });

  it("is dispatched via checkAuth for 'gcp' provider", async () => {
    const results = await checkAuth(["gcp"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].provider, "gcp");
    assert.equal(typeof results[0].authenticated, "boolean");
  });
});

describe("checkTerraformAuth", () => {
  it("returns an AuthStatus with provider 'terraform'", async () => {
    const result = await checkTerraformAuth();
    assert.equal(result.provider, "terraform");
    assert.equal(typeof result.authenticated, "boolean");

    if (result.authenticated) {
      assert.ok(result.identity, "authenticated result should include identity (email or host)");
    } else {
      assert.ok(result.error, "failed result should include error");
      assert.ok(result.remediation, "failed result should include remediation");
      assert.match(result.remediation!, /terraform login/);
    }
  });

  it("is dispatched via checkAuth for 'terraform' provider", async () => {
    const results = await checkAuth(["terraform"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].provider, "terraform");
    assert.equal(typeof results[0].authenticated, "boolean");
  });

  it("reports not authenticated for a host with no credentials", async () => {
    const result = await checkTerraformAuth("nonexistent.example.com");
    assert.equal(result.provider, "terraform");
    assert.equal(result.authenticated, false);
    assert.match(result.error!, /nonexistent\.example\.com/);
    assert.match(result.remediation!, /terraform login nonexistent\.example\.com/);
  });
});

describe("checkAtlassianAuth", () => {
  it("always returns authenticated (OAuth browser flow)", async () => {
    const result = await checkAtlassianAuth();
    assert.equal(result.provider, "atlassian");
    assert.equal(result.authenticated, true);
    assert.equal(result.identity, "OAuth");
  });

  it("is dispatched via checkAuth for 'atlassian' provider", async () => {
    const results = await checkAuth(["atlassian"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].provider, "atlassian");
    assert.equal(results[0].authenticated, true);
  });
});

describe("checkAuth with identity pinning", () => {
  it("atlassian always passes regardless of identity config (OAuth)", async () => {
    const results = await checkAuth(["atlassian"], {
      atlassian: { email: "expected@example.com" },
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].authenticated, true);
    assert.equal(results[0].identityMismatch, undefined);
  });
});

// ---------------------------------------------------------------------------
// parseGitHubAccounts
// ---------------------------------------------------------------------------

describe("parseGitHubAccounts", () => {
  it("parses single account from gh auth status output", () => {
    const output = [
      "github.com",
      "  ✓ Logged in to github.com account octocat (oauth_token)",
      "  - Active account: true",
    ].join("\n");

    const accounts = parseGitHubAccounts(output);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].account, "octocat");
    assert.equal(accounts[0].host, "github.com");
    assert.equal(accounts[0].active, true);
  });

  it("parses multiple accounts across hosts", () => {
    const output = [
      "github.com",
      "  ✓ Logged in to github.com account octocat (oauth_token)",
      "  X Logged in to github.com account backup-user (token)",
      "github.example.com",
      "  ✓ Logged in to github.example.com account enterprise-user (token)",
    ].join("\n");

    const accounts = parseGitHubAccounts(output);
    assert.equal(accounts.length, 3);
    assert.equal(accounts[0].account, "octocat");
    assert.equal(accounts[0].active, true);
    assert.equal(accounts[1].account, "backup-user");
    assert.equal(accounts[1].active, false);
    assert.equal(accounts[2].account, "enterprise-user");
    assert.equal(accounts[2].host, "github.example.com");
  });

  it("returns empty array for unparseable output", () => {
    const accounts = parseGitHubAccounts("some random text");
    assert.deepEqual(accounts, []);
  });
});

// ---------------------------------------------------------------------------
// extractPinnableIdentity
// ---------------------------------------------------------------------------

describe("extractPinnableIdentity", () => {
  it("extracts github account from identity string", () => {
    const result = extractPinnableIdentity({
      provider: "github",
      authenticated: true,
      identity: "octocat",
    });
    assert.deepEqual(result, { account: "octocat" });
  });

  it("extracts gcp account from identity string", () => {
    const result = extractPinnableIdentity({
      provider: "gcp",
      authenticated: true,
      identity: "user@example.com",
    });
    assert.deepEqual(result, { account: "user@example.com" });
  });

  it("returns undefined for terraform (identity pinned via dedicated flow)", () => {
    const result = extractPinnableIdentity({
      provider: "terraform",
      authenticated: true,
      identity: "user@example.com",
    });
    assert.equal(result, undefined);
  });

  it("returns undefined for atlassian (OAuth — no pinnable identity)", () => {
    const result = extractPinnableIdentity({
      provider: "atlassian",
      authenticated: true,
      identity: "OAuth",
    });
    assert.equal(result, undefined);
  });

  it("returns undefined for unauthenticated provider", () => {
    const result = extractPinnableIdentity({
      provider: "github",
      authenticated: false,
      error: "not logged in",
    });
    assert.equal(result, undefined);
  });

  it("returns undefined when identity is missing", () => {
    const result = extractPinnableIdentity({
      provider: "gcp",
      authenticated: true,
    });
    assert.equal(result, undefined);
  });

  it("returns undefined for unknown provider", () => {
    const result = extractPinnableIdentity({
      provider: "unknown-provider",
      authenticated: true,
      identity: "some-identity",
    });
    assert.equal(result, undefined);
  });

});

// ---------------------------------------------------------------------------
// checkDockerAvailable
// ---------------------------------------------------------------------------

describe("checkDockerAvailable", () => {
  it("returns a DockerStatus with boolean fields", async () => {
    const result = await checkDockerAvailable();
    assert.equal(typeof result.available, "boolean");
    assert.equal(typeof result.daemonRunning, "boolean");

    if (result.available && result.daemonRunning) {
      assert.equal(result.error, undefined);
      assert.equal(result.remediation, undefined);
    } else {
      assert.ok(result.error, "should include an error message");
      assert.ok(result.remediation, "should include remediation");
    }
  });

  it("reports daemonRunning false when available is false", async () => {
    const result = await checkDockerAvailable();
    if (!result.available) {
      assert.equal(result.daemonRunning, false);
    }
  });
});

// ---------------------------------------------------------------------------
// serverUsesDocker
// ---------------------------------------------------------------------------

describe("serverUsesDocker", () => {
  it("returns true for terraform (registry default uses docker)", () => {
    assert.equal(serverUsesDocker("terraform"), true);
  });

  it("returns false for github (registry default uses npx)", () => {
    assert.equal(serverUsesDocker("github"), false);
  });

  it("returns false for atlassian (registry default uses npx)", () => {
    assert.equal(serverUsesDocker("atlassian"), false);
  });

  it("returns true when declaration explicitly sets command to docker", () => {
    assert.equal(serverUsesDocker("custom", { command: "docker" }), true);
  });

  it("returns false when declaration explicitly sets a non-docker command", () => {
    assert.equal(serverUsesDocker("terraform", { command: "npx" }), false);
  });

  it("returns false when declaration uses a url", () => {
    assert.equal(serverUsesDocker("terraform", { url: "https://example.com" }), false);
  });

  it("returns false for unknown server with no declaration", () => {
    assert.equal(serverUsesDocker("unknown-server"), false);
  });
});
