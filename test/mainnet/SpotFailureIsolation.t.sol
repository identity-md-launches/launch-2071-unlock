// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SpotIntegrationFixture} from "./SpotIntegrationFixture.sol";
import {ImdSpotUsdSource} from "src/mainnet/ImdSpotUsdSource.sol";
import {UnlkImdHook} from "src/mainnet/UnlkImdHook.sol";
import {MainnetPins} from "src/mainnet/MainnetPins.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

abstract contract SpotFailureFixture is SpotIntegrationFixture {
    // Each case corrupts a reference read, while leaving the trading venue and its quote token usable.
    // Code/decimal corruption of the manager or IMD itself is covered by the isolated source tests;
    // requiring trading to survive a broken settlement token would be an invalid liveness property.
    function _invalidate(uint256 kind) internal returns (bytes memory reason) {
        uint256 t = block.timestamp;
        reason = abi.encodeWithSelector(ImdSpotUsdSource.InvalidPrice.selector);
        if (kind == 0) {
            _feedRound(7, feedAnswer, t - 5401, t - 5401, 7);
        } else if (kind == 1) {
            _feedRound(7, 0, t, t, 7);
        } else if (kind == 2) {
            _feedRound(7, -1, t, t, 7);
        } else if (kind == 3) {
            _feedRound(7, feedAnswer, t, t, 6);
        } else if (kind == 4) {
            _feedRound(0, feedAnswer, t, t, 0);
        } else if (kind == 5) {
            _feedRound(7, feedAnswer, 0, t, 7);
        } else if (kind == 6) {
            _feedRound(7, feedAnswer, t, t + 1, 7);
        } else if (kind == 7) {
            _feedRound(7, feedAnswer, t + 1, t, 7);
        } else if (kind == 8) {
            _feedRound(7, 1_000_000e8 + 1, t, t, 7);
        } else if (kind == 9) {
            vm.mockCall(
                MainnetPins.ETHUSD_ADDRESS, abi.encodeWithSignature("decimals()"), abi.encode(uint8(6))
            );
        } else if (kind == 10) {
            reason = abi.encodeWithSignature("Error(string)", "reference feed unavailable");
            vm.mockCallRevert(
                MainnetPins.ETHUSD_ADDRESS, abi.encodeWithSignature("latestRoundData()"), reason
            );
        } else if (kind == 11) {
            _referenceState(REFERENCE_SQRT, 0, 10000);
            reason = abi.encodeWithSelector(ImdSpotUsdSource.PoolUnavailable.selector);
        } else if (kind == 12) {
            _referenceState(REFERENCE_SQRT, 1e18, 3000);
            reason = abi.encodeWithSelector(ImdSpotUsdSource.PoolUnavailable.selector);
        } else if (kind == 13) {
            _referenceState(0, 1e18, 10000);
            reason = abi.encodeWithSelector(ImdSpotUsdSource.PoolUnavailable.selector);
        } else {
            _referenceState(TickMath.MAX_SQRT_PRICE - 1, 1e18, 10000);
        }
    }
}

