import moduleGenerator from "./module-generator.js"
import type Entry from "../../entry.js"
interface GraphNode {
  entry: Entry
  direct: boolean
  index: number
  low: number
  stacked: boolean
  component: GraphNode[] | null
}
interface EvaluationRecord {
  entry: Entry
  evaluation: Evaluation
  index: number
  low: number
  stacked: boolean
  root: EvaluationRecord | null
  parents: Set<EvaluationRecord>
  pending: number
  direct: boolean
  async: boolean
  order: number
  done: boolean
  failed: boolean
  error: unknown
  rejectionHandlers: ((error: unknown) => void)[]
  fulfillmentHandlers: (() => void)[]
  notified: boolean
  value: unknown
}
import ENTRY from "../../constant/entry.js"

import has from "../../util/has.js"
import isObjectEmpty from "../../util/is-object-empty.js"
import shared from "../../shared.js"
import promiseThen, { promiseResolve } from "../../util/promise-then.js"
import { evaluationDependencies } from "./evaluation-dependencies.js"
import { setImmediate } from "../../safe/timers.js"
import validateShallow from "../esm/validate-shallow.js"
import {
  asyncError,
  awaitDeadline,
  checkDeadline,
  drainMicrotasks,
  isAwait,
  poll
} from "./sync-await.js"

const { STATE_INITIAL, STATE_EXECUTION_STARTED, STATE_EXECUTION_COMPLETED, UPDATE_TYPE_INIT } =
  ENTRY

// Linking has already suspended every ESM generator at its body boundary.
// Classify the entire reachable graph before any of those bodies execute.
function trace(root: Entry): boolean {
  if (root.async !== null && !root.async.direct && !root.async.transitive) return false
  if (
    root.moduleRequests === null &&
    root.compileData?.firstAwaitOutsideFunction === null &&
    isObjectEmpty(root.children)
  ) {
    return false
  }
  const nodes = new Map<Entry, GraphNode>()
  const stack: GraphNode[] = []
  let index = 0
  let hasAwait = false

  function visit(entry: Entry): GraphNode | undefined {
    const evaluating = entry.asyncEvaluation?.records.get(entry)
    const pendingCycle = evaluating?.root !== null && evaluating?.root?.done === false
    if ((entry.module.loaded && !pendingCycle) || nodes.has(entry)) return nodes.get(entry)
    const direct =
      entry.compileData !== null && entry.compileData.firstAwaitOutsideFunction !== null
    const node: GraphNode = {
      entry,
      direct,
      index: index++,
      low: index - 1,
      stacked: true,
      component: null
    }
    nodes.set(entry, node)
    stack.push(node)
    hasAwait = hasAwait || direct

    const dependencies = evaluationDependencies(entry)
    for (const name in dependencies) {
      const child = dependencies[name]!
      const existing = nodes.get(child)
      const next = visit(child)
      if (next !== void 0 && next.stacked) {
        node.low = Math.min(node.low, existing === void 0 ? next.low : next.index)
      }
    }

    if (node.low === node.index) {
      const component: GraphNode[] = []
      let member: GraphNode
      do {
        member = stack.pop()!
        member.stacked = false
        member.component = component
        component.push(member)
      } while (member !== node)

      let async = component.some((item) => item.direct)
      for (const item of component) {
        const dependencies = evaluationDependencies(item.entry)
        for (const name in dependencies) {
          const child = nodes.get(dependencies[name]!)
          if (child !== void 0 && child.component !== component && child.entry.async !== null) {
            async = async || child.entry.async.transitive || child.entry.async.direct
          }
        }
      }
      for (const item of component) {
        let cyclic = component.length > 1
        const dependencies = evaluationDependencies(item.entry)
        for (const name in dependencies) cyclic = cyclic || dependencies[name]! === item.entry
        item.entry.async = {
          direct: item.direct,
          transitive: async && !item.direct,
          cyclic
        }
      }
    }
    return node
  }

  visit(root)
  return hasAwait
}

