# Repo Context Uploader for ChatGPT

A small Manifest V3 extension for Arc/Chrome that turns a GitHub repository into a ChatGPT-friendly Markdown source bundle.

The extension is meant for cases where ChatGPT's GitHub connector is unreliable or unavailable. It fetches a repo archive from GitHub, removes common vendor/build noise, writes the remaining review-useful source into one Markdown file, and attempts to attach that file to the current ChatGPT conversation.

## Features

- Works from a `https://chatgpt.com/` tab.
- Accepts `owner/repo` or a GitHub repo URL.
- Supports public repos and private repos through a GitHub personal access token.
- Detects the repo default branch, with manual branch/tag/SHA override.
- Excludes common noisy paths such as `node_modules`, `vendor`, `dist`, `build`, `.next`, `.cache`, and binary/archive files.
- Adds a skipped-file section so ChatGPT can see what was intentionally omitted.
- Falls back to downloading the bundle if direct ChatGPT attachment is blocked.

## GitHub Token

For private repos, create a fine-grained GitHub personal access token with:

- Repository access: only the repos you want to upload.
- Repository permissions: `Contents: read`.

The token is stored locally in `chrome.storage.local`. It is not written into generated bundles, logs, or filenames.

## Development

```bash
npm install
npm test
npm run build
```

Load the built extension from `dist/`:

1. Open `chrome://extensions` in Arc/Chrome.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this repo's `dist/` folder.

## Usage

1. Open a ChatGPT conversation at `https://chatgpt.com/`.
2. Open the extension popup.
3. Save a GitHub token if the repo is private.
4. Enter `owner/repo` or a GitHub repo URL.
5. Click "Detect branch" or type a branch/tag/SHA manually.
6. Click "Build bundle".
7. Click "Upload to ChatGPT".

If direct upload is blocked by ChatGPT's page behavior, click "Download" and drag the generated Markdown file into the chat.
