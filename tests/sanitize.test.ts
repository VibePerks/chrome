import { describe, expect, it } from "vitest"
import { adUrl, clickUrl, hexColor, iconUrl, renderLine, sanitize } from "../src/sanitize"
import type { Ad } from "../src/types"

function ad(overrides: Partial<Ad> = {}): Ad {
  return {
    ad_id: "a1",
    sentence: "Ship faster",
    domain: "example.com",
    website_url: "",
    impression_token: "tok",
    rotate_seconds: 20,
    ...overrides,
  }
}

describe("sanitize", () => {
  it("strips control bytes and trims", () => {
    expect(sanitize("  a\u0000b\u001fc\u007f  ")).toBe("abc")
  })

  it("renderLine leads with the domain", () => {
    expect(renderLine(ad())).toBe("example.com - Ship faster")
  })

  it("renderLine leaves a sentence that already contains the domain", () => {
    expect(renderLine(ad({ sentence: "example.com rocks" }))).toBe("example.com rocks")
  })

  it("adUrl promotes a bare domain to https", () => {
    expect(adUrl("example.com")).toBe("https://example.com/")
  })

  it("adUrl rejects a non-http(s) scheme", () => {
    expect(adUrl("javascript:alert(1)")).toBeNull()
    expect(adUrl("file:///etc/passwd")).toBeNull()
  })

  it("clickUrl prefers the full website_url", () => {
    expect(clickUrl(ad({ website_url: "https://example.com/x?utm=1" }))).toBe(
      "https://example.com/x?utm=1",
    )
  })

  it("clickUrl falls back to the domain when website_url is unsafe/empty", () => {
    expect(clickUrl(ad({ website_url: "" }))).toBe("https://example.com/")
  })
})

describe("iconUrl", () => {
  it("keeps a valid https url", () => {
    expect(iconUrl("https://icons.example/f.png")).toBe("https://icons.example/f.png")
  })

  it("rejects non-https and malformed values", () => {
    expect(iconUrl("http://icons.example/f.png")).toBeNull()
    expect(iconUrl("javascript:alert(1)")).toBeNull()
    expect(iconUrl("not a url")).toBeNull()
    expect(iconUrl(undefined)).toBeNull()
  })
})

describe("hexColor", () => {
  it("returns a valid #rrggbb colour", () => {
    expect(hexColor("#3ecf8e")).toBe("#3ecf8e")
    expect(hexColor("#000000")).toBe("#000000")
  })

  it("returns null for an invalid or absent colour", () => {
    expect(hexColor("red")).toBeNull()
    expect(hexColor("#fff")).toBeNull()
    expect(hexColor("#12345g")).toBeNull()
    expect(hexColor(undefined)).toBeNull()
  })
})
