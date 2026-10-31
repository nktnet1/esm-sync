import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { extractHostPackage } from "./host-archives.ts"
import { hostAddonHeaders, hostPackages } from "./host-runtimes.ts"

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
  for (const [name, source] of [
    ["node_modules/bindings", extractHostPackage(hostPackages.bindings)],
    ["node_modules/file-uri-to-path", extractHostPackage(hostPackages.fileUri)],
    ["usb-mismatch/node_modules/usb", usb],
    ["usb-compatible/node_modules/usb", usb]
  ] as const)
    cpSync(source, path.join(cache, name), { recursive: true })

  const mismatch = path.join(cache, "usb-mismatch/node_modules/usb/build/Release/usb_bindings.node")
  mkdirSync(path.dirname(mismatch), { recursive: true })
  cpSync(
    path.join(extractHostPackage(hostPackages.usbBinary, 0), "build/Release/usb_bindings.node"),
    mismatch
  )
  const project = realpathSync(path.join(cache, "usb-compatible/node_modules/usb"))
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
  const compatible = path.join(build, "usb_bindings.node")
  compile("g++", [
    "-shared",
    "-fPIC",
    "-pthread",
    "-std=c++14",
    "-O2",
    "-DBUILDING_NODE_EXTENSION",
    "-DNODE_GYP_MODULE_NAME=usb_bindings",
    "-D_FILE_OFFSET_BITS=64",
    "-D_LARGEFILE_SOURCE",
    "-I",
    headers,
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
    compatible
  ])
  const outputs = [
    { name: "usb-mismatch", abi: 64, file: mismatch },
    { name: "usb-compatible", abi: 70, file: compatible }
  ].map((item) => ({
    ...item,
    sha256: createHash("sha256").update(readFileSync(item.file)).digest("hex")
  }))
  writeFileSync(
    path.join(cache, "builds.json"),
    JSON.stringify(
      {
        packages: hostPackages,
        compiler: spawnSync("g++", ["--version"], { encoding: "utf8" }).stdout,
        commands,
        outputs
      },
      null,
      2
    )
  )
  console.log("USB 1.6.0: published ABI 64 binary + rebuilt ABI 70 control")
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
)
  buildHostUsb()
