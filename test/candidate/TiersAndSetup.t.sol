// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {CandidateFixture} from "./CandidateFixture.sol";
import {UnlkHookV2} from "../../src/candidate/UnlkHookV2.sol";
import {UnlkRouterV2} from "../../src/candidate/UnlkRouterV2.sol";
import {SetupVerifierV2} from "../../src/candidate/SetupVerifierV2.sol";
import {NftFeeVault} from "../../src/candidate/NftFeeVault.sol";
import {MerkleClaimEvidence} from "../../src/MerkleClaimEvidence.sol";
import {UnlkOracle} from "../../src/UnlkOracle.sol";
import {BypassRouter} from "../Trading.t.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

contract CandidateTiersTest is CandidateFixture {
    function testAllSixteenThresholds() public view {
        uint256[16] memory thresholds = [
            uint256(100000),
            250000,
            500000,
            1000000,
            2000000,
            3500000,
            5000000,
            7500000,
            10000000,
            15000000,
            20000000,
            25000000,
            30000000,
            35000000,
            40000000,
            50000000
        ];
        assertEq(hook.p(), 2000);
        for (uint8 i; i < 16; ++i) {
            assertEq(hook.tierThreshold(i), thresholds[i] * 1 ether);
            assertEq(hook.tierForFdv(thresholds[i] * 1 ether - 1), i);
            assertEq(hook.tierForFdv(thresholds[i] * 1 ether), i + 1);
        }
    }

    function testSequentialAllTiersFinal24HoursPermanentBypassAndFeePersists() public {
        _buy(alice, 50 ether);
        feed.set(1_000_000e8);
        _advance(2 hours);
        hook.updateMilestone();
        assertEq(hook.tierForFdv(oracle.fdvUsd()), 16);
        for (uint8 tier; tier < 16; ++tier) {
            uint256 duration = tier == 15 ? 24 hours : 6 hours;
            for (uint256 j; j < duration / 5 minutes - 1; ++j) {
                _advance(5 minutes);
                hook.updateMilestone();
                assertEq(hook.tier(), tier, "no early or parallel confirmation");
            }
            _advance(5 minutes);
            assertTrue(hook.updateMilestone());
            assertEq(hook.tier(), tier + 1);
            assertEq(hook.p(), 2000 + uint16(tier + 1) * 500);
        }
        assertTrue(hook.fullyUnlocked());
        feed.setBroken(true);
        _advance(7 days);
        assertFalse(hook.updateMilestone());
        assertTrue(hook.fullyUnlocked());
        vm.prank(payer);
        token.transfer(bob, 1000 ether);
        assertEq(hook.eligible(bob), 0);
        uint256 fees = hook.nftFeeVault().totalAccrued();
        _sell(bob, 1000 ether);
        assertEq(hook.sold(bob), 1000 ether);
        assertGt(hook.nftFeeVault().totalAccrued(), fees);
    }

    function testInvalidDataCadenceAndGapCannotAdvanceOrRevoke() public {
        _buy(alice, 1 ether);
        feed.set(300000e8);
        _confirm();
        assertEq(hook.tier(), 1);
        uint64 start = hook.qualifyingSince(1);
        uint64 last = hook.lastConfirmation();
        _advance(1 minutes);
        hook.updateMilestone();
        assertEq(hook.lastConfirmation(), last);
        feed.setBroken(true);
        _advance(3 minutes);
        assertFalse(hook.updateMilestone());
        assertEq(hook.lastConfirmation(), last);
        assertEq(hook.qualifyingSince(1), start);
        feed.setBroken(false);
        _advance(1 minutes);
        hook.updateMilestone();
        assertEq(hook.qualifyingSince(1), start, "short invalid interval skipped");
        _advance(11 minutes);
        hook.updateMilestone();
        assertGt(hook.qualifyingSince(1), start, "gap restarts");
        assertEq(hook.p(), 2500);
    }

    function testNativePreActivationClaimDeduplicatesAndAllocationSurvivesTransfers() public {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _advance(2 hours);
        _claimReward();
        vm.prank(alice);
        token.transfer(bob, REWARD);
        uint256 payerBalance = token.balanceOf(payer);
        vm.prank(payer);
        token.transfer(bob, payerBalance);
        _deployCompanions();
        _activate();
        _attestReward();
        hook.syncRewards(alice);
        hook.syncRewards(alice);
        hook.syncPayer();
        hook.syncPayer();
        assertEq(hook.eligible(alice), REWARD);
        assertEq(hook.eligible(payer), 30_000_000 ether);
        assertEq(hook.eligible(bob), 0);
        assertEq(hook.nftFeeVault().totalAccrued(), 0);
    }

    function testSetupAndBypassFailClosed() public {
        vm.prank(owner);
        vm.expectRevert(UnlkHookV2.AlreadyActivated.selector);
        hook.configureAndActivate(address(router), rewards, oracle, LAUNCH_NUMBER);
        vm.prank(bob);
        vm.expectRevert(UnlkHookV2.Unauthorized.selector);
        hook.deployCompanions(
            LAUNCH_NUMBER,
            feed,
            [
                type(UnlkRouterV2).creationCode,
                type(MerkleClaimEvidence).creationCode,
                type(UnlkOracle).creationCode,
                type(NftFeeVault).creationCode,
                type(SetupVerifierV2).creationCode
            ]
        );
        BypassRouter bypass = new BypassRouter(IPoolManager(address(manager)));
        vm.expectRevert();
        bypass.attack(key, SwapParams(true, -int256(1 ether), TickMath.MIN_SQRT_PRICE + 1), "");
        vm.expectRevert();
        bypass.attack(
            key, SwapParams(true, -int256(1 ether), TickMath.MIN_SQRT_PRICE + 1), abi.encode(uint256(1))
        );
    }
}
