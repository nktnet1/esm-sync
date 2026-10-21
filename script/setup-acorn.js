"use strict"

const fs = require("fs")
const fsp = require("fs/promises")
const path = require("path")
const AdmZip = require("adm-zip")

const rootPath = path.resolve(__dirname, "..")
const vendorPath = path.resolve(rootPath, "src/vendor")

const acornPath = path.resolve(vendorPath, "acorn")
const acornPackagePath = path.resolve(acornPath, "acorn/package.json")
const acornSourcePath = path.resolve(acornPath, "acorn/src/state.js")
const acornPkg = require("acorn/package.json")
const acornURL = "https://github.com/ternjs/acorn/archive/" + acornPkg.version + ".zip"

const extractFilterRegExp = /^acorn[\\/].*?\.(?:js|json)$/

function isPrepared() {
  if (!fs.existsSync(acornPackagePath) || !fs.existsSync(acornSourcePath)) {
    return false
  }

  try {
    return JSON.parse(fs.readFileSync(acornPackagePath, "utf8")).version === acornPkg.version
  } catch {
    return false
  }
}

async function setupAcorn() {
  if (isPrepared()) {
    console.log(`[acorn] version ${acornPkg.version} is already prepared.`)
    return
  }

  console.log("[acorn] downloading:", acornURL)

  const res = await fetch(acornURL)
  if (!res.ok) {
    throw new Error(`[acorn] download failed: ${res.status} ${res.statusText}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  console.log("[acorn] zip size:", buffer.length)

  await fsp.rm(acornPath, { force: true, recursive: true })
  await fsp.mkdir(acornPath, { recursive: true })

  const zip = new AdmZip(buffer)
  const entries = zip.getEntries()

  console.log("[acorn] entries:", entries.length)

  for (const entry of entries) {
    if (entry.isDirectory) {
      continue
    }

    const filePath = entry.entryName
    if (filePath.includes("..")) {
      continue
    }

    const strippedPath = filePath.split(/[\\/]/).slice(1).join("/")

    if (!extractFilterRegExp.test(strippedPath)) {
      continue
    }

    const destPath = path.join(acornPath, strippedPath)

    await fsp.mkdir(path.dirname(destPath), { recursive: true })
    await fsp.writeFile(destPath, entry.getData())
  }

  console.log("[acorn] setup complete.")
}

module.exports = setupAcorn
