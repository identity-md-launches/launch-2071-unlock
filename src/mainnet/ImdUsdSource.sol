// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {IChainlinkEthUsd} from "../interfaces/IIntegration.sol";
import {MainnetPins} from "./MainnetPins.sol";

interface IV3OraclePool {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function liquidity() external view returns (uint128);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory ticks, uint160[] memory secondsPerLiquidity);
}

interface IV3Factory {
    function getPool(address, address, uint24) external view returns (address);
}

/// @notice On-chain IMD/WETH v3 TWAP * verified Ethereum ETH/USD. No spot or UNLK input.
/// @dev No suitable IMD/WETH v3 venue has been established in this delivery: release BLOCKED.
/// This adapter is implemented for a future evidenced venue, not evidence such a venue exists.
/// Constructor has no external calls. Every read checks canonical pool identity, 2h and 24h history,
/// harmonic AND current depth, cross-window divergence, and Chainlink round freshness.
/// Neither TWAP nor these gates guarantees resistance to sustained cross-market manipulation.
contract ImdUsdSource {
    address public constant V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    uint32 public constant WINDOW = 2 hours;
    uint32 public constant LONG_WINDOW = 24 hours;
    uint256 public constant MAX_FEED_AGE = 90 minutes;
    uint256 public constant MAX_DIVERGENCE_BPS = 2000;
    IV3OraclePool public immutable pool;
    bytes32 public immutable poolCodehash;
    uint128 public immutable minimumHarmonicLiquidity;
    uint256 public immutable deployedAt;
    IChainlinkEthUsd public constant ethUsd = IChainlinkEthUsd(MainnetPins.ETHUSD_ADDRESS);

    error InvalidPrice();

    constructor(IV3OraclePool pool_, bytes32 expectedCodehash, uint128 minLiquidity) {
        if (address(pool_) == address(0) || expectedCodehash == bytes32(0) || minLiquidity == 0) {
            revert InvalidPrice();
        }
        pool = pool_;
        poolCodehash = expectedCodehash;
        minimumHarmonicLiquidity = minLiquidity;
        deployedAt = block.timestamp;
    }

    function priceUsd() external view returns (uint256) {
        if (
            block.timestamp < deployedAt + LONG_WINDOW || address(pool).codehash != poolCodehash
                || address(ethUsd).codehash != MainnetPins.ETHUSD || ethUsd.decimals() != 8
                || pool.factory() != V3_FACTORY
        ) revert InvalidPrice();
        address t0 = pool.token0();
        address t1 = pool.token1();
        if (
            !((t0 == MainnetPins.IMD_ADDRESS && t1 == WETH) || (t1 == MainnetPins.IMD_ADDRESS && t0 == WETH))
                || IV3Factory(V3_FACTORY).getPool(t0, t1, pool.fee()) != address(pool)
                || pool.liquidity() < minimumHarmonicLiquidity
        ) revert InvalidPrice();
        uint32[] memory ago = new uint32[](3);
        ago[0] = LONG_WINDOW;
        ago[1] = WINDOW;
        (int56[] memory ticks, uint160[] memory secondsPerLiquidity) = pool.observe(ago);
        if (ticks.length != 3 || secondsPerLiquidity.length != 3) revert InvalidPrice();
        uint256 shortPrice =
            _consult(ticks[1], ticks[2], secondsPerLiquidity[1], secondsPerLiquidity[2], WINDOW, t0);
        uint256 longPrice =
            _consult(ticks[0], ticks[2], secondsPerLiquidity[0], secondsPerLiquidity[2], LONG_WINDOW, t0);
        uint256 diff = shortPrice > longPrice ? shortPrice - longPrice : longPrice - shortPrice;
        if (shortPrice == 0 || longPrice == 0 || Math.mulDiv(diff, 10000, longPrice) > MAX_DIVERGENCE_BPS) {
            revert InvalidPrice();
        }
        (uint80 round, int256 answer, uint256 started, uint256 updated, uint80 answered) =
            ethUsd.latestRoundData();
        if (
            round == 0 || answer <= 0 || started == 0 || started > updated || updated > block.timestamp
                || answered < round || block.timestamp - updated > MAX_FEED_AGE
                || uint256(answer) > 1_000_000 * 1e8
        ) revert InvalidPrice();
        // Conservative cross-window price. A true IMD depeg flows into USD valuation; no $1 assumption.
        uint256 imdEth = shortPrice < longPrice ? shortPrice : longPrice;
        return Math.mulDiv(imdEth, uint256(answer) * 1e10, 1e18);
    }

    function _consult(
        int56 startTick,
        int56 endTick,
        uint160 startLiquidity,
        uint160 endLiquidity,
        uint32 duration,
        address token0
    ) private view returns (uint256) {
        int56 deltaTick;
        uint160 deltaLiquidity;
        // Canonical v3 accumulators deliberately wrap in their fixed widths.
        unchecked {
            deltaTick = endTick - startTick;
            deltaLiquidity = endLiquidity - startLiquidity;
        }
        if (deltaLiquidity == 0) revert InvalidPrice();
        uint256 harmonic = (uint256(duration) << 128) / deltaLiquidity;
        if (harmonic < minimumHarmonicLiquidity) revert InvalidPrice();
        int256 normalized = token0 == MainnetPins.IMD_ADDRESS ? int256(deltaTick) : -int256(deltaTick);
        int256 mean = normalized / int256(uint256(duration));
        if (mean * int256(uint256(duration)) > normalized) --mean;
        if (mean < TickMath.MIN_TICK || mean > TickMath.MAX_TICK) revert InvalidPrice();
        uint160 sqrt = TickMath.getSqrtPriceAtTick(int24(mean));
        if (sqrt <= type(uint128).max) return Math.mulDiv(uint256(sqrt) * sqrt, 1e18, 1 << 192);
        return Math.mulDiv(Math.mulDiv(sqrt, sqrt, 1 << 64), 1e18, 1 << 128);
    }
}
