"use strict"

import { defineConfig } from "@rspack/cli"
import fs from "fs-extra"
import path from "path"
import { rspack } from "@rspack/core"

const { BannerPlugin, EnvironmentPlugin, NormalModuleReplacementPlugin } = rspack

import { BundleAnalyzerPlugin } from "webpack-bundle-analyzer"
import TerserPlugin from "terser-webpack-plugin"
import UnusedPlugin from "unused-webpack-plugin"

const { ESM_ENV } = process.env
const isProd = /production/.test(ESM_ENV ?? "")
const isTest = /test/.test(ESM_ENV ?? "")

import packageInfo from "../package.json"
const { files: PACKAGE_FILENAMES, version: PACKAGE_VERSION } = packageInfo

const externals = [
  "Array",
  "Buffer",
  "Error",
  "EvalError",
  "Function",
  "JSON",
  "Object",
  "Promise",
  "RangeError",
  "ReferenceError",
  "Reflect",
  "SyntaxError",
  "TypeError",
  "URIError",
  "eval"
]

const hosted = ["console"]

import babelOptions from "./babel-config.js"
const terserOptions = fs.readJSONSync("./.terserrc") as import("terser").MinifyOptions

const config = defineConfig({
  devtool: false,
  entry: {
    esm: "./src/index.ts"
  },
  mode: isProd ? "production" : "development",
  module: {
    rules: [
      { loader: "babel-loader", options: babelOptions, test: /\.js$/, type: "javascript/auto" },
      {
        use: [
          { loader: "babel-loader", options: babelOptions },
          {
            loader: "builtin:swc-loader",
            options: { jsc: { parser: { syntax: "typescript" }, target: "esnext" } }
          }
        ],
        test: /\.ts$/,
        type: "javascript/auto"
      }
    ]
  },
  resolve: { extensionAlias: { ".js": [".ts", ".js"] } },
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
          externals.map((name) => name + ": global." + name).join(", ") +
          " };",
        "const " + hosted.map((name) => name + " = global." + name).join(", ") + ";\n"
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
    new rspack.DefinePlugin({
      __ESM_PACKAGE_FILENAMES__: JSON.stringify(PACKAGE_FILENAMES),
      __ESM_PACKAGE_VERSION__: JSON.stringify(PACKAGE_VERSION)
    }),
    new EnvironmentPlugin({ ESM_SYNC_TEST_BUILD: isTest }),
    new NormalModuleReplacementPlugin(
      /acorn[\\/]src[\\/]regexp\.js/,
      path.resolve("src/acorn/replacement/regexp.ts")
    ),
    new UnusedPlugin({
      directories: [path.resolve("src")],
      exclude: [".*", "*.json", "**/vendor/*", "**/types/*"],
      root: path.resolve(__dirname, "..")
    })
  ],
  stats: isTest ? "summary" : "normal",
  target: "node"
})

if (isProd) {
  config.plugins!.push(new EnvironmentPlugin({ NODE_DEBUG: false }))
}

if (isTest) {
  Object.assign(config.entry!, {
    compiler: "./src/compiler.ts",
    entry: "./src/entry.ts",
    "resolve-exports": "./src/module/internal/resolve-exports.ts",
    "get-file-path-from-url": "./src/util/get-file-path-from-url.ts",
    "get-url-from-file-path": "./src/util/get-url-from-file-path.ts",
    runtime: "./src/runtime.ts"
  })
}

export = config
