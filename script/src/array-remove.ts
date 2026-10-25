"use strict"

function arrayRemove<T>(array: T[] | null | undefined, iteratee: (value: T) => unknown): void {
  let length = array ? array.length : 0

  while (length--) {
    if (iteratee(array![length]!)) {
      array!.splice(length, 1)
    }
  }
}

export = arrayRemove
