const EXCLUDED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".turbo",
  ".vite",
  "bower_components",
  "build",
  "coverage",
  "debug",
  "deriveddata",
  "dist",
  "library",
  "logs",
  "node_modules",
  "obj",
  "out",
  "temp",
  "target",
  "tmp",
  "user",
  "vendor"
]);

const EXCLUDED_PATH_PARTS = new Set([
  ".ds_store",
  ".vs",
  ".vscode-test",
  "__macosx"
]);

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

export interface FileDecision {
  include: boolean;
  reason?: string;
}

export function shouldConsiderFile(path: string, size: number): FileDecision {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  const filename = segments[segments.length - 1]?.toLowerCase() ?? "";

  if (!filename) {
    return { include: false, reason: "empty file path" };
  }

  for (const segment of segments.slice(0, -1)) {
    const lowerSegment = segment.toLowerCase();
    if (EXCLUDED_DIRS.has(lowerSegment)) {
      return { include: false, reason: `excluded directory: ${segment}` };
    }
    if (EXCLUDED_PATH_PARTS.has(lowerSegment)) {
      return { include: false, reason: `excluded path part: ${segment}` };
    }
  }

  if (isSecretFilename(filename)) {
    return { include: false, reason: "possible secret/config credential file" };
  }

  if (GENERATED_FILENAMES.has(filename)) {
    return { include: false, reason: "generated or lock file" };
  }

  if (size > MAX_SINGLE_FILE_BYTES) {
    return { include: false, reason: `single file exceeds ${formatBytes(MAX_SINGLE_FILE_BYTES)}` };
  }

  const ext = extensionFor(filename);
  if (BINARY_EXTENSIONS.has(ext)) {
    return { include: false, reason: "binary or archive file" };
  }

  if (TEXT_EXTENSIONS.has(ext) || KEY_FILENAMES.has(filename) || isSafeDotEnvExample(filename)) {
    return { include: true };
  }

  return { include: false, reason: "unsupported file type" };
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

function isSecretFilename(filename: string): boolean {
  if (SECRET_FILENAMES.has(filename)) return true;
  if (filename.startsWith(".env") && !isSafeDotEnvExample(filename)) return true;
  return filename.endsWith(".pem") || filename.endsWith(".key") || filename.endsWith(".p12");
}

function isSafeDotEnvExample(filename: string): boolean {
  return filename.startsWith(".env.") && (filename.endsWith("example") || filename.endsWith("sample"));
}

function extensionFor(filename: string): string {
  if (filename === "dockerfile") return ".dockerfile";
  if (filename === ".editorconfig") return ".editorconfig";
  if (filename.endsWith(".env.example")) return ".env.example";
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
