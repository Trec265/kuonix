// Library — session-wide gallery. Shows every image the user has uploaded so
// far this session, grouped by issue, with multiselect + "Open in Edit" jump.
//
// Clean masonry layout: fixed column buckets, intrinsic aspect ratios with
// [0.66, 1.9] clamping, minimal hover/focus metadata overlay.

import { gsap } from "../../../node_modules/gsap/index.js";
import { enterView, isReduced, dur, ease } from "../../motion.js";
import * as state from "../../state.js";
import { navigate } from "../../router.js";
import { toast } from "../../components/toast/index.js";
import { openLightbox } from "../../components/image-lightbox/index.js";
import { getIssueMeta, issueRgb } from "../../components/issue-meta.js";
import { escapeHtml } from "../../utils/escape-html.js";

let ctx = null;
let imagesUnsub = null;
let filterUnsub = null;
let activeUnsub = null;
let outletRef = null;
let particleCleanup = null;
let emptyAnimated = false;
let resizeObserver = null;

// Cache of image intrinsic dimensions { width, height, aspect, clampedRatio } keyed by path/url.
const dimCache = new Map();

const ROW_UNIT = 8;
const GAP_PX = 12;
const MIN_ASPECT = 0.66;
const MAX_ASPECT = 1.9;
const DEFAULT_ASPECT = 4 / 3;

function clampAspect(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return DEFAULT_ASPECT;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, ratio));
}

function computeSpan(colWidth, aspect) {
  const clamped = clampAspect(aspect);
  const w = Math.max(colWidth, 100);
  const tileHeight = w / clamped;
  return Math.max(1, Math.round((tileHeight + GAP_PX) / (ROW_UNIT + GAP_PX)));
}

function labelFor(id) { return getIssueMeta(id).label; }
function colorFor(id) { return issueRgb(id); }

