// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {UnlkHook} from "../src/UnlkHook.sol";
import {UnlkToken} from "../src/UnlkToken.sol";
import {UnlkOracle} from "../src/UnlkOracle.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {MerkleClaimEvidence} from "../src/MerkleClaimEvidence.sol";
import {IUnlkHookView, IMerkleDistributor} from "../src/interfaces/IIntegration.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {SqrtPriceMath} from "v4-core/src/libraries/SqrtPriceMath.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockEthUsd} from "./fixtures/LocalFixtures.sol";

/// @dev Swaps straight through the PoolManager with no router, to prove the hook itself refuses.
contract DirectSwapper is IUnlockCallback {
    IPoolManager immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function swap(PoolKey memory key) external {
        manager.unlock(abi.encode(key));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        PoolKey memory key = abi.decode(data, (PoolKey));
        manager.swap(key, SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1), abi.encode(uint256(1)));
        return "";
    }
}

/// @notice Stage 1 alone: the factory's launch with no companion anywhere. Pool deployed, trading inactive.
contract StageOneTest is SystemFixture {
    using StateLibrary for IPoolManager;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _localQuoteDepth(10000 ether);
    }

    function testLaunchSucceedsWithoutCompanions() public view {
        assertTrue(hook.bound());
        assertFalse(hook.activated());
        assertEq(hook.router(), address(0));
        assertEq(address(hook.rewards()), address(0));
        assertEq(address(hook.oracle()), address(0));
        assertEq(hook.setupAuthority(), owner);
        assertEq(hook.launchFactory(), address(factory));
        assertTrue(hook.seedRecorded());
        assertEq(hook.seedTickLower(), seedLower);
        assertEq(hook.seedTickUpper(), seedUpper);
        (uint160 sqrtPrice,,, uint24 lpFee) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        assertGt(sqrtPrice, 0);
        assertEq(lpFee, 12500);
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
    }

    function testSwapsSyncAndMilestonesRevertBeforeActivation() public {
        DirectSwapper direct = new DirectSwapper(manager);
        vm.deal(address(direct), 1 ether);
        vm.expectRevert();
        direct.swap(key);

        _deployCompanions();
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(UnlkSwapRouter.InvalidSwap.selector);
        router.swap{value: 1 ether}(_request(true, -1 ether, 1 ether));

        vm.expectRevert(UnlkHook.NotActivated.selector);
        hook.syncPayer();
        vm.expectRevert(UnlkHook.NotActivated.selector);
        hook.syncRewards(alice);
        vm.expectRevert(UnlkHook.NotActivated.selector);
        hook.updateMilestone();
        vm.expectRevert(UnlkHook.NotActivated.selector);
        hook.pendingRewardCredit(alice);
    }

    function testTransfersAndNativeClaimsWorkBeforeActivationAndClaimIsCreditedLater() public {
        vm.prank(payer);
        token.transfer(bob, 1 ether);
        assertEq(token.balanceOf(bob), 1 ether);

        vm.warp(block.timestamp + CONTRIBUTOR_LOCK);
        _claimReward();
        assertEq(token.balanceOf(alice), REWARD);

        _deployCompanions();
        // Evidence for the pre-activation claim can be recorded at any time.
        _attestReward();
        // The payer must hold its whole 3% allocation when stage 2 seals (see README, "payer attribution").
        vm.prank(bob);
        token.transfer(payer, 1 ether);
        _activate();
        assertEq(hook.syncRewards(alice), REWARD);
        assertEq(hook.eligible(alice), REWARD);
        assertEq(hook.syncRewards(alice), 0);
        assertEq(hook.remainingQuota(alice), REWARD / 4);
    }

    function testUnauthorizedActivationRejected() public {
        _deployCompanions();
        vm.prank(bob);
        vm.expectRevert(UnlkHook.Unauthorized.selector);
        hook.configureAndActivate(address(router), rewards, oracle, LAUNCH_NUMBER);
        // Not even the factory or the deployer of the companions.
        vm.prank(address(factory));
        vm.expectRevert(UnlkHook.Unauthorized.selector);
        hook.configureAndActivate(address(router), rewards, oracle, LAUNCH_NUMBER);
        _assertUnconfigured();
    }

    function testCrossLaunchNumberRejected() public {
        _deployCompanions();
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidEvidence.selector);
        hook.configureAndActivate(address(router), rewards, oracle, LAUNCH_NUMBER + 1);
        _assertUnconfigured();
    }

    function testWrongContractsRejected() public {
        _deployCompanions();
        // Router bound to a different hook.
        UnlkSwapRouter foreignRouter = new UnlkSwapRouter(manager, IUnlkHookView(address(0xBEEF)));
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.configureAndActivate(address(foreignRouter), rewards, oracle, LAUNCH_NUMBER);
        // Oracle bound to a different hook.
        UnlkOracle foreignOracle = new UnlkOracle(manager, feed, address(0xBEEF));
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.configureAndActivate(address(router), rewards, foreignOracle, LAUNCH_NUMBER);
        // Oracle on a different manager.
        UnlkOracle otherManager = new UnlkOracle(IPoolManager(address(0xCAFE)), feed, address(hook));
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.configureAndActivate(address(router), rewards, otherManager, LAUNCH_NUMBER);
        // Oracle with a feed that is not 8-decimal ETH/USD shaped.
        MockEthUsd badFeed = new MockEthUsd();
        badFeed.setDecimals(18);
        UnlkOracle badFeedOracle = new UnlkOracle(manager, badFeed, address(hook));
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.configureAndActivate(address(router), rewards, badFeedOracle, LAUNCH_NUMBER);
        // Claim evidence over a different distributor.
        MerkleClaimEvidence foreignRewards =
            new MerkleClaimEvidence(IMerkleDistributor(address(0xD15)), address(token));
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidEvidence.selector);
        hook.configureAndActivate(address(router), foreignRewards, oracle, LAUNCH_NUMBER);
        // An address without code, or the same contract in two slots.
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.configureAndActivate(address(0x1234), rewards, oracle, LAUNCH_NUMBER);
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.configureAndActivate(address(oracle), rewards, oracle, LAUNCH_NUMBER);
        _assertUnconfigured();
    }

    function testSepoliaRequiresPublishedChainlinkFeed() public {
        _deployCompanions();
        vm.chainId(11155111);
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.configureAndActivate(address(router), rewards, oracle, LAUNCH_NUMBER);
        _assertUnconfigured();
    }

    function testActivationSealsAndCannotBeReplayed() public {
        _deployCompanions();
        _activate();
        assertTrue(hook.activated());
        assertEq(hook.router(), address(router));
        assertEq(address(hook.rewards()), address(rewards));
        assertEq(address(hook.oracle()), address(oracle));
        assertEq(hook.launchNumber(), LAUNCH_NUMBER);
        assertEq(hook.swarm(), address(distributor));
        assertEq(hook.payer(), payer);
        assertTrue(oracle.bound());
        (int24 lower, int24 upper) = oracle.liquidityRangeTicks();
        assertEq(lower, seedLower);
        assertEq(upper, seedUpper);

        UnlkSwapRouter second = new UnlkSwapRouter(manager, IUnlkHookView(address(hook)));
        vm.prank(owner);
        vm.expectRevert(UnlkHook.AlreadyActivated.selector);
        hook.configureAndActivate(address(second), rewards, oracle, LAUNCH_NUMBER);
        assertEq(hook.router(), address(router));
        // The oracle cannot be bound again either, by anyone.
        vm.prank(address(hook));
        vm.expectRevert(UnlkOracle.Unauthorized.selector);
        oracle.bind(key, address(token), seedLower, seedUpper);
    }

    function testFactoryLiquidityAllowedBeforeActivationButPrincipalStaysLocked() public view {
        // `_localQuoteDepth` in setUp added a second factory position before activation; the seed is untouched.
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
        assertEq(hook.seedTickLower(), seedLower);
    }

    function testPayerCreditOnlyAfterActivationAndFromOriginalTransferReceipt() public {
        _deployCompanions();
        _activate();
        (address recipient, uint256 amount) = hook.pendingPayerCredit();
        assertEq(recipient, payer);
        assertEq(amount, token.PAYER_ALLOCATION());
        assertEq(hook.syncPayer(), amount);
        assertEq(hook.eligible(payer), amount);
        assertEq(hook.syncPayer(), 0);
    }

    /// @dev The factory's fee-share requester can be reassigned before stage 2 (`PoolFees.setRequester`), and the
    /// verified factory takes `requester` and `remainderTo` as independent inputs. The payer credit is only for the
    /// wallet proven to have originally received the allocation, independent of current holdings.
    function testRequesterReassignmentCannotMoveInitialAllocationCredit() public {
        _deployCompanions();
        vm.prank(payer);
        factory.setRequester(LAUNCH_NUMBER, bob);
        _activate();
        hook.syncPayer();
        assertEq(hook.payer(), payer);
        assertEq(hook.eligible(payer), token.PAYER_ALLOCATION());
        assertEq(hook.eligible(bob), 0);
    }

    function testPayerCanTransferBeforeActivationWithoutLosingHistoricalCredit() public {
        _deployCompanions();
        uint256 balance = token.balanceOf(payer);
        vm.prank(payer);
        token.transfer(alice, balance);
        _activate();
        hook.syncPayer();
        assertEq(hook.payer(), payer);
        assertEq(hook.eligible(payer), token.PAYER_ALLOCATION());
        assertEq(hook.eligible(alice), 0);
    }

    /// @dev Regression for the old hidden reserve threshold. At $3,000/ETH the advertised $100K
    /// tier is reachable while actual ETH reserves are below 10 ETH; the locked seed capacity is sufficient.
    function testFirstTierConfirmsBelowTenEthActualReserves() public {
        _deployCompanions();
        _activate();
        feed.set(3000e8);
        _buy(bob, 9.5 ether);
        (uint160 sqrtPrice,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        // token is currency1: ETH per token = 2^192 / sqrtP^2. Spot FDV in USD (18 decimals).
        uint256 ethPerToken = Math.mulDiv(1 ether, 1 << 192, uint256(sqrtPrice) * sqrtPrice);
        uint256 spotFdv = Math.mulDiv(1_000_000_000 ether, ethPerToken * 3000, 1 ether);
        assertGe(spotFdv, 100_000 ether, "spot above first tier");
        uint256 depth = SqrtPriceMath.getAmount0Delta(
            sqrtPrice, TickMath.getSqrtPriceAtTick(seedUpper), _factoryLiquidity(seedLower, seedUpper), false
        );
        assertLt(depth, 10 ether, "seed holds less than the floor");
        _confirm();
        _confirm();
        assertEq(hook.tier(), 1);
        assertGe(oracle.fdvUsd(), 100_000 ether);
    }

    function _assertUnconfigured() internal view {
        assertFalse(hook.activated());
        assertEq(hook.router(), address(0));
        assertEq(address(hook.rewards()), address(0));
        assertEq(address(hook.oracle()), address(0));
        assertEq(hook.launchNumber(), 0);
        assertEq(hook.payer(), address(0));
        assertFalse(oracle.bound());
    }
}

/// @notice The hook constructor takes only supported launch inputs and makes no external call.
contract StageOneConstructorTest is SystemFixture {
    function setUp() public override {
        _deploy(false);
    }

    function testConstructorRejectsMissingOrConflatedInputs() public {
        UnlkToken t = UnlkToken(address(0x1001));
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        new UnlkHook(IPoolManager(address(0)), t, address(factory), owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        new UnlkHook(manager, t, address(factory), address(0));
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        new UnlkHook(manager, t, address(factory), address(factory));
    }

    function testOnlyFactoryCanInitializeTheHooksPool() public {
        vm.expectRevert();
        manager.initialize(key, TickMath.getSqrtPriceAtTick(174960));
    }
}
