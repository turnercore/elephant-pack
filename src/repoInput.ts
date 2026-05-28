import type { RepoRef } from "./types";

export function parseRepoInput(input: string): RepoRef {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Enter a GitHub repository.");
  }

  const shorthand = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthand) {
    return { owner: shorthand[1], repo: stripGitSuffix(shorthand[2]) };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Use owner/repo or a GitHub repository URL.");
  }

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    throw new Error("Only github.com repository URLs are supported.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("GitHub URL must include owner and repo.");
  }

  return {
    owner: parts[0],
    repo: stripGitSuffix(parts[1])
  };
}

export function sanitizeRefForFilename(ref: string): string {
  return ref.trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "ref";
}

function stripGitSuffix(repo: string): string {
  return repo.replace(/\.git$/i, "");
}
