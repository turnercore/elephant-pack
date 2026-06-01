import type { BundleProfile, FileCategory, FileClassification } from "./types";

const EXCLUDED_DIRS = new Set([".git", ".hg", ".svn", ".cache", ".next", ".nuxt", ".parcel-cache", ".turbo", ".vite"]);
const VENDOR_DIRS = new Set(["bower_components", "node_modules", "vendor"]);
const BUILD_DIRS = new Set(["build", "coverage", "debug", "deriveddata", "dist", "library", "logs", "obj", "out", "temp", "target", "tmp", "user"]);
const ENGINE_ARTIFACT_DIRS = new Set(["library", "temp", "obj", "deriveddata"]);
const EXCLUDED_PATH_PARTS = new Set([".ds_store", ".vs", ".vscode-test", "__macosx"]);

const GENERATED_FILENAMES = new Set([
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "yarn.lock"
]);

const SECRET_FILENAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".npmrc",
  "credentials.json",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519"
]);

const TEXT_EXTENSIONS = new Set([
  ".asmdef",
  ".astro",
  ".c",
  ".cc",
  ".cfg",
  ".cginc",
  ".clj",
  ".cljs",
  ".conf",
  ".cpp",
  ".cs",
  ".csproj",
  ".css",
  ".csv",
  ".cxx",
  ".dart",
  ".dockerfile",
  ".editorconfig",
  ".env.example",
  ".erl",
  ".ex",
  ".exs",
  ".fs",
  ".gd",
  ".gdshader",
  ".glsl",
  ".godot",
  ".go",
  ".gradle",
  ".graphql",
  ".h",
  ".hcl",
  ".hpp",
  ".hlsl",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".lua",
  ".m",
  ".mat",
  ".md",
  ".mdx",
  ".ml",
  ".mli",
  ".mm",
  ".php",
  ".pl",
  ".prefab",
  ".properties",
  ".props",
  ".proto",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".shader",
  ".sh",
  ".sln",
  ".sql",
  ".svelte",
  ".swift",
  ".targets",
  ".templ",
  ".tf",
  ".toml",
  ".tres",
  ".ts",
  ".tscn",
  ".tsx",
  ".txt",
  ".unity",
  ".uss",
  ".uxml",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zig"
]);

const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".a",
  ".avi",
  ".bmp",
  ".br",
  ".class",
  ".dll",
  ".dmg",
  ".doc",
  ".docx",
  ".eot",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".key",
  ".lockb",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".otf",
  ".p12",
  ".pdf",
  ".pem",
  ".png",
  ".ppt",
  ".pptx",
  ".rar",
  ".so",
  ".sqlite",
  ".tar",
  ".tgz",
  ".ttf",
  ".wasm",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".xls",
  ".xlsx",
  ".zip"
]);

const KEY_FILENAMES = new Set([
  ".dockerignore",
  ".editorconfig",
  ".eslintrc",
  ".eslintrc.cjs",
  ".eslintrc.js",
  ".eslintrc.json",
  ".gitattributes",
  ".gitignore",
  ".prettierrc",
  ".prettierrc.json",
  "agents.md",
  "dockerfile",
  "makefile",
  "package.json",
  "pyproject.toml",
  "readme.md",
  "requirements.txt",
  "tsconfig.json",
  "vite.config.ts",
  "webpack.config.js"
]);

const MAX_SINGLE_FILE_BYTES = 600_000;
const ALL_CONTENT_PROFILES: BundleProfile[] = ["core_code", "code_docs", "all_useful_text", "all_safe_text_hidden", "forensic_inventory"];
const DOC_PROFILES: BundleProfile[] = ["code_docs", "all_useful_text", "all_safe_text_hidden", "forensic_inventory"];
const ALL_TEXT_PROFILES: BundleProfile[] = ["all_useful_text", "all_safe_text_hidden", "forensic_inventory"];
const HIDDEN_TEXT_PROFILES: BundleProfile[] = ["all_safe_text_hidden", "forensic_inventory"];

export interface FileDecision {
  include: boolean;
  reason?: string;
}

