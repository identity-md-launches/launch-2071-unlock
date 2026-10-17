// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {CandidateFixture} from "./CandidateFixture.sol";
import {RecordedRuntime} from "../compatibility/RecordedRuntime.sol";
import {IRecordedQuoter, IRecordedRouter, RecordedRouterTest} from "../compatibility/RecordedRouter.t.sol";
import {BypassRouter} from "../Trading.t.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {NativeFeeMath} from "../../src/candidate/NativeFeeMath.sol";

contract CandidateQuoterTest is CandidateFixture {
    using StateLibrary for IPoolManager;
    IRecordedQuoter internal quoter;

    function _newManager() internal override returns (PoolManager result) {
        address at = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
        vm.etch(at, abi.encodePacked(type(PoolManager).creationCode, abi.encode(address(this))));
        (bool ok, bytes memory runtime) = at.call("");
        require(ok);
        vm.etch(at, runtime);
        return PoolManager(at);
    }

    function setUp() public override {
        super.setUp();
        vm.etch(hook.QUOTER(), RecordedRuntime.quoter());
        quoter = IRecordedQuoter(hook.QUOTER());
    }

    function testGenericBuyQuoteMatchesFeeInclusiveExecutionWithoutCommitting() public {
        uint256 gross = 1 ether;
        uint256 base = NativeFeeMath.buyPoolInput(gross);
        uint256 count = oracle.observationCount();
        (uint160 beforePrice,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        IRecordedQuoter.Quote memory q = IRecordedQuoter.Quote(key, true, uint128(base), "");
        (uint256 expected,) = quoter.quoteExactInputSingle(q);
        assertGt(expected, 0);
        (uint160 afterPrice,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        assertEq(beforePrice, afterPrice);
        assertEq(hook.eligible(alice), 0);
        assertEq(hook.sold(alice), 0);
        assertEq(hook.nftFeeVault().totalAccrued(), 0);
        assertEq(oracle.observationCount(), count);
        assertEq(_buy(alice, gross), expected);
    }

    function testGenericSellQuoteIsNotWalletSellCapacity() public {
        _buy(alice, 1 ether);
        IRecordedQuoter.Quote memory q = IRecordedQuoter.Quote(key, false, uint128(1000 ether), "");
        vm.prank(bob);
        (uint256 genericOutput,) = quoter.quoteExactInputSingle(q);
        assertGt(genericOutput, 0);
        assertEq(hook.remainingQuota(bob), 0);
        vm.prank(payer);
        token.transfer(bob, 1000 ether);
        vm.expectRevert();
        _sell(bob, 1000 ether);
        uint256 fees = hook.nftFeeVault().totalAccrued();
        uint256 e = hook.eligible(alice);
        vm.expectRevert();
        quoter._quoteExactInputSingle(q);
        vm.expectRevert();
        quoter.unlockCallback(abi.encodeCall(IRecordedQuoter._quoteExactInputSingle, (q)));
        assertEq(hook.nftFeeVault().totalAccrued(), fees);
        assertEq(hook.eligible(alice), e);
        assertEq(hook.sold(bob), 0);
    }

    function testNonemptyQuoteDataIsRejected() public {
        IRecordedQuoter.Quote memory q = IRecordedQuoter.Quote(key, true, uint128(1 ether), abi.encode(alice));
        vm.expectRevert();
        quoter.quoteExactInputSingle(q);
    }

    function testExactOutputBuyQuoteIncludesFeeAndRollsBack() public {
        _buy(alice, 1 ether);
        uint256 e = hook.eligible(alice);
        uint256 fees = hook.nftFeeVault().totalAccrued();
        IRecordedQuoter.Quote memory q = IRecordedQuoter.Quote(key, true, uint128(100 ether), "");
        (uint256 grossInput,) = quoter.quoteExactOutputSingle(q);
        assertEq(hook.eligible(alice), e);
        assertEq(hook.nftFeeVault().totalAccrued(), fees);
        vm.prank(alice);
        (uint256 spent, uint256 received) = router.swap{value: 1 ether}(_request(true, 100 ether, 1 ether));
        assertEq(spent, grossInput);
        assertEq(received, 100 ether);
    }

    function testExactOutputSellQuoteRequiresGrossTranslationAndRollsBack() public {
        _buy(alice, 1 ether);
        uint256 fees = hook.nftFeeVault().totalAccrued();
        uint256 desiredNet = 0.01 ether;
        uint256 grossOutput = NativeFeeMath.sellGrossOutput(desiredNet);
        IRecordedQuoter.Quote memory q = IRecordedQuoter.Quote(key, false, uint128(grossOutput), "");
        (uint256 tokensIn,) = quoter.quoteExactOutputSingle(q);
        assertEq(hook.sold(alice), 0);
        assertEq(hook.nftFeeVault().totalAccrued(), fees);
        uint256 cap = hook.remainingQuota(alice);
        vm.prank(alice);
        (uint256 spent, uint256 received) = router.swap(_request(false, int256(desiredNet), cap));
        assertEq(spent, tokensIn);
        assertEq(received, desiredNet);
        assertEq(hook.nftFeeVault().totalAccrued() - fees, NativeFeeMath.fee(grossOutput));
    }

    function testWrongQuoterCodeCannotUseQuoteExemptionToCommit() public {
        BypassRouter forged = new BypassRouter(IPoolManager(address(manager)));
        vm.etch(address(quoter), address(forged).code);
        vm.expectRevert();
        BypassRouter(address(quoter))
            .attack(key, SwapParams(true, -int256(1 ether), TickMath.MIN_SQRT_PRICE + 1), "");
        assertEq(hook.nftFeeVault().totalAccrued(), 0);
        assertEq(hook.eligible(alice), 0);
    }

    function testUniversalRouterTradesExplicitlyRejectedUntilAttributionRedesign() public {
        address at = 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;
        vm.etch(at, RecordedRuntime.router());
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(RecordedRouterTest.SwapIn(key, true, uint128(1 ether), 1, ""));
        params[1] = abi.encode(key.currency0, uint256(1 ether));
        params[2] = abi.encode(key.currency1, uint256(1));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0f", params);
        vm.prank(alice);
        vm.expectRevert();
        IRecordedRouter(at).execute{value: 1 ether}(hex"10", inputs, block.timestamp);
        assertEq(hook.nftFeeVault().totalAccrued(), 0);
        assertEq(hook.eligible(alice), 0);
    }
}
