// Probe native text support independently of esm-sync's text implementation.
// Exercise the host's actual import-attribute handling instead of inferring
// support from the Node version or from the existence of an experimental flag.
async function supportsNativeTextImports() {
  try {
    const specifier = "data:application/json,%22test262-text-probe%22"
    await import(specifier, { with: { type: "text" } })
    return true
  } catch (error) {
    // These errors mean the host cannot load this resource as a text module.
    // Other failures (including unexpected loader errors) must not be hidden
    // by an unsupported classification.
    if (
      (error as { code?: unknown } | null)?.code === "ERR_IMPORT_ATTRIBUTE_UNSUPPORTED" ||
      (error as { code?: unknown } | null)?.code === "ERR_UNKNOWN_MODULE_FORMAT"
    ) {
      return false
    }
    throw error
  }
}

// Test262 feature tags describe engine capabilities, not promises made by the
// loader. Probe only capabilities whose absence is known to invalidate cases.
async function probeHostFeatures() {
  const immutableDescriptor = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "immutable")
  const immutableArrayBuffer =
    typeof immutableDescriptor?.get === "function" &&
    typeof Reflect.get(ArrayBuffer.prototype, "transferToImmutable") === "function"

  let nonextensiblePrivate = false
  try {
    // Using Function keeps the runner parseable on engines without private
    // fields, and tests the operation used by Test262, not just syntax.
    const addPrivateField = new Function(
      "target",
      "class Marker extends function (value) { return value } { #brand = true }; return new Marker(target)"
    )
    const target = new Proxy(Object.preventExtensions(Object.create(null) as object), {})
    addPrivateField(target)
  } catch (error) {
    nonextensiblePrivate = error instanceof TypeError
  }

  return {
    "immutable-arraybuffer": immutableArrayBuffer,
    "nonextensible-applies-to-private": nonextensiblePrivate,
    "import-text": await supportsNativeTextImports()
  }
}

// Run as a separate worker so its emitted async helpers remain in scope.
probeHostFeatures().then(
  (features) => process.stdout.write(JSON.stringify(features)),
  (error: unknown) => {
    console.error(error)
    process.exitCode = 1
  }
)
