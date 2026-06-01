import {
  type BackgroundRequest,
  type BranchListResult,
  type BundleProfile,
  type BundleResult,
  type PopupDraftState,
  type ProviderSettings,
  type RepoProvider
} from "./types";
import "./styles.css";

type BackgroundResponse<T> = T & { ok: boolean; error?: string };
type UploadResponse = { ok?: boolean; error?: string };
type CachedBundle = BundleResult & { content: string };
type ChromeCallback = typeof chrome & {
  runtime: typeof chrome.runtime & { lastError?: { message?: string } };
};

const DEFAULT_BUNDLE_PROFILE: BundleProfile = "code_docs";
const DEFAULT_MAX_BYTES = 4_000_000;

const mainView = getElement("mainView");
const settingsView = getElement("settingsView");
const providerSubtitle = getElement("providerSubtitle");
const settingsButton = getButton("settingsButton");
const settingsBackButton = getButton("settingsBackButton");
const providerGithubButton = getButton("providerGithub");
const providerForgejoButton = getButton("providerForgejo");
const githubTokenInput = getInput("githubToken");
const forgejoTokenInput = getInput("forgejoToken");
const forgejoBaseUrlInput = getInput("forgejoBaseUrl");
const repoInput = getInput("repo");
const refInput = getInput("ref");
const branchSelect = getSelect("branch");
const maxBytesSelect = getSelect("maxBytes");
const bundleProfileSelect = getSelect("bundleProfile");
const includeLineNumbersInput = getInput("includeLineNumbers");
const githubTokenStatus = getElement("githubTokenStatus");
const githubTokenEditor = getElement("githubTokenEditor");
const githubTokenSavedActions = getElement("githubTokenSavedActions");
const forgejoTokenStatus = getElement("forgejoTokenStatus");
const forgejoTokenEditor = getElement("forgejoTokenEditor");
const forgejoTokenSavedActions = getElement("forgejoTokenSavedActions");
const branchSelectWrap = getElement("branchSelectWrap");
const manualRefWrap = getElement("manualRefWrap");
const statusOutput = getElement("status");
const bundleSummary = getElement("bundleSummary");
const saveGithubTokenButton = getButton("saveGithubToken");
const replaceGithubTokenButton = getButton("replaceGithubToken");
const clearGithubTokenButton = getButton("clearGithubToken");
const cancelGithubTokenButton = getButton("cancelGithubToken");
const saveForgejoTokenButton = getButton("saveForgejoToken");
const replaceForgejoTokenButton = getButton("replaceForgejoToken");
const clearForgejoTokenButton = getButton("clearForgejoToken");
const cancelForgejoTokenButton = getButton("cancelForgejoToken");
const saveForgejoBaseUrlButton = getButton("saveForgejoBaseUrl");
const manualRefToggleButton = getButton("manualRefToggle");
const buildBundleButton = getButton("buildBundle");
const uploadBundleButton = getButton("uploadBundle");
const downloadBundleButton = getButton("downloadBundle");

let currentBundle: CachedBundle | null = null;
let currentDraft: PopupDraftState = defaultDraft();
let providerSettings: ProviderSettings = defaultProviderSettings();
let repoDebounce: number | undefined;
let hasSavedToken: Record<RepoProvider, boolean> = { github: false, forgejo: false };
let settingsOpen = false;

void init();

