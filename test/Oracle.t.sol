// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {UnlkHook} from "../src/UnlkHook.sol";
import {UnlkOracle} from "../src/UnlkOracle.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {MockWETH} from "./fixtures/LocalFixtures.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// LOCAL flash-loan fixture. This tests an atomic price excursion; it is not a production lender.
interface IFlashBorrower {
    function onFlashLoan(uint256 amount) external;
}

contract LocalFlashLender {
    IERC20 immutable currency;

    constructor(IERC20 currency_) {
        currency = currency_;
    }

    function loan(uint256 amount) external {
        uint256 beforeBalance = currency.balanceOf(address(this));
        require(currency.transfer(msg.sender, amount));
        IFlashBorrower(msg.sender).onFlashLoan(amount);
        require(currency.balanceOf(address(this)) >= beforeBalance, "unpaid fixture loan");
    }
}

contract LocalFlashAttacker is IFlashBorrower {
    LocalFlashLender immutable lender;
    IERC20 immutable quote;
    UnlkSwapRouter immutable router;
    UnlkHook immutable hook;
    UnlkSwapRouter.SwapRequest private request;
    uint16 public observedP;

    constructor(LocalFlashLender l, IERC20 q, UnlkSwapRouter r, UnlkHook h) {
        lender = l;
        quote = q;
        router = r;
        hook = h;
        quote.approve(address(r), type(uint256).max);
    }

    function attack(UnlkSwapRouter.SwapRequest calldata r) external {
        request = r;
        lender.loan(r.maxInput);
    }

    function onFlashLoan(uint256 amount) external {
        require(msg.sender == address(lender));
        router.swap(request);
        hook.updateMilestone();
        observedP = hook.p();
        require(quote.transfer(address(lender), amount));
    }
}

