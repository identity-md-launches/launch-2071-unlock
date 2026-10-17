// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {MerkleDistributor} from "./imd/MerkleDistributor.sol";
import {UnlkHook} from "src/UnlkHook.sol";
import {UnlkToken} from "src/UnlkToken.sol";
import {MerkleClaimEvidence} from "src/MerkleClaimEvidence.sol";

/// @notice A model of deliveries, certifications and sweeps maintained from successful public actions.
/// Amount ghosts come from the generated allocations and recipient balance changes, not from the
/// adapter's `claimed` or the hook's `eligible` counters. Unexpected reverts fail this campaign.
contract ClaimLifecycleHandler is Test {
    UnlkHook public immutable hook;
    UnlkToken public immutable token;
    MerkleDistributor public immutable distributor;
    MerkleClaimEvidence public immutable evidence;
    address[4] public actors;
    address public immutable payer;
    address public immutable treasury;
    uint256 public immutable sweepDelay;

    struct RoundModel {
        uint256 funded;
        uint256 paid;
        uint256 sweepable;
        uint256 unlocks;
        bool closed;
        bool certified;
        address[] recipients;
        uint256[] amounts;
        bool[] delivered;
        bool[] attested;
    }

    RoundModel[] private rounds;
    mapping(address => uint256) public delivered;
    mapping(address => uint256) public attested;
    mapping(address => uint256) public synced;
    uint256 public fundedAndDonated;
    uint256 public totalDelivered;
    uint256 public totalSwept;
    bool public payerSynced;
    uint256 public successfulClaims;
    uint256 public successfulAttestations;
    uint256 public successfulSweeps;
    uint256 public failedClaims;
    uint256 public failedAttestations;

    constructor(UnlkHook h, MerkleDistributor d, MerkleClaimEvidence e, address[4] memory a) {
        hook = h;
        token = h.token();
        distributor = d;
        evidence = e;
        actors = a;
        payer = a[2];
        treasury = a[3];
        sweepDelay = d.sweepDelay();
        // The actual launch funds 100M tokens; its one-leaf tree allocates 1M to Alice.
        // Unallocated funding must remain reserved until the native sweep is eligible.
        RoundModel storage r = rounds.push();
        r.funded = 100_000_000 ether;
        r.unlocks = d.roundOf(0).unlocksAt;
        r.sweepable = uint256(d.openedAt(0)) + sweepDelay;
        r.certified = true;
        r.recipients.push(a[0]);
        r.amounts.push(1_000_000 ether);
        r.delivered.push(false);
        r.attested.push(false);
        fundedAndDonated = r.funded;
    }

    function roundCount() external view returns (uint256) {
        return rounds.length;
    }

    function openRound(uint96 amountSeed, uint8 leavesSeed, uint32 lockSeed) external {
        if (rounds.length == 8) return;
        uint256 balance = token.balanceOf(payer);
        if (balance < 4) return;
        uint256 funded = bound(amountSeed, 4, balance < 1_000_000 ether ? balance : 1_000_000 ether);
        uint256 n = bound(leavesSeed, 1, 4);
        uint64 duration = uint64(bound(lockSeed, 0, 2 days));
        uint256 number = rounds.length;
        RoundModel storage r = rounds.push();
        r.funded = funded;
        r.unlocks = block.timestamp + duration;
        r.sweepable = block.timestamp + sweepDelay;
        for (uint256 i; i < n; ++i) {
            r.recipients.push(actors[(i + number) % 4]);
            r.amounts.push(funded / n + (i == 0 ? funded % n : 0));
            r.delivered.push(false);
            r.attested.push(false);
        }
        vm.prank(payer);
        token.transfer(address(distributor), funded);
        fundedAndDonated += funded;
        bytes32[] memory tree = _tree(r);
        vm.prank(treasury);
        assertEq(distributor.openRound(tree[0], funded, duration), number);
    }

    function certify(uint256 roundSeed, uint8 corruption) external {
        uint256 number = roundSeed % rounds.length;
        RoundModel storage r = rounds[number];
        address[] memory accounts = r.recipients;
        uint256[] memory amounts = r.amounts;
        uint256 mode = uint256(corruption) % 4;
        bytes4 expected;
        if (mode == 1) {
            amounts[0] += 1;
            expected = MerkleClaimEvidence.InvalidProof.selector;
        } else if (mode == 2) {
            if (accounts.length == 1) {
                accounts[0] = address(0);
                expected = MerkleClaimEvidence.InvalidConfig.selector;
            } else {
                accounts[1] = accounts[0];
                expected = MerkleClaimEvidence.DuplicateRecipient.selector;
            }
        } else if (mode == 3) {
            // Empty or incomplete trees cannot certify a different complete root.
            address[] memory shortAccounts = new address[](accounts.length - 1);
            uint256[] memory shortAmounts = new uint256[](accounts.length - 1);
            for (uint256 i; i < shortAccounts.length; ++i) {
                shortAccounts[i] = accounts[i];
                shortAmounts[i] = amounts[i];
            }
            accounts = shortAccounts;
            amounts = shortAmounts;
            expected = accounts.length == 0
                ? MerkleClaimEvidence.InvalidConfig.selector
                : MerkleClaimEvidence.InvalidProof.selector;
        }
        if (r.certified) expected = MerkleClaimEvidence.InvalidConfig.selector;
        if (expected != bytes4(0)) {
            vm.expectRevert(expected);
            evidence.certifyRound(number, accounts, amounts);
        } else {
            evidence.certifyRound(number, accounts, amounts);
            r.certified = true;
        }
    }

    function claim(uint256 roundSeed, uint256 leafSeed, bool corrupt) external {
        uint256 number = roundSeed % rounds.length;
        RoundModel storage r = rounds[number];
        uint256 index = leafSeed % r.recipients.length;
        address recipient = r.recipients[index];
        uint256 amount = r.amounts[index] + (corrupt ? 1 : 0);
        bytes32[] memory proof = _proof(r, index);
        bytes memory expected;
        if (r.closed) {
            expected = abi.encodeWithSelector(MerkleDistributor.RoundClosed.selector);
        } else if (block.timestamp < r.unlocks) {
            expected = abi.encodeWithSelector(MerkleDistributor.StillLocked.selector, uint64(r.unlocks));
        } else if (r.delivered[index]) {
            expected = abi.encodeWithSelector(MerkleDistributor.AlreadyClaimed.selector);
        } else if (corrupt) {
            expected = abi.encodeWithSelector(MerkleDistributor.InvalidProof.selector);
        }
        uint256 recipientBefore = token.balanceOf(recipient);
        uint256 distributorBefore = token.balanceOf(address(distributor));
        vm.prank(actors[(index + 1) % 4]); // permissionless submission must still pay the leaf's recipient
        if (expected.length != 0) {
            vm.expectRevert(expected);
            distributor.claim(number, recipient, amount, proof);
            assertEq(token.balanceOf(recipient), recipientBefore);
            assertEq(token.balanceOf(address(distributor)), distributorBefore);
            ++failedClaims;
        } else {
            distributor.claim(number, recipient, amount, proof);
            assertEq(token.balanceOf(recipient) - recipientBefore, amount);
            assertEq(distributorBefore - token.balanceOf(address(distributor)), amount);
            r.paid += amount;
            r.delivered[index] = true;
            delivered[recipient] += amount;
            totalDelivered += amount;
            ++successfulClaims;
        }
    }

    function attest(uint256 roundSeed, uint256 leafSeed, bool corrupt) external {
        uint256 number = roundSeed % rounds.length;
        RoundModel storage r = rounds[number];
        uint256 index = leafSeed % r.recipients.length;
        address recipient = r.recipients[index];
        uint256 amount = r.amounts[index] + (corrupt ? 1 : 0);
        bytes32[] memory proof = _proof(r, index);
        bytes4 expected;
        if (r.attested[index]) expected = MerkleClaimEvidence.AlreadyAttested.selector;
        else if (!r.delivered[index]) expected = MerkleClaimEvidence.NotClaimed.selector;
        else if (!r.certified) expected = MerkleClaimEvidence.UncertifiedRound.selector;
        else if (corrupt) expected = MerkleClaimEvidence.InvalidProof.selector;
        if (expected != bytes4(0)) {
            vm.expectRevert(expected);
            evidence.attest(number, recipient, amount, proof);
            ++failedAttestations;
        } else {
            assertEq(evidence.attest(number, recipient, amount, proof), amount);
            r.attested[index] = true;
            attested[recipient] += amount;
            ++successfulAttestations;
        }
    }

    function sync(uint256 actorSeed) external {
        address actor = actors[actorSeed % 4];
        uint256 expected = attested[actor] - synced[actor];
        assertEq(hook.pendingRewardCredit(actor), expected);
        assertEq(hook.syncRewards(actor), expected);
        synced[actor] += expected;
    }

    function syncPayer() external {
        assertEq(hook.syncPayer(), payerSynced ? 0 : 30_000_000 ether);
        payerSynced = true;
    }

    /// @dev Keep a frequent complete path alongside independently shuffled steps. Each step still
    /// checks its exact failure when the chosen round is locked, closed or already processed.
    function deliverAndSync(uint256 roundSeed, uint256 leafSeed) external {
        RoundModel storage r = rounds[roundSeed % rounds.length];
        address recipient = r.recipients[leafSeed % r.recipients.length];
        this.certify(roundSeed, 0);
        this.claim(roundSeed, leafSeed, false);
        this.attest(roundSeed, leafSeed, false);
        for (uint256 i; i < actors.length; ++i) {
            if (actors[i] == recipient) this.sync(i);
        }
    }

    function sweep(uint256 roundSeed) external {
        uint256 number = roundSeed % rounds.length;
        RoundModel storage r = rounds[number];
        uint256 deadline = r.sweepable > r.unlocks ? r.sweepable : r.unlocks;
        if (r.closed) {
            vm.expectRevert(MerkleDistributor.RoundClosed.selector);
            distributor.sweep(number);
        } else if (block.timestamp < deadline) {
            vm.expectRevert(
                abi.encodeWithSelector(MerkleDistributor.SweepTooEarly.selector, uint64(deadline))
            );
            distributor.sweep(number);
        } else {
            uint256 amount = r.funded - r.paid;
            uint256 beforeBalance = token.balanceOf(treasury);
            assertEq(distributor.sweep(number), amount);
            assertEq(token.balanceOf(treasury), beforeBalance + amount);
            totalSwept += amount;
            r.closed = true;
            ++successfulSweeps;
        }
    }

    function transferOrDonate(uint256 fromSeed, uint256 toSeed, uint96 amountSeed) external {
        address from = actors[fromSeed % 4];
        uint256 toIndex = toSeed % 5;
        address to = toIndex == 4 ? address(distributor) : actors[toIndex];
        uint256 amount = bound(amountSeed, 0, token.balanceOf(from));
        vm.prank(from);
        token.transfer(to, amount);
        if (toIndex == 4) fundedAndDonated += amount;
    }

    function advance(uint8 durationSeed) external {
        uint256[6] memory durations = [uint256(0), 1, 1 hours, 2 days, 365 days - 1, 365 days];
        vm.warp(block.timestamp + durations[durationSeed % 6]);
        vm.roll(block.number + 1);
    }

    function unauthorizedRound(uint96 amountSeed) external {
        uint256 count = distributor.roundCount();
        uint256 reserves = distributor.reserved();
        vm.prank(actors[0]);
        vm.expectRevert(MerkleDistributor.NotOpener.selector);
        distributor.openRound(bytes32(uint256(1)), amountSeed, 0);
        assertEq(distributor.roundCount(), count);
        assertEq(distributor.reserved(), reserves);
    }

    function assertRoundAccounting() external view {
        uint256 owed;
        assertEq(distributor.roundCount(), rounds.length);
        for (uint256 i; i < rounds.length; ++i) {
            RoundModel storage r = rounds[i];
            MerkleDistributor.Round memory actual = distributor.roundOf(i);
            assertEq(actual.funded, r.funded);
            assertEq(actual.claimed, r.paid);
            assertEq(actual.unlocksAt, r.unlocks);
            assertEq(distributor.swept(i), r.closed);
            assertEq(evidence.certified(i), r.certified);
            if (!r.closed) owed += r.funded - r.paid;
            for (uint256 j; j < r.recipients.length; ++j) {
                assertEq(distributor.claimed(i, r.recipients[j]), r.delivered[j]);
                assertEq(evidence.attested(i, r.recipients[j]), r.attested[j]);
            }
        }
        assertEq(distributor.reserved(), owed, "open-round obligations are conserved");
        assertGe(token.balanceOf(address(distributor)), owed, "native claims remain solvent");
        assertEq(
            token.balanceOf(address(distributor)) + totalDelivered + totalSwept,
            fundedAndDonated,
            "donations, claims and sweeps must reconcile to actual funding"
        );
    }

    function _tree(RoundModel storage r) private view returns (bytes32[] memory nodes) {
        uint256 n = r.recipients.length;
        nodes = new bytes32[](2 * n - 1);
        for (uint256 i; i < n; ++i) {
            nodes[n - 1 + i] = keccak256(bytes.concat(keccak256(abi.encode(r.recipients[i], r.amounts[i]))));
        }
        for (uint256 i = n - 1; i != 0;) {
            --i;
            bytes32 a = nodes[2 * i + 1];
            bytes32 b = nodes[2 * i + 2];
            nodes[i] = a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
        }
    }

    function _proof(RoundModel storage r, uint256 leaf) private view returns (bytes32[] memory proof) {
        bytes32[] memory nodes = _tree(r);
        uint256 index = r.recipients.length - 1 + leaf;
        uint256 depth;
        for (uint256 cursor = index; cursor != 0; cursor = (cursor - 1) / 2) {
            ++depth;
        }
        proof = new bytes32[](depth);
        for (uint256 i; index != 0; ++i) {
            proof[i] = nodes[index % 2 == 0 ? index - 1 : index + 1];
            index = (index - 1) / 2;
        }
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 80
/// forge-config: default.invariant.fail-on-revert = true
contract ClaimLifecycleInvariantsTest is SystemFixture {
    ClaimLifecycleHandler internal handler;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _deployCompanions();
        _activate();
        handler = new ClaimLifecycleHandler(hook, distributor, rewards, [alice, bob, payer, imd]);
        // Overlapping recipients and odd trees exist from the start of every sequence.
        handler.openRound(600 ether, 3, 0);
        handler.openRound(1000 ether, 4, 3600);
        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = handler.openRound.selector;
        selectors[1] = handler.certify.selector;
        selectors[2] = handler.claim.selector;
        selectors[3] = handler.attest.selector;
        selectors[4] = handler.sync.selector;
        selectors[5] = handler.syncPayer.selector;
        selectors[6] = handler.sweep.selector;
        selectors[7] = handler.transferOrDonate.selector;
        selectors[8] = handler.advance.selector;
        selectors[9] = handler.unauthorizedRound.selector;
        selectors[10] = handler.deliverAndSync.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_DistributorReservesAndCashMatchIndependentRoundModel() public view {
        handler.assertRoundAccounting();
    }

    function invariant_OnlyDeliveredAttestedAndSyncedClaimsCreateRights() public view {
        address[4] memory accounts = [alice, bob, payer, imd];
        for (uint256 i; i < accounts.length; ++i) {
            address account = accounts[i];
            assertLe(handler.synced(account), handler.attested(account));
            assertLe(handler.attested(account), handler.delivered(account));
            assertEq(rewards.claimed(account), handler.attested(account));
            assertEq(hook.claimedCredit(account), handler.synced(account));
            uint256 expected = handler.synced(account);
            if (account == payer && handler.payerSynced()) expected += 30_000_000 ether;
            assertEq(hook.eligible(account), expected, "ordinary transfers or sweeps created credit");
            assertEq(hook.sold(account), 0);
            assertEq(hook.remainingQuota(account), expected / 4);
        }
    }

    function invariant_FixedSupplyAndInitialReceiptsSurviveAllClaimSequences() public view {
        uint256 sum = token.balanceOf(address(manager)) + token.balanceOf(address(distributor))
            + token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(payer) + token.balanceOf(imd);
        assertEq(sum, 1_000_000_000 ether);
        assertEq(token.totalSupply(), sum);
        assertEq(token.initialAllocation(address(distributor)), 100_000_000 ether);
        assertEq(token.initialRecipient(), payer);
        assertTrue(token.distributionComplete());
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(token.balanceOf(address(rewards)), 0);
        assertEq(token.balanceOf(address(factory)), 0);
    }

    function test_ModelExercisesDelayedCertificationSweepsAndRecycledFunding() public {
        handler.claim(0, 0, false); // still locked
        handler.claim(1, 0, false); // Bob's real delivery, before certification
        handler.attest(1, 0, false); // uncertified
        handler.certify(1, 2); // duplicate recipient
        handler.certify(1, 1); // wrong amount
        handler.certify(1, 3); // incomplete tree
        handler.certify(1, 0);
        handler.attest(1, 0, true); // wrong proof
        handler.attest(1, 0, false);
        handler.attest(1, 0, false); // replay
        handler.sync(1);
        handler.sync(1); // idempotent
        handler.advance(2); // one hour: rounds 0 and 2 unlock
        handler.claim(0, 0, false);
        handler.claim(2, 2, false); // Alice also receives a later-round claim
        handler.certify(2, 0);
        handler.sweep(1); // too early
        handler.advance(5); // one year, no wall-clock waiting
        handler.sweep(0);
        handler.sweep(1);
        handler.sweep(2);
        handler.attest(0, 0, false); // a past delivery stays provable after sweeping
        handler.attest(2, 2, false);
        handler.sync(0);
        handler.syncPayer();
        handler.claim(1, 1, false); // swept allocations are no longer claimable
        handler.transferOrDonate(1, 4, 100 ether); // donation gives no recipient credit
        handler.openRound(30 ether, 3, 0);
        handler.claim(3, 1, false);
        handler.certify(3, 0);
        handler.attest(3, 1, false);
        handler.sync(0);
        assertEq(handler.successfulClaims(), 4);
        assertEq(handler.successfulAttestations(), 4);
        assertEq(handler.successfulSweeps(), 3);
        assertEq(handler.failedClaims(), 2);
        assertEq(handler.failedAttestations(), 3);
        invariant_DistributorReservesAndCashMatchIndependentRoundModel();
        invariant_OnlyDeliveredAttestedAndSyncedClaimsCreateRights();
        invariant_FixedSupplyAndInitialReceiptsSurviveAllClaimSequences();
    }
}
