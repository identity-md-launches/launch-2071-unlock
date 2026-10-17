// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {Test} from "forge-std/Test.sol";
import {UnlkHook} from "../src/UnlkHook.sol";
import {UnlkToken} from "../src/UnlkToken.sol";
import {UnlkOracle} from "../src/UnlkOracle.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {MerkleClaimEvidence} from "../src/MerkleClaimEvidence.sol";
import {IUnlkHookView, IMerkleDistributor} from "../src/interfaces/IIntegration.sol";
import {MerkleDistributor} from "./imd/MerkleDistributor.sol";
import {MockEthUsd} from "./fixtures/LocalFixtures.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

/// @notice Stage 1 alone ("pool deployed, trading inactive") under random pressure. The unconfigured state may
/// only be left by the setup authority with companions built against the real stage-1 identities, and once
/// left it is final. Everyone else's attempts — wrong caller, wrong companions, wrong launch number, direct
/// swaps, router swaps, foreign liquidity, syncs and milestones — must change nothing.
contract StageOneHandler is Test, IUnlockCallback {
    UnlkHook public immutable hook;
    UnlkToken public immutable token;
    UnlkSwapRouter public immutable router;
    UnlkOracle public immutable oracle;
    MerkleClaimEvidence public immutable rewards;
    MerkleDistributor public immutable distributor;
    IPoolManager public immutable manager;
    MockEthUsd public immutable feed;
    address public immutable owner;
    address public immutable factory;
    uint64 public immutable launchNumber;
    uint64 public immutable unlocksAt;
    PoolKey internal key;
    address[] public actors;

    bool public legitimatelyActivated;
    uint256 public illegitimateActivations;
    uint256 public swapsBeforeActivation;
    uint256 public directSwapsExecuted;
    uint256 public foreignLiquidityAdded;
    uint256 public syncsBeforeActivation;
    uint256 public claims;
    uint256 public activationAttempts;

    uint8 private callbackMode; // 1 = direct swap, 2 = add liquidity
    uint256 private callbackAmount;

    constructor(
        UnlkHook hook_,
        UnlkSwapRouter router_,
        UnlkOracle oracle_,
        MerkleClaimEvidence rewards_,
        MerkleDistributor distributor_,
        MockEthUsd feed_,
        address owner_,
        uint64 launchNumber_,
        address[] memory actors_
    ) {
        hook = hook_;
        token = hook_.token();
        router = router_;
        oracle = oracle_;
        rewards = rewards_;
        distributor = distributor_;
        manager = hook_.poolManager();
        feed = feed_;
        owner = owner_;
        factory = hook_.launchFactory();
        launchNumber = launchNumber_;
        key = hook_.poolKey();
        actors = actors_;
        unlocksAt = distributor_.roundOf(0).unlocksAt;
    }

    /// @dev variant 0 with the owner is the one legitimate call; every other combination must be refused.
    function attemptActivate(uint256 callerSeed, uint8 variantSeed) external {
        uint256 pick = callerSeed % (actors.length + 2);
        address caller = pick == actors.length ? owner : (pick == actors.length + 1 ? factory : actors[pick]);
        uint8 variant = variantSeed % 5;
        address router_ = address(router);
        MerkleClaimEvidence rewards_ = rewards;
        UnlkOracle oracle_ = oracle;
        uint64 number = launchNumber;
        if (variant == 1) router_ = address(new UnlkSwapRouter(manager, IUnlkHookView(address(0xBEEF))));
        if (variant == 2) oracle_ = new UnlkOracle(manager, feed, address(0xBEEF));
        if (variant == 3) number = launchNumber + 1 + uint64(variantSeed);
        if (variant == 4) {
            rewards_ = new MerkleClaimEvidence(IMerkleDistributor(address(distributor)), address(0xBEEF));
        }
        ++activationAttempts;
        bool wasActivated = hook.activated();
        vm.prank(caller);
        try hook.configureAndActivate(router_, rewards_, oracle_, number) {
            if (caller == owner && variant == 0 && !wasActivated) legitimatelyActivated = true;
            else ++illegitimateActivations;
        } catch {}
    }

    function routerSwap(uint256 actorSeed, uint96 amountSeed) external {
        address actor = actors[actorSeed % actors.length];
        uint256 amount = bound(amountSeed, 1e12, 1 ether);
        vm.deal(actor, actor.balance + amount);
        bool active = hook.activated();
        vm.prank(actor);
        try router.swap{value: amount}(
            UnlkSwapRouter.SwapRequest(
                true, -int256(amount), TickMath.MIN_SQRT_PRICE + 1, amount, 1, block.timestamp + 1
            )
        ) {
            if (!active) ++swapsBeforeActivation;
        } catch {}
    }

    function directSwap(uint96 amountSeed) external {
        callbackAmount = bound(amountSeed, 1e12, 1 ether);
        vm.deal(address(this), address(this).balance + callbackAmount);
        callbackMode = 1;
        try manager.unlock("") {
            ++directSwapsExecuted;
        } catch {}
        callbackMode = 0;
    }

    function foreignLiquidity(uint96 amountSeed) external {
        address payer = actors[actors.length - 1];
        uint256 amount = bound(amountSeed, 1e15, 1000 ether);
        if (token.balanceOf(payer) < amount) return;
        vm.prank(payer);
        token.transfer(address(this), amount);
        callbackAmount = amount;
        callbackMode = 2;
        try manager.unlock("") {
            ++foreignLiquidityAdded;
        } catch {}
        callbackMode = 0;
    }

    function syncAndMilestone(uint256 actorSeed) external {
        bool active = hook.activated();
        try hook.syncPayer() {
            if (!active) ++syncsBeforeActivation;
        } catch {}
        try hook.syncRewards(actors[actorSeed % actors.length]) {
            if (!active) ++syncsBeforeActivation;
        } catch {}
        try hook.updateMilestone() {
            if (!active) ++syncsBeforeActivation;
        } catch {}
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint96 amountSeed) external {
        address from = actors[fromSeed % actors.length];
        address to = actors[toSeed % actors.length];
        uint256 amount = bound(amountSeed, 0, token.balanceOf(from));
        vm.prank(from);
        token.transfer(to, amount);
    }

    function claimAndAttest() external {
        if (block.timestamp < unlocksAt) return;
        bytes32[] memory proof = new bytes32[](0);
        try distributor.claim(0, actors[0], 1_000_000 ether, proof) {
            ++claims;
        } catch {}
        try rewards.attest(0, actors[0], 1_000_000 ether, proof) {} catch {}
    }

    function advance(uint16 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1, 3600));
        vm.roll(block.number + 1);
        feed.fresh();
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        require(msg.sender == address(manager));
        if (callbackMode == 1) {
            manager.swap(
                key,
                SwapParams(true, -int256(callbackAmount), TickMath.MIN_SQRT_PRICE + 1),
                abi.encode(uint256(1))
            );
        } else if (callbackMode == 2) {
            manager.modifyLiquidity(
                key, ModifyLiquidityParams(hook.seedTickLower(), hook.seedTickUpper(), 1e18, bytes32(0)), ""
            );
        }
        return "";
    }

    receive() external payable {}
}

