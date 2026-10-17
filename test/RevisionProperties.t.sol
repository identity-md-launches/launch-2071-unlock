// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {MockEthUsd} from "./fixtures/LocalFixtures.sol";
import {LaunchFactory} from "./imd/LaunchFactory.sol";
import {UnlkHook} from "src/UnlkHook.sol";
import {UnlkOracle} from "src/UnlkOracle.sol";
import {UnlkSwapRouter} from "src/UnlkSwapRouter.sol";
import {MerkleClaimEvidence} from "src/MerkleClaimEvidence.sol";
import {SeedDepth} from "src/libraries/SeedDepth.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";

/// @notice Properties of the revised seed gate: whatever opening boundary the factory is given, a seed that
/// launches is one the oracle classes liquid and can price, and a seed that is refused is one outside the
/// published capacity or pool-share bands. No seed can launch and then be illiquid forever.
/// forge-config: default.fuzz.runs = 96
contract SeedGatePropertiesTest is SystemFixture {
    using StateLibrary for IPoolManager;

    function setUp() public override {
        _deploy(false);
    }

    function _seed(int24 normalizedTick, uint256 bps)
        internal
        returns (uint160 sqrt, uint128 liquidity, uint256 principal, uint256 depth)
    {
        (seedLower, seedUpper) = (LOWER, -normalizedTick);
        sqrt = TickMath.getSqrtPriceAtTick(seedUpper);
        liquidity = uint128(uint256(_tokenOnlyLiquidity(token, sqrt)) * bps / 10000);
        (principal, depth) = SeedDepth.quoteCapacity(TickMath.getSqrtPriceAtTick(seedLower), sqrt, liquidity);
    }

    function _tryLaunch(uint160 sqrt, uint128 liquidity) internal returns (bool ok) {
        LaunchFactory.LaunchParams memory params = _launchParams(sqrt, seedLower, seedUpper, liquidity);
        try factory.launch(params) returns (address t, address h, address d) {
            token = UnlkHook(h).token();
            hook = UnlkHook(h);
            assertEq(address(token), t);
            assertEq(d, _predictDistributor(t));
            ok = true;
        } catch {
            ok = false;
        }
    }

    /// @dev Opening boundaries from 15% below to 15% above the policy figure, in tick spacings. The exact
    /// 870M token-only seed launches if and only if its opening-value capacity clears the oracle floor, and a
    /// launched seed is priced by the oracle after the warm-up window.
    function testFuzz_launchedSeedIsAlwaysLiquidAndRefusedSeedIsAlwaysBelowFloor(uint8 step) public {
        int24 normalized = -178800 + int24(uint24(bound(step, 0, 50))) * 60;
        (uint160 sqrt, uint128 liquidity, uint256 principal, uint256 depth) = _seed(normalized, 10000);
        bool launched = _tryLaunch(sqrt, liquidity);
        if (!launched) {
            assertTrue(
                depth < SeedDepth.MIN_SEED_QUOTE_CAPACITY || principal < 861_300_000 ether
                    || principal > 870_000_000 ether,
                "a seed inside both bands was refused"
            );
            assertEq(address(hook), address(0));
            return;
        }
        assertGe(depth, SeedDepth.MIN_SEED_QUOTE_CAPACITY, "a seed below the floor launched");
        assertEq(hook.seedTokens(), principal);
        assertEq(hook.seedQuoteCapacity(), depth);
        assertLe(hook.seedTokens(), token.initialAllocation(address(manager)));
        _deployCompanions();
        _activate();
        // The live position is what the oracle measures; it must agree with the hook's record and be liquid.
        uint128 live = _factoryLiquidity(seedLower, seedUpper);
        assertEq(live, liquidity);
        assertEq(
            SeedDepth.capacity(
                TickMath.getSqrtPriceAtTick(seedLower), TickMath.getSqrtPriceAtTick(seedUpper), live
            ),
            depth
        );
        (,, bool liquid,,) = oracle.observations(0);
        assertTrue(liquid, "opening observation classed illiquid");
        _advance(oracle.WINDOW());
        oracle.checkpoint();
        uint256 fdv = oracle.fdvUsd();
        assertGt(fdv, 0, "oracle cannot price a launched seed");
        // Opening FDV in USD is the boundary price times the feed, within tick rounding of the model.
        uint256 openingEth = 1_000_000_000 ether * depth / principal;
        uint256 expected = openingEth * 2000;
        assertApproxEqRel(fdv, expected, 0.002e18, "priced FDV disagrees with the opening boundary");
    }

    /// @dev At the policy boundary, seeds short of the exact figure launch and seal exactly when the pool
    /// receives at least the 1% band, and the remainder wallet is never credited more than the policy share.
    function testFuzz_poolShareBandDecidesLaunchAndActivation(uint16 bpsSeed) public {
        uint256 bps = bound(bpsSeed, 9800, 10000);
        (uint160 sqrt, uint128 liquidity, uint256 principal,) = _seed(OPENING_TICK, bps);
        bool launched = _tryLaunch(sqrt, liquidity);
        if (principal < hook_MIN_POOL_ALLOCATION()) {
            assertFalse(launched, "a seed below the pool-share band launched");
            return;
        }
        assertTrue(launched, "a seed inside the band was refused");
        uint256 poolReceived = token.initialAllocation(address(manager));
        assertGe(poolReceived, 861_300_000 ether);
        assertLe(poolReceived, 870_000_000 ether);
        assertEq(
            token.SWARM_ALLOCATION() + poolReceived + token.initialAllocation(payer),
            token.SUPPLY(),
            "allocation receipts do not sum to the supply"
        );
        _deployCompanions();
        _activate();
        assertTrue(hook.activated());
        assertEq(hook.syncPayer(), token.PAYER_ALLOCATION());
        assertEq(hook.eligible(payer), token.PAYER_ALLOCATION(), "remainder wallet over-credited");
    }

    function hook_MIN_POOL_ALLOCATION() internal pure returns (uint256) {
        return 861_300_000 ether;
    }
}

