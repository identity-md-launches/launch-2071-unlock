// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {NativeFeeMath} from "../candidate/NativeFeeMath.sol";

/// @notice Native-ETH treasury fee for each standard v4 swap mode of the official ETH/UNLK pool.
/// @dev Fee base in EVERY mode is the ETH that actually crossed the pool boundary (`|delta.amount0|` the
/// PoolManager reports to the hook), i.e. the executed pool ETH leg. The rate is a fixed 75 bps.
/// - ETH unspecified (exact-output buy, exact-input sell): `fee = floor(base * 75 / 10000)`, charged in
///   `afterSwap` through `afterSwapReturnDelta` on the executed leg.
/// - ETH specified (exact-input buy, exact-output sell): the fee must be fixed before the pool runs, so it is
///   charged in `beforeSwap` through `beforeSwapReturnDelta` and the hook later requires a complete fill
///   (no unexecuted volume can carry a fee). Rounding favours the treasury by at most 1 wei per swap.
library SuccessorFeeMath {
    uint256 internal constant BPS = NativeFeeMath.BPS;

    function unspecifiedFee(uint256 executedEth) internal pure returns (uint256) {
        return NativeFeeMath.fee(executedEth);
    }

    /// @notice Exact-input buy: the trader's gross ETH is split into pool input `base` and fee `gross - base`,
    /// where `base` is the largest amount with `base + fee(base) <= gross`.
    function exactInputBuyFee(uint256 gross) internal pure returns (uint256 base, uint256 fee) {
        base = NativeFeeMath.buyPoolInput(gross);
        fee = gross - base;
    }

    /// @notice Exact-output sell: the pool must output `gross`, the smallest amount with
    /// `gross - fee(gross) >= net`; the trader receives exactly `net`, the treasury `gross - net`.
    function exactOutputSellFee(uint256 net) internal pure returns (uint256 gross, uint256 fee) {
        gross = NativeFeeMath.sellGrossOutput(net);
        fee = gross - net;
    }
}
