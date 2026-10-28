// Capability probes and case workers must use exactly the same engine flags.
const test262NodeFlags = [
  "--harmony",
  "--experimental-vm-modules",
  "--disable-warning=ExperimentalWarning"
]

export = test262NodeFlags
