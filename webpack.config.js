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
    target: "web", // Change this from 'node' to 'web'
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
        buffer: require.resolve("buffer/"),
        process: require.resolve("process/browser"),
        vm: require.resolve("vm-browserify"),
      },
    },
    plugins: [
      new MiniCssExtractPlugin({
        filename: "styles.css",
      }),
      new webpack.ProvidePlugin({
        process: "process/browser",
        Buffer: ["buffer", "Buffer"],
      }),
    ],
    externals: {
      obsidian: "commonjs2 obsidian",
    },
  };
};
