import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const chromeDist = resolve(root, "dist");
const safariDist = resolve(root, "dist-safari");
const manifestPath = resolve(safariDist, "manifest.json");

rmSync(safariDist, { recursive: true, force: true });
mkdirSync(safariDist, { recursive: true });
cpSync(chromeDist, safariDist, { recursive: true });

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.background && "type" in manifest.background) {
  delete manifest.background.type;
}

manifest.permissions = (manifest.permissions ?? []).filter((permission) => permission !== "downloads");

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
