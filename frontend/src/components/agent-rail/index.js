// Agent rail orchestrator — the heart of the conversational UX.
//
// Responsibilities:
//   • render the chat stream (user bubbles, agent bubbles, tool cards, errors)
//   • manage the prompt input (slash chips, send on Enter, send button)
//   • open the /agent/chat SSE per send and route events:
//       - token       → append to current agent bubble
//       - correction  → preview card + crossfade the stage
//       - commit      → commit card + history strip + ripple + update state
//       - done        → finalize, re-enable input
//       - error       → inline error chip
//   • coordinate with the edit view's stage via the bus

import { gsap } from "../../../node_modules/gsap/index.js";
import { isReduced, streamingDots, stopStreamingDots, accentRipple } from "../../motion.js";
import * as state from "../../state.js";
import * as agent from "../../api/endpoints/agent.js";
import { emit, EVENTS } from "../../bus.js";
import { renderPreviewCard } from "../tool-cards/preview-card.js";
import { renderCommitCard } from "../tool-cards/commit-card.js";
import { renderToolExecutedCard, TOOLS_HIDDEN_BY_DEFAULT } from "../tool-cards/tool-executed-card.js";
import { createHistoryStrip } from "../history-strip/index.js";
import { toast } from "../toast/index.js";

let stream = null;
let promptInput = null;
let sendBtn = null;
let suggestionEls = [];
let history = null;
let activeHandle = null;
let placeholderEl = null;

export function init() {
  stream = document.querySelector(".agent-stream");
  promptInput = document.querySelector(".agent-prompt__input");
  sendBtn = document.querySelector(".agent-prompt__send");
  suggestionEls = Array.from(document.querySelectorAll(".agent-prompt__suggestions .chip-glass"));
  placeholderEl = stream?.querySelector(".agent-stream__placeholder");
  if (!stream || !promptInput || !sendBtn) return;

  // Mount the (initially hidden) history strip at the top of the stream.
  history = createHistoryStrip();
  stream.insertBefore(history.el, placeholderEl);

  bindPromptInput();
  bindSuggestions();
  syncReadyState();
  state.on("currentImagePath", syncReadyState);
}

// ---- Prompt input ------------------------------------------------------

function bindPromptInput() {
  promptInput.addEventListener("input", syncReadyState);
  promptInput.addEventListener("keydown", (e) => {
    // Enter to send, Shift+Enter for newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  sendBtn.addEventListener("click", submit);
}

function bindSuggestions() {
  for (const chip of suggestionEls) {
    chip.setAttribute("role", "button");
    chip.tabIndex = 0;
    const insert = () => {
      const slash = chip.textContent.trim();
      const compiled = compileSlash(slash);
      promptInput.value = compiled;
      promptInput.focus();
      // Move cursor to end.
      const end = promptInput.value.length;
      promptInput.setSelectionRange(end, end);
      syncReadyState();
    };
    chip.addEventListener("click", insert);
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); insert(); }
    });
  }
}

function compileSlash(slash) {
  switch (slash) {
    case "/analyze":   return "Run a fresh analysis of the current image and tell me what you see.";
    case "/recommend": return "Recommend corrections for the issues you've found, ranked by impact.";
    case "/compare":   return "Show me a before-and-after of the latest correction.";
    case "/undo":      return "Revert the last commit and return to the previous baseline.";
    default:           return slash + " ";
  }
}

function syncReadyState() {
  if (!promptInput || !sendBtn) return;
  const ready = !!state.get("currentImagePath");
  promptInput.disabled = !ready || !!activeHandle;
  promptInput.placeholder = ready
    ? (activeHandle ? "Working…" : "Tell me what you want…")
    : "Drop an image to wake the assistant.";
  const hasText = promptInput.value.trim().length > 0;
  sendBtn.disabled = !ready || !hasText || !!activeHandle;
}

// ---- Submit / SSE ------------------------------------------------------

async function submit() {
  const text = promptInput.value.trim();
  if (!text) return;
  if (activeHandle) return;
  if (!state.get("currentImagePath")) {
    toast.warning("Drop an image first.");
    return;
  }

  // Hide the empty-state placeholder once the conversation begins.
  if (placeholderEl && !placeholderEl.hidden) placeholderEl.hidden = true;

  stream.closest(".agent-rail")?.classList.add("has-stream");
  appendUserMessage(text);
  promptInput.value = "";
  syncReadyState();

  // Batch mode → sequential round per selected image. Single mode → one round
  // on the active image.
  const mode = state.get("mode");
  const selected = state.getSelectedPaths();
  const targets = (mode === "batch" && selected.length > 1) ? selected : [state.get("currentImagePath")];

  if (targets.length > 1) {
    appendBatchHeader(targets.length);
    for (let i = 0; i < targets.length; i++) {
      const path = targets[i];
      // Switch the active image so the stage and currentImage* mirrors track
      // the round we're on. Bus events from preview/commit will then update
      // the right contact card.
      state.setActiveByPath(path);
      const img = state.get("images").find((r) => r.path === path);
      appendBatchImageDivider(i + 1, targets.length, img?.name || filenameOf(path));
      const bubble = appendAgentMessage();
      try {
        await runRound(text, bubble, { batchBadge: `${i + 1}/${targets.length}` });
      } catch (err) {
        appendErrorChip(err?.message || String(err));
      }
    }
    appendBatchComplete(targets.length);
    syncReadyState();
    promptInput.focus();
    return;
  }

  const agentBubble = appendAgentMessage();
  await runRound(text, agentBubble);
  syncReadyState();
  promptInput.focus();
}

