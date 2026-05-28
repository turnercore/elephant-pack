export interface RepoRef {
  owner: string;
  repo: string;
}

export interface GithubRepoMetadata {
  owner: string;
  repo: string;
  defaultBranch: string;
  htmlUrl: string;
  private: boolean;
}

export interface ArchiveFile {
  path: string;
  size: number;
  bytes: Uint8Array;
}

export interface BuildBundleRequest {
  repoInput: string;
  ref?: string;
  maxBytes: number;
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

export type BackgroundRequest =
  | { type: "GET_TOKEN_STATUS" }
  | { type: "SAVE_TOKEN"; token: string }
  | { type: "CLEAR_TOKEN" }
  | { type: "GET_DEFAULT_BRANCH"; repoInput: string }
  | { type: "BUILD_BUNDLE"; payload: BuildBundleRequest };

export type UploadRequest = {
  type: "ATTACH_REPO_BUNDLE";
  filename: string;
  content: string;
};
