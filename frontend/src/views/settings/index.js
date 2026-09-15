// Settings — Appearance, AI (Ollama Cloud), and About.
//
// Appearance is wired live via app.js helpers. AI settings round-trip the
// /settings/ollama endpoint; saving triggers a backend "restart required"
// notice because LangChain4j beans are created at startup.

import { gsap } from "../../../node_modules/gsap/index.js";
import { enterView, isReduced, buttonPulse } from "../../motion.js";
import * as state from "../../state.js";
import { applyAccent, applyTheme } from "../../app.js";
import { getOllama, saveOllama, listModels, getModules, saveModules } from "../../api/endpoints/settings.js";
import { toast } from "../../components/toast/index.js";

let ctx = null;
let outletRef = null;
let modelOptions = [];
let currentSettings = null;
let dirty = false;

export function mount(outlet) {
  outletRef = outlet;
  outlet.innerHTML = "";

  const view = document.createElement("section");
  view.className = "view settings-view";
  view.dataset.view = "settings";
  outlet.appendChild(view);

  view.innerHTML = template();
  ctx = enterView(outlet);

  bindAppearance(view);
  bindAiSection(view);
  bindFeaturesSection(view);
  loadAiSettings(view);
  loadModuleSettings(view);
}

export function unmount() {
  ctx?.revert?.();
  ctx = null;
  outletRef = null;
  currentSettings = null;
  modelOptions = [];
  dirty = false;
}

// ---------------------------------------------------------------------------