/// @notice The chunked certification path must accept exactly the trees the single-shot path accepts, in any
/// chunking and any reduction schedule, and a corrupted parallel session must never certify or interfere.
/// forge-config: default.fuzz.runs = 128
contract ChunkedCertificationPropertiesTest is SystemFixture {
    address[] internal accounts;
    uint256[] internal amounts;
    bytes32[] internal tree;
    uint256 internal n;
    uint256 internal round;

    function _prepare(uint256 nSeed, uint256 amountSeed) internal {
        n = bound(nSeed, 1, 24);
        delete accounts;
        delete amounts;
        uint256 total;
        for (uint256 i; i < n; ++i) {
            accounts.push(address(uint160(0x5000 + i)));
            uint256 amount = bound(uint256(keccak256(abi.encode(amountSeed, i))), 1, 1_000 ether);
            amounts.push(amount);
            total += amount;
        }
        _buildTree();
        vm.prank(payer);
        token.transfer(address(distributor), total);
        vm.prank(imd);
        round = distributor.openRound(tree[0], total, 0);
    }

    function _buildTree() internal {
        delete tree;
        for (uint256 i; i < 2 * n - 1; ++i) {
            tree.push(bytes32(0));
        }
        for (uint256 i; i < n; ++i) {
            tree[n - 1 + i] = keccak256(bytes.concat(keccak256(abi.encode(accounts[i], amounts[i]))));
        }
        for (uint256 i = n - 1; i > 0;) {
            --i;
            tree[i] = Hashes.commutativeKeccak256(tree[2 * i + 1], tree[2 * i + 2]);
        }
    }

    function _proof(uint256 leaf) internal view returns (bytes32[] memory proof) {
        uint256 depth;
        for (uint256 i = n - 1 + leaf; i > 0; i = (i - 1) / 2) {
            ++depth;
        }
        proof = new bytes32[](depth);
        uint256 k;
        for (uint256 i = n - 1 + leaf; i > 0; i = (i - 1) / 2) {
            proof[k++] = tree[i % 2 == 1 ? i + 1 : i - 1];
        }
    }

    function _slice(uint256 from, uint256 to) internal view returns (address[] memory a, uint256[] memory m) {
        a = new address[](to - from);
        m = new uint256[](to - from);
        for (uint256 i = from; i < to; ++i) {
            (a[i - from], m[i - from]) = (accounts[i], amounts[i]);
        }
    }

    function testFuzz_anyChunkingAndReductionScheduleMatchesSingleShot(
        uint8 nSeed,
        uint256 amountSeed,
        uint256 chunkSeed,
        uint256 reduceSeed,
        uint8 corruptSeed,
        uint8 leafSeed
    ) public {
        _prepare(nSeed, amountSeed);
        uint256 snapshot = vm.snapshotState();

        // A corrupted copy, submitted in parallel by another wallet, reduces to a wrong root and changes nothing.
        uint256 corrupt = bound(corruptSeed, 0, n - 1);
        (address[] memory wrong, uint256[] memory wrongAmounts) = _slice(0, n);
        wrongAmounts[corrupt] += 1;
        vm.prank(alice);
        rewards.submitLeaves(round, n, wrong, wrongAmounts);
        vm.prank(alice);
        vm.expectRevert(MerkleClaimEvidence.InvalidProof.selector);
        rewards.reduce(round, n);
        assertFalse(rewards.certified(round));

        // The honest submitter, in random chunks.
        uint256 submitted;
        uint256 chunks;
        while (submitted < n) {
            uint256 size = bound(uint256(keccak256(abi.encode(chunkSeed, chunks))), 1, n - submitted);
            (address[] memory a, uint256[] memory m) = _slice(submitted, submitted + size);
            vm.prank(bob);
            rewards.submitLeaves(round, n, a, m);
            submitted += size;
            ++chunks;
            (uint256 leaves, uint256 recorded, uint256 reduced) =
                rewards.sessions(rewards.sessionOf(bob, round));
            assertEq(leaves, n);
            assertEq(recorded, submitted);
            assertEq(reduced, 0);
        }
        // No more leaves fit, and the size cannot change after the first chunk.
        (address[] memory extra, uint256[] memory extraAmounts) = _slice(0, 1);
        vm.prank(bob);
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        rewards.submitLeaves(round, n, extra, extraAmounts);

        // Random reduction schedule: the round is certified exactly when the last internal node is computed.
        uint256 internalNodes = n - 1;
        uint256 done;
        uint256 calls;
        while (true) {
            uint256 count = bound(uint256(keccak256(abi.encode(reduceSeed, calls))), 1, n + 2);
            vm.prank(bob);
            rewards.reduce(round, count);
            ++calls;
            done = done + count > internalNodes ? internalNodes : done + count;
            (,, uint256 reduced) = rewards.sessions(rewards.sessionOf(bob, round));
            assertEq(reduced, done);
            if (done == internalNodes) break;
            assertFalse(rewards.certified(round), "certified before the root was computed");
        }
        assertTrue(rewards.certified(round), "complete honest session did not certify");
        // The certified round is closed to every path, including the corrupted session.
        vm.prank(bob);
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        rewards.reduce(round, 1);
        vm.prank(alice);
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        rewards.reduce(round, 1);
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        rewards.certifyRound(round, accounts, amounts);

        // Only an actual claim, proven with the right amount, becomes credit, and only once.
        uint256 leaf = bound(leafSeed, 0, n - 1);
        vm.expectRevert(MerkleClaimEvidence.NotClaimed.selector);
        rewards.attest(round, accounts[leaf], amounts[leaf], _proof(leaf));
        distributor.claim(round, accounts[leaf], amounts[leaf], _proof(leaf));
        vm.expectRevert(MerkleClaimEvidence.InvalidProof.selector);
        rewards.attest(round, accounts[leaf], amounts[leaf] + 1, _proof(leaf));
        assertEq(rewards.attest(round, accounts[leaf], amounts[leaf], _proof(leaf)), amounts[leaf]);
        vm.expectRevert(MerkleClaimEvidence.AlreadyAttested.selector);
        rewards.attest(round, accounts[leaf], amounts[leaf], _proof(leaf));
        assertEq(hook.syncRewards(accounts[leaf]), amounts[leaf]);
        assertEq(hook.eligible(accounts[leaf]), amounts[leaf]);
        assertEq(hook.syncRewards(accounts[leaf]), 0);

        // The single-shot path accepts exactly the same tree.
        vm.revertToState(snapshot);
        assertFalse(rewards.certified(round));
        rewards.certifyRound(round, accounts, amounts);
        assertTrue(rewards.certified(round));
    }

    /// @dev Abandoning a session discards every leaf of it, including the uniqueness set, so a recipient that
    /// was listed in the abandoned attempt is accepted again, and the old session can no longer be reduced.
    function testFuzz_abandonedSessionIsInertAndRestartable(uint8 nSeed, uint256 amountSeed) public {
        _prepare(nSeed, amountSeed);
        (address[] memory a, uint256[] memory m) = _slice(0, n);
        vm.prank(bob);
        rewards.submitLeaves(round, n, a, m);
        bytes32 before = rewards.sessionOf(bob, round);
        vm.prank(bob);
        rewards.abandonSession(round);
        assertTrue(rewards.sessionOf(bob, round) != before);
        (uint256 leaves, uint256 submitted,) = rewards.sessions(rewards.sessionOf(bob, round));
        assertEq(leaves, 0);
        assertEq(submitted, 0);
        vm.prank(bob);
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        rewards.reduce(round, n);
        // The same recipients are accepted again in the fresh session, and it certifies.
        vm.prank(bob);
        rewards.submitLeaves(round, n, a, m);
        vm.prank(bob);
        rewards.reduce(round, n);
        assertTrue(rewards.certified(round));
    }
}

