import { looksBinary, priorityForPath, shouldConsiderFile } from "./fileRules";
import type { ArchiveFile, BundleResult, GithubRepoMetadata, IncludedFile, SkippedFile } from "./types";
import { sanitizeRefForFilename } from "./repoInput";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });
const MAX_TREE_ENTRIES = 1_200;
const MAX_SKIPPED_ENTRIES = 350;
const PER_FILE_TRUNCATION_BYTES = 180_000;

export function buildMarkdownBundle(params: {
  metadata: GithubRepoMetadata;
  ref: string;
  files: ArchiveFile[];
  maxBytes: number;
  generatedAt?: string;
  treePaths?: string[];
  preSkipped?: SkippedFile[];
  warnings?: string[];
}): BundleResult {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const treePaths = (params.treePaths?.length ? params.treePaths : params.files.map((file) => file.path)).sort((a, b) =>
    a.localeCompare(b)
  );
  const skipped: SkippedFile[] = [...(params.preSkipped ?? [])];
  const warnings = [...(params.warnings ?? [])];

  const candidates = params.files
    .map((file) => ({ file, decision: shouldConsiderFile(file.path, file.size) }))
    .filter((entry) => {
      if (!entry.decision.include) {
        skipped.push({ path: entry.file.path, reason: entry.decision.reason ?? "excluded", size: entry.file.size });
        return false;
      }
      if (looksBinary(entry.file.bytes)) {
        skipped.push({ path: entry.file.path, reason: "binary content detected", size: entry.file.size });
        return false;
      }
      return true;
    })
    .sort((a, b) => priorityForPath(a.file.path) - priorityForPath(b.file.path) || a.file.path.localeCompare(b.file.path));

  const included: IncludedFile[] = [];
  let header = headerMarkdown(params.metadata, params.ref, generatedAt, params.maxBytes, treePaths, warnings);
  const fileContentsHeading = "\n\n## File Contents\n";
  let sections = "";
  const reserveBytes = Math.min(140_000, Math.max(18_000, Math.floor(params.maxBytes * 0.14)));

  for (const { file } of candidates) {
    const text = decoder.decode(file.bytes);
    const normalizedText = text.replace(/\r\n/g, "\n");
    const truncated = byteLength(normalizedText) > PER_FILE_TRUNCATION_BYTES;
    const fileText = truncated ? truncateUtf8(normalizedText, PER_FILE_TRUNCATION_BYTES) : normalizedText;
    const section = fileSectionMarkdown(file.path, file.size, fileText, truncated);
    const nextBytes = byteLength(header) + byteLength(fileContentsHeading) + byteLength(sections) + byteLength(section) + reserveBytes;

    if (nextBytes > params.maxBytes) {
      skipped.push({ path: file.path, reason: "bundle size cap reached", size: file.size });
      continue;
    }

    included.push({ path: file.path, size: file.size, content: fileText, truncated });
    sections += section;
  }

  if (included.length === 0) {
    warnings.push("No source files fit the current bundle cap after filtering. Increase the cap or use a narrower repo/ref.");
  }

  header = headerMarkdown(params.metadata, params.ref, generatedAt, params.maxBytes, treePaths, warnings);
  const summary = summaryMarkdown(included, skipped, params.files.length, treePaths.length);
  const skippedSection = skippedSectionMarkdown(skipped);
  let content = `${header}${summary}${fileContentsHeading}${sections}${skippedSection}`;

  if (byteLength(content) > params.maxBytes) {
    warnings.push("Bundle metadata exceeded the selected cap, so the skipped-file details were shortened.");
    header = headerMarkdown(params.metadata, params.ref, generatedAt, params.maxBytes, treePaths, warnings);
    content = `${header}${summary}${fileContentsHeading}${sections}${skippedSectionMarkdown(skipped, 80)}`;
  }

  const filename = `${params.metadata.owner}-${params.metadata.repo}-${sanitizeRefForFilename(params.ref)}-chatgpt-context.md`;
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
    warnings
  };
}

function headerMarkdown(
  metadata: GithubRepoMetadata,
  ref: string,
  generatedAt: string,
  maxBytes: number,
  treePaths: string[],
  warnings: string[]
): string {
  const tree = renderDirectoryTree(treePaths, MAX_TREE_ENTRIES);
  const warningText = warnings.length ? `\n## Build Warnings\n${warnings.map((warning) => `- ${warning}`).join("\n")}\n` : "";

  return `# Repository Context Bundle for ChatGPT

This file was generated to give ChatGPT enough source context for debugging, code review, architecture review, and feature planning. It intentionally favors manifests, configuration, source files, tests, and docs over generated files, dependencies, binaries, build output, and possible secrets.

## Suggested Use
- Ask for a first-pass architecture map before requesting edits.
- For debugging, include the observed error, expected behavior, reproduction steps, and relevant runtime logs in your chat message.
- For feature planning, name the existing feature or system this should build on.
- Treat omitted files as unavailable unless listed in the directory tree or skipped-file section.

## Repository Metadata
- Repository: ${metadata.owner}/${metadata.repo}
- Source URL: ${metadata.htmlUrl}
- Ref: ${ref}
- Default branch: ${metadata.defaultBranch}
- Private repository: ${metadata.private ? "yes" : "no"}
- Generated at: ${generatedAt}
- Bundle cap: ${formatBytes(maxBytes)} (${maxBytes.toLocaleString()} bytes)

${warningText}## Directory Tree

\`\`\`text
${tree}
\`\`\`
`;
}

