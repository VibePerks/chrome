import { describe, expect, it } from "vitest"
import { chromeKv, enqueue, loadQueue, loadState, saveState } from "../src/store"
import type { Impression } from "../src/types"
import { fakeArea } from "./helpers"

function imp(token: string): Impression {
  return { impression_token: token, displayed_ms: 100 }
}

describe("store", () => {
  it("chromeKv round-trips values", async () => {
    const kv = chromeKv(fakeArea())
    await kv.set("k", { a: 1 })
    expect(await kv.get("k")).toEqual({ a: 1 })
  })

  it("loadState yields empty state when missing/malformed", async () => {
    const kv = chromeKv(fakeArea())
    expect(await loadState(kv)).toEqual({ ad: null, servedAt: 0, recorded: false })
    await kv.set("vibeperks:state", { junk: true })
    expect((await loadState(kv)).ad).toBeNull()
  })

  it("saveState persists", async () => {
    const kv = chromeKv(fakeArea())
    await saveState(kv, { ad: null, servedAt: 5, recorded: true })
    expect((await loadState(kv)).servedAt).toBe(5)
  })

  it("enqueue dedupes by impression token", async () => {
    const kv = chromeKv(fakeArea())
    await enqueue(kv, imp("t1"))
    await enqueue(kv, imp("t1"))
    await enqueue(kv, imp("t2"))
    expect(await loadQueue(kv)).toHaveLength(2)
  })
})
