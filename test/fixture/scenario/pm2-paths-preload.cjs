"use strict"

if (process.env.ESM_SYNC_TEST_PM2_ENDPOINTS === "true") {
  // PM2 7 overwrites its environment-configured endpoints with global pipe
  // names on Windows. Apply our private endpoints after that initialization,
  // in the CLI, daemon, and applications. All still use real PM2 IPC.
  for (const configuration of [
    require("pm2/constants.js"),
    require("pm2/modules/pm2-io-agent/constants.js")
  ]) {
    for (const key of ["DAEMON_RPC_PORT", "DAEMON_PUB_PORT", "INTERACTOR_RPC_PORT"]) {
      const endpoint = process.env[`PM2_${key}`]
      if (endpoint) configuration[key] = endpoint
    }
  }
}
