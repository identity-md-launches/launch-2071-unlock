// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {HookDeployer} from "../src/HookDeployer.sol";
import {UnlkHook} from "../src/UnlkHook.sol";
import {UnlkToken} from "../src/UnlkToken.sol";

contract HookDeployerTest is Test {
    // Pin the reviewed hook body, independently of the helper's encoding. Revised 2026-10-13: stage-1 pin check
    // in `beforeInitialize` and the router's seed-boundary price limit (which changes `ReviewedCode.ROUTER`,
    // a constant the hook embeds). The published f77cf377/f0149886 body hashed to 0xf872...b336.
    bytes32 internal constant REVIEWED_HOOK_CREATION_HASH =
        0x1e5ea98995bd91262452ad1a8512eae97e9a02a05920b89f839d440a05f8dd2d;

    HookDeployer internal helper;
    HookDeployer.Config internal config;

    function setUp() public {
        helper = new HookDeployer();
        config = HookDeployer.Config(
            IPoolManager(makeAddr("encoder test manager")),
            UnlkToken(makeAddr("encoder test token")),
            makeAddr("encoder test official factory"),
            makeAddr("encoder test setup authority")
        );
    }

    function testDeployedHelperFitsEvmCodeLimits() public view {
        // Foundry can execute oversized test contracts; deployment alone did not catch the old helper.
        assertGt(address(helper).code.length, 0);
        assertLe(address(helper).code.length, 24_576);
        assertLe(type(HookDeployer).creationCode.length, 49_152);
    }

    function testReviewedHookInitCodeAndHash() public view {
        bytes memory creationCode = type(UnlkHook).creationCode;
        assertEq(keccak256(creationCode), REVIEWED_HOOK_CREATION_HASH);
        bytes memory expected = bytes.concat(
            creationCode,
            abi.encode(
                address(config.manager), address(config.token), config.launchFactory, config.setupAuthority
            )
        );
        bytes memory actual = helper.initCode(creationCode, config);
        assertEq(actual, expected);
        assertEq(actual.length, creationCode.length + 4 * 32);
        assertEq(helper.initCodeHash(creationCode, config), keccak256(expected));
        assertLe(actual.length, 49_152);
    }

    function testChangedSetupAuthorityChangesHashAndCreate2Prediction() public view {
        bytes memory creationCode = type(UnlkHook).creationCode;
        bytes32 reviewedHash = helper.initCodeHash(creationCode, config);
        HookDeployer.Config memory changed = config;
        // Accidentally substituting the factory for $owner must not preserve the reviewed init code.
        changed.setupAuthority = config.launchFactory;
        bytes memory alteredCode = helper.initCode(creationCode, changed);
        bytes32 alteredHash = helper.initCodeHash(creationCode, changed);
        assertEq(
            alteredCode,
            bytes.concat(
                creationCode,
                abi.encode(config.manager, config.token, config.launchFactory, changed.setupAuthority)
            )
        );
        assertEq(alteredHash, keccak256(alteredCode));
        assertNotEq(alteredHash, reviewedHash);
        bytes32 salt = keccak256("encoder test hook salt");
        assertNotEq(
            vm.computeCreate2Address(salt, alteredHash, config.launchFactory),
            vm.computeCreate2Address(salt, reviewedHash, config.launchFactory)
        );
    }

    function testChangedCreationBodyCannotMatchReviewedHash() public view {
        bytes memory changedCode = type(UnlkHook).creationCode;
        changedCode[0] = bytes1(uint8(changedCode[0]) ^ 1);
        assertNotEq(
            helper.initCodeHash(changedCode, config), helper.initCodeHash(type(UnlkHook).creationCode, config)
        );
    }

    function testFuzzEncodesCallerSuppliedBytesAndFourAddresses(
        bytes memory creationCode,
        address manager,
        address token,
        address factory,
        address authority
    ) public view {
        HookDeployer.Config memory supplied =
            HookDeployer.Config(IPoolManager(manager), UnlkToken(token), factory, authority);
        bytes memory expected = bytes.concat(creationCode, abi.encode(manager, token, factory, authority));
        assertEq(helper.initCode(creationCode, supplied), expected);
        assertEq(helper.initCodeHash(creationCode, supplied), keccak256(expected));
    }
}