async function init(): Promise<void> {
  settingsButton.addEventListener("click", () => toggleSettings());
  settingsBackButton.addEventListener("click", () => showSettings(false));
  providerGithubButton.addEventListener("click", () => void withStatusError(() => saveProvider({ provider: "github" })));
  providerForgejoButton.addEventListener("click", () => void withStatusError(() => saveProvider({ provider: "forgejo" })));
  saveGithubTokenButton.addEventListener("click", () => void withStatusError(() => saveToken("github")));
  replaceGithubTokenButton.addEventListener("click", () => showTokenEditor("github", true));
  clearGithubTokenButton.addEventListener("click", () => void withStatusError(() => clearToken("github")));
  cancelGithubTokenButton.addEventListener("click", () => showTokenEditor("github", false));
  saveForgejoBaseUrlButton.addEventListener("click", () => void withStatusError(() => saveProvider({ forgejoBaseUrl: forgejoBaseUrlInput.value })));
  saveForgejoTokenButton.addEventListener("click", () => void withStatusError(() => saveToken("forgejo")));
  replaceForgejoTokenButton.addEventListener("click", () => showTokenEditor("forgejo", true));
  clearForgejoTokenButton.addEventListener("click", () => void withStatusError(() => clearToken("forgejo")));
  cancelForgejoTokenButton.addEventListener("click", () => showTokenEditor("forgejo", false));
  manualRefToggleButton.addEventListener("click", () => toggleManualRefMode());
  buildBundleButton.addEventListener("click", () => void withStatusError(() => buildBundle()));
  uploadBundleButton.addEventListener("click", () => void withStatusError(() => uploadBundle()));
  downloadBundleButton.addEventListener("click", () => void withStatusError(async () => downloadBundle()));

  for (const element of [repoInput, refInput, maxBytesSelect, bundleProfileSelect, includeLineNumbersInput]) {
    element.addEventListener("input", () => void onDraftInput());
    element.addEventListener("change", () => void onDraftInput());
  }
  branchSelect.addEventListener("change", () => void selectBranch());

  await withStatusError(async () => {
    await restoreProviderSettings();
    await restoreDraft();
    await refreshTokenStatus();
    await restoreCachedBundle();
    if (repoInput.value.trim()) scheduleBranchLoad(0);
  });
}

async function saveProvider(patch: Partial<ProviderSettings>): Promise<void> {
  providerSettings = normalizeProviderSettings({ ...providerSettings, ...patch });
  const response = await sendBackground<{ settings: ProviderSettings }>({ type: "SAVE_PROVIDER_SETTINGS", settings: providerSettings });
  providerSettings = response.settings;
  renderProviderSettings();
  clearCurrentBundle();
  if (repoInput.value.trim()) scheduleBranchLoad(0);
  setStatus(`${providerLabel()} selected.`);
}

async function saveToken(provider: RepoProvider): Promise<void> {
  const input = tokenInputFor(provider);
  await sendBackground({ type: "SAVE_TOKEN", provider, token: input.value });
  input.value = "";
  await refreshTokenStatus();
  setStatus(`${providerName(provider)} token saved locally.`);
  if (provider === providerSettings.provider && repoInput.value.trim()) scheduleBranchLoad(0);
}

async function clearToken(provider: RepoProvider): Promise<void> {
  await sendBackground({ type: "CLEAR_TOKEN", provider });
  await refreshTokenStatus();
  setStatus(`${providerName(provider)} token cleared.`);
}

async function refreshTokenStatus(): Promise<void> {
  const response = await sendBackground<{ github: { hasToken: boolean }; forgejo: { hasToken: boolean } }>({ type: "GET_TOKEN_STATUS" });
  hasSavedToken = { github: response.github.hasToken, forgejo: response.forgejo.hasToken };
  githubTokenStatus.textContent = response.github.hasToken ? "Saved locally" : "No token saved";
  forgejoTokenStatus.textContent = response.forgejo.hasToken ? "Saved locally" : "No token saved";
  showTokenEditor("github", !response.github.hasToken);
  showTokenEditor("forgejo", !response.forgejo.hasToken);
}

function showTokenEditor(provider: RepoProvider, show: boolean): void {
  const editor = provider === "github" ? githubTokenEditor : forgejoTokenEditor;
  const actions = provider === "github" ? githubTokenSavedActions : forgejoTokenSavedActions;
  editor.hidden = !show;
  actions.hidden = show || !hasSavedToken[provider];
  if (!show) tokenInputFor(provider).value = "";
}

async function restoreProviderSettings(): Promise<void> {
  const response = await sendBackground<{ settings: ProviderSettings }>({ type: "GET_PROVIDER_SETTINGS" });
  providerSettings = normalizeProviderSettings(response.settings);
  renderProviderSettings();
}

async function restoreDraft(): Promise<void> {
  const response = await sendBackground<{ draft: PopupDraftState }>({ type: "GET_DRAFT_STATE" });
  currentDraft = { ...defaultDraft(), ...response.draft };
  repoInput.value = currentDraft.repoInput;
  refInput.value = currentDraft.ref;
  maxBytesSelect.value = String(currentDraft.maxBytes);
  bundleProfileSelect.value = currentDraft.bundleProfile;
  includeLineNumbersInput.checked = currentDraft.includeLineNumbers;
  setManualRefMode(currentDraft.manualRefMode);
}

