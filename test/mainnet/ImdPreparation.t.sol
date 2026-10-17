// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {ImdFixture} from "./ImdFixture.sol";
import {MockImdMarket} from "./MockImdMarket.sol";
import {PrepareImd} from "../../script/mainnet/PrepareImd.s.sol";
import {ImdSpotUsdSource} from "../../src/mainnet/ImdSpotUsdSource.sol";
import {ImdUsdSource, IV3OraclePool} from "../../src/mainnet/ImdUsdSource.sol";
import {IImdUsdSource} from "../../src/mainnet/UnlkImdOracle.sol";
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";
import {MerkleClaimEvidence} from "../../src/MerkleClaimEvidence.sol";

contract ImdPreparationTest is ImdFixture {
    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(-129000);
    }

    function testChangedImdRuntimeOrWrongChainCannotStage() public {
        market = new MockImdMarket();
        vm.prank(owner);
        address source = hook.deployPriceSource(type(ImdSpotUsdSource).creationCode, bytes(""));
        uint256 snapshot = vm.snapshotState();
        uint64 staging = hook.stagings();
        vm.etch(MainnetPins.IMD_ADDRESS, hex"00");
        vm.prank(owner);
        vm.expectRevert(UnlkImdHook.InvalidConfig.selector);
        hook.deployCompanions(LAUNCH_NUMBER, IImdUsdSource(source), _codes());
        assertEq(hook.stagings(), staging);
        vm.revertToState(snapshot);
        vm.chainId(11155111);
        vm.prank(owner);
        vm.expectRevert(UnlkImdHook.InvalidConfig.selector);
        hook.deployCompanions(LAUNCH_NUMBER, IImdUsdSource(source), _codes());
        assertEq(hook.stagings(), staging);
        vm.chainId(1);
        vm.prank(owner);
        hook.deployCompanions(LAUNCH_NUMBER, IImdUsdSource(source), _codes());
        assertTrue(hook.stagedRewards() != address(0), "otherwise identical valid services can stage");
    }

    function testSourceThenPreparedCompanionsCertificationAndActivation() public {
        PrepareImd script = new PrepareImd();
        market = new MockImdMarket();
        vm.mockCall(
            priceFactory(),
            abi.encodeWithSignature(
                "getPool(address,address,uint24)", priceWeth(), MainnetPins.IMD_ADDRESS, uint24(3000)
            ),
            abi.encode(address(market))
        );
        _freshFeed();
        bytes memory sourceCall = script.preparePriceSource();
        vm.prank(owner);
        (bool ok, bytes memory result) = address(hook).call(sourceCall);
        assertTrue(ok);
        priceSource = ImdUsdSource(abi.decode(result, (address)));
        // This staged-source success rehearsal is explicitly synthetic. Proof activation failure is tested separately.
        ImdUsdSource synthetic =
            new ImdUsdSource(IV3OraclePool(address(market)), address(market).codehash, uint128(1e18));
        vm.mockFunction(address(priceSource), address(synthetic), abi.encodeWithSignature("priceUsd()"));
        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = REWARD;
        PrepareImd.Config memory config =
            PrepareImd.Config(hook, LAUNCH_NUMBER, IImdUsdSource(address(priceSource)), address(distributor));
        vm.expectRevert();
        script.run(config, recipients, amounts);
        _advance(24 hours);
        _claimReward();
        assertEq(token.balanceOf(alice), REWARD, "native claim works before activation or certification");
        PrepareImd.Plan memory plan = script.run(config, recipients, amounts);
        vm.prank(bob);
        (ok,) = plan.hook.call(plan.deployCompanions);
        assertFalse(ok);
        vm.prank(owner);
        (ok,) = plan.hook.call(plan.deployCompanions);
        assertTrue(ok);
        assertEq(hook.stagedRewards(), plan.evidence);
        assertEq(hook.stagedOracle(), plan.oracle);
        assertEq(address(hook.nftFeeVault()), plan.vault);
        vm.prank(owner);
        (ok,) = plan.hook.call(plan.activate);
        assertFalse(ok, "uncertified tree must fail atomically");
        assertFalse(hook.activated());
        (ok,) = plan.evidence.call(plan.certifyRound);
        assertTrue(ok);
        assertTrue(MerkleClaimEvidence(plan.evidence).certified(0));
        vm.prank(owner);
        (ok,) = plan.hook.call(plan.activate);
        assertTrue(ok);
        assertTrue(hook.activated());
        assertGt(_buy(alice, 1 ether), 0);
    }
}
