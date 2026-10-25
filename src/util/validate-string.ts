import errors from "../errors.js"
import shared from "../shared.js"

function init() {
  const { ERR_INVALID_ARG_TYPE } = errors

  function validateString(value: unknown, name: string): asserts value is string {
    if (typeof value !== "string") {
      throw new ERR_INVALID_ARG_TYPE(name, "string", value)
    }
  }

  return validateString
}

const validateString: (value: unknown, name: string) => asserts value is string = shared.inited
  ? shared.module.utilValidateString
  : (shared.module.utilValidateString = init())

export default validateString

export type CachedModule = ReturnType<typeof init>
