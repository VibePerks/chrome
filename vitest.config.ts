import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Default node env; DOM-dependent suites opt in per-file with
    // `// @vitest-environment jsdom`.
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // These modules are the browser-host fail-silent boundaries (they import the
      // ambient `chrome` API / drive the live page and popup), exercised in a real
      // browser rather than unit tests - same convention as the opencode tui.tsx and
      // the vscode extension.ts.
      exclude: ["src/background.ts", "src/content/chatgpt.ts", "src/popup/popup.ts"],
      reporter: ["text-summary"],
    },
  },
})