function template() {
  const accent = state.get("accent");
  const theme = state.get("theme");

  const swatches = Object.entries(state.ACCENT_PRESETS)
    .map(([id, p]) => `
      <button class="swatch ${id === accent ? "is-selected" : ""}" data-accent="${id}"
              style="--swatch-rgb: ${p.rgb};" title="${p.label}" aria-label="${p.label}"></button>
    `).join("");

  return `
    <header class="view-header settings__header">
      <div>
        <p class="eyebrow">Settings</p>
        <h1 class="display-heading">Tune Kuonix</h1>
        <p class="muted settings__subtitle">Configure appearance, AI models, and feature modules.</p>
      </div>
    </header>

    <div class="settings__content reveal">
      <nav class="settings__tabs" role="tablist">
        <button class="settings__tab is-active" data-tab="appearance" role="tab" aria-selected="true">
          <i class="bi bi-palette2"></i> Appearance
        </button>
        <button class="settings__tab" data-tab="ai" role="tab" aria-selected="false">
          <i class="bi bi-stars"></i> AI · Ollama Cloud
        </button>
        <button class="settings__tab" data-tab="features" role="tab" aria-selected="false">
          <i class="bi bi-toggles"></i> Features
        </button>
        <button class="settings__tab" data-tab="about" role="tab" aria-selected="false">
          <i class="bi bi-info-circle"></i> About
        </button>
      </nav>

      <section class="settings__section" data-section="appearance">
        <div class="settings__row stack-row">
          <div class="settings__label-group">
            <h3 class="settings__label">Theme</h3>
            <p class="muted settings__hint">Studio dark, paper light, or follow your OS.</p>
          </div>
          <div class="settings__control">
            <div class="theme-row">
              ${["light", "dark", "system"].map(t => `
                <button class="theme-opt ${t === theme ? "is-selected" : ""}" data-theme="${t}">
                  <i class="bi bi-${t === 'light' ? 'sun' : t === 'dark' ? 'moon-stars' : 'circle-half'}"></i>
                  ${t[0].toUpperCase() + t.slice(1)}
                </button>
              `).join("")}
            </div>
          </div>
        </div>

        <div class="settings__row stack-row">
          <div class="settings__label-group">
            <h3 class="settings__label">Accent color</h3>
            <p class="muted settings__hint">Sets the accent color for active interactive states across Kuonix.</p>
          </div>
          <div class="settings__control">
            <div class="swatches">${swatches}</div>
          </div>
        </div>

        <div class="settings__row stack-row">
          <div class="settings__label-group">
            <h3 class="settings__label">Motion</h3>
            <p class="muted settings__hint">Kuonix follows your OS reduced-motion preference.</p>
          </div>
          <div class="settings__control">
            <span class="muted" data-reduced style="font-size: 13px;"></span>
          </div>
        </div>
      </section>

      <section class="settings__section" data-section="ai" hidden>
        <div class="settings__row stack-row">
          <div class="settings__label-group">
            <h3 class="settings__label">Ollama Cloud</h3>
            <p class="muted settings__hint">
              Drop a key from <a href="https://ollama.com/cloud" target="_blank" rel="noopener">ollama.com</a>
              to turn on AI across Kuonix; clear it to turn AI off. Saves locally to <code>~/.kuonix/ollama-settings.json</code>.
            </p>
          </div>
        </div>

        <div class="ai-fields" data-ai-fields>
          <div class="settings__row stack-row">
            <div class="settings__label-group">
              <span class="settings__label">API key</span>
            </div>
            <div class="settings__control">
              <div class="field__row">
                <input type="password" data-field="apiKey" placeholder="sk-…" autocomplete="off" />
                <button class="icon-btn" data-action="toggle-secret" title="Show / hide">
                  <i class="bi bi-eye"></i>
                </button>
              </div>
            </div>
          </div>

          <div class="settings__row stack-row">
            <div class="settings__label-group">
              <span class="settings__label">Model</span>
              <small class="muted settings__hint" data-model-hint></small>
            </div>
            <div class="settings__control">
              <input type="hidden" data-field="modelName">
              <div class="model-select" data-model-select>
                <button class="model-select__trigger" data-model-trigger type="button"
                        aria-haspopup="listbox" aria-expanded="false">
                  <span class="model-select__current">
                    <span data-model-selected-name>Select a model</span>
                    <span class="model-tier-badge" data-model-selected-tier hidden></span>
                  </span>
                  <i class="bi bi-chevron-down model-select__chevron"></i>
                </button>
                <div class="model-select__dropdown" data-model-dropdown role="listbox" hidden></div>
              </div>
            </div>
          </div>

          <div class="settings__row stack-row">
            <div class="settings__label-group">
              <span class="settings__label">Temperature <em class="muted" data-temp-val>0.30</em></span>
              <p class="muted settings__hint">Lower = more deterministic. 0.3 is balanced.</p>
            </div>
            <div class="settings__control">
              <input type="range" min="0" max="1.5" step="0.05" data-field="temperature" style="width: 100%; accent-color: var(--accent-color);" />
            </div>
          </div>

          <div class="settings__row stack-row">
            <div class="settings__label-group">
              <span class="settings__label">Max tokens</span>
              <p class="muted settings__hint">Per-response cap. 1024 covers most edits.</p>
            </div>
            <div class="settings__control">
              <input type="number" min="64" max="8192" step="64" data-field="maxTokens" style="width: 100%;" />
            </div>
          </div>

          <div class="settings__row stack-row">
            <div class="settings__label-group">
              <span class="settings__label">Base URL</span>
              <p class="muted settings__hint">Only change for self-hosted Ollama or a private gateway.</p>
            </div>
            <div class="settings__control">
              <input type="text" data-field="baseUrl" placeholder="https://api.ollama.com" style="width: 100%;" />
            </div>
          </div>
        </div>

        <div class="settings__footer">
          <span class="muted" data-status style="font-size: 12px;"></span>
          <div class="card__actions">
            <button class="btn btn--ghost" data-action="reload">
              <i class="bi bi-arrow-clockwise"></i> Reload
            </button>
            <button class="btn btn--accent" data-action="save" disabled>
              <i class="bi bi-check2"></i> Save
            </button>
          </div>
        </div>

        <div class="restart-banner" data-restart hidden>
          <i class="bi bi-arrow-repeat"></i>
          Saved. Restart Kuonix for the new AI settings to take effect.
        </div>
      </section>

      <section class="settings__section" data-section="features" hidden>
        <div class="settings__row stack-row">
          <div class="settings__label-group">
            <h3 class="settings__label">Feature modules</h3>
            <p class="muted settings__hint">Toggle which parts of Kuonix are active. Disabled modules hide their UI entirely. Changes take effect immediately.</p>
          </div>
        </div>

        <div class="module-list" data-module-list>
          ${[
            { key: "editing",        icon: "bi-sliders2-vertical", label: "Editing",         desc: "Sliders panel, color correction, commit & export" },
            { key: "batchProcessing",icon: "bi-images",            label: "Batch processing",desc: "Contact sheet, group filter, multi-image workflows" },
            { key: "rawDecode",      icon: "bi-camera",            label: "RAW decode",      desc: "CR2/NEF/ARW and other RAW format processing" },
            { key: "cameraFeedback", icon: "bi-camera2",           label: "Camera feedback", desc: "EXIF-based tips on how camera settings affect results" },
            { key: "styleProfiles",  icon: "bi-palette",           label: "Style profiles",  desc: "Reference image or portfolio match to guide corrections" },
          ].map(m => `
            <div class="settings__row stack-row module-row">
              <div class="module-row__info">
                <i class="bi ${m.icon}"></i>
                <div>
                  <strong>${m.label}</strong>
                  <span class="muted">${m.desc}</span>
                </div>
              </div>
              <div class="settings__control">
                <label class="switch">
                  <input type="checkbox" data-module="${m.key}">
                  <span class="switch__slider"></span>
                </label>
              </div>
            </div>
          `).join("")}
        </div>
      </section>

      <section class="settings__section" data-section="about" hidden>
        <div class="settings__row stack-row">
          <div class="settings__label-group">
            <h3 class="settings__label">Kuonix</h3>
            <p class="muted settings__hint">A conversational darkroom for RAW workflows.</p>
          </div>
          <div class="settings__control">
            <a class="btn btn--ghost" href="https://github.com/anthropics/claude-code" target="_blank" rel="noopener">
              <i class="bi bi-github"></i> View source
            </a>
          </div>
        </div>

        <div class="settings__row stack-row">
          <div class="settings__label-group">
            <h3 class="settings__label">System info</h3>
          </div>
          <div class="settings__control">
            <dl class="kv">
              <dt>Version</dt><dd>0.4.0 (Phase 4)</dd>
              <dt>Backend</dt><dd>Spring Boot · localhost:8081</dd>
              <dt>Frontend</dt><dd>Electron 29 · vanilla JS · GSAP</dd>
              <dt>AI</dt><dd>LangChain4j + Ollama Cloud</dd>
            </dl>
          </div>
        </div>
      </section>
    </div>

    <style>
      .settings-view {
        padding: var(--space-32) var(--space-32) var(--space-48);
      }
      .settings__header {
        width: min(960px, calc(100% - var(--space-48)));
        margin: 0 auto var(--space-24);
      }
      .settings__subtitle { margin-top: 6px; }

      .settings__content {
        width: min(960px, calc(100% - var(--space-48)));
        max-width: 960px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-24);
      }

      /* Quiet underline tab bar matching visual hierarchy */
      .settings__tabs {
        display: flex;
        gap: var(--space-24);
        border-bottom: 0.5px solid var(--color-border);
        padding-bottom: var(--space-8);
      }
      .settings__tab {
        padding: var(--space-8) 0;
        background: transparent;
        border: 0;
        border-bottom: 2px solid transparent;
        margin-bottom: -9px;
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        transition: color var(--duration-fast) var(--ease-standard),
                    border-color var(--duration-fast) var(--ease-standard);
      }
      .settings__tab:hover { color: var(--color-text); }
      .settings__tab.is-active {
        color: var(--color-text);
        border-bottom-color: var(--accent-color);
        box-shadow: none;
      }

      .settings__section {
        display: flex;
        flex-direction: column;
      }

      .settings__row.stack-row {
        display: grid;
        grid-template-columns: minmax(180px, 1.2fr) minmax(0, 1.8fr);
        align-items: center;
        gap: var(--space-16);
        padding: var(--space-16) 0;
        border-bottom: 0.5px solid var(--color-border);
        margin: 0;
      }
      .settings__label-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .settings__label {
        margin: 0;
        font-size: 13px;
        font-weight: var(--font-weight-semibold);
        color: var(--color-text);
      }
      .settings__hint {
        margin: 0;
        font-size: 12px;
        line-height: 1.4;
      }
      .settings__hint code {
        background: var(--color-secondary);
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 11px;
      }
      .settings__hint a { color: var(--accent-color); }

      .settings__control {
        display: flex;
        align-items: center;
        width: 100%;
        max-width: 480px;
      }

      .settings__footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: var(--space-20);
        gap: 12px;
        flex-wrap: wrap;
      }

      .theme-row { display: flex; gap: 8px; flex-wrap: wrap; }
      .theme-opt {
        padding: 6px 14px;
        border-radius: var(--radius-full);
        border: 1px solid var(--color-border);
        background: var(--color-secondary);
        color: var(--color-text);
        font-size: 12px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        transition: background var(--duration-fast) var(--ease-standard);
      }
      .theme-opt:hover { background: var(--color-secondary-hover); }
      .theme-opt.is-selected {
        background: var(--accent-color);
        color: var(--color-surface);
        border-color: transparent;
      }

      .swatches { display: flex; flex-wrap: wrap; gap: 8px; }
      .swatch {
        width: 26px; height: 26px; border-radius: 50%;
        background: rgb(var(--swatch-rgb)); border: 0;
        box-shadow: 0 0 0 2px var(--color-background), 0 0 0 3px transparent;
        cursor: pointer;
        transition: transform var(--duration-fast) var(--ease-standard);
      }
      .swatch:hover { transform: translateY(-1px); }
      .swatch.is-selected {
        box-shadow: 0 0 0 2px var(--color-background), 0 0 0 4px rgb(var(--swatch-rgb));
      }

      .ai-fields { display: flex; flex-direction: column; }
      .ai-fields[data-disabled="true"] { opacity: 0.55; pointer-events: none; }

      .field__row { display: flex; gap: 6px; width: 100%; }
      .field__row input { flex: 1; }

      input[type="text"], input[type="password"], input[type="number"] {
        padding: 8px 12px;
        border-radius: var(--radius-md);
        background: var(--color-secondary);
        border: 1px solid var(--color-border);
        color: var(--color-text);
        font-size: 13px;
      }
      input:focus {
        outline: 0;
        border-color: var(--accent-color);
        box-shadow: 0 0 0 2px var(--accent-subtle);
      }

      .model-select { position: relative; width: 100%; }
      .model-select__trigger {
        width: 100%; padding: 8px 12px; border-radius: var(--radius-md);
        background: var(--color-secondary); border: 1px solid var(--color-border);
        color: var(--color-text); font-size: 13px; text-align: left;
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        cursor: pointer;
      }
      .model-select__trigger:focus,
      .model-select__trigger.is-open {
        outline: 0; border-color: var(--accent-color);
        box-shadow: 0 0 0 2px var(--accent-subtle);
      }
      .model-select__current {
        display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;
      }
      .model-select__current [data-model-selected-name] {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .model-select__chevron {
        flex-shrink: 0; font-size: 11px; color: var(--color-text-secondary);
      }
      .model-select__dropdown {
        position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 200;
        background: var(--color-surface); border: 1px solid var(--color-border);
        border-radius: 12px; padding: 6px;
        box-shadow: var(--shadow-lg);
        display: flex; flex-direction: column; gap: 2px;
      }
      .model-opt {
        width: 100%; padding: 8px 10px; border-radius: 6px;
        background: transparent; border: 0; text-align: left; cursor: pointer;
        display: flex; flex-direction: column; gap: 2px;
      }
      .model-opt:hover { background: var(--color-secondary); }
      .model-opt.is-selected { background: var(--accent-subtle); }
      .model-opt__row { display: flex; align-items: center; gap: 8px; }
      .model-opt__name { font-size: 12px; font-weight: 500; color: var(--color-text); flex: 1; }
      .model-opt__desc { font-size: 11px; color: var(--color-text-secondary); line-height: 1.3; margin: 0; }
      .model-tier-badge {
        display: inline-flex; align-items: center; padding: 1px 6px;
        border-radius: 999px; font-size: 9px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0;
      }
      .model-tier-badge--paid { background: rgba(234, 179, 8, 0.15); color: rgb(220, 160, 0); }
      .model-tier-badge--free { background: rgba(34, 197, 94, 0.12); color: rgb(22, 163, 74); }

      .switch {
        display: inline-flex; align-items: center; cursor: pointer;
      }
      .switch input { display: none; }
      .switch__slider {
        position: relative; width: 36px; height: 20px;
        background: var(--color-secondary); border: 1px solid var(--color-border);
        border-radius: 999px;
        transition: background var(--duration-fast) var(--ease-standard);
      }
      .switch__slider::after {
        content: ""; position: absolute; top: 1px; left: 1px;
        width: 16px; height: 16px; border-radius: 50%;
        background: var(--color-text-secondary);
        transition: transform var(--duration-fast) var(--ease-standard);
      }
      .switch input:checked + .switch__slider {
        background: var(--accent-color); border-color: transparent;
      }
      .switch input:checked + .switch__slider::after {
        background: var(--color-surface); transform: translateX(16px);
      }

      .restart-banner {
        margin-top: 14px; padding: 10px 14px; border-radius: 10px;
        background: var(--accent-subtle);
        border: 1px solid var(--accent-border);
        font-size: 13px; color: var(--color-text);
        display: flex; align-items: center; gap: 8px;
      }
      .restart-banner i { color: var(--accent-color); }

      .module-list { display: flex; flex-direction: column; }
      .module-row.settings__row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .module-row__info {
        display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;
      }
      .module-row__info .bi {
        font-size: 16px; color: var(--color-text-secondary); flex-shrink: 0; width: 20px;
      }
      .module-row__info div { display: flex; flex-direction: column; gap: 2px; }
      .module-row__info strong { font-size: 13px; font-weight: 600; color: var(--color-text); }
      .module-row__info span { font-size: 11px; }

      .kv {
        display: grid; grid-template-columns: 100px 1fr; gap: 6px 16px;
        margin: 0; font-size: 13px;
      }
      .kv dt { color: var(--color-text-secondary); font-weight: 500; }
      .kv dd { margin: 0; color: var(--color-text); }

      @media (max-width: 720px) {
        .settings-view { padding-inline: var(--space-20); }
        .settings__header, .settings__content { width: 100%; }
        .settings__row.stack-row {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: var(--space-8);
        }
        .settings__control { max-width: 100%; }
      }
    </style>
  `;
}

