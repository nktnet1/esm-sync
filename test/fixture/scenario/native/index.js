import native, { add } from "./addon.js"
import { log } from "console"

if (add(20, 22) !== 42 || native.add !== add || native.add(-3, 5) !== 2) {
  throw new Error("Native addon interop failed")
}

log("native:true")