async function restoreCachedBundle(): Promise<void> {
  if (!currentDraft.lastBundleId) return;
  const bundle = await getCachedBundle(currentDraft.lastBundleId);
  if (!bundle) return;
  currentBundle = bundle;
  renderBundleSummary(bundle);
  setBusy(false);
}

async function onDraftInput(): Promise<void> {
  currentDraft = readDraftFromUi();
  await saveDraft();
  if (document.activeElement === repoInput) scheduleBranchLoad();
}

async function selectBranch(): Promise<void> {
  if (branchSelect.value === "__manual__") {
    setManualRefMode(true);
    return;
  }
  refInput.value = branchSelect.value;
  currentDraft = readDraftFromUi();
  await saveDraft();
}

function scheduleBranchLoad(delay = 450): void {
  if (repoDebounce) window.clearTimeout(repoDebounce);
  repoDebounce = window.setTimeout(() => void withStatusError(loadBranches), delay);
}

async function loadBranches(): Promise<void> {
  const repo = repoInput.value.trim();
  if (!repo) return;
  branchSelect.disabled = true;
  branchSelect.innerHTML = `<option value="">Loading branches...</option>`;
  try {
    const response = await sendBackground<BranchListResult>({ type: "LIST_BRANCHES", repoInput: repo });
    renderBranches(response);
    const selected = currentDraft.selectedBranch || currentDraft.ref || response.defaultBranch;
    const hasBranch = response.branches.some((branch) => branch.name === selected);
    if (hasBranch && !currentDraft.manualRefMode) {
      branchSelect.value = selected;
      refInput.value = selected;
    } else if (!currentDraft.manualRefMode) {
      branchSelect.value = response.defaultBranch;
      refInput.value = response.defaultBranch;
    }
    currentDraft = {
      ...readDraftFromUi(),
      lastRepoMetadata: {
        owner: repo.split("/")[0] ?? "",
        repo: repo.split("/")[1] ?? "",
        defaultBranch: response.defaultBranch,
        htmlUrl: "",
        private: false,
        fetchedAt: new Date().toISOString()
      }
    };
    await saveDraft();
    setStatus(`Loaded ${response.branches.length} ${providerLabel()} branch(es)${response.tags.length ? ` and ${response.tags.length} tag(s)` : ""}.`);
  } catch (error) {
    branchSelect.innerHTML = `<option value="">Could not load branches</option>`;
    throw error;
  } finally {
    branchSelect.disabled = false;
  }
}

function renderBranches(result: BranchListResult): void {
  const options = [
    ...result.branches.map((branch) => `<option value="${escapeAttribute(branch.name)}">${escapeHtml(branch.name)}${branch.name === result.defaultBranch ? " (default)" : ""}</option>`),
    `<option value="__manual__">Use tag/SHA manually...</option>`
  ];
  branchSelect.innerHTML = options.join("");
}

function toggleManualRefMode(): void {
  setManualRefMode(!currentDraft.manualRefMode);
  currentDraft = readDraftFromUi();
  void saveDraft();
}

function setManualRefMode(manual: boolean): void {
  currentDraft.manualRefMode = manual;
  branchSelectWrap.hidden = manual;
  manualRefWrap.hidden = !manual;
  manualRefToggleButton.textContent = manual ? "Use branch list" : "Use tag/SHA";
}

async function buildBundle(): Promise<void> {
  setBusy(true);
  clearCurrentBundle();
  try {
    setStatus(`Fetching ${providerLabel()} tree, applying bundle profile, and building patch-ready Markdown context...`);
    const response = await sendBackground<{ bundle: BundleResult & { content: string } }>({
      type: "BUILD_BUNDLE",
      payload: {
        repoInput: repoInput.value,
        ref: refInput.value,
        maxBytes: Number(maxBytesSelect.value),
        bundleProfile: bundleProfileSelect.value as BundleProfile,
        includeLineNumbers: includeLineNumbersInput.checked
      }
    });
    currentBundle = response.bundle;
    await putCachedBundle(response.bundle);
    currentDraft = { ...readDraftFromUi(), lastBundleId: response.bundle.bundleId };
    await saveDraft();
    renderBundleSummary(response.bundle);
    setStatus([
      "Bundle built.",
      ...response.bundle.warnings.map((warning) => `Warning: ${warning}`),
      "Upload to ChatGPT, or use Download and drag the file into the chat."
    ].join("\n"));
  } finally {
    setBusy(false);
  }
}