// ---- Tab switching -----------------------------------------------------

function showSection(view, name) {
  view.querySelectorAll(".settings__tab").forEach((t) => {
    const active = t.dataset.tab === name;
    t.classList.toggle("is-active", active);
    t.setAttribute("aria-selected", String(active));
  });
  view.querySelectorAll(".settings__section").forEach((s) =>
    s.hidden = s.dataset.section !== name);
  if (!isReduced) {
    gsap.from(view.querySelector(`.settings__section[data-section="${name}"] .settings__row`), {
      opacity: 0, y: 6, duration: 0.25, ease: "expo.out", stagger: 0.04, clearProps: "all",
    });
  }
}

// ---- Appearance --------------------------------------------------------

function bindAppearance(view) {
  view.querySelectorAll(".settings__tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      buttonPulse(tab);
      showSection(view, tab.dataset.tab);
    });
  });

  view.querySelectorAll(".theme-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.theme);
      view.querySelectorAll(".theme-opt").forEach(b => b.classList.toggle("is-selected", b === btn));
    });
  });

  view.querySelectorAll(".swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyAccent(btn.dataset.accent);
      view.querySelectorAll(".swatch").forEach(b => b.classList.toggle("is-selected", b === btn));
    });
  });

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reducedEl = view.querySelector("[data-reduced]");
  reducedEl.textContent = reduced
    ? "Detected: reduced motion is on."
    : "Detected: full motion.";
}

