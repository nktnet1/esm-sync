import fs from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"

function listen(address: string | net.ListenOptions): Promise<net.Server> {
  return new Promise<net.Server>((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(address, () => {
      server.removeListener("error", reject)
      resolve(server)
    })
  })
}

function close(server: net.Server): Promise<void> {
  return new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
}

// Use real PM2 daemons and applications even on hosts that permit loopback TCP
// but prohibit Unix-domain sockets. Never connect to a developer's PM2 home.
export default async function pm2Environment() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "esm-sync-pm2-"))
  const env: NodeJS.ProcessEnv = { PM2_HOME: home, ESM_SYNC_TEST_PM2_ENDPOINTS: "true" }
  try {
    if (process.platform === "win32") {
      // PM2 7 otherwise uses the same global pipe names for every PM2_HOME.
      const token = path.basename(home)
      env.PM2_DAEMON_RPC_PORT = `\\\\.\\pipe\\${token}-rpc`
      env.PM2_DAEMON_PUB_PORT = `\\\\.\\pipe\\${token}-pub`
      env.PM2_INTERACTOR_RPC_PORT = `\\\\.\\pipe\\${token}-interactor`
    } else {
      try {
        await close(await listen(path.join(home, "probe.sock")))
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== "EPERM" && code !== "EACCES") throw error
        const servers: net.Server[] = []
        try {
          // Hold all three reservations together so the OS cannot hand out the
          // same port twice. Axon accepts tcp:// URLs as well as socket paths.
          for (const key of [
            "PM2_DAEMON_RPC_PORT",
            "PM2_DAEMON_PUB_PORT",
            "PM2_INTERACTOR_RPC_PORT"
          ]) {
            const server = await listen({ port: 0, host: "127.0.0.1" })
            servers.push(server)
            const address = server.address()
            if (address === null || typeof address === "string")
              throw new Error("Missing PM2 probe address")
            env[key] = `tcp://127.0.0.1:${address.port}`
          }
        } finally {
          await Promise.all(servers.map(close))
        }
      }
    }
    return { env, home, logs: path.join(home, "logs") }
  } catch (error) {
    await fs.rm(home, { recursive: true, force: true })
    throw error
  }
}
