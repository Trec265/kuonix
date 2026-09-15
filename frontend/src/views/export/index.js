// Export — save corrected images to the user-visible workspace folder.
//
// v1 mechanism: call /color-correct/apply with an identity transform
// (exposure gain=1.0) per image. This re-encodes the latest committed
// baseline into the workspace as a JPG. Real per-image corrections are
// already saved by the agent's commitCorrection chain; "Export" finalises
// them into the user's visible workspace.
//
// A future backend endpoint could swap this for a true filesystem copy
// (preserves original encoding); the UI contract here doesn't need to
// change when that happens.

import { gsap } from "../../../node_modules/gsap/index.js";
import { enterView, isReduced } from "../../motion.js";
import * as state from "../../state.js";
import { navigate } from "../../router.js";
import { toast } from "../../components/toast/index.js";
import { exportImage } from "../../api/endpoints/correction.js";
import { escapeHtml } from "../../utils/escape-html.js";

let ctx = null;
let unsubs = [];
let outletRef = null;
let queue = null;       // { items: [{path, name, status, output, error}], running, cancelled }
let viewState = { targetDir: null };  // persists across renders

export function mount(outlet) {
  outletRef = outlet;
  outlet.innerHTML = "";

  const view = document.createElement("section");
  view.className = "view export-view";
  view.dataset.view = "export";
  outlet.appendChild(view);

  view.innerHTML = template();

  bindActions(view);
  render(view);

  unsubs.push(state.on("images", () => render(view)));

  ctx = enterView(outlet);
}

export function unmount() {
  for (const off of unsubs) try { off(); } catch {}
  unsubs = [];
  if (queue) queue.cancelled = true;
  queue = null;
  ctx?.revert?.();
  ctx = null;
  outletRef = null;
}

// ---------------------------------------------------------------------------

