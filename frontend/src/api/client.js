// fetch wrapper for the Java backend (loopback, port 8081 by default).
// Backend is the only source of truth — no port 8080.

// preload.js exposes the port main.js started the backend on for this launch;
// outside Electron (tests) the default applies.
export const BASE_URL = globalThis.kuonixBackend?.baseUrl ?? "http://127.0.0.1:8081";

export class ApiError extends Error {
  constructor(status, body) {
    super(`API ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

// Every request gets a deadline. A fetch that never settles used to hang its
// caller forever with no way back: the decode poller and the RAW pipeline both
// await these, and a single stalled request left images pinned at "decoding"
// for the rest of the session. Callers can override via `timeoutMs`, and an
// explicit `signal` still works — both are honoured.
const DEFAULT_TIMEOUT_MS = 120_000;
const UPLOAD_TIMEOUT_MS = 300_000;   // large RAW files over multipart

// Links a caller-supplied signal (if any) to a timeout, without relying on
// AbortSignal.any — Node 18 (used by the test runner) doesn't have it.
function withDeadline(timeoutMs, external) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), timeoutMs);
  if (external) {
    if (external.aborted) ctrl.abort(external.reason);
    else external.addEventListener("abort", () => ctrl.abort(external.reason), { once: true });
  }
  return { signal: ctrl.signal, clear: () => clearTimeout(timer) };
}

export async function apiJson(path, { timeoutMs = DEFAULT_TIMEOUT_MS, ...options } = {}) {
  const deadline = withDeadline(timeoutMs, options.signal);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: deadline.signal,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    if (res.status === 204) return null;
    return res.json();
  } finally {
    deadline.clear();
  }
}

export async function apiText(path, { timeoutMs = DEFAULT_TIMEOUT_MS, ...options } = {}) {
  const deadline = withDeadline(timeoutMs, options.signal);
  try {
    const res = await fetch(`${BASE_URL}${path}`, { ...options, signal: deadline.signal });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.text();
  } finally {
    deadline.clear();
  }
}

export async function apiUploadMultipart(path, files, fieldName = "files") {
  const fd = new FormData();
  for (const f of files) fd.append(fieldName, f);
  const deadline = withDeadline(UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST", body: fd, signal: deadline.signal,
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  } finally {
    deadline.clear();
  }
}

// Lightweight health check — used by app.js bootstrap to wait for backend.
export async function pingHealth(timeoutMs = 600) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/admin/health`, {
      signal: ctrl.signal,
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function waitForBackend({ attempts = 40, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (await pingHealth()) return true;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}
