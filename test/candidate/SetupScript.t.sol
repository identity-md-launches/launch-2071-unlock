// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {CandidateFixture} from "./CandidateFixture.sol";
import {PrepareCandidate} from "../../script/candidate/PrepareCandidate.s.sol";

contract CandidateSetupScriptTest is CandidateFixture {
    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
    }

    function testActualFactoryLaunchThenPreparedCompanionsAndAtomicActivation() public {
        PrepareCandidate script = new PrepareCandidate();
        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = REWARD;
        PrepareCandidate.Plan memory plan = script.run(
            PrepareCandidate.Config(hook, LAUNCH_NUMBER, feed, address(distributor)), recipients, amounts
        );
        assertEq(plan.setupAuthority, owner);
        assertEq(plan.hook, address(hook));
        vm.prank(bob);
        (bool ok,) = plan.hook.call(plan.deployCompanions);
        assertFalse(ok);
        vm.prank(owner);
        (ok,) = plan.hook.call(plan.deployCompanions);
        assertTrue(ok);
        assertEq(plan.evidence, hook.stagedRewards());
        vm.prank(owner);
        (ok,) = plan.hook.call(plan.activate);
        assertFalse(ok, "uncertified claim tree must not activate");
        assertFalse(hook.activated());
        (ok,) = plan.evidence.call(plan.certifyRound);
        assertTrue(ok);
        vm.prank(owner);
        (ok,) = plan.hook.call(plan.activate);
        assertTrue(ok);
        assertTrue(hook.activated());
        assertEq(hook.nftFeeVault().hook(), address(hook));
        vm.prank(owner);
        (ok,) = plan.hook.call(plan.activate);
        assertFalse(ok, "setup is sealed");
    }
}
