import fs from "node:fs";
import { keccak256, toBytes } from "viem";
import { root, read, config, codeFor, save, live as online } from "./mainnet-evidence.mjs";
const canonical = (x) =>
  Array.isArray(x)
    ? x.map(canonical)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canonical(x[k])]),
        )
      : x;
const live = read("live-preparation.json");
const deployment = read("deployment.json");
if (live.block !== config.block || live.blockHash !== config.blockHash)
  throw Error("Preparation record does not match the pinned block");
const roles = {
  token: "UnlkToken",
  hook: "UnlkImdHook",
  vault: "ImdFeeVault",
  oracle: "UnlkImdOracle",
  evidence: "MerkleClaimEvidence",
};
const results = [];
for (const [role, name] of Object.entries(roles)) {
  const artifact = read(`compiled/${name}.json`);
  const sourcesMatched = Object.entries(artifact.sources).every(([path, source]) =>
    keccak256(toBytes(fs.readFileSync(new URL(path, root), "utf8"))) === source.keccak256,
  );
  const abi = JSON.parse(fs.readFileSync(new URL(`web/src/abis/${name}.json`, root)));
  const publicAbi = JSON.parse(fs.readFileSync(new URL(`web/public/abi/${name}.json`, root)));
  const code = await codeFor(role, live.addresses[role]);
  let expected = artifact.deployedBytecode.object.replace(/^0x/, ""),
    actual = code.slice(2);
  const refs = Object.values(
    artifact.deployedBytecode.immutableReferences ?? {},
  ).flat();
  for (const ref of refs) {
    const before = ref.start * 2,
      after = (ref.start + ref.length) * 2;
    expected =
      expected.slice(0, before) +
      "0".repeat(ref.length * 2) +
      expected.slice(after);
    actual =
      actual.slice(0, before) +
      "0".repeat(ref.length * 2) +
      actual.slice(after);
  }
  const abiHash = keccak256(toBytes(JSON.stringify(canonical(abi))));
  const publicAbiHash = keccak256(toBytes(JSON.stringify(canonical(publicAbi))));
  const pin = deployment.contracts.find((x) => x.name === name);
  const matched = actual === expected,
    abiMatched = artifact.abiHash === abiHash && publicAbiHash === abiHash && (!pin || "0x" + pin.abiHash === abiHash);
  results.push({
    role,
    name,
    runtimeMatchesCompiledExcludingImmutableReferences: matched,
    immutableReferences: refs.length,
    runtimeHash: keccak256(code),
    abiHash,
    expectedAbiHash: pin?.abiHash ?? null,
    abiMatched,
    sourcesMatched,
  });
}
save(online ? "source-verification-live.json" : "source-verification.json", {
  sourceCommit: deployment.sourceCommit, results,
});
console.log(results);
if (
  results.some(
    (r) =>
      !r.runtimeMatchesCompiledExcludingImmutableReferences || !r.abiMatched || !r.sourcesMatched,
  )
)
  process.exitCode = 1;
