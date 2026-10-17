// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ImdSpotMath} from "src/mainnet/ImdSpotMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @notice Check exact floor by the defining inequality q*D <= N < (q+1)*D.
/// The independent oracle uses base-2^64 schoolbook multiplication and comparison only:
/// no Math.mulDiv, assembly, normalization, division, or production arithmetic helpers.
/// Twelve limbs retain all bits of a product of three uint256 values.
contract SpotArithmeticPropertiesTest is Test {
    function _multiply(uint256[12] memory a, uint256 b, uint256 used)
        private
        pure
        returns (uint256[12] memory out)
    {
        for (uint256 i; i < used; ++i) {
            uint256 carry;
            for (uint256 j; j < 4; ++j) {
                uint256 column = out[i + j] + a[i] * uint64(b >> (64 * j)) + carry;
                out[i + j] = uint64(column);
                carry = column >> 64;
            }
            out[i + 4] = carry;
        }
    }

    function _product(uint256 a, uint256 b, uint256 c) private pure returns (uint256[12] memory out) {
        for (uint256 i; i < 4; ++i) {
            out[i] = uint64(a >> (64 * i));
        }
        out = _multiply(out, b, 4);
        out = _multiply(out, c, 8);
    }

    function _less(uint256[12] memory a, uint256[12] memory b) private pure returns (bool) {
        for (uint256 i = 12; i != 0;) {
            --i;
            if (a[i] != b[i]) return a[i] < b[i];
        }
        return false;
    }

    function _check(uint160 sqrtPrice, uint256 base, bool tokenIs0) private pure {
        uint256 result = ImdSpotMath.fdv(sqrtPrice, base, tokenIs0);
        uint256[12] memory numerator =
            tokenIs0 ? _product(base, sqrtPrice, sqrtPrice) : _product(base, 1 << 192, 1);
        uint256[12] memory floorTimesDenominator =
            tokenIs0 ? _product(result, 1 << 192, 1) : _product(result, sqrtPrice, sqrtPrice);
        assertFalse(_less(numerator, floorTimesDenominator), "rounded result exceeds the rational price");
        if (result != type(uint256).max) {
            uint256[12] memory nextTimesDenominator =
                tokenIs0 ? _product(result + 1, 1 << 192, 1) : _product(result + 1, sqrtPrice, sqrtPrice);
            assertTrue(_less(numerator, nextTimesDenominator), "result loses an integer unit before flooring");
        }
        // If saturated, the first inequality proves saturation was warranted.
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzzExactFloorAcrossFullNonzeroUint160AndUint256Domain(
        uint160 rawSqrt,
        uint256 base,
        bool tokenIs0
    ) public pure {
        uint160 sqrtPrice = rawSqrt == 0 ? uint160(1) : rawSqrt;
        _check(sqrtPrice, base, tokenIs0);
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzzWideDenominatorHasNoLostPrecision(uint160 rawSqrt, uint256 base) public pure {
        uint160 sqrtPrice = uint160(bound(rawSqrt, uint256(1) << 128, type(uint160).max));
        _check(sqrtPrice, base, false);
    }

    function testZeroOneSupplyAndMaxAtEveryArithmeticBranchBoundary() public pure {
        uint160[9] memory prices = [
            uint160(1),
            TickMath.MIN_SQRT_PRICE,
            uint160((1 << 96) - 1),
            uint160(1 << 96),
            uint160((1 << 96) + 1),
            uint160(type(uint128).max),
            uint160(1 << 128),
            uint160((1 << 128) + 1),
            type(uint160).max
        ];
        uint256[5] memory bases = [uint256(0), 1, 1_000_000_000 ether, uint256(1) << 192, type(uint256).max];
        for (uint256 i; i < prices.length; ++i) {
            for (uint256 j; j < bases.length; ++j) {
                _check(prices[i], bases[j], true);
                _check(prices[i], bases[j], false);
            }
        }
    }

    function testIndependentLimbOracleAgreesWithSmallIntegerProductsAndKnownCarry() public pure {
        uint256[12] memory small = _product(123456789, 987654321, 111);
        assertEq(small[0], uint64(uint256(123456789) * 987654321 * 111));
        assertEq(small[1], (uint256(123456789) * 987654321 * 111) >> 64);
        for (uint256 i = 2; i < 12; ++i) {
            assertEq(small[i], 0);
        }
        // (2^256 - 1)^2 = 2^512 - 2^257 + 1, independently known without wide division.
        uint256[12] memory wide = _product(type(uint256).max, type(uint256).max, 1);
        assertEq(wide[0], 1);
        for (uint256 i = 1; i < 4; ++i) {
            assertEq(wide[i], 0);
        }
        assertEq(wide[4], uint256(type(uint64).max) - 1);
        for (uint256 i = 5; i < 8; ++i) {
            assertEq(wide[i], type(uint64).max);
        }
        for (uint256 i = 8; i < 12; ++i) {
            assertEq(wide[i], 0);
        }
    }
}
