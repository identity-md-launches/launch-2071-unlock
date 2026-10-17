// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SqrtPriceMath} from "v4-core/src/libraries/SqrtPriceMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Locked UNLK principal valued at the token-only opening boundary, in raw IMD units.
library ImdSeedDepth {
    // Only require nonzero representable quote value. No ETH-denominated or USD milestone floor.
    uint256 internal constant MIN_SEED_QUOTE_CAPACITY = 1;

    function quoteCapacity(uint160 lower, uint160 upper, uint128 liquidity, bool tokenIs0)
        internal
        pure
        returns (uint256 principal, uint256 depth)
    {
        if (liquidity == 0 || lower == 0 || lower >= upper) return (0, 0);
        if (tokenIs0) {
            principal = SqrtPriceMath.getAmount0Delta(lower, upper, liquidity, false);
            depth = Math.mulDiv(Math.mulDiv(principal, lower, 1 << 96), lower, 1 << 96);
        } else {
            principal = SqrtPriceMath.getAmount1Delta(lower, upper, liquidity, false);
            depth = Math.mulDiv(Math.mulDiv(principal, 1 << 96, upper), 1 << 96, upper);
        }
    }

    function capacity(uint160 lower, uint160 upper, uint128 liquidity, bool tokenIs0)
        internal
        pure
        returns (uint256)
    {
        (, uint256 depth) = quoteCapacity(lower, upper, liquidity, tokenIs0);
        return depth;
    }
}