// ---- AI section --------------------------------------------------------

function bindAiSection(view) {
  // Toggle secret visibility.
  view.querySelector("[data-action='toggle-secret']").addEventListener("click", (e) => {
    const input = view.querySelector("[data-field='apiKey']");
    const icon = e.currentTarget.querySelector("i");
    const isPwd = input.type === "password";
    input.type = isPwd ? "text" : "password";
    icon.className = isPwd ? "bi bi-eye-slash" : "bi bi-eye";
  });

  // Mark dirty on any field change.
  view.querySelectorAll("[data-field]").forEach((el) => {
    el.addEventListener("input", () => markDirty(view));
    el.addEventListener("change", () => markDirty(view));
  });

  // Live temperature display.
  const temp = view.querySelector("[data-field='temperature']");
  const tempVal = view.querySelector("[data-temp-val]");
  temp.addEventListener("input", () => { tempVal.textContent = Number(temp.value).toFixed(2); });

  setupModelSelect(view);

  // Buttons.
  view.querySelector("[data-action='reload']").addEventListener("click", () => {
    loadAiSettings(view);
    toast.info("Settings reloaded.");
  });
  view.querySelector("[data-action='save']").addEventListener("click", () => saveAi(view));
}

async function loadAiSettings(view) {
  const status = view.querySelector("[data-status]");
  status.textContent = "Loading…";
  try {
    const [s, models] = await Promise.all([
      getOllama().catch(() => null),
      listModels().catch(() => []),
    ]);
    modelOptions = models || [];

    if (s === null) {
      // Backend unreachable — keep existing fields if we already have settings
      // (e.g. user just saved and backend is restarting), only use defaults on
      // the very first load when there is nothing yet to show.
      if (!currentSettings) {
        currentSettings = {
          enabled: false, apiKey: "", modelName: "qwen3.5:cloud",
          baseUrl: "https://api.ollama.com", temperature: 0.3, maxTokens: 1024,
        };
        populateFields(view);
      }
      status.textContent = "Could not reach backend at :8081.";
      return;
    }

    currentSettings = s;
    populateFields(view);
    dirty = false;
    view.querySelector("[data-action='save']").disabled = true;
    view.querySelector("[data-restart]").hidden = true;
    status.textContent = currentSettings.apiKey
      ? "Connected — AI is live across Kuonix."
      : "Add an Ollama key to enable AI features.";
  } catch (err) {
    console.error(err);
    status.textContent = "Could not reach backend at :8081.";
  }
}

