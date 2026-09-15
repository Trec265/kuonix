// Bootstrap. Wires the shell (titlebar, nav, mode toggle, agent rail) and
// hands off to the router.

import { defineRoute, init as initRouter, navigate, getCurrentRoute } from "./router.js";
import { revealNav, moveModeIndicator, buttonPulse, magneticHover } from "./motion.js";
import { pingHealth } from "./api/client.js";
import { getModules } from "./api/endpoints/settings.js";
import * as state from "./state.js";

const DEFAULT_MODULES = {
  // aiAssistant is derived server-side from whether Ollama is configured.
  // Default it off so AI UI stays hidden until the backend confirms a key.
  editing: true, aiAssistant: false, batchProcessing: true,
  rawDecode: true, cameraFeedback: true, styleProfiles: false,
};

// ---- Theme & accent application ----------------------------------------

export function applyTheme(theme) {
  state.set("theme", theme);
  const html = document.documentElement;
  if (theme === "system") {
    html.removeAttribute("data-color-scheme");
  } else {
    html.setAttribute("data-color-scheme", theme);
  }
}

export function applyAccent(presetId, customHex = null) {
  state.update({ accent: presetId, accentHex: customHex });
  const preset = state.ACCENT_PRESETS[presetId];
  const rgb = customHex ? hexToRgbTriple(customHex) : preset?.rgb;
  if (!rgb) return;
  const root = document.documentElement;
  root.style.setProperty("--accent-color-rgb", rgb);
  root.style.setProperty("--accent-color", `rgba(${rgb}, 1)`);
}