async function uploadBundle(): Promise<void> {
  if (!currentBundle) return;
  const [tab] = await tabsQuery({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://chatgpt.com/")) {
    setStatus("Open a chatgpt.com tab before uploading. Download fallback is available.");
    return;
  }

  setBusy(true);
  try {
    setStatus("Attempting direct attachment in the active ChatGPT tab...");
    const response = await sendUploadMessage(tab.id, currentBundle);

    if (response?.ok) {
      setStatus("Bundle attached to ChatGPT.");
      return;
    }

    setStatus(`Upload was not verified: ${response?.error ?? "unknown error"}\nUse Download and drag the file into ChatGPT.`);
  } finally {
    setBusy(false);
  }
}

async function sendUploadMessage(tabId: number, bundle: CachedBundle): Promise<UploadResponse> {
  try {
    return await tabsSendMessage<UploadResponse>(tabId, {
      type: "ATTACH_REPO_BUNDLE",
      filename: bundle.filename,
      content: bundle.content
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Receiving end does not exist")) {
      return { ok: false, error: message };
    }

    await scriptingExecuteScript({ target: { tabId }, files: ["contentScript.js"] });
    return await tabsSendMessage<UploadResponse>(tabId, {
      type: "ATTACH_REPO_BUNDLE",
      filename: bundle.filename,
      content: bundle.content
    });
  }
}

async function downloadBundle(): Promise<void> {
  if (!currentBundle) return;
  const blob = new Blob([currentBundle.content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = currentBundle.filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  setStatus("Bundle downloaded. Drag it into ChatGPT if direct upload is blocked.");
}

async function withStatusError(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

async function sendBackground<T>(request: BackgroundRequest): Promise<T> {
  const response = (await runtimeSendMessage<BackgroundResponse<T>>(request)) as BackgroundResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error ?? "Extension request failed.");
  }
  return response;
}

function runtimeSendMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      const lastError = (chrome as ChromeCallback).runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? "Extension request failed."));
        return;
      }
      resolve(response);
    });
  });
}

function tabsQuery(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const lastError = (chrome as ChromeCallback).runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? "Tab query failed."));
        return;
      }
      resolve(tabs);
    });
  });
}

function tabsSendMessage<T>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T) => {
      const lastError = (chrome as ChromeCallback).runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? "Tab message failed."));
        return;
      }
      resolve(response);
    });
  });
}

function scriptingExecuteScript(details: Parameters<typeof chrome.scripting.executeScript>[0]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(details, () => {
      const lastError = (chrome as ChromeCallback).runtime.lastError;
      if (lastError) {
        reject(new Error(lastError.message ?? "Script injection failed."));
        return;
      }
      resolve();
    });
  });
}

function renderBundleSummary(bundle: BundleResult): void {
  uploadBundleButton.disabled = false;
  downloadBundleButton.disabled = false;
  bundleSummary.textContent = `${bundle.filename}
${formatBytes(bundle.bytes)} · ~${bundle.estimatedTokens.toLocaleString()} tokens estimated
Profile: ${profileLabel(bundle.profile)}
Included ${bundle.includedCount} files · skipped/omitted ${bundle.skippedCount}${bundle.warnings.length ? ` · ${bundle.warnings.length} warning(s)` : ""}`;
}

function setBusy(busy: boolean): void {
  for (const button of [
    buildBundleButton,
    saveGithubTokenButton,
    clearGithubTokenButton,
    replaceGithubTokenButton,
    saveForgejoTokenButton,
    clearForgejoTokenButton,
    replaceForgejoTokenButton,
    saveForgejoBaseUrlButton,
    manualRefToggleButton,
    uploadBundleButton
  ]) {
    button.disabled = busy || (button === uploadBundleButton && !currentBundle);
  }
  downloadBundleButton.disabled = busy || !currentBundle;
}