// One agent SSE round. Returns a Promise that resolves on done/error/complete.
// `batchBadge` ("2/5" etc.) is stamped on each tool/preview/commit card so the
// user can attribute work to a specific image during a batch run.
function runRound(message, agentBubble, { batchBadge = null } = {}) {
  return new Promise((resolve) => {
    let firstTokenSeen = false;
    let buffered = "";
    let resolved = false;
    // Track the src currently shown on the stage so each preview card's
    // Compare button can restore the image as it looked *before* that
    // specific correction was applied.
    let stageSrc = state.get("currentImageUrl");
    const finalize = () => {
      if (resolved) return;
      resolved = true;
      activeHandle = null;
      if (!firstTokenSeen) {
        agentBubble.classList.remove("chat-msg__bubble--thinking");
        stopAgentThinking(agentBubble);
        agentBubble.textContent = buffered || "(no response)";
      }
      syncReadyState();
      resolve();
    };

    activeHandle = agent.chat({
      sessionId: state.get("sessionId"),
      message,
      imagePath: state.get("currentImagePath"),
      imageFeatures: state.get("currentFeatures"),
      imageIssues: state.get("currentIssues"),
    }, {
      onEvent: ({ event, data }) => {
        if (event === "token") {
          const piece = typeof data === "string" ? data : JSON.stringify(data);
          if (!firstTokenSeen) {
            firstTokenSeen = true;
            agentBubble.classList.remove("chat-msg__bubble--thinking");
            agentBubble.innerHTML = "";
            stopAgentThinking(agentBubble);
          }
          buffered += piece;
          agentBubble.textContent = buffered;
          scrollStreamToBottom();

        } else if (event === "tool_executed") {
          // The 2 side-channel tools have richer dedicated cards; skip them.
          if (TOOLS_HIDDEN_BY_DEFAULT.has(data?.name)) return;
          const card = renderToolExecutedCard(data || {});
          if (batchBadge) prependBatchBadge(card, batchBadge);
          appendIntoStream(card);
          scrollStreamToBottom();

        } else if (event === "correction") {
          const beforeSrc = stageSrc;
          const card = renderPreviewCard({ ...(data || {}), beforeSrc });
          if (batchBadge) prependBatchBadge(card.querySelector(".tool-card__heading"), batchBadge);
          appendIntoStream(card);
          if (data?.base64) {
            emit(EVENTS.STAGE_SET_IMAGE, { src: data.base64 });
            stageSrc = data.base64;
          }
          scrollStreamToBottom();

        } else if (event === "commit") {
          const card = renderCommitCard(data || {});
          if (batchBadge) prependBatchBadge(card.querySelector(".tool-card__heading"), batchBadge);
          appendIntoStream(card);

          // Re-point the active image slot at the new working baseline.
          if (data?.workingPath) {
            state.renameActiveImage(data.workingPath, {
              url: data.base64 || state.get("currentImageUrl"),
              state: "ready",
            });
          }
          history?.addCommit(data || {});
          emit(EVENTS.STAGE_RIPPLE);
          scrollStreamToBottom();

        } else if (event === "done") {
          finalize();

        } else if (event === "error") {
          const msg = typeof data === "string" ? data : (data?.message || "Agent error");
          appendErrorChip(msg);
          finalize();
        }
      },
      onError: (err) => {
        appendErrorChip(err?.message || String(err));
        finalize();
      },
      onComplete: finalize,
    });
  });
}

function prependBatchBadge(target, label) {
  if (!target) return;
  const badge = document.createElement("span");
  badge.className = "batch-image-badge";
  badge.textContent = label;
  target.insertBefore(badge, target.firstChild);
}

// ---- Batch run dividers ------------------------------------------------

function appendBatchHeader(count) {
  const el = document.createElement("div");
  el.className = "batch-header";
  el.innerHTML = `<i class="bi bi-collection"></i><span></span>`;
  el.querySelector("span").textContent = `Batch run · ${count} images`;
  appendIntoStream(el);
  if (!isReduced) gsap.from(el, { opacity: 0, y: 6, duration: 0.3, ease: "expo.out" });
}

function appendBatchImageDivider(i, total, name) {
  const el = document.createElement("div");
  el.className = "batch-divider";
  el.innerHTML = `<span class="batch-image-badge"></span><span class="batch-divider__name"></span>`;
  el.querySelector(".batch-image-badge").textContent = `${i}/${total}`;
  el.querySelector(".batch-divider__name").textContent = name || "";
  appendIntoStream(el);
  if (!isReduced) gsap.from(el, { opacity: 0, x: -6, duration: 0.25, ease: "expo.out" });
}

