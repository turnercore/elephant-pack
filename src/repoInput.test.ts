import { describe, expect, it } from "vitest";
import { parseRepoInput, sanitizeRefForFilename } from "./repoInput";

describe("parseRepoInput", () => {
  it("parses owner/repo shorthand", () => {
    expect(parseRepoInput("openai/codex")).toEqual({ owner: "openai", repo: "codex" });
  });

  it("parses GitHub URLs and strips .git", () => {
    expect(parseRepoInput("https://github.com/openai/codex.git")).toEqual({ owner: "openai", repo: "codex" });
  });

  it("rejects non-GitHub URLs", () => {
    expect(() => parseRepoInput("https://example.com/openai/codex")).toThrow("Only github.com");
  });
});

describe("sanitizeRefForFilename", () => {
  it("keeps filenames stable", () => {
    expect(sanitizeRefForFilename("feature/review context")).toBe("feature-review-context");
  });
});
