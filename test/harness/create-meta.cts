"use strict"

function createMeta<T extends object>(object: T): T {
  return Object.assign(Object.create(null) as object, object)
}

export = createMeta
