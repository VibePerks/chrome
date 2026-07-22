// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { composerAnchor, matchesAny } from "../src/content/chatgpt"

describe("matchesAny", () => {
  it("is false when nothing matches", () => {
    document.body.innerHTML = "<div></div>"
    expect(matchesAny(document, ['button[data-testid="stop-button"]'])).toBe(false)
  })

  it("is true when a thinking selector is present", () => {
    document.body.innerHTML = '<button data-testid="stop-button">Stop</button>'
    expect(matchesAny(document, ['button[data-testid="stop-button"]', "button.other"])).toBe(true)
  })

  it("ignores an invalid selector and keeps checking", () => {
    document.body.innerHTML = '<button aria-label="Stop streaming"></button>'
    expect(matchesAny(document, [":::bad:::", 'button[aria-label="Stop streaming"]'])).toBe(true)
  })
})

describe("composerAnchor", () => {
  // A composer element spanning left..left+width with the given top/height. left and
  // width drive the horizontal centre; top drives the vertical anchor.
  function fakeComposer(top: number, height: number, left = 200, width = 400): Document {
    const el = {
      getBoundingClientRect: () => ({ top, height, left, width, bottom: top + height }),
    }
    return {
      querySelector: (sel: string) => (sel === "#composer" ? el : null),
    } as unknown as Document
  }
  const win = { innerHeight: 800 } as Window

  it("sits 10px above the composer's top edge and centres on it", () => {
    // composer top 700 in an 800px viewport -> bottom = 800 - 700 + 10 = 110.
    // left 200, width 400 -> centreX = 200 + 200 = 400.
    expect(composerAnchor(fakeComposer(700, 60), win, ["#composer"])).toEqual({
      bottomPx: 110,
      centerXPx: 400,
    })
  })

  it("returns undefined when no composer selector resolves", () => {
    expect(composerAnchor(fakeComposer(700, 60), win, ["#missing"])).toBeUndefined()
  })

  it("skips a zero-height composer element", () => {
    expect(composerAnchor(fakeComposer(700, 0), win, ["#composer"])).toBeUndefined()
  })

  it("ignores an invalid selector and keeps checking", () => {
    expect(composerAnchor(fakeComposer(700, 60), win, [":::bad:::", "#composer"])).toEqual({
      bottomPx: 110,
      centerXPx: 400,
    })
  })

  // A composer input wrapped in a taller container that shares its bottom edge: the
  // widget must anchor above and centre on the container, not the inner input.
  function fakeWrapped(
    input: { top: number; bottom: number; height: number; left: number; width: number },
    ancestors: { top: number; bottom: number; height: number; left: number; width: number }[],
  ): Document {
    type Node = { getBoundingClientRect: () => object; parentElement: Node | null }
    let parent: Node | null = null
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const a = ancestors[i]
      parent = { getBoundingClientRect: () => a, parentElement: parent }
    }
    const el: Node = { getBoundingClientRect: () => input, parentElement: parent }
    return {
      querySelector: (sel: string) => (sel === "#composer" ? el : null),
    } as unknown as Document
  }

  it("anchors above and centres on the composer container, not the inner input", () => {
    // Input top 700 (centre 300), but its container reaches up to 640 and is wider
    // (left 150, width 500 -> centre 400). bottom = 800 - 640 + 10 = 170.
    const doc = fakeWrapped({ top: 700, bottom: 760, height: 60, left: 250, width: 100 }, [
      { top: 640, bottom: 770, height: 130, left: 150, width: 500 },
    ])
    expect(composerAnchor(doc, win, ["#composer"])).toEqual({ bottomPx: 170, centerXPx: 400 })
  })

  it("stops climbing into a page-layout wrapper that is too tall", () => {
    // The immediate wrapper (top 640) is composer-sized; its parent spans the whole
    // viewport and must be ignored. bottom = 800 - 640 + 10 = 170, centre = 400.
    const doc = fakeWrapped({ top: 700, bottom: 760, height: 60, left: 250, width: 100 }, [
      { top: 640, bottom: 770, height: 130, left: 150, width: 500 },
      { top: 0, bottom: 800, height: 800, left: 0, width: 1000 },
    ])
    expect(composerAnchor(doc, win, ["#composer"])).toEqual({ bottomPx: 170, centerXPx: 400 })
  })

  it("ignores an ancestor that does not wrap the input's bottom", () => {
    // The ancestor sits well above the input (its bottom is far higher), so it is a
    // sibling/unrelated box, not the composer container. Falls back to the input
    // (top 700 -> bottom 110, left 250 width 100 -> centre 300).
    const doc = fakeWrapped({ top: 700, bottom: 760, height: 60, left: 250, width: 100 }, [
      { top: 400, bottom: 500, height: 100, left: 150, width: 500 },
    ])
    expect(composerAnchor(doc, win, ["#composer"])).toEqual({ bottomPx: 110, centerXPx: 300 })
  })
})
