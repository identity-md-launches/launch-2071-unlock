// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SuccessorFixture, IV4Quoter} from "./SuccessorFixture.sol";
import {UnlkHookV3} from "../../src/successor/UnlkHookV3.sol";
import {SuccessorFeeMath} from "../../src/successor/SuccessorFeeMath.sol";
import {NativeFeeMath} from "../../src/candidate/NativeFeeMath.sol";
import {NftFeeVault} from "../../src/candidate/NftFeeVault.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev A non-router unlocker that tries to trade the official pool directly.
contract DirectSwapper is IUnlockCallback {
    IPoolManager internal immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function attack(PoolKey calldata key, SwapParams calldata params) external payable {
        manager.unlock(abi.encode(key, params));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (PoolKey memory key, SwapParams memory params) = abi.decode(data, (PoolKey, SwapParams));
        manager.swap(key, params, "");
        return "";
    }

    function msgSender() external view returns (address) {
        return address(this);
    }
}

/// @dev An ERC-4337/Safe-style account that is the Universal Router caller.
contract SmartAccount {
    function call(address target, bytes calldata data) external payable {
        (bool ok, bytes memory reason) = target.call{value: msg.value}(data);
        if (!ok) {
            assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
        }
    }

    receive() external payable {}
}

contract SuccessorTest is SuccessorFixture {
    using StateLibrary for IPoolManager;

    event Credit(address indexed recipient, uint256 amount, uint8 kind);
    event Sale(address indexed initiator, uint256 amount);
    event TreasuryFee(address indexed initiator, bool buy, bool exactInput, uint256 executedEth, uint256 fee);

    // ---------------------------------------------------------------- fees, all four standard modes

    function testExplorerBuyExactInputChargesEthFeeOnExecutedPoolLeg() public {
        uint256 gross = 1 ether;
        (uint256 base, uint256 fee) = SuccessorFeeMath.exactInputBuyFee(gross);
        uint256 quoted = _quoteIn(true, gross);
        uint256 managerEth = MANAGER.balance;
        vm.expectEmit(true, false, false, true, address(hook));
        emit TreasuryFee(alice, true, true, base, fee);
        uint256 out = _buy(alice, gross);
        assertEq(out, quoted, "Quoter result is fee-inclusive and exact");
        assertEq(MANAGER.balance - managerEth, gross, "trader paid exactly the gross amount");
        assertEq(vault.totalAccrued(), fee);
        assertEq(manager.balanceOf(address(vault), 0), fee, "fee held as native ERC-6909 claims");
        assertGe(fee, NativeFeeMath.fee(base));
        assertLe(fee, NativeFeeMath.fee(base) + 1);
        assertEq(hook.eligible(alice), out);
        assertEq(token.balanceOf(address(hook)), 0, "no UNLK fee");
        assertEq(token.balanceOf(address(vault)), 0, "no UNLK fee");
    }

    function testExplorerSellExactInputThroughPermit2ChargesExecutedEthOutput() public {
        uint256 out = _buy(alice, 1 ether);
        uint256 prior = vault.totalAccrued();
        uint256 amount = out / 5;
        uint256 quoted = _quoteIn(false, amount);
        uint256 tokensBefore = token.balanceOf(alice);
        uint256 net = _sell(alice, amount);
        uint256 fee = vault.totalAccrued() - prior;
        assertEq(net, quoted);
        assertEq(fee, NativeFeeMath.fee(net + fee), "fee base is the gross pool ETH output");
        assertEq(tokensBefore - token.balanceOf(alice), amount, "Permit2 pulled exactly the sale");
        assertEq(hook.sold(alice), amount);
        assertEq(hook.remainingQuota(alice), 0);
    }

    function testExactOutputBuyChargesEthOnExecutedInputAndRefundsUnusedValue() public {
        uint256 want = 1_000_000 ether;
        uint256 quotedIn = _quoteOut(true, want);
        uint256 ethBefore = alice.balance;
        _exactOut(alice, true, want, quotedIn + 1 ether);
        uint256 spent = ethBefore + quotedIn + 1 ether - alice.balance;
        assertEq(spent, quotedIn, "unused budget swept back");
        assertEq(token.balanceOf(alice), want);
        uint256 fee = vault.totalAccrued();
        assertEq(fee, NativeFeeMath.fee(spent - fee));
        assertEq(hook.eligible(alice), want);
        assertEq(ROUTER.balance, 0, "no residue in the router");
    }

    function testExactOutputSellDeliversExactNetEth() public {
        uint256 out = _buy(alice, 2 ether);
        uint256 prior = vault.totalAccrued();
        uint256 net = 0.05 ether;
        (uint256 gross, uint256 fee) = SuccessorFeeMath.exactOutputSellFee(net);
        uint256 quotedIn = _quoteOut(false, net);
        uint256 ethBefore = alice.balance;
        uint256 tokensBefore = token.balanceOf(alice);
        _exactOut(alice, false, net, out / 5);
        assertEq(alice.balance - ethBefore, net, "exact NET ETH");
        assertEq(vault.totalAccrued() - prior, fee);
        assertEq(gross - net, fee);
        assertEq(tokensBefore - token.balanceOf(alice), quotedIn);
        assertEq(hook.sold(alice), quotedIn);
    }

    function testFeeInclusiveMinimumAboveQuoteRevertsWithoutState() public {
        uint256 quoted = _quoteIn(true, 1 ether);
        bytes[] memory plan = _explorerPlan(true, 1 ether, quoted + 1);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        router.execute{value: 1 ether}(hex"10", plan, block.timestamp + 60);
        assertEq(vault.totalAccrued(), 0);
        assertEq(hook.eligible(alice), 0);
    }

    function testSaleBeyondSeedBoundaryIsRejectedAndNotCharged() public {
        _buy(alice, 0.01 ether);
        hook.syncPayer();
        uint256 cap = hook.remainingQuota(payer);
        uint256 prior = vault.totalAccrued();
        vm.expectRevert();
        _quoteIn(false, cap);
        bytes[] memory plan = _explorerPlan(false, cap, 1);
        vm.prank(payer);
        _expectHookRevert(IHooks.afterSwap.selector, UnlkHookV3.PartialFill.selector);
        router.execute(hex"10", plan, block.timestamp + 60);
        assertEq(hook.sold(payer), 0);
        assertEq(vault.totalAccrued(), prior);
        // A sale that stays inside the seed range settles normally.
        uint256 small = _sell(payer, 1000 ether);
        assertGt(small, 0);
    }

    function testFuzzBuyThenSellConservesEthAndFees(uint96 gross, uint16 sellBps) public {
        gross = uint96(bound(gross, 0.000001 ether, 50 ether));
        (, uint256 fee) = SuccessorFeeMath.exactInputBuyFee(gross);
        uint256 before = MANAGER.balance;
        uint256 out = _buy(alice, gross);
        assertEq(vault.totalAccrued(), fee);
        assertEq(MANAGER.balance - before, gross);
        uint256 amount = Math.mulDiv(out, bound(sellBps, 1, 2000), 10000);
        vm.assume(amount > 0);
        uint256 net = _sell(alice, amount);
        uint256 sellFee = vault.totalAccrued() - fee;
        assertEq(sellFee, NativeFeeMath.fee(net + sellFee));
        assertEq(manager.balanceOf(address(vault), 0), vault.totalAccrued());
        assertLe(hook.sold(alice), Math.mulDiv(hook.eligible(alice), hook.p(), 10000));
    }

    function testFuzzSpecifiedFeeBounds(uint128 amount) public pure {
        vm.assume(amount > 1);
        (uint256 base, uint256 fee) = SuccessorFeeMath.exactInputBuyFee(amount);
        assertEq(base + fee, amount);
        assertGe(fee, NativeFeeMath.fee(base));
        assertLe(fee, NativeFeeMath.fee(base) + 1);
        (uint256 gross, uint256 sellFee) = SuccessorFeeMath.exactOutputSellFee(amount);
        assertEq(gross - sellFee, amount);
        assertGe(sellFee, NativeFeeMath.fee(gross));
        assertLe(sellFee, NativeFeeMath.fee(gross) + 1);
    }

    // ---------------------------------------------------------------- initiator ledger

    function testDivertedDeliveryCreditsInitiatorNotRecipient() public {
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(ExactIn(key, true, uint128(1 ether), 1, bytes("")));
        params[1] = abi.encode(key.currency0, uint256(1 ether));
        params[2] = abi.encode(key.currency1, bob, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0e", params);
        _execute(alice, hex"10", inputs, 1 ether);
        uint256 delivered = token.balanceOf(bob);
        assertGt(delivered, 0);
        assertEq(token.balanceOf(alice), 0);
        assertEq(hook.eligible(alice), delivered, "initiator holds the credit");
        assertEq(hook.eligible(bob), 0, "recipient receives tokens, not credit");
        vm.prank(bob);
        vm.expectRevert();
        router.execute(hex"10", _explorerPlan(false, 1 ether, 1), block.timestamp + 60);
    }

    function testPrefundedSaleConsumesInitiatorQuotaNotFunder() public {
        uint256 out = _buy(alice, 1 ether);
        hook.syncPayer();
        vm.prank(payer);
        token.transfer(ROUTER, out / 10);
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(ExactIn(key, false, uint128(out / 10), 1, bytes("")));
        params[1] = abi.encode(key.currency1, uint256(0), false);
        params[2] = abi.encode(key.currency0, uint256(1));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060b0f", params);
        uint256 aliceTokens = token.balanceOf(alice);
        _execute(alice, hex"10", inputs, 0);
        assertEq(token.balanceOf(alice), aliceTokens, "Alice supplied no tokens");
        assertEq(hook.sold(alice), out / 10, "the initiator's quota is consumed");
        assertEq(hook.sold(payer), 0, "the funder's quota is untouched");
    }

    function testSmartAccountIsTheInitiator() public {
        SmartAccount account = new SmartAccount();
        vm.deal(address(this), 1 ether);
        account.call{value: 1 ether}(
            ROUTER,
            abi.encodeCall(router.execute, (hex"10", _explorerPlan(true, 1 ether, 1), block.timestamp))
        );
        uint256 out = token.balanceOf(address(account));
        assertGt(out, 0);
        assertEq(hook.eligible(address(account)), out);
        assertEq(hook.eligible(address(this)), 0, "the account's signer/caller is not credited");
    }

    function testBatchedBuysAllCreditTheInitiator() public {
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(ExactIn(key, true, uint128(0.5 ether), 1, bytes("")));
        params[1] = abi.encode(ExactIn(key, true, uint128(0.25 ether), 1, bytes("")));
        params[2] = abi.encode(key.currency0, uint256(0.75 ether));
        params[3] = abi.encode(key.currency1, uint256(1));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"06060c0f", params);
        _execute(alice, hex"10", inputs, 0.75 ether);
        assertEq(hook.eligible(alice), token.balanceOf(alice));
        (, uint256 a) = SuccessorFeeMath.exactInputBuyFee(0.5 ether);
        (, uint256 b) = SuccessorFeeMath.exactInputBuyFee(0.25 ether);
        assertEq(vault.totalAccrued(), a + b);
    }

    function _cycle(uint256 gross, uint256 sellAmount) internal view returns (bytes[] memory inputs) {
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(ExactIn(key, true, uint128(gross), 1, bytes("")));
        params[1] = abi.encode(ExactIn(key, false, uint128(sellAmount), 1, bytes("")));
        params[2] = abi.encode(key.currency0, gross);
        params[3] = abi.encode(key.currency1, uint256(0));
        inputs = new bytes[](2);
        inputs[0] = abi.encode(hex"06060c0f", params);
        inputs[1] = abi.encode(address(0), alice, uint256(0));
    }

    function testCycleInOneExecutionCannotFarmQuota() public {
        uint256 quoted = _quoteIn(true, 1 ether);
        // Selling the whole fresh buy in the same execution needs 100% quota; only 20% exists.
        bytes[] memory inputs = _cycle(1 ether, 0);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        _expectHookRevert(IHooks.afterSwap.selector, UnlkHookV3.QuotaExceeded.selector);
        router.execute{value: 1 ether}(hex"1004", inputs, block.timestamp + 60);
        assertEq(hook.eligible(alice), 0);
        // Within quota the cycle settles: both legs hit the initiator, paying both fees.
        uint256 sale = quoted / 5;
        _execute(alice, hex"1004", _cycle(1 ether, sale), 1 ether);
        assertEq(hook.eligible(alice), quoted);
        assertEq(hook.sold(alice), sale);
        assertEq(token.balanceOf(alice), quoted - sale);
        assertEq(ROUTER.balance, 0);
    }

    function testTransfersNeverMigrateRights() public {
        uint256 out = _buy(alice, 1 ether);
        vm.prank(alice);
        token.transfer(bob, out);
        assertEq(hook.eligible(alice), out);
        assertEq(hook.eligible(bob), 0);
        assertEq(hook.remainingQuota(bob), 0);
        vm.prank(bob);
        _expectHookRevert(IHooks.afterSwap.selector, UnlkHookV3.QuotaExceeded.selector);
        router.execute(hex"10", _explorerPlan(false, 1 ether, 1), block.timestamp + 60);
        assertEq(vault.totalAccrued(), _feeOf(1 ether), "transfers accrue no fee");
    }

    function testGenericQuoteForZeroQuotaWalletIsSimulationOnly() public {
        uint256 out = _buy(alice, 1 ether);
        vm.prank(alice);
        token.transfer(bob, out);
        uint256 accrued = vault.totalAccrued();
        (uint160 price,,,) = IPoolManager(MANAGER).getSlot0(hook.poolId());
        vm.prank(bob);
        uint256 q = _quoteIn(false, out / 2);
        assertGt(q, 0, "a generic quote is not wallet capacity");
        (uint160 after_,,,) = IPoolManager(MANAGER).getSlot0(hook.poolId());
        assertEq(after_, price);
        assertEq(vault.totalAccrued(), accrued);
        assertEq(hook.sold(bob), 0);
    }

    function testHookDataIsIgnored() public {
        uint256 snap = vm.snapshotState();
        uint256 plain = _buy(alice, 1 ether);
        vm.revertToState(snap);
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(ExactIn(key, true, uint128(1 ether), 1, abi.encode(bob)));
        params[1] = abi.encode(key.currency0, uint256(1 ether));
        params[2] = abi.encode(key.currency1, uint256(1));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0f", params);
        _execute(alice, hex"10", inputs, 1 ether);
        assertEq(hook.eligible(alice), plain);
        assertEq(hook.eligible(bob), 0, "hookData cannot name a beneficiary");
    }

    // ---------------------------------------------------------------- route authentication

    function testDirectUnlockerCannotTrade() public {
        DirectSwapper attacker = new DirectSwapper(IPoolManager(MANAGER));
        _expectHookRevert(IHooks.beforeSwap.selector, UnlkHookV3.InvalidRoute.selector);
        attacker.attack(key, SwapParams(true, -int256(1 ether), TickMath.MIN_SQRT_PRICE + 1));
    }

    function testLookalikeCodeAtRouterOrQuoterAddressRejected() public {
        DirectSwapper impostor = new DirectSwapper(IPoolManager(MANAGER));
        vm.etch(ROUTER, address(impostor).code);
        _expectHookRevert(IHooks.beforeSwap.selector, UnlkHookV3.InvalidRoute.selector);
        DirectSwapper(ROUTER).attack(key, SwapParams(true, -int256(1 ether), TickMath.MIN_SQRT_PRICE + 1));
        vm.etch(QUOTER, address(impostor).code);
        _expectHookRevert(IHooks.beforeSwap.selector, UnlkHookV3.InvalidRoute.selector);
        DirectSwapper(QUOTER).attack(key, SwapParams(true, -int256(1 ether), TickMath.MIN_SQRT_PRICE + 1));
        assertEq(vault.totalAccrued(), 0);
    }

    // ---------------------------------------------------------------- lifecycle preserved

    function testClaimsAndPayerCreditIndependentOfTradingAndDeduplicated() public {
        _advance(CONTRIBUTOR_LOCK + 1);
        _claimReward();
        _attestReward();
        assertEq(hook.syncRewards(alice), REWARD);
        assertEq(hook.syncRewards(alice), 0);
        assertEq(hook.syncPayer(), 30_000_000 ether);
        assertEq(hook.syncPayer(), 0);
        assertEq(hook.eligible(alice), REWARD);
        assertEq(hook.eligible(payer), 30_000_000 ether);
        assertEq(vault.totalAccrued(), 0, "claims carry no fee");
        // At the opening boundary the seed holds no ETH: any sale would leave the range and is rejected.
        vm.prank(payer);
        vm.expectRevert();
        router.execute(hex"10", _explorerPlan(false, 1000 ether, 1), block.timestamp + 60);
        assertEq(hook.sold(payer), 0);
    }

    function testFullUnlockKeepsTheStandardRouteAndBypassesQuota() public {
        uint256 out = _buy(alice, 50 ether);
        feed.set(1_000_000e8);
        _advance(2 hours);
        hook.updateMilestone();
        for (uint8 t; t < 16; ++t) {
            uint256 duration = t == 15 ? 24 hours : 6 hours;
            for (uint256 j; j < duration / 5 minutes; ++j) {
                _advance(5 minutes);
                hook.updateMilestone();
            }
        }
        assertTrue(hook.fullyUnlocked());
        assertEq(hook.p(), 10000);
        vm.prank(alice);
        token.transfer(bob, out / 2);
        _approveRouter(bob);
        uint256 prior = vault.totalAccrued();
        uint256 net = _sell(bob, out / 2);
        assertGt(net, 0);
        assertEq(hook.sold(bob), out / 2);
        assertGt(vault.totalAccrued(), prior, "fee persists after final unlock");
    }

    function testTreasuryRedeemsAndOnlyBeneficiaryWithdrawsEth() public {
        _buy(alice, 3 ether);
        uint256 accrued = vault.totalAccrued();
        vault.redeem();
        assertEq(address(vault).balance, accrued);
        vm.prank(bob);
        vm.expectRevert(NftFeeVault.Unauthorized.selector);
        vault.withdraw();
        address beneficiary = vault.BENEFICIARY();
        assertEq(beneficiary, 0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9);
        uint256 before = beneficiary.balance;
        vm.prank(beneficiary);
        vault.withdraw();
        assertEq(beneficiary.balance - before, accrued);
    }

    function testSetupIsSealedAndCompanionsPinned() public {
        vm.prank(owner);
        vm.expectRevert(UnlkHookV3.AlreadyActivated.selector);
        hook.configureAndActivate(rewards, oracle, LAUNCH_NUMBER);
        vm.prank(bob);
        vm.expectRevert(UnlkHookV3.Unauthorized.selector);
        hook.deployCompanions(LAUNCH_NUMBER, feed, _codes());
        assertEq(uint160(address(hook)) & 0x3fff, hook.FLAGS());
        assertEq(hook.FEE(), 12500);
        assertEq(hook.tierThreshold(0), 100_000 ether);
        assertEq(hook.tierThreshold(15), 50_000_000 ether);
    }

    function testUnactivatedLaunchRejectsStandardSwapsAndWrongCodes() public {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _approveRouter(alice);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        _expectHookRevert(IHooks.beforeSwap.selector, UnlkHookV3.NotActivated.selector);
        router.execute{value: 1 ether}(hex"10", _explorerPlan(true, 1 ether, 1), block.timestamp + 60);
        bytes[4] memory codes = _codes();
        codes[2] = codes[0];
        vm.prank(owner);
        vm.expectRevert(UnlkHookV3.InvalidConfig.selector);
        hook.deployCompanions(LAUNCH_NUMBER, feed, codes);
    }

    function _feeOf(uint256 gross) internal pure returns (uint256 fee) {
        (, fee) = SuccessorFeeMath.exactInputBuyFee(gross);
    }
}