function clearCurrentBundle(): void {
  currentBundle = null;
  uploadBundleButton.disabled = true;
  downloadBundleButton.disabled = true;
  bundleSummary.textContent = "No bundle built yet.";
}

function setStatus(message: string): void {
  statusOutput.textContent = message;
}

function toggleSettings(): void {
  showSettings(!settingsOpen);
}

function showSettings(show: boolean): void {
  settingsOpen = show;
  mainView.hidden = show;
  settingsView.hidden = !show;
  settingsButton.setAttribute("aria-pressed", String(show));
  settingsButton.title = show ? "Close settings" : "Settings";
  settingsButton.setAttribute("aria-label", show ? "Close settings" : "Settings");
  if (show) void withStatusError(() => refreshTokenStatus());
}

function renderProviderSettings(): void {
  forgejoBaseUrlInput.value = providerSettings.forgejoBaseUrl;
  providerGithubButton.setAttribute("aria-pressed", String(providerSettings.provider === "github"));
  providerForgejoButton.setAttribute("aria-pressed", String(providerSettings.provider === "forgejo"));
  const label = providerLabel();
  providerSubtitle.textContent = `Build a focused ${label} source bundle for the current ChatGPT chat.`;
  repoInput.placeholder =
    providerSettings.provider === "forgejo"
      ? "owner/repo or Forgejo repository URL"
      : "owner/repo or https://github.com/owner/repo";
}

function readDraftFromUi(): PopupDraftState {
  return {
    repoInput: repoInput.value,
    ref: refInput.value,
    selectedBranch: currentDraft.manualRefMode ? null : branchSelect.value || null,
    manualRefMode: currentDraft.manualRefMode,
    maxBytes: Number(maxBytesSelect.value),
    bundleProfile: bundleProfileSelect.value as BundleProfile,
    includeLineNumbers: includeLineNumbersInput.checked,
    lastBundleId: currentDraft.lastBundleId,
    lastRepoMetadata: currentDraft.lastRepoMetadata
  };
}

async function saveDraft(): Promise<void> {
  await sendBackground({ type: "SAVE_DRAFT_STATE", draft: currentDraft });
}

function defaultDraft(): PopupDraftState {
  return {
    repoInput: "",
    ref: "",
    selectedBranch: null,
    manualRefMode: false,
    maxBytes: DEFAULT_MAX_BYTES,
    bundleProfile: DEFAULT_BUNDLE_PROFILE,
    includeLineNumbers: true
  };
}

function defaultProviderSettings(): ProviderSettings {
  return { provider: "github", forgejoBaseUrl: "https://forge.elephanthand.com" };
}

function normalizeProviderSettings(settings: ProviderSettings): ProviderSettings {
  return {
    provider: settings.provider === "forgejo" ? "forgejo" : "github",
    forgejoBaseUrl: settings.forgejoBaseUrl.trim()
  };
}

function tokenInputFor(provider: RepoProvider): HTMLInputElement {
  return provider === "github" ? githubTokenInput : forgejoTokenInput;
}

function providerLabel(): string {
  return providerName(providerSettings.provider);
}

function providerName(provider: RepoProvider): string {
  return provider === "forgejo" ? "Forgejo" : "GitHub";
}

function openBundleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("repo-context-uploader", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("bundles", { keyPath: "bundleId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putCachedBundle(bundle: CachedBundle): Promise<void> {
  const db = await openBundleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("bundles", "readwrite");
    tx.objectStore("bundles").put(bundle);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getCachedBundle(bundleId: string): Promise<CachedBundle | null> {
  const db = await openBundleDb();
  const bundle = await new Promise<CachedBundle | null>((resolve, reject) => {
    const tx = db.transaction("bundles", "readonly");
    const request = tx.objectStore("bundles").get(bundleId);
    request.onsuccess = () => resolve((request.result as CachedBundle | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return bundle;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function profileLabel(profile: BundleProfile): string {
  return bundleProfileSelect.querySelector(`option[value="${profile}"]`)?.textContent ?? profile;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function getElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

function getInput(id: string): HTMLInputElement {
  const element = getElement(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`#${id} is not an input`);
  return element;
}

function getSelect(id: string): HTMLSelectElement {
  const element = getElement(id);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`#${id} is not a select`);
  return element;
}

function getButton(id: string): HTMLButtonElement {
  const element = getElement(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`);
  return element;
}
