import { describe, expect, it } from "vitest";
import { parseRepoInput, sanitizeRefForFilename } from "./repoInput";

describe("parseRepoInput", () => {
  it("parses owner/repo shorthand", () => {
    expect(parseRepoInput("openai/codex")).toEqual({ owner: "openai", repo: "codex" });
  });

  it("parses GitHub URLs and strips .git", () => {
    expect(parseRepoInput("https://github.com/openai/codex.git")).toEqual({ owner: "openai", repo: "codex" });
  });

  it("parses Forgejo URLs for the configured instance", () => {
    expect(parseRepoInput("https://forge.example.com/owner/demo.git", { provider: "forgejo", forgejoBaseUrl: "https://forge.example.com" })).toEqual({
      owner: "owner",
      repo: "demo"
    });
  });

  it("rejects non-GitHub URLs", () => {
    expect(() => parseRepoInput("https://example.com/openai/codex")).toThrow("Only github.com");
  });

  it("rejects URLs from a different Forgejo instance", () => {
    expect(() => parseRepoInput("https://other.example.com/owner/demo", { provider: "forgejo", forgejoBaseUrl: "https://forge.example.com" })).toThrow(
      "Only forge.example.com"
    );
  });
});

describe("sanitizeRefForFilename", () => {
  it("keeps filenames stable", () => {
    expect(sanitizeRefForFilename("feature/review context")).toBe("feature-review-context");
  });
});
