// Match the conformance subprocess to the build selected by its caller.
// Standalone pnpm test:conformance continues to use development by default.
function test262CaseEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const mode = base.NODE_ENV === "production" ? "production" : "development"
  // Keep colourised Test262 reporting separate from machine-readable case output.
  const env = { ...base }
  delete env.FORCE_COLOR
  delete env.CLICOLOR_FORCE
  return {
    ...env,
    NODE_ENV: mode,
    ESM_ENV: `${mode}-test`,
    // The case itself still uses its declared Script/Module goal.
    ESM_OPTIONS: "{cjs:false,cache:false,mode:'all'}"
  }
}

export = test262CaseEnvironment
