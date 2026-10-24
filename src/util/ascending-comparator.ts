import shared from "../shared.js"

function init() {
  function ascendingComparator(value: number, otherValue: number) {
    if (value > otherValue) {
      return 1
    }

    if (value < otherValue) {
      return -1
    }

    return 0
  }

  return ascendingComparator
}

export default shared.inited
  ? shared.module.utilAscendingComparator
  : (shared.module.utilAscendingComparator = init())

export type CachedModule = ReturnType<typeof init>
