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
  "dist",
  "node_modules",
  "out",
  "target",
  "tmp",
  "vendor"
]);

const GENERATED_FILENAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "composer.lock",
  "poetry.lock",
  "cargo.lock",
  "gemfile.lock"
]);

const TEXT_EXTENSIONS = new Set([
  ".astro",
  ".c",
  ".cc",
  ".cfg",
  ".clj",
  ".cljs",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".cxx",
  ".dart",
  ".dockerfile",
  ".env",
  ".erl",
  ".ex",
  ".exs",
  ".fs",
  ".gd",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".less",
  ".lua",
  ".m",
  ".md",
  ".mdx",
  ".ml",
  ".mli",
  ".php",
  ".pl",
  ".properties",
  ".proto",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sass",
  ".scala",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
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
  ".lockb",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".otf",
  ".pdf",
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
  "agents.md",
  "dockerfile",
  "package.json",
  "readme.md",
  "tsconfig.json",
  "vite.config.ts",
  "webpack.config.js"
]);

export interface FileDecision {
  include: boolean;
  reason?: string;
}

export function shouldConsiderFile(path: string, size: number): FileDecision {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  const segments = normalized.split("/");
  const filename = segments[segments.length - 1].toLowerCase();

  for (const segment of segments.slice(0, -1)) {
    if (EXCLUDED_DIRS.has(segment.toLowerCase())) {
      return { include: false, reason: `excluded directory: ${segment}` };
    }
  }

  if (GENERATED_FILENAMES.has(filename)) {
    return { include: false, reason: "generated or lock file" };
  }

  if (size > 600_000) {
    return { include: false, reason: "single file exceeds 600 KB" };
  }

  const ext = extensionFor(filename);
  if (BINARY_EXTENSIONS.has(ext)) {
    return { include: false, reason: "binary or archive file" };
  }

  if (TEXT_EXTENSIONS.has(ext) || KEY_FILENAMES.has(filename) || filename.startsWith(".env")) {
    return { include: true };
  }

  return { include: false, reason: "unsupported file type" };
}

export function priorityForPath(path: string): number {
  const lower = path.toLowerCase();
  const filename = lower.split("/").pop() ?? lower;

  if (filename === "agents.md") return 0;
  if (filename === "readme.md" || filename === "package.json") return 10;
  if (filename.includes("config") || filename === "tsconfig.json" || filename === "dockerfile") return 20;
  if (lower.startsWith("src/") || lower.includes("/src/")) return 30;
  if (lower.startsWith("app/") || lower.includes("/app/")) return 35;
  if (lower.includes("test") || lower.includes("spec")) return 45;
  if (lower.startsWith("docs/") || lower.includes("/docs/")) return 50;
  return 80;
}

export function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, Math.min(bytes.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return true;
  }
  return false;
}

function extensionFor(filename: string): string {
  if (filename === "dockerfile") return ".dockerfile";
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index);
}
