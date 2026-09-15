#!/usr/bin/env node
// Stages the per-platform resources electron-builder ships outside the asar,
// for the OS/arch this script runs on (installers can't be cross-built):
//
//   staging/jre/                 trimmed Java runtime built with jlink
//   staging/backend/kuonix.jar   Spring Boot jar, freshly built by Gradle
//   staging/bin/<platform>/      LibRaw dcraw_emu + the libraries it loads
//
// main.js resolves the same layout from process.resourcesPath when packaged
// and from this staging/ directory in development.
//
// Usage: node scripts/stage.mjs [--skip-jar] [--skip-jre] [--skip-natives] [--verify]
// Requires a JDK 25 (JAVA_HOME or PATH) for Gradle and jlink.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESTFUL = path.resolve(FRONTEND, "..", "restful");
const STAGING = path.join(FRONTEND, "staging");
const PLATFORM = process.platform;
const ARCH = process.arch;
const EXE = PLATFORM === "win32" ? ".exe" : "";

// Modules the backend needs. Derived from
//   jdeps --ignore-missing-deps --multi-release 25 --print-module-deps --recursive
//         --class-path 'BOOT-INF/lib/*' BOOT-INF/classes
// plus modules only reached reflectively at runtime: java.logging/java.xml
// (Spring/Tomcat), jdk.charsets (EXIF text encodings), jdk.crypto.ec (TLS to
// Ollama Cloud), jdk.zipfs (nested-jar access).
const JLINK_MODULES = [
  "java.base", "java.compiler", "java.desktop", "java.instrument", "java.logging",
  "java.management", "java.naming", "java.net.http", "java.prefs", "java.rmi",
  "java.scripting", "java.security.jgss", "java.sql", "java.xml",
  "jdk.charsets", "jdk.crypto.ec", "jdk.jfr", "jdk.unsupported", "jdk.zipfs",
];

const args = new Set(process.argv.slice(2));

