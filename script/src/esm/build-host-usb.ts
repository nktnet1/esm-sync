import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { extractHostPackage } from "./host-archives.ts"
import {
  hostAddonHeaders,
  hostPackages,
  hostUsbMismatchHeaders,
  hostUsbNativePatch
} from "./host-runtimes.ts"

import { patchHostUsb } from "./patch-host-usb.ts"

const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."))
const hostPackageCache = path.join(root, ".cache/host-packages")

function buildHostUsb(): void {
  mkdirSync(hostPackageCache, { recursive: true })
  const cache = realpathSync(hostPackageCache)
  const usb = extractHostPackage(hostPackages.usb)
  const nan = extractHostPackage(hostPackages.nan)
  const headers = path.join(extractHostPackage(hostAddonHeaders), "include/node")
  assert.match(
    readFileSync(path.join(headers, "node_version.h"), "utf8"),
    /#define NODE_MODULE_VERSION\s+70\b/
  )
  const mismatchHeaders = path.join(extractHostPackage(hostUsbMismatchHeaders), "include/node")
  assert.match(
    readFileSync(path.join(mismatchHeaders, "node_version.h"), "utf8"),
    /#define NODE_MODULE_VERSION\s+64\b/
  )
  console.log(
    "BUILD #817 USB: apply native queue fix; compile ABIs 64 and 70; retain both original negative controls"
  )
  for (const [name, source] of [
    ["node_modules/bindings", extractHostPackage(hostPackages.bindings)],
    ["node_modules/file-uri-to-path", extractHostPackage(hostPackages.fileUri)],
    ["usb-published/node_modules/usb", usb],
    ["usb-unpatched/node_modules/usb", usb],
    ["usb-mismatch/node_modules/usb", usb],
    ["usb-compatible/node_modules/usb", usb]
  ] as const) {
    if (name.startsWith("usb-"))
      rmSync(path.join(cache, name.split("/")[0]!), { recursive: true, force: true })
    cpSync(source, path.join(cache, name), { recursive: true })
  }
  for (const name of ["usb-mismatch", "usb-compatible"])
    patchHostUsb(path.join(cache, name, "node_modules/usb"))

  const mismatch = path.join(
    cache,
    "usb-published/node_modules/usb/build/Release/usb_bindings.node"
  )
  mkdirSync(path.dirname(mismatch), { recursive: true })
  cpSync(
    path.join(extractHostPackage(hostPackages.usbBinary, 0), "build/Release/usb_bindings.node"),
    mismatch
  )
  let project = realpathSync(path.join(cache, "usb-compatible/node_modules/usb"))
  const build = path.join(project, "build/Release")
  mkdirSync(build, { recursive: true })
  const commands: string[][] = []
  function compile(executable: string, args: string[]): void {
    commands.push([executable, ...args])
    const result = spawnSync(executable, args, { cwd: project, encoding: "utf8" })
    assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  }
  // Same bundled libusb source list and defines as usb@1.6.0's libusb.gypi,
  // selecting its supported Linux netlink backend (use_udev=0).
  const cSources = [
    "core",
    "descriptor",
    "hotplug",
    "io",
    "strerror",
    "sync",
    "os/poll_posix",
    "os/threads_posix",
    "os/linux_usbfs",
    "os/linux_netlink"
  ]
  const includes = ["libusb_config", "libusb/libusb", "libusb/libusb/os"].flatMap((name) => [
    "-I",
    path.join(project, name)
  ])
  const defines = [
    "ENABLE_LOGGING=1",
    "DEFAULT_VISIBILITY=",
    "HAVE_GETTIMEOFDAY=1",
    "HAVE_POLL_H=1",
    "HAVE_SYS_TIME_H=1",
    'LIBUSB_DESCRIBE="1.0.17"',
    "POLL_NFDS_TYPE=nfds_t",
    "THREADS_POSIX=1",
    "OS_LINUX=1",
    "_GNU_SOURCE=1",
    "USBI_TIMERFD_AVAILABLE=1",
    "HAVE_LINUX_NETLINK_H"
  ].map((value) => "-D" + value)
  const objects = cSources.map((name, index) => {
    const output = path.join(build, `libusb-${index}.o`)
    compile("gcc", [
      "-c",
      "-fPIC",
      "-pthread",
      "-O2",
      ...includes,
      ...defines,
      `libusb/libusb/${name}.c`,
      "-o",
      output
    ])
    return output
  })
  const outputs = [{ name: "usb-published", abi: 64, patched: false, file: mismatch }]
  for (const [name, abi, patched] of [
    ["usb-unpatched", 64, false],
    ["usb-mismatch", 64, true],
    ["usb-compatible", 70, true]
  ] as const) {
    project = realpathSync(path.join(cache, name, "node_modules/usb"))
    const file = path.join(project, "build/Release/usb_bindings.node")
    mkdirSync(path.dirname(file), { recursive: true })
    compile("g++", [
      "-shared",
      "-fPIC",
      "-pthread",
      "-std=c++14",
      "-O2",
      "-g",
      "-DBUILDING_NODE_EXTENSION",
      "-DNODE_GYP_MODULE_NAME=usb_bindings",
      "-D_FILE_OFFSET_BITS=64",
      "-D_LARGEFILE_SOURCE",
      "-I",
      abi === 70 ? headers : mismatchHeaders,
      "-I",
      nan,
      "-I",
      "src",
      "-I",
      "libusb/libusb",
      "src/node_usb.cc",
      "src/device.cc",
      "src/transfer.cc",
      ...objects,
      "-o",
      file
    ])
    outputs.push({ name, abi, patched, file })
  }
  const queueProbe = path.join(cache, "queue-probe.node")
  compile("g++", [
    "-shared",
    "-fPIC",
    "-pthread",
    "-std=c++14",
    "-O2",
    "-g",
    "-DBUILDING_NODE_EXTENSION",
    "-DNODE_GYP_MODULE_NAME=queue_probe",
    "-I",
    headers,
    "-I",
    nan,
    "-I",
    path.join(project, "src"),
    path.join(root, "test/fixture/hosts/issue-817/queue-probe.cc"),
    "-o",
    queueProbe
  ])
  const crashTrace = path.join(cache, "native-crash-trace.so")
  compile("gcc", [
    "-shared",
    "-fPIC",
    "-g",
    path.join(root, "test/fixture/hosts/issue-817/native-crash-trace.c"),
    "-o",
    crashTrace
  ])
  const provenance = (file: string) => ({
    file,
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex")
  })
  writeFileSync(
    path.join(cache, "builds.json"),
    JSON.stringify(
      {
        schema: 2,
        nativePatch: hostUsbNativePatch,
        mismatchHeaders: hostUsbMismatchHeaders,
        compatibleHeaders: hostAddonHeaders,
        queueProbe: provenance(queueProbe),
        crashTrace: provenance(crashTrace),
        packages: hostPackages,
        compiler: spawnSync("g++", ["--version"], { encoding: "utf8" }).stdout,
        commands,
        outputs: outputs.map((item) => ({ ...item, ...provenance(item.file) }))
      },
      null,
      2
    )
  )
  console.log(
    "READY #817 USB: native-patched ABIs 64/70 and queue probe built; published and unpatched ABI-64 originals retained"
  )
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
)
  buildHostUsb()
