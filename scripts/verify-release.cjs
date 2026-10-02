const assert = require("node:assert/strict");
const fs = require("node:fs");
const manifest = require("../manifest.json");
const packageJson = require("../package.json");
const versions = require("../versions.json");

const tag = process.argv[2];
assert.ok(tag, "Pass the release tag to verify-release.cjs");
assert.match(tag, /^\d+\.\d+\.\d+$/, "Use a version tag without a leading v");
assert.equal(manifest.version, tag, "Manifest version must match the release tag");
assert.equal(packageJson.version, tag, "Package version must match the release tag");
assert.equal(versions[tag], manifest.minAppVersion, "versions.json must include the minimum app version");
for (const file of ["main.js", "manifest.json", `docs/releases/${tag}.md`]) {
  assert.ok(fs.statSync(file).size > 0, `Missing or empty release file: ${file}`);
}
console.log(`Release ${tag} is ready for BRAT.`);
