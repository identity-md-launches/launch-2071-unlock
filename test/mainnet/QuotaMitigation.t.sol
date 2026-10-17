// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ImdFixture} from "./ImdFixture.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {WalletExecutor} from "../../src/mainnet/WalletExecutor.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniversalRouter, IPermit2Allowance} from "./ImdFixture.sol";

/// @dev Independent users' input funds and output recipients remain segregated. No shared custody.
contract ImdSharedExecutor {
    function trade(
        IERC20 input,
        uint256 amount,
        address permit2,
        IUniversalRouter router,
        bytes[] calldata plan
    ) external {
        require(input.transferFrom(msg.sender, address(this), amount));
        require(input.approve(permit2, amount));
        IPermit2Allowance(permit2)
            .approve(address(input), address(router), uint160(amount), uint48(block.timestamp));
        router.execute(hex"10", plan, block.timestamp);
    }
}

contract LegitimateAccount {
    address immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function execute(address target, bytes calldata data) external {
        require(msg.sender == owner);
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
    }
}

contract QuotaMitigationTest is ImdFixture {
    function _directed(bool buy, uint256 amount, address recipient)
        internal
        view
        returns (bytes[] memory inputs)
    {
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(ExactIn(key, buy != tokenIs0, uint128(amount), 1, ""));
        params[1] = abi.encode(buy ? address(quote) : address(token), amount);
        params[2] = abi.encode(buy ? address(token) : address(quote), recipient, uint256(0));
        inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0e", params);
    }

    function _sharedBuy(ImdSharedExecutor executor, address who, uint256 amount) internal {
        _fundQuote(who, amount);
        vm.startPrank(who);
        quote.approve(address(executor), amount);
        executor.trade(quote, amount, PERMIT2, router, _directed(true, amount, who));
        vm.stopPrank();
    }

    function testMainnetSegregatedFundsHighPersistsAfterMaturity() public {
        ImdSharedExecutor executor = new ImdSharedExecutor();
        _sharedBuy(executor, alice, 100 ether);
        uint256 bought = token.balanceOf(alice);
        emit log_named_uint("Alice gross IMD capital", 100 ether);
        emit log_named_uint("Alice UNLK buy credit", bought);
        emit log_named_uint("Alice buy treasury fee IMD", vault.totalAccrued());
        assertEq(hook.eligible(address(executor)), bought);
        assertEq(hook.spendableEligible(address(executor)), 0);
        assertEq(hook.remainingQuota(address(executor)), 0, "after mitigation: no atomic capacity");
        vm.roll(block.number + 1);
        uint256 cap = bought / 5;
        assertEq(hook.remainingQuota(address(executor)), cap, "mature shared capacity is still exposed");
        emit log_named_uint("before mitigation and after maturity exposed UNLK capacity", cap);
        vm.prank(payer);
        token.transfer(bob, cap);
        bytes[] memory plan = _directed(false, cap, bob);
        vm.prank(bob);
        vm.expectRevert();
        router.execute(hex"10", plan, block.timestamp);
        vm.startPrank(bob);
        token.approve(address(executor), cap);
        uint256 before = quote.balanceOf(bob);
        executor.trade(token, cap, PERMIT2, router, plan);
        vm.stopPrank();
        assertGt(quote.balanceOf(bob), before);
        emit log_named_uint("Bob net IMD proceeds", quote.balanceOf(bob) - before);
        emit log_named_uint("total treasury fee IMD", vault.totalAccrued());
        assertEq(token.balanceOf(alice), bought, "Alice funds never touched");
        assertEq(hook.sold(address(executor)), cap);
        assertEq(hook.eligible(alice), 0);
        assertEq(hook.sold(bob), 0);
        assertEq(token.balanceOf(address(executor)), 0);
        assertEq(quote.balanceOf(address(executor)), 0);
        assertEq(hook.remainingQuota(address(executor)), 0);
    }

    function testSameBlockPartialCycleAndSeparateExecutionsCannotRecycleCredit() public {
        _fundQuote(alice, 100 ether);
        uint256 bought = _quoteIn(true, 100 ether);
        bytes[] memory params = new bytes[](5);
        params[0] = abi.encode(ExactIn(key, !tokenIs0, 100 ether, 1, ""));
        params[1] = abi.encode(ExactIn(key, tokenIs0, uint128(bought / 5), 1, ""));
        params[2] = abi.encode(address(quote), uint256(100 ether));
        params[3] = abi.encode(address(token), alice, uint256(0));
        params[4] = abi.encode(address(quote), alice, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"06060c0e0e", params);
        vm.prank(alice);
        vm.expectRevert();
        router.execute(hex"10", inputs, block.timestamp);
        assertEq(hook.eligible(alice), 0);
        assertEq(vault.totalAccrued(), 0);
        _execute(alice, hex"10", _explorerPlan(true, 100 ether, 1), 0);
        assertEq(hook.remainingQuota(alice), 0);
        bytes[] memory sale = _explorerPlan(false, bought / 5, 1);
        vm.prank(alice);
        vm.expectRevert();
        router.execute(hex"10", sale, block.timestamp);
        vm.roll(block.number + 1);
        assertGt(_sell(alice, bought / 5), 0);
    }

    function testDirectRightsIsolatedFromTwoAlternateExecutorsAndRecipients() public {
        uint256 bought = _buy(alice, 100 ether);
        uint256 e = hook.eligible(alice);
        uint256 q = hook.remainingQuota(alice);
        ImdSharedExecutor a = new ImdSharedExecutor();
        ImdSharedExecutor b = new ImdSharedExecutor();
        vm.prank(alice);
        token.transfer(bob, bought / 5);
        bytes[] memory sale = _directed(false, bought / 5, bob);
        vm.startPrank(bob);
        token.approve(address(a), bought);
        token.approve(address(b), bought);
        vm.expectRevert();
        a.trade(token, bought / 5, PERMIT2, router, sale);
        vm.expectRevert();
        b.trade(token, bought / 5, PERMIT2, router, sale);
        vm.stopPrank();
        assertEq(hook.eligible(alice), e);
        assertEq(hook.remainingQuota(alice), q);
        assertEq(hook.sold(alice), 0);
    }

    function testWalletExecutorAuthenticatesCallerSettlementAndBudgets() public {
        WalletExecutor executor = new WalletExecutor(alice, hook);
        _fundQuote(alice, 100 ether);
        vm.prank(alice);
        quote.approve(address(executor), 100 ether);
        vm.prank(bob);
        vm.expectRevert(WalletExecutor.Unauthorized.selector);
        executor.trade(true, true, 100 ether, 1, block.timestamp);
        assertEq(quote.balanceOf(alice), 100 ether);
        vm.prank(alice);
        executor.trade(true, true, 100 ether, 1, block.timestamp);
        uint256 bought = token.balanceOf(alice);
        assertEq(hook.eligible(address(executor)), bought);
        assertEq(hook.eligible(alice), 0);
        assertEq(quote.allowance(address(executor), PERMIT2), 0);
        vm.roll(block.number + 1);
        vm.prank(alice);
        token.approve(address(executor), bought);
        vm.prank(bob);
        vm.expectRevert(WalletExecutor.Unauthorized.selector);
        executor.trade(false, true, uint128(bought / 5), 1, block.timestamp);
        uint256 max = uint128(bought / 5);
        uint256 net = _quoteIn(false, max / 2);
        vm.prank(alice);
        executor.trade(false, false, uint128(net), uint128(max), block.timestamp);
        assertGt(quote.balanceOf(alice), 0);
        assertEq(token.balanceOf(address(executor)), 0);
        assertEq(quote.balanceOf(address(executor)), 0);
        assertEq(token.allowance(address(executor), PERMIT2), 0);
        assertLt(hook.sold(address(executor)), max, "unused exact-output budget refunded");
    }

    function testLegitimateSmartAccountCanUseDirectRouterAndWalletExecutor() public {
        LegitimateAccount account = new LegitimateAccount(alice);
        WalletExecutor executor = new WalletExecutor(address(account), hook);
        _fundQuote(address(account), 100 ether);
        vm.startPrank(alice);
        account.execute(address(quote), abi.encodeCall(IERC20.approve, (address(executor), 100 ether)));
        account.execute(
            address(executor),
            abi.encodeCall(WalletExecutor.trade, (true, true, 100 ether, 1, block.timestamp))
        );
        vm.stopPrank();
        assertGt(token.balanceOf(address(account)), 0);
        assertEq(hook.eligible(address(executor)), token.balanceOf(address(account)));
        // Normal direct smart-account trades retain their separate direct rights as well.
        _approveRouter(address(account));
        _fundQuote(address(account), 20 ether);
        bytes[] memory inputs = _explorerPlan(true, 20 ether, 1);
        vm.prank(alice);
        account.execute(ROUTER, abi.encodeCall(IUniversalRouter.execute, (hex"10", inputs, block.timestamp)));
        assertGt(hook.eligible(address(account)), 0);
    }

    function testStandardRouterRecipientDoesNotAuthenticateUnderlyingQuotaOwner() public {
        _fundQuote(alice, 100 ether);
        uint256 snapshot = vm.snapshotState();
        _execute(alice, hex"10", _directed(true, 100 ether, alice), 0);
        uint256 bought = token.balanceOf(alice);
        uint256 fee = vault.totalAccrued();
        vm.revertToState(snapshot);
        // Same sender/key/swap params and executed pool delta, different later TAKE recipient.
        _execute(alice, hex"10", _directed(true, 100 ether, bob), 0);
        assertEq(token.balanceOf(bob), bought);
        assertEq(token.balanceOf(alice), 0);
        assertEq(hook.eligible(alice), bought);
        assertEq(hook.eligible(bob), 0);
        assertEq(vault.totalAccrued(), fee);
        assertEq(hook.spendableEligible(alice), 0);
    }

    function testStandardRouterPrefundingDoesNotAuthenticateUnderlyingQuotaOwner() public {
        _fundQuote(alice, 100 ether);
        _fundQuote(bob, 100 ether);
        vm.prank(bob);
        quote.transfer(ROUTER, 100 ether);
        uint256 snapshot = vm.snapshotState();
        _execute(alice, hex"10", _directed(true, 100 ether, alice), 0);
        uint256 bought = token.balanceOf(alice);
        uint256 fee = vault.totalAccrued();
        assertEq(quote.balanceOf(alice), 0);
        assertEq(quote.balanceOf(ROUTER), 100 ether);
        vm.revertToState(snapshot);
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(ExactIn(key, !tokenIs0, 100 ether, 1, ""));
        params[1] = abi.encode(address(quote), uint256(0), false); // SETTLE from router, OPEN_DELTA
        params[2] = abi.encode(address(token), alice, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060b0e", params);
        // Same swap and initiator; Bob's prefunding now pays instead of Alice's Permit2 allowance.
        _execute(alice, hex"10", inputs, 0);
        assertEq(quote.balanceOf(alice), 100 ether);
        assertEq(quote.balanceOf(ROUTER), 0);
        assertEq(token.balanceOf(alice), bought);
        assertEq(hook.eligible(alice), bought);
        assertEq(hook.eligible(bob), 0);
        assertEq(vault.totalAccrued(), fee);
    }

    function testNativeCreditsNeverWaitForBuyMaturity() public {
        _fundQuote(payer, 100 ether);
        _execute(payer, hex"10", _explorerPlan(true, 100 ether, 1), 0);
        assertEq(hook.spendableEligible(payer), 0);
        hook.syncPayer();
        assertEq(hook.spendableEligible(payer), token.PAYER_ALLOCATION());
        assertEq(hook.remainingQuota(payer), token.PAYER_ALLOCATION() / 5);
    }

    function testFuzzFreshBuysCannotEnlargeMatureCapacity(uint96 raw) public {
        _buy(alice, 10 ether);
        uint256 mature = hook.eligible(alice);
        uint256 q = hook.remainingQuota(alice);
        uint256 amount = bound(raw, 1e8, 1000 ether);
        _fundQuote(alice, amount);
        _execute(alice, hex"10", _explorerPlan(true, amount, 1), 0);
        assertGt(hook.eligible(alice), mature);
        assertEq(hook.spendableEligible(alice), mature);
        assertEq(hook.remainingQuota(alice), q);
        vm.roll(block.number + 1);
        assertEq(hook.spendableEligible(alice), hook.eligible(alice));
    }
}
