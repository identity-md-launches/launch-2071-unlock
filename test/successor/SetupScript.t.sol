// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SuccessorFixture} from "./SuccessorFixture.sol";
import {PrepareSuccessor} from "../../script/successor/PrepareSuccessor.s.sol";

contract SuccessorSetupScriptTest is SuccessorFixture {
    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
    }

    function testFactoryLaunchThenPreparedCompanionsAndAtomicActivation() public {
        PrepareSuccessor script = new PrepareSuccessor();
        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = REWARD;
        PrepareSuccessor.Plan memory plan = script.run(
            PrepareSuccessor.Config(hook, LAUNCH_NUMBER, feed, address(distributor)), recipients, amounts
        );
        assertEq(plan.setupAuthority, owner);
        vm.prank(bob);
        (bool ok,) = plan.hook.call(plan.deployCompanions);
        assertFalse(ok, "only the setup authority stages");
        vm.prank(owner);
        (ok,) = plan.hook.call(plan.deployCompanions);
        assertTrue(ok);
        assertEq(plan.evidence, hook.stagedRewards());
        assertEq(plan.oracle, hook.stagedOracle());
        assertEq(plan.vault, address(hook.nftFeeVault()));
        vm.prank(owner);
        (ok,) = plan.hook.call(plan.activate);
        assertFalse(ok, "uncertified claim tree must not activate");
        (ok,) = plan.evidence.call(plan.certifyRound);
        assertTrue(ok);
        vm.prank(owner);
        (ok,) = plan.hook.call(plan.activate);
        assertTrue(ok);
        assertTrue(hook.activated());
        vm.prank(owner);
        (ok,) = plan.hook.call(plan.activate);
        assertFalse(ok, "setup is sealed");
        // The pinned standard route works right after activation.
        assertGt(_buy(alice, 0.1 ether), 0);
    }
}
