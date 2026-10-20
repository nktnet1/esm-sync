import has from "./has.js"
import shared from "../shared.js"

function init() {
  function assign(object, ...sources) {
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]

      for (const name in source) {
        if (has(source, name)) {
          object[name] = source[name]
        }
      }
    }

    return object
  }

  return assign
}

export default shared.inited ? shared.module.utilAssign : (shared.module.utilAssign = init())
