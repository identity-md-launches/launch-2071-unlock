// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";
import {UnlkHook} from "../src/UnlkHook.sol";
import {UnlkToken} from "../src/UnlkToken.sol";
import {MerkleClaimEvidence} from "../src/MerkleClaimEvidence.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {UnlkOracle} from "../src/UnlkOracle.sol";
import {SeedDepth} from "../src/libraries/SeedDepth.sol";
import {LaunchFactory} from "../test/imd/LaunchFactory.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";

/// @notice Regression tests for the reopened findings a4b5f9a2 (seed tolerance strands stage 1) and d8778e80
/// (a seed below the oracle's capacity floor seals a hook whose milestones never confirm).
contract ActivationRobustnessTest is SystemFixture {
    int24 internal constant LOW_OPENING_TICK = -177840; // about 18.9 ETH opening FDV, 16.46 ETH capacity

    function setUp() public override {
        _deploy(false);
    }

    function _exactLiquidity(int24 normalizedTick) internal returns (uint160 sqrt, uint128 liquidity) {
        (seedLower, seedUpper) = (LOWER, -normalizedTick);
        sqrt = TickMath.getSqrtPriceAtTick(seedUpper);
        liquidity = _tokenOnlyLiquidity(token, sqrt);
    }

    /// @dev Finding a4b5f9a2's exact reproduction: a seed 1e9 liquidity units short of the figure leaves the
    /// pool about 7e12 wei (0.000007 UNLK) short of 870M. Stage 1 accepts it, and now so does stage 2.
    function testSubDustSeedRoundingStillActivates() public {
        (uint160 sqrt, uint128 exact) = _exactLiquidity(OPENING_TICK);
        _launch(sqrt, seedLower, seedUpper, exact - 1e9);
        uint256 poolReceived = token.initialAllocation(address(manager));
        assertLt(poolReceived, token.POOL_ALLOCATION(), "pool is short");
        assertGt(poolReceived + 1e14, token.POOL_ALLOCATION(), "by less than a dust amount");
        assertEq(token.initialAllocation(payer), token.SUPPLY() - token.SWARM_ALLOCATION() - poolReceived);
        assertLe(hook.seedTokens(), poolReceived);
        assertGe(hook.seedQuoteCapacity(), hook.MIN_SEED_QUOTE_CAPACITY());
        _deployCompanions();
        _activate();
        assertTrue(hook.activated());
        (address recipient, uint256 amount) = hook.pendingPayerCredit();
        assertEq(recipient, payer);
        assertEq(amount, token.PAYER_ALLOCATION(), "the remainder wallet is credited the policy share only");
        assertGt(_buy(alice, 1 ether), 0);
    }

    /// @dev A seed anywhere inside the documented 1% band launches and activates; the shortfall goes to the
    /// remainder wallet without creating extra quota.
    function testSeedInsideTheOnePercentBandActivates() public {
        (uint160 sqrt, uint128 exact) = _exactLiquidity(OPENING_TICK);
        uint128 liquidity = uint128(Math.mulDiv(exact, 9950, 10000));
        _launch(sqrt, seedLower, seedUpper, liquidity);
        uint256 poolReceived = token.initialAllocation(address(manager));
        assertGe(poolReceived, hook.MIN_POOL_ALLOCATION());
        assertLt(poolReceived, token.POOL_ALLOCATION());
        _deployCompanions();
        _activate();
        assertTrue(hook.activated());
        hook.syncPayer();
        assertEq(hook.eligible(payer), token.PAYER_ALLOCATION());
    }

    /// @dev Below the band the launch transaction itself reverts: no pool, no stranded stage 1.
    function testSeedBelowThePoolShareBandCannotLaunch() public {
        (uint160 sqrt, uint128 exact) = _exactLiquidity(OPENING_TICK);
        uint128 liquidity = uint128(Math.mulDiv(exact, 9850, 10000));
        LaunchFactory.LaunchParams memory params = _launchParams(sqrt, seedLower, seedUpper, liquidity);
        vm.expectRevert(_seedRefusal());
        factory.launch(params);
        assertEq(address(hook), address(0));
    }

    /// @dev The hook's `InvalidPool` from `beforeAddLiquidity`, as the PoolManager wraps it.
    function _seedRefusal() internal view returns (bytes memory) {
        return abi.encodeWithSelector(
            CustomRevert.WrappedError.selector,
            predictedHook,
            IHooks.beforeAddLiquidity.selector,
            abi.encodeWithSelector(UnlkHook.InvalidPool.selector),
            abi.encodeWithSelector(Hooks.HookCallFailed.selector)
        );
    }

    /// @dev Finding d8778e80's exact reproduction: opening at -177840 (18.9 ETH FDV) gives the 870M seed only
    /// 16.46 ETH of opening-value capacity. Before, this launched and sealed with a permanently dead oracle; now
    /// the factory's seed reverts inside the launch transaction.
    function testSeedBelowOpeningValueFloorCannotLaunch() public {
        (uint160 sqrt, uint128 liquidity) = _exactLiquidity(LOW_OPENING_TICK);
        (uint256 principal, uint256 depth) = SeedDepth.quoteCapacity(
            TickMath.getSqrtPriceAtTick(seedLower), TickMath.getSqrtPriceAtTick(seedUpper), liquidity
        );
        assertApproxEqAbs(principal, 870_000_000 ether, 1e12);
        assertLt(depth, SeedDepth.MIN_SEED_QUOTE_CAPACITY);
        assertGt(depth, 16 ether);
        LaunchFactory.LaunchParams memory params = _launchParams(sqrt, seedLower, seedUpper, liquidity);
        vm.expectRevert(_seedRefusal());
        factory.launch(params);
        assertEq(address(hook), address(0));
    }

    /// @dev The policy seed passes with its 2.3% margin, and the recorded capacity is what the oracle uses.
    function testPolicySeedRecordsCapacityAndConfirmsTiers() public {
        _launchTokenOnly(OPENING_TICK);
        assertGe(hook.seedQuoteCapacity(), 17 ether);
        assertLt(hook.seedQuoteCapacity(), 17.5 ether);
        assertApproxEqAbs(hook.seedTokens(), 870_000_000 ether, 1e12);
        _localQuoteDepth(10000 ether);
        _deployCompanions();
        _activate();
        feed.set(300000e8);
        _confirm();
        assertEq(hook.tier(), 1);
    }

    /// @dev The staging call runs the same stage-1 checks as activation, so a wrong launch number is refused
    /// before any bundle exists, and staging may be repeated until activation.
    function testStagingRunsActivationPreconditionsAndCanRepeat() public {
        _launchTokenOnly(OPENING_TICK);
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidEvidence.selector);
        hook.deployCompanions(
            LAUNCH_NUMBER + 1,
            feed,
            type(UnlkSwapRouter).creationCode,
            type(MerkleClaimEvidence).creationCode,
            type(UnlkOracle).creationCode
        );
        assertEq(hook.stagings(), 0);
        _deployCompanions();
        _deployCompanions();
        assertEq(hook.stagings(), 2);
        _activate();
        assertTrue(hook.activated());
    }
}

