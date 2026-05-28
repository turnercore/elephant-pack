import type { BackgroundRequest, BundleResult } from "./types";
import "./styles.css";

type BackgroundResponse<T> = T & { ok: boolean; error?: string };
type UploadResponse = { ok?: boolean; error?: string };

const tokenInput = getInput("token");
const repoInput = getInput("repo");
const refInput = getInput("ref");
const maxBytesSelect = getSelect("maxBytes");
const tokenStatus = getElement("tokenStatus");
const statusOutput = getElement("status");
const bundleSummary = getElement("bundleSummary");
const saveTokenButton = getButton("saveToken");
const clearTokenButton = getButton("clearToken");
const detectBranchButton = getButton("detectBranch");
const buildBundleButton = getButton("buildBundle");
const uploadBundleButton = getButton("uploadBundle");
const downloadBundleButton = getButton("downloadBundle");

let currentBundle: BundleResult | null = null;

void init();

async function init(): Promise<void> {
  await withStatusError(() => refreshTokenStatus());
  saveTokenButton.addEventListener("click", () => void withStatusError(() => saveToken()));
  clearTokenButton.addEventListener("click", () => void withStatusError(() => clearToken()));
  detectBranchButton.addEventListener("click", () => void withStatusError(() => detectDefaultBranch()));
  buildBundleButton.addEventListener("click", () => void withStatusError(() => buildBundle()));
  uploadBundleButton.addEventListener("click", () => void withStatusError(() => uploadBundle()));
  downloadBundleButton.addEventListener("click", () => void withStatusError(async () => downloadBundle()));
}

async function saveToken(): Promise<void> {
  await sendBackground({ type: "SAVE_TOKEN", token: tokenInput.value });
  tokenInput.value = "";
  await refreshTokenStatus();
  setStatus("GitHub token saved locally.");
}

async function clearToken(): Promise<void> {
  await sendBackground({ type: "CLEAR_TOKEN" });
  await refreshTokenStatus();
  setStatus("GitHub token cleared.");
}

async function refreshTokenStatus(): Promise<void> {
  const response = await sendBackground<{ hasToken: boolean }>({ type: "GET_TOKEN_STATUS" });
  tokenStatus.textContent = response.hasToken ? "Token saved locally." : "No token saved. Public repos may still work, but file depth is capped.";
}

async function detectDefaultBranch(): Promise<void> {
  setBusy(true);
  try {
    const response = await sendBackground<{ defaultBranch: string; private: boolean; htmlUrl: string }>({
      type: "GET_DEFAULT_BRANCH",
      repoInput: repoInput.value
    });
    refInput.value = response.defaultBranch;
    setStatus(`Detected ${response.defaultBranch}${response.private ? " (private)" : ""}.`);
  } finally {
    setBusy(false);
  }
}

async function buildBundle(): Promise<void> {
  setBusy(true);
  clearCurrentBundle();
  try {
    setStatus("Fetching GitHub file tree, selecting useful files, and building Markdown context...");
    const response = await sendBackground<{ bundle: BundleResult }>({
      type: "BUILD_BUNDLE",
      payload: {
        repoInput: repoInput.value,
        ref: refInput.value,
        maxBytes: Number(maxBytesSelect.value)
      }
    });
    currentBundle = response.bundle;
    uploadBundleButton.disabled = false;
    downloadBundleButton.disabled = false;
    bundleSummary.textContent = `${currentBundle.filename}
${formatBytes(currentBundle.bytes)} · ~${currentBundle.estimatedTokens.toLocaleString()} tokens estimated
Included ${currentBundle.includedCount} files · skipped/omitted ${currentBundle.skippedCount}${
      currentBundle.warnings.length ? ` · ${currentBundle.warnings.length} warning(s)` : ""
    }`;
    setStatus([
      "Bundle built.",
      ...currentBundle.warnings.map((warning) => `Warning: ${warning}`),
      "Upload to ChatGPT, or use Download and drag the file into the chat."
    ].join("\n"));
  } finally {
    setBusy(false);
  }
}

async function uploadBundle(): Promise<void> {
  if (!currentBundle) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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

async function sendUploadMessage(tabId: number, bundle: BundleResult): Promise<UploadResponse> {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: "ATTACH_REPO_BUNDLE",
      filename: bundle.filename,
      content: bundle.content
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Receiving end does not exist")) {
      return { ok: false, error: message };
    }

    await chrome.scripting.executeScript({ target: { tabId }, files: ["contentScript.js"] });
    return await chrome.tabs.sendMessage(tabId, {
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
  const response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error ?? "Extension request failed.");
  }
  return response;
}

function setBusy(busy: boolean): void {
  for (const button of [detectBranchButton, buildBundleButton, saveTokenButton, clearTokenButton, uploadBundleButton]) {
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
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
