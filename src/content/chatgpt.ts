import type { SelectorsResponse, ServeResponse } from "../messages"
import { BUNDLED_SELECTORS, type HostSelectors, hostIdFor } from "../selectors"
import { StealthMonitor } from "./stealth"
import { Widget } from "./widget"

// content/chatgpt.ts is the page-side glue on every supported AI chat host. It owns
// ONLY the DOM signal (is the model generating?) and the widget lifecycle; it never
// touches the network or the device token - it asks the background worker to SERVE
// and RECORD. IMPRESSION MODEL: every generation cycle serves a fresh ad and records
// one impression, regardless of how long the generation lasts.

const DEBOUNCE_MS = 150
const STRIP_CHECK_MS = 1500
const REDUCED_COOLDOWN_MS = 60000

// Gap (px) kept between the widget's bottom edge and the top of the site's composer
// so the unit sits just above the prompt box without covering it.
const COMPOSER_GAP_PX = 10

// While resolving the composer's true top edge we climb from the matched input to
// the visual container that wraps it. MAX_COMPOSER_FRACTION caps how tall an
// ancestor may be (as a fraction of the viewport) before it is treated as a page
// layout wrapper rather than the composer; MAX_COMPOSER_CLIMB caps how many
// ancestors are inspected. COMPOSER_BOTTOM_TOLERANCE_PX is how far an ancestor's
// bottom may sit above the input's bottom and still count as wrapping it.
const MAX_COMPOSER_FRACTION = 0.5
const MAX_COMPOSER_CLIMB = 6
const COMPOSER_BOTTOM_TOLERANCE_PX = 4

// composerContainerRect returns the geometry of the visible composer *container*,
// not just the inner text field. Sites wrap the prompt input in a taller rounded
// box with toolbars/attach/send buttons; anchoring to the inner field leaves the
// widget overlapping that box and off-centre from it. Starting from the matched
// input it climbs ancestors that still wrap the input (their bottom stays at or
// below the input's) and stay composer-sized, returning the outermost such box.
function composerContainerRect(el: Element, win: Window): { top: number; centerX: number } {
  const base = el.getBoundingClientRect()
  let best = base
  let node: Element | null = el.parentElement ?? null
  const maxHeight = win.innerHeight * MAX_COMPOSER_FRACTION
  for (let i = 0; node && i < MAX_COMPOSER_CLIMB; i++) {
    const r = node.getBoundingClientRect()
    // Once an ancestor is as tall as a page layout wrapper, stop climbing.
    if (r.height > maxHeight) break
    // Accept an ancestor that still encloses the input (its bottom is at or below
    // the input's, within tolerance) and reaches higher than what we have so far.
    if (r.bottom >= base.bottom - COMPOSER_BOTTOM_TOLERANCE_PX && r.top < best.top) best = r
    node = node.parentElement
  }
  return { top: best.top, centerX: best.left + best.width / 2 }
}

// matchesAny reports whether any of the selectors currently matches an element in
// the document. Bad selectors are ignored. Exposed for unit tests.
export function matchesAny(doc: Document, selectors: string[]): boolean {
  for (const sel of selectors) {
    try {
      if (doc.querySelector(sel)) return true
    } catch {
      /* invalid selector string - skip */
    }
  }
  return false
}

// composerAnchor returns where to place the widget relative to the site's composer:
// `bottomPx` sits its bottom edge COMPOSER_GAP_PX above the composer, and `centerXPx`
// centres it over the composer's horizontal middle (so it tracks the text box width
// rather than the viewport). It uses the first composer selector that resolves to a
// visible element and anchors to that element's full visual container. Returns
// undefined when no composer can be located, so the widget uses its own defaults.
export function composerAnchor(
  doc: Document,
  win: Window,
  selectors: string[],
): { bottomPx: number; centerXPx: number } | undefined {
  for (const sel of selectors) {
    try {
      const el = doc.querySelector(sel)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (rect.height <= 0) continue
      const box = composerContainerRect(el, win)
      return {
        bottomPx: Math.max(0, win.innerHeight - box.top + COMPOSER_GAP_PX),
        centerXPx: box.centerX,
      }
    } catch {
      /* invalid selector string - skip */
    }
  }
  return undefined
}

function send<T>(msg: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (resp: T) => {
        // Touch lastError so Chrome does not log "unchecked runtime.lastError".
        void chrome.runtime.lastError
        resolve(resp ?? null)
      })
    } catch {
      resolve(null)
    }
  })
}

function start(): void {
  const hostId = hostIdFor(location.hostname)
  if (!hostId) return

  const widget = new Widget((token) => void send({ type: "CLICK", token }))
  const stealth = new StealthMonitor()

  let selectors: HostSelectors = BUNDLED_SELECTORS[hostId] ?? BUNDLED_SELECTORS.chatgpt
  let thinking = false
  let intentionalUnmount = false
  let lastMountAt = 0
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  async function onThinkingStart(): Promise<void> {
    if (!stealth.shouldShow()) return
    if (stealth.isReduced() && Date.now() - lastMountAt < REDUCED_COOLDOWN_MS) return
    const resp = await send<ServeResponse>({ type: "SERVE" })
    // The user may have finished generating before the ad arrived; only mount if we
    // are still in a thinking cycle.
    if (!thinking || !resp || !resp.ad) return
    intentionalUnmount = false
    widget.mount(resp.ad, composerAnchor(document, window, selectors.composerSelectors))
    lastMountAt = Date.now()
    scheduleStripCheck()
  }

  function scheduleStripCheck(): void {
    const host = widget.hostNode()
    setTimeout(() => {
      // If our host vanished while we still intended it to be shown, the page (or an
      // extension) stripped it: back off progressively.
      if (thinking && !intentionalUnmount && host && !host.isConnected) {
        stealth.recordStrip()
      }
    }, STRIP_CHECK_MS)
  }

  async function onThinkingEnd(): Promise<void> {
    intentionalUnmount = true
    widget.unmount()
    await send({ type: "RECORD" })
  }

  function evaluate(): void {
    const nowThinking = matchesAny(document, selectors.thinkingSelectors)
    if (nowThinking === thinking) return
    thinking = nowThinking
    if (thinking) void onThinkingStart()
    else void onThinkingEnd()
  }

  function scheduleEvaluate(): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(evaluate, DEBOUNCE_MS)
  }

  // Load selectors (remote with bundled fallback) then start observing.
  void send<SelectorsResponse>({ type: "GET_SELECTORS", host: hostId }).then((resp) => {
    if (resp && resp.selectors) selectors = resp.selectors
    const observer = new MutationObserver(scheduleEvaluate)
    observer.observe(document.documentElement, { childList: true, subtree: true })
    evaluate()
  })
}

// The content script runs on every supported AI chat host (per the manifest
// matches). Start only inside a real extension content-script context
// (chrome.runtime present) so importing this module for unit tests has no side
// effects. Guarded so nothing ever surfaces into the page.
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) {
  try {
    start()
  } catch {
    /* fail silent */
  }
}
