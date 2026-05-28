import JSZip from "jszip";
import type { ArchiveFile, GithubRepoMetadata, RepoRef } from "./types";

const GITHUB_API_VERSION = "2022-11-28";

export async function fetchRepoMetadata(repo: RepoRef, token?: string): Promise<GithubRepoMetadata> {
  const response = await githubFetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, token);
  const data = (await response.json()) as {
    name: string;
    full_name: string;
    default_branch: string;
    html_url: string;
    private: boolean;
    owner: { login: string };
  };

  return {
    owner: data.owner.login,
    repo: data.name,
    defaultBranch: data.default_branch,
    htmlUrl: data.html_url,
    private: data.private
  };
}

export async function fetchRepoArchiveFiles(repo: RepoRef, ref: string, token?: string): Promise<ArchiveFile[]> {
  const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/zipball/${encodeURIComponent(ref)}`;
  const response = await githubFetch(url, token);
  const buffer = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const files: ArchiveFile[] = [];
  const rootPrefix = commonRootPrefix(Object.keys(zip.files));

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const path = stripRootPrefix(entry.name, rootPrefix);
    if (!path) continue;
    const bytes = await entry.async("uint8array");
    files.push({ path, size: bytes.byteLength, bytes });
  }

  return files;
}

async function githubFetch(url: string, token?: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) {
    const message = await errorMessage(response);
    throw new Error(message);
  }
  return response;
}

async function errorMessage(response: Response): Promise<string> {
  let detail = "";
  try {
    const data = (await response.json()) as { message?: string };
    detail = data.message ? `: ${data.message}` : "";
  } catch {
    detail = "";
  }
  return `GitHub request failed (${response.status})${detail}`;
}

function commonRootPrefix(paths: string[]): string {
  const first = paths.find((path) => path.includes("/"));
  if (!first) return "";
  return first.slice(0, first.indexOf("/") + 1);
}

function stripRootPrefix(path: string, rootPrefix: string): string {
  return rootPrefix && path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : path;
}
