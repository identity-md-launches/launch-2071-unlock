// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {UnlkHook} from "../src/UnlkHook.sol";
import {UnlkToken} from "../src/UnlkToken.sol";
import {UnlkOracle} from "../src/UnlkOracle.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {MerkleClaimEvidence} from "../src/MerkleClaimEvidence.sol";
import {MerkleDistributor} from "./imd/MerkleDistributor.sol";
import {LaunchFactory} from "./imd/LaunchFactory.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev OpenZeppelin StandardMerkleTree shape, which the verified distributor and the adapter both assume:
/// double-hashed `(account, amount)` leaves and sorted pairs.
library LocalMerkle {
    function leaf(address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}

/// @notice Claim evidence against a REAL four-leaf contributor tree: every other suite uses a one-leaf tree whose
/// proof is empty, so `MerkleProof.verifyCalldata` never ran with a sibling. Here each wallet's credit must equal
/// exactly what the distributor delivered to it, proven with its own path, and nothing else is accepted: a
/// sibling's proof, a sibling's amount, a reordered or truncated path, an unclaimed leaf, a foreign round.
contract MultiLeafEvidenceTest is SystemFixture {
    using stdStorage for StdStorage;

    address internal carol;
    address internal dave;
    uint256[4] internal amounts =
        [uint256(1_000_000 ether), 2_000_000 ether, 3_000_000 ether, 4_000_000 ether];
    bytes32[4] internal leaves;
    bytes32 internal n01;
    bytes32 internal n23;
    bytes32 internal root;

    function setUp() public override {
        _deploy(false);
        carol = makeAddr("local Carol");
        dave = makeAddr("local Dave");
        leaves[0] = LocalMerkle.leaf(alice, amounts[0]);
        leaves[1] = LocalMerkle.leaf(bob, amounts[1]);
        leaves[2] = LocalMerkle.leaf(carol, amounts[2]);
        leaves[3] = LocalMerkle.leaf(dave, amounts[3]);
        n01 = LocalMerkle.pair(leaves[0], leaves[1]);
        n23 = LocalMerkle.pair(leaves[2], leaves[3]);
        root = LocalMerkle.pair(n01, n23);

        int24 tick = -OPENING_TICK;
        (seedLower, seedUpper) = (LOWER, tick);
        uint160 sqrt = TickMath.getSqrtPriceAtTick(tick);
        seedLiquidity = _tokenOnlyLiquidity(UnlkToken(address(0)), sqrt);
        LaunchFactory.LaunchParams memory params = _launchParams(sqrt, seedLower, seedUpper, seedLiquidity);
        params.merkleRoot = root;
        (address t, address h, address d) = factory.launch(params);
        token = UnlkToken(t);
        hook = UnlkHook(h);
        distributor = MerkleDistributor(d);
        _localQuoteDepth(10000 ether);
        _deployCompanions();
    }

    function _certifyInitialRound() internal override {
        address[] memory accounts = new address[](4);
        uint256[] memory values = new uint256[](4);
        for (uint256 i; i < 4; ++i) {
            accounts[i] = _account(i);
            values[i] = amounts[i];
        }
        rewards.certifyRound(0, accounts, values);
    }

    function _proof(uint256 index) internal view returns (bytes32[] memory proof) {
        proof = new bytes32[](2);
        if (index == 0) (proof[0], proof[1]) = (leaves[1], n23);
        if (index == 1) (proof[0], proof[1]) = (leaves[0], n23);
        if (index == 2) (proof[0], proof[1]) = (leaves[3], n01);
        if (index == 3) (proof[0], proof[1]) = (leaves[2], n01);
    }

    function _account(uint256 index) internal view returns (address) {
        return [alice, bob, carol, dave][index];
    }

    function testTheTreeIsWellFormed() public view {
        assertEq(distributor.roundOf(0).root, root);
        assertEq(distributor.roundOf(0).funded, token.SWARM_ALLOCATION());
    }

    /// @dev A claim before activation, proven with its own path after activation, credits exactly the delivered
    /// amount; every wrong path, amount, account or round is refused, and the refusal leaves no credit behind.
    function testProofsFromTheActualTreeCreditExactlyWhatWasDelivered() public {
        _advance(CONTRIBUTOR_LOCK);
        distributor.claim(0, bob, amounts[1], _proof(1));
        assertEq(token.balanceOf(bob), amounts[1]);
        _activate();

        // Bob's claim with Alice's path, with Carol's amount, with a truncated path and with a reordered path.
        vm.expectRevert(MerkleClaimEvidence.InvalidProof.selector);
        rewards.attest(0, bob, amounts[1], _proof(0));
        vm.expectRevert(MerkleClaimEvidence.InvalidProof.selector);
        rewards.attest(0, bob, amounts[2], _proof(1));
        bytes32[] memory truncated = new bytes32[](1);
        truncated[0] = leaves[0];
        vm.expectRevert(MerkleClaimEvidence.InvalidProof.selector);
        rewards.attest(0, bob, amounts[1], truncated);
        bytes32[] memory reordered = new bytes32[](2);
        (reordered[0], reordered[1]) = (n23, leaves[0]);
        vm.expectRevert(MerkleClaimEvidence.InvalidProof.selector);
        rewards.attest(0, bob, amounts[1], reordered);
        // A valid leaf that was never claimed natively, and a round that does not exist.
        vm.expectRevert(MerkleClaimEvidence.NotClaimed.selector);
        rewards.attest(0, alice, amounts[0], _proof(0));
        vm.expectRevert(MerkleClaimEvidence.NotClaimed.selector);
        rewards.attest(7, bob, amounts[1], _proof(1));
        assertEq(rewards.claimed(bob), 0);
        assertEq(hook.syncRewards(bob), 0);
        assertEq(hook.eligible(bob), 0);

        // The real path, submitted by a stranger, credits Bob alone and exactly once.
        vm.prank(dave);
        assertEq(rewards.attest(0, bob, amounts[1], _proof(1)), amounts[1]);
        vm.expectRevert(MerkleClaimEvidence.AlreadyAttested.selector);
        rewards.attest(0, bob, amounts[1], _proof(1));
        assertEq(hook.syncRewards(bob), amounts[1]);
        assertEq(hook.eligible(bob), token.balanceOf(bob));
        assertEq(hook.eligible(alice) + hook.eligible(carol) + hook.eligible(dave), 0);
        assertEq(hook.remainingQuota(bob), amounts[1] / 4);

        // Every other leaf, claimed after activation, is credited for exactly its own amount.
        for (uint256 i; i < 4; ++i) {
            if (i == 1) continue;
            distributor.claim(0, _account(i), amounts[i], _proof(i));
            rewards.attest(0, _account(i), amounts[i], _proof(i));
            assertEq(hook.syncRewards(_account(i)), amounts[i]);
            assertEq(hook.eligible(_account(i)), token.balanceOf(_account(i)));
        }
        assertEq(distributor.roundOf(0).claimed, amounts[0] + amounts[1] + amounts[2] + amounts[3]);
    }

    /// @dev A tree with a sibling at the same amount: the leaf is still bound to the account, so the sibling's
    /// claim cannot be attested for another wallet, whoever submits it.
    function testSiblingCannotAttestAnotherWalletsClaim() public {
        _advance(CONTRIBUTOR_LOCK);
        _activate();
        distributor.claim(0, carol, amounts[2], _proof(2));
        vm.prank(dave);
        vm.expectRevert(MerkleClaimEvidence.NotClaimed.selector);
        rewards.attest(0, dave, amounts[2], _proof(2));
        vm.prank(dave);
        vm.expectRevert(MerkleClaimEvidence.NotClaimed.selector);
        rewards.attest(0, dave, amounts[3], _proof(3));
        assertEq(rewards.claimed(dave), 0);
        assertEq(hook.syncRewards(dave), 0);
        assertEq(hook.eligible(dave), 0);
    }

    /// @dev Once the treasury sweeps the round, a leaf that was never claimed can no longer be claimed, so it can
    /// never be attested; a claim made before the sweep stays provable. The sweep itself creates no credit.
    function testSweptRoundFreezesEvidence() public {
        _advance(CONTRIBUTOR_LOCK);
        distributor.claim(0, alice, amounts[0], _proof(0));
        _activate();
        _advance(SWEEP_DELAY);
        uint256 treasuryBefore = token.balanceOf(imd);
        uint256 swept = distributor.sweep(0);
        assertEq(swept, token.SWARM_ALLOCATION() - amounts[0]);
        assertEq(token.balanceOf(imd), treasuryBefore + swept);
        vm.expectRevert(MerkleDistributor.RoundClosed.selector);
        distributor.claim(0, bob, amounts[1], _proof(1));
        vm.expectRevert(MerkleClaimEvidence.NotClaimed.selector);
        rewards.attest(0, bob, amounts[1], _proof(1));
        rewards.attest(0, alice, amounts[0], _proof(0));
        assertEq(hook.syncRewards(alice), amounts[0]);
        assertEq(hook.eligible(alice), amounts[0]);
        assertEq(hook.eligible(imd), 0, "the treasury's sweep is not a claim");
        assertEq(hook.syncRewards(imd), 0);
    }

    /// @dev Even a corrupted dependency cannot revoke rights already synchronized from a real native claim.
    function testDecreasingEvidenceCannotRevokePreviouslyCreditedClaims() public {
        _activate();
        _advance(CONTRIBUTOR_LOCK);
        distributor.claim(0, alice, amounts[0], _proof(0));
        rewards.attest(0, alice, amounts[0], _proof(0));
        assertEq(hook.syncRewards(alice), amounts[0]);
        stdstore.target(address(rewards))
            .sig(rewards.claimed.selector)
            .with_key(alice)
            .checked_write(uint256(0));
        vm.expectRevert(UnlkHook.InvalidEvidence.selector);
        hook.pendingRewardCredit(alice);
        vm.expectRevert(UnlkHook.InvalidEvidence.selector);
        hook.syncRewards(alice);
        assertEq(hook.eligible(alice), amounts[0]);
        assertEq(hook.claimedCredit(alice), amounts[0]);
    }
}

/// @notice The oracle's binary-search TWAP, checked against a brute-force integration of its own observation
/// log under random trade and time sequences. The illiquid case must revert exactly when the reference says
/// a bad second is in the window; a separate regression injects a locked-position depth dip.
contract OracleReferenceTest is SystemFixture {
    using StateLibrary for IPoolManager;

    uint256 internal constant WINDOW = 2 hours;

    struct Obs {
        uint64 time;
        int24 tick;
        bool liquid;
    }

    function _observations() internal view returns (Obs[] memory list) {
        uint256 n = oracle.observationCount();
        list = new Obs[](n);
        for (uint256 i; i < n; ++i) {
            (uint64 time, int24 tick, bool liquid,,) = oracle.observations(i);
            list[i] = Obs(time, tick, liquid);
        }
    }

    /// @dev Integrates the pool tick in force over [now - WINDOW, now] from the raw observation log, negates it
    /// (UNLK is currency1, the TWAP is ETH per UNLK) and floors. `bad` is the oracle's own validity rule.
    function _referenceTwap() internal view returns (int24 tick, bool bad, int24 lowest, int24 highest) {
        Obs[] memory list = _observations();
        uint256 n = list.length;
        uint256 cutoff = block.timestamp - WINDOW;
        int256 sum;
        lowest = type(int24).max;
        highest = type(int24).min;
        for (uint256 i; i < n; ++i) {
            uint256 start = Math.max(list[i].time, cutoff);
            uint256 end = Math.min(i + 1 < n ? list[i + 1].time : block.timestamp, block.timestamp);
            if (end <= start) continue;
            sum += int256(list[i].tick) * int256(end - start);
            if (!list[i].liquid) bad = true;
            if (list[i].tick < lowest) lowest = list[i].tick;
            if (list[i].tick > highest) highest = list[i].tick;
        }
        if (list[0].time > cutoff) bad = true;
        if (block.timestamp - list[n - 1].time > 5 minutes || !list[n - 1].liquid) bad = true;
        int256 diff = -sum;
        int256 mean = diff / int256(WINDOW);
        if (mean * int256(WINDOW) > diff) --mean;
        tick = int24(mean);
    }

    /// forge-config: default.fuzz.runs = 160
    function testFuzzTwapMatchesBruteForceReference(uint256 seed) public {
        // Vary the price and resulting ETH reserves without imposing a cash-reserve floor.
        _localWarmUpBuy(bound(seed, 8 ether, 14 ether));
        _advance(WINDOW);
        oracle.checkpoint();
        uint256 steps = 4 + (seed % 6);
        for (uint256 i; i < steps; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            _advance(1 + (r % 300));
            uint8 action = uint8(r >> 8) % 4;
            if (action == 0 || action == 1) {
                _buy(alice, 1e15 + ((r >> 16) % 2 ether));
            } else if (action == 2) {
                uint256 limit = Math.min(token.balanceOf(alice), hook.remainingQuota(alice));
                if (limit >= 1e12) _sell(alice, 1e12 + ((r >> 16) % (limit - 1e12 + 1)));
                else oracle.checkpoint();
            } else {
                oracle.checkpoint();
            }
        }
        (int24 expected, bool bad, int24 lowest, int24 highest) = _referenceTwap();
        if (bad) {
            vm.expectRevert(UnlkOracle.InvalidOracle.selector);
            oracle.twapTick();
            vm.expectRevert(UnlkOracle.InvalidOracle.selector);
            oracle.fdvUsd();
            assertFalse(hook.updateMilestone(), "invalid data must not progress a tier");
            return;
        }
        int24 actual = oracle.twapTick();
        assertEq(actual, expected, "binary-search TWAP disagrees with the brute-force integral");
        // The average of ETH-per-UNLK ticks lies between the extremes observed in the window (floor rounding
        // may land one tick below the negated highest pool tick).
        assertLe(actual, -lowest);
        assertGe(actual, -highest - 1);
        assertGt(oracle.fdvUsd(), 0);
    }

    /// forge-config: default.fuzz.runs = 256
    function testFuzzFdvIsMonotonicInTheEthUsdAnswer(uint64 a, uint64 b) public {
        _localWarmUpBuy(12 ether);
        _advance(WINDOW);
        oracle.checkpoint();
        uint256 lo = bound(uint256(a), 1, 1_000_000e8);
        uint256 hi = bound(uint256(b), lo, 1_000_000e8);
        feed.set(int256(lo));
        uint256 fdvLo = oracle.fdvUsd();
        feed.set(int256(hi));
        uint256 fdvHi = oracle.fdvUsd();
        assertLe(fdvLo, fdvHi);
        assertEq(hook.tierForFdv(fdvLo) <= hook.tierForFdv(fdvHi), true);
        // The fixed $1M/ETH sanity ceiling is the last accepted answer.
        feed.set(int256(1_000_000e8) + 1);
        vm.expectRevert(UnlkOracle.InvalidOracle.selector);
        oracle.fdvUsd();
    }

    /// @dev A same-block replacement updates the tick in force from that timestamp onward, never the past.
    function testCheckpointReplacementRewritesOnlyTheCurrentSecond() public {
        _localWarmUpBuy(12 ether);
        _advance(WINDOW);
        oracle.checkpoint();
        uint256 count = oracle.observationCount();
        (, int24 before,,,) = oracle.observations(count - 1);
        _buy(bob, 3 ether);
        assertEq(oracle.observationCount(), count, "same second: replaced, not appended");
        (, int24 after_,,,) = oracle.observations(count - 1);
        assertTrue(after_ != before, "the replacement carries the post-trade tick");
        (int24 expected,,,) = _referenceTwap();
        assertEq(oracle.twapTick(), expected);
    }
}

/// @notice Router boundaries the fixtures never hit: a deadline that is exactly now, and one second later.
contract RouterDeadlineTest is SystemFixture {
    function testDeadlineIsInclusive() public {
        UnlkSwapRouter.SwapRequest memory r = _request(true, -1 ether, 1 ether);
        r.deadline = block.timestamp;
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (, uint256 output) = router.swap{value: 1 ether}(r);
        assertGt(output, 0);
        assertEq(hook.eligible(alice), output);
        vm.warp(block.timestamp + 1);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(UnlkSwapRouter.InvalidSwap.selector);
        router.swap{value: 1 ether}(r);
        assertEq(hook.eligible(alice), output);
    }
}
