import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "vitest"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const workflowDirectory = path.join(root, ".github/workflows")

function workflow(filename: string): string {
  return readFileSync(path.join(workflowDirectory, filename), "utf8")
}

describe("release workflow configuration", () => {
  it("uses .yaml for every GitHub Actions workflow", () => {
    const filenames = readdirSync(workflowDirectory)
    assert.ok(filenames.includes("pipeline.yaml"))
    assert.ok(filenames.includes("release.yaml"))
    assert.ok(filenames.includes("publish.yaml"))
    assert.deepEqual(
      filenames.filter((filename) => filename.endsWith(".yml")),
      []
    )
  })

  it("invokes the renamed reusable test pipeline before release packaging", () => {
    const release = workflow("release.yaml")
    assert.match(release, /^ {4}uses: \.\/\.github\/workflows\/pipeline\.yaml$/m)
    assert.match(release, /^ {4}needs: test$/m)
  })

  it("runs only library integration tests on the OS/Node matrix", () => {
    const pipeline = workflow("pipeline.yaml")
    const library = pipeline.split("  library:\n")[1]?.split("  tooling:\n")[0]
    assert.ok(library)
    assert.match(library, /os: \[ubuntu-latest, macos-15-intel, windows-2022\]/)
    assert.match(library, /node-version: \[22, 24, 26\]/)
    assert.match(library, /run: pnpm test:vitest --suite=runtime/)
    assert.match(
      library,
      /if: matrix\.node-version == 24\r?\n\s+run: pnpm test:packed --format=both/
    )
    assert.doesNotMatch(
      library,
      /run: pnpm (?:lint|typecheck|audit:prod|verify:prod|test:verdaccio)/
    )
  })

  it("runs tooling, production verification and registry checks once on Ubuntu/Node 24", () => {
    const tooling = workflow("pipeline.yaml").split("  tooling:\n")[1]
    assert.ok(tooling)
    assert.match(tooling, /runs-on: ubuntu-24\.04/)
    assert.match(tooling, /runtime: node@24/)
    for (const command of [
      "pnpm audit:prod",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm test:vitest --suite=tooling",
      "pnpm verify:prod",
      "pnpm test:verdaccio"
    ]) {
      assert.ok(tooling.includes(`run: ${command}`), command)
    }
  })

  it("requires the Production environment and OIDC to publish to npm", () => {
    const publish = workflow("publish.yaml")
    assert.match(publish, /^ {4}environment:\r?\n {6}name: Production\r?$/m)
    assert.match(publish, /^ {6}id-token: write$/m)
    assert.match(publish, /^ {6}- name: Validate and publish the exact release tarball$/m)
    assert.match(readFileSync(path.join(root, "script/RELEASING.md"), "utf8"), /`publish\.yaml`/)
  })
})