function populateFields(view) {
  const s = currentSettings;
  view.querySelector("[data-field='apiKey']").value = s.apiKey || "";
  view.querySelector("[data-field='baseUrl']").value = s.baseUrl || "https://api.ollama.com";
  view.querySelector("[data-field='temperature']").value = s.temperature ?? 0.3;
  view.querySelector("[data-temp-val]").textContent = Number(s.temperature ?? 0.3).toFixed(2);
  view.querySelector("[data-field='maxTokens']").value = s.maxTokens ?? 1024;

  // Model dropdown.
  const opts = modelOptions.length ? modelOptions : [{ value: s.modelName, label: s.modelName, description: "" }];
  setModelDropdown(view, opts, s.modelName);
}

function parseTier(label) {
  if (/·\s*Paid/i.test(label)) return "paid";
  if (/·\s*Free/i.test(label)) return "free";
  return null;
}

function parseModelName(label) {
  return label.replace(/\s*·\s*(Paid|Free)\s*$/i, "").trim();
}

function openModelDropdown(trigger, dropdown) {
  trigger.classList.add("is-open");
  trigger.setAttribute("aria-expanded", "true");
  dropdown.hidden = false;
  if (!isReduced) {
    gsap.fromTo(dropdown,
      { opacity: 0, y: -6 },
      { opacity: 1, y: 0, duration: 0.18, ease: "expo.out", clearProps: "all" }
    );
  }
}

