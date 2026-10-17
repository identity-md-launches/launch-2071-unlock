// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CandidateFixture} from "./CandidateFixture.sol";
import {UnlkRouterV2} from "../../src/candidate/UnlkRouterV2.sol";
import {NftFeeVault} from "../../src/candidate/NftFeeVault.sol";
import {NativeFeeMath} from "../../src/candidate/NativeFeeMath.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

contract VaultDonationProbe is IUnlockCallback {
    IPoolManager private immutable manager;
    NftFeeVault private immutable vault;
    bool public lockedRedemptionRejected;

    constructor(IPoolManager manager_, NftFeeVault vault_) {
        manager = manager_;
        vault = vault_;
    }

    function donateClaims() external payable {
        manager.unlock(abi.encode(msg.value));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        try vault.redeem() {
            revert("nested redemption accepted");
        } catch {
            lockedRedemptionRejected = true;
        }
        uint256 amount = abi.decode(data, (uint256));
        manager.sync(Currency.wrap(address(0)));
        manager.settle{value: amount}();
        manager.mint(address(vault), 0, amount);
        return "";
    }
}

contract RejectTreasury {
    receive() external payable {
        revert("reject");
    }
}

contract ReenterTreasury {
    receive() external payable {
        // Both entrypoints must reject re-entry even though the beneficiary is authenticated.
        (bool ok,) = msg.sender.call(abi.encodeCall(NftFeeVault.withdraw, ()));
        require(!ok, "reentry succeeded");
        (ok,) = msg.sender.call(abi.encodeCall(NftFeeVault.withdrawDonations, ()));
        require(!ok, "donation reentry succeeded");
    }
}

