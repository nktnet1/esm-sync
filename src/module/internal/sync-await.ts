import Reflect from "../../reflection.js"
interface NativeBridge {
  canPoll(): boolean
  alive(): boolean
  poll(): void
}
function isBridge(value: unknown): value is NativeBridge {
  if (typeof value !== "object" || value === null) return false
  const bridge = value as Record<string, unknown>
  return (
    typeof bridge.canPoll === "function" &&
    typeof bridge.alive === "function" &&
    typeof bridge.poll === "function"
  )
}
import ESM from "../../constant/esm.js"
import realRequire from "../../real/require.js"
import realProcess from "../../real/process.js"
import shared from "../../shared.js"

// Preloads and later loader factories can share Entry records across bundle
// evaluations. Their await protocol must retain the same token identity.
const AWAIT_MARKER = Symbol.for(ESM.PACKAGE_PREFIX + "@" + ESM.PACKAGE_VERSION + ":top-level-await")
const hrtime = realProcess.hrtime
let bridge: NativeBridge | null | undefined
let bridgeFailure: unknown

function now() {
  const time = Reflect.apply(hrtime, realProcess, [])
  return time[0] * 1000 + time[1] / 1e6
}

function makeAwait(value: unknown) {
  return { [AWAIT_MARKER]: true, value }
}

function isAwait(value: unknown): value is { [AWAIT_MARKER]: true; value: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[AWAIT_MARKER] === true
  )
}

function asyncError(code: string, message: string, cause?: unknown) {
  const error = new shared.external.Error(message) as Error & { code: string }
  error.code = code
  if (cause !== void 0) {
    Object.defineProperty(error, "cause", { configurable: true, writable: true, value: cause })
  }
  return error
}

function getBridge() {
  if (bridge === void 0) {
    bridge = null
    const { arch, platform, versions } = realProcess
    try {
      const loaded = realRequire(
        ESM.PACKAGE_DIRNAME + "/native/" + platform + "-" + arch + "-" + versions.modules + ".node"
      )
      if (!isBridge(loaded)) throw new TypeError("Invalid native await bridge")
      bridge = loaded
    } catch (error) {
      bridgeFailure = error
    }
  }
  return bridge
}

function drainMicrotasks() {
  const tick = realProcess._tickCallback
  if (typeof tick === "function") Reflect.apply(tick, realProcess, [])
}

function awaitDeadline() {
  const configured = realProcess.env.ESM_SYNC_AWAIT_TIMEOUT_MS
  const timeout = configured === void 0 ? 5000 : Number(configured)
  if (!Number.isSafeInteger(timeout) || timeout < 1) {
    throw asyncError(
      "ERR_ESM_SYNC_ASYNC_TIMEOUT",
      "ESM_SYNC_AWAIT_TIMEOUT_MS must be a positive safe integer"
    )
  }
  return now() + timeout
}

function checkDeadline(deadline: number) {
  if (now() >= deadline) {
    throw asyncError(
      "ERR_ESM_SYNC_ASYNC_TIMEOUT",
      "Top-level await exceeded its synchronous deadline"
    )
  }
}

function poll(deadline: number) {
  const native = getBridge()
  if (native === null) {
    throw asyncError(
      "ERR_ESM_SYNC_ASYNC_PENDING",
      "Top-level await needs timers or I/O, but the native await bridge is unavailable",
      bridgeFailure
    )
  }
  if (!native.canPoll()) {
    throw asyncError(
      "ERR_ESM_SYNC_ASYNC_REENTRANT",
      "Top-level await cannot poll the event loop from an async callback or microtask"
    )
  }
  checkDeadline(deadline)
  if (!native.alive()) {
    throw asyncError(
      "ERR_ESM_SYNC_ASYNC_PENDING",
      "Top-level await cannot settle: no active timer or I/O can make progress"
    )
  }
  native.poll()
  // A callback or a descheduled CI process can overrun the deadline while
  // libuv is running. Do not drain its queued module continuations afterward.
  checkDeadline(deadline)
}

export { asyncError, awaitDeadline, checkDeadline, drainMicrotasks, isAwait, makeAwait, poll }