function template() {
  return `
    <header class="view-header export__header">
      <div>
        <p class="eyebrow">Export</p>
        <h1 class="display-heading">Send your work</h1>
        <p class="muted export__subtitle"></p>
      </div>
    </header>

    <div class="export__grid reveal">
      <section class="export__panel" data-panel="settings">
        <h3 class="export__panel-title"><i class="bi bi-gear"></i> Settings</h3>

        <label class="export__field stack-row">
          <span>Target</span>
          <select data-field="target">
            <option value="workspace" selected>Workspace folder (~/Kuonix)</option>
            <option value="folder">Choose folder…</option>
          </select>
        </label>

        <div class="export__folder-path stack-row" data-folder-path hidden>
          <i class="bi bi-folder2-open"></i>
          <span data-folder-label>No folder selected</span>
          <button class="export__folder-change" data-action="change-folder">Change</button>
        </div>

        <label class="export__field stack-row">
          <span>Format</span>
          <select data-field="format">
            <option value="jpg" selected>JPEG (.jpg)</option>
            <option value="png">PNG (.png) · lossless</option>
            <option value="tiff">TIFF 16-bit (.tiff)</option>
          </select>
        </label>

        <label class="export__field stack-row" data-quality-field>
          <span>JPEG Quality &mdash; <span data-quality-value>95</span></span>
          <input type="range" min="1" max="100" value="95" step="1" data-field="quality" class="export__slider">
        </label>

        <label class="export__field stack-row">
          <span>Naming</span>
          <select data-field="naming">
            <option value="suffix" selected>Original + algorithm suffix</option>
            <option value="original">Original filename</option>
            <option value="timestamp">Timestamp prefix</option>
          </select>
        </label>

        <div class="export__hint stack-row">
          <i class="bi bi-info-circle"></i>
          Each export re-encodes the latest committed baseline for the selected format.
          Re-exporting the same image is safe — existing files are overwritten only if
          the filename matches.
        </div>
      </section>

      <section class="export__panel" data-panel="queue">
        <header class="export__panel-head stack-row">
          <h3 class="export__panel-title"><i class="bi bi-collection-play"></i> Queue</h3>
          <div class="export__queue-actions">
            <button class="btn btn--ghost" data-action="select-all">
              <i class="bi bi-check2-square"></i> Select all ready
            </button>
            <button class="btn btn--accent" data-action="run" disabled>
              <i class="bi bi-cloud-arrow-down"></i> <span data-run-label>Export</span>
            </button>
          </div>
        </header>

        <div class="export__list" data-list></div>

        <div class="export__progress" data-progress hidden>
          <div class="export__progress-bar"><div data-bar></div></div>
          <div class="export__progress-text" data-progress-text></div>
        </div>
      </section>
    </div>

    <style>
      .export-view { padding: var(--space-32) var(--space-32) var(--space-48); }
      .export__header {
        width: min(960px, calc(100% - var(--space-48)));
        margin: 0 auto var(--space-24);
      }
      .export__subtitle { margin-top: 6px; }

      .export__grid {
        display: flex;
        flex-direction: column;
        width: min(960px, calc(100% - var(--space-48)));
        max-width: 960px;
        margin: 0 auto;
        gap: var(--space-32);
      }

      .export__panel {
        padding: 0 0 var(--space-24);
        border-bottom: 0.5px solid var(--color-border);
      }
      .export__panel-head {
        display: flex; justify-content: space-between; align-items: center;
        gap: var(--space-16); margin-bottom: var(--space-12); flex-wrap: wrap;
        padding-top: var(--space-8);
      }
      .export__panel-title {
        margin: 0; font-size: var(--font-size-lg); letter-spacing: 0.02em;
        text-transform: uppercase; color: var(--color-text-secondary);
        display: flex; align-items: center; gap: 8px;
      }
      .export__panel[data-panel="queue"] .export__panel-title { margin-bottom: 0; }
      .export__queue-actions { display: flex; gap: 8px; }

      .export__field {
        display: grid; grid-template-columns: minmax(120px, 1fr) minmax(0, 1.6fr);
        margin-bottom: 0;
        max-width: 620px;
      }
      .export__field span {
        display: block; font-size: 12px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.05em;
        color: var(--color-text-secondary); margin-bottom: 0;
      }
      .export__field select {
        width: 100%; padding: 8px 12px; border-radius: 10px;
        background: var(--color-secondary); border: 1px solid var(--color-border);
        color: var(--color-text); font-size: 13px;
      }
      .export__folder-path {
        display: flex; align-items: center; gap: 8px;
        margin: -8px 0 14px; padding: 8px 12px; border-radius: 10px;
        background: var(--color-secondary); border: 1px solid var(--color-border);
        font-size: 12px; color: var(--color-text-secondary);
      }
      .export__folder-path span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .export__folder-change {
        flex-shrink: 0; background: none; border: none; cursor: pointer;
        font-size: 11px; color: rgb(var(--accent-color-rgb)); padding: 0;
      }
      .export__slider {
        width: 100%; accent-color: var(--accent-color);
        height: 4px; cursor: pointer; margin-top: 4px;
      }

      .export__hint {
        max-width: 620px;
        margin-top: var(--space-16); padding: var(--space-12) 0;
        background: rgba(var(--accent-color-rgb), 0.08);
        font-size: 12px; line-height: 1.5; color: var(--color-text);
      }
      .export__hint i { color: rgb(var(--accent-color-rgb)); margin-right: 6px; }
      .export__hint code {
        background: var(--color-secondary); padding: 1px 6px; border-radius: 4px;
        font-size: 11px;
      }

      .export__list {
        display: flex; flex-direction: column; gap: 8px;
        max-height: 520px; overflow-y: auto; padding-right: 4px;
      }
      .export-row {
        display: grid;
        grid-template-columns: 24px 56px 1fr auto auto;
        align-items: center; gap: 12px;
        padding: var(--space-10) 0; border-radius: 0;
        background: var(--color-secondary); border: 1px solid transparent;
        transition: border-color var(--duration-fast) var(--ease-standard);
      }
      .export-row.is-selected { border-color: var(--accent-color); }
      .export-row__check {
        width: 20px; height: 20px; border-radius: 5px;
        display: flex; align-items: center; justify-content: center;
        background: var(--color-background); border: 1.5px solid var(--color-border);
        cursor: pointer; color: transparent; font-size: 12px;
      }
      .export-row.is-selected .export-row__check {
        background: var(--accent-color); border-color: transparent; color: #fff;
      }
      .export-row__thumb {
        width: 56px; height: 56px; border-radius: 8px; overflow: hidden;
        background: var(--color-background);
        display: flex; align-items: center; justify-content: center;
      }
      .export-row__thumb img { width: 100%; height: 100%; object-fit: cover; }
      .export-row__thumb i { color: var(--color-text-secondary); font-size: 22px; }
      .export-row__meta { min-width: 0; }
      .export-row__name {
        font-size: 13px; font-weight: 500;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .export-row__sub {
        font-size: 11px; color: var(--color-text-secondary); margin-top: 2px;
      }
      .export-row__state {
        padding: 3px 8px; border-radius: 6px; font-size: 10px;
        text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;
        background: var(--color-background); color: var(--color-text-secondary);
      }
      .export-row__state.is-ready    { background: rgba(76,175,80,0.18);  color: #4caf50; }
      .export-row__state.is-busy     { background: rgba(33,128,141,0.18); color: var(--accent-color); }
      .export-row__state.is-done     { background: rgba(76,175,80,0.85);  color: var(--color-surface); }
      .export-row__state.is-failed   { background: rgba(227,87,71,0.18);  color: #e35747; }
      .export-row__state.is-skipped  { background: rgba(150,150,150,0.18); color: var(--color-text-secondary); }
      .export-row__action { color: var(--color-text-secondary); font-size: 16px; }

      .export__empty {
        text-align: center; padding: 48px 24px;
        color: var(--color-text-secondary);
      }
      .export__empty i { font-size: 48px; opacity: 0.4; display: block; margin-bottom: 14px; }

      .export__progress { margin-top: 14px; }
      .export__progress-bar {
        height: 4px; border-radius: 2px;
        background: var(--color-secondary); overflow: hidden;
      }
      .export__progress-bar > div {
        width: 0%; height: 100%; background: var(--accent-color);
      }
      .export__progress-text {
        margin-top: 6px; font-size: 12px; color: var(--color-text-secondary);
      }

      @media (max-width: 720px) {
        .export-view { padding-inline: var(--space-20); }
        .export__header,
        .export__grid {
          width: 100%;
        }
        .export__field {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: var(--space-6);
        }
        .export__field span { margin-bottom: 0; }
        .export__queue-actions {
          width: 100%;
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-8);
        }
        .export__queue-actions .btn { flex: 1 1 160px; }
        .export-row {
          grid-template-columns: 24px 48px minmax(0, 1fr) auto;
          gap: var(--space-8);
        }
        .export-row__thumb { width: 48px; height: 48px; }
        .export-row__action { display: none; }
      }
    </style>
  `;
}

