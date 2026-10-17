import fs from "node:fs";
import path from "node:path";
import {
  keccak256,
  toHex,
  encodeAbiParameters,
  type Address,
  type Hex,
} from "viem";
import {
  client,
  abi,
  addresses as a,
  stateAbi,
  BUY_PROOF,
  SOURCE_COMMIT,
} from "../src/config";
const root = path.resolve(import.meta.dirname, "../..");
const canonical = (v: unknown): string =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(canonical).join(",")}]`
      : `{${Object.entries(v)
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
          .join(",")}}`;
const block = await client.getBlock();
const read = async (
  address: Address,
  ab: typeof abi.hook,
  functionName: string,
  args: readonly unknown[] = [],
) =>
  client.readContract({
    address,
    abi: ab,
    functionName,
    args,
    blockNumber: block.number,
  }) as Promise<any>;
const [
  router,
  rewards,
  oracle,
  key,
  poolId,
  factory,
  payer,
  activated,
  p,
  tier,
  fullyUnlocked,
  seedTokens,
  seedQuoteCapacity,
  lower,
  upper,
  launchNumber,
] = await Promise.all(
  [
    "router",
    "rewards",
    "oracle",
    "poolKey",
    "poolId",
    "launchFactory",
    "payer",
    "activated",
    "p",
    "tier",
    "fullyUnlocked",
    "seedTokens",
    "seedQuoteCapacity",
    "seedTickLower",
    "seedTickUpper",
    "launchNumber",
  ].map((n) => read(a.hook, abi.hook, n)),
);
const checks: Record<string, boolean> = {
  chain: (await client.getChainId()) === 11155111,
  router: router.toLowerCase() === a.router,
  activated,
  launch: launchNumber === 1560n,
};
checks.supply =
  (await read(a.token, abi.token, "totalSupply")) === 1000000000n * 10n ** 18n;
checks.decimals = (await read(a.token, abi.token, "decimals")) === 18;
checks.poolKey =
  key.currency0 === "0x0000000000000000000000000000000000000000" &&
  key.currency1.toLowerCase() === a.token &&
  key.hooks.toLowerCase() === a.hook &&
  key.fee === 12500 &&
  key.tickSpacing === 60;
checks.poolId =
  keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  ) === poolId;
for (const [label, address, ab, fn, expected] of [
  ["routerHook", router, abi.router, "hook", a.hook],
  ["routerManager", router, abi.router, "poolManager", a.manager],
  ["evidenceToken", rewards, abi.evidence, "token", a.token],
  ["evidenceDistributor", rewards, abi.evidence, "distributor", a.distributor],
  ["oracleHook", oracle, abi.oracle, "hook", a.hook],
  ["oracleToken", oracle, abi.oracle, "token", a.token],
  ["oracleManager", oracle, abi.oracle, "poolManager", a.manager],
  ["oraclePool", oracle, abi.oracle, "poolId", poolId],
  ["distributorToken", a.distributor, abi.distributor, "token", a.token],
] as const)
  checks[label] =
    (await read(address, ab, fn)).toLowerCase() === expected.toLowerCase();
const contracts: Record<string, unknown> = {};
const pinned: Record<string, string> = {
  UnlkToken: "2754d38e745fac0c7dac78119f2a1f7516e00f246098b348e9eed03ede16d19a",
  UnlkHook: "bfd57f612b9ff42c1a82d59c9eef79c32fe99adb0d498244b23a30c968a08312",
};
for (const [name, address] of Object.entries({
  UnlkToken: a.token,
  UnlkHook: a.hook,
  UnlkSwapRouter: router,
  UnlkOracle: oracle,
  MerkleClaimEvidence: rewards,
})) {
  const artifact = JSON.parse(
    fs.readFileSync(path.join(root, `out/${name}.sol/${name}.json`), "utf8"),
  );
  const runtime = await client.getCode({ address, blockNumber: block.number });
  if (!runtime) throw Error(`${name}: no code`);
  let actual = runtime.slice(2);
  let expected = artifact.deployedBytecode.object.replace(/^0x/, "");
  for (const refs of Object.values(
    artifact.deployedBytecode.immutableReferences,
  ) as { start: number; length: number }[][])
    for (const { start, length } of refs) {
      actual =
        actual.slice(0, start * 2) +
        "0".repeat(length * 2) +
        actual.slice((start + length) * 2);
      expected =
        expected.slice(0, start * 2) +
        "0".repeat(length * 2) +
        expected.slice((start + length) * 2);
    }
  const abiHash = keccak256(toHex(canonical(artifact.abi))).slice(2);
  checks[`${name}Runtime`] = actual === expected;
  if (pinned[name]) checks[`${name}Abi`] = abiHash === pinned[name];
  for (const [label, directory] of [
    ["FrontendAbi", "web/src/abis"],
    ["DownloadAbi", "web/public/abi"],
  ]) {
    const shipped = JSON.parse(
      fs.readFileSync(path.join(root, directory, `${name}.json`), "utf8"),
    );
    checks[`${name}${label}`] =
      keccak256(toHex(canonical(shipped))).slice(2) === abiHash;
  }
  contracts[name] = {
    address,
    runtimeHash: keccak256(runtime),
    runtimeBytes: (runtime.length - 2) / 2,
    normalizedRuntimeMatches: actual === expected,
    abiHash,
    abiPinned: pinned[name] ?? null,
  };
}
const [
  slot0,
  liquidity,
  position,
  round,
  count,
  certified,
  observationCount,
  feed,
] = await Promise.all([
  read(a.stateView, stateAbi, "getSlot0", [poolId]),
  read(a.stateView, stateAbi, "getLiquidity", [poolId]),
  read(a.stateView, stateAbi, "getPositionInfo", [
    poolId,
    factory,
    lower,
    upper,
    "0x" + "00".repeat(32),
  ]),
  read(a.distributor, abi.distributor, "roundOf", [0n]),
  read(a.distributor, abi.distributor, "roundCount"),
  read(rewards, abi.evidence, "certified", [0n]),
  read(oracle, abi.oracle, "observationCount"),
  read(oracle, abi.oracle, "feed"),
]);
const constants: Record<string, unknown> = {};
for (const n of [
  "WINDOW",
  "MAX_CHECKPOINT_AGE",
  "MAX_FEED_AGE",
  "MIN_LIQUIDITY",
  "MIN_SEED_QUOTE_CAPACITY",
])
  constants[n] = await read(oracle, abi.oracle, n);
for (const n of [
  "CONFIRMATION",
  "FINAL_CONFIRMATION",
  "MIN_CONFIRMATION_INTERVAL",
  "MAX_CONFIRMATION_GAP",
])
  constants[n] = await read(a.hook, abi.hook, n);
const buy = await client.getTransactionReceipt({ hash: BUY_PROOF });
checks.buyReceipt =
  buy.status === "success" && buy.to?.toLowerCase() === a.router;
let fdv: unknown;
try {
  fdv = await read(oracle, abi.oracle, "fdvUsd");
} catch {
  fdv = null;
}
const evidence = {
  sourceCommit: SOURCE_COMMIT,
  checkedAt: new Date().toISOString(),
  block: block.number,
  blockHash: block.hash,
  blockTimestamp: block.timestamp,
  checks,
  contracts,
  bindings: { ...a, rewards, oracle, factory, payer, feed, poolId, key },
  state: {
    p,
    tier,
    fullyUnlocked,
    seedTokens,
    seedQuoteCapacity,
    lower,
    upper,
    slot0,
    liquidity,
    position,
    round,
    count,
    certified,
    observationCount,
    fdv,
  },
  constants,
  buyProof: { hash: BUY_PROOF, block: buy.blockNumber, status: buy.status },
  limitations: [
    "Read-only verification; no public sell or claim broadcast by this job.",
    "ABI pins supplied for token and hook. Other ABIs derived from accepted source and runtime matches.",
  ],
};
const json =
  JSON.stringify(
    evidence,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n";
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(path.join(root, "artifacts/chain-verification.json"), json);
fs.writeFileSync(
  path.join(root, "web/public/evidence/chain-verification.json"),
  json,
);
console.log(
  JSON.stringify(
    {
      block: block.number.toString(),
      checks,
      bindings: evidence.bindings,
      fdv,
    },
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
if (Object.values(checks).some((x) => !x)) process.exitCode = 1;
