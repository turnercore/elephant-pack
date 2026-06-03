import { classifyPath, extensionForPath, languageForPath, priorityForPath, shouldIncludeForProfile } from "./fileRules";
import type {
  ArchiveFile,
  BranchListResult,
  BundleProfile,
  FileInventoryEntry,
  GithubRepoMetadata,
  GitTreeFile,
  ProviderSettings,
  RepoFetchResult,
  RepoRef,
  SkippedFile
} from "./types";
import { normalizeForgejoBaseUrl } from "./repoInput";

const GITHUB_API_VERSION = "2022-11-28";
const DEFAULT_BUNDLE_PROFILE: BundleProfile = "code_docs";
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
  commit?: {
    tree: { sha: string };
  };
  tree?: { sha: string };
}

interface GitHubGitCommitResponse {
  sha: string;
  tree?: { sha: string };
  commit?: {
    tree: { sha: string };
  };
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

interface GitHubBranchResponse {
  name: string;
  protected?: boolean;
  commit: {
    sha: string;
  };
}

interface GitHubTagListResponse {
  name: string;
  commit: {
    sha: string;
  };
}

interface GitHubRefResponse {
  ref?: string;
  object: {
    sha: string;
    type: string;
    url?: string;
  };
}

export async function fetchRepoMetadata(repo: RepoRef, token?: string, settings: ProviderSettings = defaultProviderSettings()): Promise<GithubRepoMetadata> {
  const api = apiContext(settings);
  const response = await providerFetch(`${api.base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`, token, api);
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

export async function fetchRepoBranches(repo: RepoRef, token?: string, settings: ProviderSettings = defaultProviderSettings()): Promise<BranchListResult> {
  const api = apiContext(settings);
  const [metadata, branchesResponse, tagsResponse] = await Promise.all([
    fetchRepoMetadata(repo, token, settings),
    providerFetch(`${api.base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/branches?limit=100&per_page=100`, token, api),
    providerFetch(`${api.base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/tags?limit=100&per_page=100`, token, api)
  ]);
  const branches = (await branchesResponse.json()) as GitHubBranchResponse[];
  const tags = (await tagsResponse.json()) as GitHubTagListResponse[];

  return {
    defaultBranch: metadata.defaultBranch,
    branches: branches.map((branch) => ({
      name: branch.name,
      commitSha: branch.commit.sha,
      protected: branch.protected
    })),
    tags: tags.map((tag) => ({
      name: tag.name,
      commitSha: tag.commit.sha
    }))
  };
}

export async function fetchRepoContextFiles(
  repo: RepoRef,
  ref: string,
  token: string | undefined,
  maxBundleBytes: number,
  profile: BundleProfile = DEFAULT_BUNDLE_PROFILE,
  settings: ProviderSettings = defaultProviderSettings()
): Promise<RepoFetchResult> {
  const api = apiContext(settings);
  const commit = await fetchCommit(repo, ref, token, api);
  const tree = await fetchTree(repo, commit.treeSha, token, api);
  const allTreePaths = tree.tree
    .map((entry) => entry.path)
    .filter((path): path is string => Boolean(path))
    .sort((a, b) => a.localeCompare(b));

  const skipped: SkippedFile[] = [];
  const candidates: GitTreeFile[] = [];
  const inventory = buildInitialInventory(tree);

  for (const entry of tree.tree) {
    if (entry.type !== "blob" || !entry.path || !entry.sha) continue;
    const size = entry.size ?? 0;
    const classification = classifyPath(entry.path, size);
    if (!shouldIncludeForProfile(classification, profile)) {
      skipped.push({ path: entry.path, reason: profile === "map_only" && classification.includeAs === "content" ? "map only profile selected" : classification.reason, size });
      continue;
    }
    candidates.push({
      path: entry.path,
      size,
      sha: entry.sha,
      url: entry.url ?? `${api.base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/blobs/${encodeURIComponent(entry.sha)}`,
      mode: entry.mode
    });
  }

  candidates.sort((a, b) => priorityForPath(a.path) - priorityForPath(b.path) || a.path.localeCompare(b.path));

  const maxFilesToFetch = token ? MAX_FETCHED_FILES : NO_TOKEN_FETCHED_FILES;
  const fetchBudgetBytes = Math.max(
    Math.floor(maxBundleBytes * FETCH_BUDGET_MULTIPLIER),
    maxBundleBytes + MIN_EXTRA_FETCH_BUDGET_BYTES
  );
  const selected: GitTreeFile[] = [];
  let selectedBytes = 0;

  for (const candidate of profile === "map_only" ? [] : candidates) {
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
      const bytes = await fetchBlobBytes(file, token, api);
      return { path: file.path, size: bytes.byteLength, bytes, gitBlobSha: file.sha };
    } catch (error) {
      throw new Error(`Failed to fetch ${file.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const warnings: string[] = [];
  if (tree.truncated) {
    warnings.push(`${api.label} reported a truncated recursive tree. The bundle may not include every repository path.`);
  }
  if (!token && candidates.length > NO_TOKEN_FETCHED_FILES) {
    warnings.push(`No ${api.label} token is saved. Public API rate limits may be low, so the build fetched fewer files. Save a read-only token for deeper bundles.`);
  }
  if (profile === "map_only") {
    warnings.push("Map only profile selected. File bodies were not downloaded.");
  }
  if (candidates.length > selected.length) {
    warnings.push(`Selected ${selected.length} of ${candidates.length} candidate text files before size/rate-limit guards.`);
  }

  return {
    files,
    treePaths: allTreePaths,
    inventory,
    skipped,
    warnings,
    totalFileCount: allTreePaths.length,
    fetchedFileCount: files.length,
    treeTruncated: Boolean(tree.truncated),
    resolvedCommitSha: commit.sha,
    treeSha: commit.treeSha,
    tokenStatus: token ? "authenticated" : "anonymous"
  };
}

async function fetchCommit(repo: RepoRef, ref: string, token: string | undefined, api: ApiContext): Promise<ResolvedCommit> {
  const normalizedRef = ref.trim();
  if (!normalizedRef) throw new Error("Branch, tag, or SHA cannot be empty.");

  if (api.provider === "forgejo") {
    const refData = await fetchGitRef(repo, `heads/${normalizedRef}`, token, api).catch(() => fetchGitRef(repo, `tags/${normalizedRef}`, token, api).catch(() => null));
    if (refData) return resolveGitObjectToCommit(refData.object, repo, token, api);
    const response = await providerFetch(
      `${api.base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/commits/${pathEncodeRef(normalizedRef)}`,
      token,
      api
    );
    const data = (await response.json()) as GitHubGitCommitResponse;
    return commitResponseToResolved(data, api);
  }

  try {
    const response = await providerFetch(
      `${api.base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/commits/${pathEncodeRef(normalizedRef)}`,
      token,
      api
    );
    const data = (await response.json()) as GitHubRepoCommitResponse;
    return commitResponseToResolved(data, api);
  } catch (error) {
    if (!normalizedRef.includes("/")) throw error;
    const refData = await fetchGitRef(repo, `heads/${normalizedRef}`, token, api).catch(() => fetchGitRef(repo, `tags/${normalizedRef}`, token, api));
    return resolveGitObjectToCommit(refData.object, repo, token, api);
  }
}

async function resolveGitObjectToCommit(
  object: { sha: string; type: string; url?: string },
  repo: RepoRef,
  token: string | undefined,
  api: ApiContext
): Promise<ResolvedCommit> {
  if (object.type === "commit") {
    const commitUrl = object.url ?? `${api.base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/commits/${encodeURIComponent(object.sha)}`;
    const response = await providerFetch(resolveApiUrl(commitUrl, api), token, api);
    const data = (await response.json()) as GitHubGitCommitResponse;
    return commitResponseToResolved(data, api);
  }

  if (object.type === "tag") {
    const tagUrl = object.url ?? `${api.base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/tags/${encodeURIComponent(object.sha)}`;
    const response = await providerFetch(resolveApiUrl(tagUrl, api), token, api);
    const data = (await response.json()) as GitHubTagResponse;
    return resolveGitObjectToCommit(data.object, repo, token, api);
  }

  throw new Error(`Could not resolve ${api.label} object type "${object.type}" to a commit.`);
}

function commitResponseToResolved(data: GitHubRepoCommitResponse | GitHubGitCommitResponse, api: ApiContext): ResolvedCommit {
  const treeSha = data.tree?.sha ?? data.commit?.tree?.sha;
  if (!treeSha) throw new Error(`${api.label} commit response did not include a tree SHA.`);
  return { sha: data.sha, treeSha };
}

async function fetchGitRef(repo: RepoRef, ref: string, token: string | undefined, api: ApiContext): Promise<GitHubRefResponse> {
  const refPath = api.provider === "forgejo" ? "git/refs" : "git/ref";
  const response = await providerFetch(`${api.base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/${refPath}/${pathEncodeRef(ref)}`, token, api);
  return normalizeGitRefResponse(await response.json(), ref, api);
}

function normalizeGitRefResponse(data: unknown, requestedRef: string, api: ApiContext): GitHubRefResponse {
  const response = Array.isArray(data)
    ? data.find((entry) => isGitRefResponse(entry) && entry.ref === `refs/${requestedRef}`) ?? data.find(isGitRefResponse)
    : data;

  if (!isGitRefResponse(response)) {
    throw new Error(`${api.label} ref response did not include a commit or tag object for ${requestedRef}.`);
  }

  return response;
}

function isGitRefResponse(value: unknown): value is GitHubRefResponse {
  if (typeof value !== "object" || value === null || !("object" in value)) return false;
  const object = (value as { object?: unknown }).object;
  if (typeof object !== "object" || object === null) return false;
  const candidate = object as { sha?: unknown; type?: unknown; url?: unknown };
  return typeof candidate.sha === "string" && typeof candidate.type === "string" && (candidate.url === undefined || typeof candidate.url === "string");
}

async function fetchTree(repo: RepoRef, treeSha: string, token: string | undefined, api: ApiContext): Promise<GitHubTreeResponse> {
  const response = await providerFetch(
    `${api.base}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/git/trees/${encodeURIComponent(treeSha)}?recursive=true&per_page=1000`,
    token,
    api
  );
  return (await response.json()) as GitHubTreeResponse;
}

function buildInitialInventory(tree: GitHubTreeResponse): FileInventoryEntry[] {
  return tree.tree
    .filter((entry) => Boolean(entry.path))
    .map((entry): FileInventoryEntry => {
      const path = entry.path ?? "";
      const kind = entry.type === "tree" ? "directory" : entry.type === "commit" ? "submodule" : entry.type === "blob" && entry.mode === "120000" ? "symlink" : "file";
      const size = entry.size ?? null;
      const classification = kind === "file" ? classifyPath(path, size ?? 0) : null;
      const basename = path.split("/").pop() ?? path;
      const decision = classification?.includeAs === "content" ? "metadata_only" : classification?.includeAs === "skip" ? "skipped" : "metadata_only";
      return {
        path,
        kind,
        extension: kind === "file" ? extensionForPath(path) : null,
        basename,
        language: kind === "file" ? languageForPath(path) : null,
        sizeBytes: size,
        gitBlobSha: entry.sha,
        mode: entry.mode,
        isHidden: classification?.isHidden ?? path.split("/").some((segment) => segment.startsWith(".")),
        isBinaryLikely: classification?.isBinaryLikely ?? false,
        isGeneratedLikely: classification?.isGeneratedLikely ?? false,
        isVendorLikely: classification?.isVendorLikely ?? false,
        isSecretLikely: classification?.isSecretLikely ?? false,
        isEngineArtifactLikely: classification?.isEngineArtifactLikely ?? false,
        includeDecision: decision,
        includeReason: classification?.reason ?? (kind === "directory" ? "directory" : "metadata only"),
        skipReason: decision === "skipped" ? classification?.reason : undefined,
        priorityScore: classification?.priority ?? 999
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function fetchBlobBytes(file: GitTreeFile, token: string | undefined, api: ApiContext): Promise<Uint8Array> {
  const response = await providerFetch(resolveApiUrl(file.url, api), token, api);
  const data = (await response.json()) as GitHubBlobResponse;

  if (data.encoding !== "base64" || typeof data.content !== "string") {
    throw new Error(`${api.label} returned unsupported blob encoding for ${file.path}.`);
  }

  return base64ToUint8Array(data.content);
}

interface ApiContext {
  provider: ProviderSettings["provider"];
  label: string;
  base: string;
  authScheme: "bearer" | "token";
}

function defaultProviderSettings(): ProviderSettings {
  return { provider: "github", forgejoBaseUrl: "https://forge.elephanthand.com" };
}

function apiContext(settings: ProviderSettings): ApiContext {
  if (settings.provider === "forgejo") {
    const baseUrl = normalizeForgejoBaseUrl(settings.forgejoBaseUrl);
    const apiBase = new URL(`${baseUrl.pathname.replace(/\/+$/, "")}/api/v1`, baseUrl);
    return {
      provider: "forgejo",
      label: "Forgejo",
      base: apiBase.toString().replace(/\/+$/, ""),
      authScheme: "token"
    };
  }
  return {
    provider: "github",
    label: "GitHub",
    base: "https://api.github.com",
    authScheme: "bearer"
  };
}

function resolveApiUrl(url: string, api: ApiContext): string {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(url)) return url;
  return new URL(url, `${api.base}/`).toString();
}

async function providerFetch(url: string, token: string | undefined, api: ApiContext): Promise<Response> {
  const requestUrl = api.provider === "forgejo" && token ? withAccessToken(url, token) : url;
  const headers: Record<string, string> = {
    Accept: "application/json"
  };

  if (api.provider === "github") {
    headers.Accept = "application/vnd.github+json";
    headers["X-GitHub-Api-Version"] = GITHUB_API_VERSION;
  }

  if (token && api.provider !== "forgejo") {
    headers.Authorization = api.authScheme === "token" ? `token ${token}` : `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(requestUrl, { headers, redirect: "follow" });
  } catch (error) {
    throw new Error(fetchFailureMessage(error, requestUrl, api));
  }
  if (!response.ok) {
    const message = await errorMessage(response, api.label);
    throw new Error(message);
  }
  return response;
}

function withAccessToken(url: string, token: string): string {
  const requestUrl = new URL(url);
  requestUrl.searchParams.set("access_token", token);
  return requestUrl.toString();
}

function fetchFailureMessage(error: unknown, url: string, api: ApiContext): string {
  const message = error instanceof Error ? error.message : String(error);
  if (api.provider === "forgejo" && /load failed|failed to fetch|network/i.test(message)) {
    const origin = new URL(url).origin;
    return `Forgejo request could not be loaded. In Safari, open Safari Settings > Extensions > Elephant Pack and allow site access for ${origin}. Also confirm a Forgejo token is saved in Elephant Pack settings for private repos.`;
  }
  return `${api.label} request could not be loaded: ${message}`;
}

async function errorMessage(response: Response, label: string): Promise<string> {
  let detail = "";
  try {
    const data = (await response.json()) as { message?: string; documentation_url?: string };
    detail = data.message ? `: ${data.message}` : "";
  } catch {
    detail = "";
  }

  const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
  if (response.status === 403 && rateLimitRemaining === "0") {
    return `${label} API rate limit reached. Save a read-only token, then try again.`;
  }
  if (response.status === 401) {
    return `${label} authentication failed. Check that the saved token is valid and has repository read access.`;
  }
  if (response.status === 404) {
    return `${label} request failed (404)${detail}. Check the repo, ref, and token repository access.`;
  }

  return `${label} request failed (${response.status})${detail}`;
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
