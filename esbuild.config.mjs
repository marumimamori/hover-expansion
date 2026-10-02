import esbuild from "esbuild";

const production = process.argv[2] === "production";
const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  outfile: "main.js",
  minify: production,
  banner: { js: "/* Hover Expansion — generated from main.ts and src/. */" }
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