contract SpotFailureIsolationTest is SpotFailureFixture {
    function testEveryInvalidReferenceLeavesTradingNativeClaimsAndEarnedGateLive() public {
        _advance(CONTRIBUTOR_LOCK);
        // 3000 USD/IMD times the official opening ratio crosses several gates immediately.
        _referenceState(uint160(1 << 96), 1e18, 10000);
        assertTrue(hook.checkpoint());
        uint8 earnedTier = hook.tier();
        assertGt(earnedTier, 0);
        assertLt(earnedTier, 16);
        _referenceState(REFERENCE_SQRT, 1e18, 10000);

        for (uint256 kind; kind < 15; ++kind) {
            uint256 snapshot = vm.snapshotState();
            bytes memory reason = _invalidate(kind);
            vm.expectRevert(reason);
            spotSource.priceUsd();
            assertFalse(hook.checkpoint());

            uint256 acquired = _buy(alice, 2 ether);
            uint256 quota = acquired * hook.p() / 10000;
            assertGt(quota, 0);
            assertGt(_sell(alice, quota), 0);
            bytes[] memory excess = _explorerPlan(false, 1 ether, 1);
            vm.prank(alice);
            _expectHookRevert(IHooks.afterSwap.selector, UnlkImdHook.QuotaExceeded.selector);
            router.execute(hex"10", excess, block.timestamp);
            assertEq(hook.sold(alice), quota);

            _claimReward();
            assertEq(hook.eligible(alice), acquired, "native delivery does not need synchronization");
            vm.prank(alice);
            token.transfer(bob, REWARD);
            assertEq(token.balanceOf(bob), REWARD);
            assertEq(hook.eligible(bob), 0, "ordinary transfers cannot copy quota");
            _attestReward();
            assertEq(hook.syncRewards(alice), REWARD);
            assertEq(hook.syncRewards(alice), 0);
            vault.redeem();
            uint256 before = quote.balanceOf(vault.BENEFICIARY());
            vm.prank(vault.BENEFICIARY());
            vault.withdraw();
            assertEq(quote.balanceOf(vault.BENEFICIARY()) - before, vault.totalAccrued());
            assertEq(hook.tier(), earnedTier);
            assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
            assertTrue(vm.revertToState(snapshot));
            // Foundry mocks are not assumed to be part of the EVM snapshot.
            vm.clearMockedCalls();
            _freshFeed();
        }
    }

    function testFreshnessBoundaryAtExactlyNinetyMinutesThenOneSecondLater() public {
        _referenceState(uint160(1 << 96), 1e18, 10000);
        uint256 t = block.timestamp;
        _feedRound(7, feedAnswer, t - 5400, t - 5400, 7);
        assertTrue(hook.checkpoint());
        uint8 earned = hook.tier();
        vm.warp(t + 1);
        // A high current external spot cannot open a gate while Chainlink is stale.
        _referenceState(uint160(1 << 90), 1e18, 10000);
        vm.expectRevert(ImdSpotUsdSource.InvalidPrice.selector);
        spotSource.priceUsd();
        assertFalse(hook.checkpoint());
        assertEq(hook.tier(), earned);
        _freshFeed();
        assertTrue(hook.checkpoint());
        assertTrue(hook.fullyUnlocked());
        assertEq(block.timestamp, t + 1, "a fresh reference needs no confirmation wait");
    }

    function testRejectedRouterSuffixRollsBackARealSpotDrivenGate() public {
        _referenceState(uint160(1 << 90), 1e18, 10000);
        _fundQuote(alice, 2 ether);
        bytes[] memory badPlan = _explorerPlan(true, 2 ether, 1);
        // The swap and its afterSwap checkpoint succeed; an impossible TAKE_ALL minimum fails afterward.
        (bytes memory actions, bytes[] memory params) = abi.decode(badPlan[0], (bytes, bytes[]));
        params[2] = abi.encode(address(token), type(uint256).max);
        badPlan[0] = abi.encode(actions, params);
        uint256 quoteBefore = quote.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert();
        router.execute(hex"10", badPlan, block.timestamp);
        assertFalse(hook.fullyUnlocked());
        assertEq(hook.tier(), 0);
        assertEq(hook.eligible(alice), 0);
        assertEq(vault.totalAccrued(), 0);
        assertEq(quote.balanceOf(alice), quoteBefore);
        assertEq(manager.balanceOf(address(vault), uint160(address(quote))), 0);
        _buy(alice, 2 ether);
        assertTrue(hook.fullyUnlocked(), "same inputs work after the failed batch has rolled back");
    }
}

contract SpotFailureIsolationReverseOrderTest is SpotFailureIsolationTest {
    function _preferToken0() internal pure override returns (bool) {
        return false;
    }
}

contract SpotActivationFailureMatrixTest is SpotFailureFixture {
    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(-129000);
        _deployCompanions();
    }

    function testAllInvalidReferenceStatesRefuseActivationAtomicallyAndCanRetryImmediately() public {
        uint256 timeBefore = block.timestamp;
        uint256 blockBefore = block.number;
        for (uint256 kind; kind < 15; ++kind) {
            uint256 snapshot = vm.snapshotState();
            bytes memory reason = _invalidate(kind);
            vm.prank(owner);
            vm.expectRevert(reason);
            hook.configureAndActivate(rewards, oracle, LAUNCH_NUMBER);
            assertFalse(hook.activated());
            assertFalse(oracle.bound());
            assertEq(address(hook.oracle()), address(0));
            assertEq(address(hook.rewards()), address(0));
            assertEq(hook.payer(), address(0));
            assertEq(hook.swarm(), address(0));
            assertEq(hook.launchNumber(), 0);
            assertTrue(vm.revertToState(snapshot));
            vm.clearMockedCalls();
            _freshFeed();
        }
        _activate();
        assertTrue(hook.activated());
        assertTrue(oracle.bound());
        assertEq(hook.payer(), token.initialRecipient());
        assertEq(block.timestamp, timeBefore);
        assertEq(block.number, blockBefore);
    }
}
