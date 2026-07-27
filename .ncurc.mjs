/** @type {import("npm-check-updates").Options} */
export default {
  reject: [
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
  ],

  filterResults: (
    _packageName,
    { currentVersionSemver, upgradedVersionSemver },
  ) => {
    const currentMajor = currentVersionSemver[0]?.major;
    const upgradedMajor = upgradedVersionSemver?.major;
    return currentMajor >= upgradedMajor;
  },
};
