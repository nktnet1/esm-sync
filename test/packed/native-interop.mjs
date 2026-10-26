import commonjs, { read as namedRead } from "./cjs/counter.js"
import { format as esmValue } from "./boundary/esm/file.js"

export { commonjs, namedRead, esmValue }
