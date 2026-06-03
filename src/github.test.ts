import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRepoBranches, fetchRepoContextFiles } from "./github";

const repo = { owner: "owner", repo: "demo" };

function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
}

function notFound(): Response {
  return jsonResponse({ message: "Not Found" }, { status: 404 });
}

describe("fetchRepoContextFiles", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the tree first and only downloads selected blobs", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/commits/main")) {
        return Promise.resolve(jsonResponse({ sha: "commit-sha", commit: { tree: { sha: "tree-sha" } } }));
      }
      if (url.includes("/git/trees/tree-sha")) {
        return Promise.resolve(
          jsonResponse({
            truncated: false,
            tree: [
              { path: "README.md", type: "blob", sha: "readme-sha", size: 8, url: "https://api.github.com/blob/readme" },
              { path: "src/app.ts", type: "blob", sha: "app-sha", size: 23, url: "https://api.github.com/blob/app" },
              { path: "node_modules/pkg/index.js", type: "blob", sha: "noise-sha", size: 5, url: "https://api.github.com/blob/noise" }
            ]
          })
        );
      }
      if (url === "https://api.github.com/blob/readme") {
        return Promise.resolve(jsonResponse({ encoding: "base64", content: Buffer.from("# Demo").toString("base64") }));
      }
      if (url === "https://api.github.com/blob/app") {
        return Promise.resolve(jsonResponse({ encoding: "base64", content: Buffer.from("export const ok = true;").toString("base64") }));
      }
      return Promise.resolve(notFound());
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRepoContextFiles(repo, "main", "token", 1_000_000);

    expect(result.files.map((file) => file.path)).toEqual(["README.md", "src/app.ts"]);
    expect(result.skipped).toContainEqual({ path: "node_modules/pkg/index.js", reason: "vendor/dependency directory", size: 5 });
    expect(fetchMock).not.toHaveBeenCalledWith("https://api.github.com/blob/noise", expect.anything());
  });

  it("resolves branch names with slashes through git refs when needed", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/commits/feature/test")) return Promise.resolve(notFound());
      if (url.endsWith("/git/ref/heads/feature/test")) {
        return Promise.resolve(jsonResponse({ object: { type: "commit", sha: "commit-sha", url: "https://api.github.com/git/commit" } }));
      }
      if (url === "https://api.github.com/git/commit") {
        return Promise.resolve(jsonResponse({ sha: "commit-sha", tree: { sha: "tree-sha" } }));
      }
      if (url.includes("/git/trees/tree-sha")) {
        return Promise.resolve(jsonResponse({ truncated: false, tree: [] }));
      }
      return Promise.resolve(notFound());
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRepoContextFiles(repo, "feature/test", "token", 1_000_000);

    expect(result.treePaths).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/demo/git/ref/heads/feature/test",
      expect.objectContaining({ redirect: "follow" })
    );
  });

  it("does not download blobs for the map-only profile", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/commits/main")) {
        return Promise.resolve(jsonResponse({ sha: "commit-sha", commit: { tree: { sha: "tree-sha" } } }));
      }
      if (url.includes("/git/trees/tree-sha")) {
        return Promise.resolve(
          jsonResponse({
            truncated: false,
            tree: [{ path: "src/app.ts", type: "blob", sha: "app-sha", size: 23, url: "https://api.github.com/blob/app" }]
          })
        );
      }
      return Promise.resolve(notFound());
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRepoContextFiles(repo, "main", "token", 1_000_000, "map_only");

    expect(result.files).toEqual([]);
    expect(result.skipped).toContainEqual({ path: "src/app.ts", reason: "map only profile selected", size: 23 });
    expect(fetchMock).not.toHaveBeenCalledWith("https://api.github.com/blob/app", expect.anything());
  });

  it("uses Forgejo API base URL and query-token auth when Forgejo is selected", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/repos/owner/demo/git/refs/heads/main") || url.includes("/api/v1/repos/owner/demo/git/refs/tags/main")) {
        return Promise.resolve(notFound());
      }
      if (url.includes("/api/v1/repos/owner/demo/git/commits/main")) {
        return Promise.resolve(jsonResponse({ sha: "commit-sha", commit: { tree: { sha: "tree-sha" } } }));
      }
      if (url.includes("/api/v1/repos/owner/demo/git/trees/tree-sha")) {
        return Promise.resolve(
          jsonResponse({
            truncated: false,
            tree: [{ path: "src/app.ts", type: "blob", sha: "app-sha", size: 23, url: "/api/v1/repos/owner/demo/git/blobs/app-sha" }]
          })
        );
      }
      if (url.includes("https://forge.example.com/api/v1/repos/owner/demo/git/blobs/app-sha")) {
        return Promise.resolve(jsonResponse({ encoding: "base64", content: Buffer.from("export const ok = true;").toString("base64") }));
      }
      return Promise.resolve(notFound());
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRepoContextFiles(repo, "main", "forgejo-token", 1_000_000, "code_docs", {
      provider: "forgejo",
      forgejoBaseUrl: "https://forge.example.com"
    });

    expect(result.files.map((file) => file.path)).toEqual(["src/app.ts"]);
    const commitCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/git/commits/main"));
    expect(commitCall).toBeDefined();
    const [commitUrl, commitInit] = commitCall as unknown as [RequestInfo | URL, RequestInit];
    expect(String(commitUrl)).toContain("access_token=forgejo-token");
    expect(commitInit).toEqual(expect.objectContaining({ headers: expect.not.objectContaining({ Authorization: expect.any(String) }) }));
  });

  it("accepts Forgejo ref endpoints that return matching ref arrays", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/repos/owner/demo/git/refs/heads/main")) {
        return Promise.resolve(
          jsonResponse([
            { ref: "refs/heads/main-old", object: { type: "commit", sha: "old-sha", url: "https://forge.example.com/api/v1/repos/owner/demo/git/commits/old-sha" } },
            { ref: "refs/heads/main", object: { type: "commit", sha: "commit-sha", url: "https://forge.example.com/api/v1/repos/owner/demo/git/commits/commit-sha" } }
          ])
        );
      }
      if (url.includes("/api/v1/repos/owner/demo/git/commits/commit-sha")) {
        return Promise.resolve(jsonResponse({ sha: "commit-sha", commit: { tree: { sha: "tree-sha" } } }));
      }
      if (url.includes("/api/v1/repos/owner/demo/git/trees/tree-sha")) {
        return Promise.resolve(jsonResponse({ truncated: false, tree: [] }));
      }
      return Promise.resolve(notFound());
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRepoContextFiles(repo, "main", "forgejo-token", 1_000_000, "code_docs", {
      provider: "forgejo",
      forgejoBaseUrl: "https://forge.example.com"
    });

    expect(result.resolvedCommitSha).toBe("commit-sha");
  });

  it("reports malformed Forgejo ref responses without reading undefined type", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/repos/owner/demo/git/refs/heads/main") || url.includes("/api/v1/repos/owner/demo/git/refs/tags/main")) {
        return Promise.resolve(jsonResponse({ object: null }));
      }
      if (url.includes("/api/v1/repos/owner/demo/git/commits/main")) {
        return Promise.resolve(jsonResponse({ sha: "commit-sha", commit: {} }));
      }
      return Promise.resolve(notFound());
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRepoContextFiles(repo, "main", "forgejo-token", 1_000_000, "code_docs", {
        provider: "forgejo",
        forgejoBaseUrl: "https://forge.example.com"
      })
    ).rejects.toThrow("Forgejo commit response did not include a tree SHA.");
  });
});

describe("fetchRepoBranches", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns branches and tags for the branch selector", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/repos/owner/demo")) {
        return Promise.resolve(
          jsonResponse({
            owner: { login: "owner" },
            name: "demo",
            default_branch: "main",
            html_url: "https://github.com/owner/demo",
            private: false
          })
        );
      }
      if (url.includes("/branches")) {
        return Promise.resolve(jsonResponse([{ name: "main", protected: true, commit: { sha: "main-sha" } }]));
      }
      if (url.includes("/tags")) {
        return Promise.resolve(jsonResponse([{ name: "v1.0.0", commit: { sha: "tag-sha" } }]));
      }
      return Promise.resolve(notFound());
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRepoBranches(repo, "token");

    expect(result.defaultBranch).toBe("main");
    expect(result.branches).toEqual([{ name: "main", protected: true, commitSha: "main-sha" }]);
    expect(result.tags).toEqual([{ name: "v1.0.0", commitSha: "tag-sha" }]);
  });
});