function appendBatchComplete(count) {
  const el = document.createElement("div");
  el.className = "batch-complete";
  el.innerHTML = `<i class="bi bi-check2-all"></i><span></span>`;
  el.querySelector("span").textContent = `Batch complete · ${count} images`;
  appendIntoStream(el);
  if (!isReduced) gsap.from(el, { opacity: 0, y: 6, duration: 0.3, ease: "expo.out" });
}

function filenameOf(p) {
  if (!p) return "";
  const seg = String(p).split(/[\\/]/);
  return seg[seg.length - 1] || p;
}

// ---- Stream rendering --------------------------------------------------

function appendUserMessage(text) {
  const wrap = document.createElement("div");
  wrap.className = "chat-msg chat-msg--user";
  wrap.innerHTML = `
    <span class="chat-msg__avatar" aria-hidden="true">YOU</span>
    <div class="chat-msg__body">
      <div class="chat-msg__bubble"></div>
    </div>
  `;
  wrap.querySelector(".chat-msg__bubble").textContent = text;
  appendIntoStream(wrap);
  if (!isReduced) {
    gsap.from(wrap, { opacity: 0, y: 8, duration: 0.3, ease: "expo.out" });
  }
}

function appendAgentMessage() {
  const wrap = document.createElement("div");
  wrap.className = "chat-msg chat-msg--agent";
  wrap.innerHTML = `
    <span class="chat-msg__avatar" aria-hidden="true">AI</span>
    <div class="chat-msg__body">
      <div class="chat-msg__bubble chat-msg__bubble--thinking" aria-live="polite">
        <span class="streaming-dots" aria-hidden="true">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </span>
      </div>
    </div>
  `;
  appendIntoStream(wrap);
  const bubble = wrap.querySelector(".chat-msg__bubble");
  startAgentThinking(bubble);
  if (!isReduced) {
    gsap.from(wrap, { opacity: 0, y: 8, duration: 0.3, ease: "expo.out" });
  }
  return bubble;
}

function appendIntoStream(node) {
  // Always append BEFORE the placeholder (which is hidden anyway) — keeps DOM order tidy.
  if (placeholderEl && placeholderEl.parentElement === stream) {
    stream.insertBefore(node, placeholderEl);
  } else {
    stream.appendChild(node);
  }
}

function appendErrorChip(message) {
  const text = String(message || "").toLowerCase();
  // Recognise AI-disabled / unconfigured backend errors so we can offer a one-click fix.
  const disabled = /\b(ai|agent|ollama)\b.*\b(disabled|not configured|unavailable)\b/.test(text)
    || text.includes("no qualifying bean")
    || text.includes("503")
    || text.includes("api key");

  const el = document.createElement("div");
  el.className = "stream-error";
  el.innerHTML = `
    <i class="bi bi-exclamation-triangle"></i>
    <span class="stream-error__msg"></span>
    ${disabled ? `<button class="stream-error__cta" data-action="open-settings">
      <i class="bi bi-arrow-right"></i> Open AI settings
    </button>` : ""}
  `;
  el.querySelector(".stream-error__msg").textContent = message;
  if (disabled) {
    el.querySelector("[data-action='open-settings']").addEventListener("click", () => {
      window.location.hash = "#/settings";
    });
  }
  appendIntoStream(el);
  if (!isReduced) {
    gsap.from(el, { opacity: 0, y: 6, duration: 0.3, ease: "expo.out" });
  }
}

function scrollStreamToBottom() {
  if (!stream) return;
  // Only follow if we're already near the bottom — don't yank the user away if
  // they've scrolled up to read.
  const distanceFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
  if (distanceFromBottom < 120) {
    stream.scrollTop = stream.scrollHeight;
  }
}

// ---- "Agent thinking" indicator (per-bubble) ---------------------------

const thinkingAnimByBubble = new WeakMap();

function startAgentThinking(bubble) {
  const dots = bubble.querySelector(".streaming-dots");
  if (!dots) return;
  const anim = streamingDots(dots);
  if (anim) thinkingAnimByBubble.set(bubble, anim);
}

function stopAgentThinking(bubble) {
  const anim = thinkingAnimByBubble.get(bubble);
  if (anim) {
    stopStreamingDots(anim, bubble.querySelector(".streaming-dots"));
    thinkingAnimByBubble.delete(bubble);
  }
}

// Re-export ripple helper so the edit view can use it on stage updates.
export { accentRipple };

// Pre-fill the prompt input and focus it — used by the issue drawer's "Ask AI" button.
export function injectPrompt(text) {
  if (!promptInput) return;
  promptInput.value = text;
  syncReadyState();
  promptInput.focus();
  const end = promptInput.value.length;
  promptInput.setSelectionRange(end, end);
}
