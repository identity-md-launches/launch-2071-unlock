// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

library NativeFeeMath {
    uint256 internal constant BPS = 75;

    function fee(uint256 executedEth) internal pure returns (uint256) {
        return Math.mulDiv(executedEth, BPS, 10000);
    }

    /// @notice Largest pool input whose input plus floor-rounded fee fits the gross budget.
    function buyPoolInput(uint256 gross) internal pure returns (uint256 base) {
        base = Math.mulDiv(gross, 10000, 10075);
        if (base < type(uint256).max && base + 1 <= gross - fee(base + 1)) ++base;
    }

    /// @notice Smallest gross pool output delivering exactly the requested net ETH.
    function sellGrossOutput(uint256 net) internal pure returns (uint256) {
        return net == 0 ? 0 : Math.mulDiv(net - 1, 10000, 9925) + 1;
    }
}
