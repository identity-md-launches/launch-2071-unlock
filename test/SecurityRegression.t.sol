// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {UnlkHook} from "../src/UnlkHook.sol";
import {UnlkOracle} from "../src/UnlkOracle.sol";
import {MerkleClaimEvidence} from "../src/MerkleClaimEvidence.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";

contract CodeAuthenticationRegressionTest is SystemFixture {
    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _deployCompanions();
    }

    function _refused() internal {
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.configureAndActivate(address(router), rewards, oracle, LAUNCH_NUMBER);
        assertFalse(hook.activated());
        assertFalse(oracle.bound());
    }

    function testRuntimeMutationCannotPassGetterChecks() public {
        bytes memory runtime = address(router).code;
        runtime[runtime.length - 1] = bytes1(uint8(runtime[runtime.length - 1]) ^ 1);
        vm.etch(address(router), runtime);
        // All function selectors and bindings remain intact; the reviewed runtime check still refuses it.
        assertEq(address(router.hook()), address(hook));
        _refused();
    }

    function testInconsistentImmutablePatchesAreRejected() public {
        bytes memory runtime = address(router).code;
        bytes32 expected = bytes32(uint256(uint160(address(manager))));
        uint256 occurrence;
        uint256 count;
        for (uint256 i; i + 32 <= runtime.length; ++i) {
            bytes32 word;
            assembly ("memory-safe") { word := mload(add(add(runtime, 32), i)) }
            if (word == expected) {
                occurrence = i;
                ++count;
            }
        }
        assertGt(count, 1);
        // This is a compiler-declared immutable word, normally excluded by naive runtime comparisons.
        runtime[occurrence + 31] = bytes1(uint8(runtime[occurrence + 31]) ^ 1);
        vm.etch(address(router), runtime);
        _refused();
    }

    function testActivationExternalFailureRollsBackEveryBinding() public {
        vm.mockCallRevert(
            address(oracle),
            abi.encodeWithSelector(oracle.checkpoint.selector),
            abi.encodeWithSelector(UnlkOracle.InvalidOracle.selector)
        );
        vm.prank(owner);
        vm.expectRevert(UnlkOracle.InvalidOracle.selector);
        hook.configureAndActivate(address(router), rewards, oracle, LAUNCH_NUMBER);
        assertFalse(hook.activated());
        assertFalse(oracle.bound());
        assertEq(hook.router(), address(0));
        assertEq(hook.swarm(), address(0));
        vm.clearMockedCalls();
        _activate();
        assertTrue(hook.activated());
    }

    function testLaterFactoryDonationsCannotRewriteInitialAllocationReceipts() public {
        address recipient = token.initialRecipient();
        uint256 receipt = token.initialAllocation(recipient);
        vm.prank(payer);
        token.transfer(address(factory), 1 ether);
        vm.prank(address(factory));
        token.transfer(bob, 1 ether);
        assertEq(token.initialRecipient(), recipient);
        assertEq(token.initialAllocation(recipient), receipt);
        assertEq(token.initialAllocation(bob), 0);
        _activate();
        hook.syncPayer();
        assertEq(hook.eligible(bob), 0);
    }
}

