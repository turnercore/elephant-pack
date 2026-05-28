import type { UploadRequest } from "./types";

const VERIFY_TIMEOUT_MS = 1_800;
const VERIFY_POLL_MS = 150;

chrome.runtime.onMessage.addListener((request: UploadRequest, _sender, sendResponse) => {
  if (request.type !== "ATTACH_REPO_BUNDLE") return false;

  void attachBundle(request).then(sendResponse, (error: unknown) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

async function attachBundle(request: UploadRequest): Promise<{ ok: boolean; error?: string }> {
  const file = new File([request.content], request.filename, { type: "text/markdown" });
  const beforeMatches = attachmentMatchCount(request.filename);
  const attempted = attachViaFileInput(file) || attachViaDrop(file);

  if (!attempted) {
    return { ok: false, error: "Could not find an enabled ChatGPT file input or drop target." };
  }

  const verified = await waitForAttachment(request.filename, beforeMatches);
  if (verified) {
    return { ok: true };
  }

  return {
    ok: false,
    error:
      "A file upload was attempted, but ChatGPT did not show the attachment. Use Download and drag the Markdown file into the chat."
  };
}

function attachViaFileInput(file: File): boolean {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
  for (const input of inputs) {
    if (input.disabled) continue;

    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    if (input.files?.length) return true;
  }
  return false;
}

function attachViaDrop(file: File): boolean {
  const target = findDropTarget();
  if (!target) return false;

  const transfer = new DataTransfer();
  transfer.items.add(file);

  for (const type of ["dragenter", "dragover", "drop"]) {
    const event = new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    });
    target.dispatchEvent(event);
  }

  return true;
}

function findDropTarget(): Element | null {
  return (
    document.querySelector('[data-testid="composer"]') ??
    document.querySelector('[data-testid*="composer"]') ??
    document.querySelector('[contenteditable="true"]') ??
    document.querySelector("form") ??
    document.querySelector("main") ??
    document.body
  );
}

async function waitForAttachment(filename: string, beforeMatches: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < VERIFY_TIMEOUT_MS) {
    if (attachmentMatchCount(filename) > beforeMatches) return true;
    await delay(VERIFY_POLL_MS);
  }
  return false;
}

function attachmentMatchCount(filename: string): number {
  const basename = filename.split(/[\\/]/).pop() ?? filename;
  const stem = basename.replace(/\.[^.]+$/, "");
  const attachmentSelectors = [
    '[data-testid*="attachment"]',
    '[data-testid*="file"]',
    '[aria-label*="attachment" i]',
    '[aria-label*="file" i]',
    '[data-testid*="composer"]',
    "form"
  ];

  let count = 0;
  for (const selector of attachmentSelectors) {
    for (const element of document.querySelectorAll(selector)) {
      const text = element.textContent ?? "";
      const label = element.getAttribute("aria-label") ?? "";
      if (text.includes(basename) || text.includes(stem) || label.includes(basename) || label.includes(stem)) {
        count += 1;
      }
    }
  }
  return count;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