export function classifyPath(path: string, size: number): FileClassification {
  const normalized = normalizePath(path);
  const segments = normalized.split("/").filter(Boolean);
  const filenameOriginal = segments[segments.length - 1] ?? "";
  const filename = filenameOriginal.toLowerCase();
  const extension = extensionFor(filename);
  const isHidden = segments.some((segment) => segment.startsWith("."));
  const segmentFlags = classifySegments(segments.slice(0, -1));
  const priority = priorityForPath(normalized);

  if (!filename) {
    return baseClassification(normalized, size, "skip", "unknown", null, extension, priority, "empty file path", [], isHidden, segmentFlags);
  }

  if (segmentFlags.excludedPathPart) {
    return baseClassification(
      normalized,
      size,
      "skip",
      "unknown",
      null,
      extension,
      priority,
      `excluded path part: ${segmentFlags.excludedPathPart}`,
      [],
      isHidden,
      segmentFlags
    );
  }

  if (isSecretFilename(filename)) {
    return baseClassification(normalized, size, "metadata_only", "secret", null, extension, priority, "possible secret/config credential file", [], isHidden, segmentFlags);
  }

  if (extension && BINARY_EXTENSIONS.has(extension)) {
    return baseClassification(normalized, size, "metadata_only", "binary", null, extension, priority, "binary or archive file", [], isHidden, segmentFlags);
  }

  if (segmentFlags.vendor) {
    return baseClassification(normalized, size, "metadata_only", "vendor", languageForPath(normalized), extension, priority, "vendor/dependency directory", [], isHidden, segmentFlags);
  }

  if (segmentFlags.buildOutput || segmentFlags.excludedDirectory) {
    return baseClassification(
      normalized,
      size,
      "metadata_only",
      "build_output",
      languageForPath(normalized),
      extension,
      priority,
      segmentFlags.excludedDirectory ? `excluded directory: ${segmentFlags.excludedDirectory}` : "build output or cache directory",
      [],
      isHidden,
      segmentFlags
    );
  }

  if (GENERATED_FILENAMES.has(filename)) {
    return baseClassification(normalized, size, "metadata_only", "generated", languageForPath(normalized), extension, priority, "generated or lock file", [], isHidden, segmentFlags);
  }

  if (size > MAX_SINGLE_FILE_BYTES) {
    return baseClassification(
      normalized,
      size,
      "metadata_only",
      categoryForPath(normalized, filename, extension),
      languageForPath(normalized),
      extension,
      priority,
      `single file exceeds ${formatBytes(MAX_SINGLE_FILE_BYTES)}`,
      [],
      isHidden,
      segmentFlags
    );
  }

  if (!isRecognizedText(filename, extension)) {
    return baseClassification(normalized, size, "metadata_only", "unknown", null, extension, priority, "unsupported file type", [], isHidden, segmentFlags);
  }

  const category = categoryForPath(normalized, filename, extension);
  const eligibleProfiles = profilesForCategory(category, isHidden);
  const includeAs = eligibleProfiles.length ? "content" : "metadata_only";
  const reason = eligibleProfiles.length ? `${category} text file` : "safe hidden text requires hidden profile";

  return baseClassification(normalized, size, includeAs, category, languageForPath(normalized), extension, priority, reason, eligibleProfiles, isHidden, segmentFlags);
}

export function shouldIncludeForProfile(classification: FileClassification, profile: BundleProfile): boolean {
  return classification.includeAs === "content" && classification.eligibleProfiles.includes(profile);
}

export function shouldConsiderFile(path: string, size: number): FileDecision {
  const classification = classifyPath(path, size);
  if (classification.includeAs === "content") return { include: true };
  return { include: false, reason: classification.reason };
}

export function priorityForPath(path: string): number {
  const lower = path.toLowerCase();
  const filename = lower.split("/").pop() ?? lower;

  if (filename === "agents.md") return 0;
  if (filename === "readme.md" || filename === "package.json" || filename === "pyproject.toml") return 10;
  if (filename.includes("config") || filename === "tsconfig.json" || filename === "dockerfile") return 20;
  if (lower.startsWith("src/") || lower.includes("/src/")) return 30;
  if (lower.startsWith("app/") || lower.includes("/app/")) return 32;
  if (lower.startsWith("lib/") || lower.includes("/lib/")) return 35;
  if (lower.startsWith("components/") || lower.includes("/components/")) return 38;
  if (lower.includes("test") || lower.includes("spec")) return 45;
  if (lower.startsWith("docs/") || lower.includes("/docs/")) return 50;
  if (lower.startsWith("scripts/") || lower.includes("/scripts/")) return 55;
  if (lower.startsWith("public/") || lower.includes("/public/")) return 70;
  return 80;
}

