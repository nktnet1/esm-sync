export let counter = await new Promise((resolve) => setImmediate(() => resolve(41)))

export function increment() {
  return ++counter
}

export async function later() {
  return 42
}