export function mount(outlet) {
  outletRef = outlet;
  outlet.innerHTML = "";

  const view = document.createElement("section");
  view.className = "view library-view";
  view.dataset.view = "library";
  outlet.appendChild(view);

  view.innerHTML = `
    <header class="view-header library__header stack-row">
      <div>
        <p class="eyebrow">Library</p>
        <h1 class="display-heading">Session gallery</h1>
        <p class="muted library__subtitle"></p>
      </div>
      <div class="library__actions">
        <button class="btn btn--ghost" data-action="select-all">
          <i class="bi bi-check2-square"></i> Select all
        </button>
        <button class="btn btn--ghost" data-action="clear">
          <i class="bi bi-trash3"></i> Clear session
        </button>
        <button class="btn btn--accent" data-action="open" disabled>
          <i class="bi bi-arrow-up-right-square"></i> Open in Edit
        </button>
      </div>
    </header>

    <div class="library__filters reveal" data-filters></div>
    <div class="library__grid-wrap">
      <div class="library__grid reveal" data-grid tabindex="-1"></div>
    </div>
    <div class="library__empty" data-empty hidden>
      <div class="empty-stage">
        <canvas class="empty-particles" aria-hidden="true"></canvas>
        <img class="empty-illustration" src="src/assets/empty-library.svg"
             alt="" draggable="false" />
      </div>
      <p class="empty-headline">No Pictures</p>
      <p class="empty-sub">Drop RAW files onto the Edit view to begin.</p>
      <button class="btn btn--accent" data-action="goto-edit">
        <i class="bi bi-images"></i> Go to Edit
      </button>
    </div>

    <style>
      .library-view {
        padding: 28px 32px 80px;
        min-height: 100%;
        display: flex;
        flex-direction: column;
      }
      .library__header {
        display: flex; align-items: flex-end; justify-content: space-between;
        gap: 24px; margin-bottom: 20px; flex-wrap: wrap;
        flex-shrink: 0;
      }
      .library__subtitle { margin-top: 6px; }
      .library__actions { display: none; }

      .library__filters {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-bottom: 24px;
        padding-bottom: 16px;
        border-bottom: 0.5px solid var(--color-border);
        flex-shrink: 0;
      }
      .library__chip {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 12px; border-radius: 999px;
        background: var(--color-secondary); border: 1px solid var(--color-border);
        color: var(--color-text); font-size: 12px; cursor: pointer;
        transition: background var(--duration-fast) var(--ease-standard);
      }
      .library__chip:hover { background: var(--color-secondary-hover); }
      .library__chip.is-active {
        background: var(--accent-color); color: var(--color-surface); border-color: transparent;
        box-shadow: 0 2px 8px rgba(var(--accent-color-rgb), 0.3);
      }
      .library__chip__dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: rgb(var(--chip-rgb, 120, 120, 120));
      }
      .library__chip.is-active .library__chip__dot { background: var(--color-surface); }
      .library__chip__count { opacity: 0.7; font-variant-numeric: tabular-nums; }

      .library__grid-wrap {
        width: 100%;
        display: flex;
        justify-content: center;
        flex-shrink: 0;
      }

      /* Masonry layout using CSS Grid + JS row-spans.
         Fixed column count buckets:
           < 900px:  2 cols
           ≥ 1024px: 3 cols
           ≥ 1280px: 4 cols
           ≥ 1600px: 5 cols
         Container is capped and centered so tiles stay a sensible size on 4K. */
      .library__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-auto-rows: 8px;
        gap: var(--space-12, 12px);
        width: 100%;
        max-width: 1600px;
        margin: 0 auto;
      }
      @media (min-width: 1024px) {
        .library__grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
      @media (min-width: 1280px) {
        .library__grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
      @media (min-width: 1600px) {
        .library__grid {
          grid-template-columns: repeat(5, minmax(0, 1fr));
        }
      }

      .lib-card {
        position: relative;
        width: 100%;
        height: auto;
        min-height: 0;
        border-radius: var(--radius-lg, 12px);
        overflow: hidden;
        cursor: pointer;
        isolation: isolate;
        background: var(--color-secondary);
        border: none;
        outline: none;
        transition: box-shadow var(--duration-fast) var(--ease-standard),
                    transform var(--duration-fast) var(--ease-standard);
        user-select: none;
      }
      .lib-card:focus-visible {
        box-shadow: 0 0 0 2px var(--accent-color), 0 0 0 4px rgba(var(--accent-color-rgb), 0.3);
      }
      .lib-card.is-selected {
        box-shadow: 0 0 0 2px var(--accent-color), 0 4px 16px rgba(var(--accent-color-rgb), 0.25);
      }
      .lib-card.is-active:not(.is-selected) {
        box-shadow: 0 0 0 2px rgba(var(--accent-color-rgb), 0.5);
      }

      .lib-card__media-box {
        position: relative;
        width: 100%;
        overflow: hidden;
      }

      .lib-card__img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        transition: transform 0.35s var(--ease-standard), filter 0.35s var(--ease-standard);
      }
      .lib-card:hover .lib-card__img,
      .lib-card:focus-visible .lib-card__img {
        transform: scale(1.025);
      }
      .lib-card--low-res .lib-card__img {
        image-rendering: auto;
      }

      .lib-card__placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-secondary);
        font-size: 24px;
        background: var(--color-secondary);
      }

      /* Minimal Selection Check */
      .lib-card__check {
        position: absolute;
        top: 8px;
        left: 8px;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.45);
        color: #ffffff;
        border: 1.5px solid rgba(255, 255, 255, 0.65);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        opacity: 0;
        transform: scale(0.85);
        transition: opacity var(--duration-fast) var(--ease-standard),
                    transform var(--duration-fast) var(--ease-standard),
                    background var(--duration-fast) var(--ease-standard),
                    border-color var(--duration-fast) var(--ease-standard);
        z-index: 3;
      }
      .lib-card:hover .lib-card__check,
      .lib-card:focus .lib-card__check,
      .lib-card:focus-visible .lib-card__check,
      .lib-card:focus-within .lib-card__check,
      .lib-card.is-selected .lib-card__check {
        opacity: 1;
        transform: scale(1);
      }
      .lib-card.is-selected .lib-card__check {
        background: var(--accent-color);
        border-color: var(--accent-color);
      }

      /* Minimal Revealed Metadata Overlay on Hover / Focus */
      .lib-card__meta {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        padding: 24px 10px 8px;
        background: linear-gradient(to top, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 0.35) 60%, transparent 100%);
        color: #ffffff;
        font-size: 11px;
        line-height: 1.35;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity var(--duration-fast) var(--ease-standard),
                    transform var(--duration-fast) var(--ease-standard);
        pointer-events: none;
        z-index: 2;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .lib-card:hover .lib-card__meta,
      .lib-card:focus .lib-card__meta,
      .lib-card:focus-visible .lib-card__meta,
      .lib-card:focus-within .lib-card__meta {
        opacity: 1;
        transform: translateY(0);
      }
      .lib-card__name {
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #ffffff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
      }
      .lib-card__dim {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.72);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-variant-numeric: tabular-nums;
      }

      .library__empty {
        display: flex; flex-direction: column; align-items: center;
        justify-content: center; padding: 60px 24px; gap: 16px;
        text-align: center; color: var(--color-text-secondary);
      }
      .empty-stage {
        position: relative; width: 560px; max-width: 92vw;
        aspect-ratio: 16 / 9;
      }
      .empty-illustration {
        position: absolute; inset: 0; width: 100%; height: 100%;
        object-fit: contain; opacity: 0.55;
        filter: saturate(0);
      }
      .empty-particles {
        position: absolute; inset: 0; width: 100%; height: 100%;
        pointer-events: none;
      }
      .empty-headline {
        font-size: 28px; font-weight: 600; letter-spacing: -0.02em;
        color: var(--color-text);
      }
      .empty-sub { font-size: 14px; max-width: 280px; line-height: 1.6; }
    </style>
  `;

  bindActions(view);
  render(view);

  imagesUnsub = state.on("images", () => render(view));
  filterUnsub = state.on("filterIssue", () => render(view));
  activeUnsub = state.on("activeIndex", () => render(view));

  ctx = enterView(outlet);
}

