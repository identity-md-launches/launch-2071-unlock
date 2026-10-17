// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {CandidateFixture} from "./CandidateFixture.sol";
import {UnlkHookV2} from "../../src/candidate/UnlkHookV2.sol";
import {UnlkRouterV2} from "../../src/candidate/UnlkRouterV2.sol";
import {NftFeeVault} from "../../src/candidate/NftFeeVault.sol";
import {SetupVerifierV2} from "../../src/candidate/SetupVerifierV2.sol";
import {UnlkOracle} from "../../src/UnlkOracle.sol";
import {MerkleClaimEvidence} from "../../src/MerkleClaimEvidence.sol";
import {NativeFeeMath} from "../../src/candidate/NativeFeeMath.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";

contract CandidateAdversarialTest is CandidateFixture {
    function testEveryCompanionCreationPinRejectsTamperedCodeAtomically() public {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        bytes[5] memory code = [
            type(UnlkRouterV2).creationCode,
            type(MerkleClaimEvidence).creationCode,
            type(UnlkOracle).creationCode,
            type(NftFeeVault).creationCode,
            type(SetupVerifierV2).creationCode
        ];
        for (uint256 i; i < 5; ++i) {
            uint256 last = code[i].length - 1;
            code[i][last] ^= bytes1(uint8(1));
            vm.prank(owner);
            vm.expectRevert(UnlkHookV2.InvalidConfig.selector);
            hook.deployCompanions(LAUNCH_NUMBER, feed, code);
            assertEq(hook.stagings(), 0);
            assertEq(address(hook.nftFeeVault()), address(0));
            assertEq(address(hook.setupVerifier()), address(0));
            code[i][last] ^= bytes1(uint8(1));
        }
        _deployCompanions();
        _activate();
        assertTrue(hook.activated());
    }

    function testBatchAndPrefundingCannotChangeSourcingOrDelivery() public {
        vm.prank(payer);
        token.transfer(address(router), 1000 ether); // external donation, no rights
        UnlkRouterV2.SwapRequest[] memory requests = new UnlkRouterV2.SwapRequest[](2);
        requests[0] = _request(true, -int256(1 ether), 1 ether);
        requests[1] = _request(true, 100 ether, 1 ether);
        vm.prank(alice);
        (uint256[] memory inputs, uint256[] memory outputs) = router.swapBatch{value: 2 ether}(requests);
        assertEq(hook.eligible(alice), outputs[0] + outputs[1]);
        assertEq(token.balanceOf(alice), outputs[0] + outputs[1]);
        assertEq(token.balanceOf(address(router)), 1000 ether);
        assertEq(hook.eligible(address(router)), 0);
        assertEq(router.nativeCredit(alice), 2 ether - inputs[0] - inputs[1]);
        assertEq(address(router).balance, router.totalNativeCredit());
        vm.expectRevert();
        _sell(bob, 1000 ether); // router donation cannot pay Bob's sell
        assertEq(hook.sold(bob), 0);
        assertEq(token.balanceOf(address(router)), 1000 ether);
    }

    function testAfterCallbackAndReplayCannotCreateRightsOrFees() public {
        _buy(alice, 1 ether);
        uint256 fee = hook.nftFeeVault().totalAccrued();
        uint256 e = hook.eligible(alice);
        vm.expectRevert(UnlkHookV2.Unauthorized.selector);
        hook.afterSwap(
            address(router),
            key,
            SwapParams(true, -int256(1 ether), 1),
            BalanceDelta.wrap(0),
            abi.encode(uint256(1))
        );
        vm.prank(address(manager));
        vm.expectRevert(UnlkHookV2.InvalidRoute.selector);
        hook.afterSwap(
            address(router),
            key,
            SwapParams(true, -int256(1 ether), 1),
            BalanceDelta.wrap(0),
            abi.encode(uint256(1))
        );
        vm.expectRevert();
        router.unlockCallback(abi.encode(key, SwapParams(true, -int256(1 ether), 1), uint256(1), 1 ether));
        assertEq(hook.eligible(alice), e);
        assertEq(hook.nftFeeVault().totalAccrued(), fee);
    }

    function testFuzzExecutedBuyAndSellFees(uint96 grossSeed) public {
        uint256 gross = bound(grossSeed, 1e10, 10 ether);
        uint256 e = _buy(alice, gross);
        uint256 firstFee = hook.nftFeeVault().totalAccrued();
        uint256 base = NativeFeeMath.buyPoolInput(gross);
        assertEq(firstFee, NativeFeeMath.fee(base));
        uint256 net = _sell(alice, e / 5);
        uint256 sellFee = hook.nftFeeVault().totalAccrued() - firstFee;
        assertEq(sellFee, NativeFeeMath.fee(net + sellFee));
        assertEq(hook.sold(alice), e / 5);
        assertEq(hook.remainingQuota(alice), 0);
        hook.nftFeeVault().redeem();
        assertEq(hook.nftFeeVault().claimable(), firstFee + sellFee);
    }
}
