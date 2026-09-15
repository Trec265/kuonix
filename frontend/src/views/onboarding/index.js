// First-run onboarding wizard.
// Shown once when ~/.kuonix/app-modules.json does not exist.
// Resolves after the user completes or dismisses all steps.

import { gsap } from "../../../node_modules/gsap/index.js";
import { isReduced } from "../../motion.js";
import { saveModules } from "../../api/endpoints/settings.js";
import { toast } from "../../components/toast/index.js";

const INTENT_MODULES = {
  professional: { editing: true, aiAssistant: true, batchProcessing: true, rawDecode: true, cameraFeedback: false, styleProfiles: true },
  learning:     { editing: true, aiAssistant: true, batchProcessing: false, rawDecode: true, cameraFeedback: true,  styleProfiles: false },
  both:         { editing: true, aiAssistant: true, batchProcessing: true, rawDecode: true, cameraFeedback: true,  styleProfiles: true },
};

// aiAssistant is intentionally absent — it is not a manual toggle; it turns on
// automatically when an Ollama key is configured in Settings → AI.
const MODULE_LABELS = {
  editing:         { label: "Editing",          icon: "bi-sliders2-vertical", desc: "Sliders, color correction, commit & export" },
  batchProcessing: { label: "Batch processing",  icon: "bi-images",            desc: "Contact sheet and multi-image workflows" },
  rawDecode:       { label: "RAW decode",         icon: "bi-camera",            desc: "CR2, NEF, ARW and other RAW formats" },
  cameraFeedback:  { label: "Camera feedback",   icon: "bi-camera2",           desc: "EXIF-based in-camera setting tips" },
  styleProfiles:   { label: "Style profiles",    icon: "bi-palette",           desc: "Reference image or portfolio-matched look" },
};

export function runOnboarding() {
  return new Promise((resolve) => {
    const overlay = buildOverlay(resolve);
    document.body.appendChild(overlay);
    if (!isReduced) {
      gsap.from(overlay.querySelector(".ob-modal"), {
        opacity: 0, scale: 0.96, y: 20, duration: 0.4, ease: "expo.out",
      });
    }
  });
}

function buildOverlay(resolve) {
  const overlay = document.createElement("div");
  overlay.className = "ob-overlay";

  let step = 0;
  let intent = null;
  let modules = { ...INTENT_MODULES.both };

  const modal = document.createElement("div");
  modal.className = "ob-modal";
  overlay.appendChild(modal);

  function render() {
    modal.innerHTML = stepHtml(step, intent, modules);
    bindStep(modal, step, {
      onIntent(chosen) { intent = chosen; modules = { ...INTENT_MODULES[chosen] }; },
      onToggle(key, val) { modules[key] = val; },
      onNext() { step++; render(); },
      onBack() { step--; render(); },
      async onFinish() {
        try { await saveModules(modules); } catch { /* non-fatal */ }
        window.__kuonixConfig = { ...window.__kuonixConfig, modules, _firstRun: false };
        queueDisabledToasts(modules);
        dismiss(overlay, resolve);
      },
    });
  }

  render();
  return overlay;
}

function stepHtml(step, intent, modules) {
  const steps = ["Intent", "Features", "Done"];
  const indicators = steps.map((s, i) =>
    `<span class="ob-step ${i === step ? "is-active" : i < step ? "is-done" : ""}">${i < step ? "✓" : i + 1} ${s}</span>`
  ).join("");

  const navBack = step > 0 ? `<button class="btn btn--ghost" data-ob="back">Back</button>` : `<span></span>`;
  const navNext = step < 2
    ? `<button class="btn btn--accent" data-ob="next" ${step === 0 && !intent ? "disabled" : ""}>Continue</button>`
    : `<button class="btn btn--accent" data-ob="finish">Start using Kuonix</button>`;

  return `
    <div class="ob-head">
      <div class="ob-logo"><i class="bi bi-aperture"></i> Kuonix</div>
      <div class="ob-indicators">${indicators}</div>
    </div>
    <div class="ob-body">${stepBody(step, intent, modules)}</div>
    <div class="ob-nav">${navBack}${navNext}</div>
    ${styles()}
  `;
}

