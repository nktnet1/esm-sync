import bridge from "./cjs-to-esm.cjs"

export const read = () => bridge.read()
export const increment = () => bridge.increment()
