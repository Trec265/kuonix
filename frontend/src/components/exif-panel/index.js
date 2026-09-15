// EXIF panel — collapsible strip below the image stage in single-image mode.
// Injects its own <style> once on first use.

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    .exif-panel {
      border-top: 1px solid var(--color-border); background: var(--color-surface);
    }
    .exif-panel__toggle {
      width: 100%; display: flex; align-items: center; gap: 8px;
      padding: 8px 16px; background: transparent; border: 0;
      color: var(--color-text-secondary); font-size: 12px; font-weight: 500;
      cursor: pointer; text-align: left;
      transition: color var(--duration-fast) var(--ease-standard);
    }
    .exif-panel__toggle:hover { color: var(--color-text); }
    .exif-panel__toggle .bi-camera2 { font-size: 13px; }
    .exif-panel__toggle span { flex: 1; }
    .exif-panel__chev { font-size: 10px; transition: transform 0.2s; }
    .exif-panel__body { padding: 4px 16px 12px; }
    .exif-panel__grid {
      display: grid; grid-template-columns: 110px 1fr;
      gap: 4px 12px; font-size: 12px;
    }
    .exif-panel__label { color: var(--color-text-secondary); font-weight: 500; padding: 1px 0; }
    .exif-panel__value { color: var(--color-text); padding: 1px 0; }
    .exif-panel__empty { font-size: 12px; color: var(--color-text-secondary); font-style: italic; }
  `;
  document.head.appendChild(s);
}
// Module-gated: only mounted when window.__kuonixConfig.modules.cameraFeedback is true.
// Displays camera, lens, ISO, aperture, shutter speed, focal length from image EXIF.

import * as state from "../../state.js";
import { escapeHtml } from "../../utils/escape-html.js";

const LS_KEY = "kuonix.exifPanelOpen";

export function createExifPanel() {
  injectStyles();
  const root = document.createElement("div");
  root.className = "exif-panel";

  let expanded = localStorage.getItem(LS_KEY) === "true";
  let unsub = null;

  root.innerHTML = `
    <button class="exif-panel__toggle" aria-expanded="${expanded}" aria-controls="exif-panel-body">
      <i class="bi bi-camera2"></i>
      <span>Camera info</span>
      <i class="bi bi-chevron-down exif-panel__chev"></i>
    </button>
    <div class="exif-panel__body" id="exif-panel-body" ${expanded ? "" : "hidden"}>
      <div class="exif-panel__grid" data-exif-grid></div>
    </div>
  `;

  const toggle  = root.querySelector(".exif-panel__toggle");
  const body    = root.querySelector(".exif-panel__body");
  const chev    = root.querySelector(".exif-panel__chev");
  const grid    = root.querySelector("[data-exif-grid]");

  function setExpanded(on) {
    expanded = on;
    toggle.setAttribute("aria-expanded", String(on));
    body.hidden = !on;
    chev.style.transform = on ? "rotate(180deg)" : "";
    localStorage.setItem(LS_KEY, String(on));
  }

  toggle.addEventListener("click", () => setExpanded(!expanded));

  function render(exif) {
    if (!exif) { grid.innerHTML = `<span class="exif-panel__empty">No EXIF data available.</span>`; return; }
    const rows = [
      ["Camera",        exif.camera],
      ["Lens",          exif.lens],
      ["ISO",           exif.iso != null ? String(exif.iso) : null],
      ["Aperture",      exif.aperture != null ? `f/${Number(exif.aperture).toFixed(1)}` : null],
      ["Shutter",       exif.shutterSpeed],
      ["Focal length",  exif.focalLength != null ? `${Number(exif.focalLength).toFixed(0)} mm` : null],
      ["White balance", exif.wbMode],
      ["Captured",      exif.captureTime],
    ].filter(([, v]) => v != null && v !== "");

    if (!rows.length) { grid.innerHTML = `<span class="exif-panel__empty">No EXIF data available.</span>`; return; }
    grid.innerHTML = rows.map(([label, value]) =>
      `<span class="exif-panel__label">${escapeHtml(label)}</span><span class="exif-panel__value">${escapeHtml(value)}</span>`
    ).join("");
  }

  function syncFromState() {
    const path = state.get("currentImagePath");
    const img  = path ? state.get("images").find((r) => r.path === path) : null;
    render(img?.exif ?? null);
  }

  function bind() {
    syncFromState();
    const unsubPath   = state.on("currentImagePath", syncFromState);
    const unsubImages = state.on("images", syncFromState);
    const unsubImage  = state.on("image", syncFromState);   // active card's exif may arrive via update/rename
    unsub = () => { unsubPath(); unsubImages(); unsubImage(); };
  }

  function destroy() {
    unsub?.();
    unsub = null;
    root.remove();
  }

  return { el: root, bind, destroy };
}