function stepBody(step, intent, modules) {
  if (step === 0) return `
    <h2>How will you use Kuonix?</h2>
    <p class="ob-sub">This sets a sensible starting configuration. You can change everything later in Settings.</p>
    <div class="ob-intents">
      ${[
        { id: "professional", icon: "bi-briefcase", title: "Professional editor", desc: "I edit finished work and need precise correction tools." },
        { id: "learning",     icon: "bi-book",      title: "Learning photography",  desc: "I want to understand my images and improve my shooting." },
        { id: "both",         icon: "bi-layers",    title: "Both",                  desc: "I edit and want to learn from each session." },
      ].map(o => `
        <button class="ob-intent-card ${intent === o.id ? "is-selected" : ""}" data-intent="${o.id}">
          <i class="bi ${o.icon}"></i>
          <strong>${o.title}</strong>
          <span>${o.desc}</span>
        </button>
      `).join("")}
    </div>`;

  if (step === 1) return `
    <h2>Which features do you need?</h2>
    <p class="ob-sub">Pre-set from your intent. Toggle anything off to keep the UI focused.</p>
    <div class="ob-modules">
      ${Object.entries(MODULE_LABELS).map(([key, m]) => `
        <label class="ob-module-row">
          <div class="ob-module-info">
            <i class="bi ${m.icon}"></i>
            <div>
              <strong>${m.label}</strong>
              <span>${m.desc}</span>
            </div>
          </div>
          <input type="checkbox" data-module="${key}" ${modules[key] ? "checked" : ""}>
        </label>
      `).join("")}
    </div>`;

  return `
    <div class="ob-done">
      <i class="bi bi-check-circle ob-done-icon"></i>
      <h2>You're set up.</h2>
      <p class="ob-sub">Your chosen features are active. You can adjust them any time in <strong>Settings → Features</strong>.</p>
      <ul class="ob-summary">
        ${Object.entries(modules).filter(([key]) => MODULE_LABELS[key]).map(([key, on]) => {
          const m = MODULE_LABELS[key];
          return `<li class="${on ? "is-on" : "is-off"}"><i class="bi ${on ? "bi-check-lg" : "bi-x-lg"}"></i> ${m.label}</li>`;
        }).join("")}
      </ul>
    </div>`;
}

function bindStep(modal, step, handlers) {
  modal.querySelectorAll("[data-intent]").forEach((btn) => {
    btn.addEventListener("click", () => {
      handlers.onIntent(btn.dataset.intent);
      modal.querySelectorAll("[data-intent]").forEach((b) => b.classList.toggle("is-selected", b === btn));
      const nextBtn = modal.querySelector("[data-ob='next']");
      if (nextBtn) nextBtn.disabled = false;
    });
  });

  modal.querySelectorAll("[data-module]").forEach((cb) => {
    cb.addEventListener("change", () => handlers.onToggle(cb.dataset.module, cb.checked));
  });

  modal.querySelector("[data-ob='back']")?.addEventListener("click", handlers.onBack);
  modal.querySelector("[data-ob='next']")?.addEventListener("click", handlers.onNext);
  modal.querySelector("[data-ob='finish']")?.addEventListener("click", handlers.onFinish);
}

function queueDisabledToasts(modules) {
  const names = {
    batchProcessing: "Batch processing", cameraFeedback: "Camera feedback", styleProfiles: "Style profiles",
  };
  for (const [key, label] of Object.entries(names)) {
    if (!modules[key]) {
      setTimeout(() => toast.info(`${label} is off — enable in Settings → Features.`), 600);
    }
  }
}

function dismiss(overlay, resolve) {
  if (isReduced) {
    overlay.remove();
    resolve();
    return;
  }
  gsap.to(overlay.querySelector(".ob-modal"), {
    opacity: 0, scale: 0.97, y: -12, duration: 0.3, ease: "expo.in",
    onComplete: () => { overlay.remove(); resolve(); },
  });
}

