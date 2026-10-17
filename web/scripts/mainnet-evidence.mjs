import fs from "node:fs";
import assert from "node:assert/strict";
import { createPublicClient, http, keccak256 } from "viem";

export const root = new URL("../../", import.meta.url);
export const evidence = new URL("../evidence/", import.meta.url);
export const read = (name) => JSON.parse(fs.readFileSync(new URL(name, evidence)));
export const config = read("fork-config.json");
export const recorded = read("mainnet-code.json");
export const live = process.argv.includes("--live");
export const client = createPublicClient({ transport: http(config.rpcUrl) });
assert.equal(recorded.chainId, config.chainId);
assert.equal(recorded.block, config.block);
assert.equal(recorded.blockHash, config.blockHash);
if (live) {
  assert.equal(await client.getChainId(), config.chainId);
  assert.equal((await client.getBlock({ blockNumber: BigInt(config.block) })).hash, config.blockHash);
}
export async function codeFor(role, address) {
  const saved = recorded.code[role];
  assert.equal(saved.address.toLowerCase(), address.toLowerCase());
  assert.equal(keccak256(saved.runtime), saved.keccak256);
  const code = live ? await client.getBytecode({ address, blockNumber: BigInt(config.block) }) : saved.runtime;
  assert(code && code !== "0x", `Missing runtime for ${role}`);
  assert.equal(keccak256(code), saved.keccak256, `${role} differs from the recorded mainnet code`);
  return code;
}
export function save(name, result) {
  fs.writeFileSync(new URL(name, evidence), JSON.stringify({
    evidence: live ? "Fresh public RPC reads at the recorded mainnet block" : "Offline verification of recorded mainnet RPC bytes against compiled source; not a fresh chain read",
    chainId: config.chainId, block: config.block, blockHash: config.blockHash, ...result,
  }, null, 2) + "\n");
}
