import {
  encodeAbiParameters,
  stringToHex,
  keccak256,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import {
  mainnetClient as client,
  TOKEN,
  HOOK,
  IMD,
  VAULT,
  EVIDENCE,
  ORACLE,
  DISTRIBUTOR,
  FACTORY,
  REGISTRY,
  POOL_MANAGER,
  STATE_VIEW,
  POOL_KEY,
  POOL_ID,
  UNIVERSAL_ROUTER,
  QUOTER,
  PERMIT2,
  RUNTIME_PINS,
  NFT_BENEFICIARY,
  NEXT_RATES,
  verifiedMatureQuota,
  type CandidateDeployment,
} from "./mainnet";
import {
  hookAbi,
  vaultAbi,
  oracleAbi,
  evidenceAbi,
  distributorAbi,
  erc20Abi,
  permitAbi,
} from "./mainnetAbis";
import { stateAbi } from "./config";
export const same = (a: unknown, b: string) =>
  typeof a === "string" && a.toLowerCase() === b.toLowerCase();
export interface CandidateSnapshot {
  block: bigint;
  blockTime: bigint;
  readAt: number;
  activated: boolean;
  p: number;
  tier: number;
  fullyUnlocked: boolean;
  fdv: bigint | null;
  oracleError: string | null;
  sqrtPrice: bigint;
  protocolFee: number;
  lpFee: number;
  round: {
    root: `0x${string}`;
    funded: bigint;
    claimed: bigint;
    unlocksAt: bigint;
  };
  certified: boolean;
  swept: boolean;
  wallet: {
    address: Address;
    balance: bigint;
    imdBalance: bigint;
    ethBalance: bigint;
    E: bigint;
    matureE: bigint;
    immatureE: bigint;
    buyBlock: bigint;
    S: bigint;
    quota: bigint;
    sellable: bigint;
    claimed: boolean;
    attested: boolean;
    pendingReward: bigint | null;
    pendingPayer: bigint;
    imdApproval: bigint;
    unlkApproval: bigint;
    permit2Allowance: bigint;
    permit2Expiration: number;
    unlkPermit: bigint;
    unlkExpiration: number;
  } | null;
  vault: {
    accrued: bigint;
    withdrawn: bigint;
    redeemed: bigint;
    claimable: bigint;
    pendingClaims: bigint;
    donations: bigint;
    donationsWithdrawn: bigint;
    unlkBalance: bigint;
    imdBalance: bigint;
    custodyImd: bigint;
    custodyUnlk: bigint;
    donatedClaims: bigint;
    actualClaims: bigint;
  };
}
let codeVerifiedAt = 0;
export async function verifyMainnetBindings(
  force = false,
  reader: PublicClient = client,
  blockNumber?: bigint,
) {
  if ((await reader.getChainId()) !== 1)
    throw Error(
      "RPC returned a different network. Ethereum mainnet is required.",
    );
  const block = blockNumber ?? (await reader.getBlockNumber({ cacheTime: 0 }));
  if (force || Date.now() - codeVerifiedAt > 60000) {
    await Promise.all(
      Object.entries(RUNTIME_PINS).map(async ([role, pin]) => {
        const code = await reader.getBytecode({
          address: pin.address,
          blockNumber: block,
        });
        if (!code || keccak256(code) !== pin.hash)
          throw Error(`${role} code verification failed. Writes disabled.`);
      }),
    );
    const factoryAbi = parseAbi(["function registry() view returns (address)"]);
    const registryAbi = parseAbi([
      "function writer() view returns (address)",
      "function artifactsOf(uint64) view returns ((bytes32 role,bytes32 name,address addr)[])",
      "function launchOf(uint64) view returns ((bytes32 kind,uint64 launchNumber,uint64 recordedAt,bytes32 sourceCommit,bytes32 manifestHash,bytes32 attestationHash,bytes32 verifierKey,string sourceRepoUrl))",
    ]);
    const [registry, writer, artifacts, record, minter] = await Promise.all([
      reader.readContract({
        address: FACTORY,
        abi: factoryAbi,
        functionName: "registry",
        blockNumber: block,
      }),
      reader.readContract({
        address: REGISTRY,
        abi: registryAbi,
        functionName: "writer",
        blockNumber: block,
      }),
      reader.readContract({
        address: REGISTRY,
        abi: registryAbi,
        functionName: "artifactsOf",
        args: [2071n],
        blockNumber: block,
      }),
      reader.readContract({
        address: REGISTRY,
        abi: registryAbi,
        functionName: "launchOf",
        args: [2071n],
        blockNumber: block,
      }),
      reader.readContract({
        address: TOKEN,
        abi: parseAbi(["function initialMinter() view returns (address)"]),
        functionName: "initialMinter",
        blockNumber: block,
      }),
    ]);
    const roles = { token: TOKEN, hook: HOOK, distributor: DISTRIBUTOR };
    if (
      !same(registry, REGISTRY) ||
      !same(writer, FACTORY) ||
      !same(minter, FACTORY) ||
      record.launchNumber !== 2071n ||
      record.sourceCommit !==
        "0x40d70b7bd0853aedf84eac839a40a5f12e6ac341000000000000000000000000" ||
      record.attestationHash !==
        "0x69482a7fa6e3802ae5bac72a3f53fa03de4b565cbe7f6358824cce17d843fcbb" ||
      Object.entries(roles).some(
        ([role, address]) =>
          !artifacts.some(
            (item) =>
              item.role === stringToHex(role, { size: 32 }) &&
              same(item.addr, address),
          ),
      )
    )
      throw Error(
        "Factory provenance does not match launch 2071. Writes disabled.",
      );
    if (reader === client) codeVerifiedAt = Date.now();
  }
  const read = (functionName: string) =>
    reader.readContract({
      address: HOOK,
      abi: hookAbi,
      functionName,
      blockNumber: block,
    });
  const [
    active,
    token,
    manager,
    factory,
    key,
    id,
    router,
    quoter,
    vault,
    oracle,
    evidence,
    bound,
  ] = await Promise.all([
    read("activated"),
    read("token"),
    read("poolManager"),
    read("launchFactory"),
    read("poolKey"),
    read("poolId"),
    read("UNIVERSAL_ROUTER"),
    read("QUOTER"),
    read("nftFeeVault"),
    read("oracle"),
    read("rewards"),
    read("bound"),
  ]);
  const [stagedOracle, stagedEvidence] = active
    ? [oracle, evidence]
    : await Promise.all([read("stagedOracle"), read("stagedRewards")]);
  const k = key as typeof POOL_KEY;
  const computed = keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { type: "address", name: "currency0" },
            { type: "address", name: "currency1" },
            { type: "uint24", name: "fee" },
            { type: "int24", name: "tickSpacing" },
            { type: "address", name: "hooks" },
          ],
        },
      ],
      [POOL_KEY],
    ),
  );
  if (
    !bound ||
    !same(token, TOKEN) ||
    !same(manager, POOL_MANAGER) ||
    !same(factory, FACTORY) ||
    !same(id, POOL_ID) ||
    computed !== POOL_ID ||
    !same(router, UNIVERSAL_ROUTER) ||
    !same(quoter, QUOTER) ||
    !same(vault, VAULT) ||
    !same(stagedOracle, ORACLE) ||
    !same(stagedEvidence, EVIDENCE) ||
    !same(k.currency0, TOKEN) ||
    !same(k.currency1, IMD) ||
    !same(k.hooks, HOOK) ||
    Number(k.fee) !== 12500 ||
    Number(k.tickSpacing) !== 60
  )
    throw Error(
      "Official mainnet contract bindings or PoolKey do not match. Writes disabled.",
    );
  return { activated: Boolean(active), block };
}
export async function readMainnetCandidate(
  _deployment: CandidateDeployment | null,
  reader: PublicClient = client,
  account?: Address,
): Promise<CandidateSnapshot> {
  const block = await reader.getBlock({ blockTag: "latest" });
  if (Date.now() / 1000 - Number(block.timestamp) > 90)
    throw Error("RPC block is stale. Refresh using a current mainnet service.");
  const { activated } = await verifyMainnetBindings(
    false,
    reader,
    block.number,
  );
  const hr = async (name: string, args: readonly unknown[] = []) =>
    reader.readContract({
      address: HOOK,
      abi: hookAbi,
      functionName: name,
      args,
      blockNumber: block.number,
    }) as Promise<any>;
  const vr = async (name: string) =>
    reader.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: name,
      blockNumber: block.number,
    }) as Promise<bigint>;
  const balance = (token: Address, owner: Address) =>
    reader.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
      blockNumber: block.number,
    });
  const [p, tier, fullyUnlocked, round, certified, swept, slot] =
    await Promise.all([
      hr("p"),
      hr("tier"),
      hr("fullyUnlocked"),
      reader.readContract({
        address: DISTRIBUTOR,
        abi: distributorAbi,
        functionName: "roundOf",
        args: [0n],
        blockNumber: block.number,
      }),
      reader.readContract({
        address: EVIDENCE,
        abi: evidenceAbi,
        functionName: "certified",
        args: [0n],
        blockNumber: block.number,
      }),
      reader.readContract({
        address: DISTRIBUTOR,
        abi: distributorAbi,
        functionName: "swept",
        args: [0n],
        blockNumber: block.number,
      }),
      reader.readContract({
        address: STATE_VIEW,
        abi: stateAbi,
        functionName: "getSlot0",
        args: [POOL_ID],
        blockNumber: block.number,
      }),
    ]);
  if (
    NEXT_RATES[Number(tier)] !== Number(p) ||
    fullyUnlocked !== (Number(tier) === 16) ||
    slot[3] !== 12500
  )
    throw Error("Mainnet rules or pool fee mismatch");
  const [
    accrued,
    withdrawn,
    redeemed,
    claimable,
    pendingClaims,
    donations,
    donationsWithdrawn,
    donatedClaims,
  ] = await Promise.all(
    [
      "totalAccrued",
      "totalWithdrawn",
      "totalRedeemed",
      "claimable",
      "pendingClaims",
      "donations",
      "donationsWithdrawn",
      "donatedClaims",
    ].map(vr),
  );
  const [
    vaultHook,
    vaultManager,
    beneficiary,
    vaultQuote,
    evidenceToken,
    evidenceDistributor,
    tokenDecimals,
    imdDecimals,
    unlkBalance,
    imdBalance,
    custodyImd,
    custodyUnlk,
    actualClaims,
  ] = await Promise.all([
    reader.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "hook",
      blockNumber: block.number,
    }),
    reader.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "poolManager",
      blockNumber: block.number,
    }),
    reader.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "BENEFICIARY",
      blockNumber: block.number,
    }),
    reader.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "quoteToken",
      blockNumber: block.number,
    }),
    reader.readContract({
      address: EVIDENCE,
      abi: evidenceAbi,
      functionName: "token",
      blockNumber: block.number,
    }),
    reader.readContract({
      address: EVIDENCE,
      abi: evidenceAbi,
      functionName: "distributor",
      blockNumber: block.number,
    }),
    reader.readContract({
      address: TOKEN,
      abi: erc20Abi,
      functionName: "decimals",
      blockNumber: block.number,
    }),
    reader.readContract({
      address: IMD,
      abi: erc20Abi,
      functionName: "decimals",
      blockNumber: block.number,
    }),
    balance(TOKEN, VAULT),
    balance(IMD, VAULT),
    balance(IMD, NFT_BENEFICIARY),
    balance(TOKEN, NFT_BENEFICIARY),
    reader.readContract({
      address: POOL_MANAGER,
      abi: parseAbi([
        "function balanceOf(address,uint256) view returns (uint256)",
      ]),
      functionName: "balanceOf",
      args: [VAULT, BigInt(IMD)],
      blockNumber: block.number,
    }),
  ]);
  if (
    !same(vaultHook, HOOK) ||
    !same(vaultManager, POOL_MANAGER) ||
    !same(beneficiary, NFT_BENEFICIARY) ||
    !same(vaultQuote, IMD) ||
    !same(evidenceToken, TOKEN) ||
    !same(evidenceDistributor, DISTRIBUTOR) ||
    tokenDecimals !== 18 ||
    imdDecimals !== 18 ||
    withdrawn > redeemed ||
    redeemed > accrued ||
    claimable !== redeemed - withdrawn ||
    pendingClaims !== accrued - redeemed ||
    actualClaims !== pendingClaims + donatedClaims ||
    imdBalance !== claimable + donations
  )
    throw Error("Companion bindings or treasury accounting mismatch");
  let personal: CandidateSnapshot["wallet"] = null;
  if (account) {
    const allowance = (token: Address) =>
      reader.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, PERMIT2],
        blockNumber: block.number,
      });
    const permit = (token: Address) =>
      reader.readContract({
        address: PERMIT2,
        abi: permitAbi,
        functionName: "allowance",
        args: [account, token, UNIVERSAL_ROUTER],
        blockNumber: block.number,
      });
    const [
      balanceUnlk,
      balanceImd,
      ethBalance,
      E,
      matureE,
      S,
      quota,
      buyBlock,
      claimed,
      attested,
      pendingReward,
      payer,
      imdApproval,
      unlkApproval,
      imdPermit,
      unlkPermit,
    ] = await Promise.all([
      balance(TOKEN, account),
      balance(IMD, account),
      reader.getBalance({ address: account, blockNumber: block.number }),
      hr("eligible", [account]),
      hr("spendableEligible", [account]),
      hr("sold", [account]),
      hr("remainingQuota", [account]),
      hr("buyCreditBlock", [account]),
      reader.readContract({
        address: DISTRIBUTOR,
        abi: distributorAbi,
        functionName: "claimed",
        args: [0n, account],
        blockNumber: block.number,
      }),
      reader.readContract({
        address: EVIDENCE,
        abi: evidenceAbi,
        functionName: "attested",
        args: [0n, account],
        blockNumber: block.number,
      }),
      activated ? hr("pendingRewardCredit", [account]) : null,
      hr("pendingPayerCredit"),
      allowance(IMD),
      allowance(TOKEN),
      permit(IMD),
      permit(TOKEN),
    ]);
    if (quota !== verifiedMatureQuota(E, matureE, S, BigInt(p), fullyUnlocked))
      throw Error("Contract quota does not match mature-credit ledger");
    personal = {
      address: account,
      balance: balanceUnlk,
      imdBalance: balanceImd,
      ethBalance,
      E,
      matureE,
      immatureE: BigInt(E) - BigInt(matureE),
      buyBlock,
      S,
      quota,
      sellable: fullyUnlocked
        ? balanceUnlk
        : balanceUnlk < quota
          ? balanceUnlk
          : quota,
      claimed: Boolean(claimed),
      attested: Boolean(attested),
      pendingReward,
      pendingPayer: same(payer[0], account) ? payer[1] : 0n,
      imdApproval,
      unlkApproval,
      permit2Allowance: imdPermit[0],
      permit2Expiration: imdPermit[1],
      unlkPermit: unlkPermit[0],
      unlkExpiration: unlkPermit[1],
    };
  }
  let fdv: bigint | null = null,
    oracleError: string | null = null;
  try {
    fdv = (await reader.readContract({
      address: ORACLE,
      abi: oracleAbi,
      functionName: "fdvUsd",
      blockNumber: block.number,
    })) as bigint;
  } catch {
    oracleError = activated
      ? "Oracle unavailable: pool, depth or ETH/USD validation failed. Open rights remain permanent."
      : "Gate FDV is unavailable until the owner binds the oracle at activation.";
  }
  if (Date.now() / 1000 - Number(block.timestamp) > 90)
    throw Error(
      "Mainnet snapshot became stale while reading. Refresh to retry.",
    );
  const r = round as CandidateSnapshot["round"];
  return {
    block: block.number,
    blockTime: block.timestamp,
    readAt: Date.now(),
    activated,
    p: Number(p),
    tier: Number(tier),
    fullyUnlocked: Boolean(fullyUnlocked),
    round: r,
    certified: Boolean(certified),
    swept: Boolean(swept),
    sqrtPrice: slot[0],
    protocolFee: slot[2],
    lpFee: slot[3],
    fdv,
    oracleError,
    wallet: personal,
    vault: {
      accrued,
      withdrawn,
      redeemed,
      claimable,
      pendingClaims,
      donations,
      donationsWithdrawn,
      unlkBalance,
      imdBalance,
      custodyImd,
      custodyUnlk,
      donatedClaims,
      actualClaims,
    },
  };
}
