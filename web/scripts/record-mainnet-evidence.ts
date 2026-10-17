import fs from "node:fs";
import assert from "node:assert/strict";
import { createPublicClient, http, keccak256 } from "viem";
import { RUNTIME_PINS, POOL_KEY, POOL_ID, HOOK, EVIDENCE, DISTRIBUTOR } from "../src/mainnet";
import { hookAbi, evidenceAbi, distributorAbi } from "../src/mainnetAbis";
import { verifyMainnetBindings } from "../src/mainnetReader";
import pins from "../src/mainnet-pins.json";

// Explicit read-only capture; never accepts or creates a wallet client.
const out = new URL("../evidence/", import.meta.url);
const config = JSON.parse(fs.readFileSync(new URL("fork-config.json", out), "utf8"));
const client = createPublicClient({ transport: http(config.rpcUrl) });
const blockNumber = BigInt(config.block);
const block = await client.getBlock({ blockNumber });
assert.equal(block.hash, config.blockHash);
assert.equal(await client.getChainId(), config.chainId);
const bindings = await verifyMainnetBindings(true, client, blockNumber);
const code: Record<string, unknown> = {};
for (const [role, pin] of Object.entries(RUNTIME_PINS)) {
  const runtime = await client.getBytecode({ address: pin.address, blockNumber });
  assert(runtime && runtime !== "0x", role);
  assert.equal(keccak256(runtime), pin.hash, role);
  code[role] = { address: pin.address, runtime, keccak256: keccak256(runtime) };
}
const [certified, round, key, poolId, stagedOracle, stagedRewards] = await Promise.all([
  client.readContract({ address: EVIDENCE, abi: evidenceAbi, functionName: "certified", args: [0n], blockNumber }),
  client.readContract({ address: DISTRIBUTOR, abi: distributorAbi, functionName: "roundOf", args: [0n], blockNumber }),
  client.readContract({ address: HOOK, abi: hookAbi, functionName: "poolKey", blockNumber }),
  client.readContract({ address: HOOK, abi: hookAbi, functionName: "poolId", blockNumber }),
  client.readContract({ address: HOOK, abi: hookAbi, functionName: "stagedOracle", blockNumber }),
  client.readContract({ address: HOOK, abi: hookAbi, functionName: "stagedRewards", blockNumber }),
]);
assert.equal(poolId, POOL_ID);
const metadata = {
  evidence: "Unmodified historical Ethereum mainnet RPC reads; no mock, fork mutation or public write",
  chainId: config.chainId, block: config.block, blockHash: block.hash,
  blockTime: String(block.timestamp), rpcUrl: config.rpcUrl,
  capturedAt: new Date().toISOString(),
};
const save = (name: string, data: unknown) => fs.writeFileSync(new URL(name, out),
  JSON.stringify(data, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n");
save("mainnet-code.json", { ...metadata, code });
save("live-preparation.json", {
  ...metadata, addresses: pins.addresses, bindingsVerified: true,
  activated: bindings.activated, certifiedRound0: certified, round0: round,
  poolKey: key, expectedPoolKey: POOL_KEY, poolId, stagedOracle, stagedRewards,
});
console.log(JSON.stringify({ ...metadata, bindingsVerified: true, activated: bindings.activated, certifiedRound0: certified, codeRoles: Object.keys(code) }, null, 2));
