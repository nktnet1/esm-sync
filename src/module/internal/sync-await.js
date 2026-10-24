import ESM from "../../constant/esm.js"
import realRequire from "../../real/require.js"
import realProcess from "../../real/process.js"
import shared from "../../shared.js"

const AWAIT_MARKER = Symbol("esm-sync:top-level-await")
const hrtime = realProcess.hrtime
let bridge
let bridgeFailure

function now() {
  const time = Reflect.apply(hrtime, realProcess, [])
  return time[0] * 1000 + time[1] / 1e6
}

function makeAwait(value) {
  return { [AWAIT_MARKER]: true, value }
}

function isAwait(value) {
  return value != null && value[AWAIT_MARKER] === true
}

function asyncError(code, message, cause) {
  const error = new shared.external.Error(message)
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
      bridge = realRequire(
        ESM.PACKAGE_DIRNAME + "/native/" + platform + "-" + arch + "-" + versions.modules + ".node"
      )
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

function poll(deadline) {
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
  if (now() >= deadline) {
    throw asyncError(
      "ERR_ESM_SYNC_ASYNC_TIMEOUT",
      "Top-level await exceeded its synchronous deadline"
    )
  }
  if (!native.alive()) {
    throw asyncError(
      "ERR_ESM_SYNC_ASYNC_PENDING",
      "Top-level await cannot settle: no active timer or I/O can make progress"
    )
  }
  native.poll()
}

export { asyncError, awaitDeadline, drainMicrotasks, isAwait, makeAwait, poll }
