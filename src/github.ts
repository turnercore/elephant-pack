import { priorityForPath, shouldConsiderFile } from "./fileRules";
import type { ArchiveFile, GithubRepoMetadata, GitTreeFile, RepoFetchResult, RepoRef, SkippedFile } from "./types";

const GITHUB_API_VERSION = "2022-11-28";
const MAX_FETCHED_FILES = 180;
const NO_TOKEN_FETCHED_FILES = 45;
const FETCH_BUDGET_MULTIPLIER = 1.45;
const MIN_EXTRA_FETCH_BUDGET_BYTES = 250_000;
const BLOB_FETCH_CONCURRENCY = 6;

interface ResolvedCommit {
  sha: string;
  treeSha: string;
}

interface GitHubRepoCommitResponse {
  sha: string;
  html_url?: string;
  commit: {
    tree: { sha: string };
  };
}

interface GitHubGitCommitResponse {
  sha: string;
  tree: { sha: string };
}

interface GitHubTagResponse {
  object: {
    sha: string;
    type: string;
    url: string;
  };
}

interface GitHubTreeResponse {
  tree: Array<{
    path?: string;
    mode?: string;
    type?: string;
    sha?: string;
    size?: number;
    url?: string;
  }>;
  truncated?: boolean;
}

interface GitHubBlobResponse {
  content?: string;
  encoding?: string;
  size?: number;
}

interface GitHubRefResponse {
  object: {
    sha: string;
    type: string;
    url: string;
  };
}

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

