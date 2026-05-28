import { buildMarkdownBundle } from "./bundleBuilder";
import { fetchRepoContextFiles, fetchRepoMetadata } from "./github";
import { parseRepoInput } from "./repoInput";
import type { BackgroundRequest } from "./types";

const TOKEN_KEY = "githubToken";

chrome.runtime.onMessage.addListener((request: BackgroundRequest, _sender, sendResponse) => {
  void handleMessage(request).then(
    (response) => sendResponse({ ok: true, ...response }),
    (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
  );
  return true;
});

async function handleMessage(request: BackgroundRequest): Promise<Record<string, unknown>> {
  switch (request.type) {
    case "GET_TOKEN_STATUS": {
      const token = await getToken();
      return { hasToken: Boolean(token) };
    }
    case "SAVE_TOKEN": {
      const token = request.token.trim();
      if (!token) throw new Error("Token cannot be empty.");
      await chrome.storage.local.set({ [TOKEN_KEY]: token });
      return { hasToken: true };
    }
    case "CLEAR_TOKEN": {
      await chrome.storage.local.remove(TOKEN_KEY);
      return { hasToken: false };
    }
    case "GET_DEFAULT_BRANCH": {
      const repo = parseRepoInput(request.repoInput);
      const metadata = await fetchRepoMetadata(repo, await getToken());
      return { defaultBranch: metadata.defaultBranch, private: metadata.private, htmlUrl: metadata.htmlUrl };
    }
    case "BUILD_BUNDLE": {
      const repo = parseRepoInput(request.payload.repoInput);
      const token = await getToken();
      const metadata = await fetchRepoMetadata(repo, token);
      const ref = request.payload.ref?.trim() || metadata.defaultBranch;
      const repoFiles = await fetchRepoContextFiles(repo, ref, token, request.payload.maxBytes);
      const bundle = buildMarkdownBundle({
        metadata,
        ref,
        files: repoFiles.files,
        maxBytes: request.payload.maxBytes,
        treePaths: repoFiles.treePaths,
        preSkipped: repoFiles.skipped,
        warnings: repoFiles.warnings
      });
      return { bundle };
    }
    default:
      throw new Error("Unknown background request.");
  }
}

async function getToken(): Promise<string | undefined> {
  const result = await chrome.storage.local.get(TOKEN_KEY);
  const token = result[TOKEN_KEY];
  return typeof token === "string" && token.trim() ? token : undefined;
}
