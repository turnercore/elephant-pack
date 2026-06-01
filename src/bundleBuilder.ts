import { classifyPath, languageForPath, looksBinary } from "./fileRules";
import type { ArchiveFile, BundleManifest, BundleProfile, BundleResult, FileInventoryEntry, GithubRepoMetadata, IncludedFile, SkippedFile } from "./types";
import { sanitizeRefForFilename } from "./repoInput";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });
const MAX_TREE_ENTRIES = 1_200;
const MAX_INVENTORY_ENTRIES = 1_000;
const MAX_SKIPPED_ENTRIES = 350;
const PER_FILE_TRUNCATION_BYTES = 180_000;

export async function buildMarkdownBundle(params: {
  metadata: GithubRepoMetadata;
  ref: string;
  resolvedCommitSha?: string;
  treeSha?: string;
  tokenStatus?: "authenticated" | "anonymous";
  files: ArchiveFile[];
  inventory?: FileInventoryEntry[];
  maxBytes: number;
  profile?: BundleProfile;
  includeLineNumbers?: boolean;
  generatedAt?: string;
  treePaths?: string[];
  preSkipped?: SkippedFile[];
  warnings?: string[];
}): Promise<BundleResult> {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const profile = params.profile ?? "code_docs";
  const includeLineNumbers = params.includeLineNumbers ?? true;
  const initialInventory = params.inventory ?? params.files.map(fileToInventoryEntry);
  const treePaths = (params.treePaths?.length ? params.treePaths : initialInventory.map((file) => file.path)).sort((a, b) => a.localeCompare(b));
  const skipped: SkippedFile[] = [...(params.preSkipped ?? [])];
  const warnings = [...(params.warnings ?? [])];
  const inventory = cloneInventory(initialInventory);
  const inventoryByPath = new Map(inventory.map((entry) => [entry.path, entry]));

  const included: IncludedFile[] = [];
  let sections = "";
  const reserveBytes = Math.min(180_000, Math.max(24_000, Math.floor(params.maxBytes * 0.16)));

  let header = headerMarkdown({ ...params, profile }, generatedAt, treePaths, warnings, inventory);
  const fileContentsHeading = "\n\n## Included File Contents\n";

  for (const file of params.files.sort((a, b) => (inventoryByPath.get(a.path)?.priorityScore ?? 999) - (inventoryByPath.get(b.path)?.priorityScore ?? 999) || a.path.localeCompare(b.path))) {
    const inventoryEntry = inventoryByPath.get(file.path);
    if (inventoryEntry?.skipReason) {
      skipped.push({ path: file.path, reason: inventoryEntry.skipReason, size: file.size });
      continue;
    }
    if (looksBinary(file.bytes)) {
      skipped.push({ path: file.path, reason: "binary content detected", size: file.size });
      if (inventoryEntry) {
        inventoryEntry.includeDecision = "metadata_only";
        inventoryEntry.skipReason = "binary content detected";
        inventoryEntry.includeReason = "binary content detected";
        inventoryEntry.isBinaryLikely = true;
      }
      continue;
    }

    const normalizedText = decoder.decode(file.bytes).replace(/\r\n/g, "\n");
    const truncated = byteLength(normalizedText) > PER_FILE_TRUNCATION_BYTES;
    const fileText = truncated ? truncateUtf8(normalizedText, PER_FILE_TRUNCATION_BYTES) : normalizedText;
    const lineCount = countLines(normalizedText);
    const contentSha256 = await sha256Hex(normalizedText);

    const baseEntry = inventoryEntry ?? fileToInventoryEntry(file);
    const enriched = {
      ...baseEntry,
      path: file.path,
      sizeBytes: file.size,
      lineCount,
      gitBlobSha: file.gitBlobSha ?? inventoryEntry?.gitBlobSha,
      language: inventoryEntry?.language ?? languageForPath(file.path),
      truncated,
      contentSha256,
      includeDecision: "included" as const,
      includeReason: `included by ${profileLabel(profile)} profile`
    } satisfies FileInventoryEntry;

    const section = fileSectionMarkdown(enriched, fileText, includeLineNumbers);
    const nextBytes = byteLength(header) + byteLength(fileContentsHeading) + byteLength(sections) + byteLength(section) + reserveBytes;

    if (nextBytes > params.maxBytes) {
      skipped.push({ path: file.path, reason: "bundle size cap reached", size: file.size });
      if (inventoryEntry) {
        inventoryEntry.includeDecision = "metadata_only";
        inventoryEntry.skipReason = "bundle size cap reached";
        inventoryEntry.includeReason = "bundle size cap reached";
      }
      continue;
    }

    if (inventoryEntry) Object.assign(inventoryEntry, enriched);
    included.push({ path: file.path, size: file.size, content: fileText, truncated });
    sections += section;
  }

  if (included.length === 0 && profile !== "map_only") {
    warnings.push("No source files fit the current bundle cap after filtering. Increase the cap or use a narrower repo/ref.");
  }

  applySkippedToInventory(inventory, skipped);
  const manifest = buildManifest({ ...params, profile, includeLineNumbers }, generatedAt, inventory);
  header = headerMarkdown({ ...params, profile }, generatedAt, treePaths, warnings, inventory);
  const summary = summaryMarkdown(included, skipped, params.files.length, treePaths.length, manifest);
  const manifestSection = manifestMarkdown(manifest);
  const inventorySection = inventoryMarkdown(inventory);
  const skippedSection = skippedSectionMarkdown(skipped);
  let content = `${header}${summary}${manifestSection}${inventorySection}${fileContentsHeading}${sections}${skippedSection}`;

  if (byteLength(content) > params.maxBytes) {
    warnings.push("Bundle metadata exceeded the selected cap, so the inventory and skipped-file details were shortened.");
    header = headerMarkdown({ ...params, profile }, generatedAt, treePaths, warnings, inventory);
    content = `${header}${summary}${manifestSection}${inventoryMarkdown(inventory, 250)}${fileContentsHeading}${sections}${skippedSectionMarkdown(skipped, 80)}`;
  }

  const filename = `${params.metadata.owner}-${params.metadata.repo}-${sanitizeRefForFilename(params.ref)}-${profile}-chatgpt-context.md`;
  const bytes = byteLength(content);
  return {
    filename,
    content,
    owner: params.metadata.owner,
    repo: params.metadata.repo,
    ref: params.ref,
    generatedAt,
    includedCount: included.length,
    skippedCount: skipped.length,
    bytes,
    estimatedTokens: estimateTokens(content),
    warnings,
    bundleId: `${params.metadata.owner}/${params.metadata.repo}@${params.resolvedCommitSha}:${generatedAt}`,
    profile
  };
}