function closeModelDropdown(trigger, dropdown) {
  trigger.classList.remove("is-open");
  trigger.setAttribute("aria-expanded", "false");
  dropdown.hidden = true;
}

function setModelDropdown(view, opts, selectedValue) {
  const hiddenInput = view.querySelector("[data-field='modelName']");
  const dropdown = view.querySelector("[data-model-dropdown]");
  const selectedName = view.querySelector("[data-model-selected-name]");
  const selectedTier = view.querySelector("[data-model-selected-tier]");
  const hint = view.querySelector("[data-model-hint]");

  const allOpts = [...opts];
  if (!allOpts.find((m) => m.value === selectedValue)) {
    allOpts.push({ value: selectedValue, label: `${selectedValue} (custom)`, description: "" });
  }

  dropdown.innerHTML = allOpts.map((m) => {
    const tier = parseTier(m.label);
    const name = parseModelName(m.label);
    const isSelected = m.value === selectedValue;
    const tierHtml = tier
      ? `<span class="model-tier-badge model-tier-badge--${tier}">${tier === "paid" ? "Paid" : "Free"}</span>`
      : "";
    return `
      <button class="model-opt${isSelected ? " is-selected" : ""}"
              data-value="${m.value}" type="button" role="option" aria-selected="${isSelected}">
        <div class="model-opt__row">
          <span class="model-opt__name">${name}</span>
          ${tierHtml}
        </div>
        ${m.description ? `<p class="model-opt__desc">${m.description}</p>` : ""}
      </button>`;
  }).join("");

  const sel = allOpts.find((m) => m.value === selectedValue);
  if (sel) {
    const tier = parseTier(sel.label);
    selectedName.textContent = parseModelName(sel.label);
    if (tier) {
      selectedTier.textContent = tier === "paid" ? "Paid" : "Free";
      selectedTier.className = `model-tier-badge model-tier-badge--${tier}`;
      selectedTier.hidden = false;
    } else {
      selectedTier.hidden = true;
    }
  }

  hiddenInput.value = selectedValue;
  hint.textContent = sel?.description || "";
}

