// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Exact floor(base * IMD-per-UNLK ratio) from slot0.sqrtPriceX96, in either currency order.
/// @dev Internal only: no linked libraries. Caller validates nonzero sqrtPrice and computes base = 1B * IMD/USD.
/// Values exceeding uint256 saturate (still above every gate); no intermediate rounding can miss an exact touch.
library ImdSpotMath {
    function fdv(uint160 sqrtPrice, uint256 base, bool tokenIs0) internal pure returns (uint256) {
        (uint256 squareHigh, uint256 squareLow) = _product(sqrtPrice, sqrtPrice);
        if (squareHigh == 0) {
            return tokenIs0
                ? _mulDivSaturating(base, squareLow, 1 << 192)
                : _mulDivSaturating(base, 1 << 192, squareLow);
        }
        if (tokenIs0) {
            // Full 768-bit base * sqrtPrice^2, followed by the exact 192-bit right shift.
            (uint256 carry, uint256 low) = _product(base, squareLow);
            (uint256 top, uint256 middle) = _product(base, squareHigh);
            unchecked {
                middle += carry;
                if (middle < carry) ++top;
            }
            if (top != 0 || middle >> 192 != 0) return type(uint256).max;
            return middle << 64 | low >> 192;
        }
        // Exact 512/512 division: numerator = base << 192; denominator = sqrtPrice^2.
        // Here denominator >= 2^256, so the quotient fits uint256 (in fact < 2^192).
        // This rare branch avoids rounding a 320-bit denominator into 256 bits before inversion.
        return _divideWide(base >> 64, base << 192, squareHigh, squareLow);
    }

    function _product(uint256 a, uint256 b) private pure returns (uint256 high, uint256 low) {
        assembly ("memory-safe") {
            low := mul(a, b)
            let mm := mulmod(a, b, not(0))
            high := sub(sub(mm, low), lt(mm, low))
        }
    }

    function _mulDivSaturating(uint256 a, uint256 b, uint256 denominator) private pure returns (uint256) {
        (uint256 high,) = _product(a, b);
        if (high >= denominator) return type(uint256).max;
        return Math.mulDiv(a, b, denominator);
    }

    function _divideWide(uint256 nh, uint256 nl, uint256 dh, uint256 dl)
        private
        pure
        returns (uint256 quotient)
    {
        if (nh < dh || (nh == dh && nl < dl)) return 0;
        // dh is nonzero. Align the divisor's highest bit with the numerator's (never beyond 512 bits).
        uint256 shift = Math.log2(nh) - Math.log2(dh);
        dh = dh << shift | dl >> (256 - shift);
        dl <<= shift;
        for (uint256 bit = shift + 1; bit != 0;) {
            unchecked {
                --bit;
                if (nh > dh || (nh == dh && nl >= dl)) {
                    uint256 borrow = nl < dl ? 1 : 0;
                    nl -= dl;
                    nh = nh - dh - borrow;
                    quotient |= uint256(1) << bit;
                }
            }
            dl = dl >> 1 | dh << 255;
            dh >>= 1;
        }
    }
}
