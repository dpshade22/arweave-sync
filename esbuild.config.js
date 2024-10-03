const esbuild = require('esbuild');
const cssModulesPlugin = require('esbuild-css-modules-plugin');
const fs = require('fs');
const path = require('path');

const prod = process.argv[2] === 'production';

// Custom plugin to rename CSS file
const renameCssPlugin = {
    name: 'rename-css',
    setup(build) {
        build.onEnd(() => {
            const oldPath = path.join(__dirname, 'main.css');
            const newPath = path.join(__dirname, 'styles.css');
            if (fs.existsSync(oldPath)) {
                fs.renameSync(oldPath, newPath);
                console.log('Renamed main.css to styles.css');
            }
        });
    },
};

// Custom plugin for code optimization
const optimizeJsPlugin = {
    name: 'optimize-js',
    setup(build) {
        build.onLoad({ filter: /\.ts$/ }, async (args) => {
            let contents = await fs.promises.readFile(args.path, 'utf8');

            // Remove console.log statements in production
            if (prod) {
                contents = contents.replace(/console\.log\(.*?\);?/g, '');
            }

            return { contents, loader: 'ts' };
        });
    },
};

const buildOptions = {
    entryPoints: ['src/main.ts'],
    bundle: true,
    outfile: 'main.js',
    format: 'cjs',
    target: ['es2020'],  // Updated target
    platform: 'node', // Changed to 'browser' as Obsidian runs in a browser environment
    minify: prod,
    minifyIdentifiers: prod,
    minifySyntax: prod,
    minifyWhitespace: prod,
    treeShaking: true,   // Enable tree shaking
    sourcemap: !prod,    // Only generate sourcemaps for development
    metafile: prod,      // Generate a metafile for bundle analysis in production
    legalComments: 'none', // Remove legal comments in the output
    external: ['obsidian'],
    plugins: [
        cssModulesPlugin({
            inject: false,
            output: 'main.css',
        }),
        renameCssPlugin,
        optimizeJsPlugin,
    ],
    define: {
        'process.env.NODE_ENV': prod ? '"production"' : '"development"',
        'global': 'window', // Define global as window for browser environment
    },
    loader: {
        '.json': 'json',  // Properly handle JSON imports
    },
};

const runBuild = async () => {
    try {
        const result = await esbuild.build(buildOptions);
        if (prod && result.metafile) {
            // Output bundle analysis
            fs.writeFileSync('meta.json', JSON.stringify(result.metafile));
            console.log('Bundle analysis written to meta.json');
        }
    } catch (err) {
        console.error('Build failed:', err);
        process.exit(1);
    }
};

if (prod) {
    runBuild();
} else {
    esbuild.context(buildOptions).then(context => {
        context.watch().then(() => {
            console.log('Watching...');
        }).catch((err) => {
            console.error('Watch error:', err);
            process.exit(1);
        });
    }).catch(() => process.exit(1));
}
