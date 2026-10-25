export function createPublishManifest(
  source: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const manifest = { ...source }
  const scripts: Record<string, string> = { test: 'echo "Error: no test specified" && exit 1' }
  const originalScripts = source.scripts
  if (typeof originalScripts === "object" && originalScripts !== null) {
    for (const name of ["preinstall", "install", "postinstall"]) {
      const value: unknown = Reflect.get(originalScripts, name)
      if (typeof value === "string") scripts[name] = value
    }
  }
  for (const name of ["devDependencies", "esm", "private", "scripts"])
    Reflect.deleteProperty(manifest, name)
  manifest.scripts = scripts
  return manifest
}
