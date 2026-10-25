import path from "node:path"
import ts from "typescript"

// Strict mode cannot catch every inferred any, such as new Map() or JSON.parse().
// Check owned declarations and collection arguments without traversing vendor APIs.
export function checkTypeSafety(program: ts.Program, root: string): void {
  const checker = program.getTypeChecker()
  const failures: string[] = []
  function containsAny(type: ts.Type, seen = new Set<ts.Type>()): boolean {
    if (seen.has(type)) return false
    seen.add(type)
    if (type.flags & ts.TypeFlags.Any) return true
    if (type.isUnionOrIntersection()) return type.types.some((part) => containsAny(part, seen))
    if (
      type.flags & ts.TypeFlags.Object &&
      (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
    ) {
      return checker
        .getTypeArguments(type as ts.TypeReference)
        .some((part) => containsAny(part, seen))
    }
    return false
  }
  for (const file of program.getSourceFiles()) {
    const relative = path.relative(root, file.fileName)
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      /(?:^|[/\\])(?:node_modules|vendor)(?:[/\\])/.test(relative)
    )
      continue
    function fail(node: ts.Node): void {
      const position = file.getLineAndCharacterOfPosition(node.getStart(file))
      failures.push(`${relative}:${position.line + 1}:${position.character + 1}: unchecked any`)
    }
    function visit(node: ts.Node): void {
      if (node.kind === ts.SyntaxKind.AnyKeyword) fail(node)
      if (!file.isDeclarationFile) {
        if (
          (ts.isParameter(node) ||
            ts.isVariableDeclaration(node) ||
            ts.isPropertyDeclaration(node) ||
            ts.isBindingElement(node)) &&
          ts.isIdentifier(node.name) &&
          containsAny(checker.getTypeAtLocation(node.name))
        )
          fail(node)
        if (ts.isFunctionLike(node) && "body" in node && node.body) {
          const signature = checker.getSignatureFromDeclaration(node)
          if (signature && containsAny(checker.getReturnTypeOfSignature(signature))) fail(node)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  if (failures.length) throw new Error(`Type safety check failed:\n${failures.join("\n")}`)
}