function buildManifest(
  params: {
    metadata: GithubRepoMetadata;
    ref: string;
    resolvedCommitSha?: string;
    treeSha?: string;
    tokenStatus?: "authenticated" | "anonymous";
    maxBytes: number;
    profile: BundleProfile;
    includeLineNumbers: boolean;
  },
  generatedAt: string,
  inventory: FileInventoryEntry[]
): BundleManifest {
  const files = inventory.filter((entry) => entry.kind === "file");
  const includedFiles = files.filter((entry) => entry.includeDecision === "included");
  const omittedFiles = files.filter((entry) => entry.includeDecision !== "included");
  return {
    schemaVersion: "1.0.0",
    repo: `${params.metadata.owner}/${params.metadata.repo}`,
    sourceUrl: params.metadata.htmlUrl,
    ref: params.ref,
    defaultBranch: params.metadata.defaultBranch,
    resolvedCommitSha: params.resolvedCommitSha ?? "unknown",
    treeSha: params.treeSha ?? "unknown",
    generatedAt,
    private: params.metadata.private,
    tokenStatus: params.tokenStatus ?? "anonymous",
    profile: params.profile,
    maxBytes: params.maxBytes,
    includeLineNumbers: params.includeLineNumbers,
    files,
    includedFiles,
    omittedFiles,
    security: {
      secretLikeFilesOmitted: omittedFiles.filter((entry) => entry.isSecretLikely).length,
      binaryFilesOmitted: omittedFiles.filter((entry) => entry.isBinaryLikely).length,
      tokenIncludedInBundle: false
    }
  };
}

