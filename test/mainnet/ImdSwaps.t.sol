// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ImdFixture} from "./ImdFixture.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {ImdFeeVault} from "../../src/mainnet/ImdFeeVault.sol";
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";

contract ImdSwapsTest is ImdFixture {
    function testExplorerBuySellClaimsRevenueAndDonationSeparation() public {
        uint256 bought = _buy(alice, 100 ether);
        assertGt(bought, 0);
        assertEq(hook.eligible(alice), bought);
        uint256 net = _sell(alice, bought / 5);
        assertGt(net, 0);
        assertEq(hook.sold(alice), bought / 5);
        uint256 accrued = vault.totalAccrued();
        assertGt(accrued, 0);
        assertEq(manager.balanceOf(address(vault), uint160(address(quote))), accrued);
        _fundQuote(address(vault), 7 ether);
        assertEq(vault.donations(), 7 ether);
        vault.redeem();
        assertEq(vault.claimable(), accrued);
        assertEq(vault.pendingClaims(), 0);
        assertEq(vault.donations(), 7 ether);
        vm.expectRevert(ImdFeeVault.Unauthorized.selector);
        vault.withdraw();
        uint256 before = quote.balanceOf(vault.BENEFICIARY());
        vm.prank(vault.BENEFICIARY());
        vault.withdraw();
        assertEq(quote.balanceOf(vault.BENEFICIARY()), before + accrued);
        assertEq(vault.totalWithdrawn(), accrued);
        assertEq(vault.donations(), 7 ether);
        vm.prank(vault.BENEFICIARY());
        vault.withdrawDonations();
        assertEq(vault.donations(), 0);
        assertEq(vault.totalAccrued(), accrued);
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
    }

    function testFuzzExecutedImdConservation(uint96 grossInput, uint16 saleBps) public {
        uint256 gross = bound(grossInput, 1e8, 1000 ether);
        uint256 beforeManager = quote.balanceOf(MANAGER);
        uint256 out = _buy(alice, gross);
        assertEq(quote.balanceOf(MANAGER) - beforeManager, gross);
        uint256 fee = vault.totalAccrued();
        uint256 amount = out * bound(saleBps, 1, 2000) / 10000;
        vm.assume(amount > 0);
        uint256 net = _sell(alice, amount);
        uint256 sellFee = vault.totalAccrued() - fee;
        assertEq(sellFee, (net + sellFee) * 75 / 10000);
        assertEq(quote.balanceOf(MANAGER), beforeManager + gross - net);
        assertEq(manager.balanceOf(address(vault), uint160(address(quote))), vault.totalAccrued());
        assertLe(hook.sold(alice), hook.eligible(alice) / 5);
    }

    function testMissingTokenReceiptRollsBackWithdrawalAccounting() public {
        _buy(alice, 100 ether);
        vault.redeem();
        uint256 accrued = vault.totalAccrued();
        vm.mockCall(
            address(quote),
            abi.encodeWithSignature("transfer(address,uint256)", vault.BENEFICIARY(), accrued),
            abi.encode(true)
        );
        vm.prank(vault.BENEFICIARY());
        vm.expectRevert(ImdFeeVault.InvalidReceipt.selector);
        vault.withdraw();
        assertEq(vault.totalWithdrawn(), 0);
        assertEq(vault.claimable(), accrued);
        vm.clearMockedCalls();
        vm.prank(vault.BENEFICIARY());
        vault.withdraw();
        assertEq(vault.claimable(), 0);
    }

    function testAllFourModesAndFeeInclusiveQuoter() public {
        uint256 quoteOut = _quoteIn(true, 100 ether);
        assertEq(_buy(alice, 100 ether), quoteOut);
        uint256 sellAmount = token.balanceOf(alice) / 20;
        uint256 expectedNet = _quoteIn(false, sellAmount);
        assertEq(_sell(alice, sellAmount), expectedNet);
        uint256 buyAmount = 1000 ether;
        uint256 buyCost = _quoteOut(true, buyAmount);
        uint256 balance = token.balanceOf(bob);
        _exactOut(bob, true, buyAmount, buyCost + 1 ether);
        assertEq(token.balanceOf(bob), balance + buyAmount);
        uint256 sellNet = _quoteIn(false, buyAmount / 10);
        uint256 sellCost = _quoteOut(false, sellNet);
        uint256 before = quote.balanceOf(bob);
        _exactOut(bob, false, sellNet, sellCost + 1 ether);
        assertEq(quote.balanceOf(bob), before + sellNet);
        assertEq(hook.sold(bob), sellCost);
    }

    function testQuotaTransfersAndNativeClaimIndependence() public {
        uint256 bought = _buy(alice, 20 ether);
        vm.prank(alice);
        token.transfer(bob, bought);
        assertEq(hook.eligible(bob), 0);
        bytes[] memory sale = _explorerPlan(false, 1 ether, 1);
        vm.prank(bob);
        _expectHookRevert(IHooks.afterSwap.selector, UnlkImdHook.QuotaExceeded.selector);
        router.execute(hex"10", sale, block.timestamp + 600);
        _advance(CONTRIBUTOR_LOCK);
        _claimReward();
        assertEq(hook.eligible(alice), bought);
        _attestReward();
        assertEq(hook.syncRewards(alice), REWARD);
        assertEq(hook.syncRewards(alice), 0);
        assertEq(hook.syncPayer(), token.PAYER_ALLOCATION());
        assertEq(hook.syncPayer(), 0);
    }

    function testRangeExitRollsBackFeesLedgerAndPool() public {
        _buy(alice, 0.01 ether);
        hook.syncPayer();
        uint256 accrued = vault.totalAccrued();
        uint8 oldTier = hook.tier();
        uint256 claims = manager.balanceOf(address(vault), uint160(address(quote)));
        bytes[] memory plan = _explorerPlan(false, hook.remainingQuota(payer), 1);
        vm.prank(payer);
        _expectHookRevert(IHooks.afterSwap.selector, UnlkImdHook.PartialFill.selector);
        router.execute(hex"10", plan, block.timestamp + 600);
        assertEq(vault.totalAccrued(), accrued);
        assertEq(hook.sold(payer), 0);
        assertEq(hook.tier(), oldTier);
        assertEq(manager.balanceOf(address(vault), uint160(address(quote))), claims);
    }

    function testQuoteRollbackNoAccrualOrCredits() public {
        _buy(alice, 100 ether);
        uint8 oldTier = hook.tier();
        uint256 accrued = vault.totalAccrued();
        _quoteIn(true, 100 ether);
        _quoteOut(true, 100 ether);
        _quoteIn(false, 100 ether);
        _quoteOut(false, 1 ether);
        assertEq(hook.eligible(QUOTER), 0);
        assertEq(hook.sold(QUOTER), 0);
        assertEq(hook.tier(), oldTier);
        assertEq(vault.totalAccrued(), accrued);
    }
}

contract ImdReverseOrderTest is ImdSwapsTest {
    function _preferToken0() internal pure override returns (bool) {
        return false;
    }
}
