// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UnlkToken} from "../../src/UnlkToken.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Admission-like services, never mainnet identity impersonation: a fresh core manager,
/// a mock pair at the required currency address and this test as the constructor-bound factory.
/// The delivered production code has no test-address, missing-code or chain-ID bypass.
contract InitializationAdmissionTest is Test, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    PoolManager internal manager;
    UnlkToken internal token;
    UnlkImdHook internal hook;
    PoolKey internal key;
    address internal owner;
    bool internal tokenIs0;
    int24 internal lower;
    int24 internal upper;
    uint160 internal price;
    uint128 internal liquidity;

    function setUp() public virtual {
        vm.chainId(1);
        manager = new PoolManager(address(this));
        owner = makeAddr("admission setup authority");
        vm.etch(MainnetPins.IMD_ADDRESS, address(new MockERC20("Pair", "PAIR", 0)).code);
        do {
            token = new UnlkToken();
        } while ((address(token) < MainnetPins.IMD_ADDRESS) != _preferToken0());
        tokenIs0 = address(token) < MainnetPins.IMD_ADDRESS;
        bytes memory code = abi.encodePacked(
            type(UnlkImdHook).creationCode, abi.encode(manager, token, address(this), owner)
        );
        bytes32 hash = keccak256(code);
        for (uint256 i; i < 200_000; ++i) {
            bytes32 salt = bytes32(i);
            address predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, hash))))
            );
            if (uint160(predicted) & 0x3fff != 0x3fcc) continue;
            address deployed;
            assembly ("memory-safe") { deployed := create2(0, add(code, 32), mload(code), salt) }
            require(deployed == predicted, "hook deploy failed");
            hook = UnlkImdHook(deployed);
            break;
        }
        require(address(hook) != address(0), "salt search exhausted");
        key = PoolKey(
            Currency.wrap(tokenIs0 ? address(token) : MainnetPins.IMD_ADDRESS),
            Currency.wrap(tokenIs0 ? MainnetPins.IMD_ADDRESS : address(token)),
            12500,
            60,
            IHooks(address(hook))
        );
        lower = tokenIs0 ? int24(-129000) : int24(-887220);
        upper = tokenIs0 ? int24(887220) : int24(129000);
        price = TickMath.getSqrtPriceAtTick(tokenIs0 ? lower : upper);
        uint160 low = TickMath.getSqrtPriceAtTick(lower);
        uint160 high = TickMath.getSqrtPriceAtTick(upper);
        liquidity = uint128(
            tokenIs0
                ? Math.mulDiv(token.POOL_ALLOCATION(), Math.mulDiv(price, high, 1 << 96), high - price)
                : Math.mulDiv(token.POOL_ALLOCATION(), 1 << 96, price - low)
        );
    }

    function _preferToken0() internal pure virtual returns (bool) {
        return true;
    }

    function test_initializesFromTheLaunchFactory() public {
        assertTrue(address(manager).codehash != MainnetPins.MANAGER);
        assertTrue(address(this) != MainnetPins.FACTORY_ADDRESS);
        assertTrue(MainnetPins.IMD_ADDRESS.codehash != MainnetPins.IMD);
        manager.initialize(key, 79228162514264337593543950336);
        assertTrue(hook.bound());
        assertFalse(hook.activated());
        assertEq(PoolId.unwrap(hook.poolId()), PoolId.unwrap(key.toId()));
        assertEq(hook.tokenIs0(), tokenIs0);
    }

    function testSeedWithoutCompanionsAndCollectWithoutActivation() public {
        manager.initialize(key, price);
        manager.unlock(abi.encode(int256(uint256(liquidity))));
        assertTrue(hook.seedRecorded());
        assertGe(hook.seedTokens(), hook.MIN_POOL_ALLOCATION());
        assertGe(hook.seedQuoteCapacity(), hook.MIN_SEED_QUOTE_CAPACITY());
        assertEq(address(hook.setupVerifier()), address(0));
        assertEq(address(hook.oracle()), address(0));
        assertFalse(hook.activated());
        (uint128 beforeLiquidity,,) = IPoolManager(address(manager))
            .getPositionInfo(key.toId(), address(this), lower, upper, bytes32(0));
        manager.unlock(abi.encode(int256(0)));
        (uint128 afterLiquidity,,) = IPoolManager(address(manager))
            .getPositionInfo(key.toId(), address(this), lower, upper, bytes32(0));
        assertEq(afterLiquidity, beforeLiquidity);
        _expectWrapped(IHooks.beforeRemoveLiquidity.selector, UnlkImdHook.PrincipalLocked.selector);
        manager.unlock(abi.encode(int256(-1)));
    }

    function testOnlyManagerAndConstructorBoundFactoryCanInitialize() public {
        vm.expectRevert(UnlkImdHook.Unauthorized.selector);
        hook.beforeInitialize(address(this), key, price);
        _expectWrapped(IHooks.beforeInitialize.selector, UnlkImdHook.Unauthorized.selector);
        vm.prank(owner);
        manager.initialize(key, price);
        assertFalse(hook.bound());
        manager.initialize(key, price);
        assertTrue(hook.bound());
    }

    function testRepeatedInitializationCannotRebind() public {
        manager.initialize(key, price);
        _expectWrapped(IHooks.beforeInitialize.selector, UnlkImdHook.InvalidPool.selector);
        manager.initialize(key, price);
        vm.prank(address(manager));
        vm.expectRevert(UnlkImdHook.InvalidPool.selector);
        hook.beforeInitialize(address(this), key, price);
        assertEq(PoolId.unwrap(hook.poolId()), PoolId.unwrap(key.toId()));
    }

    function testWrongCurrencySortingFeeSpacingAndHookRejected() public {
        PoolKey memory wrong = key;
        wrong.fee = 3000;
        _rejectKey(wrong);
        wrong = key;
        wrong.fee = 0x800000;
        _rejectKey(wrong);
        wrong = key;
        wrong.tickSpacing = 1;
        _rejectKey(wrong);
        wrong = key;
        (wrong.currency0, wrong.currency1) = (wrong.currency1, wrong.currency0);
        _rejectKey(wrong);
        wrong = key;
        wrong.hooks = IHooks(owner);
        _rejectKey(wrong);
        wrong = key;
        wrong.currency0 = Currency.wrap(makeAddr("unrelated currency"));
        _rejectKey(wrong);
        assertFalse(hook.bound());
        manager.initialize(key, price);
    }

    function testInactiveTradingCreditsAndGatesStayDisabledWhileTransfersWork() public {
        manager.initialize(key, price);
        manager.unlock(abi.encode(int256(uint256(liquidity))));
        vm.prank(address(manager));
        vm.expectRevert(UnlkImdHook.NotActivated.selector);
        hook.beforeSwap(
            MainnetPins.ROUTER_ADDRESS,
            key,
            SwapParams(
                !tokenIs0, -1 ether, tokenIs0 ? TickMath.MAX_SQRT_PRICE - 1 : TickMath.MIN_SQRT_PRICE + 1
            ),
            ""
        );
        vm.expectRevert(UnlkImdHook.NotActivated.selector);
        hook.syncPayer();
        vm.expectRevert(UnlkImdHook.NotActivated.selector);
        hook.syncRewards(owner);
        vm.expectRevert(UnlkImdHook.NotActivated.selector);
        hook.checkpoint();
        vm.expectRevert(UnlkImdHook.NotActivated.selector);
        hook.updateMilestone();
        assertTrue(token.transfer(owner, 1 ether));
        vm.prank(owner);
        assertTrue(token.transfer(makeAddr("transfer recipient"), 1 ether));
        assertEq(hook.eligible(owner), 0);
        assertEq(hook.p(), 2000);
        assertFalse(hook.fullyUnlocked());
    }

    function _rejectKey(PoolKey memory wrong) internal {
        vm.prank(address(manager));
        vm.expectRevert(UnlkImdHook.InvalidPool.selector);
        hook.beforeInitialize(address(this), wrong, price);
    }

    function _expectWrapped(bytes4 callback, bytes4 reason) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                callback,
                abi.encodeWithSelector(reason),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "only manager");
        (BalanceDelta delta,) = manager.modifyLiquidity(
            key, ModifyLiquidityParams(lower, upper, abi.decode(data, (int256)), bytes32(0)), ""
        );
        _settle(key.currency0, delta.amount0());
        _settle(key.currency1, delta.amount1());
        return "";
    }

    function _settle(Currency currency, int128 amount) internal {
        if (amount < 0) {
            manager.sync(currency);
            IERC20(Currency.unwrap(currency)).transfer(address(manager), uint256(-int256(amount)));
            manager.settle();
        } else if (amount > 0) {
            manager.take(currency, address(this), uint256(uint128(amount)));
        }
    }
}

contract InitializationAdmissionToken1Test is InitializationAdmissionTest {
    function _preferToken0() internal pure override returns (bool) {
        return false;
    }
}
