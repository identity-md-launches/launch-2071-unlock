// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ImdFixture} from "./ImdFixture.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {UnlkImdOracle} from "../../src/mainnet/UnlkImdOracle.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract GateReferenceFixture {
    uint256 private immutable value;

    constructor(uint256 value_) {
        value = value_;
    }

    function priceUsd() external view returns (uint256) {
        return value;
    }
}

/// @dev Router tests execute actual vendored mainnet runtime. Price fixtures here are deliberately synthetic:
/// reference mocks isolate gate/accounting rules; slot0 fixtures isolate exact price boundaries and ordering.
/// None is production history or an assertion about the external reference's manipulation resistance.
contract OneWayGatesTest is ImdFixture {
    using StateLibrary for IPoolManager;

    uint160 private constant Q96 = 1 << 96;

    function _reference(uint256 usd) internal {
        GateReferenceFixture fixedReference = new GateReferenceFixture(usd);
        vm.mockFunction(address(priceSource), address(fixedReference), abi.encodeWithSignature("priceUsd()"));
    }

    function _currentFdvReference(uint256 target) internal {
        // Fixtures use ordinary seed prices well below 2^128 in either order.
        (uint160 s,,,) = IPoolManager(MANAGER).getSlot0(hook.poolId());
        uint256 imdSupplyValue = tokenIs0
            ? Math.mulDiv(1_000_000_000 ether, uint256(s) * s, 1 << 192)
            : Math.mulDiv(1_000_000_000 ether, 1 << 192, uint256(s) * s);
        _reference(Math.mulDiv(target, 1 ether, imdSupplyValue, Math.Rounding.Ceil));
    }

    function _slot0(uint160 sqrtPrice, uint24 protocolFee, uint24 lpFee) internal {
        bytes32 slot = keccak256(abi.encode(PoolId.unwrap(hook.poolId()), uint256(6)));
        vm.store(
            MANAGER,
            slot,
            bytes32(
                uint256(sqrtPrice) | uint256(uint24(TickMath.getTickAtSqrtPrice(sqrtPrice))) << 160
                    | uint256(protocolFee) << 184 | uint256(lpFee) << 208
            )
        );
    }

    function _acquire(address who, uint256 amount) internal {
        uint256 cost = _quoteOut(true, amount);
        _exactOut(who, true, amount, cost + 1);
        assertGe(hook.spendableEligible(who), amount);
    }

    function _expectExcess(address who, uint256 amount) internal {
        bytes[] memory plan = _explorerPlan(false, amount, 1);
        vm.prank(who);
        _expectHookRevert(IHooks.afterSwap.selector, UnlkImdHook.QuotaExceeded.selector);
        router.execute(hex"10", plan, block.timestamp + 600);
    }

    function testExact1000Then200ThenOnly100At30Percent() public {
        _acquire(alice, 1000 ether);
        assertEq(hook.p(), 2000);
        assertEq(hook.eligible(alice), 1000 ether);
        assertEq(hook.remainingQuota(alice), 200 ether);
        _sell(alice, 200 ether);
        assertEq(token.balanceOf(alice), 800 ether);
        assertEq(hook.sold(alice), 200 ether);
        assertEq(hook.remainingQuota(alice), 0);
        _currentFdvReference(300000 ether);
        assertTrue(hook.checkpoint());
        assertEq(hook.p(), 3000);
        assertEq(hook.remainingQuota(alice), 100 ether, "30% of original cumulative 1000, minus 200");
        _expectExcess(alice, 100 ether + 1);
        _sell(alice, 100 ether);
        assertEq(hook.sold(alice), 300 ether);
        assertEq(hook.eligible(alice), 1000 ether);
        assertEq(hook.remainingQuota(alice), 0);
        assertFalse(hook.checkpoint());
        assertFalse(hook.updateMilestone());
        assertEq(hook.remainingQuota(alice), 0, "repeated evaluation never restores consumed quota");
    }

    function testPartialSalesRoundingAndNewAcquisitionsNeverResetSold() public {
        _acquire(alice, 1000 ether + 3);
        assertEq(hook.remainingQuota(alice), 200 ether);
        _sell(alice, 73 ether);
        _sell(alice, 127 ether);
        _expectExcess(alice, 1 ether);
        _acquire(alice, 5 ether + 2);
        assertEq(hook.eligible(alice), 1005 ether + 5);
        assertEq(hook.sold(alice), 200 ether);
        assertEq(hook.remainingQuota(alice), 1 ether + 1);
        _sell(alice, 1 ether + 1);
        assertEq(hook.sold(alice), 201 ether + 1);
        assertEq(hook.remainingQuota(alice), 0);
    }

    function testEveryExactThresholdAndOneWeiBelowUsesSqrtNotRoundedTick() public {
        for (uint8 i; i < 16; ++i) {
            uint256 snapshot = vm.snapshotState();
            uint256 threshold = hook.tierThreshold(i);
            _reference(threshold / 1_000_000_000);
            // One Q96 unit on the cheaper side is <1 USD wei away at all thresholds: floor == threshold-1.
            _slot0(tokenIs0 ? Q96 - 1 : Q96 + 1, 0, 12500);
            assertEq(oracle.fdvUsd(), threshold - 1);
            hook.checkpoint();
            assertEq(hook.tier(), i);
            _slot0(Q96, 0, 12500);
            assertEq(oracle.fdvUsd(), threshold);
            assertTrue(hook.checkpoint());
            assertEq(hook.tier(), i + 1);
            assertEq(hook.p(), 2500 + uint16(i) * 500);
            assertEq(hook.fullyUnlocked(), i == 15);
            assertTrue(vm.revertToState(snapshot));
        }
    }

    function testMultiTierJumpBriefSpikeAndPriceDeclineNeverReduceRights() public {
        uint256 nowTime = block.timestamp;
        _slot0(Q96, 0, 12500);
        _reference(5_000_000 ether / 1_000_000_000);
        assertTrue(hook.updateMilestone());
        assertEq(hook.tier(), 7);
        assertEq(hook.p(), 5500);
        assertEq(block.timestamp, nowTime, "no confirmation delay");
        _reference(1);
        assertFalse(hook.checkpoint());
        assertEq(hook.tier(), 7);
        assertEq(hook.p(), 5500);
        assertEq(hook.eligible(alice), 0);
        assertEq(hook.sold(alice), 0);
    }

    function testSaleCannotUseItsOwnPostSwapGateRetroactively() public {
        _acquire(alice, 1000 ether);
        _currentFdvReference(300000 ether);
        // A view read does not persist a gate. The excessive sale's otherwise qualifying post-price cannot help.
        assertGe(oracle.fdvUsd(), 250000 ether);
        assertEq(hook.p(), 2000);
        _expectExcess(alice, 201 ether);
        assertEq(hook.tier(), 0);
        assertEq(hook.sold(alice), 0);
        _sell(alice, 200 ether);
        assertEq(hook.p(), 3000, "within-old-quota sale can advance gates AFTER accounting");
        assertEq(hook.remainingQuota(alice), 100 ether);
        _sell(alice, 100 ether);
        assertEq(hook.sold(alice), 300 ether);
    }

    function _buySellBatch(uint256 buyAmount, uint256 sellAmount, uint256 budget, uint256 minimum)
        internal
        view
        returns (bytes[] memory inputs)
    {
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(ExactOut(key, !tokenIs0, uint128(buyAmount), uint128(budget), ""));
        params[1] = abi.encode(ExactIn(key, tokenIs0, uint128(sellAmount), 1, ""));
        params[2] = abi.encode(address(quote), budget);
        params[3] = abi.encode(address(token), minimum);
        inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"08060c0f", params);
    }

    function testSameTransactionEarlierBuyOpensGateForMatureQuotaButNewCreditWaits() public {
        _acquire(alice, 1000 ether);
        _currentFdvReference(300000 ether);
        uint256 budget = 1 ether;
        _fundQuote(alice, budget);
        _execute(alice, hex"10", _buySellBatch(1000 ether, 300 ether, budget, 700 ether), 0);
        assertEq(hook.p(), 3000);
        assertEq(hook.eligible(alice), 2000 ether);
        assertEq(hook.spendableEligible(alice), 1000 ether);
        assertEq(hook.sold(alice), 300 ether);
        assertEq(hook.remainingQuota(alice), 0);
        assertEq(token.balanceOf(alice), 1700 ether);
        vm.roll(block.number + 1);
        assertEq(hook.remainingQuota(alice), 300 ether);
    }

    function testSameTransactionNewGateDoesNotMatureFreshCreditsAndRevertedBatchRestoresGate() public {
        _acquire(alice, 1000 ether);
        _currentFdvReference(300000 ether);
        _fundQuote(alice, 1 ether);
        bytes[] memory inputs = _buySellBatch(1000 ether, 301 ether, 1 ether, 1);
        uint256 fee = vault.totalAccrued();
        (uint160 beforePrice,,,) = IPoolManager(MANAGER).getSlot0(hook.poolId());
        vm.prank(alice);
        _expectHookRevert(IHooks.afterSwap.selector, UnlkImdHook.QuotaExceeded.selector);
        router.execute(hex"10", inputs, block.timestamp + 600);
        assertEq(hook.tier(), 0);
        assertEq(hook.eligible(alice), 1000 ether);
        assertEq(hook.sold(alice), 0);
        assertEq(hook.spendableEligible(alice), 1000 ether);
        assertEq(vault.totalAccrued(), fee);
        (uint160 afterPrice,,,) = IPoolManager(MANAGER).getSlot0(hook.poolId());
        assertEq(afterPrice, beforePrice);
    }

    function _fullSpikeCycle(uint256 bought, uint256 minimum) internal view returns (bytes[] memory inputs) {
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(ExactIn(key, !tokenIs0, 200000 ether, 1, ""));
        params[1] = abi.encode(ExactIn(key, tokenIs0, uint128(bought), 1, ""));
        params[2] = abi.encode(address(quote), uint256(200000 ether));
        params[3] = abi.encode(address(token), minimum);
        inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"06060c0f", params);
    }

    function testBriefBuySpikeThenFullSaleSameTransactionPreservesHighestSwapBoundary() public {
        uint256 bought = _quoteIn(true, 200000 ether);
        _fundQuote(alice, 200000 ether);
        _execute(alice, hex"10", _fullSpikeCycle(bought, 0), 0);
        assertTrue(hook.fullyUnlocked());
        assertEq(hook.tier(), 16);
        assertEq(hook.p(), 10000);
        assertEq(hook.spendableEligible(alice), 0, "fresh buy still immature, but final bypass is global");
        assertEq(hook.eligible(alice), bought);
        assertEq(hook.sold(alice), bought);
        assertEq(token.balanceOf(alice), 0);
        assertLt(oracle.fdvUsd(), 100000 ether, "end-of-transaction price misses the brief high touch");
        assertFalse(hook.checkpoint());
    }

    function testLateBatchRevertRestoresFinalBypassSalesCreditsFeesAndPool() public {
        uint256 bought = _quoteIn(true, 200000 ether);
        _fundQuote(alice, 200000 ether);
        bytes[] memory inputs = _fullSpikeCycle(bought, 1); // net UNLK output is zero: TAKE_ALL must fail.
        (uint160 beforePrice,,,) = IPoolManager(MANAGER).getSlot0(hook.poolId());
        vm.prank(alice);
        vm.expectRevert();
        router.execute(hex"10", inputs, block.timestamp + 600);
        assertFalse(hook.fullyUnlocked());
        assertEq(hook.tier(), 0);
        assertEq(hook.p(), 2000);
        assertEq(hook.eligible(alice), 0);
        assertEq(hook.sold(alice), 0);
        assertEq(vault.totalAccrued(), 0);
        assertEq(manager.balanceOf(address(vault), uint160(address(quote))), 0);
        (uint160 afterPrice,,,) = IPoolManager(MANAGER).getSlot0(hook.poolId());
        assertEq(afterPrice, beforePrice);
    }

    function testInvalidReferenceOnlyBlocksNewGatesNotTradingTransfersOrNativeClaims() public {
        _acquire(alice, 1000 ether);
        _currentFdvReference(300000 ether);
        assertTrue(hook.checkpoint());
        _reference(0);
        assertFalse(hook.updateMilestone());
        assertGt(_sell(alice, 200 ether), 0);
        vm.prank(alice);
        token.transfer(bob, 100 ether);
        assertEq(hook.eligible(bob), 0);
        _claimReward(); // native claim requires no hook/oracle/synchronization.
        assertEq(hook.eligible(alice), 1000 ether);
        _attestReward();
        assertEq(hook.syncRewards(alice), REWARD);
        assertEq(hook.syncRewards(alice), 0);
        assertEq(hook.syncPayer(), token.PAYER_ALLOCATION());
        assertEq(hook.syncPayer(), 0);
        assertEq(hook.p(), 3000);
        assertEq(hook.sold(alice), 200 ether);
    }

    function testPermanentFinalBypassForTransferOnlyHolderWithZeroEAfterDeclineAndOutage() public {
        _buy(alice, 200000 ether);
        assertTrue(hook.fullyUnlocked());
        uint256 amount = token.balanceOf(alice);
        vm.prank(alice);
        token.transfer(bob, amount);
        _reference(0);
        uint256 beforeFee = vault.totalAccrued();
        assertEq(hook.eligible(bob), 0);
        assertGt(_sell(bob, amount), 0);
        assertEq(hook.sold(bob), amount);
        assertEq(token.balanceOf(bob), 0);
        assertEq(hook.eligible(bob), 0);
        assertTrue(hook.fullyUnlocked());
        assertEq(hook.remainingQuota(bob), type(uint256).max);
        assertGt(vault.totalAccrued(), beforeFee);
    }

    function testWrongPoolCheckpointAndInvalidCurrentStateCannotGrantRights() public {
        _reference(1_000_000 ether);
        _slot0(Q96, 0, 10000);
        assertFalse(hook.checkpoint());
        _slot0(TickMath.getSqrtPriceAtTick(tokenIs0 ? seedLower - 1 : seedUpper + 1), 0, 12500);
        assertFalse(hook.checkpoint());
        assertEq(hook.tier(), 0);
        // A separate PoolId with an enormous apparent price has no effect on the bound official pool.
        _slot0(TickMath.getSqrtPriceAtTick(tokenIs0 ? seedLower : seedUpper), 0, 12500);
        _reference(1);
        PoolKey memory other = key;
        other.tickSpacing = 200;
        bytes32 foreign = keccak256(abi.encode(keccak256(abi.encode(other)), uint256(6)));
        vm.store(MANAGER, foreign, bytes32(uint256(Q96) | uint256(12500) << 208));
        assertFalse(hook.checkpoint());
        assertEq(hook.tier(), 0);
    }

    function testProtocolFeeDoesNotInvalidateSpotOrPreventPermanentGateAdvancement() public {
        _reference(50000000 ether / 1_000_000_000);
        _slot0(Q96, 0x3e83e8, 12500); // Core maximum: 1000 pips in each direction.
        assertEq(oracle.fdvUsd(), 50000000 ether);
        assertTrue(hook.checkpoint());
        assertEq(hook.tier(), 16);
        assertTrue(hook.fullyUnlocked());
        _reference(1);
        assertFalse(hook.checkpoint());
        assertTrue(hook.fullyUnlocked());
    }

    function testUnobservedPriceTouchIsNotBackfilled() public {
        _reference(100000 ether / 1_000_000_000);
        _slot0(Q96, 0, 12500);
        assertEq(oracle.fdvUsd(), 100000 ether, "view reads never persist gates");
        _slot0(tokenIs0 ? Q96 - 1 : Q96 + 1, 0, 12500);
        assertFalse(hook.checkpoint());
        assertEq(hook.tier(), 0, "a past unobserved touch is not reconstructed");
    }

    function _breakReference() internal virtual {
        market.setOutage(true);
    }

    function testRevertingReferenceStillSettlesQualifyingBuyAndWithinOldQuotaSale() public {
        _breakReference();
        uint256 bought = _buy(alice, 10000 ether);
        assertEq(hook.tier(), 0, "reference failure blocks advancement even at high UNLK spot");
        assertEq(hook.eligible(alice), bought);
        assertGt(_sell(alice, bought / 5), 0);
        assertEq(hook.sold(alice), bought / 5);
        assertEq(hook.tier(), 0);
        assertFalse(hook.checkpoint());
    }

    function testLiquidityFeeReceiptsAndDonationsNeverCreditEligibility() public {
        uint256 bought = _buy(alice, 100 ether);
        _sell(alice, bought / 10);
        hook.syncPayer();
        uint256 beforeE = hook.eligible(payer);
        uint256 beforeBalance = token.balanceOf(payer);
        factory.claimFees(LAUNCH_NUMBER);
        assertGt(token.balanceOf(payer), beforeBalance);
        assertEq(hook.eligible(payer), beforeE, "LP fee collection creates no quota rights");
        vm.prank(payer);
        token.transfer(MANAGER, 1 ether);
        vm.prank(payer);
        token.transfer(address(vault), 1 ether);
        assertEq(hook.eligible(MANAGER), 0);
        assertEq(hook.eligible(address(vault)), 0);
        assertEq(hook.eligible(payer), beforeE);
        assertEq(hook.sold(payer), 0);
    }

    function testOracleCannotBindUnauthorizedDifferentPoolOrSecondTime() public {
        vm.expectRevert(UnlkImdOracle.Unauthorized.selector);
        oracle.bind(key, address(token), seedLower, seedUpper);
        UnlkImdOracle unbound = new UnlkImdOracle(IPoolManager(MANAGER), oracle.feed(), address(hook));
        vm.expectRevert(UnlkImdOracle.InvalidOracle.selector);
        unbound.fdvUsd();
        PoolKey memory wrong = key;
        wrong.tickSpacing = 200;
        vm.prank(address(hook));
        vm.expectRevert(UnlkImdOracle.InvalidConfig.selector);
        unbound.bind(wrong, address(token), seedLower, seedUpper);
        assertFalse(unbound.bound());
        vm.prank(address(hook));
        unbound.bind(key, address(token), seedLower, seedUpper);
        assertEq(PoolId.unwrap(unbound.poolId()), PoolId.unwrap(hook.poolId()));
        vm.prank(address(hook));
        vm.expectRevert(UnlkImdOracle.Unauthorized.selector);
        unbound.bind(key, address(token), seedLower, seedUpper);
    }

    function testFuzzCumulativeEntitlementSurvivesGateJumpAndAdditionalBuy(uint96 raw, uint8 tierRaw) public {
        uint256 e = bound(raw, 100 ether, 100000 ether);
        uint8 next = uint8(bound(tierRaw, 1, 15));
        _acquire(alice, e);
        uint256 initialSale = e * 2000 / 10000;
        _sell(alice, initialSale);
        _currentFdvReference(hook.tierThreshold(next - 1) * 1001 / 1000);
        hook.checkpoint();
        assertEq(hook.tier(), next);
        uint256 expected = e * (2000 + uint256(next) * 500) / 10000 - initialSale;
        assertEq(hook.remainingQuota(alice), expected);
        _reference(1); // price decrease cannot revoke or restore capacity
        assertFalse(hook.checkpoint());
        assertEq(hook.remainingQuota(alice), expected);
        assertEq(hook.sold(alice), initialSale);
        assertEq(hook.eligible(alice), e);
    }
}

contract OneWayGatesReverseOrderTest is OneWayGatesTest {
    function _preferToken0() internal pure override returns (bool) {
        return false;
    }
}
