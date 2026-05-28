# Repo Context Uploader for ChatGPT

A Manifest V3 extension for Arc/Chrome that turns a GitHub repository into a ChatGPT-friendly Markdown source bundle.

The extension is meant for cases where ChatGPT's GitHub connector is unavailable, unreliable, or too broad for the specific task. It fetches a repository file tree from the GitHub API, selects high-signal text files, writes a structured Markdown context bundle, and attempts to attach that bundle to the active ChatGPT conversation.

## What changed in 0.2.0

- Replaced full zipball download/decompression with GitHub tree + blob API fetching.
- Filters generated/vendor/binary/secret-like files before downloading file bodies.
- Adds a readable directory tree, suggested-use notes, bundle summary, included-file index, and skipped-file summary.
- Adds conservative default bundle sizes: 1 MB, 2 MB, 4 MB, and 8 MB.
- Adds stronger user-facing errors for GitHub auth, GitHub rate limits, missing ChatGPT tabs, and failed direct attachment.
- Removes the `jszip` runtime dependency.
- Stops claiming success unless the content script can verify that ChatGPT displayed the uploaded attachment.
- Falls back cleanly to downloading the Markdown bundle if direct attachment is blocked by ChatGPT page behavior.

## Features

- Works from a `https://chatgpt.com/` tab.
- Accepts `owner/repo` or a GitHub repo URL.
- Supports public repos and private repos through a GitHub personal access token.
- Detects the repo default branch, with manual branch/tag/SHA override.
- Fetches repository trees first, then downloads only selected file blobs.
- Prioritizes `AGENTS.md`, README files, package/project manifests, config, `src`, `app`, `lib`, tests, docs, and scripts.
- Excludes common noisy paths such as `node_modules`, `dist`, `build`, `.next`, `.cache`, `Library`, `Temp`, `obj`, and binary/archive files.
- Excludes likely secret files such as `.env`, `.env.local`, private key formats, and credential filenames. Example/sample env files can still be included.
- Adds skipped/omitted-file summaries so ChatGPT can see what was intentionally left out.
- Falls back to downloading the bundle if direct ChatGPT attachment is blocked.

## GitHub Token

For private repos, create a fine-grained GitHub personal access token with:

- Repository access: only the repos you want to upload.
- Repository permissions: `Contents: read`.

The token is stored locally in `chrome.storage.local`. It is not written into generated bundles, logs, or filenames.

A token is also useful for public repos because unauthenticated GitHub API rate limits are much lower. Without a token, the extension intentionally fetches fewer file blobs.

## Bundle Strategy

The generated Markdown bundle is designed for ChatGPT code review and debugging:

1. Metadata and suggested use.
2. Repository directory tree.
3. Build warnings, when applicable.
4. Bundle summary and skipped/omitted-file summary.
5. Included-file index with sizes and truncation flags.
6. Source file contents in fenced code blocks.
7. A capped skipped-file detail list.

The default **Focused · 1 MB** cap is deliberately conservative for one-pass review. Larger files may upload successfully, but smaller focused bundles are generally easier for a model to use in active context.

## Development

```bash
npm install
npm test
npm run build
```

Load the built extension from `dist/`:

1. Open `chrome://extensions` in Arc/Chrome.
2. Enable developer mode.
3. Choose **Load unpacked**.
4. Select this repo's `dist/` folder.

## Usage

1. Open a ChatGPT conversation at `https://chatgpt.com/`.
2. Open the extension popup.
3. Save a GitHub token if the repo is private or large.
4. Enter `owner/repo` or a GitHub repo URL.
5. Click **Detect branch** or type a branch/tag/SHA manually.
6. Choose a bundle cap.
7. Click **Build bundle**.
8. Click **Upload to ChatGPT**.
9. If direct upload is not verified, click **Download** and drag the generated Markdown file into ChatGPT.

## Troubleshooting

### Branch detection works, but building fails

The old implementation downloaded and decompressed the full repository zipball before filtering. Large repos could fail before any useful error reached the popup. The current implementation fetches the repository tree first and only downloads selected text blobs.

If builds still fail:

- Verify the token has `Contents: read` permission for that repository.
- Confirm the branch/tag/SHA exists.
- Save a token for public repos if you see rate-limit errors.
- Use a smaller bundle cap first, then increase it after a successful build.

### Upload says it failed

Direct upload depends on ChatGPT's current page internals. The extension now attempts upload, waits briefly, and only reports success when it can verify that the attachment appears. If verification fails, use **Download** and drag the Markdown file into ChatGPT.

### The generated file omits something important

The bundle is intentionally selective. Check the skipped/omitted section. If a file is omitted because of the bundle cap, use a larger cap or narrow the repository/ref. If a file type is unsupported, add it to `TEXT_EXTENSIONS` in `src/fileRules.ts`.
