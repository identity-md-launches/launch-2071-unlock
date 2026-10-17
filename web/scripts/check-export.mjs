import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const root = new URL("../../", import.meta.url).pathname;
const dist = path.join(root, "dist");
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
function files(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? files(path.join(dir, entry.name))
        : [path.join(dir, entry.name)],
    );
}
const exported = files(dist)
  .sort()
  .map((file) => ({
    path: path.relative(dist, file),
    bytes: fs.statSync(file).size,
    sha256: sha(fs.readFileSync(file)),
  }));
const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
for (const pattern of [
  /<title>[^<]+<\/title>/,
  /name="description"/,
  /property="og:title"/,
  /property="og:image"/,
  /rel="icon"/,
])
  assert(pattern.test(html), String(pattern));
for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (match[1].startsWith("https:") || match[1].startsWith("http:")) continue;
  assert(!match[1].startsWith("/"), "Absolute local asset URL");
  assert(
    fs.existsSync(path.resolve(dist, match[1])),
    "Missing local asset " + match[1],
  );
}
assert(fs.existsSync(path.join(dist, "recovery.html")));
assert(fs.existsSync(path.join(dist, "claims/round-0.json")));
const changed = execFileSync("git", ["diff", "--name-only", "HEAD"], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);
const protectedPaths = changed.filter(
  (p) =>
    p.startsWith("lib/") ||
    p.startsWith("src/") ||
    p.startsWith(".github/") ||
    p.startsWith(".git/") ||
    p.split("/").some((x) => x === "node_modules" || x.startsWith(".env")) ||
    [
      "foundry.toml",
      "foundry.lock",
      "remappings.txt",
      ".gitmodules",
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
      "dependencies.lock.json",
      "lock.json",
    ].includes(path.basename(p)),
);
assert.deepEqual(protectedPaths, []);
const current = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter(
    (p) =>
      p &&
      !p.startsWith(".imd/") &&
      !p.startsWith("test/scratch/") &&
      !p.startsWith(".playwright-mcp/") &&
      fs.existsSync(path.join(root, p)),
  );
assert(!current.some((p) => p.split("/").includes("node_modules")));
const requiredEvidence = [
  "deployment.json",
  "network.json",
  "fork-config.json",
  "fork-block.json",
  "live-preparation.json",
  "mainnet-code.json",
  "compiled-provenance.json",
  "source-verification.json",
  "native-distributor-verification.json",
  "live-verification.json",
  "browser-interactions.json",
  "site-review.json",
  "design-probe.json",
  "publication-status.json",
  "validation.md",
  "quote-expiry-before.json",
  "quote-expiry-after.json",
  "revision-responses.json",
];
for (const name of requiredEvidence)
  assert(
    current.includes(`web/evidence/${name}`),
    `Missing or excluded evidence: ${name}`,
  );
const deliveryPaths = [
  "artifacts/validation.md",
  "artifacts/https-results.json",
  "artifacts/terminal-desktop.jpg",
  "artifacts/terminal-mobile.jpg",
  "artifacts/terminal-mobile-ladder.jpg",
];
for (const file of deliveryPaths)
  assert(
    current.includes(file),
    `Missing or excluded delivery artifact: ${file}`,
  );
for (const file of files(path.join(root, "web/evidence")))
  assert(
    current.includes(path.relative(root, file)),
    `Evidence excluded from submission: ${file}`,
  );
assert(
  !execFileSync("git", ["ls-files", "-s"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .some((p) => p.startsWith("160000 ")),
);
const manifest = {
  schema: 1,
  assetBase: "./",
  files: exported,
  totalBytes: exported.reduce((n, f) => n + f.bytes, 0),
  exportDigest: sha(JSON.stringify(exported)),
};
fs.writeFileSync(
  path.join(root, "web/evidence/export-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
fs.writeFileSync(
  path.join(root, "web/evidence/submission-check.json"),
  JSON.stringify(
    {
      protectedPathsUnchanged: true,
      contractSourcesUnchanged: true,
      dependencyManifestsAndLockfilesUnchanged: true,
      submodules: 0,
      dependencyOrCacheFilesInSubmission: 0,
      ignorePathBudget: deliveryPaths,
      inheritedDependencyExclusion: "**/node_modules/",
      distIncluded: true,
      relativeAssetUrls: true,
      requiredEvidenceIncluded: requiredEvidence,
      exportFiles: exported.length,
      exportBytes: manifest.totalBytes,
      exportDigest: manifest.exportDigest,
      compressedTreeBytes: null,
      byteBudget: 8388608,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Export verified: ${exported.length} files, ${manifest.totalBytes} bytes. Digest ${manifest.exportDigest}. Protected source/config/dependencies unchanged.`,
);