contract EvidenceCertificationRegressionTest is SystemFixture {
    function testActualLaterRoundClaimsHaveNoArtificialCumulativeCeiling() public {
        uint256 amount = token.SWARM_ALLOCATION();
        _buy(bob, 100 ether);
        vm.prank(bob);
        token.transfer(address(distributor), amount);
        bytes32 root = keccak256(bytes.concat(keccak256(abi.encode(alice, amount))));
        for (uint256 round = 1; round <= 2; ++round) {
            vm.prank(imd);
            distributor.openRound(root, amount, 0);
            _certifySingle(rewards, round, alice, amount);
            distributor.claim(round, alice, amount, new bytes32[](0));
            rewards.attest(round, alice, amount, new bytes32[](0));
            assertEq(hook.syncRewards(alice), amount);
            assertEq(hook.syncRewards(alice), 0);
            if (round == 1) {
                vm.prank(alice);
                token.transfer(address(distributor), amount);
            }
        }
        assertEq(hook.eligible(alice), 2 * amount);
        assertEq(hook.claimedCredit(alice), 2 * amount);
        assertEq(token.balanceOf(alice), amount);
    }

    function testDuplicateRecipientCannotOvercreditSmallerActualClaim() public {
        bytes32 small = keccak256(bytes.concat(keccak256(abi.encode(alice, 1 ether))));
        bytes32 big = keccak256(bytes.concat(keccak256(abi.encode(alice, 2 ether))));
        bytes32 root = Hashes.commutativeKeccak256(small, big);
        vm.prank(payer);
        token.transfer(address(distributor), 3 ether);
        vm.prank(imd);
        distributor.openRound(root, 3 ether, 0);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = big;
        distributor.claim(1, alice, 1 ether, proof);
        address[] memory accounts = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        accounts[0] = alice;
        accounts[1] = alice;
        amounts[0] = 1 ether;
        amounts[1] = 2 ether;
        vm.expectRevert(MerkleClaimEvidence.DuplicateRecipient.selector);
        rewards.certifyRound(1, accounts, amounts);
        proof[0] = small;
        vm.expectRevert(MerkleClaimEvidence.UncertifiedRound.selector);
        rewards.attest(1, alice, 2 ether, proof);
        assertEq(token.balanceOf(alice), 1 ether, "native claim remains independent");
        assertEq(hook.syncRewards(alice), 0);
    }

    function testIncompleteTreeCannotBeCertified() public {
        address[] memory accounts = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        accounts[0] = bob;
        amounts[0] = REWARD;
        MerkleClaimEvidence candidate = new MerkleClaimEvidence(rewards.merkleDistributor(), address(token));
        vm.expectRevert(MerkleClaimEvidence.InvalidProof.selector);
        candidate.certifyRound(0, accounts, amounts);
        assertFalse(candidate.certified(0));
    }

    function testOddTreeReconstructionAndPreCertificationNativeClaim() public {
        address[] memory accounts = new address[](3);
        uint256[] memory amounts = new uint256[](3);
        accounts[0] = alice;
        accounts[1] = bob;
        accounts[2] = payer;
        amounts[0] = 1 ether;
        amounts[1] = 2 ether;
        amounts[2] = 3 ether;
        bytes32 a = keccak256(bytes.concat(keccak256(abi.encode(alice, 1 ether))));
        bytes32 b = keccak256(bytes.concat(keccak256(abi.encode(bob, 2 ether))));
        bytes32 c = keccak256(bytes.concat(keccak256(abi.encode(payer, 3 ether))));
        bytes32 root = Hashes.commutativeKeccak256(Hashes.commutativeKeccak256(b, c), a);
        vm.prank(payer);
        token.transfer(address(distributor), 6 ether);
        vm.prank(imd);
        distributor.openRound(root, 6 ether, 0);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = Hashes.commutativeKeccak256(b, c);
        distributor.claim(1, alice, 1 ether, proof);
        rewards.certifyRound(1, accounts, amounts);
        rewards.attest(1, alice, 1 ether, proof);
        assertEq(hook.syncRewards(alice), 1 ether);
    }
}

contract OracleOutageRegressionTest is SystemFixture {
    function testNextTierClockWaitsForItsOwnThreshold() public {
        _localWarmUpBuy(12 ether);
        _confirm();
        assertEq(hook.tier(), 1);
        assertLt(oracle.fdvUsd(), 250_000 ether);
        assertEq(hook.qualifyingSince(1), 0, "higher threshold not yet observed");
        _advance(5 minutes);
        feed.set(6000e8);
        assertGt(oracle.fdvUsd(), 250_000 ether);
        hook.updateMilestone();
        assertEq(hook.qualifyingSince(1), block.timestamp, "new threshold starts its own clock");
        assertEq(hook.tier(), 1);
    }

    function testDepthDipInvalidatesWholeWindowAndRetainsReachedRights() public {
        _localWarmUpBuy(12 ether);
        _confirm();
        assertEq(hook.tier(), 1);
        bytes32 poolSlot = keccak256(abi.encode(PoolId.unwrap(hook.poolId()), uint256(6)));
        bytes32 position = keccak256(abi.encodePacked(address(factory), seedLower, seedUpper, bytes32(0)));
        bytes32 slot = keccak256(abi.encode(position, uint256(poolSlot) + 6));
        bytes32 original = vm.load(address(manager), slot);
        vm.store(address(manager), slot, bytes32(uint256(seedLiquidity / 2)));
        oracle.checkpoint();
        assertFalse(hook.updateMilestone());
        assertEq(hook.p(), 3500);
        // A bad oracle interval does not prevent otherwise eligible trading.
        uint256 bought = _buy(alice, 1 ether);
        _sell(alice, bought / 4);
        _advance(60);
        vm.store(address(manager), slot, original);
        oracle.checkpoint();
        _advance(oracle.WINDOW() - 1);
        oracle.checkpoint();
        vm.expectRevert(UnlkOracle.InvalidOracle.selector);
        oracle.fdvUsd();
        _advance(1);
        oracle.checkpoint();
        assertGt(oracle.fdvUsd(), 0);
        assertEq(hook.p(), 3500);
    }

    function testFinalTierRequiresItsOwnTwentyFourHours() public {
        feed.set(300000e8);
        for (uint256 i; i < 5; ++i) {
            _confirm();
        }
        assertEq(hook.tier(), 5);
        assertEq(hook.p(), 8500);
        uint256 start = hook.qualifyingSince(5);
        while (block.timestamp + 5 minutes < start + hook.FINAL_CONFIRMATION()) {
            _advance(5 minutes);
            hook.updateMilestone();
        }
        assertFalse(hook.fullyUnlocked());
        _advance(5 minutes);
        hook.updateMilestone();
        assertTrue(hook.fullyUnlocked());
        feed.setBroken(true);
        _advance(90 days);
        hook.updateMilestone();
        assertTrue(hook.fullyUnlocked());
    }
}

