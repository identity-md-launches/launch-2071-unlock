// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ImdFixture} from "./ImdFixture.sol";
import {PrepareImd} from "../../script/mainnet/PrepareImd.s.sol";
import {IImdUsdSource} from "../../src/mainnet/UnlkImdOracle.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";

contract ImdSetupTest is ImdFixture {
    function testPreparedBundlePredictionsAndPermanentSeal() public {
        // Plan for already active deployment must fail; no rerun, reset or redirect path.
        PrepareImd script = new PrepareImd();
        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = REWARD;
        vm.expectRevert("stage 1 not ready");
        script.run(
            PrepareImd.Config(hook, LAUNCH_NUMBER, IImdUsdSource(address(priceSource)), address(distributor)),
            recipients,
            amounts
        );
        vm.prank(owner);
        vm.expectRevert(UnlkImdHook.AlreadyActivated.selector);
        hook.deployPriceSource(hex"01", hex"01");
        vm.prank(owner);
        vm.expectRevert(UnlkImdHook.AlreadyActivated.selector);
        hook.deployCompanions(LAUNCH_NUMBER, IImdUsdSource(address(priceSource)), _codes());
    }

    function testUnauthorizedStagingAndUnbackedAccrualRejected() public {
        vm.prank(bob);
        vm.expectRevert(UnlkImdHook.Unauthorized.selector);
        hook.deployPriceSource(hex"01", hex"01");
        vm.prank(address(hook));
        vm.expectRevert();
        vault.recordAccrual(1 ether);
        assertEq(vault.totalAccrued(), 0);
    }

    function testOfficialLpEntitlementActualAssetsAndPrincipalUnchanged() public {
        _buy(alice, 100 ether);
        _sell(alice, token.balanceOf(alice) / 10);
        uint256 treasury = vault.totalAccrued();
        uint256 payerImd = quote.balanceOf(payer);
        uint256 payerUnlk = token.balanceOf(payer);
        (uint256 f0, uint256 f1) = factory.claimFees(LAUNCH_NUMBER);
        assertGt(f0, 0);
        assertGt(f1, 0);
        uint256 imdFees = tokenIs0 ? f1 : f0;
        uint256 unlkFees = tokenIs0 ? f0 : f1;
        assertEq(quote.balanceOf(payer) - payerImd, imdFees * 8000 / 10000);
        assertEq(token.balanceOf(payer) - payerUnlk, unlkFees * 8000 / 10000);
        assertEq(vault.totalAccrued(), treasury, "LP fees never treasury revenue");
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
    }
}
