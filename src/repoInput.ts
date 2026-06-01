import type { ProviderSettings, RepoRef } from "./types";

export function parseRepoInput(input: string, settings: ProviderSettings = { provider: "github", forgejoBaseUrl: "" }): RepoRef {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error(`Enter a ${providerLabel(settings)} repository.`);
  }

  const shorthand = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthand) {
    return { owner: shorthand[1], repo: stripGitSuffix(shorthand[2]) };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Use owner/repo or a ${providerLabel(settings)} repository URL.`);
  }

  if (settings.provider === "github") {
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      throw new Error("Only github.com repository URLs are supported while GitHub is selected.");
    }
  } else {
    const baseUrl = normalizeForgejoBaseUrl(settings.forgejoBaseUrl);
    if (url.origin !== baseUrl.origin) {
      throw new Error(`Only ${baseUrl.host} repository URLs are supported while Forgejo is selected.`);
    }
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`${providerLabel(settings)} URL must include owner and repo.`);
  }

  return {
    owner: parts[0],
    repo: stripGitSuffix(parts[1])
  };
}

export function sanitizeRefForFilename(ref: string): string {
  return ref.trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "ref";
}

export function normalizeForgejoBaseUrl(input: string): URL {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Enter a Forgejo instance URL in Settings.");
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Forgejo instance URL must use https, localhost, or 127.0.0.1.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

export function providerLabel(settings: ProviderSettings): string {
  return settings.provider === "forgejo" ? "Forgejo" : "GitHub";
}

function stripGitSuffix(repo: string): string {
  return repo.replace(/\.git$/i, "");
}
