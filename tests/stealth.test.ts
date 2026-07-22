import { describe, expect, it } from "vitest"
import { StealthMonitor } from "../src/content/stealth"

describe("StealthMonitor", () => {
  it("starts normal and showing", () => {
    const m = new StealthMonitor()
    expect(m.currentMode()).toBe("normal")
    expect(m.shouldShow()).toBe(true)
    expect(m.isReduced()).toBe(false)
  })

  it("escalates to reduced after the first strip", () => {
    const m = new StealthMonitor()
    expect(m.recordStrip()).toBe("reduced")
    expect(m.isReduced()).toBe(true)
    expect(m.shouldShow()).toBe(true)
  })

  it("goes dormant after repeated strips and stops showing", () => {
    const m = new StealthMonitor()
    m.recordStrip()
    m.recordStrip()
    expect(m.recordStrip()).toBe("dormant")
    expect(m.shouldShow()).toBe(false)
  })
})
