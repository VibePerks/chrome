import { describe, expect, it } from "vitest"
import { chooseView } from "../src/popup/router"

describe("popup router", () => {
  it("routes to the enable-sites view when no site is enabled", () => {
    expect(chooseView({ anySiteEnabled: false, hasToken: false })).toBe("sites")
    // No sites always wins, even if a token is already stored.
    expect(chooseView({ anySiteEnabled: false, hasToken: true })).toBe("sites")
  })

  it("routes to the token view when sites are enabled but no token", () => {
    expect(chooseView({ anySiteEnabled: true, hasToken: false })).toBe("token")
  })

  it("routes to the dashboard when sites are enabled and a token exists", () => {
    expect(chooseView({ anySiteEnabled: true, hasToken: true })).toBe("dashboard")
  })
})
