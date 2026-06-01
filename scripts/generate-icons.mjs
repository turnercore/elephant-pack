import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const sourceIcon = resolve(root, "public/brand/elephant-pack-logo.png");
const iconDir = resolve(root, "public/icons");
const sizes = [16, 32, 48, 128, 256, 512];

mkdirSync(iconDir, { recursive: true });

for (const size of sizes) {
  const output = resolve(iconDir, `icon-${size}.png`);
  rmSync(output, { force: true });

  const result = spawnSync("sips", ["-z", String(size), String(size), sourceIcon, "--out", output], {
    stdio: "ignore"
  });

  if (result.status !== 0) {
    if (size === 512) {
      copyFileSync(sourceIcon, output);
      continue;
    }
    throw new Error(`Failed to generate ${size}px icon from ${sourceIcon}.`);
  }
}
