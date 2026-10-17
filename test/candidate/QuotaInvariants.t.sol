// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CandidateFixture} from "./CandidateFixture.sol";
import {Test} from "forge-std/Test.sol";
import {UnlkHookV2} from "../../src/candidate/UnlkHookV2.sol";
import {UnlkToken} from "../../src/UnlkToken.sol";
import {UnlkOracle} from "../../src/UnlkOracle.sol";
import {UnlkRouterV2} from "../../src/candidate/UnlkRouterV2.sol";
import {MerkleClaimEvidence} from "../../src/MerkleClaimEvidence.sol";
import {MerkleDistributor} from "../imd/MerkleDistributor.sol";
import {LaunchFactory} from "../imd/LaunchFactory.sol";
import {MockEthUsd} from "../fixtures/LocalFixtures.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Random call sequences against the ACTIVATED system: native buys (exact input and exact output),
/// sales within and beyond the quota, transfers, native claims plus attestation, credit syncs, milestone
/// progression under a moving ETH/USD feed, fee claims, donations and the attacks a trader could try
/// (direct manager swaps, re-activation, native refund theft). Violations are recorded in ghost counters,
/// because `fail_on_revert` is off and a revert inside a handler would otherwise be silently dropped.
contract CandidateQuotaHandler is Test, IUnlockCallback {
    using StateLibrary for IPoolManager;

    UnlkHookV2 public immutable hook;
    UnlkToken public immutable token;
    UnlkRouterV2 public immutable router;
    UnlkOracle public immutable oracle;
    MerkleClaimEvidence public immutable rewards;
    MerkleDistributor public immutable distributor;
    LaunchFactory public immutable factory;
    IPoolManager public immutable manager;
    MockEthUsd public immutable feed;
    uint64 public immutable launchNumber;
    uint64 public immutable unlocksAt;
    address public immutable owner;
    PoolKey internal key;
    address[] public actors;
    uint256 internal constant REWARD = 1_000_000 ether;

    // Ledger ghosts.
    mapping(address => uint256) public ghostBuys;
    mapping(address => uint256) public ghostSales;
    // Violation counters: every one of these must stay zero.
    uint256 public overQuotaSalesExecuted;
    uint256 public unexpectedSellRejections;
    uint256 public unexpectedBuyRejections;
    uint256 public directSwapsExecuted;
    uint256 public foreignActivations;
    uint256 public monotonicViolations;
    uint256 public refundTheft;
    uint256 public feeClaimTookPrincipal;
    // Progress counters, so the run can be read.
    uint256 public successfulBuys;
    uint256 public successfulSales;
    uint256 public rejectedSales;
    uint256 public claims;
    uint256 public donations;
    uint256 public feeClaims;
    uint16 public highestP = 2000;
    uint8 public highestTier;
    bool public unlockedSeen;

    uint8 private callbackMode; // 1 = donate, 2 = direct swap
    uint256 private callbackAmount;

    constructor(
        UnlkHookV2 hook_,
        UnlkRouterV2 router_,
        UnlkOracle oracle_,
        MerkleClaimEvidence rewards_,
        MerkleDistributor distributor_,
        LaunchFactory factory_,
        MockEthUsd feed_,
        uint64 launchNumber_,
        address owner_,
        address[] memory actors_
    ) {
        hook = hook_;
        token = hook_.token();
        router = router_;
        oracle = oracle_;
        rewards = rewards_;
        distributor = distributor_;
        factory = factory_;
        manager = hook_.poolManager();
        feed = feed_;
        launchNumber = launchNumber_;
        owner = owner_;
        key = hook_.poolKey();
        actors = actors_;
        unlocksAt = distributor_.roundOf(0).unlocksAt;
    }

    // ------------------------------------------------------------------ trades

    function buyExactIn(uint256 actorSeed, uint96 amountSeed) external {
        address actor = _actor(actorSeed);
        uint256 amount = bound(amountSeed, 1e12, 3 ether);
        vm.deal(actor, actor.balance + amount);
        vm.prank(actor);
        try router.swap{value: amount}(_request(true, -int256(amount), amount)) returns (
            uint256, uint256 output
        ) {
            ghostBuys[actor] += output;
            ++successfulBuys;
        } catch {
            ++unexpectedBuyRejections;
        }
    }

    function buyExactOut(uint256 actorSeed, uint96 tokensSeed) external {
        address actor = _actor(actorSeed);
        uint256 tokensOut = bound(tokensSeed, 1e15, 1_000_000 ether);
        uint256 maxInput = 5 ether;
        vm.deal(actor, actor.balance + maxInput);
        vm.prank(actor);
        // An exact-output request that costs more than `maxInput` is refused by the router: that is a legitimate
        // rejection, so only the credited output is tracked.
        try router.swap{value: maxInput}(_request(true, int256(tokensOut), maxInput)) returns (
            uint256, uint256 output
        ) {
            ghostBuys[actor] += output;
            ++successfulBuys;
        } catch {}
    }

    function sellWithinQuota(uint256 actorSeed, uint96 amountSeed) external {
        address actor = _actor(actorSeed);
        uint256 limit = Math.min(token.balanceOf(actor), hook.remainingQuota(actor));
        if (limit < 1e12) return;
        uint256 amount = bound(amountSeed, 1e12, limit);
        vm.prank(actor);
        try router.swap(_request(false, -int256(amount), amount)) returns (uint256 input, uint256) {
            ghostSales[actor] += input;
            ++successfulSales;
        } catch {
            ++unexpectedSellRejections;
        }
    }

    function sellOverQuota(uint256 actorSeed, uint96 excessSeed) external {
        address actor = _actor(actorSeed);
        if (hook.fullyUnlocked()) return;
        uint256 quota = hook.remainingQuota(actor);
        uint256 balance = token.balanceOf(actor);
        if (balance <= quota) return;
        uint256 amount = bound(excessSeed, quota + 1, balance);
        uint256 soldBefore = hook.sold(actor);
        vm.prank(actor);
        try router.swap(_request(false, -int256(amount), amount)) returns (uint256 input, uint256) {
            ghostSales[actor] += input;
            ++overQuotaSalesExecuted;
        } catch {
            ++rejectedSales;
            if (hook.sold(actor) != soldBefore || token.balanceOf(actor) != balance) {
                ++overQuotaSalesExecuted;
            }
        }
    }

    function sellExactOut(uint256 actorSeed, uint96 ethSeed) external {
        address actor = _actor(actorSeed);
        uint256 limit = Math.min(token.balanceOf(actor), hook.remainingQuota(actor));
        if (limit < 1e12) return;
        uint256 ethOut = bound(ethSeed, 1e9, 0.5 ether);
        vm.prank(actor);
        // Legitimately refused when `limit` tokens do not buy `ethOut`; what executes is charged at actual input.
        try router.swap(_request(false, int256(ethOut), limit)) returns (uint256 input, uint256) {
            ghostSales[actor] += input;
            ++successfulSales;
        } catch {}
    }

    function withdrawNative(uint256 actorSeed) external {
        address actor = _actor(actorSeed);
        uint256 credit = router.nativeCredit(actor);
        uint256 before = actor.balance;
        vm.prank(actor);
        router.withdrawNative();
        if (actor.balance != before + credit) ++refundTheft;
        // A different wallet pulling the same credit again must get nothing.
        address other = _actor((actorSeed % actors.length) + 1);
        uint256 otherCredit = router.nativeCredit(other);
        uint256 otherBefore = other.balance;
        vm.prank(other);
        router.withdrawNative();
        if (other.balance != otherBefore + otherCredit) ++refundTheft;
    }

    // ------------------------------------------------------------------ rights

    function transfer(uint256 fromSeed, uint256 toSeed, uint96 amountSeed) external {
        address from = _actor(fromSeed);
        address to = _actor(toSeed);
        uint256 amount = bound(amountSeed, 0, token.balanceOf(from));
        vm.prank(from);
        token.transfer(to, amount);
    }

    function claimAndAttest() external {
        if (block.timestamp < unlocksAt) return;
        bytes32[] memory proof = new bytes32[](0);
        try distributor.claim(0, actors[0], REWARD, proof) {
            ++claims;
        } catch {}
        try rewards.attest(0, actors[0], REWARD, proof) {} catch {}
    }

    function sync(uint256 actorSeed) external {
        hook.syncPayer();
        hook.syncRewards(_actor(actorSeed));
    }

    // ------------------------------------------------------------------ time and price

    function advance(uint16 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1, 301));
        vm.roll(block.number + 1);
        feed.fresh();
        hook.updateMilestone();
        _observeMilestones();
    }

    function setFeed(uint32 usdSeed) external {
        // $100 to $50,000 per ETH, always fresh: the tiers must be reachable and never reversible.
        feed.set(int256(uint256(bound(usdSeed, 100, 50_000))) * 1e8);
    }

    // ------------------------------------------------------------------ pool-level actions

    function claimFees() external {
        uint128 before = _seedLiquidity();
        factory.claimFees(launchNumber);
        ++feeClaims;
        if (_seedLiquidity() != before) ++feeClaimTookPrincipal;
    }

    function donate(uint96 amountSeed) external {
        address payer = actors[actors.length - 1];
        uint256 amount = bound(amountSeed, 1, Math.min(token.balanceOf(payer), 1000 ether));
        if (amount == 0) return;
        vm.prank(payer);
        token.transfer(address(this), amount);
        callbackMode = 1;
        callbackAmount = amount;
        try manager.unlock("") {
            ++donations;
        } catch {
            // No in-range liquidity at the current tick: the tokens stay here and still create no rights.
        }
        callbackMode = 0;
    }

    function directSwap(uint96 amountSeed) external {
        uint256 amount = bound(amountSeed, 1e12, 1 ether);
        vm.deal(address(this), address(this).balance + amount);
        callbackMode = 2;
        callbackAmount = amount;
        try manager.unlock("") {
            ++directSwapsExecuted;
        } catch {}
        callbackMode = 0;
    }

    function foreignActivate(uint256 callerSeed) external {
        address caller = callerSeed % (actors.length + 1) == actors.length ? owner : _actor(callerSeed);
        UnlkRouterV2 other = new UnlkRouterV2(manager, router.hook());
        vm.prank(caller);
        try hook.configureAndActivate(address(other), rewards, oracle, launchNumber) {
            ++foreignActivations;
        } catch {}
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        require(msg.sender == address(manager));
        if (callbackMode == 1) {
            manager.donate(key, 0, callbackAmount, "");
            manager.sync(key.currency1);
            token.transfer(address(manager), callbackAmount);
            manager.settle();
        } else if (callbackMode == 2) {
            manager.swap(
                key,
                SwapParams(true, -int256(callbackAmount), TickMath.MIN_SQRT_PRICE + 1),
                abi.encode(uint256(1))
            );
        }
        return "";
    }

    receive() external payable {}

    // ------------------------------------------------------------------ helpers

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function _observeMilestones() private {
        uint16 p = hook.p();
        uint8 tier = hook.tier();
        bool unlocked = hook.fullyUnlocked();
        if (p < highestP || tier < highestTier || (unlockedSeen && !unlocked)) ++monotonicViolations;
        highestP = p;
        highestTier = tier;
        unlockedSeen = unlocked;
    }

    function _seedLiquidity() private view returns (uint128 liquidity) {
        (liquidity,,) = manager.getPositionInfo(
            hook.poolId(), address(factory), hook.seedTickLower(), hook.seedTickUpper(), 0
        );
    }

    function _actor(uint256 seed) private view returns (address) {
        return actors[seed % actors.length];
    }

    function _request(bool buy, int256 specified, uint256 maxInput)
        private
        view
        returns (UnlkRouterV2.SwapRequest memory)
    {
        // Native ETH is currency0 and UNLK currency1 on the official pool, so a buy is zeroForOne.
        return UnlkRouterV2.SwapRequest(
            buy,
            specified,
            buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            maxInput,
            1,
            block.timestamp + 1
        );
    }
}

