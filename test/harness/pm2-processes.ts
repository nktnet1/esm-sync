import assert from "node:assert/strict"

interface ProcessInfo {
  name: string
  pid: number
  pm2_env: {
    status?: unknown
    node_version?: unknown
    listen_timeout?: unknown
    restart_time?: unknown
    exit_code?: unknown
  }
}

export function parsePM2Processes(source: string): ProcessInfo[] {
  const value: unknown = JSON.parse(source)
  assert.ok(Array.isArray(value), "Expected a PM2 process list")
  return (value as unknown[]).map((entry) => {
    assert.ok(entry !== null && typeof entry === "object")
    assert.ok("name" in entry && typeof entry.name === "string")
    assert.ok("pid" in entry && typeof entry.pid === "number")
    assert.ok("pm2_env" in entry && entry.pm2_env !== null && typeof entry.pm2_env === "object")
    return entry as ProcessInfo
  })
}
