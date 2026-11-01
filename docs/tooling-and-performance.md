# Application and performance verification

Build the actual release artifact before comparing startup workloads:

```sh
pnpm fixtures:prepare
pnpm build:prod
pnpm benchmark:startup --modules=256 --iterations=7 --json
pnpm benchmark:startup --await --json
pnpm benchmark:await --samples=7 --iterations=5000 --json
```

`verify:all` runs these self-contained workloads on Node 22/24/26 after release
builds. Performance tools check workload correctness and cache identity without
fragile timing thresholds. Results describe the measured machine, runtime,
build, and workload; they are not universal latency or memory guarantees.

`benchmark:startup` accepts `--entry`, `--cwd`, `--loader`, and repeated
`--node-arg` flags for a terminating installed application. Arguments after `--`
go to that application. Native runs are a baseline, not a cold/warm compiler
cache comparison. `benchmark:await --baseline=/path/to/built-checkout` compares
synchronous/async graphs and reports unsupported await contexts explicitly.

## Original Log4brains application

The historical Log4brains CLI must already be built and installed, including
`packages/global-cli/dist/index.js` and its original `esm` dependency. The
verifier does not install dependencies or substitute a synthetic application.

```sh
pnpm benchmark:log4brains --project=/path/to/log4brains --workload=version --iterations=10 --json
pnpm benchmark:log4brains --project=/path/to/log4brains --workload=preview --iterations=10 --json
```

`--node=/path/to/node` selects the application runtime; `--baseline` selects a
built baseline loader, otherwise the application's original `esm` is used.
The unchanged CLI calls its own loader factory. Each side receives private
bootstrap/compiler caches, loader order alternates, and cold/warm state and
output identity are checked. CLI `--version` measures terminating startup;
`preview` measures spawn through the complete HTTP 200 response on the child's
own ephemeral port. It also records resource use and artifact hashes.

Keep `--profile-dir=/path/to/profiles` runs separate from timing trials. Do not
run builds or other tests alongside controlled measurements, or infer server
readiness from `--version`.

## Babel aliases and top-level await

The original [Babel reproduction](https://github.com/ndabAP/esm-babel-plugin-module-resolver-issue)
must already have its dependencies installed:

```sh
pnpm verify:babel-repro --project=/path/to/babel-repro --node=/path/to/node --json
```

The verifier copies its original source and configuration byte-for-byte into
private workspaces and shares installed dependencies. It checks the real
two-second database timer, single evaluation, completion before `listen()`, and
the expected HTTP response. Physical loader entries and both preload orders
run with disabled/cold/warm bootstrap, compiler, and Babel caches. Timer awaits
require a runtime with a matching native bridge; Node 20 is outside that bridge's
supported range.

To include both original applications in one complete run, supply
`--babel-project` and `--log4brains-project` to `verify:all`, with local development
dependencies, a native build toolchain, and the original applications installed.
The driver prepares Acorn and builds the host release automatically. Without those paths it
runs repository integrations and synthetic workloads, not the original apps.
