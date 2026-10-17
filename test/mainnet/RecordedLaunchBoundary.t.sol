// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ImdFixture} from "./ImdFixture.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {MainnetPins} from "src/mainnet/MainnetPins.sol";
import {ImdSpotUsdSource} from "src/mainnet/ImdSpotUsdSource.sol";
import {UnlkImdOracle, IImdUsdSource} from "src/mainnet/UnlkImdOracle.sol";
import {UnlkImdHook} from "src/mainnet/UnlkImdHook.sol";
import {MerkleClaimEvidence} from "src/MerkleClaimEvidence.sol";
import {ImdFeeVault} from "src/mainnet/ImdFeeVault.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";

/// @notice Opt-in archive rehearsal; the offline default explicitly skips these tests.
/// Set UNLK_RECORDED_MAINNET_FORK=true to run against the public archive at block 26210931.
/// Production code and the recorded reference pool/feed execute without identity or price mocks.
/// New launch numbers, impersonated launch authority and trader funding are LOCAL simulation only.
/// This does not submit a launch, assert official admission, or prove current mainnet readiness.
contract RecordedLaunchBoundaryTest is ImdFixture {
    uint256 internal constant RECORDED_BLOCK = 26210931;
    address internal constant REQUESTER = 0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9;

    function setUp() public override {
        if (!vm.envOr("UNLK_RECORDED_MAINNET_FORK", false)) {
            vm.skip(true);
            return;
        }
        LAUNCH_NUMBER = type(uint64).max - 7000;
        _deploy(false);
        _launchTokenOnly(-129000);
    }

    function _newManager() internal override returns (PoolManager) {
        vm.createSelectFork("https://ethereum-rpc.publicnode.com", RECORDED_BLOCK);
        assertEq(block.chainid, 1);
        assertEq(block.number, RECORDED_BLOCK);
        owner = REQUESTER;
        payer = REQUESTER;
        assertEq(MainnetPins.MANAGER_ADDRESS.codehash, MainnetPins.MANAGER);
        assertEq(MainnetPins.FACTORY_ADDRESS.codehash, MainnetPins.FACTORY);
        assertEq(MainnetPins.REGISTRY_ADDRESS.codehash, MainnetPins.REGISTRY);
        assertEq(MainnetPins.FEES_ADDRESS.codehash, MainnetPins.FEES);
        assertEq(MainnetPins.IMD_ADDRESS.codehash, MainnetPins.IMD);
        assertEq(MainnetPins.ROUTER_ADDRESS.codehash, MainnetPins.ROUTER);
        assertEq(MainnetPins.QUOTER_ADDRESS.codehash, MainnetPins.QUOTER);
        assertEq(MainnetPins.PERMIT2_ADDRESS.codehash, MainnetPins.PERMIT2);
        assertEq(MainnetPins.ETHUSD_ADDRESS.codehash, MainnetPins.ETHUSD);
        return PoolManager(payable(MainnetPins.MANAGER_ADDRESS));
    }

    function _leaf(address who, uint256 amount) private pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(who, amount))));
    }

    function _rewardRoot() internal view override returns (bytes32) {
        bytes32 a = _leaf(alice, REWARD);
        bytes32 b = _leaf(bob, 100_000_000 ether - REWARD);
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _stageAndSeal() private returns (ImdSpotUsdSource source) {
        uint256 timeBefore = block.timestamp;
        vm.prank(REQUESTER);
        source = ImdSpotUsdSource(hook.deployPriceSource(type(ImdSpotUsdSource).creationCode, ""));
        assertGt(source.priceUsd(), 0, "recorded pool and Chainlink must provide a valid reference");
        vm.prank(REQUESTER);
        (address e, address o, address v) =
            hook.deployCompanions(LAUNCH_NUMBER, IImdUsdSource(address(source)), _codes());
        rewards = MerkleClaimEvidence(e);
        oracle = UnlkImdOracle(o);
        vault = ImdFeeVault(v);
        address[] memory accounts = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        accounts[0] = alice;
        accounts[1] = bob;
        amounts[0] = REWARD;
        amounts[1] = 100_000_000 ether - REWARD;
        rewards.certifyRound(0, accounts, amounts);
        _activate();
        assertTrue(hook.activated());
        assertTrue(oracle.bound());
        assertEq(block.number, RECORDED_BLOCK);
        assertEq(block.timestamp, timeBefore, "activation required no warm-up");
        assertEq(hook.payer(), REQUESTER);
        assertEq(hook.setupAuthority(), REQUESTER);
        assertEq(vault.BENEFICIARY(), REQUESTER);
    }

    function testRecordedFactorySeedsWithoutCompanionsAndKeepsTradingClosed() public {
        assertTrue(hook.bound());
        assertTrue(hook.seedRecorded());
        assertFalse(hook.activated());
        assertEq(hook.stagedOracle(), address(0));
        assertEq(token.initialMinter(), address(factory));
        assertEq(token.initialRecipient(), REQUESTER);
        assertEq(token.initialAllocation(address(distributor)), 100_000_000 ether);
        assertEq(token.initialAllocation(REQUESTER) + token.initialAllocation(MANAGER), 900_000_000 ether);
        assertGe(token.initialAllocation(MANAGER), hook.MIN_POOL_ALLOCATION());
        assertLe(token.initialAllocation(MANAGER), 870_000_000 ether);
        (,,, address feeRequester) = factory.positionOf(LAUNCH_NUMBER);
        assertEq(feeRequester, REQUESTER);
        _fundQuote(alice, 1 ether);
        _approveRouter(alice);
        bytes[] memory plan = _explorerPlan(true, 1 ether, 1);
        _expectHookRevert(IHooks.beforeSwap.selector, UnlkImdHook.NotActivated.selector);
        vm.prank(alice);
        router.execute(hex"10", plan, block.timestamp);
        (uint256 fee0, uint256 fee1) = factory.claimFees(LAUNCH_NUMBER);
        assertEq(fee0 + fee1, 0);
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
    }

    function testRecordedActivationRouterQuotasAndTreasurySettlement() public {
        _stageAndSeal();
        uint256 managerBefore = quote.balanceOf(MANAGER);
        uint256 acquired = _buy(alice, 1 ether);
        assertGt(acquired, 0);
        assertEq(hook.eligible(alice), acquired);
        uint256 sold = acquired / 5;
        uint256 output = _sell(alice, sold);
        assertGt(output, 0);
        assertEq(hook.sold(alice), sold);
        assertGt(vault.totalAccrued(), 0);
        assertEq(manager.balanceOf(address(vault), uint160(address(quote))), vault.totalAccrued());
        vault.redeem();
        uint256 beneficiaryBefore = quote.balanceOf(REQUESTER);
        vm.prank(REQUESTER);
        vault.withdraw();
        assertEq(quote.balanceOf(REQUESTER) - beneficiaryBefore, vault.totalAccrued());
        assertEq(quote.balanceOf(MANAGER) + output + vault.totalAccrued(), managerBefore + 1 ether);
        assertEq(manager.balanceOf(address(vault), uint160(address(quote))), 0);
        assertEq(vault.claimable(), 0);
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
        vm.prank(REQUESTER);
        vm.expectRevert(UnlkImdHook.AlreadyActivated.selector);
        hook.configureAndActivate(rewards, oracle, LAUNCH_NUMBER);
    }

    function testRecordedNativeClaimAndTransferBeforeAnySetup() public {
        vm.warp(distributor.roundOf(0).unlocksAt);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = _leaf(bob, 100_000_000 ether - REWARD);
        distributor.claim(0, alice, REWARD, proof);
        assertEq(token.balanceOf(alice), REWARD);
        vm.prank(alice);
        token.transfer(bob, REWARD);
        assertEq(token.balanceOf(bob), REWARD);
        assertEq(hook.eligible(alice) + hook.eligible(bob), 0);
        vm.expectRevert(UnlkImdHook.NotActivated.selector);
        hook.syncRewards(alice);
        assertFalse(hook.activated());
    }
}

contract RecordedLaunchBoundaryReverseOrderTest is RecordedLaunchBoundaryTest {
    function _preferToken0() internal pure override returns (bool) {
        return false;
    }
}
