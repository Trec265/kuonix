// Contact sheet — masonry grid of all uploaded images. Selection-aware,
// click toggles selection, double-click sets active. Per-card states cover
// uploading / decoding / analyzing / ready / error so progress stays visible.

import { gsap } from "../../../node_modules/gsap/index.js";
import { isReduced } from "../../motion.js";
import * as state from "../../state.js";
import { openLightbox } from "../../components/image-lightbox/index.js";
import { escapeHtml } from "../../utils/escape-html.js";

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

export function createContactSheet({ onAddMore } = {}) {
  const root = document.createElement("div");
  root.className = "contact-sheet";
  root.innerHTML = `
    <div class="contact-sheet__grid" role="list"></div>
    <footer class="contact-sheet__footer">
      <span class="contact-sheet__count" aria-live="polite">0 selected</span>
      <div class="contact-sheet__actions">
        <button class="btn btn--ghost" data-action="select-all"><i class="bi bi-check2-square"></i> Select all</button>
        <button class="btn btn--ghost" data-action="select-none"><i class="bi bi-x-square"></i> Clear</button>
        <button class="btn btn--accent" data-action="add-more"><i class="bi bi-plus-lg"></i> Add more</button>
      </div>
    </footer>
  `;
  const grid = root.querySelector(".contact-sheet__grid");
  const countEl = root.querySelector(".contact-sheet__count");

  let cardByPath = new Map();
  let resizeObserver = null;

  function layoutGridSpans() {
    if (!grid || !grid.children.length) return;
    const cards = grid.querySelectorAll(".contact-card");
    if (!cards.length) return;

    const firstCard = cards[0];
    const colWidth = firstCard.clientWidth || (grid.clientWidth / 3) || 280;

    cards.forEach((card) => {
      const key = card.dataset.path || card.dataset.url;
      const cached = dimCache.get(key);
      const aspect = cached ? cached.clampedRatio : DEFAULT_ASPECT;
      const tileHeight = Math.round(colWidth / aspect);
      const span = computeSpan(colWidth, aspect);
      const mediaBox = card.querySelector(".contact-card__media-box");
      if (mediaBox) mediaBox.style.height = `${tileHeight}px`;
      card.style.gridRowEnd = `span ${span}`;
      if (cached && cached.width && cached.width < colWidth) {
        card.classList.add("contact-card--low-res");
      } else {
        card.classList.remove("contact-card--low-res");
      }
    });
  }

  function render() {
    const images = state.visibleImages();
    grid.innerHTML = "";
    cardByPath = new Map();
    if (!images.length) {
      grid.innerHTML = `
        <div class="contact-sheet__empty">
          <i class="bi bi-images"></i>
          <p>No images match this filter.</p>
        </div>`;
    } else {
      images.forEach((img) => {
        const card = makeCard(img);
        grid.appendChild(card);
        cardByPath.set(img.path, card);
      });

      layoutGridSpans();

      if (!isReduced) {
        gsap.from([...grid.querySelectorAll(".contact-card")], {
          opacity: 0, y: 8, scale: 0.97,
          duration: 0.35, ease: "expo.out",
          stagger: { each: 0.04, from: "start" },
          clearProps: "transform",
        });
      }
    }
    syncCount();
  }

  function makeCard(img) {
    const path = String(img.path || "");
    const name = String(img.name || filenameOf(path) || "");
    const cached = dimCache.get(path);
    const ext = (path.split(".").pop() || "IMG").toUpperCase();
    const dimText = cached && cached.width ? `${cached.width} × ${cached.height} · ${ext}` : ext;
    const initialAspect = cached ? cached.clampedRatio : DEFAULT_ASPECT;
    const initialSpan = computeSpan(280, initialAspect);
    const initialHeight = Math.round(280 / initialAspect);

    const card = document.createElement("article");
    card.className = "contact-card";
    card.setAttribute("role", "listitem");
    card.tabIndex = 0;
    card.dataset.path = path;
    card.setAttribute("aria-label", name);
    card.style.gridRowEnd = `span ${initialSpan}`;
    card.classList.toggle("is-selected", !!img.selected);
    card.classList.toggle("is-active", path === state.get("currentImagePath"));
    card.classList.toggle(`is-state-${img.state || "ready"}`, true);

    const thumb = img.url
      ? `<img class="contact-card__img" src="${escapeHtml(img.url)}" alt="${escapeHtml(name)}" loading="lazy">`
      : `<div class="contact-card__placeholder"><i class="bi bi-image"></i></div>`;

    card.innerHTML = `
      <div class="contact-card__media-box" style="height: ${initialHeight}px;">
        ${thumb}
        <div class="contact-card__check" aria-hidden="true">${img.selected ? '<i class="bi bi-check"></i>' : ""}</div>
        <div class="contact-card__progress"><div class="bar"></div></div>
        <div class="contact-card__meta">
          <div class="contact-card__name">${escapeHtml(name)}</div>
          <div class="contact-card__dim">${escapeHtml(dimText)}</div>
        </div>
      </div>
    `;

    const imgEl = card.querySelector(".contact-card__img");
    const dimEl = card.querySelector(".contact-card__dim");

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
          dimEl.textContent = `${naturalWidth} × ${naturalHeight} · ${ext}`;
        }

        const colWidth = card.clientWidth || (grid.clientWidth / 3) || 280;
        const tileHeight = Math.round(colWidth / clampedRatio);
        const span = computeSpan(colWidth, clampedRatio);
        const mediaBox = card.querySelector(".contact-card__media-box");
        if (mediaBox) mediaBox.style.height = `${tileHeight}px`;
        card.style.gridRowEnd = `span ${span}`;
        if (naturalWidth < colWidth) {
          card.classList.add("contact-card--low-res");
        } else {
          card.classList.remove("contact-card--low-res");
        }
      }
    };

    if (path && img.url) {
      const probe = new Image();
      probe.onload = () => {
        onDimensionResolved(probe.naturalWidth, probe.naturalHeight);
      };
      probe.onerror = () => {
        onDimensionResolved(400, 300);
      };
      probe.src = img.url;
    }

    renderCardMeta(card, img);

    card.addEventListener("click", (e) => {
      // Ctrl/Cmd-click or clicking check → toggle selection without opening preview.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.target.closest(".contact-card__check")) {
        state.toggleSelected(img.path);
        return;
      }
      // Plain click → open fullscreen preview. Also set as active so the
      // agent rail and analysis ribbon track this image.
      state.setActiveByPath(img.path);
      const current = state.get("images").find((r) => r.path === img.path);
      const src = current?.url || img.url;
      if (src) {
        openLightbox({ src, name: img.name || filenameOf(img.path) });
      }
    });
    card.addEventListener("dblclick", () => {
      state.setActiveByPath(img.path);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        state.setActiveByPath(img.path);
        const current = state.get("images").find((r) => r.path === img.path);
        const src = current?.url || img.url;
        if (src) openLightbox({ src, name: img.name || filenameOf(img.path) });
      } else if (e.key === " ") {
        e.preventDefault();
        state.toggleSelected(img.path);
      }
    });

    return card;
  }

  function syncCount() {
    const total = state.get("images").length;
    const selected = state.getSelectedPaths().length;
    countEl.textContent = `${selected} selected · ${total} total`;
  }

  // ---- Public API: incremental updates so we don't rebuild on every event ---

  function patchCard(path) {
    const img = state.get("images").find((r) => r.path === path);
    if (!img) return;
    const card = cardByPath.get(path);
    if (!card) { reconcile(); return; }
    card.classList.toggle("is-selected", !!img.selected);
    card.classList.toggle("is-active", img.path === state.get("currentImagePath"));

    const checkEl = card.querySelector(".contact-card__check");
    if (checkEl) checkEl.innerHTML = img.selected ? '<i class="bi bi-check"></i>' : "";

    // State class swap
    card.className = card.className.replace(/\bis-state-\S+/g, "").trim();
    card.classList.add(`is-state-${img.state || "ready"}`);
    if (img.url && !card.querySelector(".contact-card__img")) {
      const im = new Image();
      im.className = "contact-card__img";
      im.alt = img.name || "";
      im.src = img.url;
      im.loading = "lazy";
      const mb = card.querySelector(".contact-card__media-box");
      const ph = card.querySelector(".contact-card__placeholder");
      if (ph) ph.remove();
      if (mb) mb.insertBefore(im, mb.firstChild);
    } else if (img.url) {
      const im = card.querySelector(".contact-card__img");
      if (im && im.src !== img.url) im.src = img.url;
    }
    renderCardMeta(card, img);
  }

  // Reconcile the grid against the visible set after a *membership* change
  function reconcile() {
    const images = state.visibleImages();

    if (!images.length) {
      grid.innerHTML = `
        <div class="contact-sheet__empty">
          <i class="bi bi-images"></i>
          <p>No images match this filter.</p>
        </div>`;
      cardByPath.clear();
      syncCount();
      return;
    }

    const emptyEl = grid.querySelector(".contact-sheet__empty");
    if (emptyEl) emptyEl.remove();

    const seen = new Set();
    const added = [];
    let prev = null;
    for (const img of images) {
      seen.add(img.path);
      let card = cardByPath.get(img.path);
      if (!card) {
        card = makeCard(img);
        cardByPath.set(img.path, card);
        added.push(card);
      }
      const ref = prev ? prev.nextSibling : grid.firstChild;
      if (ref !== card) grid.insertBefore(card, ref);
      prev = card;
    }

    for (const path of [...cardByPath.keys()]) {
      if (!seen.has(path)) {
        cardByPath.get(path).remove();
        cardByPath.delete(path);
      }
    }

    layoutGridSpans();

    if (added.length && !isReduced) {
      gsap.from(added, {
        opacity: 0, y: 8, scale: 0.97,
        duration: 0.35, ease: "expo.out",
        stagger: { each: 0.04, from: "start" },
        clearProps: "transform",
      });
    }
    syncCount();
  }

  function onImageEvent({ path, kind, oldPath } = {}) {
    if (kind === "renamed") {
      const card = cardByPath.get(oldPath);
      const img = state.get("images").find((r) => r.path === path);
      if (!card || !img) { reconcile(); return; }
      const fresh = makeCard(img);
      card.replaceWith(fresh);
      cardByPath.delete(oldPath);
      cardByPath.set(path, fresh);
      syncCount();
      return;
    }
    if (state.get("filterIssue")) {
      const visible = state.visibleImages().some((r) => r.path === path);
      if (visible !== cardByPath.has(path)) { reconcile(); return; }
    }
    patchCard(path);
  }

  function bind() {
    if (!resizeObserver && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        layoutGridSpans();
      });
      resizeObserver.observe(grid);
    }

    const unsubs = [
      state.on("images", reconcile),
      state.on("image", onImageEvent),
      state.on("filterIssue", render),
      state.on("activeIndex", () => {
        for (const card of cardByPath.values()) {
          card.classList.toggle("is-active", card.dataset.path === state.get("currentImagePath"));
        }
      }),
      state.on("selectedPaths", () => {
        for (const card of cardByPath.values()) {
          const img = state.get("images").find((r) => r.path === card.dataset.path);
          if (img) {
            card.classList.toggle("is-selected", !!img.selected);
            const checkEl = card.querySelector(".contact-card__check");
            if (checkEl) checkEl.innerHTML = img.selected ? '<i class="bi bi-check"></i>' : "";
          }
        }
        syncCount();
      }),
    ];
    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      for (const u of unsubs) u();
    };
  }

  function renderCardMeta(card, img) {
    const isBusy = img.state === "uploading" || img.state === "decoding"
      || img.state === "queued" || img.state === "analyzing";
    card.classList.toggle("is-busy", isBusy);
    const bar = card.querySelector(".contact-card__progress .bar");
    if (bar && !isBusy) bar.style.width = "";
  }

  function updateProgress(path, progress) {
    const card = cardByPath.get(path);
    if (!card) return;
    const bar = card.querySelector(".contact-card__progress .bar");
    if (bar) bar.style.width = `${Math.round(progress * 100)}%`;
  }

  // Footer actions
  root.querySelector('[data-action="select-all"]').addEventListener("click", () => state.selectAll(true));
  root.querySelector('[data-action="select-none"]').addEventListener("click", () => state.selectAll(false));
  root.querySelector('[data-action="add-more"]').addEventListener("click", () => onAddMore?.());

  return {
    el: root,
    render,
    patchCard,
    updateProgress,
    bind,
    destroy() {
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
    },
  };
}

function filenameOf(p) {
  if (!p) return "";
  const seg = String(p).split(/[\\/]/);
  return seg[seg.length - 1] || p;
}
