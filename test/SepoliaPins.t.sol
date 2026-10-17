// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {UnlkToken} from "../src/UnlkToken.sol";
import {UnlkHook} from "../src/UnlkHook.sol";
import {SepoliaRelease} from "../src/libraries/SepoliaRelease.sol";
import {ILaunchFactoryView} from "../src/interfaces/IIntegration.sol";
import {SepoliaRuntime} from "./fixtures/SepoliaRuntime.sol";

/// @notice Stage 1 and stage 2 agree about the Sepolia services. On chain 11155111 `beforeInitialize` runs the
/// same pin check (`_verifyServices`) that `deployCompanions` and `configureAndActivate` run, so a factory,
/// manager, fees or registry that stage 2 would refuse reverts the launch transaction itself instead of
/// seeding a pool whose 87% principal could never activate. The pinned code is etched from the recorded
/// runtime bytes, so the accepting path is exercised without a fork; on any other chain id the pins are
/// not consulted and the local fixtures launch as before.
contract SepoliaPinsTest is Test {
    uint160 internal constant FLAGS = 0x3fc0;
    int24 internal constant OPENING_TICK = 177300;
    uint256 internal constant SEPOLIA = 11155111;
    address internal owner;

    function setUp() public {
        owner = makeAddr("setup authority");
    }

    function testLocalChainDoesNotConsultThePins() public {
        PoolManager manager = new PoolManager(address(this));
        UnlkToken token = new UnlkToken();
        UnlkHook hook = _deployHook(manager, token, address(this));
        assertTrue(block.chainid != SEPOLIA);
        _initialize(manager, token, hook, address(this));
        assertTrue(hook.bound());
    }

    /// @dev The reviewer's scenario: local services that report Sepolia's chain id.
    function testSepoliaRefusesUnpinnedServicesAtInitialize() public {
        vm.chainId(SEPOLIA);
        PoolManager manager = new PoolManager(address(this));
        UnlkToken token = new UnlkToken();
        assertTrue(address(this).codehash != SepoliaRelease.FACTORY);
        assertTrue(address(manager).codehash != SepoliaRelease.MANAGER);
        UnlkHook hook = _deployHook(manager, token, address(this));
        PoolKey memory key = _key(token, hook);
        uint160 sqrt = TickMath.getSqrtPriceAtTick(OPENING_TICK);
        // The exact error, unwrapped: the manager would wrap it in v4's WrappedError.
        vm.prank(address(manager));
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.beforeInitialize(address(this), key, sqrt);
        vm.expectRevert();
        manager.initialize(key, sqrt);
        assertFalse(hook.bound(), "hook bound to a pool whose services it will refuse at activation");
        assertFalse(hook.seedRecorded());
    }

    /// @dev The pinned code at the public Sepolia addresses: the launch's own factory opens the pool.
    function testSepoliaAcceptsThePinnedServicesAtInitialize() public {
        vm.chainId(SEPOLIA);
        _etch(true, true, true, true);
        IPoolManager manager = IPoolManager(SepoliaRuntime.MANAGER_ADDRESS);
        ILaunchFactoryView factory = ILaunchFactoryView(SepoliaRuntime.FACTORY_ADDRESS);
        assertEq(factory.fees(), SepoliaRuntime.FEES_ADDRESS);
        assertEq(address(factory.registry()), SepoliaRuntime.REGISTRY_ADDRESS);
        assertEq(address(factory.poolManager()), SepoliaRuntime.MANAGER_ADDRESS);
        UnlkToken token = new UnlkToken();
        UnlkHook hook = _deployHook(manager, token, SepoliaRuntime.FACTORY_ADDRESS);
        _initialize(manager, token, hook, SepoliaRuntime.FACTORY_ADDRESS);
        assertTrue(hook.bound());
        PoolKey memory stored = hook.poolKey();
        assertEq(Currency.unwrap(stored.currency1), address(token));
        assertEq(address(stored.hooks), address(hook));
    }

    function testSepoliaRefusesAnUnpinnedManager() public {
        vm.chainId(SEPOLIA);
        _etch(true, true, true, false);
        PoolManager local = new PoolManager(address(this));
        UnlkToken token = new UnlkToken();
        UnlkHook hook = _deployHook(local, token, SepoliaRuntime.FACTORY_ADDRESS);
        _expectRefusal(local, token, hook, SepoliaRuntime.FACTORY_ADDRESS);
    }

    function testSepoliaRefusesAnUnpinnedFactory() public {
        vm.chainId(SEPOLIA);
        _etch(false, true, true, true);
        IPoolManager manager = IPoolManager(SepoliaRuntime.MANAGER_ADDRESS);
        UnlkToken token = new UnlkToken();
        // This contract plays the factory: a lookalike with the right role and the wrong code.
        UnlkHook hook = _deployHook(manager, token, address(this));
        _expectRefusal(manager, token, hook, address(this));
    }

    function testSepoliaRefusesLookalikeFeesBehindThePinnedFactory() public {
        vm.chainId(SEPOLIA);
        _etch(true, true, false, true);
        vm.etch(SepoliaRuntime.FEES_ADDRESS, SepoliaRuntime.registry());
        IPoolManager manager = IPoolManager(SepoliaRuntime.MANAGER_ADDRESS);
        UnlkToken token = new UnlkToken();
        UnlkHook hook = _deployHook(manager, token, SepoliaRuntime.FACTORY_ADDRESS);
        _expectRefusal(manager, token, hook, SepoliaRuntime.FACTORY_ADDRESS);
    }

    function testSepoliaRefusesLookalikeRegistryBehindThePinnedFactory() public {
        vm.chainId(SEPOLIA);
        _etch(true, false, true, true);
        vm.etch(SepoliaRuntime.REGISTRY_ADDRESS, SepoliaRuntime.fees());
        IPoolManager manager = IPoolManager(SepoliaRuntime.MANAGER_ADDRESS);
        UnlkToken token = new UnlkToken();
        UnlkHook hook = _deployHook(manager, token, SepoliaRuntime.FACTORY_ADDRESS);
        _expectRefusal(manager, token, hook, SepoliaRuntime.FACTORY_ADDRESS);
    }

    function testEmbeddedRuntimeMatchesThePins() public pure {
        assertEq(keccak256(SepoliaRuntime.factory()), SepoliaRelease.FACTORY);
        assertEq(keccak256(SepoliaRuntime.registry()), SepoliaRelease.REGISTRY);
        assertEq(keccak256(SepoliaRuntime.fees()), SepoliaRelease.FEES);
        assertEq(keccak256(SepoliaRuntime.manager()), SepoliaRelease.MANAGER);
    }

    // ------------------------------------------------------------------ helpers

    function _etch(bool factory, bool registry, bool fees, bool manager) internal {
        if (factory) vm.etch(SepoliaRuntime.FACTORY_ADDRESS, SepoliaRuntime.factory());
        if (registry) vm.etch(SepoliaRuntime.REGISTRY_ADDRESS, SepoliaRuntime.registry());
        if (fees) vm.etch(SepoliaRuntime.FEES_ADDRESS, SepoliaRuntime.fees());
        if (manager) vm.etch(SepoliaRuntime.MANAGER_ADDRESS, SepoliaRuntime.manager());
    }

    function _key(UnlkToken token, UnlkHook hook) internal pure returns (PoolKey memory) {
        return
            PoolKey(
                Currency.wrap(address(0)), Currency.wrap(address(token)), 12500, 60, IHooks(address(hook))
            );
    }

    function _initialize(IPoolManager manager, UnlkToken token, UnlkHook hook, address factory) internal {
        vm.prank(factory);
        manager.initialize(_key(token, hook), TickMath.getSqrtPriceAtTick(OPENING_TICK));
    }

    function _expectRefusal(IPoolManager manager, UnlkToken token, UnlkHook hook, address factory) internal {
        PoolKey memory key = _key(token, hook);
        uint160 sqrt = TickMath.getSqrtPriceAtTick(OPENING_TICK);
        vm.prank(address(manager));
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.beforeInitialize(factory, key, sqrt);
        vm.prank(factory);
        vm.expectRevert();
        manager.initialize(key, sqrt);
        assertFalse(hook.bound());
    }

    /// @dev CREATE2 from this contract at a 0x3fc0-flagged address, as the factory would.
    function _deployHook(IPoolManager manager, UnlkToken token, address factory) internal returns (UnlkHook) {
        bytes memory initCode =
            bytes.concat(type(UnlkHook).creationCode, abi.encode(manager, token, factory, owner));
        bytes32 codeHash = keccak256(initCode);
        bytes32 salt;
        address predicted;
        for (uint256 i;; ++i) {
            salt = bytes32(i);
            predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, codeHash))))
            );
            if (uint160(predicted) & 0x3fff == FLAGS) break;
        }
        address at;
        assembly ("memory-safe") {
            at := create2(0, add(initCode, 32), mload(initCode), salt)
        }
        require(at == predicted, "create2");
        return UnlkHook(at);
    }
}
