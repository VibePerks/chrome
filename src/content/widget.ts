import { clickUrl, hexColor, iconUrl, sanitize } from "../sanitize"
import type { Ad } from "../types"
import { COLORS } from "../colors"

// widget.ts renders the sponsor unit as a small, dismissible element mounted in a
// CLOSED Shadow DOM with a random per-session host id. Anti-detection rationale:
//  - closed shadow root: the page cannot read into the widget's internals.
//  - random host id + zero static/predictable classes: a page-side MutationObserver
//    cannot match a known selector; nothing page-visible contains "vibeperks"/"ad".
//  - text + inline SVG only: no external font/stylesheet load, so a strict CSP
//    on the page cannot break the widget and there is nothing for the page to probe.
// The one exception is the advertiser's brand icon, loaded as an <img>: if the
// page CSP blocks it, the img errors and the widget falls back to the inline glyph,
// so the unit still renders. The widget never overlaps or modifies the host UI; it
// sits in dead space above the composer and is dismissible.

// A trusted, constant inline SVG (no user data). Assigned via innerHTML on a
// throwaway wrapper - safe because the markup is a compile-time constant.
const ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z" fill="currentColor"/>' +
  '<path d="M14 8v8M17.5 6.5a7 7 0 0 1 0 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
  "</svg>"

// Fallback fixed-position offset (px from viewport bottom) used when the caller
// cannot locate the site's composer to anchor above.
const DEFAULT_BOTTOM_PX = 104

// WidgetAnchor positions the widget relative to the site's composer. `bottomPx` is
// the distance from the viewport bottom to the widget's bottom edge; `centerXPx`,
// when given, is the horizontal centre (px from the viewport left) the widget is
// centred on - so it sits over the middle of the composer rather than the viewport.
export interface WidgetAnchor {
  bottomPx: number
  centerXPx?: number
}

// WidgetContent is the pure, testable projection of an ad into what the widget
// shows: a leading label, the visible domain, the sentence body, the safe click
// target (null when neither website_url nor domain is a safe http(s) URL), the safe
// brand-icon URL (null to use the generic glyph) and the two identity colours. The
// advertiser identity ships exactly two positional colours: identity_colors[0] is
// the element BACKGROUND and identity_colors[1] is the ACCENT (the element outline
// and the domain colour). Each falls back to the built-in brand palette (jet
// black background, amber accent) when missing or not a valid "#rrggbb" value.
// `text` is the readable foreground colour derived from the background luminance
// (black on a light background, white on a dark one).
export interface WidgetContent {
  label: string
  domain: string
  sentence: string
  url: string | null
  iconUrl: string | null
  bg: string
  accent: string
  text: string
}

// widgetContent projects an ad into display fields. All text is sanitized; the
// sentence is shown verbatim (the domain is rendered separately in the accent
// colour, then a dash, then the sentence exactly as written). The icon URL and
// both identity colours are validated so untrusted server values can never be
// loaded or injected. The background is identity colour 0 and the accent is
// identity colour 1, each defaulting to the built-in brand palette (config.js jet
// black / amber) when absent or invalid. `text` is the readable foreground colour
// picked from the background's luminance (black on light, white on dark).
export function widgetContent(ad: Ad): WidgetContent {
  const domain = sanitize(ad.domain)
  const sentence = sanitize(ad.sentence)
  const colors = ad.identity_colors
  const bg = hexColor(colors?.[0]) ?? COLORS.jetBlack
  return {
    label: "",
    domain,
    sentence,
    url: clickUrl(ad),
    iconUrl: iconUrl(ad.icon_url),
    bg,
    accent: hexColor(colors?.[1]) ?? COLORS.amber,
    text: readableTextColor(bg),
  }
}

// readableTextColor returns black on a light background and white on a dark one,
// so the label/sentence stay legible whatever identity colour the advertiser
// picks. `bg` is always a validated "#rrggbb" string (hexColor guarantees it).
export function readableTextColor(bg: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(bg)
  if (!m) return COLORS.white
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  // Perceived (sRGB-weighted) luminance in 0..1; > 0.6 reads as a light surface.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? COLORS.jetBlack : COLORS.white
}

// randomHostId returns a neutral, unpredictable element id (letter-prefixed, no
// brand tokens) generated fresh at each mount.
function randomHostId(): string {
  let rand: string
  try {
    rand = crypto.randomUUID().replace(/-/g, "")
  } catch {
    rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  }
  // Strip any incidental "ad" tokens so no brand token leaks into the page id.
  rand = rand.replace(/ad/gi, "")
  return "x" + rand.slice(0, 20)
}