/// forge-config: default.invariant.runs = 96
/// forge-config: default.invariant.depth = 60
contract CandidateQuotaInvariantTest is CandidateFixture {
    using StateLibrary for IPoolManager;

    CandidateQuotaHandler internal handler;
    address internal carol;
    address internal warmUpBuyer;
    uint16[17] internal percentages = [
        uint16(2000),
        2500,
        3000,
        3500,
        4000,
        4500,
        5000,
        5500,
        6000,
        6500,
        7000,
        7500,
        8000,
        8500,
        9000,
        9500,
        10000
    ];

    function setUp() public virtual override {
        super.setUp();
        carol = makeAddr("local Carol");
        _approveRouter(carol);
        // Claims are reachable from the first action; the seeded position meets the fixed capacity check.
        _advance(1 hours);
        _localWarmUpBuy(12 ether);
        warmUpBuyer = address(uint160(uint256(keccak256("local warm-up buyer"))));
        address[] memory actors = new address[](4);
        actors[0] = alice;
        actors[1] = bob;
        actors[2] = carol;
        actors[3] = payer;
        handler = new CandidateQuotaHandler(
            hook, router, oracle, rewards, distributor, factory, feed, LAUNCH_NUMBER, owner, actors
        );
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](16);
        selectors[0] = CandidateQuotaHandler.buyExactIn.selector;
        selectors[1] = CandidateQuotaHandler.buyExactOut.selector;
        selectors[2] = CandidateQuotaHandler.sellWithinQuota.selector;
        selectors[3] = CandidateQuotaHandler.sellOverQuota.selector;
        selectors[4] = CandidateQuotaHandler.sellExactOut.selector;
        selectors[5] = CandidateQuotaHandler.withdrawNative.selector;
        selectors[6] = CandidateQuotaHandler.transfer.selector;
        selectors[7] = CandidateQuotaHandler.claimAndAttest.selector;
        selectors[8] = CandidateQuotaHandler.sync.selector;
        selectors[9] = CandidateQuotaHandler.advance.selector;
        selectors[10] = CandidateQuotaHandler.setFeed.selector;
        selectors[11] = CandidateQuotaHandler.claimFees.selector;
        selectors[12] = CandidateQuotaHandler.donate.selector;
        selectors[13] = CandidateQuotaHandler.directSwap.selector;
        selectors[14] = CandidateQuotaHandler.foreignActivate.selector;
        selectors[15] = CandidateQuotaHandler.sellWithinQuota.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function _actors() internal view returns (address[4] memory) {
        return [alice, bob, carol, payer];
    }

    /// @dev Guards the handler itself: a scripted sequence must really trade, claim, confirm a tier and reject
    /// an over-quota sale. The previous handler's buys all reverted silently and its invariants held vacuously.
    function testHandlerActionsActuallyExecute() public {
        handler.buyExactIn(0, 1 ether);
        handler.buyExactOut(1, 1e20);
        handler.sellWithinQuota(0, type(uint96).max);
        handler.sellOverQuota(0, 1);
        handler.sellExactOut(0, 1e9);
        handler.claimAndAttest();
        handler.sync(0);
        handler.sync(3);
        handler.donate(1 ether);
        handler.directSwap(1 ether);
        handler.foreignActivate(0);
        handler.claimFees();
        handler.withdrawNative(1);
        handler.setFeed(50_000);
        for (uint256 i; i < 110; ++i) {
            handler.advance(300);
        }
        assertEq(handler.successfulBuys(), 2);
        assertGe(handler.successfulSales(), 1);
        assertGt(hook.sold(alice), 0);
        assertEq(handler.rejectedSales(), 1);
        assertEq(handler.claims(), 1);
        assertEq(hook.eligible(alice), handler.ghostBuys(alice) + REWARD);
        assertEq(hook.eligible(payer), token.PAYER_ALLOCATION());
        assertEq(handler.donations(), 1);
        assertEq(handler.feeClaims(), 1);
        assertGt(hook.tier(), 0, "a sustained $50k ETH price with 12 ETH of depth confirms a tier");
        assertEq(
            handler.overQuotaSalesExecuted() + handler.directSwapsExecuted() + handler.foreignActivations(), 0
        );
        invariant_salesNeverExceedQuota();
        invariant_ledgerMatchesExecutedDeltas();
        invariant_supplyConservedAndNoCustody();
        invariant_routerNativeSolvency();
    }

    /// @dev Before full unlock no wallet's executed sales exceed floor(E * p / 10000); the over-quota attempts
    /// never executed and never moved state; every in-quota sale the handler attempted went through.
    function invariant_salesNeverExceedQuota() public view {
        assertEq(handler.overQuotaSalesExecuted(), 0, "an over-quota sale executed or left state behind");
        assertEq(handler.unexpectedSellRejections(), 0, "an in-quota sale was refused");
        assertEq(handler.unexpectedBuyRejections(), 0, "an authenticated buy was refused");
        if (hook.fullyUnlocked()) return;
        address[4] memory actors = _actors();
        for (uint256 i; i < 4; ++i) {
            assertLe(hook.sold(actors[i]), Math.mulDiv(hook.eligible(actors[i]), hook.p(), 10000));
            uint256 cap = Math.mulDiv(hook.eligible(actors[i]), hook.p(), 10000);
            assertEq(
                hook.remainingQuota(actors[i]), cap > hook.sold(actors[i]) ? cap - hook.sold(actors[i]) : 0
            );
        }
    }

    /// @dev E is exactly executed buys + synchronized native claims + the recorded payer's allocation; S is
    /// exactly executed sales. Transfers, donations, fee claims and failed swaps leave both untouched.
    function invariant_ledgerMatchesExecutedDeltas() public view {
        address[4] memory actors = _actors();
        for (uint256 i; i < 4; ++i) {
            uint256 expected = handler.ghostBuys(actors[i]) + hook.claimedCredit(actors[i]);
            if (actors[i] == payer && hook.payerCredited()) expected += token.PAYER_ALLOCATION();
            assertEq(hook.eligible(actors[i]), expected, "eligible drifted from executed deltas");
            assertEq(hook.sold(actors[i]), handler.ghostSales(actors[i]), "sold drifted from executed deltas");
            assertLe(hook.claimedCredit(actors[i]), rewards.claimed(actors[i]));
        }
        assertEq(hook.eligible(address(handler)), 0, "donations or direct swaps created rights");
        assertEq(hook.eligible(address(factory)), 0);
        assertEq(hook.eligible(address(router)), 0);
        assertEq(hook.eligible(imd), 0);
    }

    function invariant_vaultReceiptsBackAllAccrual() public view {
        assertEq(manager.balanceOf(address(hook.nftFeeVault()), 0), hook.nftFeeVault().pendingClaims());
        assertLe(hook.nftFeeVault().totalWithdrawn(), hook.nftFeeVault().totalRedeemed());
        assertLe(hook.nftFeeVault().totalRedeemed(), hook.nftFeeVault().totalAccrued());
        assertGe(address(hook.nftFeeVault()).balance, hook.nftFeeVault().claimable());
    }

    /// @dev Fixed supply, fully accounted for across every holder; the hook and the router keep no tokens.
    function invariant_supplyConservedAndNoCustody() public view {
        uint256 total = token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(carol)
            + token.balanceOf(payer) + token.balanceOf(imd) + token.balanceOf(address(manager))
            + token.balanceOf(address(factory)) + token.balanceOf(address(distributor))
            + token.balanceOf(address(handler)) + token.balanceOf(warmUpBuyer);
        assertEq(total, token.totalSupply());
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(address(hook).balance, 0, "the hook holds claims in its vault, not ETH");
    }

    /// @dev Native proceeds and refunds held by the router are exactly what it owes, and nobody withdrew
    /// another wallet's credit.
    function invariant_routerNativeSolvency() public view {
        address[4] memory actors = _actors();
        uint256 owed;
        for (uint256 i; i < 4; ++i) {
            owed += router.nativeCredit(actors[i]);
        }
        owed += router.nativeCredit(warmUpBuyer) + router.nativeCredit(address(handler));
        assertEq(router.totalNativeCredit(), owed);
        assertEq(address(router).balance, owed);
        assertEq(handler.refundTheft(), 0);
        (address trader, bytes32 operation) = router.context();
        assertEq(trader, address(0));
        assertEq(operation, bytes32(0));
    }

    /// @dev The factory's seed never shrinks, including through fee collection, and the pool's fee terms hold.
    function invariant_principalLockedAndFeeTermsFixed() public view {
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
        assertEq(handler.feeClaimTookPrincipal(), 0);
        (,, uint24 protocolFee, uint24 lpFee) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        assertEq(lpFee, 12500);
        assertEq(protocolFee, 0);
    }

    /// @dev Tiers and p only ever rise; the two are always consistent; full unlock is final.
    function invariant_milestonesMonotonicAndConsistent() public view {
        assertEq(handler.monotonicViolations(), 0);
        uint8 tier = hook.tier();
        assertLe(tier, 16);
        assertEq(hook.p(), percentages[tier]);
        assertEq(hook.fullyUnlocked(), tier == 16);
        if (hook.fullyUnlocked()) assertEq(hook.remainingQuota(bob), type(uint256).max);
    }

    /// @dev Activation sealed everything: no replacement, no re-activation, no direct-manager route.
    function invariant_configurationSealedAndRouteEnforced() public view {
        assertTrue(hook.activated());
        assertEq(hook.router(), address(router));
        assertEq(address(hook.rewards()), address(rewards));
        assertEq(address(hook.oracle()), address(oracle));
        assertEq(hook.launchNumber(), LAUNCH_NUMBER);
        assertEq(hook.payer(), payer);
        assertEq(hook.swarm(), address(distributor));
        assertTrue(oracle.bound());
        assertEq(handler.foreignActivations(), 0, "configureAndActivate succeeded a second time");
        assertEq(handler.directSwapsExecuted(), 0, "a swap bypassed the router");
    }
}
