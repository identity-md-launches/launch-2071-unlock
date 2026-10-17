// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BlockState} from "./BlockState.sol";
import {MainnetPins} from "./MainnetPins.sol";
import {IChainlinkEthUsd} from "../interfaces/IIntegration.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @notice Noncircular IMD/native-ETH block-end TWAP times canonical Chainlink ETH/USD.
/// @dev Every elapsed interval is authenticated by consecutive block headers and storage inclusion proofs.
/// No spot checkpoint, keeper signature, retrofitted hook, assumed v4 observe(), or event index is trusted.
/// This proves history, NOT manipulation resistance. Sustained manipulation, movable concentrated liquidity,
/// fee recapture and consensus reorgs remain release blockers; see revision/ORACLE.md. NOT release approved.
contract ImdV4UsdSource {
    using StateLibrary for IPoolManager;
    uint256 public constant WINDOW = 2 hours;
    uint256 public constant LONG_WINDOW = 24 hours;
    uint256 public constant CONFIRMATIONS = 64;
    uint256 public constant MAX_AGE = 20 minutes;
    uint256 public constant MAX_BLOCK_GAP = 60;
    uint256 public constant MAX_DIVERGENCE_BPS = 1000;
    // A conservative screening floor, not a claimed lower bound on manipulation losses.
    // The currently discovered market is BELOW this floor. It cannot activate this source.
    uint256 public constant MIN_VIRTUAL_ETH = 10_000 ether;
    uint256 public constant MAX_FEED_AGE = 90 minutes;
    uint256 public immutable deployedAt;
    bytes32 public constant POOL_ID = 0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3;
    IChainlinkEthUsd public constant ethUsd = IChainlinkEthUsd(MainnetPins.ETHUSD_ADDRESS);

    struct Observation {
        uint64 number;
        uint64 time;
        int24 tick; // IMD per ETH; normalized with opposite sign when consulted
        bool liquid;
        int256 cumulative;
        uint256 badSeconds;
    }
    Observation[] public observations;
    error InvalidPrice();
    error InvalidSequence();
    event Observed(uint64 indexed number, uint64 time, int24 tick, bool liquid, bool lostHistory);

    constructor() {
        deployedAt = block.timestamp;
    }

    /// @notice Anyone supplies untrusted proofs. Their correctness, ordering and time are verified on chain.
    /// Permissionless recovery after the 256-block proof horizon inserts an explicitly BAD interval.
    /// No history is deleted; a full clean 24h must elapse again. No admin/reset/pause/price setter exists.
    function submit(BlockState.Proof calldata proof) external {
        BlockState.State memory state = BlockState.verify(proof);
        if (state.number > block.number - CONFIRMATIONS) revert InvalidSequence();
        _append(state);
    }

    function _append(BlockState.State memory state) internal {
        uint256 n = observations.length;
        int256 cumulative = 0;
        uint256 bad = 0;
        bool lost = false;
        if (n != 0) {
            Observation storage prev = observations[n - 1];
            if (state.number <= prev.number || state.time <= prev.time) revert InvalidSequence();
            if (state.number != uint256(prev.number) + 1) {
                // Only unrecoverable history may be skipped; an arbitrary keeper cannot manufacture gaps.
                if (
                    uint256(prev.number) + 257 >= block.number || state.number != block.number - CONFIRMATIONS
                ) {
                    revert InvalidSequence();
                }
                lost = true;
            }
            uint256 elapsed = state.time - prev.time;
            cumulative = prev.cumulative + int256(prev.tick) * int256(elapsed);
            bad = prev.badSeconds + (lost || !prev.liquid || elapsed > MAX_BLOCK_GAP ? elapsed : 0);
        }
        uint160 sqrt = state.sqrtPrice;
        bool liquid = sqrt >= TickMath.MIN_SQRT_PRICE && sqrt < TickMath.MAX_SQRT_PRICE
            && state.tick >= TickMath.MIN_TICK && state.tick <= TickMath.MAX_TICK && state.liquidity != 0
            && state.lpFee == 10000 && state.protocolFee == 0x3e83e8;
        if (liquid) {
            // The decoded slot is authenticated. Check tick/price coherence, including v4 left-cross tick-1.
            int24 priceTick = TickMath.getTickAtSqrtPrice(sqrt);
            liquid = (state.tick == priceTick || state.tick == priceTick - 1)
                && Math.mulDiv(state.liquidity, 1 << 96, sqrt) >= MIN_VIRTUAL_ETH;
        }
        observations.push(Observation(state.number, state.time, state.tick, liquid, cumulative, bad));
        emit Observed(state.number, state.time, state.tick, liquid, lost);
    }

    function observationCount() external view returns (uint256) {
        return observations.length;
    }

    function priceUsd() external view returns (uint256) {
        uint256 n = observations.length;
        if (n < 2 || block.timestamp < deployedAt + LONG_WINDOW || !_currentDepth()) revert InvalidPrice();
        Observation memory last = observations[n - 1];
        if (
            !last.liquid || last.time > block.timestamp || block.timestamp - last.time > MAX_AGE
                || last.time < LONG_WINDOW || observations[0].time > last.time - LONG_WINDOW
        ) revert InvalidPrice();
        // NEVER extrapolate the last price into unproven time. Both windows end at the proven block.
        uint256 shortPrice = _consult(last, WINDOW);
        uint256 longPrice = _consult(last, LONG_WINDOW);
        uint256 diff = shortPrice > longPrice ? shortPrice - longPrice : longPrice - shortPrice;
        if (shortPrice == 0 || longPrice == 0 || Math.mulDiv(diff, 10000, longPrice) > MAX_DIVERGENCE_BPS) {
            revert InvalidPrice();
        }
        if (address(ethUsd).codehash != MainnetPins.ETHUSD || ethUsd.decimals() != 8) revert InvalidPrice();
        (uint80 round, int256 answer, uint256 started, uint256 updated, uint80 answered) =
            ethUsd.latestRoundData();
        if (
            round == 0 || answer <= 0 || started == 0 || started > updated || updated > block.timestamp
                || answered < round || block.timestamp - updated > MAX_FEED_AGE
                || uint256(answer) > 1_000_000e8
        ) {
            revert InvalidPrice();
        }
        return Math.mulDiv(Math.min(shortPrice, longPrice), uint256(answer) * 1e10, 1e18);
    }

    /// @dev Spot is used ONLY to reject missing CURRENT depth/changed fees, never to value IMD.
    /// A flash donation or JIT liquidity cannot repair the authenticated historical depth requirement.
    function _currentDepth() private view returns (bool) {
        address manager = MainnetPins.MANAGER_ADDRESS;
        if (block.chainid != 1 || manager.codehash != MainnetPins.MANAGER) return false;
        (uint160 sqrt,, uint24 protocolFee, uint24 lpFee) =
            IPoolManager(manager).getSlot0(PoolId.wrap(POOL_ID));
        if (
            sqrt < TickMath.MIN_SQRT_PRICE || sqrt >= TickMath.MAX_SQRT_PRICE || protocolFee != 0x3e83e8
                || lpFee != 10000
        ) return false;
        return Math.mulDiv(IPoolManager(manager).getLiquidity(PoolId.wrap(POOL_ID)), 1 << 96, sqrt)
            >= MIN_VIRTUAL_ETH;
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
        // Any bad interval intersecting the window invalidates it (conservative at a gap boundary).
        uint256 startBad = start.badSeconds + (start.liquid ? 0 : elapsed);
        if (last.badSeconds != startBad) revert InvalidPrice();
        int256 diff = start.cumulative + int256(start.tick) * int256(elapsed) - last.cumulative;
        int256 mean = diff / int256(duration);
        if (diff < 0 && diff % int256(duration) != 0) --mean;
        if (mean < TickMath.MIN_TICK || mean > TickMath.MAX_TICK) revert InvalidPrice();
        uint160 sqrt = TickMath.getSqrtPriceAtTick(int24(mean));
        if (sqrt <= type(uint128).max) return Math.mulDiv(uint256(sqrt) * sqrt, 1e18, 1 << 192);
        return Math.mulDiv(Math.mulDiv(sqrt, sqrt, 1 << 64), 1e18, 1 << 128);
    }
}
