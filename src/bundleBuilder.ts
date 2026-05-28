import { looksBinary, priorityForPath, shouldConsiderFile } from "./fileRules";
import type { ArchiveFile, BundleResult, GithubRepoMetadata, IncludedFile, SkippedFile } from "./types";
import { sanitizeRefForFilename } from "./repoInput";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });
const MAX_TREE_ENTRIES = 800;
const PER_FILE_TRUNCATION_BYTES = 220_000;

export function buildMarkdownBundle(params: {
  metadata: GithubRepoMetadata;
  ref: string;
  files: ArchiveFile[];
  maxBytes: number;
  generatedAt?: string;
}): BundleResult {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const treePaths = params.files.map((file) => file.path).sort((a, b) => a.localeCompare(b));
  const skipped: SkippedFile[] = [];

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
  let content = headerMarkdown(params.metadata, params.ref, generatedAt, params.maxBytes, treePaths);

  for (const { file } of candidates) {
    const text = decoder.decode(file.bytes);
    const normalizedText = text.replace(/\r\n/g, "\n");
    const truncated = encoder.encode(normalizedText).length > PER_FILE_TRUNCATION_BYTES;
    const fileText = truncated ? truncateUtf8(normalizedText, PER_FILE_TRUNCATION_BYTES) : normalizedText;
    const section = fileSectionMarkdown(file.path, fileText, truncated);
    const nextBytes = byteLength(content) + byteLength(section) + 2000;

    if (nextBytes > params.maxBytes) {
      skipped.push({ path: file.path, reason: "bundle size cap reached", size: file.size });
      continue;
    }

    included.push({ path: file.path, size: file.size, content: fileText, truncated });
    content += section;
  }

  content += skippedSectionMarkdown(skipped);

  const filename = `${params.metadata.owner}-${params.metadata.repo}-${sanitizeRefForFilename(params.ref)}-chatgpt-context.md`;
  return {
    filename,
    content,
    owner: params.metadata.owner,
    repo: params.metadata.repo,
    ref: params.ref,
    generatedAt,
    includedCount: included.length,
    skippedCount: skipped.length,
    bytes: byteLength(content)
  };
}

function headerMarkdown(
  metadata: GithubRepoMetadata,
  ref: string,
  generatedAt: string,
  maxBytes: number,
  treePaths: string[]
): string {
  const shownTree = treePaths.slice(0, MAX_TREE_ENTRIES);
  const remaining = treePaths.length - shownTree.length;
  const tree = shownTree.map((path) => `- ${path}`).join("\n");
  const treeTail = remaining > 0 ? `\n- ... ${remaining} more files omitted from tree display` : "";

  return `# GitHub Repository Context

## Metadata
- Repository: ${metadata.owner}/${metadata.repo}
- Source URL: ${metadata.htmlUrl}
- Ref: ${ref}
- Default branch: ${metadata.defaultBranch}
- Private repository: ${metadata.private ? "yes" : "no"}
- Generated at: ${generatedAt}
- Bundle cap: ${maxBytes} bytes

## File Tree
${tree}${treeTail}

## Included Files
`;
}

function fileSectionMarkdown(path: string, content: string, truncated: boolean): string {
  const language = languageForPath(path);
  const truncationNote = truncated
    ? "\n\n> Note: This file was truncated because it exceeded the per-file size guard.\n"
    : "";

  return `

### ${path}${truncationNote}

\`\`\`${language}
${content.replaceAll("```", "``\\`")}
\`\`\`
`;
}

function skippedSectionMarkdown(skipped: SkippedFile[]): string {
  if (skipped.length === 0) {
    return "\n\n## Skipped Files\nNo files skipped.\n";
  }

  const lines = skipped
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => `- ${file.path}${file.size == null ? "" : ` (${file.size} bytes`}: ${file.reason})`);

  return `\n\n## Skipped Files\n${lines.join("\n")}\n`;
}

function languageForPath(path: string): string {
  const ext = path.toLowerCase().split(".").pop();
  switch (ext) {
    case "js":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
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
