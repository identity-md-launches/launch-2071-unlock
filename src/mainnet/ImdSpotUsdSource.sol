// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MainnetPins} from "./MainnetPins.sol";
import {ImdSpotMath} from "./ImdSpotMath.sol";
import {IChainlinkEthUsd} from "../interfaces/IIntegration.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

/// @notice CURRENT-STATE IMD/USD: the existing hookless IMD/native-ETH v4 pool's instantaneous slot0 price,
/// composed with the validated canonical Chainlink ETH/USD feed. Stateless: no sampling, history, warm-up,
/// observation window, rate clamp, keeper, admin, setter, API or signer.
/// @dev NOT MANIPULATION RESISTANT. The spot can be moved inside one transaction (including a flash swap) and a
/// checkpoint taken in that state may permanently open UNLK gates, up to the $50M global bypass. The requester
/// explicitly accepted this; see docs/mainnet/SPOT_PRICE.md. NOT release approved.
contract ImdSpotUsdSource {
    using StateLibrary for IPoolManager;

    /// @notice PoolKey preimage of the existing IMD/ETH pool. Native ETH (address 0) always sorts first.
    address public constant CURRENCY0 = address(0);
    address public constant CURRENCY1 = MainnetPins.IMD_ADDRESS;
    uint24 public constant POOL_LP_FEE = 10000;
    int24 public constant POOL_TICK_SPACING = 200;
    address public constant POOL_HOOKS = address(0);
    /// @notice keccak256(abi.encode(PoolKey)) of the preimage above; checked by tests against the derivation.
    bytes32 public constant POOL_ID = 0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3;
    /// @notice IMD is currency1, so the pool price (currency1 per currency0) is IMD per ETH.
    bool public constant IMD_IS_0 = false;
    IChainlinkEthUsd public constant ethUsd = IChainlinkEthUsd(MainnetPins.ETHUSD_ADDRESS);
    uint256 public constant MAX_FEED_AGE = 90 minutes;
    uint256 public constant MAX_ETH_USD = 1_000_000e8;

    error InvalidPrice();
    error PoolUnavailable();

    /// @notice IMD price in USD with 18 decimals, floored, from current on-chain state only. Reverts on any invalid
    /// identity, pool or feed state; the hook catches that and only withholds NEW gate advancement.
    function priceUsd() external view returns (uint256 usdPerImd) {
        (uint160 sqrtPrice,) = _pool();
        // floor(ethUsd * 1e10 * ETH-per-IMD) where ETH-per-IMD = 2^192 / sqrtPrice^2 in this currency order.
        // ImdSpotMath is exact 512-bit math for both orders; a sqrtPrice above 2^128 cannot overflow.
        usdPerImd = ImdSpotMath.fdv(sqrtPrice, _ethUsd() * 1e10, IMD_IS_0);
        if (usdPerImd == 0) revert InvalidPrice();
    }

    /// @notice DISPLAY: the same current inputs, unvalidated by the hook. `ethPerImd` has 18 decimals.
    function spot()
        external
        view
        returns (
            uint256 usdPerImd,
            uint256 ethPerImd,
            uint160 sqrtPriceX96,
            uint128 liquidity,
            uint256 ethUsdPrice
        )
    {
        (sqrtPriceX96, liquidity) = _pool();
        ethPerImd = ImdSpotMath.fdv(sqrtPriceX96, 1e18, IMD_IS_0);
        ethUsdPrice = _ethUsd() * 1e10;
        usdPerImd = ImdSpotMath.fdv(sqrtPriceX96, ethUsdPrice, IMD_IS_0);
    }

    function _pool() private view returns (uint160 sqrtPrice, uint128 liquidity) {
        address manager = MainnetPins.MANAGER_ADDRESS;
        if (
            block.chainid != 1 || manager.codehash != MainnetPins.MANAGER
                || CURRENCY1.codehash != MainnetPins.IMD || IERC20Metadata(CURRENCY1).decimals() != 18
        ) revert PoolUnavailable();
        uint24 lpFee;
        (sqrtPrice,,, lpFee) = IPoolManager(manager).getSlot0(PoolId.wrap(POOL_ID));
        liquidity = IPoolManager(manager).getLiquidity(PoolId.wrap(POOL_ID));
        // Uninitialized pool, changed fee or no in-range liquidity: no reference. No depth floor or band is
        // applied, so no higher effective milestone is introduced.
        if (sqrtPrice == 0 || lpFee != POOL_LP_FEE || liquidity == 0) revert PoolUnavailable();
    }

    /// @return answer Validated ETH/USD with 8 decimals from the pinned canonical Chainlink proxy.
    function _ethUsd() private view returns (uint256) {
        if (address(ethUsd).codehash != MainnetPins.ETHUSD || ethUsd.decimals() != 8) revert InvalidPrice();
        (uint80 round, int256 answer, uint256 started, uint256 updated, uint80 answered) =
            ethUsd.latestRoundData();
        if (
            round == 0 || answer <= 0 || started == 0 || started > updated || updated > block.timestamp
                || answered < round || block.timestamp - updated > MAX_FEED_AGE
                || uint256(answer) > MAX_ETH_USD
        ) revert InvalidPrice();
        return uint256(answer);
    }
}