contract StagingCreationRegressionTest is SystemFixture {
    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
    }

    function testCounterfeitConstructorIsRefusedBeforeAnyDeployment() public {
        bytes memory code = type(UnlkSwapRouter).creationCode;
        code[code.length - 1] = bytes1(uint8(code[code.length - 1]) ^ 1);
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.deployCompanions(
            LAUNCH_NUMBER, feed, code, type(MerkleClaimEvidence).creationCode, type(UnlkOracle).creationCode
        );
        assertEq(hook.stagedRouter(), address(0));
        assertEq(hook.stagedRewards(), address(0));
        assertEq(hook.stagedOracle(), address(0));
        _deployCompanions();
        _activate();
        assertTrue(hook.activated());
    }

    function testOnlySetupAuthorityMayStageAndOnlyUntilActivation() public {
        vm.prank(bob);
        vm.expectRevert(UnlkHook.Unauthorized.selector);
        hook.deployCompanions(
            LAUNCH_NUMBER,
            feed,
            type(UnlkSwapRouter).creationCode,
            type(MerkleClaimEvidence).creationCode,
            type(UnlkOracle).creationCode
        );
        _deployCompanions();
        address firstRouter = address(router);
        address firstRewards = address(rewards);
        assertEq(hook.stagings(), 1);
        // Before activation the authority may stage again: a fresh identical bundle, the first one abandoned.
        _deployCompanions();
        assertEq(hook.stagings(), 2);
        assertTrue(address(router) != firstRouter && address(rewards) != firstRewards);
        assertEq(hook.stagedRouter(), address(router));
        assertEq(hook.stagedRewards(), address(rewards));
        assertEq(hook.stagedOracle(), address(oracle));
        assertEq(address(router.hook()), address(hook));
        assertEq(oracle.hook(), address(hook));
        // The abandoned bundle can never be activated.
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.configureAndActivate(firstRouter, MerkleClaimEvidence(firstRewards), oracle, LAUNCH_NUMBER);
        assertFalse(hook.activated());
        _activate();
        assertTrue(hook.activated());
        assertEq(hook.router(), address(router));
        // After activation staging is closed for good.
        vm.prank(owner);
        vm.expectRevert(UnlkHook.AlreadyActivated.selector);
        hook.deployCompanions(
            LAUNCH_NUMBER,
            feed,
            type(UnlkSwapRouter).creationCode,
            type(MerkleClaimEvidence).creationCode,
            type(UnlkOracle).creationCode
        );
        assertEq(hook.stagings(), 2);
    }
}

contract LargeTreeCertificationTest is SystemFixture {
    function testMaximumSortedTreeFitsTransactionGasLimit() public {
        uint256 n = rewards.MAX_LEAVES();
        address[] memory accounts = new address[](n);
        uint256[] memory amounts = new uint256[](n);
        bytes32[] memory tree = new bytes32[](2 * n - 1);
        for (uint256 i; i < n; ++i) {
            accounts[i] = address(uint160(i + 1)); // explicitly synthetic, sorted stress-test recipients
            amounts[i] = 1;
            tree[n - 1 + i] = keccak256(bytes.concat(keccak256(abi.encode(accounts[i], uint256(1)))));
        }
        for (uint256 i = n - 1; i > 0;) {
            --i;
            tree[i] = Hashes.commutativeKeccak256(tree[2 * i + 1], tree[2 * i + 2]);
        }
        vm.prank(payer);
        token.transfer(address(distributor), n);
        vm.prank(imd);
        distributor.openRound(tree[0], n, 0);
        uint256 beforeGas = gasleft();
        rewards.certifyRound(1, accounts, amounts);
        uint256 used = beforeGas - gasleft();
        emit log_named_uint("1024-leaf sorted certification gas", used);
        assertLt(used, 16_000_000);
        assertTrue(rewards.certified(1));
    }
}