export async function fetchRepoContextFiles(
  repo: RepoRef,
  ref: string,
  token: string | undefined,
  maxBundleBytes: number
): Promise<RepoFetchResult> {
  const commit = await fetchCommit(repo, ref, token);
  const tree = await fetchTree(repo, commit.treeSha, token);
  const allTreePaths = tree.tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path)
    .filter((path): path is string => Boolean(path))
    .sort((a, b) => a.localeCompare(b));

  const skipped: SkippedFile[] = [];
  const candidates: GitTreeFile[] = [];

  for (const entry of tree.tree) {
    if (entry.type !== "blob" || !entry.path || !entry.sha || !entry.url) continue;
    const size = entry.size ?? 0;
    const decision = shouldConsiderFile(entry.path, size);
    if (!decision.include) {
      skipped.push({ path: entry.path, reason: decision.reason ?? "excluded", size });
      continue;
    }
    candidates.push({ path: entry.path, size, sha: entry.sha, url: entry.url });
  }

  candidates.sort((a, b) => priorityForPath(a.path) - priorityForPath(b.path) || a.path.localeCompare(b.path));

  const maxFilesToFetch = token ? MAX_FETCHED_FILES : NO_TOKEN_FETCHED_FILES;
  const fetchBudgetBytes = Math.max(
    Math.floor(maxBundleBytes * FETCH_BUDGET_MULTIPLIER),
    maxBundleBytes + MIN_EXTRA_FETCH_BUDGET_BYTES
  );
  const selected: GitTreeFile[] = [];
  let selectedBytes = 0;

  for (const candidate of candidates) {
    if (selected.length >= maxFilesToFetch) {
      skipped.push({ path: candidate.path, reason: `not fetched: selected file count cap reached (${maxFilesToFetch})`, size: candidate.size });
      continue;
    }

    const important = priorityForPath(candidate.path) <= 20;
    const wouldExceedBudget = selectedBytes + candidate.size > fetchBudgetBytes;
    if (wouldExceedBudget && !important) {
      skipped.push({ path: candidate.path, reason: "not fetched: bundle byte budget reached", size: candidate.size });
      continue;
    }

    selected.push(candidate);
    selectedBytes += candidate.size;
  }

  const files = await mapLimit(selected, BLOB_FETCH_CONCURRENCY, async (file): Promise<ArchiveFile> => {
    try {
      const bytes = await fetchBlobBytes(file, token);
      return { path: file.path, size: bytes.byteLength, bytes };
    } catch (error) {
      throw new Error(`Failed to fetch ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const warnings: string[] = [];
  if (tree.truncated) {
    warnings.push("GitHub reported a truncated recursive tree. The bundle may not include every repository path.");
  }
  if (!token && candidates.length > NO_TOKEN_FETCHED_FILES) {
    warnings.push("No GitHub token is saved. Public API rate limits are low, so the build fetched fewer files. Save a fine-grained token for deeper bundles.");
  }
  if (candidates.length > selected.length) {
    warnings.push(`Selected ${selected.length} of ${candidates.length} candidate text files before size/rate-limit guards.`);
  }

  return {
    files,
    treePaths: allTreePaths,
    skipped,
    warnings,
    totalFileCount: allTreePaths.length,
    fetchedFileCount: files.length,
    treeTruncated: Boolean(tree.truncated)
  };
}

async function fetchCommit(repo: RepoRef, ref: string, token?: string): Promise<ResolvedCommit> {
  const normalizedRef = ref.trim();
  if (!normalizedRef) throw new Error("Branch, tag, or SHA cannot be empty.");

  try {
    const response = await githubFetch(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${pathEncodeRef(normalizedRef)}`,
      token
    );
    const data = (await response.json()) as GitHubRepoCommitResponse;
    return { sha: data.sha, treeSha: data.commit.tree.sha };
  } catch (error) {
    if (!normalizedRef.includes("/")) throw error;
    const refData = await fetchGitRef(repo, `heads/${normalizedRef}`, token).catch(() => fetchGitRef(repo, `tags/${normalizedRef}`, token));
    return resolveGitObjectToCommit(refData.object, token);
  }
}

async function resolveGitObjectToCommit(
  object: { sha: string; type: string; url: string },
  token?: string
): Promise<ResolvedCommit> {
  if (object.type === "commit") {
    const response = await githubFetch(object.url, token);
    const data = (await response.json()) as GitHubGitCommitResponse;
    return { sha: data.sha, treeSha: data.tree.sha };
  }

  if (object.type === "tag") {
    const response = await githubFetch(object.url, token);
    const data = (await response.json()) as GitHubTagResponse;
    return resolveGitObjectToCommit(data.object, token);
  }

  throw new Error(`Could not resolve GitHub object type "${object.type}" to a commit.`);
}

async function fetchGitRef(repo: RepoRef, ref: string, token?: string): Promise<GitHubRefResponse> {
  const response = await githubFetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/git/ref/${pathEncodeRef(ref)}`, token);
  return (await response.json()) as GitHubRefResponse;
}

async function fetchTree(repo: RepoRef, treeSha: string, token?: string): Promise<GitHubTreeResponse> {
  const response = await githubFetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
    token
  );
  return (await response.json()) as GitHubTreeResponse;
}

async function fetchBlobBytes(file: GitTreeFile, token?: string): Promise<Uint8Array> {
  const response = await githubFetch(file.url, token);
  const data = (await response.json()) as GitHubBlobResponse;

  if (data.encoding !== "base64" || typeof data.content !== "string") {
    throw new Error(`GitHub returned unsupported blob encoding for ${file.path}.`);
  }

  return base64ToUint8Array(data.content);
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
    const data = (await response.json()) as { message?: string; documentation_url?: string };
    detail = data.message ? `: ${data.message}` : "";
  } catch {
    detail = "";
  }

  const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
  if (response.status === 403 && rateLimitRemaining === "0") {
    return "GitHub API rate limit reached. Save a fine-grained token with Contents: read, then try again.";
  }
  if (response.status === 401) {
    return "GitHub authentication failed. Check that the saved PAT is valid and has Contents: read access.";
  }
  if (response.status === 404) {
    return `GitHub request failed (404)${detail}. Check the repo, ref, and token repository access.`;
  }

  return `GitHub request failed (${response.status})${detail}`;
}

function pathEncodeRef(ref: string): string {
  return ref
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function base64ToUint8Array(value: string): Uint8Array {
  const compact = value.replace(/\s/g, "");
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(compact);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  return Uint8Array.from(Buffer.from(compact, "base64"));
}

async function mapLimit<T, U>(items: T[], limit: number, mapper: (item: T) => Promise<U>): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
