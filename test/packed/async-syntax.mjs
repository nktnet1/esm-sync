export let value = 0

await using resource = {
  async [Symbol.asyncDispose]() {
    await new Promise((resolve) => setImmediate(resolve))
    value++
  }
}

for await (const item of [Promise.resolve(20), 21]) {
  value += item
}

export { resource }
