// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {UnlkHook} from "../src/UnlkHook.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Attack fixture: tries to swap using arbitrary hookData through the real manager.
contract BypassRouter is IUnlockCallback {
    IPoolManager immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function attack(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData) external {
        manager.unlock(abi.encode(key, params, hookData));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager));
        (PoolKey memory key, SwapParams memory params, bytes memory hookData) =
            abi.decode(data, (PoolKey, SwapParams, bytes));
        manager.swap(key, params, hookData);
        return "";
    }
}

// Direct smart-wallet execution requires no EOA check or tx.origin identity.
contract LocalSmartWallet {
    address immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function execute(address target, bytes calldata data) external returns (bytes memory) {
        require(msg.sender == owner);
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") { revert(add(result, 32), mload(result)) }
        }
        return result;
    }
}

contract TradingTest is SystemFixture {
    using StateLibrary for IPoolManager;

    function testSaleBoundaryExecutedInputIncludesPoolFee() public {
        uint256 e = _buy(alice, 1 ether);
        uint256 q = e / 4;
        uint256 before = token.balanceOf(alice);
        _sell(alice, q);
        assertEq(hook.sold(alice), q);
        assertEq(token.balanceOf(alice), before - q);
        assertEq(hook.remainingQuota(alice), 0);
        vm.expectRevert();
        _sell(alice, 1 ether);
        assertEq(hook.sold(alice), q);
    }

    function testExcessSaleRollsBackPoolBalancesOracleAndNonce() public {
        uint256 e = _buy(alice, 1 ether);
        uint256 beforeToken = token.balanceOf(alice);
        uint256 beforeWeth = weth.balanceOf(alice);
        uint256 nonce = router.nonce();
        uint256 count = oracle.observationCount();
        (uint160 priceBefore,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        vm.expectRevert();
        _sell(alice, e / 4 + 1);
        (uint160 priceAfter,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        assertEq(priceBefore, priceAfter);
        assertEq(router.nonce(), nonce);
        assertEq(token.balanceOf(alice), beforeToken);
        assertEq(weth.balanceOf(alice), beforeWeth);
        assertEq(hook.sold(alice), 0);
        assertEq(hook.eligible(alice), e);
        assertEq(oracle.observationCount(), count);
    }

    function testExactOutputSaleAccountsActualInput() public {
        _buy(alice, 1 ether);
        uint256 cap = hook.remainingQuota(alice);
        vm.prank(alice);
        (uint256 input, uint256 output) = router.swap(_request(false, int256(0.05 ether), cap));
        assertEq(output, 0.05 ether);
        assertEq(hook.sold(alice), input);
        assertLt(input, cap);
    }

    function testTransfersDoNotMoveRightsOrAllowChainCredit() public {
        uint256 bought = _buy(alice, 1 ether);
        vm.prank(alice);
        token.transfer(bob, bought);
        assertEq(hook.eligible(bob), 0);
        assertEq(hook.eligible(alice), bought);
        vm.expectRevert();
        _sell(bob, bought / 4);
        vm.prank(bob);
        token.transfer(alice, bought);
        assertEq(hook.eligible(alice), bought);
        assertEq(hook.sold(alice), 0);
    }

    function testAnotherWalletCannotConsumeVictimsAllowanceOrQuota() public {
        uint256 bought = _buy(alice, 1 ether);
        // Alice has infinite router allowance, but Bob cannot specify Alice as the payer.
        vm.expectRevert();
        _sell(bob, bought / 4);
        assertEq(hook.sold(alice), 0);
        assertEq(token.balanceOf(alice), bought);
        vm.prank(bob);
        vm.expectRevert(UnlkSwapRouter.Unauthorized.selector);
        router.unlockCallback(abi.encode(alice));
    }

    function testDirectManagerAndForeignRouterSpoofingRejected() public {
        BypassRouter bypass = new BypassRouter(manager);
        UnlkSwapRouter.SwapRequest memory r = _request(true, -int256(1 ether), 1 ether);
        SwapParams memory params = SwapParams(r.zeroForOne, r.amountSpecified, r.sqrtPriceLimitX96);
        vm.expectRevert();
        bypass.attack(key, params, abi.encode(alice));
        vm.prank(address(manager));
        vm.expectRevert(UnlkHook.InvalidRoute.selector);
        hook.beforeSwap(address(router), key, params, abi.encode(uint256(1)));
        assertEq(hook.eligible(alice), 0);
    }

    function testReplayOldCallbackHasNoLiveContext() public {
        _buy(alice, 1 ether);
        UnlkSwapRouter.SwapRequest memory r = _request(true, -int256(1 ether), 1 ether);
        SwapParams memory params = SwapParams(r.zeroForOne, r.amountSpecified, r.sqrtPriceLimitX96);
        uint256 oldNonce = router.nonce();
        vm.prank(address(manager));
        vm.expectRevert(UnlkHook.InvalidRoute.selector);
        hook.afterSwap(address(router), key, params, BalanceDelta.wrap(1), abi.encode(oldNonce));
        (address trader, bytes32 operation) = router.context();
        assertEq(trader, address(0));
        assertEq(operation, bytes32(0));
    }

    function testDonatedRouterBalancesCannotCreateCreditOrBeSwept() public {
        vm.prank(payer);
        token.transfer(address(router), 100 ether);
        weth.mint(address(router), 5 ether);
        _buy(alice, 1 ether);
        assertEq(token.balanceOf(address(router)), 100 ether);
        assertEq(weth.balanceOf(address(router)), 5 ether);
        assertEq(hook.eligible(alice), token.balanceOf(alice));
    }

    function testFuzzQuotaBoundary(uint96 spend) public {
        uint256 amount = bound(uint256(spend), 1e12, 2 ether);
        uint256 e = _buy(alice, amount);
        uint256 q = e / 4;
        vm.expectRevert();
        _sell(alice, q + 1);
        _sell(alice, q);
        assertEq(hook.sold(alice), q);
        assertEq(hook.remainingQuota(alice), 0);
    }
}

