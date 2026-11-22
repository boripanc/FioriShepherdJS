// Bundles shepherd.js (ESM, with its dependencies) into a single IIFE file that the
// UI5 loader can load without a bundler at runtime. The result exposes `window.Shepherd`
// and is committed to the repo, so deploying the plugin needs no build step.
import { build } from "esbuild";
import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";

const pkgDir = path.resolve("node_modules/shepherd.js");
const { version, license } = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const outDir = "webapp/lib/thirdparty";

await build({
  entryPoints: [path.join(pkgDir, "dist/esm/shepherd.mjs")],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "__ShepherdModule",
  footer: { js: "window.Shepherd=__ShepherdModule.default;" },
  banner: { js: `/*! shepherd.js v${version} | ${license} | https://github.com/shepherd-pro/shepherd */` },
  target: ["es2019"],
  outfile: `${outDir}/shepherd.js`,
  legalComments: "inline",
  charset: "ascii" // SAP servers may serve files in a non-UTF-8 code page (e.g. Thai)
});
copyFileSync(path.join(pkgDir, "dist/css/shepherd.css"), `${outDir}/shepherd.css`);
console.log(`Bundled shepherd.js v${version} (${license}) into ${outDir}`);
