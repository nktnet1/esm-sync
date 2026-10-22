import { log } from "console"
import { _stat } from "module"

log("non-enumerable:" + (typeof _stat === "function"))
