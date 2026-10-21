import has from "./has.js"
import shared from "../shared.js"

function init() {
  function defaults(object, ...sources) {
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]

      for (const name in source) {
        if (has(source, name) && (object[name] === void 0 || !has(object, name))) {
          object[name] = source[name]
        }
      }
    }

    return object
  }

  return defaults
}

export default shared.inited ? shared.module.utilDefaults : (shared.module.utilDefaults = init())
