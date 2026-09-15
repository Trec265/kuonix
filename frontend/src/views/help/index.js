// Help — quick start, prompt cookbook, agent tool reference, shortcuts.
//
// Static-only. Each section is collapsible so the page is scannable on first
// load. Uses the same card vocabulary as Settings.

import { gsap } from "../../../node_modules/gsap/index.js";
import { enterView, isReduced, buttonPulse } from "../../motion.js";

let ctx = null;
let outletRef = null;

const PROMPTS = [
  {
    title: "Auto white balance",
    text: "Fix the white balance — there's a slight blue cast on the wall.",
    bucket: "Color",
  },
  {
    title: "Lift shadows",
    text: "Open up the shadows a touch without crushing the highlights.",
    bucket: "Tone",
  },
  {
    title: "Portrait skin tone",
    text: "Warm the skin tones a little and don't oversaturate.",
    bucket: "Portrait",
  },
  {
    title: "Cinematic teal-and-orange",
    text: "Push it cooler in the shadows, warmer in the highlights, gentle vibrance.",
    bucket: "Look",
  },
  {
    title: "Recover overexposed sky",
    text: "Pull back the highlights — the sky is blown.",
    bucket: "Tone",
  },
  {
    title: "Vintage film",
    text: "Give it a faded film look — lifted blacks, muted reds, soft contrast.",
    bucket: "Look",
  },
  {
    title: "Restore yellowed scan",
    text: "This is an old scan with a yellow cast — neutralise it and add a bit of contrast.",
    bucket: "Restoration",
  },
  {
    title: "Match this reference",
    text: "Make this match the colour of the previously committed image.",
    bucket: "Batch",
  },
  {
    title: "Selective saturation",
    text: "Pull the reds back a touch — the dress is too saturated. Don't touch the greens.",
    bucket: "Color",
  },
];

const TOOLS = [
  {
    name: "analyzeImage",
    icon: "bi-graph-up",
    summary: "Reads exposure, contrast, white balance, saturation, and noise statistics.",
    detail: "Runs once when you upload — cached and reused for every later prompt.",
  },
  {
    name: "classifyIssues",
    icon: "bi-list-check",
    summary: "Tags the image with named issues (cool cast, underexposed, oversaturated…).",
    detail: "These are the chips you see in the analysis ribbon and the issue dots in the contact sheet.",
  },
  {
    name: "recommendCorrections",
    icon: "bi-lightbulb",
    summary: "Ranks correction algorithms for the detected issues.",
    detail: "The agent uses this to decide which method to call, not to ask you.",
  },
  {
    name: "describeAlgorithm",
    icon: "bi-book",
    summary: "Returns the full reference for one method (gray world, CLAHE, vibrance, etc.).",
    detail: "Useful when you want the agent to explain why it picked something.",
  },
  {
    name: "listWorkflows",
    icon: "bi-stack",
    summary: "Multi-step recipes (portrait restoration, sky rescue, denoise + sharpen…).",
    detail: "Try \"run the portrait restoration workflow\" to chain several steps.",
  },
  {
    name: "previewCorrection",
    icon: "bi-eye",
    summary: "Generates a preview that lands in the agent rail as a card.",
    detail: "Click Accept to commit, Discard to throw it away. Previews are always non-destructive.",
  },
  {
    name: "commitCorrection",
    icon: "bi-check2-square",
    summary: "Locks a correction in as the new working baseline.",
    detail: "Subsequent prompts chain on top of this — each commit becomes a node in the history strip.",
  },
  {
    name: "applyCorrection",
    icon: "bi-cloud-arrow-down",
    summary: "Saves the final image into your visible workspace folder.",
    detail: "Use the Export view to batch this across multiple images.",
  },
];

const SHORTCUTS = [
  { keys: ["1"],              desc: "Jump to Edit" },
  { keys: ["2"],              desc: "Jump to Library" },
  { keys: ["3"],              desc: "Jump to Export" },
  { keys: ["4"],              desc: "Jump to Settings" },
  { keys: ["5"],              desc: "Jump to Help" },
  { keys: ["/"],              desc: "Focus the agent prompt" },
  { keys: ["Enter"],          desc: "Send the current prompt" },
  { keys: ["Shift", "Enter"], desc: "New line in the prompt" },
  { keys: ["Ctrl", "B"],      desc: "Toggle Single ↔ Batch mode" },
  { keys: ["Ctrl", "."],      desc: "Collapse the agent rail" },
];

export function mount(outlet) {
  outletRef = outlet;
  outlet.innerHTML = "";

  const view = document.createElement("section");
  view.className = "view help-view";
  view.dataset.view = "help";
  outlet.appendChild(view);

  view.innerHTML = template();
  bindActions(view);

  ctx = enterView(outlet);

  if (!isReduced) {
    gsap.from([...view.querySelectorAll(".help__section")], {
      opacity: 0, y: 12, duration: 0.4, ease: "expo.out",
      stagger: { each: 0.05, from: "start" }, clearProps: "all",
    });
  }
}

