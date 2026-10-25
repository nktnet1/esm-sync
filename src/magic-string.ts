// A simplified version of magic-string.
// Copyright Rich Harris. Released under MIT license:
// https://github.com/Rich-Harris/magic-string

import setPrototypeOf from "./util/set-prototype-of.js"
import shared from "./shared.js"

function init() {
  class Chunk {
    content: string
    end: number
    intro: string
    original: string
    outro: string
    next: Chunk | null
    previous: Chunk | null
    start: number
    constructor(start: number, end: number, content: string) {
      this.content = content
      this.end = end
      this.intro = ""
      this.original = content
      this.outro = ""
      this.next = null
      this.previous = null
      this.start = start
    }

    appendLeft(content: string) {
      this.outro += content
    }

    appendRight(content: string) {
      this.intro += content
    }

    contains(index: number) {
      return this.start < index && index < this.end
    }

    edit(content: string) {
      this.content = content
      this.intro = ""
      this.outro = ""
    }

    prependLeft(content: string) {
      this.outro = content + this.outro
    }

    prependRight(content: string) {
      this.intro = content + this.intro
    }

    split(index: number) {
      const sliceIndex = index - this.start
      const originalBefore = this.original.slice(0, sliceIndex)
      const originalAfter = this.original.slice(sliceIndex)
      const newChunk = new Chunk(index, this.end, originalAfter)

      newChunk.outro = this.outro
      newChunk.next = this.next
      newChunk.previous = this
      if (this.next !== null) this.next.previous = newChunk

      this.original = originalBefore
      this.end = index
      this.content = originalBefore
      this.outro = ""
      this.next = newChunk

      return newChunk
    }

    toString() {
      return this.intro + this.content + this.outro
    }
  }

  setPrototypeOf(Chunk.prototype, null)

  class MagicString {
    original: string
    intro: string
    outro: string
    firstChunk: Chunk | null
    lastSearchedChunk: Chunk
    byStart: Map<number, Chunk>
    byEnd: Map<number, Chunk>
    constructor(string: string) {
      const chunk = new Chunk(0, string.length, string)

      this.original = string
      this.intro = ""
      this.outro = ""
      this.firstChunk = chunk
      this.lastSearchedChunk = chunk

      this.byStart = new Map()
      this.byStart.set(0, chunk)

      this.byEnd = new Map()
      this.byEnd.set(string.length, chunk)
    }

    appendLeft(index: number, content: string) {
      this._split(index)

      const chunk = this.byEnd.get(index)

      if (chunk === void 0) {
        this.intro += content
      } else {
        chunk.appendLeft(content)
      }

      return this
    }

    appendRight(index: number, content: string) {
      this._split(index)

      const chunk = this.byStart.get(index)

      if (chunk === void 0) {
        this.outro += content
      } else {
        chunk.appendRight(content)
      }

      return this
    }

    overwrite(start: number, end: number, content: string) {
      this._split(start)
      this._split(end)

      const first = this.byStart.get(start)!
      const last = this.byEnd.get(end)!

      if (start === end) {
        return content ? this.appendLeft(start, content) : this
      }

      first.edit(content)

      if (first === last) {
        return this
      }

      let chunk = first.next

      while (chunk !== null && chunk !== last) {
        chunk.edit("")
        chunk = chunk.next
      }

      if (chunk !== null) chunk.edit("")
      return this
    }

    // Move original source coordinates together with all edits attached to
    // them. Later visitors (including deferred TDZ instrumentation) can still
    // address the moved chunks by their original positions.
    move(start: number, end: number, index: number) {
      if (index >= start && index <= end) return this
      this._split(start)
      this._split(end)
      this._split(index)

      const first = this.byStart.get(start)!
      const last = this.byEnd.get(end)!
      const before = first.previous
      const after = last.next
      if (before === null) this.firstChunk = after
      else before.next = after
      if (after !== null) after.previous = before

      const target = this.byStart.get(index)!
      const previous = target.previous
      if (previous === null) this.firstChunk = first
      else previous.next = first
      first.previous = previous
      last.next = target
      target.previous = last
      return this
    }

    prependLeft(index: number, content: string) {
      this._split(index)

      const chunk = this.byEnd.get(index)

      if (chunk === void 0) {
        this.intro = content + this.intro
      } else {
        chunk.prependLeft(content)
      }

      return this
    }

    prependRight(index: number, content: string) {
      this._split(index)

      const chunk = this.byStart.get(index)

      if (chunk === void 0) {
        this.outro = content + this.outro
      } else {
        chunk.prependRight(content)
      }

      return this
    }

    _split(index: number) {
      if (this.byStart.has(index) || this.byEnd.has(index)) {
        return
      }

      let chunk: Chunk | undefined = this.lastSearchedChunk

      const searchForward = index > chunk.end

      while (chunk) {
        if (chunk.contains(index)) {
          this._splitChunk(chunk, index)
          return
        }

        chunk = searchForward ? this.byStart.get(chunk.end) : this.byEnd.get(chunk.start)
      }
    }

    _splitChunk(chunk: Chunk, index: number) {
      const newChunk = chunk.split(index)

      this.byEnd.set(index, chunk)
      this.byStart.set(index, newChunk)
      this.byEnd.set(newChunk.end, newChunk)
      this.lastSearchedChunk = chunk
    }

    toString() {
      let string = this.intro
      let chunk = this.firstChunk

      while (chunk) {
        string += chunk.toString()
        chunk = chunk.next
      }

      return string + this.outro
    }
  }

  setPrototypeOf(MagicString.prototype, null)

  return MagicString
}

export default shared.inited ? shared.module.MagicString : (shared.module.MagicString = init())

export type CachedModule = ReturnType<typeof init>