class Evaluation {
  records: Map<Entry, EvaluationRecord>
  stack: EvaluationRecord[]
  index: number
  active: boolean
  rejecting: number
  deadline: number | null
  imports: (() => void)[]
  importing: boolean
  executing: Entry | null
  detached: boolean
  scheduled: boolean
  constructor() {
    this.records = new Map()
    this.stack = []
    this.index = 0
    if (shared.moduleState.asyncEvaluationOrder === void 0)
      shared.moduleState.asyncEvaluationOrder = 0
    this.active = true
    this.rejecting = 0
    this.deadline = null
    this.imports = []
    this.importing = false
    this.executing = null
    this.detached = false
    this.scheduled = false
  }

  visit(entry: Entry): EvaluationRecord | null {
    if (has(entry, "evaluationError")) throw entry.evaluationError
    const existing = this.records.get(entry)
    if (existing !== void 0) return existing
    const foreign = entry.asyncEvaluation?.records.get(entry)
    if (foreign !== void 0 && entry.asyncEvaluation?.active) return foreign
    if (entry.module.loaded) return null

    const record: EvaluationRecord = {
      entry,
      evaluation: this,
      index: this.index++,
      low: this.index - 1,
      stacked: true,
      root: null,
      parents: new Set(),
      pending: 0,
      direct: entry.compileData !== null && entry.compileData.firstAwaitOutsideFunction !== null,
      async: false,
      order: -1,
      done: false,
      failed: false,
      error: void 0,
      rejectionHandlers: [],
      fulfillmentHandlers: [],
      notified: false,
      value: void 0
    }
    this.records.set(entry, record)
    entry.asyncEvaluation = this
    this.stack.push(record)
    entry.state = STATE_EXECUTION_STARTED

    const dependencies = evaluationDependencies(entry)
    for (const name in dependencies) {
      let child = this.visit(dependencies[name]!)
      if (child === null) continue
      if (child.failed) {
        this.reject(record, child.error)
        break
      }
      if (child.stacked) {
        record.low = Math.min(record.low, child.low)
      } else {
        child = child.root!
      }
      if (child.async && !child.done && !child.parents.has(record)) {
        record.pending++
        child.parents.add(record)
      }
    }

    if (record.pending !== 0 || record.direct) {
      record.async = true
      record.order = shared.moduleState.asyncEvaluationOrder!++
    }
    if (record.pending === 0 && !record.failed) this.run(record)

    if (record.low === record.index) {
      let member: EvaluationRecord
      do {
        member = this.stack.pop()!
        member.stacked = false
        member.root = record
        if (record.failed) this.reject(member, record.error)
      } while (member !== record)
    }
    return record
  }

  finalizeChildren(entry: Entry) {
    const dependencies = evaluationDependencies(entry)
    for (const name in dependencies) {
      const child = dependencies[name]!
      const record = this.records.get(child)
      if (record !== void 0 && !record.done) continue
      if (typeof child._finalize === "function") child._finalize()
      else {
        child.loaded()
        child.updateBindings(null, UPDATE_TYPE_INIT)
        validateShallow(child, entry)
      }
    }
  }

  run(record: EvaluationRecord, rejected = false, value?: unknown) {
    if (!this.active || record.failed) return
    const { entry } = record
    const previousExecuting = this.executing
    const previousEvaluation = shared.moduleState.asyncEvaluation
    shared.moduleState.asyncEvaluation = this
    this.executing = entry
    entry.running = true
    try {
      // Node may run Promise reactions inside a native event-loop turn. Check
      // before resuming user code as well as on either side of that turn.
      if (!this.detached && this.deadline !== null) checkDeadline(this.deadline)
      this.finalizeChildren(entry)
      const result = entry.runtime === null ? void 0 : entry.runtime.runResult
      if (result === void 0) {
        if (typeof entry._finalize === "function") entry._finalize()
        this.finish(record)
        return
      }
      const runner = moduleGenerator(result)
      const step = rejected ? runner.throw(value) : runner.next(value)
      if (step.done) {
        record.value = step.value
        if (record.direct) {
          // Like an async module's execution promise, completion notifies
          // importing modules in a subsequent Promise reaction.
          promiseThen(
            promiseThen(promiseResolve(), () => this.finish(record)),
            void 0,
            (error) => this.reject(record, error)
          )
        } else this.finish(record)
      } else if (isAwait(step.value)) {
        promiseThen(
          promiseResolve(step.value.value),
          (resolved) => this.run(record, false, resolved),
          (error) => this.run(record, true, error)
        )
      } else {
        throw asyncError(
          "ERR_ESM_SYNC_ASYNC_PENDING",
          "Unexpected suspension during module evaluation"
        )
      }
    } catch (error) {
      if (record.direct) promiseThen(promiseResolve(), () => this.reject(record, error))
      else this.reject(record, error)
    } finally {
      entry.running = false
      this.executing = previousExecuting
      shared.moduleState.asyncEvaluation = previousEvaluation
    }
  }

