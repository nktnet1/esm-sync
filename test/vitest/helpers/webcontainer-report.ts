import { hostWebContainerSdk } from "../../../script/src/esm/host-runtimes.ts"

// Fabricated unit-test reports, never evidence of a live WebContainer run.
export function successfulWebContainerReport(nonce: string, loaderSHA256: string) {
  const artifacts: Record<string, string> = {}
  const samples = ["disabled", "cold", "warm"].map((phase) => {
    const identity = {
      phase,
      nonce: nonce + "-" + phase,
      loader: "/home/fixture/node_modules/esm/dist/esm.js"
    }
    artifacts[phase + ".json"] = JSON.stringify({
      ...identity,
      scope: "actual-webcontainer",
      passed: true,
      sharedRealm: true,
      imports: 2,
      rejections: 3,
      globals: ["Object", "Function", "Array", "Error", "Promise", "Reflect", "Symbol", "JSON"],
      errors: [],
      versions: { node: "22.22.3" }
    })
    return {
      ...identity,
      scope: "actual-webcontainer",
      passed: true,
      applicationEvidence: [
        {
          nonce: identity.nonce,
          loader: identity.loader,
          factories: 1,
          globalsPreserved: true,
          exitCode: 0
        }
      ]
    }
  })
  const worker = { passed: true, scope: "actual-webcontainer-application", loaderSHA256, samples }
  artifacts["report.json"] = JSON.stringify(worker)
  return {
    issue: 917,
    nonce,
    loaderSHA256,
    scope: "actual-webcontainer-application",
    reproduction: "reconstructed-consumer",
    sdkVersion: "1.6.4",
    sdkSHA256: hostWebContainerSdk.sha256,
    browserVersion: "Chromium unit fixture",
    crossOriginIsolated: true,
    booted: true,
    blocked: false,
    passed: true,
    code: 0,
    worker,
    artifacts
  }
}