function headerMarkdown(
  params: { metadata: GithubRepoMetadata; ref: string; resolvedCommitSha?: string; treeSha?: string; tokenStatus?: "authenticated" | "anonymous"; maxBytes: number; profile: BundleProfile },
  generatedAt: string,
  treePaths: string[],
  warnings: string[],
  inventory: FileInventoryEntry[]
): string {
  const tree = renderDirectoryTree(treePaths, MAX_TREE_ENTRIES, inventory);
  const warningText = warnings.length ? `\n## Build Warnings\n${warnings.map((warning) => `- ${warning}`).join("\n")}\n` : "";

  return `# Repository Context Bundle for ChatGPT

This file was generated by Elephant Pack to give ChatGPT source context for debugging, code review, architecture review, and patch planning. Treat omitted files as unavailable unless listed in the manifest or inventory.

## Suggested Use
- Ask for an architecture pass before requesting edits.
- For edits, request unified diffs or full replacement files.
- Use file hashes, line counts, and numbered file contents to anchor patch suggestions.
- Do not infer contents for metadata-only files.

## Repository Snapshot
- Repository: ${params.metadata.owner}/${params.metadata.repo}
- Source URL: ${params.metadata.htmlUrl}
- Ref: ${params.ref}
- Default branch: ${params.metadata.defaultBranch}
- Resolved commit SHA: ${params.resolvedCommitSha ?? "unknown"}
- Tree SHA: ${params.treeSha ?? "unknown"}
- Private repository: ${params.metadata.private ? "yes" : "no"}
- Token status: ${params.tokenStatus ?? "anonymous"}
- Generated at: ${generatedAt}
- Bundle schema: 1.0.0
- Bundle profile: ${profileLabel(params.profile)}
- Bundle cap: ${formatBytes(params.maxBytes)} (${params.maxBytes.toLocaleString()} bytes)

${warningText}## Architecture Map
${architectureMap(inventory)}

## Directory Tree

\`\`\`text
${tree}
\`\`\`
`;
}

function summaryMarkdown(included: IncludedFile[], skipped: SkippedFile[], fetchedCount: number, treeCount: number, manifest: BundleManifest): string {
  const includedBytes = included.reduce((sum, file) => sum + file.size, 0);
  const byReason = summarizeSkipped(skipped);
  const index = manifest.includedFiles
    .map((file) => `- ${file.path} (${formatBytes(file.sizeBytes ?? 0)}, ${file.lineCount ?? "?"} lines, ${file.language ?? "text"}${file.truncated ? ", truncated" : ""})`)
    .join("\n");
  const skippedSummary = byReason.length ? byReason.map(([reason, count]) => `- ${reason}: ${count}`).join("\n") : "- None";

  return `

## Bundle Summary
- Files in repository tree: ${treeCount}
- Files fetched for possible inclusion: ${fetchedCount}
- Files included in this bundle: ${included.length}
- Included source bytes before Markdown overhead: ${formatBytes(includedBytes)}
- Files skipped or omitted: ${manifest.omittedFiles.length}
- Secret-like files omitted: ${manifest.security.secretLikeFilesOmitted}
- Binary files omitted: ${manifest.security.binaryFilesOmitted}
- Token included in bundle: no

### Skipped/Omitted Summary
${skippedSummary}

### Included File Index
${index || "No files included."}
`;
}

function manifestMarkdown(manifest: BundleManifest): string {
  const compactManifest = {
    ...manifest,
    files: manifest.files.map(compactInventoryEntry),
    includedFiles: manifest.includedFiles.map(compactInventoryEntry),
    omittedFiles: manifest.omittedFiles.slice(0, 300).map(compactInventoryEntry)
  };
  return `

## Machine-Readable Manifest

\`\`\`json
${JSON.stringify(compactManifest, null, 2)}
\`\`\`
`;
}

function inventoryMarkdown(inventory: FileInventoryEntry[], maxEntries = MAX_INVENTORY_ENTRIES): string {
  const files = inventory.filter((entry) => entry.kind === "file").slice(0, maxEntries);
  const remaining = inventory.filter((entry) => entry.kind === "file").length - files.length;
  const lines = files.map((file) => {
    const status = file.includeDecision;
    const detail = [file.language ?? file.extension ?? "unknown", file.sizeBytes == null ? null : formatBytes(file.sizeBytes), file.lineCount == null ? null : `${file.lineCount} lines`]
      .filter(Boolean)
      .join(", ");
    return `- ${file.path} [${status}${detail ? `, ${detail}` : ""}] - ${file.includeReason}`;
  });
  if (remaining > 0) lines.push(`- ... ${remaining} more files not shown in this compact inventory section.`);
  return `

## Compact File Inventory
${lines.join("\n") || "- No files."}
`;
}

