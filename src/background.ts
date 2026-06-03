import { buildMarkdownBundle } from "./bundleBuilder";
import { fetchRepoBranches, fetchRepoContextFiles, fetchRepoMetadata } from "./github";
import { parseRepoInput } from "./repoInput";
import type { BackgroundRequest, PopupDraftState, ProviderSettings, RepoProvider } from "./types";

const TOKEN_KEYS: Record<RepoProvider, string> = {
  github: "githubToken",
  forgejo: "forgejoToken"
};
const PROVIDER_SETTINGS_KEY = "providerSettings";
const DRAFT_STATE_KEY = "popupDraftState";
const DEFAULT_BUNDLE_PROFILE = "code_docs";
const DEFAULT_MAX_BYTES = 4_000_000;
const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = { provider: "github", forgejoBaseUrl: "https://forge.elephanthand.com" };

chrome.runtime.onMessage.addListener((request: unknown, _sender, sendResponse) => {
  void handleMessage(request).then(
    (response) => sendResponse({ ok: true, ...response }),
    (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
  );
  return true;
});

async function handleMessage(request: unknown): Promise<Record<string, unknown>> {
  if (!isBackgroundRequest(request)) {
    throw new Error("Invalid background request.");
  }

  switch (request.type) {
    case "GET_TOKEN_STATUS": {
      const [githubToken, forgejoToken] = await Promise.all([getToken("github"), getToken("forgejo")]);
      return { github: { hasToken: Boolean(githubToken) }, forgejo: { hasToken: Boolean(forgejoToken) } };
    }
    case "SAVE_TOKEN": {
      const token = request.token.trim();
      if (!token) throw new Error("Token cannot be empty.");
      await chrome.storage.local.set({ [TOKEN_KEYS[request.provider]]: token });
      return { hasToken: true };
    }
    case "CLEAR_TOKEN": {
      await chrome.storage.local.remove(TOKEN_KEYS[request.provider]);
      return { hasToken: false };
    }
    case "GET_PROVIDER_SETTINGS": {
      return { settings: await getProviderSettings() };
    }
    case "SAVE_PROVIDER_SETTINGS": {
      const settings = normalizeProviderSettings(request.settings);
      await chrome.storage.local.set({ [PROVIDER_SETTINGS_KEY]: settings });
      return { settings };
    }
    case "GET_DEFAULT_BRANCH": {
      const settings = await getProviderSettings();
      const repo = parseRepoInput(request.repoInput, settings);
      const metadata = await fetchRepoMetadata(repo, await getToken(settings.provider), settings);
      return { defaultBranch: metadata.defaultBranch, private: metadata.private, htmlUrl: metadata.htmlUrl };
    }
    case "LIST_BRANCHES": {
      const settings = await getProviderSettings();
      const repo = parseRepoInput(request.repoInput, settings);
      return { ...(await fetchRepoBranches(repo, await getToken(settings.provider), settings)) };
    }
    case "GET_DRAFT_STATE": {
      return { draft: await getDraftState() };
    }
    case "SAVE_DRAFT_STATE": {
      await chrome.storage.local.set({ [DRAFT_STATE_KEY]: request.draft });
      return { draft: request.draft };
    }
    case "BUILD_BUNDLE": {
      const settings = await getProviderSettings();
      const repo = parseRepoInput(request.payload.repoInput, settings);
      const token = await getToken(settings.provider);
      const metadata = await fetchRepoMetadata(repo, token, settings);
      const ref = request.payload.ref?.trim() || metadata.defaultBranch;
      const repoFiles = await fetchRepoContextFiles(repo, ref, token, request.payload.maxBytes, request.payload.bundleProfile, settings);
      const bundle = await buildMarkdownBundle({
        metadata,
        ref,
        files: repoFiles.files,
        inventory: repoFiles.inventory,
        maxBytes: request.payload.maxBytes,
        profile: request.payload.bundleProfile,
        includeLineNumbers: request.payload.includeLineNumbers,
        treePaths: repoFiles.treePaths,
        preSkipped: repoFiles.skipped,
        warnings: repoFiles.warnings,
        resolvedCommitSha: repoFiles.resolvedCommitSha,
        treeSha: repoFiles.treeSha,
        tokenStatus: repoFiles.tokenStatus
      });
      return { bundle };
    }
    default:
      throw new Error("Unknown background request.");
  }
}

function isBackgroundRequest(request: unknown): request is BackgroundRequest {
  return typeof request === "object" && request !== null && "type" in request && typeof request.type === "string";
}

async function getToken(provider: RepoProvider): Promise<string | undefined> {
  const result = await chrome.storage.local.get(TOKEN_KEYS[provider]);
  const token = result[TOKEN_KEYS[provider]];
  return typeof token === "string" && token.trim() ? token : undefined;
}

async function getProviderSettings(): Promise<ProviderSettings> {
  const result = await chrome.storage.local.get(PROVIDER_SETTINGS_KEY);
  return normalizeProviderSettings(result[PROVIDER_SETTINGS_KEY] as Partial<ProviderSettings> | undefined);
}

function normalizeProviderSettings(settings: Partial<ProviderSettings> | undefined): ProviderSettings {
  return {
    provider: settings?.provider === "forgejo" ? "forgejo" : "github",
    forgejoBaseUrl: typeof settings?.forgejoBaseUrl === "string" ? settings.forgejoBaseUrl.trim() : DEFAULT_PROVIDER_SETTINGS.forgejoBaseUrl
  };
}

async function getDraftState(): Promise<PopupDraftState> {
  const result = await chrome.storage.local.get(DRAFT_STATE_KEY);
  const draft = result[DRAFT_STATE_KEY] as Partial<PopupDraftState> | undefined;
  return {
    repoInput: draft?.repoInput ?? "",
    ref: draft?.ref ?? "",
    selectedBranch: draft?.selectedBranch ?? null,
    manualRefMode: draft?.manualRefMode ?? false,
    maxBytes: draft?.maxBytes ?? DEFAULT_MAX_BYTES,
    bundleProfile: draft?.bundleProfile ?? DEFAULT_BUNDLE_PROFILE,
    includeLineNumbers: draft?.includeLineNumbers ?? true,
    lastBundleId: draft?.lastBundleId,
    lastRepoMetadata: draft?.lastRepoMetadata
  };
}
