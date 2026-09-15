// Style profile panel — collapsible section below the EXIF panel in single-image mode.
// Module-gated: only mounted when window.__kuonixConfig.modules.styleProfiles is true.
// Lets users add a single reference image or index a portfolio, select the active profile,
// and visualises the gap between the current image and the target look.

import * as state from "../../state.js";
import { listProfiles, createProfile, deleteProfile, indexPortfolio, getStyleGap } from "../../api/endpoints/styleProfiles.js";
import { toast } from "../toast/index.js";
import { escapeHtml } from "../../utils/escape-html.js";

const LS_KEY = "kuonix.styleProfilePanelOpen";
const ACCEPT = ".jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.cr2,.cr3,.nef,.arw,.dng,.raf,.orf,.raw,.rw2,.srw,.pef";

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    .sp-panel { border-top: 1px solid var(--color-border); background: var(--color-surface); }
    .sp-panel__toggle {
      width: 100%; display: flex; align-items: center; gap: 8px;
      padding: 8px 16px; background: transparent; border: 0;
      color: var(--color-text-secondary); font-size: 12px; font-weight: 500;
      cursor: pointer; text-align: left;
      transition: color var(--duration-fast) var(--ease-standard);
    }
    .sp-panel__toggle:hover { color: var(--color-text); }
    .sp-panel__toggle .bi-palette { font-size: 13px; }
    .sp-panel__toggle span { flex: 1; }
    .sp-panel__chev { font-size: 10px; transition: transform 0.2s; }
    .sp-panel__body { padding: 0 16px 14px; }

    .sp-tabs { display: flex; gap: 4px; margin-bottom: 12px; }
    .sp-tab {
      padding: 5px 12px; border-radius: 8px; border: 0;
      background: transparent; font-size: 12px; color: var(--color-text-secondary);
      cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .sp-tab:hover { color: var(--color-text); }
    .sp-tab.is-active { background: var(--color-secondary); color: var(--color-text); }

    .sp-add-btn {
      display: flex; align-items: center; gap: 6px;
      padding: 7px 12px; border-radius: 8px;
      border: 1px dashed var(--color-border); background: transparent;
      color: var(--color-text-secondary); font-size: 12px; cursor: pointer; width: 100%;
      transition: border-color 0.15s, color 0.15s;
    }
    .sp-add-btn:hover { border-color: rgb(var(--accent-color-rgb)); color: var(--color-text); }

    .sp-profiles { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
    .sp-profile-row {
      display: flex; align-items: center; gap: 8px; padding: 6px 8px;
      border-radius: 8px; border: 1px solid transparent;
      transition: border-color 0.15s, background 0.15s; cursor: pointer;
    }
    .sp-profile-row:hover { background: var(--color-secondary); }
    .sp-profile-row.is-active { border-color: rgba(var(--accent-color-rgb),0.5); background: rgba(var(--accent-color-rgb),0.07); }
    .sp-profile-row__name { flex: 1; font-size: 12px; font-weight: 500; }
    .sp-profile-row__del {
      padding: 2px 6px; border-radius: 5px; border: 0;
      background: transparent; color: var(--color-text-secondary); font-size: 11px;
      cursor: pointer; opacity: 0;
      transition: opacity 0.15s, color 0.15s;
    }
    .sp-profile-row:hover .sp-profile-row__del { opacity: 1; }
    .sp-profile-row__del:hover { color: #e05252; }

    .sp-portfolio-status { font-size: 11px; color: var(--color-text-secondary); margin-top: 6px; }

    .sp-gap { margin-top: 12px; }
    .sp-gap__title { font-size: 11px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--color-text-secondary); margin-bottom: 8px; }
    .sp-gap-bars { display: flex; flex-direction: column; gap: 5px; }
    .sp-gap-row { display: flex; align-items: center; gap: 8px; }
    .sp-gap-label { font-size: 11px; color: var(--color-text-secondary); width: 72px; flex-shrink: 0; }
    .sp-gap-bar-wrap {
      flex: 1; height: 6px; border-radius: 3px;
      background: var(--color-secondary); position: relative; overflow: hidden;
    }
    .sp-gap-bar {
      position: absolute; top: 0; height: 100%; border-radius: 3px;
      transition: width 0.3s, left 0.3s;
    }
    .sp-gap-bar--pos { background: rgba(var(--accent-color-rgb), 0.7); left: 50%; }
    .sp-gap-bar--neg { background: rgba(220, 100, 80, 0.7); right: 50%; }
    .sp-gap-delta { font-size: 11px; color: var(--color-text-secondary); width: 42px; text-align: right; font-variant-numeric: tabular-nums; }
    .sp-gap-none { font-size: 11px; color: var(--color-text-secondary); font-style: italic; }
  `;
  document.head.appendChild(s);
}

export function createStyleProfilePanel() {
  injectStyles();

  const root = document.createElement("div");
  root.className = "sp-panel";

  let expanded = localStorage.getItem(LS_KEY) === "true";
  let activeTab = "reference";
  let profiles = [];
  let portfolioStatus = null;
  let gapData = null;
  let unsubs = [];
  let gapFetchTimer = null;

  root.innerHTML = `
    <button class="sp-panel__toggle" aria-expanded="${expanded}" aria-controls="sp-panel-body">
      <i class="bi bi-palette"></i>
      <span>Style profile</span>
      <i class="bi bi-chevron-down sp-panel__chev"></i>
    </button>
    <div class="sp-panel__body" id="sp-panel-body" ${expanded ? "" : "hidden"}></div>
  `;

  const toggle = root.querySelector(".sp-panel__toggle");
  const body   = root.querySelector(".sp-panel__body");
  const chev   = root.querySelector(".sp-panel__chev");

  function setExpanded(on) {
    expanded = on;
    toggle.setAttribute("aria-expanded", String(on));
    body.hidden = !on;
    chev.style.transform = on ? "rotate(180deg)" : "";
    localStorage.setItem(LS_KEY, String(on));
    if (on) { loadProfiles(); scheduleGapFetch(); }
  }

  toggle.addEventListener("click", () => setExpanded(!expanded));

  // ---- Profile list ----

  async function loadProfiles() {
    try {
      profiles = await listProfiles() || [];
      renderBody();
    } catch { /* non-fatal */ }
  }

  function renderBody() {
    const activeId = state.get("activeProfileId");
    body.innerHTML = `
      <div class="sp-tabs">
        <button class="sp-tab ${activeTab === "reference" ? "is-active" : ""}" data-tab="reference">Reference</button>
        <button class="sp-tab ${activeTab === "portfolio" ? "is-active" : ""}" data-tab="portfolio">Portfolio</button>
      </div>
      ${activeTab === "reference" ? renderReference(activeId) : renderPortfolio()}
      ${renderGap(activeId)}
    `;
    bindBody();
  }

  function renderReference(activeId) {
    const list = profiles.length
      ? `<div class="sp-profiles">${profiles.map(p => `
          <div class="sp-profile-row ${p.id === activeId ? "is-active" : ""}" data-profile-id="${p.id}">
            <span class="sp-profile-row__name">${escapeHtml(p.name)}</span>
            <button class="sp-profile-row__del" data-delete="${p.id}" title="Delete"><i class="bi bi-trash3"></i></button>
          </div>`).join("")}
        </div>`
      : `<p class="sp-gap-none" style="margin:8px 0">No reference images yet.</p>`;
    return `
      <button class="sp-add-btn" data-action="add-reference">
        <i class="bi bi-plus-lg"></i> Add reference image
      </button>
      ${list}`;
  }

  function renderPortfolio() {
    const status = portfolioStatus ? `<p class="sp-portfolio-status">${portfolioStatus}</p>` : "";
    return `
      <button class="sp-add-btn" data-action="add-portfolio">
        <i class="bi bi-images"></i> Select portfolio images
      </button>
      ${status}`;
  }

  function renderGap(activeId) {
    if (!activeId || !gapData) return "";
    const { brightnessDelta: bd, contrastDelta: cd, saturationDelta: sd,
            castAngleDelta: ad, noiseDelta: nd } = gapData;
    const rows = [
      { label: "Brightness", delta: bd,  max: 1.0 },
      { label: "Contrast",   delta: cd,  max: 0.5 },
      { label: "Saturation", delta: sd,  max: 1.0 },
      { label: "Cast",       delta: ad,  max: 180  },
      { label: "Noise",      delta: nd,  max: 1.0 },
    ];
    const bars = rows.map(({ label, delta, max }) => {
      const pct   = Math.min(Math.abs(delta) / max * 50, 50);
      const pos   = delta > 0;
      const sign  = delta > 0 ? "+" : "";
      const fmtD  = typeof delta === "number" ? `${sign}${delta.toFixed(2)}` : "—";
      return `
        <div class="sp-gap-row">
          <span class="sp-gap-label">${label}</span>
          <div class="sp-gap-bar-wrap">
            <div class="sp-gap-bar ${pos ? "sp-gap-bar--pos" : "sp-gap-bar--neg"}"
                 style="width:${pct}%"></div>
          </div>
          <span class="sp-gap-delta">${fmtD}</span>
        </div>`;
    }).join("");
    return `<div class="sp-gap"><div class="sp-gap__title">Gap to target</div><div class="sp-gap-bars">${bars}</div></div>`;
  }

  function bindBody() {
    body.querySelectorAll(".sp-tab").forEach(btn =>
      btn.addEventListener("click", () => { activeTab = btn.dataset.tab; renderBody(); }));

    body.querySelector("[data-action='add-reference']")?.addEventListener("click", () => pickReference());
    body.querySelector("[data-action='add-portfolio']")?.addEventListener("click", () => pickPortfolio());

    body.querySelectorAll("[data-profile-id]").forEach(row => {
      row.addEventListener("click", (e) => {
        if (e.target.closest("[data-delete]")) return;
        const id = row.dataset.profileId;
        const next = state.get("activeProfileId") === id ? null : id;
        state.set("activeProfileId", next);
        gapData = null;
        renderBody();
        scheduleGapFetch();
      });
    });

    body.querySelectorAll("[data-delete]").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.dataset.delete;
        try {
          await deleteProfile(id);
          if (state.get("activeProfileId") === id) state.set("activeProfileId", null);
          await loadProfiles();
        } catch { toast.error("Could not delete profile."); }
      });
    });
  }

  // ---- File pickers ----

  function pickReference() {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ACCEPT });
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      input.remove();
      const file = input.files?.[0];
      if (!file) return;
      // Upload via the existing images upload endpoint to get a backend path,
      // then create a profile from that path.
      try {
        const { uploadJpeg, uploadRaw } = await import("../../api/endpoints/images.js");
        const isRaw = /\.(cr2|cr3|nef|arw|dng|raf|orf|raw|rw2|srw|pef)$/i.test(file.name);
        let backendPath;
        if (isRaw) {
          const res = await uploadRaw([file]);
          backendPath = res?.images?.[0]?.rawPath;
        } else {
          const res = await uploadJpeg([file]);
          backendPath = res?.paths?.[0];
        }
        if (!backendPath) throw new Error("Upload returned no path.");
        const name = file.name.replace(/\.[^.]+$/, "");
        await createProfile(name, backendPath);
        await loadProfiles();
        toast.success(`Reference "${name}" added.`);
      } catch (err) { toast.error(err?.message || "Could not add reference."); }
    });
    input.click();
  }

  function pickPortfolio() {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ACCEPT, multiple: true });
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      input.remove();
      const files = Array.from(input.files || []);
      if (!files.length) return;
      portfolioStatus = `Indexing ${files.length} image${files.length !== 1 ? "s" : ""}…`;
      renderBody();
      try {
        const { uploadJpeg } = await import("../../api/endpoints/images.js");
        const jpegFiles = files.filter(f => !/\.(cr2|cr3|nef|arw|dng|raf|orf|raw|rw2|srw|pef)$/i.test(f.name));
        const res = await uploadJpeg(jpegFiles.length ? jpegFiles : files);
        const paths = res?.paths || [];
        if (!paths.length) throw new Error("No images uploaded.");
        await indexPortfolio(paths);
        portfolioStatus = `Portfolio: ${paths.length} image${paths.length !== 1 ? "s" : ""} indexed.`;
        toast.success("Portfolio indexed.");
      } catch (err) {
        portfolioStatus = "Indexing failed.";
        toast.error(err?.message || "Could not index portfolio.");
      }
      renderBody();
    });
    input.click();
  }

  // ---- Gap fetching ----

  function scheduleGapFetch() {
    clearTimeout(gapFetchTimer);
    gapFetchTimer = setTimeout(fetchGap, 200);
  }

  async function fetchGap() {
    const profileId = state.get("activeProfileId");
    const path = state.get("currentImagePath");
    const img = path ? state.get("images").find(r => r.path === path) : null;
    if (!profileId || !path || img?.state !== "ready") { gapData = null; renderBody(); return; }
    try {
      const res = await getStyleGap(path, profileId);
      gapData = res?.gap || null;
      renderBody();
    } catch { gapData = null; }
  }

  // ---- State subscriptions ----

  function bind() {
    if (expanded) loadProfiles();
    const unsubPath    = state.on("currentImagePath", scheduleGapFetch);
    const unsubImages  = state.on("images", scheduleGapFetch);
    const unsubImage   = state.on("image", scheduleGapFetch);   // active card reaching "ready" arrives as a granular update
    const unsubProfile = state.on("activeProfileId", () => { gapData = null; renderBody(); scheduleGapFetch(); });
    unsubs = [unsubPath, unsubImages, unsubImage, unsubProfile];
  }

  function destroy() {
    clearTimeout(gapFetchTimer);
    for (const u of unsubs) u();
    unsubs = [];
    root.remove();
  }

  return { el: root, bind, destroy };
}
