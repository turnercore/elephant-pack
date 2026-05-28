import type { UploadRequest } from "./types";

chrome.runtime.onMessage.addListener((request: UploadRequest, _sender, sendResponse) => {
  if (request.type !== "ATTACH_REPO_BUNDLE") return;

  try {
    const file = new File([request.content], request.filename, { type: "text/markdown" });
    const attached = attachViaFileInput(file) || attachViaDrop(file);
    sendResponse({
      ok: attached,
      error: attached ? undefined : "Could not find a ChatGPT file upload target."
    });
  } catch (error) {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

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
  const target =
    document.querySelector('[data-testid*="composer"]') ??
    document.querySelector("form") ??
    document.querySelector("main") ??
    document.body;

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
