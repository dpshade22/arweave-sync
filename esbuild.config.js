const esbuild = require("esbuild");
const cssModulesPlugin = require("esbuild-css-modules-plugin");
const fs = require("fs");
const path = require("path");

// Check if we're building for production
const prod = process.argv[2] === "production";

// Plugin to copy styles.css to the root directory after build
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

// Main build configuration
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
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
    global: "window",
  },
  loader: {
    ".css": "empty", // Ignore CSS imports in JS/TS files
  },
  plugins: [
    // Handle CSS modules
    cssModulesPlugin({
      inject: false,
      output: "styles.css",
      emitCssFile: true,
    }),
    // Handle external dependencies
    {
      name: "externalize-deps",
      setup(build) {
        // Ensure crypto-js is bundled
        build.onResolve({ filter: /^crypto-js$/ }, (args) => {
          return { path: require.resolve("crypto-js"), external: false };
        });
        // Use buffer polyfill
        build.onResolve({ filter: /^buffer$/ }, (args) => {
          return { path: require.resolve("buffer/"), external: false };
        });
        // Use process polyfill for browser
        build.onResolve({ filter: /^process$/ }, (args) => {
          return { path: require.resolve("process/browser"), external: false };
        });
      },
    },
    copyStylesPlugin,
  ],
};

// Function to log build results
function logBuildResult(result) {
  if (result.errors.length > 0) {
    console.error("Build failed:", result.errors);
  } else {
    console.log(`Build completed successfully in ${result.duration}ms`);
  }
  if (result.warnings.length > 0) {
    console.warn("Build warnings:", result.warnings);
  }
}

// Run the build process
if (prod) {
  console.log("Starting production build...");
  esbuild
    .build(buildOptions)
    .then(logBuildResult)
    .catch((err) => {
      console.error("Production build failed:", err);
      process.exit(1);
    });
} else {
  console.log("Starting development build in watch mode...");
  esbuild
    .context(buildOptions)
    .then((context) => {
      context.watch();
      console.log("Watch mode started. Waiting for changes...");
    })
    .catch((err) => {
      console.error("Development build failed to start:", err);
      process.exit(1);
    });
}

// Keep the Node.js process running in watch mode
if (!prod) {
  process.stdin.on("close", () => {
    console.log("Stopping watch mode...");
    process.exit(0);
  });
  console.log("Press Ctrl+C to stop watch mode");
}