/// @notice Random milestone sampling under feed outages, staleness, bad rounds, wrong decimals and price swings.
/// Tracks, independently of the hook's own counters, that no tier ever advances on an invalid sample, below its
/// threshold, by more than one step, or before a chain of valid qualifying samples no more than the maximum gap
/// apart has lasted the required confirmation; and that nothing ever relocks.
contract MilestoneSampleHandler is Test {
    UnlkHook internal hook;
    UnlkOracle internal oracle;
    MockEthUsd internal feed;

    uint8 internal constant HEALTHY = 0;
    uint8 internal constant BROKEN = 1;
    uint8 internal constant STALE = 2;
    uint8 internal constant DECIMALS = 3;
    uint8 internal constant NON_POSITIVE = 4;
    uint8 internal constant BAD_ROUND = 5;
    uint8 internal constant FUTURE = 6;
    uint8 public corruption;
    int256 internal price = 2000e8;

    uint256 public lastQualifying;
    uint256 public chainStart;
    uint8 public lastTier;
    uint16 public lastP;
    bool public wasUnlocked;

    uint256 public validSamples;
    uint256 public invalidSamples;
    uint256 public tierAdvances;
    uint256 public advancesOnInvalid;
    uint256 public advancesBelowThreshold;
    uint256 public advancesTooSoon;
    uint256 public multiStepAdvances;
    uint256 public relocks;
    uint256 public ghostDrift;

    constructor(UnlkHook hook_, UnlkOracle oracle_, MockEthUsd feed_) {
        hook = hook_;
        oracle = oracle_;
        feed = feed_;
        lastTier = hook.tier();
        lastP = hook.p();
    }

    function advance(uint16 secondsSeed) public {
        vm.warp(block.timestamp + bound(secondsSeed, 1, 20 minutes));
        vm.roll(block.number + 1);
        if (corruption != STALE && corruption != FUTURE) feed.fresh();
    }

    function setPrice(uint32 usdSeed) external {
        price = int256(uint256(bound(usdSeed, 100, 1_000_000))) * 1e8;
        if (corruption != NON_POSITIVE) feed.set(price);
    }

    function corrupt(uint8 modeSeed) external {
        corruption = uint8(bound(modeSeed, 1, 6));
        if (corruption == BROKEN) feed.setBroken(true);
        else if (corruption == DECIMALS) feed.setDecimals(6);
        else if (corruption == NON_POSITIVE) feed.set(0);
        else if (corruption == BAD_ROUND) feed.setRound(7, block.timestamp, block.timestamp, 3);
        else if (corruption == FUTURE) feed.setRound(1, block.timestamp, block.timestamp + 2 hours, 1);
    }

    function heal() external {
        corruption = HEALTHY;
        feed.setBroken(false);
        feed.setDecimals(8);
        feed.setRound(1, block.timestamp, block.timestamp, 1);
        feed.set(price);
    }

    function sample() public {
        oracle.checkpoint();
        bool valid;
        uint256 fdv;
        try oracle.fdvUsd() returns (uint256 value) {
            valid = true;
            fdv = value;
        } catch {}
        uint8 before = hook.tier();
        if (valid) {
            ++validSamples;
            if (hook.tierForFdv(fdv) > before) {
                if (lastQualifying == 0 || block.timestamp - lastQualifying > hook.MAX_CONFIRMATION_GAP()) {
                    chainStart = block.timestamp;
                }
                lastQualifying = block.timestamp;
            } else {
                chainStart = 0;
                lastQualifying = 0;
            }
        } else {
            ++invalidSamples;
        }

        hook.updateMilestone();

        uint8 now_ = hook.tier();
        if (now_ != before) {
            ++tierAdvances;
            if (!valid) ++advancesOnInvalid;
            if (now_ != before + 1) ++multiStepAdvances;
            if (valid && hook.tierForFdv(fdv) <= before) ++advancesBelowThreshold;
            uint256 required = before == 5 ? hook.FINAL_CONFIRMATION() : hook.CONFIRMATION();
            if (chainStart == 0 || block.timestamp - chainStart < required) ++advancesTooSoon;
            if (valid && hook.tierForFdv(fdv) > now_) {
                chainStart = block.timestamp;
                lastQualifying = block.timestamp;
            } else {
                chainStart = 0;
                lastQualifying = 0;
            }
        }
        // The hook's own pending start can never precede the independently tracked chain start.
        if (
            now_ < 6 && hook.qualifyingSince(now_) != 0 && chainStart != 0
                && hook.qualifyingSince(now_) < chainStart
        ) {
            ++ghostDrift;
        }
        _observe();
    }

    /// @dev Steady five-minute sampling, the cadence an honest keeper would run, so tiers are reachable.
    function march(uint8 steps) external {
        uint256 count = bound(steps, 1, 80);
        for (uint256 i; i < count; ++i) {
            advance(5 minutes);
            sample();
        }
    }

    function _observe() private {
        uint8 tier = hook.tier();
        uint16 p = hook.p();
        bool unlocked = hook.fullyUnlocked();
        if (tier < lastTier || p < lastP || (wasUnlocked && !unlocked)) ++relocks;
        lastTier = tier;
        lastP = p;
        wasUnlocked = unlocked;
    }
}