contract OracleTest is SystemFixture {
    using StateLibrary for IPoolManager;
    using StateLibrary for IPoolManager;
    int24 internal openingTick;

    /// @dev A 12 ETH local buy moves the policy seed above the first FDV tier at the fixture feed price.
    function setUp() public virtual override {
        super.setUp();
        _localWarmUpBuy(12 ether);
        (, openingTick,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        if (!tokenIs0) openingTick = -openingTick;
    }

    /// @dev Quote wei per whole token at a normalized tick, from the canonical sqrt price.
    function _priceWeiPerToken(int24 tick) internal pure returns (uint256) {
        uint256 sqrt = TickMath.getSqrtPriceAtTick(tick);
        return Math.mulDiv(Math.mulDiv(sqrt, sqrt, 1 << 96), 1 ether, 1 << 96);
    }

    function _warm() internal {
        _advance(2 hours);
        oracle.checkpoint();
    }

    function testWarmupAndExactWindow() public {
        vm.expectRevert(UnlkOracle.InvalidOracle.selector);
        oracle.fdvUsd();
        _advance(2 hours - 1);
        oracle.checkpoint();
        vm.expectRevert(UnlkOracle.InvalidOracle.selector);
        oracle.fdvUsd();
        _advance(1);
        oracle.checkpoint();
        uint256 fdv = oracle.fdvUsd();
        // FDV = 1e9 tokens x TWAP price x ETH/USD (2000); the warm-up buy moved the opening price up.
        uint256 expected =
            1_000_000_000 ether * 2000 / 1e18 * _priceWeiPerToken(openingTick) / 1 ether * 1 ether;
        assertApproxEqRel(fdv, expected, 0.01e18);
        assertEq(oracle.twapTick(), openingTick);
    }

    function testSameTimestampManipulationHasNoTimeWeight() public {
        _warm();
        uint256 beforeFdv = oracle.fdvUsd();
        uint256 count = oracle.observationCount();
        _buy(alice, 500 ether);
        assertEq(oracle.fdvUsd(), beforeFdv);
        assertEq(oracle.observationCount(), count);
        hook.updateMilestone();
        assertEq(hook.p(), 2500);
        assertFalse(hook.fullyUnlocked());
    }

    function testOneBlockSpikeCannotConfirm() public {
        _warm();
        _buy(alice, 500 ether);
        _advance(12);
        hook.updateMilestone();
        assertFalse(hook.fullyUnlocked());
        assertEq(hook.p(), 2500);
    }

    function testSustainedManipulationRequiresWindowAndConfirmation() public {
        _warm();
        _buy(alice, 500 ether);
        _advance(2 hours);
        hook.updateMilestone();
        assertEq(hook.tierForFdv(oracle.fdvUsd()), 6);
        assertFalse(hook.fullyUnlocked());
        for (uint256 i; i < 71; ++i) {
            _advance(5 minutes);
            hook.updateMilestone();
        }
        assertFalse(hook.fullyUnlocked());
        _advance(5 minutes);
        hook.updateMilestone();
        assertEq(hook.tier(), 1);
        assertFalse(hook.fullyUnlocked());
        // An onchain-only oracle cannot distinguish a funded 90-minute manipulation from a lasting market price.
    }

    function testConfirmationGapRestartsRatherThanCountingUnobservedTime() public {
        feed.set(300000e8);
        _warm();
        hook.updateMilestone();
        uint256 first = hook.qualifyingSince(0);
        _advance(hook.MAX_CONFIRMATION_GAP() + 1);
        hook.updateMilestone();
        assertGt(hook.qualifyingSince(0), first);
        assertEq(hook.tier(), 0);
        for (uint256 i; i < 72; ++i) {
            _advance(5 minutes);
            hook.updateMilestone();
        }
        assertEq(hook.tier(), 1);
        assertFalse(hook.fullyUnlocked());
    }

    function testStaleCheckpointAndFeedPreventNewTierButNotTrades() public {
        _warm();
        _advance(301);
        vm.expectRevert(UnlkOracle.InvalidOracle.selector);
        oracle.fdvUsd();
        oracle.checkpoint();
        assertGt(oracle.fdvUsd(), 0);
        vm.warp(block.timestamp + oracle.MAX_FEED_AGE() + 1);
        oracle.checkpoint();
        vm.expectRevert(UnlkOracle.InvalidOracle.selector);
        oracle.fdvUsd();
        assertFalse(hook.updateMilestone());
        assertEq(hook.p(), 2500);
        uint256 bought = _buy(alice, 1 ether);
        _sell(alice, bought / 4);
    }

    function testBadChainlinkRoundsAndAnswersFailClosed() public {
        _warm();
        feed.set(0);
        _invalid();
        feed.set(-1);
        _invalid();
        feed.set(2000e8);
        feed.setRound(2, block.timestamp, block.timestamp, 1);
        _invalid();
        feed.setRound(0, block.timestamp, block.timestamp, 0);
        _invalid();
        feed.setRound(2, block.timestamp, block.timestamp + 1, 2);
        _invalid();
        feed.setRound(2, block.timestamp + 1, block.timestamp, 2);
        _invalid();
        feed.setRound(2, 0, block.timestamp, 2);
        _invalid();
        feed.setRound(2, block.timestamp, 0, 2);
        _invalid();
        feed.setRound(2, block.timestamp, block.timestamp, 2);
        feed.setDecimals(19);
        _invalid();
        feed.setDecimals(8);
        feed.set(1_000_001e8);
        _invalid();
        feed.set(2000e8);
        feed.setBroken(true);
        _invalid();
    }

    function _invalid() internal {
        vm.expectRevert();
        oracle.fdvUsd();
        assertFalse(hook.updateMilestone());
        assertEq(hook.p(), 2500);
    }

    /// @dev Invalid data blocks new tiers only. A failed oracle read neither confirms nor erases a pending
    /// confirmation (the previous code deleted all progress, so one failing call per hour kept p at 2500 forever).
    function testInvalidDataCannotCountTowardPendingConfirmationOrRevokeRights() public {
        feed.set(300000e8);
        _confirm();
        assertEq(hook.tier(), 1);
        uint64 since = hook.qualifyingSince(1);
        uint64 last = hook.lastConfirmation();
        feed.setBroken(true);
        _advance(1 minutes);
        assertFalse(hook.updateMilestone());
        assertEq(hook.qualifyingSince(1), since, "pending start remains visible");
        assertEq(hook.lastConfirmation(), last, "invalid sample never confirms");
        assertEq(hook.tier(), 1, "earned rights retained");
        feed.setBroken(false);
        _advance(3 minutes);
        hook.updateMilestone();
        // The one-minute invalid interval sits inside the 10-minute valid-sample gap, so the run continues exactly
        // as it would have had nobody called during it (see testObservedAndUnobservedInvalidIntervalsAgree).
        assertEq(hook.qualifyingSince(1), since, "short invalid interval neither counts nor restarts");
        assertEq(hook.lastConfirmation(), block.timestamp, "the valid sample confirms");
        assertEq(hook.p(), 3500);
    }

    /// @dev Finding 66b99dca: whether a short feed failure restarts confirmation must not depend on whether a
    /// permissionless call happened to observe it. Both runs: 5h50m of confirmation, one invalid minute, then
    /// the same two valid samples. Both must confirm tier 1 at the same moment.
    function testObservedAndUnobservedInvalidIntervalsAgree() public {
        uint256 snapshot = vm.snapshotState();
        uint8 unobserved = _invalidMinuteThenTwoSamples(false);
        uint64 unobservedSince = hook.qualifyingSince(0);
        vm.revertToState(snapshot);
        uint8 observed = _invalidMinuteThenTwoSamples(true);
        assertEq(observed, unobserved, "call timing changed the outcome");
        assertEq(observed, 1, "tier 1 confirmed in both runs");
        assertEq(hook.qualifyingSince(0), unobservedSince, "same pending start in both runs");
    }

    function _invalidMinuteThenTwoSamples(bool callDuringFailure) internal returns (uint8) {
        feed.set(300000e8);
        _warm();
        hook.updateMilestone();
        uint64 since = hook.qualifyingSince(0);
        for (uint256 i; i < 70; ++i) {
            _advance(5 minutes);
            hook.updateMilestone();
        }
        assertEq(hook.tier(), 0);
        assertEq(hook.qualifyingSince(0), since);
        feed.setBroken(true);
        _advance(1 minutes);
        if (callDuringFailure) assertFalse(hook.updateMilestone());
        feed.setBroken(false);
        _advance(4 minutes);
        feed.fresh();
        hook.updateMilestone();
        _advance(5 minutes);
        hook.updateMilestone();
        return hook.tier();
    }

    /// @dev An invalid interval longer than the maximum gap restarts whether or not it was observed mid-way.
    function testLongInvalidIntervalRestartsWhetherObservedOrNot() public {
        feed.set(300000e8);
        _warm();
        hook.updateMilestone();
        uint64 since = hook.qualifyingSince(0);
        feed.setBroken(true);
        _advance(6 minutes);
        assertFalse(hook.updateMilestone());
        assertEq(hook.qualifyingSince(0), since, "pending start visible through the failure");
        _advance(6 minutes);
        feed.setBroken(false);
        feed.fresh();
        hook.updateMilestone();
        assertGt(hook.qualifyingSince(0), since, "12 minutes without a valid sample restarts");
        assertEq(hook.tier(), 0);
    }

    function testInvalidDataLongerThanGapRestartsOnNextValidCall() public {
        feed.set(300000e8);
        _warm();
        hook.updateMilestone();
        uint64 since = hook.qualifyingSince(0);
        feed.setBroken(true);
        _advance(15 minutes);
        hook.updateMilestone();
        assertEq(hook.qualifyingSince(0), since);
        feed.setBroken(false);
        hook.updateMilestone();
        assertGt(hook.qualifyingSince(0), since);
        assertEq(hook.tier(), 0);
    }

    /// @dev The measured Sepolia ETH/USD cadence (rounds 3624-3636 s apart, above the published one-hour heartbeat).
    /// A keeper updates every 5 minutes and an unprivileged address calls once per round just after one hour has
    /// elapsed since the round, inside what used to be the stale window. The first tier confirms on schedule.
    function testRealFeedCadenceCannotBeUsedToResetConfirmation() public {
        uint256 cadence = 3624;
        uint80 round = 100;
        uint256 updatedAt = block.timestamp;
        feed.setRound(round, updatedAt, updatedAt, round);
        _warm();
        updatedAt = block.timestamp;
        feed.setRound(round, updatedAt, updatedAt, round);
        uint256 start = block.timestamp;
        uint256 nextKeeper = block.timestamp;
        uint256 nextGrief = updatedAt + 3601;
        uint256 firstTierAt;
        while (block.timestamp < start + 8 hours) {
            uint256 nextRound = updatedAt + cadence;
            uint256 next = Math.min(nextKeeper, Math.min(nextGrief, nextRound));
            vm.warp(next);
            vm.roll(block.number + 1);
            if (next == nextRound) {
                updatedAt = next;
                ++round;
                feed.setRound(round, updatedAt, updatedAt, round);
                nextGrief = updatedAt + 3601;
            }
            if (next == nextGrief) {
                vm.prank(bob);
                hook.updateMilestone();
                nextGrief = type(uint256).max;
            }
            if (next == nextKeeper) {
                hook.updateMilestone();
                nextKeeper = next + 5 minutes;
            }
            if (firstTierAt == 0 && hook.tier() >= 1) firstTierAt = block.timestamp;
        }
        assertGe(hook.tier(), 1, "first tier never confirmed");
        assertLe(firstTierAt - start, 6 hours + 5 minutes, "first tier confirmed on schedule");
        assertGt(hook.p(), 2500);
    }

    function _warmWithoutFeedRefresh() internal {
        vm.warp(block.timestamp + 2 hours);
        vm.roll(block.number + 1);
        oracle.checkpoint();
    }

    function testEveryTierAndPermanentUnlock() public {
        uint256[6] memory targets = [uint256(120000), 300000, 600000, 1200000, 3000000, 6000000];
        uint16[6] memory ps = [uint16(3500), 4500, 5500, 7000, 8500, 10000];
        _warm();
        uint256 baseFdv = oracle.fdvUsd();
        for (uint256 i; i < targets.length; ++i) {
            feed.set(int256(2000e8 * targets[i] * 1 ether / baseFdv));
            _confirm();
            assertEq(hook.p(), ps[i]);
            assertEq(hook.tier(), i + 1);
        }
        assertTrue(hook.fullyUnlocked());
        feed.set(1);
        _advance(7 days);
        feed.setBroken(true);
        hook.updateMilestone();
        assertEq(hook.p(), 10000);
        assertTrue(hook.fullyUnlocked());
        vm.prank(payer);
        token.transfer(bob, 1_000_000 ether);
        assertEq(hook.eligible(bob), 0);
        _sell(bob, 1_000_000 ether);
        assertEq(hook.sold(bob), 1_000_000 ether);
    }

    function testFallingPricesNeverLowerReachedTier() public {
        feed.set(30000e8);
        _confirm();
        uint16 p = hook.p();
        assertGt(p, 2500);
        feed.set(1);
        _confirm();
        assertEq(hook.p(), p);
        assertFalse(hook.fullyUnlocked());
    }

    function testThresholdMappingBoundaries() public view {
        uint256[6] memory thresholds = [uint256(100000), 250000, 500000, 1000000, 2500000, 5000000];
        for (uint8 i; i < 6; ++i) {
            assertEq(hook.tierForFdv(thresholds[i] * 1 ether - 1), i);
            assertEq(hook.tierForFdv(thresholds[i] * 1 ether), i + 1);
        }
    }

    function testOracleCannotBeReboundOrConfiguredByAnyone() public {
        vm.prank(bob);
        vm.expectRevert(UnlkOracle.Unauthorized.selector);
        oracle.bind(key, address(token), -60, 60);
        vm.prank(address(hook));
        vm.expectRevert(UnlkOracle.Unauthorized.selector);
        oracle.bind(key, address(token), -60, 60);
    }

    function testNegativeTickAveragesRoundConservativelyForBothOrders() public {
        _warm();
        _advance(1);
        _buy(alice, 0.1 ether);
        _advance(1);
        oracle.checkpoint();
        int24 average = oracle.twapTick();
        assertLe(average, openingTick + 1);
        assertGe(average, openingTick - 1);
    }
}

