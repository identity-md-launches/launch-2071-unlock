import {
  createPublicClient,
  fallback,
  http,
  defineChain,
  type Address,
  parseAbi,
} from "viem";
export const CHAIN_ID = 1;
export const RPC_URLS = [
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
];
export const chain = defineChain({
  id: CHAIN_ID,
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: RPC_URLS } },
  blockExplorers: {
    default: { name: "Etherscan", url: "https://etherscan.io" },
  },
  testnet: false,
});
export const addresses = {
  token: "0x99fa82b022be4575891a43b757bc770691e18fda",
  hook: "0x932eba7e96b9e54efe6f8cdf98cb092164a57fcc",
  router: "0x66a9893cc07d91d95644aedd05d03f95e1dba8af",
  distributor: "0xc70795e2d8dfac6131038dcba84aa2aaed1ceed1",
  manager: "0x000000000004444c5dc75cb358380d2e3de08a90",
  stateView: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
} as const satisfies Record<string, Address>;
// Canonical v4 native currency sentinel, not a substitute recipient.
export const NATIVE = "0x0000000000000000000000000000000000000000" as const;
export const DEPLOYMENT_BLOCK = 26211921n;
export const SOURCE_COMMIT = "40d70b7bd0853aedf84eac839a40a5f12e6ac341";
export const REPO =
  "https://github.com/identity-md-launches/launch-2071-unlock";
export const LAUNCH_API =
  "https://api.imd.fun/launches/0528a007-5ec6-4acd-b9cc-b3ded6fe2929";
export const stateAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  "function getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128)",
]);
export const client = createPublicClient({
  chain,
  transport: fallback(
    RPC_URLS.map((url) =>
      http(url, {
        batch: { wait: 20, batchSize: 40 },
        timeout: 12000,
        retryCount: 1,
      }),
    ),
    { rank: false, retryCount: 1 },
  ),
  pollingInterval: 12000,
});
export const explorer = (address: string, kind = "address") =>
  `${chain.blockExplorers.default.url}/${kind}/${address}`;
export const source = (file: string) => `${REPO}/blob/${SOURCE_COMMIT}/${file}`;
