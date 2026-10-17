// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ImdFixture} from "./ImdFixture.sol";
import {ImdV4UsdSource} from "../../src/mainnet/ImdV4UsdSource.sol";
import {ImdSampledUsdSource} from "../../src/mainnet/ImdSampledUsdSource.sol";
import {ImdSpotUsdSource} from "../../src/mainnet/ImdSpotUsdSource.sol";
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {ImdUsdSource, IV3OraclePool} from "../../src/mainnet/ImdUsdSource.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {UnlkImdOracle, IImdUsdSource} from "../../src/mainnet/UnlkImdOracle.sol";
import {MerkleClaimEvidence} from "../../src/MerkleClaimEvidence.sol";
import {IClaimEvidence} from "../../src/interfaces/IIntegration.sol";

contract V4ActivationTest is ImdFixture {
    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(-129000);
    }

    function testPermissionlessGateCheckpointRequiresActivation() public {
        vm.expectRevert(UnlkImdHook.NotActivated.selector);
        hook.checkpoint();
        vm.expectRevert(UnlkImdHook.NotActivated.selector);
        hook.updateMilestone();
    }

    function testInactiveV3CodeIsNoLongerAdmittedAsProductionSource() public {
        vm.prank(owner);
        vm.expectRevert(UnlkImdHook.InvalidConfig.selector);
        hook.deployPriceSource(
            type(ImdUsdSource).creationCode,
            abi.encode(IV3OraclePool(address(1)), bytes32(uint256(1)), uint128(1))
        );
        assertEq(hook.stagedPriceSource(), address(0));
    }

    /// @dev Oracle redesign: the historical per-block proof source stays in the tree but is no longer the
    /// active candidate. Setup cannot stage it, so no proof collector is a release requirement.
    function testHistoricalProofSourceIsNoLongerAdmitted() public {
        vm.prank(owner);
        vm.expectRevert(UnlkImdHook.InvalidConfig.selector);
        hook.deployPriceSource(type(ImdV4UsdSource).creationCode, "");
        assertEq(hook.stagedPriceSource(), address(0));
    }

    function _externalPool(uint160 sqrtPrice, uint128 liquidity) internal {
        bytes32 slot = keccak256(abi.encode(_poolId(), uint256(6)));
        vm.store(MANAGER, slot, bytes32(uint256(sqrtPrice) | (uint256(10000) << 208)));
        vm.store(MANAGER, bytes32(uint256(slot) + 3), bytes32(uint256(liquidity)));
    }

    function _poolId() internal pure returns (bytes32) {
        return 0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3;
    }

    function _stage() internal returns (address source, address e, address o) {
        vm.prank(owner);
        source = hook.deployPriceSource(type(ImdSpotUsdSource).creationCode, "");
        vm.prank(owner);
        (e, o,) = hook.deployCompanions(LAUNCH_NUMBER, IImdUsdSource(source), _codes());
        _certifySingle(MerkleClaimEvidence(e), 0, alice, REWARD);
        _freshFeed();
    }

    function testUninitializedReferencePoolBlocksActivationAtomicallyAndClaimsRemainIndependent() public {
        (, address e, address o) = _stage();
        vm.prank(owner);
        vm.expectRevert(ImdSpotUsdSource.PoolUnavailable.selector);
        hook.configureAndActivate(IClaimEvidence(e), UnlkImdOracle(o), LAUNCH_NUMBER);
        assertFalse(hook.activated());
        assertEq(address(hook.oracle()), address(0), "failed activation rolled back");
        assertFalse(UnlkImdOracle(o).bound());
        assertEq(hook.p(), 2000);
        _advance(CONTRIBUTOR_LOCK);
        _claimReward();
        assertEq(token.balanceOf(alice), REWARD);
        vm.prank(alice);
        token.transfer(bob, REWARD / 2);
        assertEq(token.balanceOf(bob), REWARD / 2);
    }

    function testStaleFeedBlocksActivationThenValidCurrentReferenceActivatesInSameBlock() public {
        (address source, address e, address o) = _stage();
        _externalPool(TickMath.getSqrtPriceAtTick(58773), 1e22);
        vm.mockCall(
            MainnetPins.ETHUSD_ADDRESS,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(uint80(1), feedAnswer, block.timestamp - 2 hours, block.timestamp - 2 hours, uint80(1))
        );
        vm.prank(owner);
        vm.expectRevert(ImdSpotUsdSource.InvalidPrice.selector);
        hook.configureAndActivate(IClaimEvidence(e), UnlkImdOracle(o), LAUNCH_NUMBER);
        assertFalse(hook.activated());
        uint256 t = block.timestamp;
        uint256 n = block.number;
        _freshFeed();
        vm.prank(owner);
        hook.configureAndActivate(IClaimEvidence(e), UnlkImdOracle(o), LAUNCH_NUMBER);
        assertTrue(hook.activated(), "no warm-up, observation count or elapsed time required");
        assertEq(block.timestamp, t);
        assertEq(block.number, n);
        assertGt(ImdSpotUsdSource(source).priceUsd(), 0);
        assertGt(UnlkImdOracle(o).fdvUsd(), 0);
    }

    function testZeroLiquidityReferenceBlocksActivation() public {
        (, address e, address o) = _stage();
        _externalPool(TickMath.getSqrtPriceAtTick(58773), 0);
        vm.prank(owner);
        vm.expectRevert(ImdSpotUsdSource.PoolUnavailable.selector);
        hook.configureAndActivate(IClaimEvidence(e), UnlkImdOracle(o), LAUNCH_NUMBER);
        assertFalse(hook.activated());
    }

    function testHistoricalSampledSourceIsNoLongerAdmitted() public {
        vm.prank(owner);
        vm.expectRevert(UnlkImdHook.InvalidConfig.selector);
        hook.deployPriceSource(type(ImdSampledUsdSource).creationCode, "");
        assertEq(hook.stagedPriceSource(), address(0));
    }
}