function fileSectionMarkdown(file: FileInventoryEntry, content: string, includeLineNumbers: boolean): string {
  const language = file.language ?? languageForPath(file.path) ?? "";
  const body = includeLineNumbers ? numberLines(content) : content;
  const fenceLanguage = includeLineNumbers ? "text" : language;

  return `

## File: ${file.path}
\`\`\`repo-file
path: ${file.path}
language: ${language || "text"}
sizeBytes: ${file.sizeBytes ?? 0}
lineCount: ${file.lineCount ?? countLines(content)}
contentSha256: ${file.contentSha256 ?? ""}
gitBlobSha: ${file.gitBlobSha ?? ""}
includedBy: profile:${file.includeReason}
truncated: ${file.truncated ? "true" : "false"}
lineNumbered: ${includeLineNumbers ? "true" : "false"}
\`\`\`
\`\`\`${fenceLanguage}
${body.replaceAll("```", "``\\`")}
\`\`\`
`;
}

function skippedSectionMarkdown(skipped: SkippedFile[], maxEntries = MAX_SKIPPED_ENTRIES): string {
  if (skipped.length === 0) {
    return "\n\n## Skipped and Omitted Files\nNo files skipped.\n";
  }

  const shown = [...skipped].sort((a, b) => a.path.localeCompare(b.path)).slice(0, maxEntries);
  const remaining = skipped.length - shown.length;
  const lines = shown.map((file) => `- ${file.path}${file.size == null ? "" : ` (${formatBytes(file.size)})`}: ${file.reason}`);
  if (remaining > 0) {
    lines.push(`- ... ${remaining} more skipped/omitted files not shown to keep this bundle compact.`);
  }

  return `\n\n## Skipped and Omitted Files\n${lines.join("\n")}\n`;
}

function renderDirectoryTree(paths: string[], maxEntries: number, inventory: FileInventoryEntry[]): string {
  if (paths.length === 0) return ".\n";
  const byPath = new Map(inventory.map((entry) => [entry.path, entry]));
  const shown = paths.slice(0, maxEntries);
  const root: TreeNode = { children: new Map(), file: false };

  for (const path of shown) {
    const segments = path.split("/").filter(Boolean);
    let node = root;
    for (const [index, segment] of segments.entries()) {
      let child = node.children.get(segment);
      if (!child) {
        child = { children: new Map(), file: index === segments.length - 1, path: segments.slice(0, index + 1).join("/") };
        node.children.set(segment, child);
      }
      if (index === segments.length - 1) child.file = true;
      node = child;
    }
  }

  const lines = ["."];
  renderTreeNode(root, "", lines, byPath);
  if (paths.length > shown.length) {
    lines.push(`... ${paths.length - shown.length} more paths omitted from tree display`);
  }
  return lines.join("\n");
}

interface TreeNode {
  children: Map<string, TreeNode>;
  file: boolean;
  path?: string;
}

