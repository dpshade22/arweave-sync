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
        build.onResolve({ filter: /^buffer$/ }, (args) => {
          return { path: require.resolve("buffer/"), external: false };
        });
        build.onResolve({ filter: /^process$/ }, (args) => {
          return { path: require.resolve("process/browser"), external: false };
        });
      },
    },
    copyStylesPlugin,
  ],
};

function logBuildResult(result) {
  if (result.errors.length > 0) {
    console.error("Build failed:", result.errors);
  } else {
    console.log(`Build completed in ${result.duration}ms`);
  }
  if (result.warnings.length > 0) {
    console.warn("Build warnings:", result.warnings);
  }
}

if (prod) {
  esbuild
    .build(buildOptions)
    .then(logBuildResult)
    .catch((err) => {
      console.error("Build failed:", err);
      process.exit(1);
    });
} else {
  console.log("Starting watch mode...");
  esbuild
    .context(buildOptions)
    .then((context) => {
      context.watch();
      console.log("Watch mode started. Waiting for changes...");
    })
    .catch((err) => {
      console.error("Watch mode failed to start:", err);
      process.exit(1);
    });
}

// Keep the Node.js process running
process.stdin.on("close", () => {
  process.exit(0);
});
