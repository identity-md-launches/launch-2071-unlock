// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ImdFixture} from "./ImdFixture.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";

interface IPermit2Signing {
    struct Details {
        address token;
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    struct Permit {
        Details details;
        address spender;
        uint256 sigDeadline;
    }
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function allowance(address owner, address token, address spender)
        external
        view
        returns (uint160, uint48, uint48);
}

contract ImdPermitAndBatchTest is ImdFixture {
    function testLocallySignedPermit2PermitAndBuyAtomicReplayRejected() public {
        (address signer, uint256 signingKey) = makeAddrAndKey("local mainnet Permit2 rehearsal signer");
        _fundQuote(signer, 100 ether);
        vm.prank(signer);
        quote.approve(PERMIT2, 100 ether);
        IPermit2Signing.Permit memory permit = IPermit2Signing.Permit(
            IPermit2Signing.Details(address(quote), 100 ether, uint48(block.timestamp + 1 hours), 0),
            ROUTER,
            block.timestamp + 600
        );
        bytes memory signature = _signPermit(permit, signingKey);
        bytes[] memory swap = _explorerPlan(true, 100 ether, 1);
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = abi.encode(permit, signature);
        inputs[1] = swap[0];
        _execute(signer, hex"0a10", inputs, 0);
        assertGt(token.balanceOf(signer), 0);
        assertEq(hook.eligible(signer), token.balanceOf(signer));
        (uint160 remaining,, uint48 nonce) =
            IPermit2Signing(PERMIT2).allowance(signer, address(quote), ROUTER);
        assertEq(remaining, 0);
        assertEq(nonce, 1);
        uint256 accrued = vault.totalAccrued();
        vm.prank(signer);
        vm.expectRevert();
        router.execute(hex"0a10", inputs, block.timestamp + 600);
        assertEq(vault.totalAccrued(), accrued);
    }

    function _signPermit(IPermit2Signing.Permit memory permit, uint256 signingKey)
        internal
        returns (bytes memory)
    {
        bytes32 detailHash = keccak256(
            abi.encode(
                keccak256("PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"),
                permit.details.token,
                permit.details.amount,
                permit.details.expiration,
                permit.details.nonce
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"
                ),
                detailHash,
                ROUTER,
                permit.sigDeadline
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked(hex"1901", IPermit2Signing(PERMIT2).DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signingKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function testBatchCreditsAndExplicitRecipientStillUseInitiator() public {
        _fundQuote(alice, 100 ether);
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(ExactIn(key, !tokenIs0, 60 ether, 1, ""));
        params[1] = abi.encode(ExactIn(key, !tokenIs0, 40 ether, 1, ""));
        params[2] = abi.encode(address(quote), uint256(100 ether));
        params[3] = abi.encode(address(token), bob, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"06060c0e", params);
        _execute(alice, hex"10", inputs, 0);
        assertEq(hook.eligible(alice), token.balanceOf(bob));
        assertEq(hook.eligible(bob), 0);
        assertEq(token.balanceOf(alice), 0);
    }

    function testSameExecutionCycleFullSaleRejectedAtomically() public {
        _fundQuote(alice, 100 ether);
        uint256 quoted = _quoteIn(true, 100 ether);
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(ExactIn(key, !tokenIs0, 100 ether, 1, ""));
        params[1] = abi.encode(ExactIn(key, tokenIs0, uint128(quoted), 1, ""));
        params[2] = abi.encode(address(quote), uint256(100 ether));
        params[3] = abi.encode(address(token), uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"06060c0f", params);
        vm.prank(alice);
        _expectHookRevert(IHooks.afterSwap.selector, UnlkImdHook.QuotaExceeded.selector);
        router.execute(hex"10", inputs, block.timestamp + 600);
        assertEq(hook.eligible(alice), 0);
        assertEq(hook.sold(alice), 0);
        assertEq(vault.totalAccrued(), 0);
    }

    function testFeeInclusiveInputOutputLimitsAndExpiryRollback() public {
        _fundQuote(alice, 100 ether);
        uint256 quoted = _quoteIn(true, 100 ether);
        bytes[] memory plan = _explorerPlan(true, 100 ether, quoted + 1);
        vm.prank(alice);
        vm.expectRevert();
        router.execute(hex"10", plan, block.timestamp + 600);
        assertEq(vault.totalAccrued(), 0);
        plan = _explorerPlan(true, 100 ether, 1);
        vm.prank(alice);
        vm.expectRevert();
        router.execute(hex"10", plan, block.timestamp - 1);
        assertEq(hook.eligible(alice), 0);
        assertEq(quote.balanceOf(alice), 100 ether);
    }
}