function run(cmd, cmdArgs, opts = {}) {
  console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} exited with ${res.status}`);
}

function javacppPlatform() {
  const os = { win32: "windows", darwin: "macosx", linux: "linux" }[PLATFORM];
  const cpu = { x64: "x86_64", arm64: "arm64" }[ARCH];
  if (!os || !cpu) throw new Error(`Unsupported build host ${PLATFORM}-${ARCH}`);
  return `${os}-${cpu}`;
}

function jdkTool(name) {
  const home = process.env.JAVA_HOME;
  if (home) {
    const candidate = path.join(home, "bin", name + EXE);
    if (fs.existsSync(candidate)) return candidate;
  }
  return name;
}

function copyInto(src, destDir, mode) {
  if (!fs.existsSync(src)) throw new Error(`Missing required file: ${src}`);
  const dest = path.join(destDir, path.basename(src));
  fs.copyFileSync(src, dest);
  if (mode) fs.chmodSync(dest, mode);
  return dest;
}

function stageJar() {
  const gradleArgs = ["bootJar", `-PjavacppPlatform=${javacppPlatform()}`, "--console=plain"];
  if (PLATFORM === "win32") {
    // Batch files need cmd.exe; /s + outer quotes keeps a spaced path intact.
    const gradlew = path.join(RESTFUL, "gradlew.bat");
    run("cmd.exe", ["/d", "/s", "/c", `""${gradlew}" ${gradleArgs.join(" ")}"`], {
      cwd: RESTFUL,
      windowsVerbatimArguments: true,
    });
  } else {
    run("./gradlew", gradleArgs, { cwd: RESTFUL });
  }
  const destDir = path.join(STAGING, "backend");
  fs.mkdirSync(destDir, { recursive: true });
  copyInto(path.join(RESTFUL, "build", "libs", "kuonix.jar"), destDir);
}

function stageJre() {
  const out = path.join(STAGING, "jre");
  fs.rmSync(out, { recursive: true, force: true });
  run(jdkTool("jlink"), [
    "--add-modules", JLINK_MODULES.join(","),
    "--strip-debug", "--no-man-pages", "--no-header-files",
    "--compress", "zip-6",
    "--output", out,
  ]);
}

function windowsVcRuntimeDir() {
  // Prefer Visual Studio's redistributable CRT folder (the sanctioned source for
  // app-local deployment); fall back to the system copies.
  const vswhere = path.join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (fs.existsSync(vswhere)) {
    const res = spawnSync(vswhere, ["-latest", "-products", "*", "-property", "installationPath"], { encoding: "utf8" });
    const redistRoot = path.join(res.stdout.trim(), "VC", "Redist", "MSVC");
    if (res.status === 0 && fs.existsSync(redistRoot)) {
      for (const ver of fs.readdirSync(redistRoot).sort().reverse()) {
        const x64 = path.join(redistRoot, ver, "x64");
        if (!fs.existsSync(x64)) continue;
        const crt = fs.readdirSync(x64).find((d) => /^Microsoft\.VC\d+\.CRT$/.test(d));
        if (crt) return path.join(x64, crt);
      }
    }
  }
  return path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
}

function stageNatives() {
  const src = path.join(FRONTEND, "bin", PLATFORM);
  const dest = path.join(STAGING, "bin", PLATFORM);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  if (PLATFORM === "win32") {
    if (ARCH !== "x64") throw new Error("Only an x64 dcraw_emu.exe is available for Windows");
    copyInto(path.join(src, "dcraw_emu.exe"), dest);
    copyInto(path.join(src, "libraw.dll"), dest);
    // dcraw_emu.exe and libraw.dll import the MSVC runtime, which a clean
    // Windows install doesn't guarantee. The exe's own directory is searched
    // first, so app-local copies are used.
    const vc = windowsVcRuntimeDir();
    for (const dll of ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"]) {
      copyInto(path.join(vc, dll), dest);
    }
  } else if (PLATFORM === "darwin") {
    // Universal (x86_64 + arm64) binary that links only system libraries.
    copyInto(path.join(src, "dcraw_emu"), dest, 0o755);
  } else if (PLATFORM === "linux") {
    if (ARCH !== "x64") throw new Error("Only an x64 dcraw_emu is built for Linux");
    const built = process.env.KUONIX_LINUX_DCRAW_EMU
      ?? path.join(FRONTEND, ".cache", "libraw-linux", "dcraw_emu");
    if (!fs.existsSync(built)) {
      run("bash", [path.join(FRONTEND, "scripts", "build-libraw-linux.sh"), path.dirname(built)]);
    }
    copyInto(built, dest, 0o755);
  } else {
    throw new Error(`Unsupported platform ${PLATFORM}`);
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function healthOk(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/admin/health", timeout: 1000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

// Boots the staged jar on the staged JRE with Java scrubbed from the
// environment, and checks the staged decoder runs.
async function verify() {
  const decoder = path.join(STAGING, "bin", PLATFORM, "dcraw_emu" + EXE);
  const probe = spawnSync(decoder, [], { encoding: "utf8" });
  if (probe.error || !/dcraw_emu/.test(`${probe.stdout}${probe.stderr}`)) {
    throw new Error(`Staged dcraw_emu failed to run: ${probe.error ?? probe.stderr}`);
  }
  console.log("dcraw_emu runs");

  const java = path.join(STAGING, "jre", "bin", "java" + EXE);
  const jar = path.join(STAGING, "backend", "kuonix.jar");
  const port = await freePort();
  const env = { ...process.env, DCRAW_PATH: decoder };
  delete env.JAVA_HOME;
  env.PATH = PLATFORM === "win32" ? `${process.env.SystemRoot}\\System32` : "/usr/bin:/bin";

  const child = spawn(java, [
    "--enable-native-access=ALL-UNNAMED", "-jar", jar,
    `--server.port=${port}`, "--server.address=127.0.0.1",
  ], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (d) => { output += d; });
  child.stderr.on("data", (d) => { output += d; });

  const started = Date.now();
  try {
    while (Date.now() - started < 180_000) {
      if (child.exitCode !== null) throw new Error(`Backend exited with ${child.exitCode}\n${output}`);
      if (await healthOk(port)) {
        console.log(`Backend healthy on staged JRE in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Backend did not become healthy within 180s\n${output}`);
  } finally {
    child.kill();
  }
}

console.log(`Staging Kuonix resources for ${PLATFORM}-${ARCH} into ${STAGING}`);
if (!args.has("--skip-jar")) stageJar();
if (!args.has("--skip-jre")) stageJre();
if (!args.has("--skip-natives")) stageNatives();
if (args.has("--verify")) await verify();
