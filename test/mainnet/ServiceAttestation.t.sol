// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ImdFixture} from "./ImdFixture.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {ImdSpotUsdSource} from "../../src/mainnet/ImdSpotUsdSource.sol";
import {IImdUsdSource} from "../../src/mainnet/UnlkImdOracle.sol";
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";

/// Independent contributor review of delayed service attestation. Synthetic state; no fork or broadcast.
contract ServiceAttestationTest is ImdFixture {
    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(-129000);
        _deployCompanions();
    }

    function _mutateService(uint256 i) internal {
        address[8] memory services = [
            MainnetPins.FACTORY_ADDRESS,
            MainnetPins.MANAGER_ADDRESS,
            MainnetPins.FEES_ADDRESS,
            MainnetPins.REGISTRY_ADDRESS,
            MainnetPins.IMD_ADDRESS,
            MainnetPins.ROUTER_ADDRESS,
            MainnetPins.QUOTER_ADDRESS,
            MainnetPins.PERMIT2_ADDRESS
        ];
        vm.etch(services[i], hex"60006000fd");
    }

    function _assertRejectedAndAtomic() internal {
        uint64 beforeStagings = hook.stagings();
        address verifierBefore = address(hook.setupVerifier());
        address vaultBefore = address(hook.nftFeeVault());
        address sourceBefore = hook.stagedPriceSource();
        address rewardsBefore = hook.stagedRewards();
        address oracleBefore = hook.stagedOracle();
        vm.prank(owner);
        vm.expectRevert(UnlkImdHook.InvalidConfig.selector);
        hook.deployPriceSource(type(ImdSpotUsdSource).creationCode, "");
        vm.prank(owner);
        vm.expectRevert(UnlkImdHook.InvalidConfig.selector);
        hook.deployCompanions(LAUNCH_NUMBER, IImdUsdSource(sourceBefore), _codes());
        vm.prank(owner);
        vm.expectRevert(UnlkImdHook.InvalidConfig.selector);
        hook.configureAndActivate(rewards, oracle, LAUNCH_NUMBER);
        assertFalse(hook.activated());
        assertFalse(oracle.bound());
        assertEq(hook.stagings(), beforeStagings);
        assertEq(address(hook.setupVerifier()), verifierBefore);
        assertEq(address(hook.nftFeeVault()), vaultBefore);
        assertEq(hook.stagedPriceSource(), sourceBefore);
        assertEq(hook.stagedRewards(), rewardsBefore);
        assertEq(hook.stagedOracle(), oracleBefore);
        assertEq(address(hook.oracle()), address(0));
        assertEq(address(hook.rewards()), address(0));
        assertEq(hook.payer(), address(0));
        assertEq(hook.swarm(), address(0));
        assertEq(hook.launchNumber(), 0);
    }

    function testEveryServiceRuntimeIsRequiredAtEverySetupBoundary() public {
        for (uint256 i; i < 8; ++i) {
            uint256 snap = vm.snapshotState();
            _mutateService(i);
            _assertRejectedAndAtomic();
            assertTrue(vm.revertToState(snap));
        }
        _activate();
        assertTrue(hook.activated());
        assertTrue(oracle.bound());
    }

    function testWrongChainCannotStageOrActivate() public {
        vm.chainId(11155111);
        _assertRejectedAndAtomic();
        vm.chainId(1);
        _activate();
        assertTrue(hook.activated());
    }

    function testFactoryGettersAndQuoteDecimalsRevalidatedWithoutCodeChanges() public {
        vm.mockCall(address(factory), abi.encodeWithSignature("fees()"), abi.encode(address(this)));
        _assertRejectedAndAtomic();
        vm.clearMockedCalls();
        vm.mockCall(address(factory), abi.encodeWithSignature("registry()"), abi.encode(address(this)));
        _assertRejectedAndAtomic();
        vm.clearMockedCalls();
        vm.mockCall(MainnetPins.IMD_ADDRESS, abi.encodeWithSignature("decimals()"), abi.encode(uint8(6)));
        _assertRejectedAndAtomic();
    }
}
