// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {ImdSpotMath} from "./ImdSpotMath.sol";
import {ImdSeedDepth as SeedDepth} from "./ImdSeedDepth.sol";
import {IUnlkHookView} from "../interfaces/IIntegration.sol";
import {MainnetPins} from "./MainnetPins.sol";

interface IImdUsdSource {
    function priceUsd() external view returns (uint256);
}

/// @notice Instantaneous FDV for the exact bound official UNLK/IMD pool.
/// @dev No history, TWAP, confirmation or time filter. The stateless IMD/USD reference validates
/// current market state and feed freshness. A valid short-lived spike in either pool may open gates forever.
contract UnlkImdOracle {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 public constant MIN_SEED_QUOTE_CAPACITY = SeedDepth.MIN_SEED_QUOTE_CAPACITY;
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    uint128 public constant MIN_LIQUIDITY = 1e18;
    IPoolManager public immutable poolManager;
    IImdUsdSource public immutable feed;
    address public immutable hook;
    address public token;
    address public factory;
    PoolId public poolId;
    bool public bound;
    bool public tokenIs0;
    uint160 public rangeLower;
    uint160 public rangeUpper;
    int24 public rangeLowerTick;
    int24 public rangeUpperTick;

    error Unauthorized();
    error InvalidConfig();
    error InvalidOracle();
    event Bound(PoolId indexed poolId);

    constructor(IPoolManager manager_, IImdUsdSource feed_, address hook_) {
        if (address(manager_) == address(0) || address(feed_) == address(0) || hook_ == address(0)) {
            revert InvalidConfig();
        }
        poolManager = manager_;
        feed = feed_;
        hook = hook_;
    }

    /// @notice Called once by the hook inside `configureAndActivate`, with the pool and the factory's seed range
    /// it recorded in stage 1. The pool must be IMD against the token, fee 12500, this hook.
    function bind(PoolKey calldata key, address token_, int24 lower, int24 upper) external {
        if (msg.sender != hook || bound) revert Unauthorized();
        if (
            address(key.hooks) != hook || key.fee != 12500
                || !((Currency.unwrap(key.currency0) == MainnetPins.IMD_ADDRESS
                        && Currency.unwrap(key.currency1) == token_)
                    || (Currency.unwrap(key.currency1) == MainnetPins.IMD_ADDRESS
                        && Currency.unwrap(key.currency0) == token_)) || token_ == address(0)
                || token_ == MainnetPins.IMD_ADDRESS || key.tickSpacing != 60
                || Currency.unwrap(key.currency0) >= Currency.unwrap(key.currency1)
                || PoolId.unwrap(key.toId()) != PoolId.unwrap(IUnlkHookView(hook).poolKey().toId())
                || token_ != IUnlkHookView(hook).token()
                || address(poolManager) != address(IUnlkHookView(hook).poolManager())
                || lower != IUnlkHookView(hook).seedTickLower()
                || upper != IUnlkHookView(hook).seedTickUpper() || lower >= upper
        ) revert InvalidConfig();
        bound = true;
        token = token_;
        factory = IUnlkHookView(hook).launchFactory();
        tokenIs0 = Currency.unwrap(key.currency0) == token_;
        poolId = key.toId();
        rangeLower = TickMath.getSqrtPriceAtTick(lower);
        rangeUpper = TickMath.getSqrtPriceAtTick(upper);
        rangeLowerTick = lower;
        rangeUpperTick = upper;
        emit Bound(poolId);
    }

    function liquidityRangeTicks() external view returns (int24 lower, int24 upper) {
        return (rangeLowerTick, rangeUpperTick);
    }

    /// @notice USD with 18 decimals, using executed slot0.sqrtPriceX96 rather than the rounded tick.
    /// Both bound currencies have 18 decimals (verified at setup). Multiply the reference by the fixed
    /// whole-token supply BEFORE applying the pool ratio to avoid per-token rounding amplified by 1B.
    /// No history of unobserved touches is inferred. Call the hook's checkpoint to persist new gates.
    function fdvUsd() external view returns (uint256) {
        if (!bound) revert InvalidOracle();
        (uint160 sqrtPrice,,, uint24 lpFee) = poolManager.getSlot0(poolId);
        (uint128 liquidity,,) =
            poolManager.getPositionInfo(poolId, factory, rangeLowerTick, rangeUpperTick, bytes32(0));
        if (
            sqrtPrice == 0 || sqrtPrice < rangeLower || sqrtPrice > rangeUpper || liquidity < MIN_LIQUIDITY
                || SeedDepth.capacity(rangeLower, rangeUpper, liquidity, tokenIs0) < MIN_SEED_QUOTE_CAPACITY
                || lpFee != 12500
        ) revert InvalidOracle();
        uint256 imdUsd = feed.priceUsd();
        // The admitted source's ETH/USD cap and TickMath domain fit this bound. Reject nonsensical
        // adapters rather than overflowing. Source failures are caught by the hook, never by trading.
        if (imdUsd == 0 || imdUsd > type(uint256).max / (SUPPLY / 1 ether)) revert InvalidOracle();
        uint256 base = imdUsd * (SUPPLY / 1 ether);
        return ImdSpotMath.fdv(sqrtPrice, base, tokenIs0);
    }
}