function summaryMarkdown(included: IncludedFile[], skipped: SkippedFile[], fetchedCount: number, treeCount: number): string {
  const includedBytes = included.reduce((sum, file) => sum + file.size, 0);
  const byReason = summarizeSkipped(skipped);
  const index = included
    .map((file) => `- ${file.path} (${formatBytes(file.size)}${file.truncated ? ", truncated" : ""})`)
    .join("\n");
  const skippedSummary = byReason.length ? byReason.map(([reason, count]) => `- ${reason}: ${count}`).join("\n") : "- None";

  return `

## Bundle Summary
- Files in repository tree: ${treeCount}
- Files fetched for possible inclusion: ${fetchedCount}
- Files included in this bundle: ${included.length}
- Included source bytes before Markdown overhead: ${formatBytes(includedBytes)}
- Files skipped or omitted: ${skipped.length}

### Skipped/Omitted Summary
${skippedSummary}

### Included File Index
${index || "No files included."}
`;
}

function fileSectionMarkdown(path: string, size: number, content: string, truncated: boolean): string {
  const language = languageForPath(path);
  const truncationNote = truncated ? "\n> Note: This file was truncated because it exceeded the per-file size guard.\n" : "";

  return `

### ${path}
- Size: ${formatBytes(size)}${truncationNote}

\`\`\`${language}
${content.replaceAll("```", "``\\`")}
\`\`\`
`;
}

function skippedSectionMarkdown(skipped: SkippedFile[], maxEntries = MAX_SKIPPED_ENTRIES): string {
  if (skipped.length === 0) {
    return "\n\n## Skipped and Omitted Files\nNo files skipped.\n";
  }

  const shown = skipped.sort((a, b) => a.path.localeCompare(b.path)).slice(0, maxEntries);
  const remaining = skipped.length - shown.length;
  const lines = shown.map((file) => `- ${file.path}${file.size == null ? "" : ` (${formatBytes(file.size)})`}: ${file.reason}`);
  if (remaining > 0) {
    lines.push(`- ... ${remaining} more skipped/omitted files not shown to keep this bundle compact.`);
  }

  return `\n\n## Skipped and Omitted Files\n${lines.join("\n")}\n`;
}

function renderDirectoryTree(paths: string[], maxEntries: number): string {
  if (paths.length === 0) return ".\n";
  const shown = paths.slice(0, maxEntries);
  const root: TreeNode = { children: new Map(), file: false };

  for (const path of shown) {
    const segments = path.split("/").filter(Boolean);
    let node = root;
    for (const [index, segment] of segments.entries()) {
      let child = node.children.get(segment);
      if (!child) {
        child = { children: new Map(), file: index === segments.length - 1 };
        node.children.set(segment, child);
      }
      if (index === segments.length - 1) child.file = true;
      node = child;
    }
  }

  const lines = ["."];
  renderTreeNode(root, "", lines);
  if (paths.length > shown.length) {
    lines.push(`... ${paths.length - shown.length} more paths omitted from tree display`);
  }
  return lines.join("\n");
}

interface TreeNode {
  children: Map<string, TreeNode>;
  file: boolean;
}

function renderTreeNode(node: TreeNode, prefix: string, lines: string[]): void {
  const entries = Array.from(node.children.entries()).sort(([aName, aNode], [bName, bNode]) => {
    if (aNode.file !== bNode.file) return aNode.file ? 1 : -1;
    return aName.localeCompare(bName);
  });

  entries.forEach(([name, child], index) => {
    const isLast = index === entries.length - 1;
    lines.push(`${prefix}${isLast ? "`--" : "|--"} ${name}`);
    if (child.children.size > 0) {
      renderTreeNode(child, `${prefix}${isLast ? "    " : "|   "}`, lines);
    }
  });
}

function summarizeSkipped(skipped: SkippedFile[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const file of skipped) {
    counts.set(file.reason, (counts.get(file.reason) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function languageForPath(path: string): string {
  const lower = path.toLowerCase();
  const ext = lower.split(".").pop();
  if (lower.endsWith("dockerfile")) return "dockerfile";

  switch (ext) {
    case "cs":
      return "csharp";
    case "css":
      return "css";
    case "gd":
      return "gdscript";
    case "go":
      return "go";
    case "html":
      return "html";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "lua":
      return "lua";
    case "md":
    case "mdx":
      return "markdown";
    case "py":
      return "python";
    case "rb":
      return "ruby";
    case "rs":
      return "rust";
    case "sh":
      return "bash";
    case "sql":
      return "sql";
    case "ts":
    case "tsx":
      return "typescript";
    case "xml":
      return "xml";
    case "yml":
    case "yaml":
      return "yaml";
    default:
      return ext ?? "";
  }
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
