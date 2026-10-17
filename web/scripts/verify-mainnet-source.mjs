import fs from "node:fs";
import { createPublicClient, http, keccak256, toBytes } from "viem";
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
const live = JSON.parse(fs.readFileSync("artifacts/live-preparation.json"));
const client = createPublicClient({
  transport: http("https://ethereum-rpc.publicnode.com"),
});
const deployment = JSON.parse(fs.readFileSync("artifacts/deployment.json"));
const roles = {
  token: "UnlkToken",
  hook: "UnlkImdHook",
  vault: "ImdFeeVault",
  oracle: "UnlkImdOracle",
  evidence: "MerkleClaimEvidence",
};
const results = [];
for (const [role, name] of Object.entries(roles)) {
  const artifact = JSON.parse(fs.readFileSync(`out/${name}.sol/${name}.json`));
  const code = await client.getBytecode({
    address: live.addresses[role],
    blockNumber: BigInt(
      JSON.parse(fs.readFileSync("artifacts/fork-config.json")).block,
    ),
  });
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
  const abiHash = keccak256(toBytes(JSON.stringify(canonical(artifact.abi))));
  const pin = deployment.contracts.find((x) => x.name === name);
  const matched = actual === expected,
    abiMatched = pin ? "0x" + pin.abiHash === abiHash : true;
  results.push({
    role,
    name,
    runtimeMatchesCompiledExcludingImmutableReferences: matched,
    immutableReferences: refs.length,
    runtimeHash: keccak256(code),
    abiHash,
    expectedAbiHash: pin?.abiHash ?? null,
    abiMatched,
  });
  fs.writeFileSync(
    `web/src/abis/${name}.json`,
    JSON.stringify(artifact.abi, null, 2) + "\n",
  );
  fs.writeFileSync(
    `web/public/abi/${name}.json`,
    JSON.stringify(artifact.abi, null, 2) + "\n",
  );
}
fs.writeFileSync(
  "artifacts/source-verification.json",
  JSON.stringify(
    {
      sourceCommit: deployment.sourceCommit,
      chainId: 1,
      block: String(
        JSON.parse(fs.readFileSync("artifacts/fork-config.json")).block,
      ),
      results,
    },
    null,
    2,
  ),
);
console.log(results);
if (
  results.some(
    (r) =>
      !r.runtimeMatchesCompiledExcludingImmutableReferences || !r.abiMatched,
  )
)
  process.exitCode = 1;
