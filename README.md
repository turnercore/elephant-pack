# Elephant Pack

A Manifest V3 extension for Arc/Chrome and Safari that turns a GitHub or Forgejo repository into a ChatGPT-friendly Markdown source bundle.

The extension is meant for cases where ChatGPT's repository connectors are unavailable, unreliable, or too broad for the specific task. It fetches a repository file tree from the selected source API, selects high-signal text files, writes a structured Markdown context bundle, and attempts to attach that bundle to the active ChatGPT conversation.

## What changed in 0.5.4

- Uses Forgejo query-token auth for API reads to avoid Safari's failing authorization-header preflight.

## What changed in 0.5.3

- Adds clearer Safari diagnostics when Forgejo API access is blocked by extension site permissions.

## What changed in 0.5.2

- Uses the Elephant Pack artwork as the Chrome and Safari extension icon/logo.

## What changed in 0.5.1

- Makes the settings control a selected-state toggle that opens and closes the settings view.

## What changed in 0.5.0

- Renames the extension and Safari app to Elephant Pack.
- Renames the npm package to `elephant-pack`.

## What changed in 0.4.0

- Adds settings-level GitHub/Forgejo source selection with separate saved tokens and a Forgejo instance URL.
- Defaults Forgejo to `https://forge.elephanthand.com` and limits extension host permission to that instance.

## What changed in 0.3.0

- Adds persistent popup draft state and restores the last generated bundle after reopening the popup.
- Adds collapsed saved-token UX with Replace/Clear actions.
- Adds branch listing with manual tag/SHA fallback.
- Replaces size-only bundle levels with intent-based bundle profiles.
- Adds patch-ready bundle metadata: manifest, annotated inventory, resolved commit/tree SHAs, line counts, hashes, and line-numbered file blocks.

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
- Accepts `owner/repo` or a repository URL for the selected source.
- Supports GitHub and Forgejo, with separate locally stored API tokens.
- Detects the repo default branch, with manual branch/tag/SHA override.
- Loads repo branches into a selector, while preserving manual tag/SHA entry for advanced refs.
- Restores popup draft state and the last generated bundle after the popup closes.
- Fetches repository trees first, then downloads only selected file blobs.
- Uses intent-based bundle profiles: Map only, Core code, Code + docs, All useful text, All safe text + hidden, and Forensic inventory.
- Prioritizes `AGENTS.md`, README files, package/project manifests, config, `src`, `app`, `lib`, tests, docs, and scripts.
- Excludes common noisy paths such as `node_modules`, `dist`, `build`, `.next`, `.cache`, `Library`, `Temp`, `obj`, and binary/archive files.
- Excludes likely secret files such as `.env`, `.env.local`, private key formats, and credential filenames. Example/sample env files can still be included.
- Adds a machine-readable manifest, annotated inventory, line counts, content hashes, and skipped/omitted-file summaries so ChatGPT can see what was intentionally left out.
- Falls back to downloading the bundle if direct ChatGPT attachment is blocked.

## Source Tokens

For private repos, create a token for the selected source.

For GitHub, use a fine-grained personal access token with:

- Repository access: only the repos you want to upload.
- Repository permissions: `Contents: read`.

For Forgejo, set the Forgejo instance URL in settings. This build defaults to `https://forge.elephanthand.com` and requests host permission only for that instance. Generate an API token from the Forgejo instance's Settings > Applications page with repository read access.

Tokens are stored locally in `chrome.storage.local`. They are not written into generated bundles, logs, or filenames. Tokens are also useful for public repos because unauthenticated API rate limits can be much lower.

## Bundle Strategy

The generated Markdown bundle is designed for ChatGPT code review, debugging, and patch planning:

1. Metadata and suggested use.
2. Repository snapshot with resolved commit and tree SHA.
3. Architecture map, annotated directory tree, and build warnings.
4. Bundle summary, security summary, and included-file index.
5. Machine-readable JSON manifest and compact inventory.
6. Source file contents with `repo-file` metadata, hashes, line counts, and optional line numbers.
7. A capped skipped-file detail list with omission reasons.

The default profile is **Code + docs** with a **4 MB** cap and line numbers enabled. Profiles control which files are eligible; the cap only constrains final bundle size. Binary and secret-like files remain metadata-only or omitted rather than included as content.

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

### Safari

Safari cannot load this folder directly as an unpacked Chrome extension. Build the Safari-compatible extension bundle and Xcode wrapper with:

```bash
npm run package:safari
```

This command:

1. Builds the normal extension into `dist/`.
2. Copies it into `dist-safari/`.
3. Removes Safari-unsupported manifest keys from the Safari copy (`background.type` and the unused `downloads` permission).
4. Packages the result into `safari/Elephant Pack/Elephant Pack.xcodeproj`.

Open the generated Xcode project, select a signing team, then build and run the macOS app. In Safari, enable the extension from **Settings > Extensions**.

The committed Safari project includes copied web extension resources, but rerun `npm run package:safari` after changing source files so the Xcode wrapper receives a fresh build.

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

This is a test to update the repo and see if we're on the new origin :)