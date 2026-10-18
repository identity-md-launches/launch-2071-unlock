import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { stringToHex, type PublicClient } from "viem";
import { readMainnetCandidate } from "../src/mainnetReader";
import {
  TOKEN,
  HOOK,
  IMD,
  VAULT,
  EVIDENCE,
  ORACLE,
  DISTRIBUTOR,
  FACTORY,
  REGISTRY,
  POOL_ID,
  POOL_KEY,
  POOL_MANAGER,
  UNIVERSAL_ROUTER,
  QUOTER,
} from "../src/mainnet";
import {
  NFT_COLLECTION,
  VAULT_BENEFICIARY,
  NFT_BENEFICIARY,
  TREASURY_WALLET,
} from "../src/candidate";
import { verifyInventoryPage } from "../src/nftInventory";
const code = JSON.parse(
  fs.readFileSync(
    new URL("../evidence/mainnet-code.json", import.meta.url),
    "utf8",
  ),
).code;
function fixture(beneficiary: string = VAULT_BENEFICIARY) {
  const calls: any[] = [];
  const reader = {
    getChainId: async () => 1,
    getBlock: async () => ({
      number: 26220000n,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    }),
    getBytecode: async ({ address }: any) =>
      (Object.values(code) as any[]).find(
        (c) => c.address.toLowerCase() === address.toLowerCase(),
      )?.runtime,
    readContract: async (args: any) => {
      calls.push(args);
      const n = args.functionName;
      const values: Record<string, unknown> = {
        registry: REGISTRY,
        writer: FACTORY,
        initialMinter: FACTORY,
        activated: true,
        token: TOKEN,
        poolManager: POOL_MANAGER,
        launchFactory: FACTORY,
        poolKey: POOL_KEY,
        poolId: POOL_ID,
        UNIVERSAL_ROUTER,
        QUOTER,
        nftFeeVault: VAULT,
        oracle: ORACLE,
        rewards: EVIDENCE,
        bound: true,
        p: 2000,
        tier: 0,
        fullyUnlocked: false,
        roundOf: {
          root: `0x${"a".repeat(64)}`,
          funded: 100n,
          claimed: 0n,
          unlocksAt: 0n,
        },
        certified: true,
        swept: false,
        getSlot0: [2n ** 96n, 0, 0, 12500],
        totalAccrued: 47n,
        totalWithdrawn: 0n,
        totalRedeemed: 40n,
        claimable: 40n,
        pendingClaims: 7n,
        donations: 0n,
        donationsWithdrawn: 0n,
        donatedClaims: 0n,
        hook: HOOK,
        BENEFICIARY: beneficiary,
        quoteToken: IMD,
        distributor: DISTRIBUTOR,
        decimals: 18,
        fdvUsd: 1000n,
      };
      if (n === "artifactsOf")
        return Object.entries({
          token: TOKEN,
          hook: HOOK,
          distributor: DISTRIBUTOR,
        }).map(([role, addr]) => ({
          role: stringToHex(role, { size: 32 }),
          name: stringToHex(role, { size: 32 }),
          addr,
        }));
      if (n === "launchOf")
        return {
          launchNumber: 2071n,
          sourceCommit:
            "0x40d70b7bd0853aedf84eac839a40a5f12e6ac341000000000000000000000000",
          attestationHash:
            "0x69482a7fa6e3802ae5bac72a3f53fa03de4b565cbe7f6358824cce17d843fcbb",
        };
      if (n === "balanceOf") {
        if (args.address === POOL_MANAGER) return 7n;
        const owner = String(args.args[0]).toLowerCase();
        if (owner === TREASURY_WALLET)
          return args.address === IMD ? 123n : 456n;
        if (owner === VAULT) return args.address === IMD ? 40n : 0n;
        throw Error("Unexpected owner " + owner);
      }
      if (n in values) return values[n];
      throw Error("Unexpected read " + n);
    },
  };
  return { reader: reader as unknown as PublicClient, calls };
}
test("treasury balances use new inventory wallet; redeemed funds stay in vault and beneficiary validation stays immutable", async () => {
  assert.notEqual(TREASURY_WALLET as string, VAULT_BENEFICIARY as string);
  assert.equal(NFT_BENEFICIARY, VAULT_BENEFICIARY);
  const f = fixture();
  const s = await readMainnetCandidate(null, f.reader);
  assert.equal(s.vault.redeemed, 40n);
  assert.equal(s.vault.withdrawn, 0n);
  assert.equal(s.vault.imdBalance, 40n);
  assert.equal(s.vault.pendingClaims, 7n);
  assert.equal(s.treasury.imdBalance, 123n);
  assert.equal(s.treasury.unlkBalance, 456n);
  assert.equal(s.vault.accrued, s.vault.redeemed + s.vault.pendingClaims);
  assert.equal(s.vault.redeemed, s.vault.withdrawn + s.vault.claimable);
  const owners = f.calls
    .filter(
      (c) => c.functionName === "balanceOf" && [TOKEN, IMD].includes(c.address),
    )
    .map((c) => c.args[0]);
  assert.deepEqual(owners, [VAULT, VAULT, TREASURY_WALLET, TREASURY_WALLET]);
  assert(!owners.includes(VAULT_BENEFICIARY));
  await assert.rejects(
    readMainnetCandidate(null, fixture(TREASURY_WALLET).reader),
    /accounting mismatch/,
  );
});
test("NFT owner checks accept new treasury and exclude old beneficiary, visitors and foreign collections", async () => {
  const page = {
    items: [
      { id: "1", token: { address_hash: NFT_COLLECTION.toUpperCase() } },
      { id: "2", token: { address_hash: NFT_COLLECTION } },
      { id: "3", token: { address_hash: TOKEN } },
    ],
  };
  const uriCalls: bigint[] = [];
  const rows = await verifyInventoryPage(
    page,
    100n,
    async (id) =>
      id === 1n ? TREASURY_WALLET.toUpperCase() : VAULT_BENEFICIARY,
    async (id) => {
      uriCalls.push(id);
      return "data:application/json,%7B%7D";
    },
    new AbortController().signal,
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    ["1"],
  );
  assert.deepEqual(uriCalls, [1n]);
});
test("whitepaper is a standalone export with complete ladder, print action and reviewed ABI links", () => {
  const paper = fs
    .readFileSync("public/whitepaper/index.html", "utf8")
    .replace(/\s+/g, " ");
  assert.equal((paper.match(/<tr>\s*<td>/g) ?? []).length, 21); // 17 ladder rows + 4 fee modes.
  assert.match(paper, /Version 1\.1/);
  assert.match(paper, /Print \/ Save as PDF/);
  assert.match(paper, /Other-pool bypass/);
  assert.match(paper, /independent security audit/);
  assert.match(paper, /historical USD candles are unavailable/i);
  assert.match(paper, /\.\.\/abi\/UnlkImdHook.json/);
});
