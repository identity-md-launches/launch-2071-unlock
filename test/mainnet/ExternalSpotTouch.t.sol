// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SpotIntegrationFixture} from "./SpotIntegrationFixture.sol";
import {UnlkImdHook} from "src/mainnet/UnlkImdHook.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary, PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Test-only unlocker: moves a real hookless reference pool, checkpoints, reverses the swap,
/// then settles just the net obligation. No slot0 writes, fabricated deltas or mocked priceUsd calls.
contract ExternalSpotTouchActor is IUnlockCallback {
    using TransientStateLibrary for IPoolManager;
    IPoolManager public immutable manager;
    PoolKey internal referenceKey;
    UnlkImdHook public hook;
    uint256 public touchedFdv;
    uint256 public restoredFdv;
    uint256 public nativePaid;
    uint256 public temporaryNativeInput;
    bool public advanced;
    error RevertAfterTouch();

    constructor(IPoolManager manager_, PoolKey memory key_) {
        manager = manager_;
        referenceKey = key_;
    }

    function seed() external {
        manager.unlock(abi.encode(uint8(0), uint256(0), false));
    }

    function touch(UnlkImdHook hook_, uint256 amount, bool revertAtEnd) external {
        hook = hook_;
        temporaryNativeInput = amount;
        manager.unlock(abi.encode(uint8(1), amount, revertAtEnd));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "manager only");
        (uint8 operation, uint256 amount, bool revertAtEnd) = abi.decode(data, (uint8, uint256, bool));
        if (operation == 0) {
            manager.modifyLiquidity(
                referenceKey, ModifyLiquidityParams(-887200, 887200, 1e18, bytes32(0)), ""
            );
        } else {
            BalanceDelta bought = manager.swap(
                referenceKey, SwapParams(true, -int256(amount), TickMath.MIN_SQRT_PRICE + 1), ""
            );
            require(bought.amount0() == -int256(amount), "complete reference fill");
            touchedFdv = hook.oracle().fdvUsd();
            advanced = hook.checkpoint();
            manager.swap(
                referenceKey, SwapParams(false, -int256(bought.amount1()), TickMath.MAX_SQRT_PRICE - 1), ""
            );
            restoredFdv = hook.oracle().fdvUsd();
        }
        _settle(referenceKey.currency0);
        _settle(referenceKey.currency1);
        if (revertAtEnd) revert RevertAfterTouch();
        return "";
    }

    function _settle(Currency currency) private {
        int256 delta = manager.currencyDelta(address(this), currency);
        if (delta > 0) {
            manager.take(currency, address(this), uint256(delta));
        } else if (delta < 0) {
            uint256 debt = uint256(-delta);
            if (Currency.unwrap(currency) == address(0)) {
                nativePaid = debt;
                manager.settle{value: debt}();
            } else {
                manager.sync(currency);
                IERC20(Currency.unwrap(currency)).transfer(address(manager), debt);
                manager.settle();
            }
        }
    }

    receive() external payable {}
}

/// @notice Reproduces the explicitly accepted flash-manipulation risk as one actual PoolManager unlock.
/// The pool liquidity, feed and launch are local simulation inputs, not a historical/live mainnet rehearsal.
contract ExternalSpotTouchTest is SpotIntegrationFixture {
    using PoolIdLibrary for PoolKey;
    using TransientStateLibrary for IPoolManager;
    ExternalSpotTouchActor internal actor;

    function _prepareReference() internal override {
        PoolKey memory referenceKey =
            PoolKey(Currency.wrap(address(0)), Currency.wrap(address(quote)), 10000, 200, IHooks(address(0)));
        assertEq(PoolId.unwrap(referenceKey.toId()), REFERENCE_ID);
        manager.initialize(referenceKey, REFERENCE_SQRT);
        actor = new ExternalSpotTouchActor(IPoolManager(MANAGER), referenceKey);
        vm.deal(address(actor), 1 ether);
        _fundQuote(address(actor), 100 ether);
        actor.seed();
    }

    function testUnsettledExternalSpotTouchPermanentlyUnlocksTransferOnlyHolder() public {
        uint256 bought = _buy(alice, 2 ether);
        vm.prank(alice);
        token.transfer(bob, bought);
        assertEq(hook.eligible(bob), 0);
        assertLt(oracle.fdvUsd(), 100000 ether);
        uint256 nativeBefore = address(actor).balance;
        uint256 beforeBlock = block.number;
        uint256 beforeTime = block.timestamp;

        // Input exceeds the actor's ETH balance. The temporary 10 ETH debt is netted inside the unlock.
        actor.touch(hook, 10 ether, false);
        assertGt(actor.temporaryNativeInput(), nativeBefore);
        assertGt(actor.touchedFdv(), 50_000_000 ether);
        assertLt(actor.restoredFdv(), 100000 ether);
        assertTrue(actor.advanced());
        assertGt(actor.nativePaid(), 0);
        assertLt(actor.nativePaid(), nativeBefore);
        assertEq(address(actor).balance + actor.nativePaid(), nativeBefore);
        assertEq(block.number, beforeBlock);
        assertEq(block.timestamp, beforeTime);
        assertEq(hook.tier(), 16);
        assertTrue(hook.fullyUnlocked());
        assertFalse(hook.checkpoint(), "the restored low price cannot relock");
        assertEq(IPoolManager(MANAGER).currencyDelta(address(actor), Currency.wrap(address(0))), 0);
        assertEq(IPoolManager(MANAGER).currencyDelta(address(actor), Currency.wrap(address(quote))), 0);

        _feedRound(7, 0, block.timestamp, block.timestamp, 7);
        assertGt(_sell(bob, bought), 0, "global bypass includes a holder with no eligibility");
        assertEq(hook.sold(bob), bought);
        assertEq(hook.eligible(bob), 0);
        assertEq(hook.remainingQuota(bob), type(uint256).max);
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
    }

    function testRevertedFlashTouchCannotPersistGateOrReferenceMutation() public {
        uint256 priceBefore = spotSource.priceUsd();
        uint256 nativeBefore = address(actor).balance;
        uint256 imdBefore = quote.balanceOf(address(actor));
        vm.expectRevert(ExternalSpotTouchActor.RevertAfterTouch.selector);
        actor.touch(hook, 10 ether, true);
        assertEq(hook.tier(), 0);
        assertFalse(hook.fullyUnlocked());
        assertEq(spotSource.priceUsd(), priceBefore);
        assertEq(address(actor).balance, nativeBefore);
        assertEq(quote.balanceOf(address(actor)), imdBefore);
        assertEq(actor.touchedFdv(), 0);
        actor.touch(hook, 10 ether, false);
        assertTrue(hook.fullyUnlocked(), "rollback must clear manager and hook operation state");
    }
}

contract ExternalSpotTouchReverseOrderTest is ExternalSpotTouchTest {
    function _preferToken0() internal pure override returns (bool) {
        return false;
    }
}
