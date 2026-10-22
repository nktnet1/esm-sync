import { log } from "console"

class Console {
  static log = log
}

// Let PM2 stop the fixture after it has verified the startup IPC exchange.
process.channel.ref()
process.send("ready", (error) => {
  if (error) {
    throw error
  }
  Console.log("pm2-babel:true")
})
