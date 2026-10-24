import isObject from "../../util/is-object.js"
import readFile from "../../fs/read-file.js"
import { sep } from "../../safe/path.js"
import shared from "../../shared.js"
import toExternalError from "../../util/to-external-error.js"

function init() {
  function readPackage(dirPath: string, fields: string[] | undefined = void 0) {
    const cache = shared.memoize.moduleInternalReadPackage

    const fieldsLength = fields === void 0 ? 0 : fields.length

    let cacheKey = dirPath + "\0"

    if (fieldsLength > 0) {
      cacheKey += fieldsLength === 1 ? fields![0] : fields!.join()
    }

    let cached = cache.get(cacheKey)

    if (cached !== void 0) {
      return cached
    }

    const jsonPath = dirPath + sep + "package.json"
    const jsonContent = readFile(jsonPath, "utf8")

    if (jsonContent === null || jsonContent === "") {
      return null
    }

    let result: unknown

    try {
      result = JSON.parse(jsonContent)
    } catch (e) {
      if (typeof e === "object" && e !== null) {
        const error = e as { message: unknown; path?: string }
        error.message = "Error parsing " + jsonPath + ": " + error.message
        error.path = jsonPath
      }

      toExternalError(e)

      throw e
    }

    if (isObject(result)) {
      cache.set(cacheKey, result)

      return result
    }

    return null
  }

  return readPackage
}

export default shared.inited
  ? shared.module.moduleInternalReadPackage
  : (shared.module.moduleInternalReadPackage = init())

export type CachedModule = ReturnType<typeof init>
