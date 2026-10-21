import { _ignoreErrors, log } from "console"

log("non-enumerable:" + (typeof _ignoreErrors === "boolean"))
