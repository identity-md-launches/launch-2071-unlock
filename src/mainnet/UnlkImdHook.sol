// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ImdSeedDepth as SeedDepth} from "./ImdSeedDepth.sol";
import {UnlkToken} from "../UnlkToken.sol";
import {UnlkImdOracle, IImdUsdSource} from "./UnlkImdOracle.sol";
import {IClaimEvidence, ILaunchFactoryView} from "../interfaces/IIntegration.sol";
import {MainnetPins} from "./MainnetPins.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ImdReviewedCode as ReviewedCode} from "./ImdReviewedCode.sol";
import {ImdSetupVerifier} from "./ImdSetupVerifier.sol";
import {ImdFeeVault} from "./ImdFeeVault.sol";
import {SuccessorFeeMath} from "../successor/SuccessorFeeMath.sol";
import {MerkleClaimEvidence} from "../MerkleClaimEvidence.sol";

/// @notice The deployed Universal Router's logical executor: the account that called `execute`.
interface IUniversalRouterLocker {
    function msgSender() external view returns (address);
}

/// @notice UNDEPLOYED successor candidate: standard Universal Router compatibility with an INITIATOR ledger.
/// @dev Pending independent review; see docs/mainnet/DESIGN.md. Immutable two-stage quota hook.
/// INITIATOR LEDGER: every official-pool swap executed by the pinned Universal Router is attributed to the
/// router's own `msgSender()` (the EOA or smart account that called `execute`). Buys credit that initiator's
/// eligible balance E; sells consume that initiator's quota S. Where the router later delivers output (TAKE
/// recipient) and who funded the input (Permit2, prefunding) are NOT observed and NOT proven. Token
/// transfers never move E or S.
/// TREASURY: fixed75bps of the executed IMD leg, settled as IMD manager claims through return deltas.
/// Only complete fills inside the seed range settle; see `SuccessorFeeMath` and the mainnet design.
/// @dev STAGE 1: IMD's `LaunchFactory` deploys this hook by CREATE2 in the launch transaction with exactly four
/// constructor words (`$poolManager`, `$token`, `$factory`, `$owner`), initializes the official pool with this hook
/// in its PoolKey and seeds it. The hook binds that pool once and accepts the factory's liquidity, but it is
/// UNCONFIGURED: swaps, credit synchronization and milestone progression revert. Token transfers and native
/// distributor claims never touch this contract.
/// STAGE 2: the companions (claim evidence, oracle, fee vault) are deployed against the real stage-1 addresses, then
/// the immutable setup authority (`$owner`) calls `configureAndActivate` once. Every check runs before any write;
/// success seals the configuration permanently. The authority can only stage and activate this reviewed bundle.
contract UnlkImdHook is IHooks {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    address public constant QUOTER = MainnetPins.QUOTER_ADDRESS;
    bytes32 public constant QUOTER_CODEHASH = MainnetPins.QUOTER;
    address public constant UNIVERSAL_ROUTER = MainnetPins.ROUTER_ADDRESS;
    bytes32 public constant UNIVERSAL_ROUTER_CODEHASH = MainnetPins.ROUTER;
    bool private pendingQuote;

    uint24 public constant FEE = 12500;
    int24 public constant TICK_SPACING = 60;
    uint160 public constant FLAGS = 0x3fcc;
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
    address public constant quoteToken = MainnetPins.IMD_ADDRESS;
    bool public tokenIs0;
    PoolKey private _key;
    PoolId public poolId;
    bool public bound;
    int24 public seedTickLower;
    int24 public seedTickUpper;
    bool public seedRecorded;
    /// @notice Locked UNLK principal and raw IMD value at the token-only opening boundary.
    /// Recorded when the factory seeds; that principal position cannot shrink.
    uint256 public seedTokens;
    uint256 public seedQuoteCapacity;

    // Stage-2 configuration, written once by `configureAndActivate`.
    bool public activated;
    IClaimEvidence public rewards;
    UnlkImdOracle public oracle;
    uint64 public launchNumber;
    ImdFeeVault public nftFeeVault;
    ImdSetupVerifier public setupVerifier;
    address public stagedRewards;
    address public stagedOracle;
    address public stagedPriceSource;
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
    /// @notice E is still cumulative acquisitions. Only this block's BUY credit is temporarily unspendable.
    /// No transfers of rights; mature credits and native allocation/claim credits are unaffected.
    mapping(address => uint256) public buyCreditBlock;
    mapping(address => uint256) public immatureBuyCredit;
    mapping(address => uint256) public claimedCredit;
    bool public payerCredited;
    uint16 public p = 2000;
    bool public fullyUnlocked;
    uint8 public tier;
    bytes32 private pendingOperation;
    address private pendingInitiator;
    uint256 private pendingSpecifiedFee;

    error Unauthorized();
    error InvalidConfig();
    error InvalidPool();
    error InvalidRoute();
    error QuotaExceeded();
    error PrincipalLocked();
    error InvalidEvidence();
    error NotActivated();
    error AlreadyActivated();
    error PartialFill();

    event TreasuryFee(address indexed initiator, bool buy, bool exactInput, uint256 executedImd, uint256 fee);

    event PoolBound(PoolId indexed id);
    event Activated(address indexed rewards, address indexed oracle, uint64 launchNumber, address payer);
    /// @notice kind 0: official buy credited to the INITIATOR (not necessarily the token recipient);
    /// kind 1: proven 3% payer allocation; kind 2: proven native distributor claim.
    event Credit(address indexed recipient, uint256 amount, uint8 kind);
    /// @notice Quota consumed by the INITIATOR (not necessarily the token source).
    event Sale(address indexed initiator, uint256 amount);
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
        h.beforeSwapReturnDelta = true;
        h.afterSwapReturnDelta = true;
    }

    function poolKey() external view returns (PoolKey memory) {
        return _key;
    }

    // ------------------------------------------------------------------ stage 1

    /// @notice Bind once to the official sorted UNLK/IMD key, fee12500 and spacing60.
    /// Only the constructor-bound factory may initialize. Binding and seeding need no companions
    /// or production service attestation. Every setup entry point attests the mainnet services;
    /// activation repeats that attestation before enabling trading, credits or milestones.
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
                || c0 >= c1
                || !((c0 == quoteToken && c1 == address(token)) || (c1 == quoteToken && c0 == address(token)))
        ) revert InvalidPool();
        tokenIs0 = c0 == address(token);
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
    /// Stage-1 service, record, allocation and principal checks run before companion deployment.
    /// Current source validity and claim certification are additionally required at activation.
    /// Before activation the authority may stage a fresh pinned bundle; after it, never. Failure is atomic.
    /// No custom router is staged: the execution route is the pinned, immutable Universal Router.
    function deployCompanions(uint64 number, IImdUsdSource feed, bytes[4] calldata codes)
        external
        returns (address e, address o, address v)
    {
        if (msg.sender != setupAuthority) revert Unauthorized();
        if (activated) revert AlreadyActivated();
        if (
            keccak256(codes[0]) != ReviewedCode.EVIDENCE || keccak256(codes[1]) != ReviewedCode.ORACLE
                || keccak256(codes[2]) != ReviewedCode.VAULT || keccak256(codes[3]) != ReviewedCode.VERIFIER
        ) revert InvalidConfig();
        ++stagings;
        setupVerifier = ImdSetupVerifier(_create(codes[3], _salt("verifier")));
        address distributor = _verifyLaunch(number);
        _verifyFeed(address(feed));
        e = _create(bytes.concat(codes[0], abi.encode(distributor, token)), _salt("evidence"));
        o = _create(bytes.concat(codes[1], abi.encode(poolManager, feed, address(this))), _salt("oracle"));
        v = _create(
            bytes.concat(codes[2], abi.encode(poolManager, address(this), IERC20Metadata(quoteToken))),
            _salt("vault")
        );
        nftFeeVault = ImdFeeVault(payable(v));
        stagedRewards = e;
        stagedOracle = o;
        stagedRewardsHash = e.codehash;
        stagedOracleHash = o.codehash;
        stagedLaunchNumber = number;
        emit CompanionsDeployed(number, e, o, v);
    }

    /// @notice Deploy a price adapter from reviewed code and explicit immutable venue parameters.
    /// Can be restaged only before activation; no active configuration ever changes.
    function deployPriceSource(bytes calldata code, bytes calldata args) external returns (address at) {
        if (msg.sender != setupAuthority) revert Unauthorized();
        if (activated) revert AlreadyActivated();
        if (keccak256(code) != ReviewedCode.PRICE_SOURCE || args.length != 0) revert InvalidConfig();
        _verifyServices();
        at = _create(bytes.concat(code, args), keccak256(abi.encode("price", ++stagings)));
        stagedPriceSource = at;
    }

    event CompanionsDeployed(uint64 indexed number, address rewards, address oracle, address vault);

    /// @dev A fresh salt per staging attempt, so a repeated staging never collides with an abandoned bundle.
    function _salt(bytes32 label) private view returns (bytes32) {
        return keccak256(abi.encode(label, stagings));
    }

    function _create(bytes memory code, bytes32 salt) private returns (address at) {
        assembly ("memory-safe") { at := create2(0, add(code, 32), mload(code), salt) }
        if (at == address(0)) revert InvalidConfig();
    }

    /// factory is checked first, so its `fees()` and `registry()` getters are only read from the pinned code.
    function _verifyServices() private view {
        ILaunchFactoryView factory = ILaunchFactoryView(launchFactory);
        if (
            block.chainid != 1 || launchFactory != MainnetPins.FACTORY_ADDRESS
                || address(poolManager) != MainnetPins.MANAGER_ADDRESS
                || launchFactory.codehash != MainnetPins.FACTORY
                || address(poolManager).codehash != MainnetPins.MANAGER
                || factory.fees() != MainnetPins.FEES_ADDRESS || factory.fees().codehash != MainnetPins.FEES
                || address(factory.registry()) != MainnetPins.REGISTRY_ADDRESS
                || address(factory.registry()).codehash != MainnetPins.REGISTRY
                || quoteToken.codehash != MainnetPins.IMD || IERC20Metadata(quoteToken).decimals() != 18
                || UNIVERSAL_ROUTER.codehash != UNIVERSAL_ROUTER_CODEHASH
                || QUOTER.codehash != QUOTER_CODEHASH
                || MainnetPins.PERMIT2_ADDRESS.codehash != MainnetPins.PERMIT2
        ) revert InvalidConfig();
    }

    /// @notice The single setup transaction. Verifies every companion against the actual stage-1 launch, then
    /// seals. All checks precede all writes, and any failure reverts the whole call, so a failed activation
    /// changes no state. Callable once, by the immutable setup authority only.
    function configureAndActivate(IClaimEvidence rewards_, UnlkImdOracle oracle_, uint64 launchNumber_)
        external
    {
        if (msg.sender != setupAuthority) revert Unauthorized();
        if (activated) revert AlreadyActivated();
        if (!bound || !seedRecorded) revert InvalidPool();
        if (
            address(rewards_).code.length == 0 || address(oracle_).code.length == 0
                || address(rewards_) == address(oracle_)
        ) revert InvalidConfig();

        if (launchNumber_ != stagedLaunchNumber) revert InvalidEvidence();
        if (address(oracle_) != stagedOracle || address(oracle_).codehash != stagedOracleHash) {
            revert InvalidConfig();
        }
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

        _verifyOracle(oracle_);
        if (oracle_.feed().priceUsd() == 0) revert InvalidConfig();

        activated = true;
        rewards = rewards_;
        oracle = oracle_;
        launchNumber = launchNumber_;
        swarm = distributor;
        payer = requester;
        oracle_.bind(_key, address(token), seedTickLower, seedTickUpper);
        emit Activated(address(rewards_), address(oracle_), launchNumber_, requester);
    }

    /// @dev Stateless verifier is created from exact pinned creation code before any companion is staged.
    /// Moving setup-only checks out keeps this immutable hook below EIP-170. All failures are atomic.
    function _verifyLaunch(uint64 number) private view returns (address) {
        if (!bound || !seedRecorded) revert InvalidPool();
        _verifyServices();
        return setupVerifier.verify(address(this), number);
    }

    function _verifyFeed(address feed) private view {
        // Adapter creation code is pinned separately from venue configuration. The adapter validates
        // its immutable market/feed identities and current state on every reading, including activation.
        if (feed.code.length == 0) revert InvalidConfig();
        // Source is required to be the exact reviewed adapter with canonical constructor arguments.
        if (feed != stagedPriceSource) revert InvalidConfig();
    }

    function _verifyOracle(UnlkImdOracle oracle_) private view {
        if (
            oracle_.hook() != address(this) || address(oracle_.poolManager()) != address(poolManager)
                || oracle_.bound() || oracle_.MIN_LIQUIDITY() != ORACLE_MIN_LIQUIDITY
                || oracle_.MIN_SEED_QUOTE_CAPACITY() != MIN_SEED_QUOTE_CAPACITY
                || oracle_.SUPPLY() != token.SUPPLY()
        ) revert InvalidConfig();
        _verifyFeed(address(oracle_.feed()));
    }

    // ------------------------------------------------------------------ swaps

    /// @dev Accepted senders: the pinned Universal Router (settling execution) and the pinned Quoter (always
    /// reverted simulation). hookData is ignored: it can neither name an identity nor change accounting.
    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
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
            if (sender.codehash != QUOTER_CODEHASH) revert InvalidRoute();
            pendingQuote = true;
        } else {
            if (sender != UNIVERSAL_ROUTER || sender.codehash != UNIVERSAL_ROUTER_CODEHASH) {
                revert InvalidRoute();
            }
            // The router's own lock owner: set for the whole `execute` call, which is not reentrant.
            address initiator = IUniversalRouterLocker(sender).msgSender();
            if (initiator == address(0)) revert InvalidRoute();
            pendingInitiator = initiator;
        }
        pendingOperation = keccak256(abi.encode(sender, key, params));
        // Uniswap governance controls its protocol fee independently. Core accounts for that charge;
        // it must not become a launch-wide pause. Keep the launch LP fee and IMD hook fee unchanged.
        (,,, uint24 lpFee) = poolManager.getSlot0(poolId);
        if (lpFee != FEE) revert InvalidPool();
        uint256 specifiedFee = _specifiedFee(params);
        pendingSpecifiedFee = specifiedFee;
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(int128(int256(specifiedFee)), 0), 0);
    }

    function _specifiedFee(SwapParams calldata params) private view returns (uint256 fee) {
        if (params.amountSpecified == type(int256).min) revert InvalidRoute();
        bool buy = params.zeroForOne != tokenIs0;
        if (buy && params.amountSpecified < 0) {
            uint256 base;
            (base, fee) = SuccessorFeeMath.exactInputBuyFee(uint256(-params.amountSpecified));
            if (base == 0) revert InvalidRoute();
        } else if (!buy && params.amountSpecified > 0) {
            uint256 gross;
            (gross, fee) = SuccessorFeeMath.exactOutputSellFee(uint256(params.amountSpecified));
            if (gross > uint256(uint128(type(int128).max))) revert InvalidRoute();
        }
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyManager returns (bytes4, int128) {
        _checkPool(key);
        if (!activated) revert NotActivated();
        if (pendingOperation != keccak256(abi.encode(sender, key, params))) revert InvalidRoute();
        uint256 specifiedFee = pendingSpecifiedFee;
        address initiator = pendingInitiator;
        bool quote = pendingQuote;
        delete pendingOperation;
        delete pendingInitiator;
        delete pendingSpecifiedFee;
        delete pendingQuote;
        _requireCompleteFill(params, delta, specifiedFee);
        (uint256 leg, uint256 fee, int128 unspecifiedReturn) = _fee(params, delta, specifiedFee);
        // Hypothetical result only: no E/S, oracle progress, vault accrual or fee claim. The hook's fee delta
        // stays unsettled, so even a hypothetical non-reverting quote could not finish its unlock.
        if (quote) return (IHooks.afterSwap.selector, unspecifiedReturn);
        // Validate the actual executed sale using ONLY the gate already open. This swap's post-price
        // cannot retroactively authorize its own sale. An earlier successful swap/checkpoint can.
        _account(initiator, tokenIs0 ? delta.amount0() : delta.amount1());
        // Feed failures and low liquidity never block swap settlement or native reward claims.
        _updateMilestone();
        if (fee != 0) {
            poolManager.mint(address(nftFeeVault), uint160(quoteToken), fee);
            nftFeeVault.recordAccrual(fee);
        }
        emit TreasuryFee(initiator, params.zeroForOne != tokenIs0, params.amountSpecified < 0, leg, fee);
        return (IHooks.afterSwap.selector, unspecifiedReturn);
    }

    function _fee(SwapParams calldata params, BalanceDelta delta, uint256 specifiedFee)
        private
        view
        returns (uint256 leg, uint256 fee, int128 unspecifiedReturn)
    {
        int128 eth = tokenIs0 ? delta.amount1() : delta.amount0();
        leg = eth < 0 ? uint256(-int256(eth)) : uint256(uint128(eth));
        if ((params.zeroForOne != tokenIs0) == (params.amountSpecified < 0)) {
            fee = specifiedFee;
        } else {
            fee = SuccessorFeeMath.unspecifiedFee(leg);
            unspecifiedReturn = int128(int256(fee));
        }
    }

    /// @dev The initiator's ledger. A sale consumes quota; a buy credits the pool's executed token output.
    function _account(address initiator, int128 tokenDelta) private {
        if (tokenDelta < 0) {
            uint256 q = uint256(-int256(tokenDelta));
            uint256 next = sold[initiator] + q;
            if (!fullyUnlocked && next > Math.mulDiv(spendableEligible(initiator), p, 10000)) {
                revert QuotaExceeded();
            }
            sold[initiator] = next;
            emit Sale(initiator, q);
        } else if (tokenDelta > 0) {
            _credit(initiator, uint256(uint128(tokenDelta)), 0);
        }
    }

    /// @dev Only complete fills inside the locked seed range settle. A standard route uses the extreme price
    /// limit, so a partial fill means the seed was exhausted and the price walked into empty liquidity, which
    /// the oracle classes illiquid. Rejecting it atomically also means no fee is ever charged on volume the
    function _requireCompleteFill(SwapParams calldata params, BalanceDelta delta, uint256 specifiedFee)
        private
        view
    {
        bool exactInput = params.amountSpecified < 0;
        int128 specified = params.zeroForOne == exactInput ? delta.amount0() : delta.amount1();
        // The pool ran `amountSpecified + specifiedFee` (v4 adds the hook's specified delta) and must finish it.
        if (int256(specified) != params.amountSpecified + int256(specifiedFee)) revert PartialFill();
        (uint160 price,,,) = poolManager.getSlot0(poolId);
        if (
            price < TickMath.getSqrtPriceAtTick(seedTickLower)
                || price > TickMath.getSqrtPriceAtTick(seedTickUpper)
        ) revert PartialFill();
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
        return IHooks.beforeAddLiquidity.selector;
    }

    /// @dev The first position must hold only UNLK at the appropriate range boundary for its sorting:
    /// at/below the lower boundary for token0, at/above the upper boundary for token1.
    /// Verify the pool-share principal band and a nonzero raw IMD opening value; no ETH-value floor.
    function _recordSeed(ModifyLiquidityParams calldata params) private {
        if (params.liquidityDelta <= 0 || params.liquidityDelta > int256(uint256(type(uint128).max))) {
            revert InvalidPool();
        }
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(params.tickUpper);
        (uint160 sqrtPrice,,,) = poolManager.getSlot0(poolId);
        (uint256 principal, uint256 depth) = SeedDepth.quoteCapacity(
            TickMath.getSqrtPriceAtTick(params.tickLower),
            sqrtUpper,
            uint128(uint256(params.liquidityDelta)),
            tokenIs0
        );
        if (
            (tokenIs0 ? sqrtPrice > TickMath.getSqrtPriceAtTick(params.tickLower) : sqrtPrice < sqrtUpper)
                || principal < MIN_POOL_ALLOCATION || principal > token.POOL_ALLOCATION()
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
        uint256 cap = Math.mulDiv(spendableEligible(trader), p, 10000);
        return cap > sold[trader] ? cap - sold[trader] : 0;
    }

    /// @notice A buy cannot create spendable sale capacity in its own block, across ALL router calls/UIs.
    /// This stops atomic buy-credit recycling, not shared executors spending already mature pooled rights.
    function spendableEligible(address trader) public view returns (uint256) {
        return eligible[trader] - (block.number <= buyCreditBlock[trader] ? immatureBuyCredit[trader] : 0);
    }

    // ------------------------------------------------------------------ milestones

    /// @notice Permissionless evaluation of current official pool state; no caller-supplied price.
    /// Observations happen here and after each successful swap, including multiple swaps in one transaction.
    function checkpoint() public returns (bool) {
        if (!activated) revert NotActivated();
        return _updateMilestone();
    }

    /// @notice Backward-compatible entry point for existing keeper integrations.
    function updateMilestone() external returns (bool) {
        return checkpoint();
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
            // Invalid reference or pool state prevents NEW advancement only. Never revoke earned rights
            // or block within-quota trading, unrestricted token transfers or independent native claims.
            return false;
        }
        uint8 next = tierForFdv(fdv);
        if (next <= tier) return false;
        // Open every crossed door immediately, once, for everyone. Neither E nor S is changed here.
        tier = next;
        p = 2000 + uint16(next) * 500;
        if (next == 16) fullyUnlocked = true;
        emit Milestone(next, p, fullyUnlocked, fdv);
        return true;
    }

    function _credit(address recipient, uint256 amount, uint8 kind) private {
        eligible[recipient] += amount;
        if (kind == 0) {
            if (buyCreditBlock[recipient] < block.number) {
                buyCreditBlock[recipient] = block.number;
                immatureBuyCredit[recipient] = amount;
            } else {
                immatureBuyCredit[recipient] += amount;
            }
        }
        emit Credit(recipient, amount, kind);
    }

    function _checkPool(PoolKey calldata key) private view {
        if (!bound || PoolId.unwrap(key.toId()) != PoolId.unwrap(poolId)) revert InvalidPool();
    }
}
