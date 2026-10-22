import { log } from "console"

// Let PM2 stop the fixture after it has verified the startup IPC exchange.
process.channel.ref()
process.send("ready", (error) => {
  if (error) {
    throw error
  }
  log("pm2:true")
})
