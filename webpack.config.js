const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const webpack = require("webpack");

module.exports = (env, argv) => {
  const isDevelopment = argv.mode === "development";

  return {
    entry: "./src/main.ts",
    output: {
      filename: "main.js",
      path: path.resolve(__dirname, "."),
      libraryTarget: "commonjs",
    },
    target: "web",
    mode: isDevelopment ? "development" : "production",
    devtool: isDevelopment ? "eval-source-map" : false,
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, "css-loader"],
        },
      ],
    },
    resolve: {
      extensions: [".tsx", ".ts", ".js"],
      fallback: {
        crypto: require.resolve("crypto-browserify"),
        stream: require.resolve("stream-browserify"),
        assert: require.resolve("assert/"),
        http: require.resolve("stream-http"),
        https: require.resolve("https-browserify"),
        os: require.resolve("os-browserify/browser"),
        buffer: require.resolve("buffer/"),
        process: require.resolve("process/browser"),
      },
    },
    externals: {
      obsidian: "commonjs2 obsidian",
    },
  };
};
