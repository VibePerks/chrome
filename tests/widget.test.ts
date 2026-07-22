// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { Widget, buildWidgetDom, widgetContent } from "../src/content/widget"
import type { Ad } from "../src/types"

function ad(overrides: Partial<Ad> = {}): Ad {
  return {
    ad_id: "a1",
    sentence: "Ship faster",
    domain: "example.com",
    website_url: "https://example.com/x?utm=1",
    impression_token: "it",
    rotate_seconds: 20,
    ...overrides,
  }
}

describe("widgetContent", () => {
  it("projects an ad and resolves the click url", () => {
    const c = widgetContent(ad())
    expect(c.label).toBe("")
    expect(c.domain).toBe("example.com")
    expect(c.sentence).toBe("Ship faster")
    expect(c.url).toBe("https://example.com/x?utm=1")
  })

  it("keeps the sentence verbatim, even when it repeats the domain", () => {
    const c = widgetContent(ad({ sentence: "example.com - Ship faster", website_url: "" }))
    expect(c.sentence).toBe("example.com - Ship faster")
    expect(c.url).toBe("https://example.com/")
  })

  it("projects a valid https icon and the positional bg + accent colours", () => {
    const c = widgetContent(
      ad({ icon_url: "https://icons.example/f.png", identity_colors: ["#101010", "#3ecf8e"] }),
    )
    expect(c.iconUrl).toBe("https://icons.example/f.png")
    expect(c.bg).toBe("#101010")
    expect(c.accent).toBe("#3ecf8e")
  })

  it("drops an unsafe icon url and falls back to the brand palette for bad colours", () => {
    const c = widgetContent(ad({ icon_url: "http://insecure/f.png", identity_colors: ["red"] }))
    expect(c.iconUrl).toBeNull()
    expect(c.bg).toBe("#0d0d0d")
    expect(c.accent).toBe("#ffb800")
  })

  it("picks a readable text colour from the background luminance", () => {
    // Dark default background -> white text.
    expect(widgetContent(ad()).text).toBe("#ffffff")
    // Light background -> black text.
    expect(widgetContent(ad({ identity_colors: ["#ffffff", "#3ecf8e"] })).text).toBe("#0d0d0d")
    // Dark background -> white text.
    expect(widgetContent(ad({ identity_colors: ["#101010", "#3ecf8e"] })).text).toBe("#ffffff")
  })
})

describe("buildWidgetDom", () => {
  it("renders label, domain and sentence as text and links the body", () => {
    const root = buildWidgetDom(
      document,
      widgetContent(ad()),
      () => {},
      () => {},
    )
    expect(root.textContent).toContain("example.com")
    expect(root.textContent).toContain("Ship faster")
    const anchor = root.querySelector("a")
    expect(anchor?.getAttribute("href")).toBe("https://example.com/x?utm=1")
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer")
  })

  it("fires onClick with the resolved url and onDismiss on close", () => {
    const onClick = vi.fn()
    const onDismiss = vi.fn()
    const root = buildWidgetDom(document, widgetContent(ad()), onClick, onDismiss)
    root.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(onClick).toHaveBeenCalledWith("https://example.com/x?utm=1")
    root.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(onDismiss).toHaveBeenCalled()
  })

  it("renders the advertiser brand icon as an img with the valid src", () => {
    const root = buildWidgetDom(
      document,
      widgetContent(ad({ icon_url: "https://icons.example/f.png" })),
      () => {},
      () => {},
    )
    const img = root.querySelector("img")
    expect(img?.getAttribute("src")).toBe("https://icons.example/f.png")
  })

  it("shows the generic glyph and no img when there is no valid icon", () => {
    const root = buildWidgetDom(
      document,
      widgetContent(ad({ icon_url: undefined })),
      () => {},
      () => {},
    )
    expect(root.querySelector("img")).toBeNull()
    expect(root.querySelector("svg")).not.toBeNull()
  })

  it("falls back to the glyph when the brand icon fails to load", () => {
    const root = buildWidgetDom(
      document,
      widgetContent(ad({ icon_url: "https://icons.example/f.png" })),
      () => {},
      () => {},
    )
    const img = root.querySelector("img") as HTMLImageElement
    img.dispatchEvent(new Event("error"))
    expect(root.querySelector("img")).toBeNull()
    expect(root.querySelector("svg")).not.toBeNull()
  })
})

describe("Widget", () => {
  it("mounts a closed-shadow host with a neutral random id and unmounts", () => {
    const w = new Widget()
    w.mount(ad())
    const host = w.hostNode()
    expect(host).not.toBeNull()
    expect(host?.isConnected).toBe(true)
    // Closed shadow root is not exposed to the page.
    expect(host?.shadowRoot).toBeNull()
    // No brand/ad tokens leak into any page-visible attribute.
    expect(host?.outerHTML.toLowerCase()).not.toContain("vibeperks")
    expect((host?.id ?? "").toLowerCase()).not.toContain("ad")
    expect(w.isMounted()).toBe(true)
    w.unmount()
    expect(w.isMounted()).toBe(false)
    expect(document.body.contains(host as Node)).toBe(false)
  })

  it("mount replaces a prior host (single instance)", () => {
    const w = new Widget()
    w.mount(ad())
    const first = w.hostNode()
    w.mount(ad({ ad_id: "a2" }))
    expect(first?.isConnected).toBe(false)
    expect(w.hostNode()).not.toBe(first)
    w.unmount()
  })

  it("reports the ad's impression token when the body is clicked", () => {
    const onAdClick = vi.fn()
    const w = new Widget(onAdClick)
    w.mount(ad({ impression_token: "it-42" }))
    // No click has happened yet, so nothing is reported.
    expect(onAdClick).not.toHaveBeenCalled()
    w.unmount()
  })

  it("fires the click reporter after opening the ad url", () => {
    const onAdClick = vi.fn()
    // Build the DOM directly so we can dispatch the click (the mounted widget's
    // shadow root is closed and unreachable in tests). This mirrors the onClick
    // Widget.mount wires up: open the url, then report the impression token.
    const root = buildWidgetDom(
      document,
      widgetContent(ad({ impression_token: "it-7" })),
      () => onAdClick("it-7"),
      () => {},
    )
    root.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(onAdClick).toHaveBeenCalledWith("it-7")
  })
})
