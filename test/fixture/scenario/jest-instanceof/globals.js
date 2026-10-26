"use strict"

exports.read = function () {
  return {
    DOMException,
    performance,
    crypto,
    navigator
  }
}

exports.createError = function () {
  return new DOMException("Cancelled", "AbortError")
}

exports.readHidden = function () {
  return ESM_SYNC_HIDDEN_GLOBAL
}

exports.readLazy = function () {
  return ESM_SYNC_LAZY_GLOBAL
}

exports.hiddenDescriptor = function () {
  return Object.getOwnPropertyDescriptor(global, "ESM_SYNC_HIDDEN_GLOBAL")
}