/// @notice Finding 153c7ae8: rounds larger than one transaction can hold are certified in chunks, so every
/// proven native claim can be credited.
contract ChunkedCertificationTest is SystemFixture {
    uint256 internal constant N = 1500;
    address[] internal accounts;
    uint256[] internal amounts;
    bytes32[] internal tree;

    function setUp() public override {
        super.setUp();
        for (uint256 i; i < N; ++i) {
            accounts.push(address(uint160(0x1000 + i))); // synthetic distinct recipients
            amounts.push(i + 1);
        }
        _buildTree();
        vm.prank(payer);
        token.transfer(address(distributor), N * (N + 1) / 2);
        vm.prank(imd);
        assertEq(distributor.openRound(tree[0], N * (N + 1) / 2, 0), 1);
    }

    function _buildTree() internal {
        delete tree;
        for (uint256 i; i < 2 * N - 1; ++i) {
            tree.push(bytes32(0));
        }
        for (uint256 i; i < N; ++i) {
            tree[N - 1 + i] = keccak256(bytes.concat(keccak256(abi.encode(accounts[i], amounts[i]))));
        }
        for (uint256 i = N - 1; i > 0;) {
            --i;
            tree[i] = Hashes.commutativeKeccak256(tree[2 * i + 1], tree[2 * i + 2]);
        }
    }

    function _proof(uint256 leaf) internal view returns (bytes32[] memory proof) {
        uint256 depth;
        for (uint256 i = N - 1 + leaf; i > 0; i = (i - 1) / 2) {
            ++depth;
        }
        proof = new bytes32[](depth);
        uint256 k;
        for (uint256 i = N - 1 + leaf; i > 0; i = (i - 1) / 2) {
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

    function _submitAll(address submitter) internal {
        for (uint256 from; from < N; from += 500) {
            (address[] memory a, uint256[] memory m) = _slice(from, from + 500);
            vm.prank(submitter);
            rewards.submitLeaves(1, N, a, m);
        }
    }

    function testSingleShotRefusesButChunksCertifyAndCredit() public {
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        rewards.certifyRound(1, accounts, amounts);

        uint256 leaf = 777;
        distributor.claim(1, accounts[leaf], amounts[leaf], _proof(leaf));
        assertEq(token.balanceOf(accounts[leaf]), amounts[leaf]);
        vm.expectRevert(MerkleClaimEvidence.UncertifiedRound.selector);
        rewards.attest(1, accounts[leaf], amounts[leaf], _proof(leaf));

        _submitAll(bob);
        (uint256 leaves, uint256 submitted, uint256 reduced) = rewards.sessions(rewards.sessionOf(bob, 1));
        assertEq(leaves, N);
        assertEq(submitted, N);
        assertEq(reduced, 0);
        vm.prank(bob);
        rewards.reduce(1, 1000);
        assertFalse(rewards.certified(1));
        vm.prank(bob);
        rewards.reduce(1, 1000);
        assertTrue(rewards.certified(1));

        assertEq(rewards.attest(1, accounts[leaf], amounts[leaf], _proof(leaf)), amounts[leaf]);
        assertEq(hook.syncRewards(accounts[leaf]), amounts[leaf]);
        assertEq(hook.eligible(accounts[leaf]), amounts[leaf]);
        // Anything else on the certified round is refused.
        vm.prank(bob);
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        rewards.reduce(1, 1);
    }

    function testDuplicateAcrossChunksWrongRootAndForeignSessionsAreRefused() public {
        (address[] memory a, uint256[] memory m) = _slice(0, 500);
        vm.prank(bob);
        rewards.submitLeaves(1, N, a, m);
        // A duplicate recipient in a later chunk is caught against the earlier chunks.
        (address[] memory dup, uint256[] memory dupAmounts) = _slice(500, 1000);
        dup[3] = accounts[7];
        vm.prank(bob);
        vm.expectRevert(MerkleClaimEvidence.DuplicateRecipient.selector);
        rewards.submitLeaves(1, N, dup, dupAmounts);
        // Nobody else can advance or reduce bob's session; alice's own session is independent.
        vm.prank(alice);
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        rewards.reduce(1, 10);
        // A wrong leaf set reduces to a wrong root, which changes nothing and can be abandoned.
        (address[] memory wrong, uint256[] memory wrongAmounts) = _slice(500, N);
        wrongAmounts[0] += 1;
        vm.prank(bob);
        rewards.submitLeaves(1, N, wrong, wrongAmounts);
        vm.prank(bob);
        vm.expectRevert(MerkleClaimEvidence.InvalidProof.selector);
        rewards.reduce(1, N);
        assertFalse(rewards.certified(1));
        vm.prank(bob);
        rewards.abandonSession(1);
        assertEq(rewards.generation(bob, 1), 1);
        _submitAll(bob);
        vm.prank(bob);
        rewards.reduce(1, N);
        assertTrue(rewards.certified(1));
        // A certified round accepts no more sessions.
        vm.prank(alice);
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        rewards.submitLeaves(1, N, a, m);
    }

    function testChunkBoundsAndSizeAreFixedByTheFirstChunk() public {
        (address[] memory a, uint256[] memory m) = _slice(0, 500);
        vm.prank(bob);
        rewards.submitLeaves(1, N, a, m);
        vm.prank(bob);
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        rewards.submitLeaves(1, N + 1, a, m);
        (address[] memory big, uint256[] memory bigAmounts) = _slice(0, 1001);
        vm.prank(bob);
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        rewards.submitLeaves(1, N, big, bigAmounts);
        vm.prank(bob);
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        rewards.reduce(1, 10);
    }

    function testSingleLeafRoundCertifiesThroughTheChunkedPath() public {
        address[] memory a = new address[](1);
        uint256[] memory m = new uint256[](1);
        (a[0], m[0]) = (bob, 5);
        bytes32 root = keccak256(bytes.concat(keccak256(abi.encode(bob, uint256(5)))));
        vm.prank(payer);
        token.transfer(address(distributor), 5);
        vm.prank(imd);
        assertEq(distributor.openRound(root, 5, 0), 2);
        rewards.submitLeaves(2, 1, a, m);
        rewards.reduce(2, 1);
        assertTrue(rewards.certified(2));
    }
}
