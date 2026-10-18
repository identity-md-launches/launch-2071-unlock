// Read-only verification. Optional RPC argument supports contributor infrastructure;
// reports always identify the project's public Ethereum sources, never machine configuration.
import {
  createPublicClient,
  custom,
  http,
  keccak256,
  parseAbi,
  type Hex,
} from "viem";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readMainnetCandidate,
  verifyMainnetBindings,
} from "../src/mainnetReader";
import {
  TREASURY_WALLET,
  VAULT_BENEFICIARY,
  NFT_COLLECTION,
  NEXT_THRESHOLDS,
} from "../src/candidate";
import { HOOK, TOKEN, IMD, VAULT, POOL_ID, POOL_MANAGER } from "../src/mainnet";
import { hookAbi } from "../src/mainnetAbis";
import { readPoolHistory } from "../src/poolHistory";
const run = promisify(execFile);
const endpoint = process.argv[2] ?? "https://ethereum-rpc.publicnode.com";
let id = 0;
const transport = process.argv.includes("--proxy")
  ? custom({
      async request({ method, params }) {
        const { stdout } = await run(
          "curl",
          [
            "-x",
            process.env.HTTP_PROXY ?? "",
            "--noproxy",
            "",
            "-sS",
            "--max-time",
            "35",
            "-H",
            "content-type: application/json",
            "--data",
            JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
            endpoint,
          ],
          { maxBuffer: 16 * 1024 * 1024 },
        );
        const body = JSON.parse(stdout);
        if (body.error) throw Error(body.error.message);
        return body.result;
      },
    })
  : http(endpoint, { timeout: 30000, retryCount: 1 });
const reader = createPublicClient({ transport });
const block = await reader.getBlock({ blockTag: "latest" });
await verifyMainnetBindings(true, reader, block.number);
const snapshot = await readMainnetCandidate(null, reader);
const thresholds = await Promise.all(
  NEXT_THRESHOLDS.map(
    (_, index) =>
      reader.readContract({
        address: HOOK,
        abi: hookAbi,
        functionName: "tierThreshold",
        args: [index],
        blockNumber: snapshot.block,
      }) as Promise<bigint>,
  ),
);
if (
  thresholds.some(
    (value, i) => value !== BigInt(NEXT_THRESHOLDS[i]) * 10n ** 18n,
  )
)
  throw Error("Deployed threshold mismatch");
const [code, name, nftBalance, supply] = await Promise.all([
  reader.getBytecode({ address: NFT_COLLECTION, blockNumber: snapshot.block }),
  reader.readContract({
    address: NFT_COLLECTION,
    abi: parseAbi(["function name() view returns(string)"]),
    functionName: "name",
    blockNumber: snapshot.block,
  }),
  reader.readContract({
    address: NFT_COLLECTION,
    abi: parseAbi(["function balanceOf(address) view returns(uint256)"]),
    functionName: "balanceOf",
    args: [TREASURY_WALLET],
    blockNumber: snapshot.block,
  }),
  reader.readContract({
    address: TOKEN,
    abi: parseAbi(["function totalSupply() view returns(uint256)"]),
    functionName: "totalSupply",
    blockNumber: snapshot.block,
  }),
]);
if (
  !code ||
  keccak256(code) !==
    "0x68d046e0bfb8185d9db0a9a7ed57420f22dfc38321c9c91453a001a47668c530" ||
  name !== "identity.md"
)
  throw Error("NFT collection mismatch");
if (supply !== 1_000_000_000n * 10n ** 18n) throw Error("Supply mismatch");
const history = await readPoolHistory(2000, undefined, reader);
console.log(
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      evidence:
        "Fresh read-only Ethereum mainnet RPC verification; no wallet transactions",
      publicRpcSources: [
        "https://ethereum-rpc.publicnode.com",
        "https://eth.drpc.org",
      ],
      chainId: await reader.getChainId(),
      block: snapshot.block,
      blockHash: (await reader.getBlock({ blockNumber: snapshot.block })).hash,
      identities: {
        TOKEN,
        IMD,
        HOOK,
        VAULT,
        POOL_ID,
        POOL_MANAGER,
        NFT_COLLECTION,
        TREASURY_WALLET,
        VAULT_BENEFICIARY,
      },
      runtimeBindingsVerified: true,
      reviewedAbiSource:
        "40d70b7bd0853aedf84eac839a40a5f12e6ac341; offline compiled/source hash comparison separately recorded; no Etherscan verification claim",
      supply,
      thresholds,
      snapshot,
      nft: {
        name,
        codeHash: keccak256(code as Hex),
        inventoryWallet: TREASURY_WALLET,
        balance: nftBalance,
      },
      history: {
        ...history,
        trades: history.trades.slice(-10),
        totalEvents: history.trades.length,
      },
    },
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ),
);
