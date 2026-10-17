// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ImdFixture} from "./ImdFixture.sol";
import {ImdSpotUsdSource} from "src/mainnet/ImdSpotUsdSource.sol";
import {ImdUsdSource} from "src/mainnet/ImdUsdSource.sol";
import {UnlkImdOracle, IImdUsdSource} from "src/mainnet/UnlkImdOracle.sol";
import {ImdFeeVault} from "src/mainnet/ImdFeeVault.sol";
import {MerkleClaimEvidence} from "src/MerkleClaimEvidence.sol";
import {MainnetPins} from "src/mainnet/MainnetPins.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @dev Offline simulation using the existing recorded service runtimes and actual factory launch call.
/// Unlike ImdFixture, this fixture never redirects priceUsd: the staged stateless source executes throughout.
/// Only the external reference pool state and Chainlink responses are synthetic. Neither is release evidence.
abstract contract SpotIntegrationFixture is ImdFixture {
    ImdSpotUsdSource internal spotSource;
    uint160 internal constant REFERENCE_SQRT = uint160(64 << 96);
    bytes32 internal constant REFERENCE_ID =
        0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3;

    function _prepareReference() internal virtual {
        _referenceState(REFERENCE_SQRT, 1e18, 10000);
    }

    function _deployCompanions() internal override {
        _prepareReference();
        _freshFeed();
        vm.prank(owner);
        address source = hook.deployPriceSource(type(ImdSpotUsdSource).creationCode, "");
        spotSource = ImdSpotUsdSource(source);
        // Preserve the parent fixture's ABI-compatible priceUsd handle, without mocking its implementation.
        priceSource = ImdUsdSource(source);
        vm.prank(owner);
        (address e, address o, address v) =
            hook.deployCompanions(LAUNCH_NUMBER, IImdUsdSource(source), _codes());
        rewards = MerkleClaimEvidence(e);
        oracle = UnlkImdOracle(o);
        vault = ImdFeeVault(v);
        _certifyInitialRound();
        _approveRouter(alice);
        _approveRouter(bob);
        _approveRouter(payer);
    }

    function _referenceState(uint160 sqrtPrice, uint128 liquidity, uint24 fee) internal {
        bytes32 slot = keccak256(abi.encode(REFERENCE_ID, uint256(6)));
        int24 tick = sqrtPrice == 0 ? int24(0) : TickMath.getTickAtSqrtPrice(sqrtPrice);
        vm.store(
            MANAGER, slot, bytes32(uint256(sqrtPrice) | uint256(uint24(tick)) << 160 | uint256(fee) << 208)
        );
        vm.store(MANAGER, bytes32(uint256(slot) + 3), bytes32(uint256(liquidity)));
    }

    function _feedRound(uint80 round, int256 answer, uint256 started, uint256 updated, uint80 answered)
        internal
    {
        vm.mockCall(
            MainnetPins.ETHUSD_ADDRESS,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(round, answer, started, updated, answered)
        );
    }
}