// buildWidgetDom builds the widget's inner DOM (to be appended into the shadow
// root). Exposed for unit tests. `onClick` fires with the resolved URL when the ad
// body is clicked; `onDismiss` fires when the close control is used. All copy is set
// via textContent (never innerHTML) so sanitized server text cannot inject markup.
export function buildWidgetDom(
  doc: Document,
  content: WidgetContent,
  onClick: (url: string) => void,
  onDismiss: () => void,
): HTMLElement {
  const root = doc.createElement("div")
  root.setAttribute(
    "style",
    "display:inline-flex;align-items:center;gap:8px;max-width:520px;" +
      "padding:6px 10px;border-radius:9px;" +
      "font:12px/1.4 MonoLisa,'JetBrains Mono','IBM Plex Mono','SF Mono',monospace;" +
      `background:${content.bg};color:${content.text};box-shadow:0 1px 6px ${COLORS.overlayMedium};` +
      `border:1px solid ${content.accent};`,
  )

  const icon = doc.createElement("span")
  icon.setAttribute(
    "style",
    `display:inline-flex;align-items:center;color:${content.accent};flex:0 0 auto;`,
  )
  if (content.iconUrl) {
    // Advertiser brand icon. On any load failure (e.g. a strict page CSP blocks the
    // request) swap in the generic inline glyph so the widget still renders.
    const img = doc.createElement("img")
    img.setAttribute("width", "14")
    img.setAttribute("height", "14")
    img.setAttribute("alt", "")
    img.setAttribute("style", "display:block;border-radius:3px;")
    img.addEventListener("error", () => {
      img.remove()
      icon.innerHTML = ICON_SVG
    })
    img.src = content.iconUrl
    icon.appendChild(img)
  } else {
    icon.innerHTML = ICON_SVG
  }
  root.appendChild(icon)

  const label = doc.createElement("span")
  label.textContent = content.label
  label.setAttribute("style", `color:${content.text};opacity:0.7;flex:0 0 auto;`)
  root.appendChild(label)

  const body = doc.createElement(content.url ? "a" : "span")
  body.setAttribute(
    "style",
    `color:${content.text};text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;`,
  )
  if (content.url && body instanceof (doc.defaultView?.HTMLAnchorElement ?? HTMLAnchorElement)) {
    ;(body as HTMLAnchorElement).href = content.url
    ;(body as HTMLAnchorElement).target = "_blank"
    ;(body as HTMLAnchorElement).rel = "noopener noreferrer"
  }
  const domainEl = doc.createElement("span")
  domainEl.textContent = content.domain
  domainEl.setAttribute("style", `text-decoration:underline;color:${content.accent};`)
  body.appendChild(domainEl)
  if (content.sentence) {
    const sep = doc.createElement("span")
    sep.textContent = " - " + content.sentence
    body.appendChild(sep)
  }
  if (content.url) {
    body.addEventListener("click", (e) => {
      e.preventDefault()
      onClick(content.url as string)
    })
  }
  root.appendChild(body)

  const close = doc.createElement("button")
  close.textContent = "\u00d7"
  close.setAttribute("aria-label", "Dismiss")
  close.setAttribute(
    "style",
    `margin-left:2px;border:0;background:transparent;color:${COLORS.textMuted};cursor:pointer;font-size:14px;line-height:1;flex:0 0 auto;`,
  )
  close.addEventListener("click", (e) => {
    e.preventDefault()
    onDismiss()
  })
  root.appendChild(close)

  return root
}

// Widget owns the mounted host element + its closed shadow root. A single instance
// is reused across cycles: mount replaces any prior content; unmount removes the
// host entirely.
export class Widget {
  private host: HTMLElement | null = null
  private readonly onAdClick?: (impressionToken: string) => void

  // onAdClick, when provided, is called with the served ad's impression token the
  // moment the viewer clicks the ad (right after the advertiser URL is opened), so
  // the caller can report the click for click-through measurement. The viewer is
  // never redirected through us; this is a separate, best-effort signal.
  constructor(onAdClick?: (impressionToken: string) => void) {
    this.onAdClick = onAdClick
  }

  isMounted(): boolean {
    return this.host !== null && this.host.isConnected
  }

  // hostNode exposes the current host element for the stealth monitor to watch. Null
  // when nothing is mounted.
  hostNode(): HTMLElement | null {
    return this.host
  }

  // mount renders the ad. `anchor` positions the unit relative to the site's
  // composer: `bottomPx` sits its bottom edge just above the composer, and
  // `centerXPx` (when provided) centres it over the composer's horizontal middle.
  // Both fall back to a safe default (viewport-centred, fixed bottom offset) when
  // the composer cannot be located.
  mount(ad: Ad, anchor?: WidgetAnchor, doc: Document = document): void {
    this.unmount()
    const content = widgetContent(ad)
    const impressionToken = ad.impression_token
    const host = doc.createElement("div")
    host.id = randomHostId()
    const bottomPx = Math.round(anchor?.bottomPx ?? DEFAULT_BOTTOM_PX)
    // Centre on the composer's middle when known, otherwise on the viewport. Either
    // way translateX(-50%) pulls the widget back by half its own width.
    const horizontal =
      anchor?.centerXPx === undefined
        ? "left:50%;transform:translateX(-50%);"
        : `left:${Math.round(anchor.centerXPx)}px;transform:translateX(-50%);`
    host.setAttribute(
      "style",
      `position:fixed;${horizontal}bottom:${bottomPx}px;` +
        "z-index:2147483000;pointer-events:auto;",
    )
    // Closed mode: the page cannot access this shadow root.
    const shadow = host.attachShadow({ mode: "closed" })
    shadow.appendChild(
      buildWidgetDom(
        doc,
        content,
        (url) => {
          try {
            doc.defaultView?.open(url, "_blank", "noopener,noreferrer")
          } catch {
            /* ignore */
          }
          // Report the click for CTR after opening the destination. The house ad
          // has no impression token and is never reported.
          if (impressionToken) {
            try {
              this.onAdClick?.(impressionToken)
            } catch {
              /* click reporting is best-effort */
            }
          }
        },
        () => this.unmount(),
      ),
    )
    ;(doc.body || doc.documentElement).appendChild(host)
    this.host = host
  }

  unmount(): void {
    if (this.host && this.host.parentNode) {
      this.host.parentNode.removeChild(this.host)
    }
    this.host = null
  }
}