function hexToRgbTriple(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`;
}

// ---- Routes (lazy module loaders) --------------------------------------

defineRoute("edit",     () => import("./views/edit/index.js"));
defineRoute("library",  () => import("./views/library/index.js"));
defineRoute("export",   () => import("./views/export/index.js"));
defineRoute("settings", () => import("./views/settings/index.js"));
defineRoute("help",     () => import("./views/help/index.js"));

// ---- Shell wiring ------------------------------------------------------

function bindNav() {
  const nav = document.querySelector(".left-nav");
  const appShell = document.querySelector(".app-shell");
  const agentRail = document.querySelector(".agent-rail");
  const assistantRoutes = new Set(["edit", "library"]);
  const dockedRoutes = new Set(["library"]);
  const modeRoutes = new Set(["edit"]);

  const syncAssistantLayout = (route) => {
    const visible = assistantRoutes.has(route);
    const docked = dockedRoutes.has(route);
    appShell?.classList.toggle("assistant-hidden", !visible);
    appShell?.classList.toggle("assistant-docked", docked);
    if (agentRail) {
      agentRail.classList.toggle("is-collapsed", visible && (docked || state.get("agentRailCollapsed")));
    }
  };

  const syncModeToggleVisibility = (route) => {
    const toggle = document.querySelector(".mode-toggle");
    if (!toggle) return;
    const isVisible = modeRoutes.has(route);
    toggle.hidden = !isVisible;
    if (isVisible) {
      requestAnimationFrame(() => {
        const indicator = toggle.querySelector(".mode-toggle__indicator");
        const mode = state.get("mode");
        const active = toggle.querySelector(`.mode-toggle__option[data-mode="${mode}"]`);
        moveModeIndicator(indicator, active);
      });
    }
  };

  const syncContext = () => {
    const route = getCurrentRoute();
    const batchVisible = route === "edit" && state.get("mode") === "batch" && state.get("images").length > 0;
    const batchContext = nav.querySelector("[data-context='edit-batch']");
    const libraryContext = nav.querySelector("[data-context='library']");
    batchContext.hidden = !batchVisible;
    libraryContext.hidden = route !== "library";
    libraryContext.setAttribute("aria-hidden", String(route !== "library"));
    batchContext.setAttribute("aria-hidden", String(!batchVisible));
  };

  nav.querySelectorAll(".nav-btn[data-route]").forEach((btn) => {
    btn.addEventListener("click", () => {
      buttonPulse(btn);
      navigate(btn.dataset.route);
    });
  });
  document.addEventListener("kuonix:route", (e) => {
    nav.querySelectorAll(".nav-btn").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.route === e.detail.name);
    });
    syncContext();
    syncAssistantLayout(e.detail.name);
    syncModeToggleVisibility(e.detail.name);
  });

  nav.addEventListener("click", (e) => {
    const action = e.target.closest("[data-context-action]")?.dataset.contextAction;
    if (!action) return;
    const images = state.get("images");
    if (action === "select-all") state.selectAll(true);
    if (action === "select-none") state.selectAll(false);
    if (action === "clear-session" && images.length && confirm("Clear all images from this session?")) {
      state.clearImages();
    }
    if (action === "open-in-edit") {
      const selected = state.getSelectedPaths();
      if (selected.length) {
        state.setActiveByPath(selected[0]);
        navigate("edit");
      }
    }
  });

  state.on("mode", syncContext);
  state.on("images", syncContext);
  state.on("agentRailCollapsed", () => syncAssistantLayout(getCurrentRoute()));
  syncContext();
  syncAssistantLayout(getCurrentRoute());
  syncModeToggleVisibility(getCurrentRoute());
}

function bindModeToggle() {
  const toggle = document.querySelector(".mode-toggle");
  if (!toggle) return;
  const indicator = toggle.querySelector(".mode-toggle__indicator");
  const opts = toggle.querySelectorAll(".mode-toggle__option");
  const sync = () => {
    const mode = state.get("mode");
    opts.forEach(o => o.classList.toggle("is-active", o.dataset.mode === mode));
    const active = toggle.querySelector(`.mode-toggle__option[data-mode="${mode}"]`);
    moveModeIndicator(indicator, active);
  };
  opts.forEach(opt => opt.addEventListener("click", () => state.set("mode", opt.dataset.mode)));
  state.on("mode", sync);
  // Initial — defer one frame so layout has settled.
  requestAnimationFrame(sync);
  // Also re-sync on window resize so the pill keeps up.
  window.addEventListener("resize", () => requestAnimationFrame(sync));
}

function bindThemeButton() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const cur = state.get("theme");
    // Cycle: system → dark → light → system
    const next = cur === "system" ? "dark" : cur === "dark" ? "light" : "system";
    applyTheme(next);
    btn.setAttribute("aria-label", `Theme: ${next}`);
    btn.title = `Theme: ${next}`;
  });
  btn.title = `Theme: ${state.get("theme")}`;
}

// Backend connection status pill — polls pingHealth, updates the data-state
// attribute the CSS keys off. Click jumps to Settings (where the user is most
// likely to fix a missing key / wrong base URL).
function bindConnectionStatus() {
  const btn = document.getElementById("conn-status");
  if (!btn) return;
  const label = btn.querySelector(".conn-status__label");

  async function tick() {
    const up = await pingHealth();
    const next = up ? "up" : "down";
    if (btn.dataset.state === next) return;
    btn.dataset.state = next;
    label.textContent = up ? "Connected" : "Offline";
    btn.title = up
      ? "Backend reachable on :8081"
      : "Backend not reachable. Check that the JAR is running.";
  }

  btn.addEventListener("click", () => navigate("settings"));
  magneticHover(btn, { strength: 0.18, max: 4 });

  tick();
  setInterval(tick, 8000);
}

// Global keyboard shortcuts. Numbers 1–5 jump views, Ctrl+B toggles mode,
// Ctrl+. collapses the agent rail. We ignore key events when the user is
// typing into any field so prompts and settings forms stay uninterrupted.
function bindShortcuts() {
  const ROUTE_KEYS = { "1": "edit", "2": "library", "3": "export", "4": "settings", "5": "help" };
  document.addEventListener("keydown", (e) => {
    const target = e.target;
    const isEditable = target?.matches?.("input, textarea, select, [contenteditable=true]");
    if (isEditable) return;
    if (e.altKey || e.metaKey) return;

    if (!e.ctrlKey && !e.shiftKey && ROUTE_KEYS[e.key]) {
      e.preventDefault();
      navigate(ROUTE_KEYS[e.key]);
      return;
    }
    if (e.ctrlKey && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      const next = state.get("mode") === "single" ? "batch" : "single";
      state.set("mode", next);
      return;
    }
    if (e.ctrlKey && e.key === ".") {
      e.preventDefault();
      state.set("agentRailCollapsed", !state.get("agentRailCollapsed"));
      return;
    }
    if (e.key === "/" && !e.ctrlKey && !e.shiftKey) {
      // Focus the agent prompt — the rail's header advertises this affordance.
      const input = document.querySelector(".agent-prompt__input");
      if (input && !input.disabled) {
        e.preventDefault();
        input.focus();
      }
    }
  });
}

function bindAgentRailToggle() {
  const rail = document.querySelector(".agent-rail");
  const btn = document.getElementById("agent-rail-toggle");
  if (!rail || !btn) return;
  const sync = () => {
    rail.classList.toggle("is-collapsed", state.get("agentRailCollapsed"));
    btn.querySelector(".chev").style.transform =
      state.get("agentRailCollapsed") ? "rotate(180deg)" : "rotate(0deg)";
  };
  btn.addEventListener("click", () => {
    state.set("agentRailCollapsed", !state.get("agentRailCollapsed"));
  });
  state.on("agentRailCollapsed", sync);
  sync();
}

// Phase 2: hand off the prompt + stream to the agent-rail orchestrator.
// It owns SSE, message bubbles, tool cards, and the history strip.
async function bindAgentRail() {
  const mod = await import("./components/agent-rail/index.js");
  mod.init();
}

// ---- OS theme listener -------------------------------------------------

function watchSystemTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  // No need to react if user has chosen explicit theme; CSS @media handles "system".
  mq.addEventListener?.("change", () => {
    if (state.get("theme") !== "system") return;
    // Force a reflow trigger by toggling and removing the attr.
    const root = document.documentElement;
    root.removeAttribute("data-color-scheme");
  });
}

// ---- Boot --------------------------------------------------------------

async function boot() {
  try {
    const res = await getModules();
    const { firstRun = false, modules = {} } = res || {};
    window.__kuonixConfig = { modules: { ...DEFAULT_MODULES, ...modules }, _firstRun: firstRun };
  } catch {
    window.__kuonixConfig = { modules: { ...DEFAULT_MODULES }, _firstRun: false };
  }

  // Apply persisted appearance before first paint of any view.
  applyTheme(state.get("theme"));
  applyAccent(state.get("accent"), state.get("accentHex"));

  bindNav();
  bindModeToggle();
  bindThemeButton();
  bindAgentRailToggle();
  bindAgentRail();
  bindShortcuts();
  bindConnectionStatus();
  watchSystemTheme();

  // Reveal nav with a small stagger.
  revealNav(document.querySelector(".left-nav"));

  // First-run wizard — shown before routing so the user configures features first.
  if (window.__kuonixConfig._firstRun) {
    const { runOnboarding } = await import("./views/onboarding/index.js");
    await runOnboarding();
  }

  // Start router.
  const outlet = document.getElementById("view-outlet");
  initRouter(outlet, "edit");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
