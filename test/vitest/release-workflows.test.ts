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

  it("requires the Production environment and OIDC to publish to npm", () => {
    const publish = workflow("publish.yaml")
    assert.match(publish, /^ {4}environment:\r?\n {6}name: Production\r?$/m)
    assert.match(publish, /^ {6}id-token: write$/m)
    assert.match(publish, /^ {6}- name: Validate and publish the exact release tarball$/m)
    assert.match(readFileSync(path.join(root, "script/RELEASING.md"), "utf8"), /`publish\.yaml`/)
  })
})