  gather(record: EvaluationRecord, ready: EvaluationRecord[]) {
    if (record.notified) return
    record.notified = true
    for (const parent of [...record.parents]) {
      if (--parent.pending === 0) {
        ready.push(parent)
        if (!parent.direct) this.gather(parent, ready)
      }
    }
  }

  finish(record: EvaluationRecord) {
    if (!this.active || record.failed || record.done) return
    const previous = shared.moduleState.asyncEvaluation
    shared.moduleState.asyncEvaluation = this
    try {
      this.complete(record)
    } finally {
      shared.moduleState.asyncEvaluation = previous
    }
  }

  complete(record: EvaluationRecord) {
    record.done = true
    const { entry } = record
    entry.state = STATE_EXECUTION_COMPLETED
    entry.module.loaded = true
    entry.loaded()
    entry.updateBindings(null, UPDATE_TYPE_INIT)
    for (const fulfill of record.fulfillmentHandlers) fulfill()
    const ready: EvaluationRecord[] = []
    this.gather(record, ready)
    ready.sort((left, right) => left.order - right.order)
    for (const parent of ready) parent.evaluation.run(parent)
    this.stopIfComplete()
  }

  reject(record: EvaluationRecord, error: unknown) {
    if (!this.active || record.failed) return
    this.rejecting++
    try {
      record.failed = true
      record.error = error
      record.entry.evaluationError = error
      record.entry.state = STATE_INITIAL
      // Notify dynamic importers before walking static ancestors: rejection
      // reactions must be enqueued in dependency-to-importer order.
      for (const reject of record.rejectionHandlers) reject(error)
      for (const parent of [...record.parents]) parent.evaluation.reject(parent, error)
      if (record.root !== null) {
        for (const member of [...this.records.values()]) {
          if (member.root === record.root && member !== record) this.reject(member, error)
        }
      }
    } finally {
      if (--this.rejecting === 0) this.stopIfComplete()
    }
  }

  stopIfComplete() {
    if (
      this.detached &&
      this.rejecting === 0 &&
      this.imports.length === 0 &&
      [...this.records.values()].every((record) => record.done || record.failed)
    ) {
      this.active = false
      for (const record of [...this.records.values()]) record.entry.asyncEvaluation = null
    }
  }

  runImports() {
    const previous = shared.moduleState.asyncEvaluation
    shared.moduleState.asyncEvaluation = this
    try {
      while (this.imports.length !== 0 && this.active) {
        const request = this.imports.shift()!
        this.importing = true
        try {
          request()
        } finally {
          this.importing = false
        }
      }
    } finally {
      shared.moduleState.asyncEvaluation = previous
    }
    this.stopIfComplete()
  }

  scheduleImports() {
    if (this.scheduled || this.imports.length === 0) return
    this.scheduled = true
    setImmediate(() => {
      this.scheduled = false
      this.runImports()
    })
  }

