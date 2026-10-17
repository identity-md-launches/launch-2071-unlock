// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ImdFixture} from "./ImdFixture.sol";
import {DirectSwapper} from "../successor/Successor.t.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

contract ImdAuthenticationTest is ImdFixture {
    function _params() internal view returns (SwapParams memory) {
        return SwapParams(
            !tokenIs0, -int256(1 ether), tokenIs0 ? TickMath.MAX_SQRT_PRICE - 1 : TickMath.MIN_SQRT_PRICE + 1
        );
    }

    function testDirectUnlockerWithSpoofedMsgSenderCannotExecute() public {
        DirectSwapper attacker = new DirectSwapper(manager);
        _expectHookRevert(IHooks.beforeSwap.selector, UnlkImdHook.InvalidRoute.selector);
        attacker.attack(key, _params());
        assertEq(vault.totalAccrued(), 0);
    }

    function testDifferentCodeAtPinnedRouterAndQuoterCannotAuthenticate() public {
        DirectSwapper attacker = new DirectSwapper(manager);
        vm.etch(ROUTER, address(attacker).code);
        _expectHookRevert(IHooks.beforeSwap.selector, UnlkImdHook.InvalidRoute.selector);
        DirectSwapper(ROUTER).attack(key, _params());
        vm.etch(QUOTER, address(attacker).code);
        _expectHookRevert(IHooks.beforeSwap.selector, UnlkImdHook.InvalidRoute.selector);
        DirectSwapper(QUOTER).attack(key, _params());
        assertEq(hook.eligible(alice), 0);
        assertEq(vault.totalAccrued(), 0);
    }

    function testOnlyManagerCanCallSwapCallbacks() public {
        SwapParams memory params = _params();
        vm.expectRevert(UnlkImdHook.Unauthorized.selector);
        hook.beforeSwap(ROUTER, key, params, "");
    }
}
