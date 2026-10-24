import type { AcornParser } from "../../types/acorn.js"
import shared from "../../shared.js"
import { tokTypes as tt } from "../../acorn.js"

function init() {
  const Plugin = {
    enable(parser: AcornParser) {
      parser.parseLiteral = parseLiteral
      parser.parseTemplateElement = parseTemplateElement

      return parser
    }
  }

  const parseLiteral: AcornParser["parseLiteral"] = function (this: AcornParser, value) {
    const node = this.startNode()

    node.raw = ""
    node.value = value

    this.next()

    return this.finishNode(node, "Literal")
  }

  const parseTemplateElement: AcornParser["parseTemplateElement"] = function (this: AcornParser) {
    const node = this.startNode()

    node.value = {
      cooked: "",
      raw: ""
    }

    this.next()

    node.tail = this.type === tt.backQuote

    return this.finishNode(node, "TemplateElement")
  }

  return Plugin
}

export default shared.inited
  ? shared.module.acornParserLiteral
  : (shared.module.acornParserLiteral = init())

export type CachedModule = ReturnType<typeof init>
