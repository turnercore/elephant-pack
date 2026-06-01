import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const projectLocation = resolve(root, "safari");
const appName = "Repo Context Uploader";
const bundleIdentifier = "com.elephanthand.Repo-Context-Uploader";

rmSync(projectLocation, { recursive: true, force: true });

const result = spawnSync(
  "xcrun",
  [
    "safari-web-extension-packager",
    "dist-safari",
    "--project-location",
    projectLocation,
    "--app-name",
    appName,
    "--bundle-identifier",
    bundleIdentifier,
    "--macos-only",
    "--swift",
    "--copy-resources",
    "--no-open",
    "--no-prompt",
    "--force"
  ],
  { cwd: root, stdio: "inherit" }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

rmSync(resolve(projectLocation, appName, `${appName}.xcodeproj/xcuserdata`), { recursive: true, force: true });
rmSync(resolve(projectLocation, appName, `${appName}.xcodeproj/project.xcworkspace/xcuserdata`), {
  recursive: true,
  force: true
});

const projectFile = resolve(projectLocation, appName, `${appName}.xcodeproj/project.pbxproj`);
const project = readFileSync(projectFile, "utf8").replaceAll(/MACOSX_DEPLOYMENT_TARGET = [^;]+;/g, "MACOSX_DEPLOYMENT_TARGET = 14.0;");
writeFileSync(projectFile, project);