function bindActions(view) {
  view.addEventListener("click", async (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "select-all") {
      const ready = state.get("images").filter((r) => r.state === "ready");
      const allSel = ready.length > 0 && ready.every((r) => r.selected);
      ready.forEach((r) => state.toggleSelected(r.path, !allSel));
    } else if (action === "run") {
      runQueue(view);
    } else if (action === "change-folder") {
      await pickFolder(view);
    }
  });

  // Target select → folder picker
  view.querySelector("[data-field='target']")?.addEventListener("change", async (e) => {
    if (e.target.value === "folder") {
      const picked = await pickFolder(view);
      if (!picked) e.target.value = "workspace";  // revert if cancelled
    } else {
      viewState.targetDir = null;
      view.querySelector("[data-folder-path]").hidden = true;
    }
  });

  // Format select → show/hide quality slider
  view.querySelector("[data-field='format']")?.addEventListener("change", (e) => {
    const qField = view.querySelector("[data-quality-field]");
    if (qField) qField.hidden = e.target.value !== "jpg";
  });

  // Quality range → update label
  view.querySelector("[data-field='quality']")?.addEventListener("input", (e) => {
    const lbl = view.querySelector("[data-quality-value]");
    if (lbl) lbl.textContent = e.target.value;
  });
}

async function pickFolder(view) {
  if (!window.dialog?.selectFolder) {
    toast.error("Folder picker is not available.");
    return null;
  }
  const result = await window.dialog.selectFolder();
  if (!result) return null;
  viewState.targetDir = result;
  const pathEl = view.querySelector("[data-folder-path]");
  const labelEl = view.querySelector("[data-folder-label]");
  if (pathEl) pathEl.hidden = false;
  if (labelEl) labelEl.textContent = result;
  return result;
}

function getSettings(view) {
  return {
    format:    view.querySelector("[data-field='format']")?.value   ?? "jpg",
    quality:   parseInt(view.querySelector("[data-field='quality']")?.value ?? "95", 10),
    naming:    view.querySelector("[data-field='naming']")?.value   ?? "suffix",
    targetDir: viewState.targetDir || null,
  };
}

function render(view) {
  const images = state.get("images");
  const ready = images.filter((r) => r.state === "ready");
  const sel = ready.filter((r) => r.selected);

  const subtitle = view.querySelector(".export__subtitle");
  subtitle.textContent = ready.length === 0
    ? "Nothing ready to export yet — finish edits, then come back."
    : `${ready.length} ready · ${sel.length} selected for export`;

  const list = view.querySelector("[data-list]");
  if (ready.length === 0) {
    list.innerHTML = `
      <div class="export__empty">
        <i class="bi bi-cloud-slash"></i>
        <p>Edit and accept some corrections first, then queue them here.</p>
        <button class="btn btn--accent" data-action="goto-edit"
                onclick="window.location.hash = '#/edit'">
          <i class="bi bi-arrow-left"></i> Back to Edit
        </button>
      </div>
    `;
  } else {
    const format = view.querySelector("[data-field='format']")?.value ?? "jpg";
    list.innerHTML = ready.map((r) => rowHtml(r, format)).join("");
    list.querySelectorAll(".export-row").forEach((row) => {
      row.addEventListener("click", () => state.toggleSelected(row.dataset.path));
    });
  }

  const runBtn = view.querySelector("[data-action='run']");
  runBtn.disabled = sel.length === 0 || (queue && queue.running);
  view.querySelector("[data-run-label]").textContent =
    sel.length === 0 ? "Export" : `Export ${sel.length}`;

  if (!isReduced) {
    gsap.from([...view.querySelectorAll(".export-row")], {
      opacity: 0, x: -8, duration: 0.25, ease: "expo.out",
      stagger: { each: 0.02, from: "start" }, clearProps: "all",
    });
  }
}

