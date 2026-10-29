import type { Descriptor } from "./reflection.js"
import type { SharedState } from "./types/runtime.js"
import INSPECT from "./constant/inspect.js"
import ESM from "./constant/esm.js"

import encodeId from "./util/encode-id.js"
import setDeferred from "./util/set-deferred.js"

const { PROXY_PREFIX } = INSPECT

const { PACKAGE_PREFIX, PACKAGE_VERSION } = ESM

const SHARED_SYMBOL = Symbol.for(PACKAGE_PREFIX + "@" + PACKAGE_VERSION + ":shared")

function getShared(): SharedState {
  if (__shared__ !== void 0) {
    __shared__.reloaded = false

    return __shared__
  }

  try {
    __shared__ = __non_webpack_require__(SHARED_SYMBOL) as SharedState
    __shared__.reloaded = true

    return __shared__
  } catch {}

  return init()
}

function init(): SharedState {
  const FuncToString = Function.prototype.toString

  const dummyProxy = new Proxy(class {}, {
    [PACKAGE_PREFIX]: 1
  } as ProxyHandler<object>)

  const support = {
    wasm: typeof WebAssembly === "object" && WebAssembly !== null
  }

  const symbol = {
    _compile: Symbol.for(PACKAGE_PREFIX + ":module._compile"),
    entry: Symbol.for(PACKAGE_PREFIX + ":entry"),
    mjs: Symbol.for(PACKAGE_PREFIX + ':Module._extensions[".mjs"]'),
    namespace: Symbol.for(PACKAGE_PREFIX + ":namespace"),
    package: Symbol.for(PACKAGE_PREFIX + ":package"),
    proxy: Symbol.for(PACKAGE_PREFIX + ":proxy"),
    realGetProxyDetails: Symbol.for(PACKAGE_PREFIX + ":realGetProxyDetails"),
    realRequire: Symbol.for(PACKAGE_PREFIX + ":realRequire"),
    runtime: Symbol.for(PACKAGE_PREFIX + ":runtime"),
    shared: SHARED_SYMBOL,
    wrapper: Symbol.for(PACKAGE_PREFIX + ":wrapper")
  }

  const utilBinding = {} as SharedState["utilBinding"]

  const shared = {
    bridged: new Map(),
    customInspectKey: void 0,
    defaultInspectOptions: void 0,
    entry: {
      cache: new WeakMap()
    },
    external: __external__,
    inited: false,
    loader: new Map(),
    memoize: {
      moduleCache: new WeakMap(),
      builtinEntries: new Map(),
      builtinModules: new Map(),
      fsRealpath: new Map(),
      moduleESMResolveFilename: new Map(),
      moduleInternalFindPath: new Map(),
      moduleInternalReadPackage: new Map(),
      modulePackageExportsErrors: new WeakSet(),
      moduleStaticResolveFilename: new Map(),
      shimFunctionPrototypeToString: new WeakMap(),
      shimProcessBindingUtilGetProxyDetails: new Map(),
      shimPuppeteerExecutionContextPrototypeEvaluateHandle: new WeakMap(),
      utilGetProxyDetails: new WeakMap(),
      utilMaskFunction: new WeakMap(),
      utilMaxSatisfying: new Map(),
      utilParseURL: new Map(),
      utilProxyExports: new WeakMap(),
      utilSatisfies: new Map(),
      utilUnwrapOwnProxy: new WeakMap(),
      utilUnwrapProxy: new WeakMap()
    },
    module: {},
    moduleState: {
      configuring: false,
      instantiating: false,
      parsing: false,
      requireDepth: 0,
      statFast: null,
      statSync: null
    },
    package: {
      dir: new Map(),
      root: new Map()
    },
    pendingScripts: new Map(),
    pendingWrites: new Map(),
    realpathNativeSync: void 0,
    reloaded: false,
    safeGlobal: __global__,
    support,
    symbol,
    unsafeGlobal: global,
    utilBinding
  } as unknown as SharedState

  setDeferred(shared, "circularErrorMessage", () => {
    try {
      const object: { a?: unknown } = {}

      object.a = object
      JSON.stringify(object)
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })

  setDeferred(shared, "defaultGlobal", (): typeof globalThis => {
    const { safeVM } = shared.module

    return new safeVM.Script("this").runInThisContext() as typeof globalThis
  })

  setDeferred(shared, "contextEval", () => {
    if (shared.unsafeGlobal === shared.defaultGlobal)
      return shared.external.eval as SharedState["contextEval"]
    return new shared.module.safeVM.Script("eval").runInContext(
      shared.unsafeContext
    ) as SharedState["contextEval"]
  })

  setDeferred(shared, "originalConsole", (): Console | typeof Function.prototype => {
    const { safeInspector, safeVM, utilGet } = shared.module

    const originalConsole: unknown = utilGet(safeInspector, "console")

    return typeof originalConsole === "function"
      ? originalConsole
      : (new safeVM.Script("console").runInNewContext() as Console)
  })

  setDeferred(shared, "proxyNativeSourceText", () => {
    // Node < 10 doesn't support `Function#toString()` of proxied functions.
    // https://node.green/#ESNEXT-candidate--stage-3--Function-prototype-toString-revision
    try {
      return FuncToString.call(dummyProxy)
    } catch {}

    return ""
  })

  setDeferred(shared, "runtimeName", () => {
    const { safeCrypto } = shared.module

    return encodeId(
      "_" + safeCrypto.createHash("md5").update(Date.now().toString()).digest("hex").slice(0, 3)
    )
  })

  setDeferred(shared, "unsafeContext", () => {
    const { safeVM, utilPrepareContext } = shared.module
    const unsafeGlobal = shared.unsafeGlobal
    let context = safeVM.createContext(unsafeGlobal)

    // Some Node versions cannot resolve existing VM-context global bindings
    // when that context is re-used from an embedding runtime such as Jest.
    // Recontextify a copy rather than executing modules without process/global.
    if (
      safeVM.isContext(unsafeGlobal) &&
      typeof unsafeGlobal.global === "object" &&
      new safeVM.Script("typeof global").runInContext(context) === "undefined"
    ) {
      // Preserve non-enumerable globals such as DOMException and copy accessors
      // without resolving Node's lazy globals or invoking application getters.
      const sandbox = {}

      for (const name of Reflect.ownKeys(unsafeGlobal)) {
        const descriptor: Descriptor | undefined = Reflect.getOwnPropertyDescriptor(
          unsafeGlobal,
          name
        )

        if (descriptor !== void 0) {
          Reflect.defineProperty(sandbox, name, descriptor)
        }
      }

      context = safeVM.createContext(sandbox)
    }

    return utilPrepareContext(context)
  })

  setDeferred(support, "await", () => {
    const { safeVM } = shared.module

    try {
      new safeVM.Script("async()=>await 1").runInThisContext()
      return true
    } catch {}

    return false
  })

  setDeferred(support, "consoleOptions", () => {
    const { safeProcess, utilSatisfies } = shared.module

    return utilSatisfies(safeProcess.version, ">=10")
  })

  setDeferred(support, "createCachedData", () => {
    const { safeVM } = shared.module

    return typeof safeVM.Script.prototype.createCachedData === "function"
  })

  setDeferred(support, "inspectProxies", () => {
    const { safeUtil } = shared.module

    // Node < 6.1.0 does not support inspecting proxies.
    const inspected = safeUtil.inspect(dummyProxy, {
      depth: 1,
      showProxy: true
    })

    return inspected.indexOf(PROXY_PREFIX) !== -1 && inspected.indexOf(PACKAGE_PREFIX) !== -1
  })

  setDeferred(support, "lookupShadowed", () => {
    // Node < 8 will lookup accessors in the prototype chain
    // despite being shadowed by data properties.
    // https://node.green/#ES2017-annex-b
    const object = {
      __proto__: {
        get a() {
          return void 0
        },
        set a(_value) {}
      },
      a: 1
    }

    return object.__lookupGetter__("a") === void 0 && object.__lookupSetter__("a") === void 0
  })

  setDeferred(support, "nativeProxyReceiver", () => {
    const { SafeBuffer, utilGet, utilToString } = shared.module

    // Detect support for invoking native functions with a proxy receiver.
    // https://bugs.chromium.org/p/v8/issues/detail?id=5773
    try {
      const proxy = new Proxy(SafeBuffer.alloc(0), {
        get: (buffer, name): unknown => Reflect.get(buffer, name)
      })

      // Return a result so the test won't be removed by Terser.
      // https://github.com/terser-js/terser#the-unsafe-compress-option
      return typeof proxy.toString() === "string"
    } catch (e) {
      return !/Illegal/.test(utilToString(utilGet(e, "message")))
    }
  })

  setDeferred(support, "realpathNative", () => {
    const { safeProcess, utilSatisfies } = shared.module

    return utilSatisfies(safeProcess.version, ">=9.2")
  })

  setDeferred(support, "replShowProxy", () => {
    const { safeProcess, utilSatisfies } = shared.module

    return utilSatisfies(safeProcess.version, ">=10")
  })

  setDeferred(support, "vmCompileFunction", () => {
    const { safeProcess, utilSatisfies } = shared.module

    return utilSatisfies(safeProcess.version, ">=10.10")
  })

  setDeferred(utilBinding, "errorDecoratedSymbol", () => {
    const { binding, safeProcess, utilSatisfies } = shared.module

    return utilSatisfies(safeProcess.version, "<7")
      ? "node:decorated"
      : binding.util.decorated_private_symbol
  })

  setDeferred(utilBinding, "hiddenKeyType", () => {
    return typeof utilBinding.errorDecoratedSymbol
  })

  return (__shared__ = shared)
}

export default getShared()
