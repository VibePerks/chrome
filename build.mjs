import { build } from "esbuild"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

// Bundles the three extension entry points into dist/ and copies the static
// manifest + popup HTML so dist/ is a directly loadable unpacked extension.
// Entry file names map to the paths the manifest references:
//   background.ts -> dist/background.js  (service worker)
//   content/chatgpt.ts -> dist/content.js (content script on chatgpt.com)
//   popup/popup.ts -> dist/popup.js (action popup)

const outdir = "dist"
const configSource = readFileSync("src/config.ts", "utf8")

function configConstant(name) {
  const match = configSource.match(new RegExp(`export const ${name} = "([^"]+)"`))
  if (!match) throw new Error(`Missing ${name} in src/config.ts`)
  return match[1].replace(/\/+$/, "")
}

const apiBase = configConstant("DEFAULT_API_BASE")
const siteBase = configConstant("DEFAULT_SITE_BASE")

function writeStatic(source, destination) {
  const content = readFileSync(source, "utf8")
    .replaceAll("__API_BASE__", apiBase)
    .replaceAll("__SITE_BASE__", siteBase)
  writeFileSync(destination, content)
}

rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })

await build({
  entryPoints: {
    background: "src/background.ts",
    content: "src/content/chatgpt.ts",
    popup: "src/popup/popup.ts",
  },
  outdir,
  bundle: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  legalComments: "none",
  logLevel: "info",
})

writeStatic("static/manifest.json", `${outdir}/manifest.json`)
writeStatic("static/popup.html", `${outdir}/popup.html`)

console.log("Built extension into dist/")
