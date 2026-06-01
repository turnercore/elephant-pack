import { describe, expect, it } from "vitest";
import { buildMarkdownBundle } from "./bundleBuilder";
import type { ArchiveFile, GithubRepoMetadata } from "./types";

const metadata: GithubRepoMetadata = {
  owner: "turnercore",
  repo: "demo",
  defaultBranch: "main",
  htmlUrl: "https://github.com/turnercore/demo",
  private: true
};

const encoder = new TextEncoder();

function file(path: string, content: string): ArchiveFile {
  const bytes = encoder.encode(content);
  return { path, size: bytes.byteLength, bytes };
}

describe("buildMarkdownBundle", () => {
  it("includes source content and skips vendor/build noise", async () => {
    const result = await buildMarkdownBundle({
      metadata,
      ref: "feature/test",
      maxBytes: 100_000,
      generatedAt: "2026-05-28T12:00:00.000Z",
      files: [
        file("README.md", "# Demo"),
        file("src/app.ts", "export const value = 1;"),
        file("node_modules/pkg/index.js", "noise"),
        file("dist/app.js", "built")
      ]
    });

    expect(result.filename).toBe("turnercore-demo-feature-test-code_docs-chatgpt-context.md");
    expect(result.content).toContain("## File: README.md");
    expect(result.content).toContain("## File: src/app.ts");
    expect(result.content).toContain("node_modules/pkg/index.js");
    expect(result.content).toContain("vendor/dependency directory");
    expect(result.includedCount).toBe(2);
    expect(result.skippedCount).toBe(2);
  });

  it("records files skipped by bundle cap", async () => {
    const result = await buildMarkdownBundle({
      metadata,
      ref: "main",
      maxBytes: 700,
      generatedAt: "2026-05-28T12:00:00.000Z",
      files: [file("src/large.ts", "x".repeat(1200))]
    });

    expect(result.content).toContain("bundle size cap reached");
    expect(result.includedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
  });

  it("escapes nested markdown fences in source files", async () => {
    const result = await buildMarkdownBundle({
      metadata,
      ref: "main",
      maxBytes: 100_000,
      generatedAt: "2026-05-28T12:00:00.000Z",
      files: [file("README.md", "Example\n```ts\nconst value = 1;\n```")]
    });

    expect(result.content).toContain("``\\`ts");
  });
});
