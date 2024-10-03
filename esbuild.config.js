const esbuild = require("esbuild");
const path = require("path");

const prod = process.argv[2] === "production";

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
  plugins: [
    {
      name: "externalize-deps",
      setup(build) {
        build.onResolve({ filter: /^crypto-js$/ }, (args) => {
          return { path: require.resolve("crypto-js"), external: false };
        });
      },
    },
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
