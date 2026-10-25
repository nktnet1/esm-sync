import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import ts from "typescript"

const semver = createRequire(import.meta.url)("semver") as typeof import("semver")

export function checkTypeScriptVersion(root: string): void {
  const metadata: unknown = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  if (metadata === null || typeof metadata !== "object" || !("devDependencies" in metadata))
    throw new TypeError("Missing development dependencies")
  const dependencies = metadata.devDependencies
  if (
    dependencies === null ||
    typeof dependencies !== "object" ||
    !("typescript" in dependencies) ||
    typeof dependencies.typescript !== "string"
  )
    throw new TypeError("Missing TypeScript dependency version")
  if (!semver.satisfies(ts.version, dependencies.typescript))
    throw new Error(
      `Installed TypeScript ${ts.version} does not satisfy ${dependencies.typescript}`
    )
}