function setupModelSelect(view) {
  const trigger = view.querySelector("[data-model-trigger]");
  const dropdown = view.querySelector("[data-model-dropdown]");
  const hiddenInput = view.querySelector("[data-field='modelName']");
  const hint = view.querySelector("[data-model-hint]");

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.hidden) {
      openModelDropdown(trigger, dropdown);
    } else {
      closeModelDropdown(trigger, dropdown);
    }
  });

  dropdown.addEventListener("click", (e) => {
    const opt = e.target.closest(".model-opt");
    if (!opt) return;

    const value = opt.dataset.value;
    const found = modelOptions.find((m) => m.value === value)
      || { value, label: value, description: "" };

    hiddenInput.value = value;

    const selectedName = view.querySelector("[data-model-selected-name]");
    const selectedTier = view.querySelector("[data-model-selected-tier]");
    const tier = parseTier(found.label);
    selectedName.textContent = parseModelName(found.label);
    if (tier) {
      selectedTier.textContent = tier === "paid" ? "Paid" : "Free";
      selectedTier.className = `model-tier-badge model-tier-badge--${tier}`;
      selectedTier.hidden = false;
    } else {
      selectedTier.hidden = true;
    }

    hint.textContent = found.description || "";

    dropdown.querySelectorAll(".model-opt").forEach((b) => {
      b.classList.toggle("is-selected", b.dataset.value === value);
      b.setAttribute("aria-selected", String(b.dataset.value === value));
    });

    closeModelDropdown(trigger, dropdown);
    hiddenInput.dispatchEvent(new Event("change"));
  });

  document.addEventListener("click", () => {
    if (!dropdown.hidden) closeModelDropdown(trigger, dropdown);
  });
}

