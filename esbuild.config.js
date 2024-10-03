const esbuild = require("esbuild");
const cssModulesPlugin = require("esbuild-css-modules-plugin");
const fs = require("fs");
const path = require("path");

const prod = process.argv[2] === "production";

const copyStylesPlugin = {
  name: "copy-styles",
  setup(build) {
    build.onEnd(() => {
      const src = path.join(__dirname, "src", "styles.css");
      const dest = path.join(__dirname, "styles.css");
      fs.copyFile(src, dest, (err) => {
        if (err) throw err;
        console.log("styles.css has been copied to the root directory");
      });
    });
  },
};

const buildOptions = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV || "development",
    ),
    global: "window",
  },
  loader: {
    ".css": "empty",
  },
  plugins: [
    cssModulesPlugin({
      inject: false,
      output: "styles.css",
      emitCssFile: true,
    }),
    {
      name: "externalize-deps",
      setup(build) {
        build.onResolve({ filter: /^crypto-js$/ }, (args) => {
          return { path: require.resolve("crypto-js"), external: false };
        });
      },
    },
    copyStylesPlugin, // Add the new plugin here
  ],
};

if (prod) {
  esbuild.build(buildOptions).catch(() => process.exit(1));
} else {
  esbuild
    .context(buildOptions)
    .then((context) => {
      context.watch();
    })
    .catch(() => process.exit(1));
}
