#!/usr/bin/env node
// Launches the packaged (unpacked) Kuonix app from release/ with Java scrubbed
// from the environment and checks the acceptance criteria:
//   - the backend starts from the bundled JRE and bundled jar
//   - it listens on 127.0.0.1 and /admin/health answers 200
//   - the bundled dcraw_emu decodes a RAW (when KUONIX_SMOKE_RAW points at one)
//   - killing the app leaves no backend process behind
//
// Usage: node scripts/smoke-packaged.mjs
// Env:   KUONIX_SMOKE_RAW=/path/to/file.dng   optional RAW for a decode check
//        KUONIX_SMOKE_WRAPPER="xvfb-run -a"     optional launcher prefix (headless Linux)
//        KUONIX_SMOKE_EXE / KUONIX_SMOKE_RESOURCES  test an installed copy instead of release/

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = path.join(FRONTEND, "release");

function findApp() {
  // An installed copy (e.g. /opt/Kuonix from the .deb) instead of release/.
  if (process.env.KUONIX_SMOKE_EXE && process.env.KUONIX_SMOKE_RESOURCES) {
    return { exe: process.env.KUONIX_SMOKE_EXE, resources: process.env.KUONIX_SMOKE_RESOURCES };
  }
  const dirs = fs.existsSync(RELEASE) ? fs.readdirSync(RELEASE) : [];
  if (process.platform === "win32") {
    const d = dirs.find((n) => n === "win-unpacked");
    return d && { exe: path.join(RELEASE, d, "Kuonix.exe"), resources: path.join(RELEASE, d, "resources") };
  }
  if (process.platform === "darwin") {
    const d = dirs.find((n) => n.startsWith("mac") && fs.existsSync(path.join(RELEASE, n, "Kuonix.app")));
    const app = d && path.join(RELEASE, d, "Kuonix.app");
    return app && { exe: path.join(app, "Contents", "MacOS", "Kuonix"), resources: path.join(app, "Contents", "Resources") };
  }
  const d = dirs.find((n) => n === "linux-unpacked");
  return d && { exe: path.join(RELEASE, d, "kuonix"), resources: path.join(RELEASE, d, "resources") };
}

function userDataDir() {
  if (process.platform === "win32") return path.join(process.env.APPDATA, "Kuonix");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Kuonix");
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "Kuonix");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function get(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return { status: res.status, body: await res.text() };
  } catch {
    return null;
  }
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const app = findApp();
if (!app || !fs.existsSync(app.exe)) {
  console.error(`No unpacked app found under ${RELEASE}; run electron-builder first.`);
  process.exit(1);
}

// Minimal environment: no JAVA_HOME, system-only PATH, nothing that makes
// Electron behave as plain Node.
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(JAVA_HOME|JDK_HOME|ELECTRON_|VSCODE_)/i.test(key)) delete env[key];
}
env.PATH = process.platform === "win32"
  ? `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`
  : "/usr/bin:/bin:/usr/sbin:/sbin";

const logFile = path.join(userDataDir(), "logs", "backend.log");
fs.rmSync(logFile, { force: true });

const wrapper = (process.env.KUONIX_SMOKE_WRAPPER ?? "").split(" ").filter(Boolean);
const launchArgs = process.platform === "linux" ? ["--no-sandbox"] : [];
const [cmd, ...cmdArgs] = [...wrapper, app.exe, ...launchArgs];
console.log(`Launching ${[cmd, ...cmdArgs].join(" ")}`);
const child = spawn(cmd, cmdArgs, { env, stdio: "inherit", detached: process.platform !== "win32" });

let port = null;
let javaPath = null;
let backendPid = null;
const started = Date.now();
while (Date.now() - started < 180_000 && !(port && backendPid)) {
  await sleep(500);
  if (!fs.existsSync(logFile)) continue;
  const log = fs.readFileSync(logFile, "utf8");
  javaPath = /^java=(.*)$/m.exec(log)?.[1]?.trim() ?? javaPath;
  port = Number(/^port=(\d+)$/m.exec(log)?.[1]) || port;
  backendPid = Number(/\sINFO (\d+) ---/.exec(log)?.[1]) || backendPid;
}

