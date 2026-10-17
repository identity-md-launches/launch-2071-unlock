// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {MainnetPins} from "./MainnetPins.sol";
import {IChainlinkEthUsd} from "../interfaces/IIntegration.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @notice Pool-derived IMD/USD: permissionless SAMPLED observations of the existing hookless IMD/native-ETH v4
/// pool, composed with the canonical Chainlink ETH/USD feed. No paid feed, attester, signer, API or state proof.
/// @dev SAMPLED, NOT CONTINUOUS. Each `sample()` reads the pool's spot at the moment it is called; the value is
/// forward-filled only until the next sample. This is NOT authenticated pool history and NOT a built-in v4 TWAP
/// (v4 has none, and no hook can be retrofitted onto the external pool's PoolKey). A sample can be taken inside a
/// manipulated block. Defences are bounded, not absolute: per-elapsed-time tick clamp, zero weight for the latest
/// sample, 24h warm-up, 2h/24h windows with the lower price, gap/depth/lag failure states. Sustained or repeated
/// manipulation that pays the swap fees at every sample still passes; see docs/mainnet/revision/SAMPLED_ORACLE.md.
/// No admin, setter, reset, pause or upgrade exists. NOT release approved.
contract ImdSampledUsdSource {
    using StateLibrary for IPoolManager;

    /// @notice IMD/native-ETH PoolId. Preimage: (currency0 = native ETH, currency1 = IMD, fee 10000,
    /// tickSpacing 200, hooks 0). Its tick is log1.0001(IMD per ETH); both currencies have 18 decimals.
    bytes32 public constant POOL_ID = 0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3;
    uint24 public constant POOL_LP_FEE = 10000;
    IChainlinkEthUsd public constant ethUsd = IChainlinkEthUsd(MainnetPins.ETHUSD_ADDRESS);

    uint256 public constant WINDOW = 2 hours;
    uint256 public constant LONG_WINDOW = 24 hours;
    /// @notice History before the long window starts is discarded as anchor/warm-up time.
    uint256 public constant WARMUP = 24 hours;
    /// @notice At most one sample per minute: bounds storage and per-sample attack weight from below.
    uint256 public constant MIN_SAMPLE_INTERVAL = 1 minutes;
    /// @notice A longer interval between samples is a GAP: its time is bad and voids any window it touches.
    uint256 public constant MAX_SAMPLE_GAP = 20 minutes;
    /// @notice The recorded tick moves at most this much per elapsed minute (about 0.5%/min, 1.35x/hour).
    int256 public constant MAX_TICKS_PER_MINUTE = 50;
    /// @notice The latest sample's raw spot must lie within this many ticks (about 22%) of its recorded tick.
    uint256 public constant MAX_LAG = 2000;
    /// @notice Liveness screen against an emptied/abandoned pool. NOT an economic security bound.
    uint256 public constant MIN_VIRTUAL_ETH = 250 ether;
    uint256 public constant MAX_FEED_AGE = 90 minutes;

    struct Observation {
        uint32 time;
        int24 tick; // recorded (clamped) IMD-per-ETH tick
        int24 spotTick; // raw pool tick at sampling
        bool liquid;
        uint64 number;
        int56 cumulative; // sum of recorded tick * seconds up to `time`
        uint32 badSeconds; // cumulative gap/illiquid seconds up to `time`
    }

    Observation[] public observations;

    error InvalidPrice();
    error TooSoon();
    error PoolUnavailable();

    event Sampled(
        address indexed by, uint64 indexed number, int24 spotTick, int24 recordedTick, bool liquid, bool gap
    );

    /// @notice Anyone may sample, e.g. the milestone keeper before `updateMilestone`, a user or the website.
    /// Reverts only if the pool cannot be read at all; thin/changed pools are RECORDED as illiquid (bad time).
    function sample() external returns (int24 recorded) {
        (uint160 sqrtPrice, int24 spot, uint128 liquidity, uint24 lpFee) = _pool();
        if (sqrtPrice == 0) revert PoolUnavailable();
        bool liquid = lpFee == POOL_LP_FEE && _virtualEth(sqrtPrice, liquidity) >= MIN_VIRTUAL_ETH;
        uint256 n = observations.length;
        if (n == 0) {
            observations.push(
                Observation(uint32(block.timestamp), spot, spot, liquid, uint64(block.number), 0, 0)
            );
            emit Sampled(msg.sender, uint64(block.number), spot, spot, liquid, false);
            return spot;
        }
        Observation memory prev = observations[n - 1];
        uint256 elapsed = block.timestamp - prev.time;
        if (elapsed < MIN_SAMPLE_INTERVAL) revert TooSoon();
        bool gap = elapsed > MAX_SAMPLE_GAP;
        int256 bound = MAX_TICKS_PER_MINUTE * int256(Math.min(elapsed, MAX_SAMPLE_GAP)) / 60;
        int256 target = spot;
        if (target > prev.tick + bound) target = prev.tick + bound;
        if (target < prev.tick - bound) target = prev.tick - bound;
        recorded = int24(target);
        observations.push(
            Observation(
                uint32(block.timestamp),
                recorded,
                spot,
                liquid,
                uint64(block.number),
                int56(prev.cumulative + int256(prev.tick) * int256(elapsed)),
                uint32(prev.badSeconds + (gap || !prev.liquid ? elapsed : 0))
            )
        );
        emit Sampled(msg.sender, uint64(block.number), spot, recorded, liquid, gap);
    }

    function observationCount() external view returns (uint256) {
        return observations.length;
    }

    /// @notice Conservative sampled IMD price in USD, 18 decimals. Reverts on any unavailable state.
    function priceUsd() external view returns (uint256) {
        (uint256 ethPerImd,) = sampledEthPerImd();
        return Math.mulDiv(ethPerImd, _ethUsd() * 1e10, 1e18);
    }

    /// @notice Lower of the 2h and 24h sampled geometric means of ETH per IMD (18 decimals), ending at the latest
    /// sample (never extrapolated to now). Reverts during warm-up, after a stale/lagging/illiquid latest sample,
    /// or when any gap/illiquid interval intersects a window.
    function sampledEthPerImd() public view returns (uint256 price, uint256 asOf) {
        uint256 n = observations.length;
        if (n < 2) revert InvalidPrice();
        Observation memory last = observations[n - 1];
        if (
            !last.liquid || block.timestamp - last.time > MAX_SAMPLE_GAP
                || last.time - observations[0].time < WARMUP + LONG_WINDOW
                || _abs(int256(last.spotTick) - last.tick) > MAX_LAG
        ) revert InvalidPrice();
        (uint160 sqrtPrice,,, uint24 lpFee) = _pool();
        if (sqrtPrice == 0 || lpFee != POOL_LP_FEE) revert InvalidPrice();
        price = Math.min(_consult(last, WINDOW), _consult(last, LONG_WINDOW));
        asOf = last.time;
    }

    /// @notice DISPLAY ONLY: the instantaneous pool spot (manipulable within a block) and validated ETH/USD.
    /// Never used by milestones.
    function spot()
        external
        view
        returns (uint256 usdPerImd, uint256 ethPerImd, int24 tick, uint256 virtualEth, uint256 ethUsdPrice)
    {
        (uint160 sqrtPrice, int24 t, uint128 liquidity,) = _pool();
        if (sqrtPrice == 0) revert PoolUnavailable();
        tick = t;
        ethPerImd = Math.mulDiv(1e18, 1 << 192, uint256(sqrtPrice) * sqrtPrice);
        virtualEth = _virtualEth(sqrtPrice, liquidity);
        ethUsdPrice = _ethUsd() * 1e10;
        usdPerImd = Math.mulDiv(ethPerImd, ethUsdPrice, 1e18);
    }

    function _pool() private view returns (uint160 sqrtPrice, int24 tick, uint128 liquidity, uint24 lpFee) {
        address manager = MainnetPins.MANAGER_ADDRESS;
        if (block.chainid != 1 || manager.codehash != MainnetPins.MANAGER) revert PoolUnavailable();
        (sqrtPrice, tick,, lpFee) = IPoolManager(manager).getSlot0(PoolId.wrap(POOL_ID));
        liquidity = IPoolManager(manager).getLiquidity(PoolId.wrap(POOL_ID));
    }

    /// @dev Active-range virtual native reserve L / sqrt(P). Local depth only; it can be moved by LPs and traders.
    function _virtualEth(uint160 sqrtPrice, uint128 liquidity) private pure returns (uint256) {
        return Math.mulDiv(liquidity, 1 << 96, sqrtPrice);
    }

    /// @return answer Validated ETH/USD with 8 decimals from the pinned canonical Chainlink proxy.
    function _ethUsd() private view returns (uint256) {
        if (address(ethUsd).codehash != MainnetPins.ETHUSD || ethUsd.decimals() != 8) revert InvalidPrice();
        (uint80 round, int256 answer, uint256 started, uint256 updated, uint80 answered) =
            ethUsd.latestRoundData();
        if (
            round == 0 || answer <= 0 || started == 0 || started > updated || updated > block.timestamp
                || answered < round || block.timestamp - updated > MAX_FEED_AGE
                || uint256(answer) > 1_000_000e8
        ) revert InvalidPrice();
        return uint256(answer);
    }

    function _consult(Observation memory last, uint256 duration) private view returns (uint256) {
        uint256 cutoff = last.time - duration;
        uint256 lo;
        uint256 hi = observations.length;
        while (lo + 1 < hi) {
            uint256 mid = (lo + hi) / 2;
            if (observations[mid].time <= cutoff) lo = mid;
            else hi = mid;
        }
        Observation memory start = observations[lo];
        uint256 elapsed = cutoff - start.time;
        // The interval containing the cutoff is bad if it began illiquid or is itself a gap.
        // Any bad second inside the window voids it; history is never repaired or reset.
        if (!start.liquid || _isGap(lo) || last.badSeconds != start.badSeconds) revert InvalidPrice();
        // ETH per IMD is the NEGATED tick; floor division also for negative values.
        int256 diff =
            int256(start.cumulative) + int256(start.tick) * int256(elapsed) - int256(last.cumulative);
        int256 mean = diff / int256(duration);
        if (diff < 0 && diff % int256(duration) != 0) --mean;
        if (mean < TickMath.MIN_TICK || mean > TickMath.MAX_TICK) revert InvalidPrice();
        uint160 sqrtPrice = TickMath.getSqrtPriceAtTick(int24(mean));
        if (sqrtPrice <= type(uint128).max) {
            return Math.mulDiv(uint256(sqrtPrice) * sqrtPrice, 1e18, 1 << 192);
        }
        return Math.mulDiv(Math.mulDiv(sqrtPrice, sqrtPrice, 1 << 64), 1e18, 1 << 128);
    }

    function _isGap(uint256 i) private view returns (bool) {
        return observations[i + 1].time - observations[i].time > MAX_SAMPLE_GAP;
    }

    function _abs(int256 x) private pure returns (uint256) {
        return uint256(x < 0 ? -x : x);
    }
}