contract CandidateFeesTest is CandidateFixture {
    using StateLibrary for IPoolManager;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _deployCompanions();
        _activate();
    }

    function testFreshTokenOnlyManagerAndAllFourSwapModes() public {
        NftFeeVault vault = hook.nftFeeVault();
        assertEq(address(manager).balance, 0);
        uint256 budget = 1 ether;
        uint256 base = NativeFeeMath.buyPoolInput(budget);
        uint256 e = _buy(alice, budget);
        assertEq(vault.totalAccrued(), NativeFeeMath.fee(base));
        assertEq(hook.eligible(alice), e);
        assertEq(hook.p(), 2000);
        assertEq(hook.remainingQuota(alice), e / 5);
        assertEq(address(vault).balance, 0, "claim accrual does not push ETH");
        uint256 prior = vault.totalAccrued();
        vm.prank(alice);
        (uint256 paid, uint256 received) = router.swap{value: 1 ether}(_request(true, 100 ether, 1 ether));
        assertEq(received, 100 ether);
        uint256 f = vault.totalAccrued() - prior;
        assertEq(f, NativeFeeMath.fee(paid - f), "buy exact output fee base");
        prior = vault.totalAccrued();
        uint256 sold = e / 10;
        uint256 net = _sell(alice, sold);
        f = vault.totalAccrued() - prior;
        assertEq(f, NativeFeeMath.fee(net + f), "sell exact input fee base");
        prior = vault.totalAccrued();
        uint256 cap = hook.remainingQuota(alice);
        vm.prank(alice);
        (paid, received) = router.swap(_request(false, int256(0.01 ether), cap));
        assertEq(received, 0.01 ether, "exact output is NET ETH");
        f = vault.totalAccrued() - prior;
        assertEq(f, NativeFeeMath.fee(received + f));
        assertEq(hook.sold(alice), sold + paid);
        vault.redeem();
        assertEq(vault.pendingClaims(), 0);
        assertEq(vault.claimable(), vault.totalAccrued());
        assertEq(address(vault).balance, vault.claimable());
    }

    function testPartialBuyChargesExecutedLegAndRefundsUnusedBudget() public {
        (uint160 price, int24 tick,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        UnlkRouterV2.SwapRequest memory r = _request(true, -int256(10 ether), 10 ether);
        r.sqrtPriceLimitX96 = TickMath.getSqrtPriceAtTick(tick - 60);
        assertLt(r.sqrtPriceLimitX96, price);
        vm.prank(alice);
        (uint256 paid, uint256 got) = router.swap{value: 10 ether}(r);
        uint256 f = hook.nftFeeVault().totalAccrued();
        assertLt(paid, 10 ether);
        assertEq(f, NativeFeeMath.fee(paid - f));
        assertEq(router.nativeCredit(alice), 10 ether - paid);
        assertEq(hook.eligible(alice), got);
        assertEq(address(router).balance, router.totalNativeCredit());
    }

    function testPartialSellChargesOnlyExecutedOutputAndReturnsUnusedTokens() public {
        _buy(alice, 10 ether);
        uint256 maxTokens = hook.remainingQuota(alice);
        uint256 beforeBalance = token.balanceOf(alice);
        uint256 beforeFees = hook.nftFeeVault().totalAccrued();
        (, int24 tick,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        UnlkRouterV2.SwapRequest memory r = _request(false, -int256(maxTokens), maxTokens);
        r.sqrtPriceLimitX96 = TickMath.getSqrtPriceAtTick(tick + 1);
        vm.prank(alice);
        (uint256 used, uint256 net) = router.swap(r);
        uint256 fee = hook.nftFeeVault().totalAccrued() - beforeFees;
        assertGt(used, 0);
        assertLt(used, maxTokens);
        assertEq(beforeBalance - token.balanceOf(alice), used);
        assertEq(hook.sold(alice), used);
        assertEq(fee, NativeFeeMath.fee(net + fee));
        assertEq(router.nativeCredit(alice), net);
        assertEq(address(router).balance, router.totalNativeCredit());
    }

    function testPartialExactOutputRevertsAllPoolCreditsAndFeeChanges() public {
        _buy(alice, 10 ether);
        uint256 beforeFees = hook.nftFeeVault().totalAccrued();
        uint256 beforeTokens = token.balanceOf(alice);
        (uint160 price, int24 tick,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        UnlkRouterV2.SwapRequest memory r = _request(false, int256(1 ether), hook.remainingQuota(alice));
        r.sqrtPriceLimitX96 = TickMath.getSqrtPriceAtTick(tick + 1);
        vm.prank(alice);
        vm.expectRevert(UnlkRouterV2.Slippage.selector);
        router.swap(r);
        (uint160 afterPrice,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        assertEq(afterPrice, price);
        assertEq(token.balanceOf(alice), beforeTokens);
        assertEq(hook.sold(alice), 0);
        assertEq(hook.nftFeeVault().totalAccrued(), beforeFees);
        assertEq(router.nativeCredit(alice), 0);
    }

    function testDonatedManagerClaimsAreNotFeeRevenueAndLockedRedemptionRollsBack() public {
        _buy(alice, 1 ether);
        NftFeeVault vault = hook.nftFeeVault();
        uint256 earned = vault.totalAccrued();
        VaultDonationProbe probe = new VaultDonationProbe(IPoolManager(address(manager)), vault);
        vm.deal(address(this), 1 ether);
        probe.donateClaims{value: 1 ether}();
        assertTrue(probe.lockedRedemptionRejected());
        assertEq(vault.totalAccrued(), earned);
        assertEq(vault.totalRedeemed(), 0);
        assertEq(vault.pendingClaims(), earned);
        assertEq(vault.donatedClaims(), 1 ether);
        vault.redeem();
        assertEq(vault.claimable(), earned);
        assertEq(vault.pendingClaims(), 0);
        assertEq(vault.donatedClaims(), 1 ether);
        assertEq(IPoolManager(address(manager)).balanceOf(address(vault), 0), 1 ether);
        assertEq(vault.donations(), 0);
    }

    function testSlippageAndOverQuotaRollbackFeesAndCredits() public {
        uint256 e = _buy(alice, 1 ether);
        uint256 fees = hook.nftFeeVault().totalAccrued();
        vm.expectRevert();
        _sell(alice, e / 5 + 1);
        assertEq(hook.nftFeeVault().totalAccrued(), fees);
        assertEq(hook.sold(alice), 0);
        UnlkRouterV2.SwapRequest memory r = _request(true, -int256(1 ether), 1 ether);
        r.minOutput = type(uint128).max;
        vm.prank(alice);
        vm.expectRevert();
        router.swap{value: 1 ether}(r);
        assertEq(hook.nftFeeVault().totalAccrued(), fees);
        assertEq(hook.eligible(alice), e);
    }

    function testOnlyBeneficiaryWithdrawsNoRedirectAndDonationsSeparate() public {
        _buy(alice, 1 ether);
        NftFeeVault vault = hook.nftFeeVault();
        vm.expectRevert(NftFeeVault.Unauthorized.selector);
        vault.recordAccrual(1);
        vm.prank(address(hook));
        vm.expectRevert(NftFeeVault.InvalidReceipt.selector);
        vault.recordAccrual(1);
        vm.expectRevert(NftFeeVault.Unauthorized.selector);
        vault.unlockCallback("");
        vault.redeem();
        vm.deal(address(this), 2 ether);
        (bool ok,) = address(vault).call{value: 2 ether}("");
        assertTrue(ok);
        assertEq(vault.donations(), 2 ether);
        vm.expectRevert(NftFeeVault.Unauthorized.selector);
        vault.withdraw();
        uint256 before = vault.BENEFICIARY().balance;
        uint256 fees = vault.claimable();
        vm.prank(vault.BENEFICIARY());
        vault.withdraw();
        assertEq(vault.BENEFICIARY().balance - before, fees);
        assertEq(vault.totalWithdrawn(), fees);
        assertEq(vault.donations(), 2 ether);
        vm.prank(vault.BENEFICIARY());
        vault.withdrawDonations();
        assertEq(vault.donationsWithdrawn(), 2 ether);
        assertEq(vault.totalWithdrawn(), fees);
    }

    function testRejectingBeneficiaryCannotHaltSwapsAndFailedWithdrawalRetainsFunds() public {
        NftFeeVault vault = hook.nftFeeVault();
        vm.etch(vault.BENEFICIARY(), address(new RejectTreasury()).code);
        _buy(alice, 1 ether);
        vault.redeem();
        uint256 pending = vault.claimable();
        vm.prank(vault.BENEFICIARY());
        vm.expectRevert(NftFeeVault.WithdrawalFailed.selector);
        vault.withdraw();
        assertEq(vault.claimable(), pending);
        assertEq(vault.totalWithdrawn(), 0);
        _buy(bob, 1 ether);
        assertGt(vault.totalAccrued(), pending);
        vm.etch(vault.BENEFICIARY(), address(new ReenterTreasury()).code);
        vm.prank(vault.BENEFICIARY());
        vault.withdraw();
        assertEq(vault.claimable(), 0);
    }

    function testTransfersClaimsAndLpCollectionDoNotAccrueFees() public {
        _buy(alice, 1 ether);
        NftFeeVault vault = hook.nftFeeVault();
        uint256 fees = vault.totalAccrued();
        vm.prank(payer);
        token.transfer(bob, 100 ether);
        hook.syncPayer();
        _advance(2 hours);
        _claimReward();
        _attestReward();
        hook.syncRewards(alice);
        hook.syncRewards(alice);
        factory.claimFees(LAUNCH_NUMBER);
        assertEq(vault.totalAccrued(), fees);
        assertEq(hook.eligible(bob), 0);
        assertEq(hook.claimedCredit(alice), REWARD);
    }

    function testFuzzBuyRounding(uint128 gross) public pure {
        uint256 base = NativeFeeMath.buyPoolInput(gross);
        assertLe(base + NativeFeeMath.fee(base), gross);
        assertGt(base + 1 + NativeFeeMath.fee(base + 1), gross);
    }

    function testExactOutputBoundsCannotWrapIntoExactInput() public {
        vm.prank(alice);
        vm.expectRevert(UnlkRouterV2.InvalidSwap.selector);
        router.swap(_request(false, type(int256).max, 1 ether));
        _buy(alice, 1 ether);
        uint256 beforeFees = hook.nftFeeVault().totalAccrued();
        vm.prank(alice);
        vm.expectRevert(UnlkRouterV2.InvalidSwap.selector);
        router.swap(_request(false, int256(type(int128).max), 1 ether));
        assertEq(hook.sold(alice), 0);
        assertEq(hook.nftFeeVault().totalAccrued(), beforeFees);
    }

    function testFuzzSellRounding(uint128 net) public pure {
        uint256 gross = NativeFeeMath.sellGrossOutput(net);
        assertEq(gross - NativeFeeMath.fee(gross), net);
        if (gross > 0) assertLt(gross - 1 - NativeFeeMath.fee(gross - 1), net);
    }
}
