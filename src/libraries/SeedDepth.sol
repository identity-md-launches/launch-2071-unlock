// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SqrtPriceMath} from "v4-core/src/libraries/SqrtPriceMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice One formula for the locked seed's opening-value capacity, shared by the hook (which refuses a seed
/// and an activation below the minimum) and the oracle (which classes observations liquid by it). Both reading
/// the same internal library means the gate at launch and the gate at activation cannot drift from the one the
/// oracle applies afterwards.
library SeedDepth {
    /// @notice The locked seed must be worth at least this much ETH at its own upper price boundary.
    /// 870M tokens at the policy's 20 ETH per billion opening FDV are about 17.4 ETH; the minimum opening FDV
    /// that passes is 17 / 0.87 = 19.54 ETH, 2.3% (just under four tick spacings) below the policy figure.
    uint256 internal constant MIN_SEED_QUOTE_CAPACITY = 17 ether;

    /// @param sqrtLower sqrt price (Q64.96) at the position's lower tick.
    /// @param sqrtUpper sqrt price (Q64.96) at the position's upper tick.
    /// @param liquidity the position's liquidity.
    /// @return seedTokens the launch-token (currency1) principal the range holds when the price is at or above it.
    /// @return depth that principal valued in ETH at the upper boundary, in wei.
    function quoteCapacity(uint160 sqrtLower, uint160 sqrtUpper, uint128 liquidity)
        internal
        pure
        returns (uint256 seedTokens, uint256 depth)
    {
        if (liquidity == 0 || sqrtUpper == 0 || sqrtLower >= sqrtUpper) return (0, 0);
        seedTokens = SqrtPriceMath.getAmount1Delta(sqrtLower, sqrtUpper, liquidity, false);
        depth = Math.mulDiv(Math.mulDiv(seedTokens, 1 << 96, sqrtUpper), 1 << 96, sqrtUpper);
    }

    /// @notice `quoteCapacity`'s depth alone, for callers that only class liquidity.
    function capacity(uint160 sqrtLower, uint160 sqrtUpper, uint128 liquidity)
        internal
        pure
        returns (uint256)
    {
        (, uint256 depth) = quoteCapacity(sqrtLower, sqrtUpper, liquidity);
        return depth;
    }
}
