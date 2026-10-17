// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {SuccessorFeeMath} from "../../src/successor/SuccessorFeeMath.sol";
import {ImdSeedDepth} from "../../src/mainnet/ImdSeedDepth.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

contract ImdFeeMathTest is Test {
    function testFuzzAllModeRounding(uint128 amount) public pure {
        (uint256 base, uint256 fee) = SuccessorFeeMath.exactInputBuyFee(amount);
        assertEq(base + fee, amount);
        assertGe(fee, base * 75 / 10000);
        assertLe(fee, base * 75 / 10000 + 1);
        (uint256 gross, uint256 sellFee) = SuccessorFeeMath.exactOutputSellFee(amount);
        assertEq(gross - sellFee, amount);
        assertGe(sellFee, gross * 75 / 10000);
        assertLe(sellFee, gross * 75 / 10000 + 1);
        assertEq(SuccessorFeeMath.unspecifiedFee(amount), uint256(amount) * 75 / 10000);
    }

    function testSeedDepthReversesWithSortingNoEthFloor() public pure {
        (uint256 a, uint256 ad) = ImdSeedDepth.quoteCapacity(
            TickMath.getSqrtPriceAtTick(-129000), TickMath.getSqrtPriceAtTick(887220), 1e24, true
        );
        (uint256 b, uint256 bd) = ImdSeedDepth.quoteCapacity(
            TickMath.getSqrtPriceAtTick(-887220), TickMath.getSqrtPriceAtTick(129000), 1e24, false
        );
        assertApproxEqAbs(a, b, 2);
        assertApproxEqAbs(ad, bd, 1);
        assertEq(ImdSeedDepth.MIN_SEED_QUOTE_CAPACITY, 1);
    }
}
