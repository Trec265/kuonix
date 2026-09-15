#!/usr/bin/env node
// Builds the Kuonix installer for the current OS: stages the JRE, jar and
// native decoder (scripts/stage.mjs --verify), then runs electron-builder.
//
// Usage: node scripts/dist.mjs <win|mac|linux> [--arch=x64|arm64] [--skip-stage]
//
// Signing is used when credentials are in the environment and skipped
// otherwise (see docs in electron-builder.yml and scripts/notarize.cjs).

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = { win32: "win", darwin: "mac", linux: "linux" }[process.platform];

const [target, ...rest] = process.argv.slice(2);
const flags = new Map(rest.map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));
const arch = flags.get("arch") ?? process.arch;

if (!["win", "mac", "linux"].includes(target)) {
  console.error("Usage: node scripts/dist.mjs <win|mac|linux> [--arch=x64|arm64] [--skip-stage]");
  process.exit(1);
}
if (target !== HOST) {
  console.error(`Cannot build the ${target} installer on ${process.platform}: the bundled JRE and native decoder are OS-specific. Use the CI workflow.`);
  process.exit(1);
}
if (arch !== process.arch) {
  console.error(`Cannot build ${arch} on a ${process.arch} host: jlink produces a runtime for the host architecture only.`);
  process.exit(1);
}

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { cwd: FRONTEND, stdio: "inherit", shell: false });
  if (res.error) throw res.error;
  if (res.status !== 0) process.exit(res.status ?? 1);
}

if (!flags.has("skip-stage")) {
  run(process.execPath, [path.join("scripts", "stage.mjs"), "--verify"]);
}

const builderArgs = [`--${target}`, `--${arch}`, "--publish", "never"];

// Without a Developer ID certificate, ad-hoc sign instead of skipping signing:
// Apple Silicon refuses to launch a bundle whose signature was invalidated by
// adding the JRE and decoder.
if (target === "mac" && !process.env.CSC_LINK && !process.env.CSC_NAME
    && process.env.CSC_IDENTITY_AUTO_DISCOVERY !== "true") {
  console.log("No macOS signing certificate configured: using ad-hoc signing (unsigned build).");
  builderArgs.push("-c.mac.identity=-");
}

const builderCli = path.join(FRONTEND, "node_modules", "electron-builder", "cli.js");
run(process.execPath, [builderCli, ...builderArgs]);
