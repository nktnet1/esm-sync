import type { RuntimeRequire, SharedState } from "../../src/types/runtime.js"
import path from "node:path"

function loadOwnProtocol() {
  const root = path.resolve(__dirname, "../..")
  const esm = require(root) as typeof import("../../index.js")
  const ownModule = require.cache[require.resolve(root)]
  if (!ownModule) throw new Error("Test262: esm-sync module is not loaded")
  const metadata: unknown = require(path.join(root, "package.json"))
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("version" in metadata) ||
    typeof metadata.version !== "string"
  ) {
    throw new Error("Test262: esm-sync package version is unavailable")
  }
  // This private protocol is versioned and implemented by the bundle under test.
  const ownRequire = esm(ownModule) as unknown as RuntimeRequire
  const shared: unknown = ownRequire(Symbol.for(`esm\u200d@${metadata.version}:shared`))
  if (!shared || typeof shared !== "object" || !("symbol" in shared) || !("module" in shared)) {
    throw new Error("Test262: esm-sync shared state is unavailable")
  }
  return { ownRequire, shared: shared as SharedState }
}

export = { loadOwnProtocol }
