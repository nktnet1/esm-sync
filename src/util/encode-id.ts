import CHAR from "../constant/char.js"

const { ZERO_WIDTH_JOINER } = CHAR

function encodeId(id: string) {
  return id + ZERO_WIDTH_JOINER
}

export default encodeId
