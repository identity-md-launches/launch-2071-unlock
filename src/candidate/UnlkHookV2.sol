// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SeedDepth} from "../libraries/SeedDepth.sol";
import {UnlkToken} from "../UnlkToken.sol";
import {UnlkOracle} from "../UnlkOracle.sol";
import {
    IChainlinkEthUsd,
    IClaimEvidence,
    IRouteContext,
    IMerkleDistributor,
    IUnlkRouterView,
    ILaunchFactoryView,
    ILaunchRegistryView
} from "../interfaces/IIntegration.sol";
import {SepoliaRelease} from "../libraries/SepoliaRelease.sol";
import {ReviewedCodeV2 as ReviewedCode} from "./ReviewedCodeV2.sol";
import {SetupVerifierV2} from "./SetupVerifierV2.sol";
import {NftFeeVault} from "./NftFeeVault.sol";
import {NativeFeeMath} from "./NativeFeeMath.sol";
import {MerkleClaimEvidence} from "../MerkleClaimEvidence.sol";
import {OperationHash} from "../libraries/OperationHash.sol";

/// @notice UNDEPLOYED experimental fee/tier candidate. Standard-router attribution is unresolved.
/// @dev Not approved for release; see docs/candidate/COMPATIBILITY.md.
/// Immutable two-stage quota hook.
/// @dev STAGE 1: IMD's `LaunchFactory` deploys this hook by CREATE2 in the launch transaction with exactly four
/// constructor words (`$poolManager`, `$token`, `$factory`, `$owner`), initializes the official pool with this hook
/// in its PoolKey and seeds it. The hook binds that pool once and accepts the factory's liquidity, but it is
/// UNCONFIGURED: swaps, credit synchronization and milestone progression revert. Token transfers and native
/// distributor claims never touch this contract.
/// STAGE 2: the companions (router, claim evidence, oracle) are deployed against the real stage-1 addresses, then
/// the immutable setup authority (`$owner`) calls `configureAndActivate` once. Every check runs before any write;
/// success seals the configuration permanently. The authority can only stage and activate this reviewed bundle.
contract UnlkHookV2 is IHooks {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address public constant QUOTER = 0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227;
    bytes32 public constant QUOTER_CODEHASH =
        0xf481a751ac453d40c46d12360b85b05472028c1b113ab63749d69a5f8b0e47d1;
    bool private pendingQuote;

    uint24 public constant FEE = 12500;
    int24 public constant TICK_SPACING = 60;
    uint160 public constant FLAGS = 0x3fc4;
    uint256 public constant CONFIRMATION = 6 hours;
    uint256 public constant FINAL_CONFIRMATION = 24 hours;
    uint256 public constant MIN_CONFIRMATION_INTERVAL = 4 minutes;
    uint256 public constant MAX_CONFIRMATION_GAP = 10 minutes;
    /// @notice Published Chainlink ETH/USD proxy on Sepolia, required there. Other chains are local tests only.
    address public constant SEPOLIA_ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    uint256 public constant SEPOLIA_CHAIN_ID = 11155111;
    /// @notice Oracle settings the reviewed `UnlkOracle` fixes as constants; re-checked at activation.
    /// @dev The feed age is the published one-hour heartbeat plus a 30-minute grace: the Sepolia ETH/USD proxy was
    /// measured posting rounds 3624-3636 s apart, so a bare one-hour limit classed a healthy feed stale every hour.
    uint256 public constant ORACLE_MAX_FEED_AGE = 90 minutes;
    uint256 public constant ORACLE_MAX_CHECKPOINT_AGE = 5 minutes;
    uint128 public constant ORACLE_MIN_LIQUIDITY = 1e18;
    /// @notice The locked seed's minimum opening-value capacity (see `SeedDepth`). Enforced when the factory
    /// seeds, when the bundle is staged and when it is activated, so a seed the oracle would class illiquid
    /// forever can neither launch nor seal.
    uint256 public constant MIN_SEED_QUOTE_CAPACITY = SeedDepth.MIN_SEED_QUOTE_CAPACITY;
    /// @notice The pool must receive at least this much of its 87% share: a 1% band for the deployer's
    /// liquidity rounding, which is about 1e-14 relative in practice. The shortfall goes to the remainder
    /// wallet, which is still credited exactly `PAYER_ALLOCATION`. A pool seeded below the band cannot launch.
    uint256 public constant MIN_POOL_ALLOCATION = 861_300_000 ether;

    IPoolManager public immutable poolManager;
    UnlkToken public immutable token;
    address public immutable launchFactory;
    /// @notice The launch owner. It can stage the reviewed bundle once and activate it once.
    address public immutable setupAuthority;

    // Stage-1 binding, written once by `beforeInitialize`.
    /// @notice Always address(0): Uniswap v4's native ETH currency, not a missing address.
    address public quoteToken;
    PoolKey private _key;
    PoolId public poolId;
    bool public bound;
    int24 public seedTickLower;
    int24 public seedTickUpper;
    bool public seedRecorded;
    /// @notice The launch-token principal the factory's seed position holds, and its ETH value at the opening
    /// boundary, recorded when the factory seeds. The position can never shrink, so these stay true.
    uint256 public seedTokens;
    uint256 public seedQuoteCapacity;

    // Stage-2 configuration, written once by `configureAndActivate`.
    bool public activated;
    address public router;
    IClaimEvidence public rewards;
    UnlkOracle public oracle;
    uint64 public launchNumber;
    NftFeeVault public nftFeeVault;
    SetupVerifierV2 public setupVerifier;
    address public stagedRouter;
    address public stagedRewards;
    address public stagedOracle;
    bytes32 private stagedRouterHash;
    bytes32 private stagedRewardsHash;
    bytes32 private stagedOracleHash;
    uint64 public stagedLaunchNumber;
    /// @notice How many bundles have been staged. Staging may be repeated until activation; each attempt
    /// re-runs every stage-1 check and deploys a fresh identical bundle, so an abandoned bundle is inert.
    uint64 public stagings;
    address public swarm;
    /// @notice Proven recipient of the initial 3% allocation, independent of current balances and fee assignment.
    /// On an unpaid launch this is the treasury that actually received the remainder.
    address public payer;

    mapping(address => uint256) public eligible;
    mapping(address => uint256) public sold;
    mapping(address => uint256) public claimedCredit;
    bool public payerCredited;
    uint16 public p = 2000;
    bool public fullyUnlocked;
    uint8 public tier;
    uint64[16] public qualifyingSince;
    uint64 public lastConfirmation;
    bytes32 private pendingOperation;
    address private pendingTrader;

    error Unauthorized();
    error InvalidConfig();
    error InvalidPool();
    error InvalidRoute();
    error QuotaExceeded();
    error PrincipalLocked();
    error InvalidEvidence();
    error NotActivated();
    error AlreadyActivated();

    event TreasuryFee(address indexed trader, bool buy, uint256 executedEth, uint256 fee);

    event PoolBound(PoolId indexed id);
    event Activated(
        address indexed router,
        address indexed rewards,
        address indexed oracle,
        uint64 launchNumber,
        address payer
    );
    event Credit(address indexed recipient, uint256 amount, uint8 kind);
    event Sale(address indexed trader, uint256 amount);
    event Milestone(uint8 tier, uint16 p, bool fullyUnlocked, uint256 fdvUsd);

    /// @dev No external call and no code requirement: the launch checks run this constructor on an empty chain.
    constructor(IPoolManager manager_, UnlkToken token_, address launchFactory_, address setupAuthority_) {
        if (
            address(manager_) == address(0) || address(token_) == address(0) || launchFactory_ == address(0)
                || setupAuthority_ == address(0) || setupAuthority_ == launchFactory_
                || setupAuthority_ == address(token_) || setupAuthority_ == address(manager_)
        ) revert InvalidConfig();
        poolManager = manager_;
        token = token_;
        launchFactory = launchFactory_;
        setupAuthority = setupAuthority_;
        Hooks.validateHookPermissions(this, getHookPermissions());
    }

    modifier onlyManager() {
        if (msg.sender != address(poolManager)) revert Unauthorized();
        _;
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory h) {
        h.beforeInitialize = true;
        h.afterInitialize = true;
        h.beforeAddLiquidity = true;
        h.afterAddLiquidity = true;
        h.beforeRemoveLiquidity = true;
        h.afterRemoveLiquidity = true;
        h.beforeSwap = true;
        h.afterSwap = true;
        h.afterSwapReturnDelta = true;
    }

    function poolKey() external view returns (PoolKey memory) {
        return _key;
    }

    // ------------------------------------------------------------------ stage 1

    /// @dev Only the factory may open the pool, only once, only on the official key: native ETH as currency0,
    /// this token as currency1, fee 12500, spacing 60, this hook. Reads no companion, so it works before any
    /// exists. On Sepolia it also runs the same service pin check stage 2 runs (`_verifyServices`): a launch
    /// whose factory, manager, fees or registry stage 2 would refuse reverts here, in the launch transaction,
    /// instead of seeding a pool that can never activate.
    function beforeInitialize(address sender, PoolKey calldata key, uint160)
        external
        onlyManager
        returns (bytes4)
    {
        if (sender != launchFactory) revert Unauthorized();
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        if (
            bound || address(key.hooks) != address(this) || key.fee != FEE || key.tickSpacing != TICK_SPACING
                || c0 != address(0) || c1 != address(token)
        ) revert InvalidPool();
        _verifyServices();
        // Native ETH (currency0 == address(0)) always sorts first; the brief fixes an ETH pair.
        quoteToken = c0;
        bound = true;
        _key = key;
        poolId = key.toId();
        emit PoolBound(poolId);
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata key, uint160, int24)
        external
        onlyManager
        returns (bytes4)
    {
        _checkPool(key);
        return IHooks.afterInitialize.selector;
    }

    // ------------------------------------------------------------------ stage 2

    /// @notice Stage 2a: deploy exactly the reviewed creation code, with arguments derived here.
    /// Hashing the creation code proves constructor state as well as runtime. A runtime-only check cannot
    /// detect a lookalike whose custom constructor forged hidden credit mappings or oracle history.
    /// Every stage-1 precondition of `configureAndActivate` is evaluated here first, so a bundle is never
    /// staged for a launch that cannot activate. Until activation the authority may stage again (a fresh
    /// identical bundle under a new salt); after it, never. All writes roll back together on failure.
    function deployCompanions(uint64 number, IChainlinkEthUsd feed, bytes[5] calldata codes)
        external
        returns (address r, address e, address o)
    {
        if (msg.sender != setupAuthority) revert Unauthorized();
        if (activated) revert AlreadyActivated();
        if (
            keccak256(codes[0]) != ReviewedCode.ROUTER || keccak256(codes[1]) != ReviewedCode.EVIDENCE
                || keccak256(codes[2]) != ReviewedCode.ORACLE || keccak256(codes[3]) != ReviewedCode.VAULT
                || keccak256(codes[4]) != ReviewedCode.VERIFIER
        ) revert InvalidConfig();
        ++stagings;
        setupVerifier = SetupVerifierV2(_create(codes[4], _salt("verifier")));
        address distributor = _verifyLaunch(number);
        _verifyFeed(address(feed));
        r = _create(bytes.concat(codes[0], abi.encode(poolManager, address(this))), _salt("router"));
        e = _create(bytes.concat(codes[1], abi.encode(distributor, token)), _salt("evidence"));
        o = _create(bytes.concat(codes[2], abi.encode(poolManager, feed, address(this))), _salt("oracle"));
        nftFeeVault = NftFeeVault(
            payable(_create(bytes.concat(codes[3], abi.encode(poolManager, address(this))), _salt("vault")))
        );
        stagedRouter = r;
        stagedRewards = e;
        stagedOracle = o;
        stagedRouterHash = r.codehash;
        stagedRewardsHash = e.codehash;
        stagedOracleHash = o.codehash;
        stagedLaunchNumber = number;
        emit CompanionsDeployed(number, r, e, o);
    }

    event CompanionsDeployed(uint64 indexed number, address router, address rewards, address oracle);

    /// @dev A fresh salt per staging attempt, so a repeated staging never collides with an abandoned bundle.
    function _salt(bytes32 label) private view returns (bytes32) {
        return keccak256(abi.encode(label, stagings));
    }

    function _create(bytes memory code, bytes32 salt) private returns (address at) {
        assembly ("memory-safe") { at := create2(0, add(code, 32), mload(code), salt) }
        if (at == address(0)) revert InvalidConfig();
    }

    /// @dev The Sepolia service pins, checked at stage 1 (`beforeInitialize`) and at both stage-2 calls. The
    /// factory is checked first, so its `fees()` and `registry()` getters are only read from the pinned code.
    function _verifyServices() private view {
        if (block.chainid != SEPOLIA_CHAIN_ID) return;
        ILaunchFactoryView factory = ILaunchFactoryView(launchFactory);
        if (
            launchFactory.codehash != SepoliaRelease.FACTORY
                || address(poolManager).codehash != SepoliaRelease.MANAGER
                || factory.fees().codehash != SepoliaRelease.FEES
                || address(factory.registry()).codehash != SepoliaRelease.REGISTRY
        ) revert InvalidConfig();
    }

    /// @notice The single setup transaction. Verifies every companion against the actual stage-1 launch, then
    /// seals. All checks precede all writes, and any failure reverts the whole call, so a failed activation
    /// changes no state. Callable once, by the immutable setup authority only.
    function configureAndActivate(
        address router_,
        IClaimEvidence rewards_,
        UnlkOracle oracle_,
        uint64 launchNumber_
    ) external {
        if (msg.sender != setupAuthority) revert Unauthorized();
        if (activated) revert AlreadyActivated();
        if (!bound || !seedRecorded) revert InvalidPool();
        if (
            router_.code.length == 0 || address(rewards_).code.length == 0
                || address(oracle_).code.length == 0 || router_ == address(rewards_)
                || router_ == address(oracle_) || address(rewards_) == address(oracle_)
        ) revert InvalidConfig();

        if (launchNumber_ != stagedLaunchNumber) revert InvalidEvidence();
        if (
            router_ != stagedRouter || address(oracle_) != stagedOracle
                || router_.codehash != stagedRouterHash || address(oracle_).codehash != stagedOracleHash
        ) revert InvalidConfig();
        if (address(rewards_) != stagedRewards || address(rewards_).codehash != stagedRewardsHash) {
            revert InvalidEvidence();
        }
        address distributor = _verifyLaunch(launchNumber_);
        address requester = token.initialRecipient();

        // Claim evidence reads this launch's distributor for this token.
        if (rewards_.token() != address(token) || rewards_.distributor() != distributor) {
            revert InvalidEvidence();
        }
        if (!MerkleClaimEvidence(address(rewards_)).certified(0)) revert InvalidEvidence();

        // Router and oracle are bound immutably to this hook and this manager.
        if (
            IUnlkRouterView(router_).hook() != address(this)
                || address(IUnlkRouterView(router_).poolManager()) != address(poolManager)
        ) revert InvalidConfig();
        _verifyOracle(oracle_);

        activated = true;
        router = router_;
        rewards = rewards_;
        oracle = oracle_;
        launchNumber = launchNumber_;
        swarm = distributor;
        payer = requester;
        oracle_.bind(_key, address(token), seedTickLower, seedTickUpper);
        oracle_.checkpoint();
        emit Activated(router_, address(rewards_), address(oracle_), launchNumber_, requester);
    }

    /// @dev Stateless verifier is created from exact pinned creation code before any companion is staged.
    /// Moving setup-only checks out keeps this immutable hook below EIP-170. All failures are atomic.
    function _verifyLaunch(uint64 number) private view returns (address) {
        if (!bound || !seedRecorded) revert InvalidPool();
        _verifyServices();
        return setupVerifier.verify(address(this), number);
    }

    function _verifyFeed(address feed) private view {
        if (feed.code.length == 0 || IChainlinkEthUsd(feed).decimals() != 8) revert InvalidConfig();
        if (
            block.chainid == SEPOLIA_CHAIN_ID
                && (feed != SEPOLIA_ETH_USD || feed.codehash != SepoliaRelease.FEED)
        ) revert InvalidConfig();
    }

    function _verifyOracle(UnlkOracle oracle_) private view {
        if (
            oracle_.hook() != address(this) || address(oracle_.poolManager()) != address(poolManager)
                || oracle_.bound() || oracle_.MAX_FEED_AGE() != ORACLE_MAX_FEED_AGE
                || oracle_.MAX_CHECKPOINT_AGE() != ORACLE_MAX_CHECKPOINT_AGE
                || oracle_.MIN_LIQUIDITY() != ORACLE_MIN_LIQUIDITY || oracle_.WINDOW() != 2 hours
                || oracle_.MIN_SEED_QUOTE_CAPACITY() != MIN_SEED_QUOTE_CAPACITY
                || oracle_.SUPPLY() != token.SUPPLY()
        ) revert InvalidConfig();
        _verifyFeed(address(oracle_.feed()));
    }

    // ------------------------------------------------------------------ swaps

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata data)
        external
        onlyManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _checkPool(key);
        if (!activated) revert NotActivated();
        if (pendingOperation != bytes32(0)) revert InvalidRoute();
        if (sender == QUOTER) {
            // This exact, non-upgradeable Quoter always reverts its unlock callback. It cannot settle.
            // Generic quotes bypass wallet quota ONLY within that necessarily reverted simulation.
            if (sender.codehash != QUOTER_CODEHASH || data.length != 0) revert InvalidRoute();
            pendingQuote = true;
            pendingOperation = keccak256(abi.encode(key, params));
        } else {
            if (sender != router || data.length != 32) revert InvalidRoute();
            (address trader, bytes32 operation) = IRouteContext(router).context();
            uint256 nonce = abi.decode(data, (uint256));
            if (trader == address(0) || operation != OperationHash.hash(key, params, trader, nonce)) {
                revert InvalidRoute();
            }
            pendingTrader = trader;
            pendingOperation = operation;
        }
        // A later PoolManager protocol-fee change cannot silently change the promised total trading fee.
        (,, uint24 protocolFee, uint24 lpFee) = poolManager.getSlot0(poolId);
        if (protocolFee != 0 || lpFee != FEE) revert InvalidPool();
        oracle.checkpoint();
        return (IHooks.beforeSwap.selector, BeforeSwapDelta.wrap(0), 0);
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata data
    ) external onlyManager returns (bytes4, int128) {
        _checkPool(key);
        if (!activated) revert NotActivated();
        if (pendingQuote) {
            if (
                sender != QUOTER || sender.codehash != QUOTER_CODEHASH || data.length != 0
                    || pendingOperation != keccak256(abi.encode(key, params))
            ) revert InvalidRoute();
            delete pendingQuote;
            delete pendingOperation;
            uint256 quoteLeg =
                delta.amount0() < 0 ? uint256(-int256(delta.amount0())) : uint256(uint128(delta.amount0()));
            // Hypothetical return delta only: no credits, sales, vault accrual or actual payment.
            bool quoteNativeUnspecified = params.zeroForOne == (params.amountSpecified > 0);
            return (
                IHooks.afterSwap.selector,
                quoteNativeUnspecified ? int128(int256(NativeFeeMath.fee(quoteLeg))) : int128(0)
            );
        }
        address trader = pendingTrader;
        if (
            sender != router || trader == address(0) || data.length != 32
                || pendingOperation != OperationHash.hash(key, params, trader, abi.decode(data, (uint256)))
        ) revert InvalidRoute();
        delete pendingOperation;
        delete pendingTrader;
        int128 tokenDelta =
            Currency.unwrap(key.currency0) == address(token) ? delta.amount0() : delta.amount1();
        if (tokenDelta < 0) {
            uint256 q = uint256(-int256(tokenDelta));
            uint256 next = sold[trader] + q;
            if (!fullyUnlocked && next > Math.mulDiv(eligible[trader], p, 10000)) revert QuotaExceeded();
            sold[trader] = next;
            emit Sale(trader, q);
        } else if (tokenDelta > 0) {
            _credit(trader, uint256(uint128(tokenDelta)), 0);
        }
        oracle.checkpoint();
        // Feed failures and low liquidity never block swap settlement or native reward claims.
        _updateMilestone();
        uint256 leg =
            delta.amount0() < 0 ? uint256(-int256(delta.amount0())) : uint256(uint128(delta.amount0()));
        uint256 fee = NativeFeeMath.fee(leg);
        if (fee != 0) {
            // ERC-6909 claims need no pre-existing ETH on a fresh, token-only manager.
            poolManager.mint(address(nftFeeVault), 0, fee);
            nftFeeVault.recordAccrual(fee);
        }
        emit TreasuryFee(trader, params.zeroForOne, leg, fee);
        // v4 afterSwapReturnDelta can alter only the unspecified currency. When ETH is specified,
        // the authenticated experimental router settles this hook's fee debt explicitly. This is a
        // documented standard-router incompatibility, NEVER advertised as a UniversalRouter fix.
        bool nativeUnspecified = params.zeroForOne == (params.amountSpecified > 0);
        return (IHooks.afterSwap.selector, nativeUnspecified ? int128(int256(fee)) : int128(0));
    }

    // ------------------------------------------------------------------ liquidity

    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata
    ) external onlyManager returns (bytes4) {
        _checkPool(key);
        // All official-pool liquidity is the factory's seed; it has no removal path. No JIT fee diversion.
        if (sender != launchFactory) revert Unauthorized();
        if (!seedRecorded) _recordSeed(params);
        if (activated) oracle.checkpoint();
        return IHooks.beforeAddLiquidity.selector;
    }

    /// @dev The first position is the launch seed. It must be the policy's token-only principal (price at or
    /// above its range, so the range holds only UNLK) within the pool-share band, and worth at least the
    /// oracle's opening-value floor. A seed that fails here reverts the launch transaction itself, so a pool
    /// that could never activate is never created, let alone staged.
    function _recordSeed(ModifyLiquidityParams calldata params) private {
        if (params.liquidityDelta <= 0 || params.liquidityDelta > int256(uint256(type(uint128).max))) {
            revert InvalidPool();
        }
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(params.tickUpper);
        (uint160 sqrtPrice,,,) = poolManager.getSlot0(poolId);
        (uint256 principal, uint256 depth) = SeedDepth.quoteCapacity(
            TickMath.getSqrtPriceAtTick(params.tickLower), sqrtUpper, uint128(uint256(params.liquidityDelta))
        );
        if (
            sqrtPrice < sqrtUpper || principal < MIN_POOL_ALLOCATION || principal > token.POOL_ALLOCATION()
                || depth < MIN_SEED_QUOTE_CAPACITY
        ) revert InvalidPool();
        seedRecorded = true;
        seedTickLower = params.tickLower;
        seedTickUpper = params.tickUpper;
        seedTokens = principal;
        seedQuoteCapacity = depth;
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external onlyManager returns (bytes4, BalanceDelta) {
        _checkPool(key);
        if (activated) oracle.checkpoint();
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata
    ) external onlyManager returns (bytes4) {
        _checkPool(key);
        if (sender != launchFactory) revert Unauthorized();
        // Fee collection (zero delta) only: principal can never leave the pool.
        if (params.liquidityDelta != 0) revert PrincipalLocked();
        if (activated) oracle.checkpoint();
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external onlyManager returns (bytes4, BalanceDelta) {
        _checkPool(key);
        if (activated) oracle.checkpoint();
        return (IHooks.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }

    // Unrequested callbacks fail closed; neither callback has an address permission flag.
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        view
        onlyManager
        returns (bytes4)
    {
        revert Unauthorized();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        view
        onlyManager
        returns (bytes4)
    {
        revert Unauthorized();
    }

    // ------------------------------------------------------------------ credits

    /// @notice Credits the fixed 3% policy allocation to the recorded payer, once. Never a caller amount.
    function syncPayer() external returns (uint256 amount) {
        if (!activated) revert NotActivated();
        if (!payerCredited && payer != address(0)) {
            payerCredited = true;
            amount = token.PAYER_ALLOCATION();
            _credit(payer, amount, 1);
        }
    }

    function pendingPayerCredit() external view returns (address recipient, uint256 amount) {
        return (payer, payerCredited || payer == address(0) ? 0 : token.PAYER_ALLOCATION());
    }

    function pendingRewardCredit(address recipient) public view returns (uint256) {
        if (!activated) revert NotActivated();
        uint256 actual = rewards.claimed(recipient);
        if (actual < claimedCredit[recipient]) revert InvalidEvidence();
        return actual - claimedCredit[recipient];
    }

    /// @notice Anyone can help a rightful recipient. Claiming remains entirely native to the distributor, and
    /// claims made before activation are credited here afterwards.
    function syncRewards(address recipient) external returns (uint256 amount) {
        if (!activated) revert NotActivated();
        if (recipient == address(0)) revert InvalidEvidence();
        amount = pendingRewardCredit(recipient);
        claimedCredit[recipient] += amount;
        if (amount != 0) _credit(recipient, amount, 2);
    }

    function remainingQuota(address trader) external view returns (uint256) {
        if (fullyUnlocked) return type(uint256).max;
        uint256 cap = Math.mulDiv(eligible[trader], p, 10000);
        return cap > sold[trader] ? cap - sold[trader] : 0;
    }

    // ------------------------------------------------------------------ milestones

    function updateMilestone() external returns (bool) {
        if (!activated) revert NotActivated();
        oracle.checkpoint();
        return _updateMilestone();
    }

    function tierThreshold(uint8 index) public pure returns (uint256) {
        uint256[16] memory thresholds = [
            uint256(100000),
            250000,
            500000,
            1000000,
            2000000,
            3500000,
            5000000,
            7500000,
            10000000,
            15000000,
            20000000,
            25000000,
            30000000,
            35000000,
            40000000,
            50000000
        ];
        if (index >= 16) revert InvalidConfig();
        return thresholds[index] * 1 ether;
    }

    function tierForFdv(uint256 fdv) public pure returns (uint8) {
        for (uint8 i; i < 16; ++i) {
            if (fdv < tierThreshold(i)) return i;
        }
        return 16;
    }

    function _updateMilestone() private returns (bool changed) {
        if (fullyUnlocked) return false;
        uint256 fdv;
        try oracle.fdvUsd() returns (uint256 value) {
            fdv = value;
        } catch {
            // An invalid sample is not a sample: it never confirms, never advances `lastConfirmation`, and
            // preserves earned tiers and the visible pending start. Whether it restarts the run is decided
            // only by the gap between valid samples below, exactly as if nobody had called, so a call made
            // during routine feed lateness cannot discard confirmation that an uncalled interval would keep.
            return false;
        }
        uint8 next = tier;
        if (tierForFdv(fdv) <= next) {
            qualifyingSince[next] = 0;
            lastConfirmation = 0;
            return false;
        }
        uint256 gap = block.timestamp - lastConfirmation;
        if (qualifyingSince[next] == 0 || gap > MAX_CONFIRMATION_GAP) {
            qualifyingSince[next] = uint64(block.timestamp);
            lastConfirmation = uint64(block.timestamp);
            return false;
        }
        if (gap < MIN_CONFIRMATION_INTERVAL) return false;
        lastConfirmation = uint64(block.timestamp);
        uint256 required = next == 15 ? FINAL_CONFIRMATION : CONFIRMATION;
        if (block.timestamp - qualifyingSince[next] < required) return false;
        // Exactly one tier per confirmation. A high price cannot start later tiers in parallel.
        tier = next + 1;
        p = 2000 + uint16(tier) * 500;
        if (tier == 16) {
            fullyUnlocked = true;
        } else if (tierForFdv(fdv) > tier) {
            qualifyingSince[tier] = uint64(block.timestamp);
        } else {
            // The next tier's clock cannot start while this sample is below its own threshold.
            lastConfirmation = 0;
        }
        emit Milestone(tier, p, fullyUnlocked, fdv);
        return true;
    }

    function _credit(address recipient, uint256 amount, uint8 kind) private {
        eligible[recipient] += amount;
        emit Credit(recipient, amount, kind);
    }

    function _checkPool(PoolKey calldata key) private view {
        if (!bound || PoolId.unwrap(key.toId()) != PoolId.unwrap(poolId)) revert InvalidPool();
    }
}
