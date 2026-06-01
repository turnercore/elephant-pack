export interface RepoRef {
  owner: string;
  repo: string;
}

export type RepoProvider = "github" | "forgejo";

export interface ProviderSettings {
  provider: RepoProvider;
  forgejoBaseUrl: string;
}

export interface GithubRepoMetadata {
  owner: string;
  repo: string;
  defaultBranch: string;
  htmlUrl: string;
  private: boolean;
}

export type BundleProfile = "map_only" | "core_code" | "code_docs" | "all_useful_text" | "all_safe_text_hidden" | "forensic_inventory";

export const DEFAULT_BUNDLE_PROFILE: BundleProfile = "code_docs";
export const DEFAULT_MAX_BYTES = 4_000_000;

export interface PopupDraftState {
  repoInput: string;
  ref: string;
  selectedBranch: string | null;
  manualRefMode: boolean;
  maxBytes: number;
  bundleProfile: BundleProfile;
  includeLineNumbers: boolean;
  lastBundleId?: string;
  lastRepoMetadata?: {
    owner: string;
    repo: string;
    defaultBranch: string;
    htmlUrl: string;
    private: boolean;
    fetchedAt: string;
  };
}

export interface GitTreeFile {
  path: string;
  size: number;
  sha: string;
  url: string;
  mode?: string;
}

export interface ArchiveFile {
  path: string;
  size: number;
  bytes: Uint8Array;
  gitBlobSha?: string;
}

export interface BuildBundleRequest {
  repoInput: string;
  ref?: string;
  maxBytes: number;
  bundleProfile: BundleProfile;
  includeLineNumbers: boolean;
}

export interface BundleResult {
  filename: string;
  content: string;
  owner: string;
  repo: string;
  ref: string;
  generatedAt: string;
  includedCount: number;
  skippedCount: number;
  bytes: number;
  estimatedTokens: number;
  warnings: string[];
  bundleId: string;
  profile: BundleProfile;
}

export interface SkippedFile {
  path: string;
  reason: string;
  size?: number;
}

export interface IncludedFile {
  path: string;
  size: number;
  content: string;
  truncated: boolean;
}

export interface BranchListResult {
  defaultBranch: string;
  branches: Array<{
    name: string;
    commitSha: string;
    protected?: boolean;
  }>;
  tags: Array<{
    name: string;
    commitSha: string;
  }>;
}

export type FileCategory =
  | "source"
  | "test"
  | "docs"
  | "manifest"
  | "config"
  | "script"
  | "asset_text"
  | "binary"
  | "generated"
  | "vendor"
  | "secret"
  | "build_output"
  | "unknown";

export interface FileClassification {
  path: string;
  include: boolean;
  includeAs: "content" | "metadata_only" | "skip";
  category: FileCategory;
  language: string | null;
  extension: string | null;
  priority: number;
  reason: string;
  eligibleProfiles: BundleProfile[];
  isHidden: boolean;
  isBinaryLikely: boolean;
  isGeneratedLikely: boolean;
  isVendorLikely: boolean;
  isSecretLikely: boolean;
  isEngineArtifactLikely: boolean;
}

export interface FileInventoryEntry {
  path: string;
  kind: "file" | "directory" | "submodule" | "symlink";
  extension: string | null;
  basename: string;
  language: string | null;
  sizeBytes: number | null;
  lineCount?: number;
  gitBlobSha?: string;
  mode?: string;
  isHidden: boolean;
  isBinaryLikely: boolean;
  isGeneratedLikely: boolean;
  isVendorLikely: boolean;
  isSecretLikely: boolean;
  isEngineArtifactLikely: boolean;
  includeDecision: "included" | "metadata_only" | "skipped";
  includeReason: string;
  skipReason?: string;
  priorityScore: number;
  truncated?: boolean;
  contentSha256?: string;
}

export interface BundleManifest {
  schemaVersion: "1.0.0";
  repo: string;
  sourceUrl: string;
  ref: string;
  defaultBranch: string;
  resolvedCommitSha: string;
  treeSha: string;
  generatedAt: string;
  private: boolean;
  tokenStatus: "authenticated" | "anonymous";
  profile: BundleProfile;
  maxBytes: number;
  includeLineNumbers: boolean;
  files: FileInventoryEntry[];
  includedFiles: FileInventoryEntry[];
  omittedFiles: FileInventoryEntry[];
  security: {
    secretLikeFilesOmitted: number;
    binaryFilesOmitted: number;
    tokenIncludedInBundle: false;
  };
}

export interface RepoFetchResult {
  files: ArchiveFile[];
  treePaths: string[];
  inventory: FileInventoryEntry[];
  skipped: SkippedFile[];
  warnings: string[];
  totalFileCount: number;
  fetchedFileCount: number;
  treeTruncated: boolean;
  resolvedCommitSha: string;
  treeSha: string;
  tokenStatus: "authenticated" | "anonymous";
}

export type BackgroundRequest =
  | { type: "GET_TOKEN_STATUS" }
  | { type: "SAVE_TOKEN"; provider: RepoProvider; token: string }
  | { type: "CLEAR_TOKEN"; provider: RepoProvider }
  | { type: "GET_PROVIDER_SETTINGS" }
  | { type: "SAVE_PROVIDER_SETTINGS"; settings: ProviderSettings }
  | { type: "GET_DEFAULT_BRANCH"; repoInput: string }
  | { type: "LIST_BRANCHES"; repoInput: string }
  | { type: "GET_DRAFT_STATE" }
  | { type: "SAVE_DRAFT_STATE"; draft: PopupDraftState }
  | { type: "BUILD_BUNDLE"; payload: BuildBundleRequest };

export type UploadRequest = {
  type: "ATTACH_REPO_BUNDLE";
  filename: string;
  content: string;
};
