import { describe, expect, it } from "vitest"
import { chooseView } from "../src/popup/router"

describe("popup router", () => {
  it("routes to the enable-sites view when no site is enabled", () => {
    expect(chooseView({ anySiteEnabled: false, connected: false })).toBe("sites")
    // No sites always wins, even if already connected.
    expect(chooseView({ anySiteEnabled: false, connected: true })).toBe("sites")
  })

  it("routes to the connect view when sites are enabled but not connected", () => {
    expect(chooseView({ anySiteEnabled: true, connected: false })).toBe("connect")
  })

  it("routes to the dashboard when sites are enabled and connected", () => {
    expect(chooseView({ anySiteEnabled: true, connected: true })).toBe("dashboard")
  })
})
