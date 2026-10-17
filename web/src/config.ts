import {
  createPublicClient,
  fallback,
  http,
  defineChain,
  type Abi,
  type Address,
  parseAbi,
} from "viem";
import tokenJson from "./abis/UnlkToken.json";
import hookJson from "./abis/UnlkHook.json";
import routerJson from "./abis/UnlkSwapRouter.json";
import oracleJson from "./abis/UnlkOracle.json";
import evidenceJson from "./abis/MerkleClaimEvidence.json";
import distributorJson from "./abis/MerkleDistributor.json";
import feedJson from "./abis/IChainlinkEthUsd.json";
export const CHAIN_ID = 11155111;
export const RPC_URLS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://rpc.sepolia.ethpandaops.io",
  "https://sepolia.rpc.sentio.xyz",
];
export const chain = defineChain({
  id: CHAIN_ID,
  name: "Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: RPC_URLS } },
  blockExplorers: {
    default: { name: "Etherscan", url: "https://sepolia.etherscan.io" },
  },
  testnet: true,
});
export const addresses = {
  token: "0x20978223b637fec0c6276ab0184cf7011dd1d483",
  hook: "0xbbb78a4898e903b082ccd09efc7823ca7339bfc0",
  router: "0x28f04118fe5d940fe9a81740e74d611313b3004b",
  distributor: "0xf55d5bacbf3ce5464921a94708c08a99bea99cdd",
  manager: "0xe03a1074c86cfedd5c142c4f04f1a1536e203543",
  stateView: "0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c",
} as const satisfies Record<string, Address>;
// Canonical v4 native currency sentinel, not a substitute recipient.
export const NATIVE = "0x0000000000000000000000000000000000000000" as const;
export const DEPLOYMENT_BLOCK = 11906181n;
export const SOURCE_COMMIT = "ea89426f3fe9df79096a5e02345fc8821bd1c783";
export const REPO =
  "https://github.com/identity-md-launches/launch-1560-unlock";
export const LAUNCH_API =
  "https://api.imd.fun/launches/c92291be-96a7-4e77-b85f-79967143c10a";
export const BUY_PROOF =
  "0x595a858a472215ec90b12ef0f30fa193daae4f17fa9ddb83269b6a1214e101ab" as const;
export const abi = {
  token: tokenJson as Abi,
  hook: hookJson as Abi,
  router: routerJson as Abi,
  oracle: oracleJson as Abi,
  evidence: evidenceJson as Abi,
  distributor: distributorJson as Abi,
  feed: feedJson as Abi,
};
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
