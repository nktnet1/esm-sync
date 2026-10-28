import type { Namespace } from "../../types/runtime.js"
import type { SetterArgs } from "../../types/runtime-state.js"
import ENTRY from "../../constant/entry.js"

import Entry from "../../entry.js"
import Loader from "../../loader.js"
import Module from "../../module.js"

import { readFileSync } from "../../safe/fs.js"
import getURLFromFilePath from "../../util/get-url-from-file-path.js"
import getURLQueryFragment from "../../util/get-url-query-fragment.js"
import has from "../../util/has.js"
import dualResolveFilename from "../internal/dual-resolve-filename.js"
import validateShallow from "./validate-shallow.js"
import moduleSource from "./module-source.js"
import shared from "../../shared.js"

const { STATE_EXECUTION_COMPLETED, TYPE_ESM, UPDATE_TYPE_INIT } = ENTRY

type ValueType = "text" | "bytes" | "source"

function readValue(filename: string, type: ValueType): unknown {
  if (type === "source") {
    // Ordinary Source Text Module Records have no source-phase value. The
    // explicit .source resource type provides a parse-only module record.
    if (!filename.endsWith(".source")) {
      throw new shared.external.SyntaxError(
        "Module source phase is unavailable for JavaScript modules"
      )
    }
    return moduleSource.create(readFileSync(filename, "utf8"))
  }
  if (type === "text") return readFileSync(filename, "utf8")

  const { ArrayBuffer, Uint8Array } = shared.unsafeGlobal
  const transfer: unknown = Reflect.get(ArrayBuffer.prototype, "transferToImmutable")
  const descriptor = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "immutable")
  if (typeof transfer !== "function" || typeof descriptor?.get !== "function") {
    throw new shared.external.TypeError(
      "Bytes imports require native immutable ArrayBuffer support"
    )
  }
  const bytes = readFileSync(filename)
  // An exact-size buffer avoids exposing a pooled Buffer's unrelated bytes.
  const buffer = new ArrayBuffer(bytes.length)
  new Uint8Array(buffer).set(bytes)
  return new Uint8Array(Reflect.apply(transfer, buffer, []))
}

// These modules share normal ESM binding/namespace machinery, but each type
// has a separate identity and never evaluates the resource as JavaScript.
function importValue(
  request: string,
  parentEntry: Entry,
  setterArgsList: SetterArgs,
  type: ValueType
) {
  const fixture =
    process.env.ESM_SYNC_TEST_BUILD && type === "source"
      ? moduleSource.fixtures.get(request)
      : void 0
  const filename = fixture ?? dualResolveFilename(request, parentEntry.module, false, void 0, true)
  const queryFragment = getURLQueryFragment(request)
  const cacheKey =
    (queryFragment ? getURLFromFilePath(filename) + queryFragment : filename) + "\0" + type
  const { moduleCache } = Loader.state.module

  let mod = has(moduleCache, cacheKey) ? moduleCache[cacheKey] : void 0
  let entry: Entry

  if (mod === void 0) {
    const value = readValue(filename, type)

    mod = new Module(filename, parentEntry.module)
    mod.filename = filename
    const exported = mod.exports as Namespace
    exported.default = value
    mod.loaded = true

    entry = Entry.get(mod)
    entry.type = TYPE_ESM
    entry.state = STATE_EXECUTION_COMPLETED
    entry.addGetter("default", () => value)
    entry.loaded()
    entry.updateBindings()

    moduleCache[cacheKey] = mod
  } else {
    entry = Entry.get(mod)
  }

  // Do not overwrite a regular JavaScript child from the same file.
  parentEntry.children[cacheKey] = entry
  entry.addSetters(setterArgsList, parentEntry)
  entry.updateBindings(null, UPDATE_TYPE_INIT)
  validateShallow(entry, parentEntry)
  return entry
}

export default importValue