function rowHtml(img, format) {
  const path = String(img.path || "");
  const name = String(img.name || path.split(/[\\/]/).pop() || "");
  const thumb = img.url
    ? `<img src="${escapeHtml(img.url)}" alt="${escapeHtml(name)}">`
    : `<i class="bi bi-image"></i>`;
  const fmtLabel = format === "png" ? "PNG" : format === "tiff" ? "TIFF" : "JPEG";
  return `
    <div class="export-row ${img.selected ? "is-selected" : ""}" data-path="${escapeHtml(path)}">
      <div class="export-row__check"><i class="bi bi-check"></i></div>
      <div class="export-row__thumb">${thumb}</div>
      <div class="export-row__meta">
        <div class="export-row__name">${escapeHtml(name)}</div>
        <div class="export-row__sub">${(img.issues || []).length} issue${(img.issues || []).length === 1 ? "" : "s"} · ${fmtLabel}</div>
      </div>
      <span class="export-row__state is-ready">Ready</span>
      <i class="bi bi-arrow-right export-row__action"></i>
    </div>
  `;
}

// ---- Queue runner ------------------------------------------------------

async function runQueue(view) {
  const sel = state.get("images").filter((r) => r.selected && r.state === "ready");
  if (!sel.length) return;

  const { format, quality, naming, targetDir } = getSettings(view);

  queue = {
    items: sel.map((r) => ({ path: r.path, name: r.name || r.path, status: "pending", output: null, error: null })),
    running: true,
    cancelled: false,
  };

  const list = view.querySelector("[data-list]");
  const bar = view.querySelector("[data-bar]");
  const progress = view.querySelector("[data-progress]");
  const progressText = view.querySelector("[data-progress-text]");
  progress.hidden = false;

  view.querySelector("[data-action='run']").disabled = true;

  let done = 0;
  let failed = 0;

  for (const item of queue.items) {
    if (queue.cancelled) { item.status = "skipped"; continue; }
    item.status = "busy";
    setRowState(list, item.path, "is-busy", "Exporting…");

    try {
      const res = await exportImage({
        method: "exposure",
        parameters: { gain: 1.0 },
        imagePath: item.path,
        region: null,
        format,
        quality,
        targetDir,
        naming,
      });
      if (res?.success === false) throw new Error(res.errorMessage || "Export failed");
      item.status = "done";
      item.output = res?.outputPath || null;
      setRowState(list, item.path, "is-done", "Exported");
    } catch (err) {
      console.error("export", err);
      item.status = "failed";
      item.error = err?.message || String(err);
      failed++;
      setRowState(list, item.path, "is-failed", "Failed");
    }

    done++;
    const pct = Math.round((done / queue.items.length) * 100);
    if (isReduced) bar.style.width = pct + "%";
    else gsap.to(bar, { width: pct + "%", duration: 0.3, ease: "linear" });
    progressText.textContent = `${done} of ${queue.items.length} done${failed ? ` · ${failed} failed` : ""}`;
  }

  queue.running = false;
  view.querySelector("[data-action='run']").disabled = state.get("images").filter((r) => r.selected && r.state === "ready").length === 0;

  const fmtLabel = format === "png" ? "PNG" : format === "tiff" ? "TIFF" : "JPEG";
  const ok = queue.items.filter((i) => i.status === "done").length;
  if (failed === 0) toast.success(`Exported ${ok} image${ok === 1 ? "" : "s"} as ${fmtLabel}.`);
  else if (ok === 0) toast.error(`Export failed for all ${failed} images.`);
  else toast.warning(`Exported ${ok} as ${fmtLabel}, ${failed} failed.`);
}

function setRowState(listEl, path, cls, label) {
  const row = listEl.querySelector(`.export-row[data-path="${cssEscape(path)}"]`);
  if (!row) return;
  const badge = row.querySelector(".export-row__state");
  badge.className = "export-row__state " + cls;
  badge.textContent = label;
}

function cssEscape(s) {
  // Lightweight escape for attribute selectors over user-supplied paths.
  return String(s).replace(/(["\\])/g, "\\$1");
}
