import fs from "node:fs";
import { createHash } from "node:crypto";
import { keccak256, toBytes } from "viem";
import { execFileSync } from "node:child_process";

const root = new URL("../../", import.meta.url);
const canonical = (x) => Array.isArray(x) ? x.map(canonical) : x && typeof x === "object"
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical(x[k])])) : x;
const names = ["UnlkToken", "UnlkImdHook", "ImdFeeVault", "UnlkImdOracle", "MerkleClaimEvidence"];
const out = new URL("../evidence/compiled/", import.meta.url);
fs.mkdirSync(out, { recursive: true });
for (const name of names) {
  const artifact = JSON.parse(fs.readFileSync(new URL(`out/${name}.sol/${name}.json`, root)));
  fs.writeFileSync(new URL(`${name}.json`, out), JSON.stringify({
    contract: name, compiler: artifact.metadata.compiler,
    settings: artifact.metadata.settings,
    deployedBytecode: {
      object: artifact.deployedBytecode.object,
      immutableReferences: artifact.deployedBytecode.immutableReferences,
    },
    abiHash: keccak256(toBytes(JSON.stringify(canonical(artifact.abi)))),
    sources: artifact.metadata.sources,
  }, null, 2) + "\n");
}
const sourcePaths = execFileSync("git", ["ls-files", "src", "lib", "foundry.toml", "foundry.lock", "remappings.txt"], { cwd: root, encoding: "utf8" }).trim().split("\n");
const sourceDigest = createHash("sha256");
for (const path of sourcePaths.sort()) {
  sourceDigest.update(path + "\0");
  sourceDigest.update(createHash("sha256").update(fs.readFileSync(new URL(path, root))).digest());
}
fs.writeFileSync(new URL("../compiled-provenance.json", out), JSON.stringify({
  command: "forge build && node web/scripts/record-compiled.mjs",
  sourceCommit: "40d70b7bd0853aedf84eac839a40a5f12e6ac341",
  contracts: names, sourceAndDependencyFiles: sourcePaths.length, sourceDigest: sourceDigest.digest("hex"),
  note: "Minimal compiler output retained to allow verification after npm ci without shipping the Foundry cache. Regenerate with the unchanged project build configuration.",
}, null, 2) + "\n");
console.log(`Recorded ${names.length} compiled runtimes, immutable offsets, ABI hashes and compiler metadata.`);
