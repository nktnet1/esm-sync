import { hostUsbNativePatch } from "../../../script/src/esm/host-runtimes.ts"

// Fabricated reports for validator tests only. These are not live host evidence.
export function successfulUsbNativeEvidence(phase: string) {
  return {
    scope: "patched-usb-1.6.0",
    patchSHA256: String(hostUsbNativePatch.sha256),
    queue: {
      phase,
      passed: true,
      survived: true,
      callbacks: 16,
      code: 0,
      versions: { modules: "70" }
    },
    baselines: ["published", "unpatched"].map((source) => ({
      source,
      mode: "require",
      binary: "mismatch",
      passed: false,
      code: null,
      signal: "SIGSEGV",
      timedOut: false,
      verified: true,
      traceCaptured: true,
      report: {
        phase,
        versions: { modules: "70" },
        rejections: ["NODE_MODULE_VERSION 64 requires NODE_MODULE_VERSION 70"]
      }
    }))
  }
}
