import realProcess from "../../real/process.js"
import shared from "../../shared.js"

const { Promise: NativePromise } = shared.external
const AWAIT_MARKER = Symbol("esm-sync:top-level-await")

function makeAwait(value) {
  return { [AWAIT_MARKER]: true, value }
}

function waitForMicrotasks(value) {
  let settled = false
  let rejected = false
  let result

  NativePromise.resolve(value).then(
    (resolved) => {
      settled = true
      result = resolved
    },
    (error) => {
      settled = true
      rejected = true
      result = error
    }
  )

  // Node's callback executes the currently queued next-ticks and microtasks.
  // It cannot pump pending libuv I/O or timers. Never spin or block on those.
  const tick = realProcess._tickCallback
  if (typeof tick === "function") {
    Reflect.apply(tick, realProcess, [])
  }

  if (!settled) {
    const error = new Error(
      "Top-level await could not settle synchronously (pending I/O, timer, or Promise)"
    )
    error.code = "ERR_ESM_SYNC_ASYNC_PENDING"
    throw error
  }

  return { rejected, result }
}

function resumeSync(generator) {
  let step = generator.next()

  while (!step.done && step.value?.[AWAIT_MARKER] === true) {
    let outcome

    try {
      outcome = waitForMicrotasks(step.value.value)
    } catch (error) {
      // An outstanding promise must not resume evaluation after this load
      // has returned a failure. Do not deliver the runner error to user code.
      try {
        generator.return()
      } catch {}
      throw error
    }

    step = outcome.rejected ? generator.throw(outcome.result) : generator.next(outcome.result)
  }

  return step
}

export { makeAwait, resumeSync }