function renderTreeNode(node: TreeNode, prefix: string, lines: string[], byPath: Map<string, FileInventoryEntry>): void {
  const entries = Array.from(node.children.entries()).sort(([aName, aNode], [bName, bNode]) => {
    if (aNode.file !== bNode.file) return aNode.file ? 1 : -1;
    return aName.localeCompare(bName);
  });

  entries.forEach(([name, child], index) => {
    const isLast = index === entries.length - 1;
    const entry = child.path ? byPath.get(child.path) : undefined;
    const annotation =
      entry && entry.kind === "file"
        ? ` [${entry.includeDecision}, ${entry.language ?? entry.extension ?? "unknown"}${entry.sizeBytes == null ? "" : `, ${formatBytes(entry.sizeBytes)}`}]`
        : "";
    lines.push(`${prefix}${isLast ? "`--" : "|--"} ${name}${annotation}`);
    if (child.children.size > 0) {
      renderTreeNode(child, `${prefix}${isLast ? "    " : "|   "}`, lines, byPath);
    }
  });
}

function architectureMap(inventory: FileInventoryEntry[]): string {
  const files = new Set(inventory.map((entry) => entry.path));
  const known = [
    ["popup.html", "defines the extension popup UI."],
    ["src/popup.ts", "owns popup state, user actions, build/upload/download flow, and draft persistence."],
    ["src/background.ts", "handles runtime messages, token storage, branch loading, and bundle-building requests."],
    ["src/github.ts", "talks to GitHub metadata, branch, tree, and blob APIs."],
    ["src/fileRules.ts", "classifies paths, profiles, and unsafe/noisy files."],
    ["src/bundleBuilder.ts", "renders the patch-ready Markdown bundle and manifest."],
    ["src/contentScript.ts", "attempts to attach the generated bundle to ChatGPT."],
    ["public/manifest.json", "declares extension permissions, service worker, popup, and content script targets."]
  ];
  const lines = known.filter(([path]) => files.has(path)).map(([path, description]) => `- \`${path}\` ${description}`);
  if (lines.length) return lines.join("\n");
  return "- Architecture map is heuristic. Use the file inventory and imports in included files for exact boundaries.";
}

function compactInventoryEntry(entry: FileInventoryEntry): Partial<FileInventoryEntry> {
  return {
    path: entry.path,
    kind: entry.kind,
    language: entry.language,
    sizeBytes: entry.sizeBytes,
    lineCount: entry.lineCount,
    gitBlobSha: entry.gitBlobSha,
    contentSha256: entry.contentSha256,
    includeDecision: entry.includeDecision,
    includeReason: entry.includeReason,
    skipReason: entry.skipReason,
    priorityScore: entry.priorityScore,
    truncated: entry.truncated,
    isBinaryLikely: entry.isBinaryLikely || undefined,
    isGeneratedLikely: entry.isGeneratedLikely || undefined,
    isVendorLikely: entry.isVendorLikely || undefined,
    isSecretLikely: entry.isSecretLikely || undefined
  };
}

function applySkippedToInventory(inventory: FileInventoryEntry[], skipped: SkippedFile[]): void {
  const byPath = new Map(inventory.map((entry) => [entry.path, entry]));
  for (const skippedFile of skipped) {
    const entry = byPath.get(skippedFile.path);
    if (!entry || entry.includeDecision === "included") continue;
    entry.skipReason = skippedFile.reason;
    entry.includeReason = skippedFile.reason;
    entry.includeDecision = "metadata_only";
  }
}

function cloneInventory(inventory: FileInventoryEntry[]): FileInventoryEntry[] {
  return inventory.map((entry) => ({ ...entry }));
}

function fileToInventoryEntry(file: ArchiveFile): FileInventoryEntry {
  const classification = classifyPath(file.path, file.size);
  return {
    path: file.path,
    kind: "file",
    extension: classification.extension,
    basename: file.path.split("/").pop() ?? file.path,
    language: classification.language,
    sizeBytes: file.size,
    gitBlobSha: file.gitBlobSha,
    isHidden: classification.isHidden,
    isBinaryLikely: classification.isBinaryLikely,
    isGeneratedLikely: classification.isGeneratedLikely,
    isVendorLikely: classification.isVendorLikely,
    isSecretLikely: classification.isSecretLikely,
    isEngineArtifactLikely: classification.isEngineArtifactLikely,
    includeDecision: classification.includeAs === "content" ? "metadata_only" : "metadata_only",
    includeReason: classification.reason,
    skipReason: classification.includeAs === "content" ? undefined : classification.reason,
    priorityScore: classification.priority
  };
}

function summarizeSkipped(skipped: SkippedFile[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const file of skipped) {
    counts.set(file.reason, (counts.get(file.reason) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function numberLines(content: string): string {
  const lines = content.split("\n");
  const width = String(lines.length).length;
  return lines.map((line, index) => `${String(index + 1).padStart(width, "0")} | ${line}`).join("\n");
}

function countLines(content: string): number {
  if (!content) return 0;
  return content.split("\n").length;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  let bytes = 0;
  for (const char of value) {
    const charBytes = byteLength(char);
    if (bytes + charBytes > maxBytes) break;
    result += char;
    bytes += charBytes;
  }
  return `${result}\n\n/* truncated */\n`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function profileLabel(profile: BundleProfile): string {
  switch (profile) {
    case "map_only":
      return "Map only";
    case "core_code":
      return "Core code";
    case "code_docs":
      return "Code + docs";
    case "all_useful_text":
      return "All useful text";
    case "all_safe_text_hidden":
      return "All safe text + hidden";
    case "forensic_inventory":
      return "Forensic inventory";
  }
}