  wait(record: EvaluationRecord) {
    while (!record.done && !record.failed) {
      drainMicrotasks()
      if (record.done || record.failed) break
      // Runtime import() requests join this evaluation outside the Promise /
      // next-tick callback that initiated them, so no nested uv_run is needed.
      if (this.imports.length !== 0) {
        this.runImports()
        drainMicrotasks()
      }
      if (record.done || record.failed) break
      if (this.deadline === null) this.deadline = awaitDeadline()
      checkDeadline(this.deadline)
      // Resuming an await may enqueue another import without creating a
      // timer or I/O handle. Run that ready work before polling the host.
      if (this.imports.length !== 0) continue
      poll(this.deadline)
    }
    if (record.failed) throw record.error
    this.finalizeChildren(record.entry)
    return record.value
  }

  abort(error: unknown) {
    this.active = false
    this.imports.length = 0
    const failedCycles = new Set(
      [...this.records.values()].filter((record) => !record.done).map((record) => record.root)
    )
    for (const record of [...this.records.values()]) {
      if (!record.done || failedCycles.has(record.root)) {
        record.failed = true
        record.error = error
        record.entry.evaluationError = error
        record.entry.state = STATE_INITIAL
        for (const reject of record.rejectionHandlers) reject(error)
      }
      record.entry.asyncEvaluation = null
    }
    // Do not call generator.return(): that would execute user finally blocks
    // after the loader has already decided evaluation cannot complete.
  }
}

function evaluateAsyncGraph(entry: Entry): { value: unknown; pending?: boolean } | null {
  const previous = shared.moduleState.asyncEvaluation
  if (previous !== void 0 && previous !== null) {
    const existing = previous.records.get(entry)
    if (existing !== void 0 && existing.done) return { value: existing.value }
    if (existing === void 0 && !trace(entry)) return null
    if (!previous.importing || previous.executing !== null) {
      throw asyncError(
        "ERR_ESM_SYNC_ASYNC_REENTRANT",
        "Cannot synchronously re-enter an evaluating async module graph"
      )
    }
    const record = previous.visit(entry)
    if (record !== null && record.failed) throw record.error
    return { value: record?.value, pending: record !== null && !record.done }
  }
  if (!trace(entry)) return null

  const evaluation = new Evaluation()
  shared.moduleState.asyncEvaluation = evaluation
  try {
    const record = evaluation.visit(entry)!
    if (shared.moduleState.asyncImport) {
      if (record.failed) throw record.error
      return { value: record.value, pending: !record.done }
    }
    return { value: evaluation.wait(record) }
  } catch (error) {
    evaluation.abort(error)
    throw error
  } finally {
    // Unawaited import() calls retain ordinary asynchronous semantics after
    // the synchronously requested root has finished.
    if (evaluation.active) {
      evaluation.detached = true
      evaluation.scheduleImports()
      evaluation.stopIfComplete()
    }
    shared.moduleState.asyncEvaluation = previous
  }
}

function queueAsyncImport(callback: () => void) {
  const evaluation = shared.moduleState.asyncEvaluation
  if (evaluation === void 0 || evaluation === null) return false
  evaluation.imports.push(callback)
  if (evaluation.detached) evaluation.scheduleImports()
  return true
}

function observeAsyncCompletion(
  entry: Entry | null | undefined,
  fulfill: () => void,
  reject: (error: unknown) => void
) {
  const record = entry?.asyncEvaluation?.records.get(entry)
  if (record === void 0) return false
  const root = record.root || record
  if (record.failed || root.failed) {
    reject(record.failed ? record.error : root.error)
  } else {
    record.rejectionHandlers.push(reject)
    if (root.done) fulfill()
    else root.fulfillmentHandlers.push(fulfill)
  }
  return true
}

function isAsyncEvaluating(entry: Entry, includeCycle = false) {
  const record = entry.asyncEvaluation?.records.get(entry)
  return (
    record !== void 0 &&
    !record.failed &&
    (!record.done ||
      (includeCycle && record.root !== null && !record.root.done && !record.root.failed))
  )
}

export {
  Evaluation,
  evaluateAsyncGraph,
  isAsyncEvaluating,
  observeAsyncCompletion,
  queueAsyncImport
}
