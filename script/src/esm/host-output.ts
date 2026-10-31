import { styleText } from "node:util"

export function hostColorsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== "0"
  return env.NO_COLOR === undefined && env.TERM !== "dumb"
}

export function hostLabel(format: Parameters<typeof styleText>[0], text: string): string {
  return hostColorsEnabled() ? styleText(format, text, { validateStream: false }) : text
}

export function hostSection(
  index: number,
  total: number,
  text: string,
  kind: "Step" | "Issue" = "Step"
): void {
  console.log(`\n${hostLabel("cyan", `[${kind} ${index}/${total}]`)} ${text}\n`)
}

export function hostCaseLine(
  index: number,
  total: number,
  status: "RUN" | "PASS" | "FAIL" | "SKIP",
  issue: number,
  phase: string,
  detail: string
): void {
  const color =
    status === "PASS" ? "green" : status === "FAIL" ? "red" : status === "SKIP" ? "yellow" : "cyan"
  console.log(
    `  [${index}/${total}] ${hostLabel(color, status.padEnd(4))}  #${issue}  ${phase.padEnd(8)}  ${detail}`
  )
}