export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, Math.min(bytes.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

export function languageForPath(path: string): string | null {
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
      return ext ?? null;
  }
}

export function extensionForPath(path: string): string | null {
  const filename = path.toLowerCase().split("/").pop() ?? "";
  return extensionFor(filename);
}

function baseClassification(
  path: string,
  _size: number,
  includeAs: "content" | "metadata_only" | "skip",
  category: FileCategory,
  language: string | null,
  extension: string | null,
  priority: number,
  reason: string,
  eligibleProfiles: BundleProfile[],
  isHidden: boolean,
  flags: SegmentFlags
): FileClassification {
  return {
    path,
    include: includeAs === "content",
    includeAs,
    category,
    language,
    extension,
    priority,
    reason,
    eligibleProfiles,
    isHidden,
    isBinaryLikely: category === "binary",
    isGeneratedLikely: category === "generated",
    isVendorLikely: category === "vendor" || flags.vendor,
    isSecretLikely: category === "secret",
    isEngineArtifactLikely: flags.engineArtifact
  };
}

interface SegmentFlags {
  excludedDirectory?: string;
  excludedPathPart?: string;
  vendor: boolean;
  buildOutput: boolean;
  engineArtifact: boolean;
}

function classifySegments(segments: string[]): SegmentFlags {
  const flags: SegmentFlags = { vendor: false, buildOutput: false, engineArtifact: false };
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (EXCLUDED_PATH_PARTS.has(lower)) flags.excludedPathPart = segment;
    if (EXCLUDED_DIRS.has(lower)) flags.excludedDirectory = segment;
    if (VENDOR_DIRS.has(lower)) flags.vendor = true;
    if (BUILD_DIRS.has(lower)) flags.buildOutput = true;
    if (ENGINE_ARTIFACT_DIRS.has(lower)) flags.engineArtifact = true;
  }
  return flags;
}

function profilesForCategory(category: FileCategory, isHidden: boolean): BundleProfile[] {
  if (isHidden && category !== "manifest" && category !== "config") return HIDDEN_TEXT_PROFILES;
  switch (category) {
    case "manifest":
    case "config":
    case "source":
    case "test":
    case "script":
      return ALL_CONTENT_PROFILES;
    case "docs":
      return DOC_PROFILES;
    case "asset_text":
      return ALL_TEXT_PROFILES;
    default:
      return [];
  }
}

function categoryForPath(path: string, filename: string, extension: string | null): FileCategory {
  const lower = path.toLowerCase();
  if (KEY_FILENAMES.has(filename) || filename.includes("config") || extension === ".json" || extension === ".toml" || extension === ".yaml" || extension === ".yml") {
    if (filename === "package.json" || filename === "pyproject.toml") return "manifest";
    return "config";
  }
  if (filename === "agents.md" || filename === "readme.md" || extension === ".md" || extension === ".mdx" || lower.startsWith("docs/") || lower.includes("/docs/")) {
    return "docs";
  }
  if (lower.includes("test") || lower.includes("spec")) return "test";
  if (lower.startsWith("scripts/") || lower.includes("/scripts/") || extension === ".sh") return "script";
  if (lower.startsWith("public/") || lower.includes("/public/") || extension === ".css" || extension === ".html") return "asset_text";
  if (TEXT_EXTENSIONS.has(extension ?? "")) return "source";
  return "unknown";
}

function isRecognizedText(filename: string, extension: string | null): boolean {
  return TEXT_EXTENSIONS.has(extension ?? "") || KEY_FILENAMES.has(filename) || isSafeDotEnvExample(filename);
}

function isSecretFilename(filename: string): boolean {
  if (SECRET_FILENAMES.has(filename)) return true;
  if (filename.startsWith(".env") && !isSafeDotEnvExample(filename)) return true;
  return filename.endsWith(".pem") || filename.endsWith(".key") || filename.endsWith(".p12");
}

function isSafeDotEnvExample(filename: string): boolean {
  return filename.startsWith(".env.") && (filename.endsWith("example") || filename.endsWith("sample"));
}

function extensionFor(filename: string): string | null {
  if (filename === "dockerfile") return ".dockerfile";
  if (filename === ".editorconfig") return ".editorconfig";
  if (filename.endsWith(".env.example")) return ".env.example";
  const index = filename.lastIndexOf(".");
  return index === -1 ? null : filename.slice(index);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
