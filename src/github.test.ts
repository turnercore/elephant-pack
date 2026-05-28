import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRepoContextFiles } from "./github";

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
    expect(result.skipped).toContainEqual({ path: "node_modules/pkg/index.js", reason: "excluded directory: node_modules", size: 5 });
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
});
