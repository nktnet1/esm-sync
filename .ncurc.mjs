const minorOnlyPackages = new Set([
  "@babel/core",
  "@babel/helper-plugin-utils",
  "@babel/plugin-transform-arrow-functions",
  "@babel/plugin-transform-block-scoping",
  "@babel/plugin-transform-flow-strip-types",
  "@babel/plugin-transform-runtime",
  "@babel/preset-env",
  "@babel/register",
  "@babel/runtime",
  "ava",
  "core-js",
  "eslint",
  "execa",
  "globby",
  "jest",
  "mocha",
  "newrelic",
  "strip-ansi",
  "trash",
  "typescript",
  "webpack",
  "webpack-cli",
])

/** @type {import("npm-check-updates").Options} */
export default {
  target: (packageName) =>
    minorOnlyPackages.has(packageName) ? "minor" : "latest",
};
