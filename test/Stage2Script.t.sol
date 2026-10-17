// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {Stage2} from "../script/Stage2.s.sol";
import {UnlkHook} from "../src/UnlkHook.sol";

/// @notice Local end-to-end rehearsal of both stages: the factory launch, then the stage-2 script functions.
contract Stage2ScriptTest is SystemFixture {
    Stage2 internal stage2;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _localQuoteDepth(10000 ether);
        stage2 = new Stage2();
    }

    function _config() internal view returns (Stage2.Config memory) {
        return Stage2.Config({hook: hook, launchNumber: LAUNCH_NUMBER, feed: feed});
    }

    function testStage2DeploysFromActualIdentitiesAndOwnerActivates() public {
        bytes memory data = stage2.deploymentCall(_config());
        vm.prank(owner);
        (bool success,) = address(hook).call(data);
        assertTrue(success);
        Stage2.Companions memory c = stage2.readCompanions(_config());
        _certifySingle(c.rewards, 0, alice, REWARD);
        assertEq(c.rewards.distributor(), address(distributor));
        assertEq(c.rewards.token(), address(token));
        assertEq(address(c.router.hook()), address(hook));
        assertEq(c.oracle.hook(), address(hook));
        // The script contract is not the setup authority: activation through it is refused.
        vm.expectRevert(UnlkHook.Unauthorized.selector);
        stage2.activate(_config(), c);
        vm.prank(owner);
        hook.configureAndActivate(address(c.router), c.rewards, c.oracle, LAUNCH_NUMBER);
        assertTrue(hook.activated());
        // Trade after activation through the stage-2 router.
        router = c.router;
        rewards = c.rewards;
        oracle = c.oracle;
        _approveRouter(alice);
        uint256 bought = _buy(alice, 1 ether);
        assertEq(hook.eligible(alice), bought);
        _sell(alice, bought / 4);
        assertEq(hook.sold(alice), bought / 4);
        vm.expectRevert();
        _sell(alice, 1 ether);
        // Stage 2 cannot run twice.
        vm.expectRevert(Stage2.Stage1NotReady.selector);
        stage2.deploymentCall(_config());
    }

    function testStage2RefusesUnknownLaunchNumber() public {
        Stage2.Config memory config = _config();
        config.launchNumber = LAUNCH_NUMBER + 7;
        vm.expectRevert();
        stage2.deploymentCall(config);
    }
}
