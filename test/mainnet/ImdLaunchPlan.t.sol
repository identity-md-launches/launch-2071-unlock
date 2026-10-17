// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ImdFixture} from "./ImdFixture.sol";
import {PrepareImdLaunch} from "../../script/mainnet/PrepareImdLaunch.s.sol";
import {LaunchRegistry} from "../imd/LaunchRegistry.sol";
import {UnlkToken} from "../../src/UnlkToken.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";

contract ImdLaunchPlanTest is ImdFixture {
    using PoolIdLibrary for *;

    function setUp() public override {
        _deploy(false);
    }

    function _config() internal view returns (PrepareImdLaunch.Config memory config) {
        config.number = LAUNCH_NUMBER;
        config.setupAuthority = owner;
        config.payer = payer;
        config.merkleRoot = _rewardRoot();
        config.contributorLockSeconds = CONTRIBUTOR_LOCK;
        config.sweepDelaySeconds = SWEEP_DELAY;
        config.hookSalt = hookSalt;
        config.openingFdvImd = 2500 ether;
        // Explicit local fixture provenance, never a production manifest or source attestation.
        config.record = LaunchRegistry.Launch(
            "univ4_hook",
            LAUNCH_NUMBER,
            0,
            keccak256("fixture source"),
            keccak256("fixture manifest"),
            keccak256("fixture attestation"),
            keccak256("fixture verifier"),
            "https://github.com/identity-md-launches/launch-1838-uniswap-v4-hook-code"
        );
        config.agentIds = new uint256[](0);
    }

    function testPreparedFactoryCalldataLaunchesExactSeedAndBindings() public {
        PrepareImdLaunch prepare = new PrepareImdLaunch();
        PrepareImdLaunch.Plan memory plan = prepare.prepare(_config());
        assertEq(plan.token, factory.predictToken(LAUNCH_NUMBER, type(UnlkToken).creationCode));
        assertEq(plan.hook, predictedHook);
        assertEq(plan.requiredSigner, factory.deployer());
        assertEq(plan.to, address(factory));
        assertLe(plan.openingFdvImd, 2500 ether);
        assertGt(plan.openingFdvImd, 2480 ether);
        vm.prank(plan.requiredSigner);
        (bool ok, bytes memory result) = plan.to.call(plan.data);
        assertTrue(ok);
        (address actualToken, address actualHook, address actualDistributor) =
            abi.decode(result, (address, address, address));
        assertEq(actualDistributor, plan.distributor);
        assertEq(actualToken, plan.token);
        assertEq(actualHook, plan.hook);
        UnlkToken t = UnlkToken(actualToken);
        UnlkImdHook h = UnlkImdHook(actualHook);
        assertEq(h.setupAuthority(), owner);
        assertFalse(h.activated());
        assertEq(t.initialAllocation(MANAGER), plan.seededTokens);
        assertEq(t.initialAllocation(payer), 900_000_000 ether - plan.seededTokens);
        assertEq(h.seedTickLower(), plan.params.tickLower);
        assertEq(h.seedTickUpper(), plan.params.tickUpper);
    }

    function testPredictedNativeDistributorCannotReceivePayerAllocation() public {
        PrepareImdLaunch prepare = new PrepareImdLaunch();
        PrepareImdLaunch.Config memory c = _config();
        PrepareImdLaunch.Plan memory plan = prepare.prepare(c);
        c.payer = plan.distributor;
        vm.expectRevert("launch wallet is distributor");
        prepare.prepare(c);
        c = _config();
        c.setupAuthority = plan.distributor;
        vm.expectRevert("launch wallet is distributor");
        prepare.prepare(c);
        assertEq(plan.token.code.length, 0);
        assertEq(plan.hook.code.length, 0);
        assertEq(plan.distributor.code.length, 0);
    }

    function testAllPolicyCapEndpointsAndIntermediateSeedsLaunch() public {
        PrepareImdLaunch helper = new PrepareImdLaunch();
        PrepareImdLaunch.Config memory config = _config();
        uint256[7] memory caps = [
            uint256(250 ether), 251 ether, 2500 ether, 10000 ether, 100000 ether, 249999 ether, 250000 ether
        ];
        for (uint256 i; i < caps.length; ++i) {
            config.openingFdvImd = caps[i];
            PrepareImdLaunch.Plan memory plan = helper.prepare(config);
            assertLe(plan.openingFdvImd, caps[i]);
            assertGe(plan.openingFdvImd, caps[i] * 994 / 1000);
            uint256 snapshot = vm.snapshotState();
            vm.prank(plan.requiredSigner);
            (bool ok,) = plan.to.call(plan.data);
            assertTrue(ok, "generated cap must launch");
            assertTrue(vm.revertToState(snapshot));
        }
    }

    function testMissingProvenanceIdentityOrWrongPolicyFailsWithoutDeploying() public {
        PrepareImdLaunch prepare = new PrepareImdLaunch();
        PrepareImdLaunch.Config memory c = _config();
        c.record.sourceCommit = bytes32(0);
        vm.expectRevert("actual accepted provenance required");
        prepare.prepare(c);
        c = _config();
        c.openingFdvImd = 1 ether;
        vm.expectRevert("recorded policy cap range");
        prepare.prepare(c);
        c = _config();
        c.payer = address(0);
        vm.expectRevert("actual new launch identities required");
        prepare.prepare(c);
        assertEq(predictedHook.code.length, 0);
    }

    function testDeliveredRepositoryIsAnExplicitProvenanceInput() public {
        PrepareImdLaunch helper = new PrepareImdLaunch();
        PrepareImdLaunch.Config memory c = _config();
        // Synthetic publisher output used only locally; not a claimed release URL or attestation.
        c.record.sourceRepoUrl = "https://github.com/test/fixture-delivery";
        PrepareImdLaunch.Plan memory plan = helper.prepare(c);
        vm.prank(plan.requiredSigner);
        (bool ok,) = plan.to.call(plan.data);
        assertTrue(ok);
        assertEq(factory.registry().launchOf(LAUNCH_NUMBER).sourceRepoUrl, c.record.sourceRepoUrl);
    }

    function testEmptyDeliveredRepositoryIsRejected() public {
        PrepareImdLaunch helper = new PrepareImdLaunch();
        PrepareImdLaunch.Config memory c = _config();
        c.record.sourceRepoUrl = "";
        vm.expectRevert("actual accepted provenance required");
        helper.prepare(c);
    }
}

contract ImdLaunchPlanReverseTest is ImdLaunchPlanTest {
    function _preferToken0() internal pure override returns (bool) {
        return false;
    }
}
