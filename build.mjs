import { build } from "esbuild";

await build({
  entryPoints: ["src/content.js"],
  bundle: true,
  format: "iife",
  target: ["chrome114"],
  outfile: "dist/content.js",
  minify: false,
});
