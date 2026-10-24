import SafeBuffer from "../safe/buffer.js"

import shared from "../shared.js"
import unapply from "../util/unapply.js"

function init() {
  return {
    alloc: SafeBuffer.alloc,
    concat: SafeBuffer.concat,
    slice: unapply(SafeBuffer.prototype.slice) as (
      buffer: Buffer,
      start?: number,
      end?: number
    ) => Buffer
  }
}

export default shared.inited ? shared.module.GenericBuffer : (shared.module.GenericBuffer = init())

export type CachedModule = ReturnType<typeof init>
