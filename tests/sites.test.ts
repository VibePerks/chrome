import { describe, expect, it } from "vitest"
import { ALL_ORIGINS, SUPPORTED_SITES, knownGrantedOrigins } from "../src/sites"

describe("sites", () => {
  it("ALL_ORIGINS is the flattened list of every site's origins", () => {
    const flat = SUPPORTED_SITES.flatMap((s) => s.origins)
    expect(ALL_ORIGINS).toEqual(flat)
    expect(ALL_ORIGINS).toContain("https://chatgpt.com/*")
    expect(ALL_ORIGINS).toContain("https://v0.app/*")
  })

  it("every origin is a valid https match pattern", () => {
    for (const o of ALL_ORIGINS) {
      expect(o).toMatch(/^https:\/\/[^/]+\/\*$/)
    }
  })

  it("knownGrantedOrigins keeps only recognized origins", () => {
    const granted = ["https://chatgpt.com/*", "https://evil.example/*", "https://claude.ai/*"]
    expect(knownGrantedOrigins(granted)).toEqual(["https://chatgpt.com/*", "https://claude.ai/*"])
  })

  it("knownGrantedOrigins is empty when nothing is granted", () => {
    expect(knownGrantedOrigins([])).toEqual([])
  })
})