function styles() {
  return `
    <style>
      .ob-overlay {
        position: fixed; inset: 0; z-index: 9000;
        background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
        display: flex; align-items: center; justify-content: center; padding: 24px;
      }
      .ob-modal {
        background: var(--color-surface); border: 1px solid var(--color-card-border);
        border-radius: 20px; padding: 32px; width: 100%; max-width: 540px;
        box-shadow: var(--shadow-lg);
      }
      .ob-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
      .ob-logo { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
      .ob-logo .bi { font-size: 18px; color: rgb(var(--accent-color-rgb)); }
      .ob-indicators { display: flex; gap: 6px; }
      .ob-step {
        font-size: 11px; font-weight: 600; padding: 4px 10px;
        border-radius: 999px; background: var(--color-secondary); color: var(--color-text-secondary);
        transition: background 0.2s, color 0.2s;
      }
      .ob-step.is-active { background: rgba(var(--accent-color-rgb),0.15); color: rgb(var(--accent-color-rgb)); }
      .ob-step.is-done { background: rgba(var(--accent-color-rgb),0.08); color: rgb(var(--accent-color-rgb)); }
      .ob-body { min-height: 280px; }
      .ob-body h2 { margin: 0 0 6px; font-size: 20px; font-weight: 700; }
      .ob-sub { margin: 0 0 20px; font-size: 13px; color: var(--color-text-secondary); line-height: 1.5; }
      .ob-nav { display: flex; justify-content: space-between; align-items: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--color-border); }

      .ob-intents { display: flex; flex-direction: column; gap: 8px; }
      .ob-intent-card {
        display: flex; align-items: center; gap: 14px;
        padding: 14px 16px; border-radius: 12px;
        border: 1.5px solid var(--color-border); background: var(--color-secondary);
        text-align: left; cursor: pointer; width: 100%;
        transition: border-color 0.15s, background 0.15s;
      }
      .ob-intent-card:hover { background: var(--color-secondary-hover); border-color: rgba(var(--accent-color-rgb),0.4); }
      .ob-intent-card.is-selected { border-color: rgb(var(--accent-color-rgb)); background: rgba(var(--accent-color-rgb),0.07); }
      .ob-intent-card .bi { font-size: 20px; color: var(--color-text-secondary); flex-shrink: 0; }
      .ob-intent-card.is-selected .bi { color: rgb(var(--accent-color-rgb)); }
      .ob-intent-card strong { font-size: 14px; font-weight: 600; display: block; }
      .ob-intent-card span { font-size: 12px; color: var(--color-text-secondary); }

      .ob-modules { display: flex; flex-direction: column; gap: 2px; }
      .ob-module-row {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 10px 12px; border-radius: 10px; cursor: pointer;
        transition: background 0.15s;
      }
      .ob-module-row:hover { background: var(--color-secondary); }
      .ob-module-info { display: flex; align-items: center; gap: 12px; flex: 1; }
      .ob-module-info .bi { font-size: 16px; color: var(--color-text-secondary); width: 20px; flex-shrink: 0; }
      .ob-module-info div { display: flex; flex-direction: column; gap: 2px; }
      .ob-module-info strong { font-size: 13px; font-weight: 600; }
      .ob-module-info span { font-size: 11px; color: var(--color-text-secondary); }
      .ob-module-row input[type="checkbox"] { accent-color: rgb(var(--accent-color-rgb)); width: 16px; height: 16px; flex-shrink: 0; }

      .ob-done { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 8px 0; }
      .ob-done-icon { font-size: 48px; color: rgb(var(--accent-color-rgb)); margin-bottom: 12px; }
      .ob-done h2 { margin: 0 0 8px; }
      .ob-summary { list-style: none; padding: 0; margin: 16px 0 0; display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
      .ob-summary li { font-size: 12px; padding: 4px 10px; border-radius: 999px; display: flex; align-items: center; gap: 5px; }
      .ob-summary li.is-on { background: rgba(var(--accent-color-rgb),0.12); color: rgb(var(--accent-color-rgb)); }
      .ob-summary li.is-off { background: var(--color-secondary); color: var(--color-text-secondary); }
    </style>
  `;
}
