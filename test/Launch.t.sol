// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {UnlkHook} from "../src/UnlkHook.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {HookDeployer} from "../src/HookDeployer.sol";
import {LaunchFactory} from "./imd/LaunchFactory.sol";
import {UnlkOracle} from "../src/UnlkOracle.sol";
import {UnlkToken} from "../src/UnlkToken.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlkHookView} from "../src/interfaces/IIntegration.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

contract LaunchTest is SystemFixture {
    function testLaunchAllocationAndLockedPrincipal() public view {
        assertEq(token.name(), "UNLOCK");
        assertEq(token.symbol(), "UNLK");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        // 10% to the factory-created distributor, at most 87% into the factory-held pool position, 3% plus seed
        // rounding to the remainder wallet; the factory keeps nothing.
        assertEq(token.balanceOf(address(distributor)), 100_000_000 ether);
        assertApproxEqAbs(token.balanceOf(payer), 30_000_000 ether, 1e9);
        assertGe(token.balanceOf(payer), 30_000_000 ether);
        assertApproxEqAbs(token.balanceOf(address(manager)), 870_000_000 ether, 1e9);
        assertEq(token.balanceOf(address(factory)), 0);
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
        assertEq(hook.swarm(), address(distributor));
        assertEq(hook.payer(), payer);
        assertEq(hook.quoteToken(), address(0));
        assertTrue(hook.activated());
        assertEq(hook.setupAuthority(), owner);
        assertTrue(hook.bound());
        assertEq(uint160(address(hook)) & 0x3fff, hook.FLAGS());
        (,,, address requester) = factory.positionOf(LAUNCH_NUMBER);
        assertEq(requester, payer);
    }

    function testCompanionsAreImmutablyBound() public view {
        assertEq(address(router.hook()), address(hook));
        assertEq(oracle.hook(), address(hook));
        assertEq(rewards.token(), address(token));
        assertEq(rewards.distributor(), address(distributor));
        assertTrue(oracle.bound());
    }

    function testOnlyCanonicalManagerCanCallHook() public {
        vm.expectRevert(UnlkHook.Unauthorized.selector);
        hook.beforeInitialize(address(factory), key, 1 << 96);
        vm.expectRevert(UnlkHook.Unauthorized.selector);
        hook.afterInitialize(address(factory), key, 1 << 96, 0);
    }

    function testUnauthorizedFactoryAndWrongPoolRejected() public {
        PoolKey memory wrong = key;
        wrong.tickSpacing = 120;
        vm.expectRevert();
        manager.initialize(wrong, TickMath.getSqrtPriceAtTick(0));
        vm.prank(address(factory));
        vm.expectRevert();
        manager.initialize(wrong, TickMath.getSqrtPriceAtTick(0));
    }

    function testLaunchIsOnceAndDeployerOnly() public {
        LaunchFactory.LaunchParams memory params = _launchParams(1 << 96, seedLower, seedUpper, 1);
        vm.expectRevert(abi.encodeWithSelector(LaunchFactory.AlreadyLaunched.selector, LAUNCH_NUMBER));
        factory.launch(params);
        vm.prank(bob);
        vm.expectRevert(LaunchFactory.NotDeployer.selector);
        factory.launch(params);
    }

    function testFactoryHoldsPrincipalAndCannotRemoveIt() public {
        uint128 before = _factoryLiquidity(seedLower, seedUpper);
        assertGt(before, 0);
        // The factory's only liquidity-changing callback paths are launch() and the zero-delta fee claim.
        factory.claimFees(LAUNCH_NUMBER);
        assertEq(_factoryLiquidity(seedLower, seedUpper), before);
        // Even the factory's own callback path only ever adds (uint128) or collects (zero delta); the hook also
        // refuses any negative delta from anyone (see CreditsAndFeesTest).
        vm.prank(address(factory));
        manager.unlock(
            abi.encode(
                LaunchFactory.Seeding({
                    key: key, tickLower: seedLower, tickUpper: seedUpper, liquidity: 0, token: address(token)
                })
            )
        );
        assertEq(_factoryLiquidity(seedLower, seedUpper), before);
    }

    function testPayerCreditExactDeduplicated() public {
        assertEq(hook.eligible(payer), 0);
        (address recipient, uint256 pending) = hook.pendingPayerCredit();
        assertEq(recipient, payer);
        assertEq(pending, 30_000_000 ether);
        vm.prank(bob);
        assertEq(hook.syncPayer(), pending);
        assertEq(hook.eligible(payer), pending);
        assertEq(hook.syncPayer(), 0);
        assertEq(hook.remainingQuota(payer), 7_500_000 ether);
    }

    function testUnconfiguredComponentsFailClosed() public {
        // A router bound to an address that is not an activated hook cannot route anything.
        UnlkSwapRouter empty = new UnlkSwapRouter(manager, IUnlkHookView(address(token)));
        vm.expectRevert();
        empty.swap(_request(true, -int256(1 ether), 1 ether));
    }
}

