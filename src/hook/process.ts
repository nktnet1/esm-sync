import Reflect from "../reflection.js"
import ESM from "../constant/esm.js"

import Loader from "../loader.js"
import Wrapper from "../wrapper.js"

import isStackTraceMaskable from "../util/is-stack-trace-maskable.js"
import maskStackTrace from "../error/mask-stack-trace.js"
import scrubStackTrace from "../error/scrub-stack-trace.js"
import toExternalError from "../util/to-external-error.js"

const { PACKAGE_RANGE } = ESM

function hook(processObject: object) {
  function exceptionManagerWrapper(
    this: unknown,
    manager: typeof Function.prototype,
    func: typeof Function.prototype,
    args: unknown[]
  ) {
    const wrapped = Wrapper.find(processObject, "_fatalException", PACKAGE_RANGE)

    return wrapped === null
      ? Reflect.apply(func, this, args)
      : Reflect.apply(wrapped, this, [manager, func, args])
  }

  function exceptionMethodWrapper(
    this: unknown,
    _manager: typeof Function.prototype,
    func: typeof Function.prototype,
    args: unknown[]
  ) {
    const [error] = args

    if (!Loader.state.package.default!.options.debug && isStackTraceMaskable(error)) {
      maskStackTrace(error)
    } else {
      toExternalError(error)
    }

    return Reflect.apply(func, this, args)
  }

  function warningManagerWrapper(
    this: unknown,
    manager: typeof Function.prototype,
    func: typeof Function.prototype,
    args: unknown[]
  ) {
    const wrapped = Wrapper.find(processObject, "emitWarning", PACKAGE_RANGE)

    return wrapped === null
      ? Reflect.apply(func, this, args)
      : Reflect.apply(wrapped, this, [manager, func, args])
  }

  function warningMethodWrapper(
    this: unknown,
    _manager: typeof Function.prototype,
    func: typeof Function.prototype,
    args: unknown[]
  ) {
    const [stack] = args

    if (typeof stack === "string") {
      args[0] = scrubStackTrace(stack)
    }

    return Reflect.apply(func, this, args)
  }

  Wrapper.manage(processObject, "_fatalException", exceptionManagerWrapper)
  Wrapper.wrap(processObject, "_fatalException", exceptionMethodWrapper)

  Wrapper.manage(processObject, "emitWarning", warningManagerWrapper)
  Wrapper.wrap(processObject, "emitWarning", warningMethodWrapper)
}

export default hook
