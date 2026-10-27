"use strict"

let count = 0
module.exports = class HostType {
  constructor() {
    this.number = ++count
  }
}