export function unmount() {
  imagesUnsub?.(); imagesUnsub = null;
  filterUnsub?.(); filterUnsub = null;
  activeUnsub?.(); activeUnsub = null;
  particleCleanup?.(); particleCleanup = null;
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  emptyAnimated = false;
  ctx?.revert?.();
  ctx = null;
  outletRef = null;
}

// ---------------------------------------------------------------------------

function animateEmptyIn(emptyEl) {
  if (isReduced) {
    gsap.set(emptyEl, { opacity: 1 });
    return;
  }
  const illus  = emptyEl.querySelector(".empty-illustration");
  const hdline = emptyEl.querySelector(".empty-headline");
  const sub    = emptyEl.querySelector(".empty-sub");
  const btn    = emptyEl.querySelector(".btn");

  gsap.from(emptyEl, { opacity: 0, duration: dur.enter, ease: ease.enter });

  gsap.from([illus, hdline, sub, btn].filter(Boolean), {
    opacity: 0, y: 18, duration: dur.reveal, ease: ease.enter,
    stagger: 0.08, delay: 0.2,
  });

  gsap.to(illus, {
    y: -7, duration: 3.2, ease: "sine.inOut",
    yoyo: true, repeat: -1, delay: 0.6,
  });
}

function mountParticles(canvas) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width  = canvas.offsetWidth  || 420;
  const H = canvas.height = canvas.offsetHeight || 236;
  const COUNT = 38;

  const particles = Array.from({ length: COUNT }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: 1 + Math.random() * 2.5,
    speed: 0.18 + Math.random() * 0.28,
    sway: (Math.random() - 0.5) * 0.4,
    alpha: 0.1 + Math.random() * 0.35,
    phase: Math.random() * Math.PI * 2,
  }));

  let raf;
  let t = 0;

  function tick() {
    const accentRgb = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-color-rgb").trim() || "199, 200, 201";
    ctx.clearRect(0, 0, W, H);
    t += 0.012;
    for (const p of particles) {
      p.y -= p.speed;
      p.x += Math.sin(t + p.phase) * p.sway;
      if (p.y < -p.r) {
        p.y = H + p.r;
        p.x = Math.random() * W;
      }
      const edgeDist = Math.min(p.x / W, 1 - p.x / W, p.y / H, 1 - p.y / H);
      const a = p.alpha * Math.min(1, edgeDist * 10);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${accentRgb}, ${a})`;
      ctx.fill();
    }
    raf = requestAnimationFrame(tick);
  }

  tick();
  return () => cancelAnimationFrame(raf);
}

function bindActions(view) {
  view.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "select-all") {
      const all = state.get("images");
      const allSelected = all.length > 0 && all.every((r) => r.selected);
      state.selectAll(!allSelected);
    } else if (action === "clear") {
      if (state.get("images").length === 0) return;
      if (!confirm("Clear all images from this session?")) return;
      state.clearImages();
      toast.info("Library cleared.");
    } else if (action === "open") {
      const sel = state.getSelectedPaths();
      if (!sel.length) return;
      state.setActiveByPath(sel[0]);
      navigate("edit");
    } else if (action === "goto-edit") {
      navigate("edit");
    }
  });
}

function layoutGridSpans(grid) {
  if (!grid || !grid.children.length) return;
  const cards = grid.querySelectorAll(".lib-card");
  if (!cards.length) return;

  const firstCard = cards[0];
  const colWidth = firstCard.clientWidth || (grid.clientWidth / 3) || 280;

  cards.forEach((card) => {
    const key = card.dataset.path || card.dataset.url;
    const cached = dimCache.get(key);
    const aspect = cached ? cached.clampedRatio : DEFAULT_ASPECT;
    const tileHeight = Math.round(colWidth / aspect);
    const span = computeSpan(colWidth, aspect);
    const mediaBox = card.querySelector(".lib-card__media-box");
    if (mediaBox) mediaBox.style.height = `${tileHeight}px`;
    card.style.gridRowEnd = `span ${span}`;
    if (cached && cached.width && cached.width < colWidth) {
      card.classList.add("lib-card--low-res");
    } else {
      card.classList.remove("lib-card--low-res");
    }
  });
}

function render(view) {
  const images = state.get("images");
  const filter = state.get("filterIssue");
  const activePath = state.get("currentImagePath");

  const subtitle = view.querySelector(".library__subtitle");
  const total = images.length;
  const ready = images.filter((r) => r.state === "ready").length;
  const sel = images.filter((r) => r.selected).length;
  subtitle.textContent = total === 0
    ? "Nothing yet — drop images on Edit to populate the library."
    : `${total} image${total === 1 ? "" : "s"} · ${ready} analysed · ${sel} selected`;

  const openBtn = view.querySelector("[data-action='open']");
  openBtn.disabled = sel === 0;

  const empty = view.querySelector("[data-empty]");
  const grid = view.querySelector("[data-grid]");
  const filters = view.querySelector("[data-filters]");
  const wasHidden = empty.hidden;
  empty.hidden = total > 0;
  grid.hidden = total === 0;
  filters.hidden = total === 0;

  if (total === 0) {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (wasHidden && !empty.hidden) {
      animateEmptyIn(empty);
      const canvas = empty.querySelector(".empty-particles");
      if (canvas) {
        particleCleanup?.();
        let cancelled = false;
        particleCleanup = () => { cancelled = true; };
        requestAnimationFrame(() => {
          if (!cancelled) particleCleanup = mountParticles(canvas);
        });
      }
    } else if (!emptyAnimated) {
      emptyAnimated = true;
      animateEmptyIn(empty);
      const canvas = empty.querySelector(".empty-particles");
      if (canvas) {
        particleCleanup?.();
        let cancelled = false;
        particleCleanup = () => { cancelled = true; };
        requestAnimationFrame(() => {
          if (!cancelled) particleCleanup = mountParticles(canvas);
        });
      }
    }
    return;
  }

  particleCleanup?.(); particleCleanup = null;
  emptyAnimated = false;

  renderFilters(filters, images, filter);

  const visible = filter
    ? images.filter((r) => Array.isArray(r.issues) && r.issues.includes(filter))
    : images;

  grid.innerHTML = visible.map((r) => cardHtml(r, r.path === activePath)).join("");

  // Setup ResizeObserver to recompute row spans when column width changes.
  if (!resizeObserver && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      layoutGridSpans(grid);
    });
    resizeObserver.observe(grid);
  }

  // Initial layout calculation with fallback.
  layoutGridSpans(grid);

  // Bind image load handlers to detect natural dimensions, clamp aspect ratio, and update masonry spans.
  grid.querySelectorAll(".lib-card").forEach((card) => {
    const path = card.dataset.path;
    const imgRecord = visible.find((r) => r.path === path);
    const imgEl = card.querySelector(".lib-card__img");
    const dimEl = card.querySelector(".lib-card__dim");

    const onDimensionResolved = (naturalWidth, naturalHeight) => {
      if (naturalWidth > 0 && naturalHeight > 0) {
        const rawAspect = naturalWidth / naturalHeight;
        const clampedRatio = clampAspect(rawAspect);
        dimCache.set(path, {
          width: naturalWidth,
          height: naturalHeight,
          aspect: rawAspect,
          clampedRatio,
        });

        if (dimEl) {
          const ext = (path.split(".").pop() || "IMG").toUpperCase();
          dimEl.textContent = `${naturalWidth} × ${naturalHeight} · ${ext}`;
        }

        const colWidth = card.clientWidth || (grid.clientWidth / 3) || 280;
        const tileHeight = Math.round(colWidth / clampedRatio);
        const span = computeSpan(colWidth, clampedRatio);
        const mediaBox = card.querySelector(".lib-card__media-box");
        if (mediaBox) mediaBox.style.height = `${tileHeight}px`;
        card.style.gridRowEnd = `span ${span}`;
        if (naturalWidth < colWidth) {
          card.classList.add("lib-card--low-res");
        } else {
          card.classList.remove("lib-card--low-res");
        }
      }
    };

    if (path && imgRecord?.url) {
      const probe = new Image();
      probe.onload = () => {
        onDimensionResolved(probe.naturalWidth, probe.naturalHeight);
      };
      probe.onerror = () => {
        onDimensionResolved(400, 300);
      };
      probe.src = imgRecord.url;
    }

    card.addEventListener("click", (e) => {
      const cardPath = card.dataset.path;
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.target.closest(".lib-card__check")) {
        state.toggleSelected(cardPath);
      } else {
        const current = state.get("images").find((r) => r.path === cardPath);
        const src = current?.url;
        if (src) {
          openLightbox({ src, name: current?.name || cardPath.split(/[\\/]/).pop() });
        }
      }
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const cardPath = card.dataset.path;
        const current = state.get("images").find((r) => r.path === cardPath);
        const src = current?.url;
        if (src) {
          openLightbox({ src, name: current?.name || cardPath.split(/[\\/]/).pop() });
        }
      }
    });
  });

  if (!isReduced) {
    gsap.fromTo([...grid.querySelectorAll(".lib-card")],
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.3, ease: "expo.out", stagger: { each: 0.02, from: "start" } }
    );
  }
}

function renderFilters(filtersEl, images, filter) {
  const counts = {};
  for (const img of images) {
    for (const iss of (img.issues || [])) counts[iss] = (counts[iss] || 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const total = images.length;

  filtersEl.innerHTML = `
    <button class="library__chip ${!filter ? "is-active" : ""}" data-filter="">
      <span class="library__chip__dot" style="--chip-rgb: var(--accent-color-rgb);"></span>
      All <span class="library__chip__count">${escapeHtml(total)}</span>
    </button>
    ${entries.map(([id, n]) => `
      <button class="library__chip ${filter === id ? "is-active" : ""}"
              data-filter="${escapeHtml(id)}" style="--chip-rgb: ${escapeHtml(colorFor(id))};">
        <span class="library__chip__dot"></span>
        ${escapeHtml(labelFor(id))} <span class="library__chip__count">${escapeHtml(n)}</span>
      </button>
    `).join("")}
  `;

  filtersEl.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.filter || null;
      state.setFilterIssue(id);
    });
  });
}

function cardHtml(img, isActive) {
  const path = String(img.path || "");
  const name = String(img.name || path.split(/[\\/]/).pop() || "");
  const cached = dimCache.get(path);
  const ext = (path.split(".").pop() || "IMG").toUpperCase();
  const dimText = cached && cached.width ? `${cached.width} × ${cached.height} · ${ext}` : ext;
  const initialAspect = cached ? cached.clampedRatio : DEFAULT_ASPECT;
  const initialSpan = computeSpan(280, initialAspect);
  const initialHeight = Math.round(280 / initialAspect);

  const thumb = img.url
    ? `<img class="lib-card__img" src="${escapeHtml(img.url)}" alt="${escapeHtml(name)}" loading="lazy">`
    : `<div class="lib-card__placeholder"><i class="bi bi-image"></i></div>`;

  return `
    <div class="lib-card ${img.selected ? "is-selected" : ""} ${isActive ? "is-active" : ""}"
         data-path="${escapeHtml(path)}" tabindex="0" role="button" aria-label="${escapeHtml(name)}"
         style="grid-row-end: span ${initialSpan};">
      <div class="lib-card__media-box" style="height: ${initialHeight}px;">
        ${thumb}
        <div class="lib-card__check" aria-hidden="true">${img.selected ? '<i class="bi bi-check"></i>' : ""}</div>
        <div class="lib-card__meta">
          <div class="lib-card__name">${escapeHtml(name)}</div>
          <div class="lib-card__dim">${escapeHtml(dimText)}</div>
        </div>
      </div>
    </div>
  `;
}