/// forge-config: default.invariant.runs = 48
/// forge-config: default.invariant.depth = 40
/// forge-config: default.invariant.fail-on-revert = true
contract MilestoneSampleInvariantTest is SystemFixture {
    MilestoneSampleHandler internal handler;
    uint16[7] internal percentages = [uint16(2500), 3500, 4500, 5500, 7000, 8500, 10000];

    function setUp() public override {
        super.setUp();
        // Past the warm-up window with a liquid history, so valid samples exist from the first action.
        _advance(oracle.WINDOW());
        oracle.checkpoint();
        handler = new MilestoneSampleHandler(hook, oracle, feed);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = MilestoneSampleHandler.advance.selector;
        selectors[1] = MilestoneSampleHandler.setPrice.selector;
        selectors[2] = MilestoneSampleHandler.corrupt.selector;
        selectors[3] = MilestoneSampleHandler.heal.selector;
        selectors[4] = MilestoneSampleHandler.sample.selector;
        selectors[5] = MilestoneSampleHandler.march.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    /// @dev The handler's branches all execute: a tier is confirmed by healthy sampling, and every corruption
    /// mode produces samples the oracle refuses.
    function testHandlerReachesTiersAndEveryCorruptionIsInvalid() public {
        handler.setPrice(300_000);
        handler.march(80);
        assertEq(hook.tier(), 1, "healthy cadence did not confirm a tier");
        assertEq(handler.tierAdvances(), 1);
        for (uint8 mode = 1; mode <= 6; ++mode) {
            handler.heal();
            handler.advance(60);
            handler.sample();
            uint256 invalidBefore = handler.invalidSamples();
            handler.corrupt(mode);
            if (mode == 2) {
                // Six 20-minute steps without a refresh: two hours past the feed's 90-minute allowance.
                for (uint256 i; i < 6; ++i) {
                    handler.advance(1200);
                }
            }
            handler.sample();
            assertEq(handler.invalidSamples(), invalidBefore + 1, "corruption mode produced a valid sample");
        }
        handler.heal();
        handler.sample();
        assertEq(handler.advancesOnInvalid(), 0);
        assertEq(handler.advancesTooSoon(), 0);
        assertEq(handler.relocks(), 0);
        assertEq(handler.ghostDrift(), 0);
    }

    function invariant_invalidSamplesNeverAdvanceTiers() public view {
        assertEq(handler.advancesOnInvalid(), 0, "a tier advanced on an invalid oracle sample");
        assertEq(handler.advancesBelowThreshold(), 0, "a tier advanced below its FDV threshold");
    }

    function invariant_confirmationNeedsAnUnbrokenChainOfValidSamples() public view {
        assertEq(handler.advancesTooSoon(), 0, "a tier advanced without the required unbroken confirmation");
        assertEq(handler.multiStepAdvances(), 0, "more than one tier per confirmation");
        assertEq(handler.ghostDrift(), 0, "the hook's pending start precedes the valid-sample chain");
    }

    function invariant_nothingEverRelocksAndStateIsConsistent() public view {
        assertEq(handler.relocks(), 0, "tier, p or unlock went backwards");
        uint8 tier = hook.tier();
        assertLe(tier, 6);
        assertEq(hook.p(), percentages[tier]);
        assertEq(hook.fullyUnlocked(), tier == 6);
        if (tier < 6) {
            uint64 since = hook.qualifyingSince(tier);
            uint64 last = hook.lastConfirmation();
            assertEq(since == 0, last == 0, "pending start and last confirmation disagree");
            assertLe(since, last, "a confirmation before the pending start");
            assertLe(last, block.timestamp);
        }
    }
}

/// @notice Re-staging before activation abandons the previous bundle completely: mixed bundles are refused,
/// attestations on the abandoned evidence create no rights, and the abandoned router and oracle are inert.
contract RestagingIsolationTest is SystemFixture {
    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _deployCompanions();
    }

    function testAbandonedBundleIsInertAndMixedBundlesAreRefused() public {
        UnlkSwapRouter oldRouter = router;
        MerkleClaimEvidence oldRewards = rewards;
        UnlkOracle oldOracle = oracle;
        // A claim attested on the first bundle's evidence before it was abandoned.
        _advance(CONTRIBUTOR_LOCK + 1);
        _claimReward();
        _attestReward();
        assertEq(oldRewards.claimed(alice), REWARD);

        _deployCompanions();
        assertTrue(address(router) != address(oldRouter));
        assertTrue(address(rewards) != address(oldRewards));
        assertTrue(address(oracle) != address(oldOracle));

        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.configureAndActivate(address(oldRouter), rewards, oracle, LAUNCH_NUMBER);
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidEvidence.selector);
        hook.configureAndActivate(address(router), oldRewards, oracle, LAUNCH_NUMBER);
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.configureAndActivate(address(router), rewards, oldOracle, LAUNCH_NUMBER);
        assertFalse(hook.activated());

        _activate();
        assertEq(hook.router(), address(router));
        assertEq(address(hook.rewards()), address(rewards));
        assertEq(address(hook.oracle()), address(oracle));

        // The abandoned evidence's attestation is not credit; the activated evidence must prove the claim itself.
        assertEq(hook.pendingRewardCredit(alice), 0);
        assertEq(hook.syncRewards(alice), 0);
        assertEq(hook.eligible(alice), 0);
        assertEq(_attestReward(), REWARD);
        assertEq(hook.syncRewards(alice), REWARD);
        assertEq(hook.eligible(alice), REWARD);
        // Attesting again on either evidence adds nothing.
        vm.expectRevert(MerkleClaimEvidence.AlreadyAttested.selector);
        oldRewards.attest(0, alice, REWARD, new bytes32[](0));
        assertEq(hook.syncRewards(alice), 0);

        // The abandoned router is not the authenticated route.
        vm.prank(bob);
        vm.expectRevert();
        oldRouter.swap{value: 1 ether}(_request(true, -int256(1 ether), 1 ether));
        assertEq(hook.eligible(bob), 0);
        // The abandoned oracle can never be bound, by the hook or anyone else.
        vm.expectRevert(UnlkOracle.Unauthorized.selector);
        oldOracle.bind(key, address(token), seedLower, seedUpper);
        assertFalse(oldOracle.bound());
        // The activated route still works.
        assertGt(_buy(bob, 1 ether), 0);
    }
}
