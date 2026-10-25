declare module "semver" {
  const semver: {
    gte: typeof gte
    satisfies: typeof satisfies
    validRange: typeof validRange
    maxSatisfying: typeof maxSatisfying
  }
  export default semver
  export function gte(version: string, other: string): boolean
  export function lt(version: string, other: string): boolean
  export function satisfies(
    version: string,
    range: string,
    options?: { loose?: boolean; includePrerelease?: boolean }
  ): boolean
  export function maxSatisfying(versions: readonly string[], range: string): string | null
  export function validRange(range: unknown): string | null
}
