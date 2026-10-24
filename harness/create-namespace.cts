"use strict"

function createNamespace<T extends object>(object: T): T {
  const ns = Object.assign(Object.create(null) as object, object)

  Reflect.defineProperty(ns, Symbol.toStringTag, {
    value: "Module"
  })

  return Object.seal(ns)
}

export = createNamespace