export function unmount() {
  ctx?.revert?.();
  ctx = null;
  outletRef = null;
}

// ---------------------------------------------------------------------------

function template() {
  return `
    <header class="view-header help__header">
      <div>
        <p class="eyebrow">Help</p>
        <h1 class="display-heading">Conversational darkroom</h1>
        <p class="muted help__subtitle">
          Drop an image. Tell the agent what you want. Accept the result.
          That's the loop — no sliders required.
        </p>
      </div>
    </header>

    <div class="help__content reveal">

      <section class="help__section" data-section="quickstart">
        <header class="help__section-head">
          <h2 class="help__section-title"><i class="bi bi-rocket-takeoff"></i> Quick start</h2>
        </header>

        <ol class="help__steps">
          <li class="help__step stack-row">
            <span class="help__step-num">01</span>
            <div class="help__step-body">
              <strong class="help__step-title">Drop or browse</strong>
              <p class="muted help__step-desc">JPEG, PNG, TIFF, BMP, WEBP, or RAW (CR2/3, NEF, ARW, DNG, RAF, ORF). Kuonix decodes RAW automatically.</p>
            </div>
          </li>
          <li class="help__step stack-row">
            <span class="help__step-num">02</span>
            <div class="help__step-body">
              <strong class="help__step-title">Wait for analysis</strong>
              <p class="muted help__step-desc">The ribbon shows detected issues (cool cast, oversaturation, blown highlights…) within a second or two.</p>
            </div>
          </li>
          <li class="help__step stack-row">
            <span class="help__step-num">03</span>
            <div class="help__step-body">
              <strong class="help__step-title">Prompt the agent</strong>
              <p class="muted help__step-desc">Plain English in the bottom rail. See prompt examples below.</p>
            </div>
          </li>
          <li class="help__step stack-row">
            <span class="help__step-num">04</span>
            <div class="help__step-body">
              <strong class="help__step-title">Preview → Accept</strong>
              <p class="muted help__step-desc">A preview card appears in the rail. Accept commits the correction; subsequent prompts chain on top.</p>
            </div>
          </li>
          <li class="help__step stack-row">
            <span class="help__step-num">05</span>
            <div class="help__step-body">
              <strong class="help__step-title">Export</strong>
              <p class="muted help__step-desc">When finished, the Export view saves full-resolution corrected files to your workspace folder.</p>
            </div>
          </li>
        </ol>

        <div class="help__modes">
          <div class="help__mode stack-row">
            <i class="bi bi-image help__mode-icon"></i>
            <div>
              <strong class="help__mode-title">Single mode</strong>
              <p class="muted help__mode-desc">One image, full ribbon. The agent works on the active image; histogram lives in the Adjust panel.</p>
            </div>
          </div>
          <div class="help__mode stack-row">
            <i class="bi bi-images help__mode-icon"></i>
            <div>
              <strong class="help__mode-title">Batch mode</strong>
              <p class="muted help__mode-desc">Many images grouped by issue. Pick a subset, prompt once, the agent runs across the selection.</p>
            </div>
          </div>
        </div>
      </section>

      <div class="help__columns">
        <section class="help__section" data-section="cookbook">
          <header class="help__section-head">
            <h2 class="help__section-title"><i class="bi bi-chat-quote"></i> Prompt cookbook</h2>
            <p class="muted help__section-hint">Tuned for the agent's vocabulary. Click any prompt to copy.</p>
          </header>

          <div class="help__prompts">
            ${PROMPTS.map(p => `
              <button class="help-prompt stack-row" data-prompt="${escapeAttr(p.text)}">
                <span class="help-prompt__bucket">${p.bucket}</span>
                <div class="help-prompt__body">
                  <strong class="help-prompt__title">${p.title}</strong>
                  <span class="muted help-prompt__text">"${p.text}"</span>
                </div>
                <i class="bi bi-clipboard help-prompt__copy"></i>
              </button>
            `).join("")}
          </div>
        </section>

        <section class="help__section" data-section="tools">
          <header class="help__section-head">
            <h2 class="help__section-title"><i class="bi bi-tools"></i> What the agent can call</h2>
            <p class="muted help__section-hint">Eight tools wrap backend image processing routines.</p>
          </header>

          <ul class="help__tools">
            ${TOOLS.map(t => `
              <li class="help-tool stack-row">
                <i class="bi ${t.icon} help-tool__icon"></i>
                <div class="help-tool__body">
                  <div class="help-tool__header">
                    <code class="help-tool__name">${t.name}</code>
                  </div>
                  <p class="help-tool__summary">${t.summary}</p>
                  <p class="muted help-tool__detail">${t.detail}</p>
                </div>
              </li>
            `).join("")}
          </ul>
        </section>
      </div>

      <section class="help__section" data-section="shortcuts">
        <header class="help__section-head">
          <h2 class="help__section-title"><i class="bi bi-keyboard"></i> Keyboard shortcuts</h2>
        </header>

        <ul class="help__shortcuts">
          ${SHORTCUTS.map(s => `
            <li class="help-shortcut stack-row">
              <span class="help-shortcut__keys">
                ${s.keys.map(k => `<kbd>${k}</kbd>`).join('<span class="plus">+</span>')}
              </span>
              <span class="muted help-shortcut__desc">${s.desc}</span>
            </li>
          `).join("")}
        </ul>
      </section>

      <section class="help__section help__section--troubleshoot" data-section="troubleshoot">
        <header class="help__section-head">
          <h2 class="help__section-title"><i class="bi bi-life-preserver"></i> Troubleshooting</h2>
        </header>

        <div class="help__troubleshoot">
          <details class="help-accordion stack-row">
            <summary>Agent says "AI is disabled"</summary>
            <p class="muted">Open <a href="#/settings">Settings → AI</a>, toggle Ollama on, paste your key, save, and restart Kuonix.</p>
          </details>
          <details class="help-accordion stack-row">
            <summary>RAW won't decode</summary>
            <p class="muted">Kuonix bundles LibRaw/dcraw binaries for Win, macOS, and Linux. If your camera's RAW format isn't listed in the dropzone subtitle, let us know — most can be added in a few minutes.</p>
          </details>
          <details class="help-accordion stack-row">
            <summary>"Could not fetch image" right after upload</summary>
            <p class="muted">Backend at <code>localhost:8081</code> may have crashed. Check the dev console for a stack trace, then relaunch.</p>
          </details>
          <details class="help-accordion stack-row">
            <summary>Agent picks the wrong correction</summary>
            <p class="muted">Be specific — name the algorithm ("use shades of gray", "apply vibrance") or the symptom ("the reds are crushed"). The agent will defer to explicit instructions.</p>
          </details>
        </div>
      </section>

    </div>

    <style>
      .help-view {
        padding: var(--space-32) var(--space-32) var(--space-48);
      }
      .help__header {
        width: min(960px, calc(100% - var(--space-48)));
        margin: 0 auto var(--space-24);
      }
      .help__subtitle { margin-top: 6px; }

      .help__content {
        width: min(960px, calc(100% - var(--space-48)));
        max-width: 960px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-32);
      }

      .help__section {
        padding: 0 0 var(--space-20);
        border-bottom: 0.5px solid var(--color-border);
      }
      .help__section:last-child {
        border-bottom: none;
      }
      .help__section-head {
        margin-bottom: var(--space-12);
      }
      .help__section-title {
        margin: 0 0 var(--space-4);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-semibold);
        letter-spacing: 0.02em;
        text-transform: uppercase;
        color: var(--color-text-secondary);
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .help__section-title i {
        color: var(--color-text-secondary);
      }
      .help__section-hint {
        margin: 0;
        font-size: 12px;
      }

      .help__steps {
        list-style: none;
        padding: 0;
        margin: 0 0 var(--space-16);
        display: flex;
        flex-direction: column;
      }
      .help__step.stack-row {
        display: grid;
        grid-template-columns: 32px 1fr;
        align-items: baseline;
        gap: var(--space-12);
        padding: var(--space-12) 0;
        border-bottom: 0.5px solid var(--color-border);
        margin: 0;
      }
      .help__step:last-child { border-bottom: none; }
      .help__step-num {
        font-family: var(--font-family-mono);
        font-size: 11px;
        color: var(--color-text-secondary);
        font-weight: 600;
      }
      .help__step-body { display: flex; flex-direction: column; gap: 2px; }
      .help__step-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text);
      }
      .help__step-desc {
        margin: 0;
        font-size: 12px;
        line-height: 1.4;
      }

      .help__modes {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-16);
        margin-top: var(--space-12);
      }
      .help__mode.stack-row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: var(--space-12) 0;
        border-bottom: none;
        margin: 0;
      }
      .help__mode-icon {
        font-size: 18px;
        color: var(--color-text-secondary);
        margin-top: 1px;
      }
      .help__mode-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text);
      }
      .help__mode-desc {
        margin: 2px 0 0;
        font-size: 12px;
        line-height: 1.4;
      }

      .help__columns {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-32);
      }
      .help__columns .help__section {
        border-bottom: none;
        padding: 0;
      }

      .help__prompts {
        display: flex;
        flex-direction: column;
      }
      .help-prompt.stack-row {
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 12px;
        padding: var(--space-10) 0;
        border-bottom: 0.5px solid var(--color-border);
        background: transparent;
        border-top: none;
        border-left: none;
        border-right: none;
        text-align: left;
        cursor: pointer;
        color: var(--color-text);
        margin: 0;
        transition: background var(--duration-fast) var(--ease-standard);
      }
      .help-prompt:last-child { border-bottom: none; }
      .help-prompt:hover {
        background: var(--color-secondary);
      }
      .help-prompt__bucket {
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 2px 6px;
        border-radius: var(--radius-sm);
        background: var(--color-secondary);
        color: var(--color-text-secondary);
        border: 1px solid var(--color-border);
      }
      .help-prompt__body {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .help-prompt__title {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-text);
      }
      .help-prompt__text {
        font-size: 11px;
        font-style: italic;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .help-prompt__copy {
        opacity: 0;
        color: var(--color-text-secondary);
        font-size: 13px;
        transition: opacity var(--duration-fast) var(--ease-standard);
      }
      .help-prompt:hover .help-prompt__copy { opacity: 1; }
      .help-prompt.is-copied .help-prompt__copy::before { content: "\\f26b"; color: #4caf50; }

      .help__tools {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
      }
      .help-tool.stack-row {
        display: grid;
        grid-template-columns: 24px 1fr;
        align-items: baseline;
        gap: 12px;
        padding: var(--space-10) 0;
        border-bottom: 0.5px solid var(--color-border);
        margin: 0;
      }
      .help-tool:last-child { border-bottom: none; }
      .help-tool__icon {
        font-size: 14px;
        color: var(--color-text-secondary);
      }
      .help-tool__body {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .help-tool__name {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-text);
        font-family: var(--font-family-mono, monospace);
        background: var(--color-secondary);
        padding: 1px 6px;
        border-radius: 4px;
      }
      .help-tool__summary {
        margin: 2px 0 0;
        font-size: 12px;
        line-height: 1.35;
        color: var(--color-text);
      }
      .help-tool__detail {
        margin: 0;
        font-size: 11px;
        line-height: 1.35;
      }

      .help__shortcuts {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-direction: column;
      }
      .help-shortcut.stack-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--space-8) 0;
        border-bottom: 0.5px solid var(--color-border);
        margin: 0;
      }
      .help-shortcut:last-child { border-bottom: none; }
      .help-shortcut__keys {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .help-shortcut__keys .plus {
        color: var(--color-text-secondary);
        font-size: 10px;
      }
      .help-shortcut__desc {
        font-size: 12px;
      }

      kbd {
        font-family: var(--font-family-mono, monospace);
        font-size: 11px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 4px;
        background: var(--color-secondary);
        border: 1px solid var(--color-border);
        color: var(--color-text);
      }

      .help__troubleshoot {
        display: flex;
        flex-direction: column;
      }
      details.help-accordion.stack-row {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        padding: var(--space-10) 0;
        border-bottom: 0.5px solid var(--color-border);
        margin: 0;
      }
      details.help-accordion:last-child { border-bottom: none; }
      summary {
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        padding: 2px 0;
        list-style: none;
        color: var(--color-text);
      }
      summary::-webkit-details-marker { display: none; }
      summary::before {
        content: "›";
        display: inline-block;
        width: 14px;
        color: var(--color-text-secondary);
        font-weight: 700;
        transition: transform var(--duration-fast) var(--ease-standard);
      }
      details[open] summary::before { transform: rotate(90deg); }
      details p {
        margin: 6px 0 2px 14px;
        font-size: 12px;
        line-height: 1.5;
      }
      details p code {
        background: var(--color-secondary);
        padding: 1px 6px;
        border-radius: 4px;
        font-size: 11px;
      }
      details a { color: var(--accent-color); }

      @media (max-width: 900px) {
        .help-view { padding-inline: var(--space-20); }
        .help__header, .help__content { width: 100%; }
        .help__columns {
          grid-template-columns: 1fr;
          gap: var(--space-24);
        }
        .help__columns .help__section {
          border-bottom: 0.5px solid var(--color-border);
          padding-bottom: var(--space-20);
        }
        .help__modes {
          grid-template-columns: 1fr;
          gap: var(--space-8);
        }
      }
    </style>
  `;
}

function bindActions(view) {
  // Click a prompt → copy to clipboard.
  view.querySelectorAll(".help-prompt").forEach((btn) => {
    btn.addEventListener("click", async () => {
      buttonPulse(btn);
      const text = btn.dataset.prompt;
      try {
        await navigator.clipboard.writeText(text);
        btn.classList.add("is-copied");
        const icon = btn.querySelector(".help-prompt__copy");
        const original = icon.className;
        icon.className = "bi bi-check2 help-prompt__copy";
        setTimeout(() => {
          btn.classList.remove("is-copied");
          icon.className = original;
        }, 1400);
      } catch (e) {
        console.warn("clipboard write failed", e);
      }
    });
  });
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
