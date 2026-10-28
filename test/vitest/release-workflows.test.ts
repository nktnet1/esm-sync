import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const workflowDirectory = path.join(root, ".github/workflows")

function workflow(filename: string): string {
  return readFileSync(path.join(workflowDirectory, filename), "utf8")
}

describe("release workflow configuration", () => {
  it("uses .yaml for every GitHub Actions workflow", () => {
    const filenames = readdirSync(workflowDirectory)
    expect(filenames).toContain("pipeline.yaml")
    expect(filenames).toContain("release.yaml")
    expect(filenames).toContain("publish.yaml")
    expect(filenames.filter((filename) => filename.endsWith(".yml"))).toStrictEqual([])
  })

  it("invokes the renamed reusable test pipeline before release packaging", () => {
    const release = workflow("release.yaml")
    expect(release).toMatch(/^ {4}uses: \.\/\.github\/workflows\/pipeline\.yaml$/m)
    expect(release).toMatch(/^ {4}needs: test$/m)
  })

  it("runs only library integration tests on the OS/Node matrix", () => {
    const pipeline = workflow("pipeline.yaml")
    const library = pipeline.split("  library:\n")[1]?.split("  tooling:\n")[0]
    expect.assert(library)
    expect(library).toMatch(/os: \[ubuntu-latest, macos-15-intel, windows-2022\]/)
    expect(library).toMatch(/node-version: \[22, 24, 26\]/)
    expect(library).toMatch(/run: pnpm test:vitest --suite=runtime/)
    expect(library).toMatch(
      /if: matrix\.node-version == 24\r?\n\s+run: pnpm test:packed --format=both/
    )
    expect(library).not.toMatch(
      /run: pnpm (?:lint|typecheck|audit:prod|verify:prod|test:verdaccio)/
    )
  })

  it("runs tooling, production verification and registry checks once on Ubuntu/Node 24", () => {
    const tooling = workflow("pipeline.yaml").split("  tooling:\n")[1]
    expect.assert(tooling)
    expect(tooling).toMatch(/runs-on: ubuntu-24\.04/)
    expect(tooling).toMatch(/runtime: node@24/)
    for (const command of [
      "pnpm audit:prod",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm test:vitest --suite=tooling",
      "pnpm verify:prod",
      "pnpm test:verdaccio"
    ]) {
      expect(tooling, command).toContain(`run: ${command}`)
    }
  })

  it("requires the Production environment and OIDC to publish to npm", () => {
    const publish = workflow("publish.yaml")
    expect(publish).toMatch(/^ {4}environment:\r?\n {6}name: Production\r?$/m)
    expect(publish).toMatch(/^ {6}id-token: write$/m)
    expect(publish).toMatch(/^ {6}- name: Validate and publish the exact release tarball$/m)
    expect(readFileSync(path.join(root, "script/RELEASING.md"), "utf8")).toMatch(/`publish\.yaml`/)
  })
})