/// forge-config: default.invariant.runs = 96
/// forge-config: default.invariant.depth = 40
contract StageOneInvariantTest is SystemFixture {
    using StateLibrary for IPoolManager;

    StageOneHandler internal handler;
    uint160 internal openingSqrtPrice;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _localQuoteDepth(10000 ether);
        _deployCompanions();
        (openingSqrtPrice,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        address[] memory actors = new address[](3);
        actors[0] = alice;
        actors[1] = bob;
        actors[2] = payer;
        handler = new StageOneHandler(
            hook, router, oracle, rewards, distributor, feed, owner, LAUNCH_NUMBER, actors
        );
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = StageOneHandler.attemptActivate.selector;
        selectors[1] = StageOneHandler.routerSwap.selector;
        selectors[2] = StageOneHandler.directSwap.selector;
        selectors[3] = StageOneHandler.foreignLiquidity.selector;
        selectors[4] = StageOneHandler.syncAndMilestone.selector;
        selectors[5] = StageOneHandler.transfer.selector;
        selectors[6] = StageOneHandler.claimAndAttest.selector;
        selectors[7] = StageOneHandler.advance.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    /// @dev Activation happens exactly when the authority sent the one correct call, and never reverts.
    function invariant_onlyTheAuthorizedCallActivates() public view {
        assertEq(hook.activated(), handler.legitimatelyActivated());
        assertEq(handler.illegitimateActivations(), 0, "a wrong caller, companion or launch number activated");
        if (!hook.activated()) {
            assertEq(hook.router(), address(0));
            assertEq(address(hook.rewards()), address(0));
            assertEq(address(hook.oracle()), address(0));
            assertEq(hook.launchNumber(), 0);
            assertEq(hook.payer(), address(0));
            assertFalse(oracle.bound());
            assertEq(oracle.observationCount(), 0);
        } else {
            assertEq(hook.router(), address(router));
            assertEq(address(hook.oracle()), address(oracle));
            assertEq(address(hook.rewards()), address(rewards));
            assertEq(hook.payer(), payer);
            assertTrue(oracle.bound());
        }
    }

    /// @dev Before activation nothing trades, syncs or progresses; the pool price cannot move.
    function invariant_unconfiguredPoolIsInert() public view {
        assertEq(handler.swapsBeforeActivation(), 0);
        assertEq(handler.directSwapsExecuted(), 0);
        assertEq(handler.syncsBeforeActivation(), 0);
        assertEq(handler.foreignLiquidityAdded(), 0);
        if (!hook.activated()) {
            (uint160 sqrtPrice,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
            assertEq(sqrtPrice, openingSqrtPrice, "the price moved while trading was inactive");
            assertEq(hook.eligible(alice) + hook.eligible(bob) + hook.eligible(payer), 0);
            assertEq(hook.p(), 2500);
            assertEq(hook.tier(), 0);
        }
    }

    /// @dev Transfers and native claims stay available throughout, with the supply fully accounted for.
    function invariant_tokenAndClaimsIndependentOfTheHook() public view {
        uint256 total = token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(payer)
            + token.balanceOf(address(manager)) + token.balanceOf(address(factory))
            + token.balanceOf(address(distributor)) + token.balanceOf(address(handler));
        assertEq(total, 1_000_000_000 ether);
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(address(hook).balance, 0);
        if (handler.claims() > 0) assertTrue(distributor.claimed(0, alice));
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
        assertEq(hook.seedTickLower(), seedLower);
        assertEq(hook.seedTickUpper(), seedUpper);
    }
}
