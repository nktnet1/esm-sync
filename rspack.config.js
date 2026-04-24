/* eslint strict: off, node/no-unsupported-features: ["error", { version: 6 }] */
"use strict"

const { defineConfig } = require("@rspack/cli")
const fs = require("fs-extra")
const path = require("path")
const { rspack } = require("@rspack/core")

const {
  BannerPlugin,
  EnvironmentPlugin,
  NormalModuleReplacementPlugin
} = rspack

const { BundleAnalyzerPlugin } = require("webpack-bundle-analyzer")
const TerserPlugin = require("terser-webpack-plugin")
const UnusedPlugin = require("unused-webpack-plugin")

const { ESM_ENV } = process.env
const isProd = /production/.test(ESM_ENV)
const isTest = /test/.test(ESM_ENV)

const {
  files: PACKAGE_FILENAMES,
  version: PACKAGE_VERSION
} = fs.readJSONSync("./package.json")

const externals = [
  "Array", "Buffer", "Error", "EvalError", "Function", "JSON", "Object",
  "Promise", "RangeError", "ReferenceError", "Reflect", "SyntaxError",
  "TypeError", "URIError", "eval"
]

const hosted = [
  "console"
]

const babelOptions = require("./.babel.config.js")
const terserOptions = fs.readJSONSync("./.terserrc")

const config = defineConfig({
  devtool: false,
  entry: {
    esm: "./src/index.js"
  },
  mode: isProd ? "production" : "development",
  module: {
    rules: [
      {
        loader: "babel-loader",
        options: babelOptions,
        test: /\.js$/,
        type: "javascript/auto"
      }
    ]
  },
  node: false,
  optimization: {
    concatenateModules: false,
    mangleExports: false,
    minimizer: [
      new TerserPlugin({
        extractComments: false,
        terserOptions
      })
    ],
    nodeEnv: false,
    providedExports: false,
    sideEffects: false,
    usedExports: false
  },
  output: {
    clean: true,
    filename: "[name].js",
    library: {
      export: "default",
      type: "commonjs-module"
    },
    module: false,
    path: path.resolve("build"),
    pathinfo: false
  },
  plugins: [
    new BannerPlugin({
      banner: [
        "var __shared__;",
        "const __non_webpack_module__ = module;",
        "const __external__ = { " +
          externals
            .map((name) => name + ": global." + name)
            .join(", ") +
        " };",
        "const " +
          hosted
            .map((name) => name + " = global." + name)
            .join(", ") +
        ";\n"
      ].join("\n"),
      entryOnly: true,
      raw: true
    }),
    new BundleAnalyzerPlugin({
      analyzerMode: "static",
      defaultSizes: "gzip",
      logLevel: "silent",
      openAnalyzer: false,
      reportFilename: "report.html"
    }),
    new EnvironmentPlugin({
      PACKAGE_FILENAMES,
      PACKAGE_VERSION
    }),
    new NormalModuleReplacementPlugin(
      /acorn[\\/]src[\\/]regexp\.js/,
      path.resolve("src/acorn/replacement/regexp.js")
    ),
    new UnusedPlugin({
      directories: [path.resolve("src")],
      exclude: [
        ".*",
        "*.json",
        "**/vendor/*"
      ],
      root: __dirname
    })
  ],
  stats: isTest ? "summary" : "normal",
  target: "node"
})

if (isProd) {
  config.plugins.push(
    new EnvironmentPlugin({ NODE_DEBUG: false })
  )
}

if (isTest) {
  Object.assign(config.entry, {
    compiler: "./src/compiler.js",
    entry: "./src/entry.js",
    "get-file-path-from-url": "./src/util/get-file-path-from-url.js",
    "get-url-from-file-path": "./src/util/get-url-from-file-path.js",
    runtime: "./src/runtime.js"
  })
}

module.exports = config