// ---- Features section --------------------------------------------------

function bindFeaturesSection(view) {
  view.querySelector("[data-module-list]").addEventListener("change", async (e) => {
    const toggle = e.target.closest("[data-module]");
    if (!toggle) return;
    const key = toggle.dataset.module;
    const checked = toggle.checked;

    const current = window.__kuonixConfig?.modules || {};
    const updated = { ...current, [key]: checked };
    window.__kuonixConfig = { ...window.__kuonixConfig, modules: updated };

    try {
      await saveModules(updated);
      toast.success(`${key} ${checked ? "enabled" : "disabled"}.`);
    } catch (err) {
      console.error(err);
      toggle.checked = !checked;
      window.__kuonixConfig.modules[key] = !checked;
      toast.error("Could not save module settings.");
    }
  });
}

async function loadModuleSettings(view) {
  try {
    const res = await getModules();
    const modules = res?.modules || res || {};
    const updated = { ...window.__kuonixConfig?.modules, ...modules };
    window.__kuonixConfig = { ...window.__kuonixConfig, modules: updated };
    view.querySelectorAll("[data-module]").forEach((el) => {
      el.checked = !!updated[el.dataset.module];
    });
  } catch {
    const fallback = window.__kuonixConfig?.modules || {};
    view.querySelectorAll("[data-module]").forEach((el) => {
      el.checked = fallback[el.dataset.module] !== false;
    });
  }
}

function markDirty(view) {
  if (!currentSettings) return;
  dirty = true;
  view.querySelector("[data-action='save']").disabled = false;
  view.querySelector("[data-status]").textContent = "Unsaved changes.";
}

async function saveAi(view) {
  const apiKey = view.querySelector("[data-field='apiKey']").value.trim();
  const modelName = view.querySelector("[data-field='modelName']").value.trim();
  const baseUrl = view.querySelector("[data-field='baseUrl']").value.trim();
  const temperature = parseFloat(view.querySelector("[data-field='temperature']").value);
  const maxTokens = parseInt(view.querySelector("[data-field='maxTokens']").value, 10);

  // AI is enabled by configuration: a key turns it on, a blank key turns it off.
  const enabled = !!apiKey;
  if (apiKey) {
    if (!modelName) return toast.error("Pick a model.");
    if (!baseUrl) return toast.error("Base URL is required.");
    if (isNaN(temperature) || temperature < 0 || temperature > 2) return toast.error("Temperature must be 0–2.");
    if (isNaN(maxTokens) || maxTokens <= 0) return toast.error("Max tokens must be positive.");
  }

  const saveBtn = view.querySelector("[data-action='save']");
  saveBtn.disabled = true;
  view.querySelector("[data-status]").textContent = "Saving…";

  try {
    const res = await saveOllama({ enabled, apiKey, modelName, baseUrl, temperature, maxTokens });
    if (res?.success === false) throw new Error(res?.message || "Save failed");
    currentSettings = { enabled, apiKey, modelName, baseUrl, temperature, maxTokens };
    dirty = false;
    view.querySelector("[data-status]").textContent = "Saved.";
    if (res?.restartRequired) view.querySelector("[data-restart]").hidden = false;
    toast.success("Settings saved.");
  } catch (err) {
    console.error(err);
    saveBtn.disabled = false;
    view.querySelector("[data-status]").textContent = err?.message || "Save failed.";
    toast.error(err?.message || "Could not save settings.");
  }
}
