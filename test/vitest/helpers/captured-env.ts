/**
 * Fixture output is checked byte-for-byte. The verification driver's colour
 * settings are for its own diagnostics, not for the Node processes under test.
 * Tests that intentionally exercise coloured output can explicitly override
 * FORCE_COLOR or CLICOLOR_FORCE.
 */
export function capturedOutputEnv(
  inherited: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const env = { ...inherited }
  delete env.FORCE_COLOR
  delete env.CLICOLOR_FORCE
  return { ...env, ...overrides }
}