check("backend launched", Boolean(javaPath && port && backendPid), `pid=${backendPid} port=${port}`);
check("uses bundled JRE", Boolean(javaPath) && path.resolve(javaPath).startsWith(path.resolve(app.resources, "jre")), javaPath ?? "no java path");

let healthy = false;
while (port && Date.now() - started < 180_000) {
  const h = await get(`http://127.0.0.1:${port}/admin/health`);
  if (h?.status === 200) { healthy = true; break; }
  await sleep(500);
}
check("health check on 127.0.0.1", healthy, `${((Date.now() - started) / 1000).toFixed(1)}s after launch`);

if (healthy && process.env.KUONIX_SMOKE_RAW) {
  const raw = process.env.KUONIX_SMOKE_RAW;
  const form = new FormData();
  form.append("files", new Blob([fs.readFileSync(raw)]), path.basename(raw));
  const up = await fetch(`http://127.0.0.1:${port}/images/upload-raw`, { method: "POST", body: form }).then((r) => r.json()).catch((e) => ({ error: e.message }));
  const info = up.images?.[0];
  check("RAW preview decode (bundled dcraw_emu)", Boolean(up.success && info?.width > 0), info ? `${info.width}x${info.height}` : JSON.stringify(up));
  let full = null;
  for (let i = 0; info && i < 180 && !full; i++) {
    await sleep(1000);
    const ev = await get(`http://127.0.0.1:${port}/images/decode-status?taskIds=${info.taskId}`);
    const e = ev && JSON.parse(ev.body)[0];
    if (e && ["complete", "error", "missing"].includes(e.status)) full = e;
  }
  check("RAW full decode", full?.status === "complete", full?.error ?? full?.status ?? "timed out");
}

// 503 = reachable, no Ollama key configured (expected on a clean machine);
// 200 = configured, stream opened (aborted as soon as headers arrive).
const agentAbort = new AbortController();
const agentTimer = setTimeout(() => agentAbort.abort(), 60_000);
const agent = healthy ? await fetch(`http://127.0.0.1:${port}/agent/chat`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ sessionId: "packaging-smoke", message: "Reply with the single word: ok" }),
  signal: agentAbort.signal,
}).then((r) => { agentAbort.abort(); return r.status; }).catch(() => null) : null;
clearTimeout(agentTimer);
check("agent endpoint reachable", agent === 503 || agent === 200, `HTTP ${agent}`);

// Hard-kill only the Electron main process (the backend's parent, which the
// backend logs): no quit handlers run, so the backend must go away on its own
// (parent-PID watchdog; on Windows also the kill-on-close job object).
const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
const electronPid = Number(/Watching parent process (\d+)/.exec(log)?.[1]) || child.pid;
if (process.platform === "win32") {
  spawn("taskkill", ["/pid", String(electronPid), "/F"], { stdio: "ignore" });
} else {
  try { process.kill(electronPid, "SIGKILL"); } catch {}
}
const killedAt = Date.now();
while (backendPid && alive(backendPid) && Date.now() - killedAt < 20_000) await sleep(250);
check("no orphaned backend after app is killed", Boolean(backendPid) && !alive(backendPid), `${((Date.now() - killedAt) / 1000).toFixed(1)}s`);
const stillListening = port ? await get(`http://127.0.0.1:${port}/admin/health`) : null;
check("port released", !stillListening, `port ${port}`);

// Clean up whatever is left of the launcher (renderer/GPU helpers, xvfb-run).
if (process.platform === "win32") {
  spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
} else {
  try { process.kill(-child.pid, "SIGKILL"); } catch {}
}

process.exit(results.every((r) => r.ok) ? 0 : 1);
