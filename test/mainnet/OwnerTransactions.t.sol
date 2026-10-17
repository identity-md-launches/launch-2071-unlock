// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ImdFixture} from "./ImdFixture.sol";
import {PrepareImd} from "../../script/mainnet/PrepareImd.s.sol";
import {PrepareOwnerTransactions} from "../../script/mainnet/PrepareOwnerTransactions.s.sol";
import {IImdUsdSource} from "../../src/mainnet/UnlkImdOracle.sol";
import {ImdSpotUsdSource} from "../../src/mainnet/ImdSpotUsdSource.sol";
import {MerkleClaimEvidence} from "../../src/MerkleClaimEvidence.sol";
import {IMerkleDistributor} from "../../src/interfaces/IIntegration.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";

/// @notice Wallet-ready transaction rehearsal using real code and synthetic local launch/reference state.
/// Source validity is immediate; no legacy source redirection, sample or time advance is used.
contract OwnerTransactionsTest is ImdFixture {
    PrepareOwnerTransactions internal planner;
    address[] internal recipients;
    uint256[] internal amounts;

    function setUp() public override {
        _deploy(false);
        uint256 n = _leafCount();
        for (uint256 i; i < n; ++i) {
            recipients.push(address(uint160(uint256(keccak256(abi.encode("local contributor", i))))));
            amounts.push(
                i + 1 == n ? 100_000_000 ether - (n - 1) * (100_000_000 ether / n) : 100_000_000 ether / n
            );
        }
        _launchTokenOnly(-129000);
        _freshFeed();
        bytes32 slot = keccak256(
            abi.encode(
                bytes32(0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3), uint256(6)
            )
        );
        vm.store(MANAGER, slot, bytes32(uint256(TickMath.getSqrtPriceAtTick(58773)) | uint256(10000) << 208));
        vm.store(MANAGER, bytes32(uint256(slot) + 3), bytes32(uint256(1e22)));
        planner = new PrepareOwnerTransactions();
    }

    function _leafCount() internal pure virtual returns (uint256) {
        return 2;
    }

    function _rewardRoot() internal view override returns (bytes32) {
        uint256 n = recipients.length;
        bytes32[] memory tree = new bytes32[](2 * n - 1);
        for (uint256 i; i < n; ++i) {
            tree[n - 1 + i] = keccak256(bytes.concat(keccak256(abi.encode(recipients[i], amounts[i]))));
        }
        for (uint256 i = n - 1; i != 0;) {
            --i;
            tree[i] = Hashes.commutativeKeccak256(tree[2 * i + 1], tree[2 * i + 2]);
        }
        return tree[0];
    }

    function _expected() internal view returns (PrepareOwnerTransactions.Expected memory) {
        // Hook here was deployed from this build's exact production creation code.
        return PrepareOwnerTransactions.Expected(owner, payer, address(hook).codehash);
    }

    function _stagePrice() internal returns (PrepareImd.Config memory config) {
        PrepareOwnerTransactions.WalletTransaction memory tx_ =
            planner.sourceTransaction(hook, LAUNCH_NUMBER, _expected());
        assertEq(tx_.chainId, 1);
        assertEq(tx_.from, owner);
        assertEq(tx_.to, address(hook));
        assertEq(tx_.value, 0);
        vm.prank(owner);
        (bool ok, bytes memory result) = tx_.to.call(tx_.data);
        assertTrue(ok);
        address source = abi.decode(result, (address));
        assertGt(ImdSpotUsdSource(source).priceUsd(), 0);
        config = PrepareImd.Config(hook, LAUNCH_NUMBER, IImdUsdSource(source), address(distributor));
    }

    function testWalletTransactionsExecuteAndSealWithoutWarmup() public {
        uint256 time = block.timestamp;
        uint256 number = block.number;
        PrepareImd.Config memory config = _stagePrice();
        (PrepareImd.Plan memory plan, PrepareOwnerTransactions.WalletTransaction[] memory calls) =
            planner.transactions(config, _expected(), recipients, amounts);
        assertEq(calls.length, recipients.length <= 1024 ? 3 : 11);
        if (recipients.length > 1024) assertEq(plan.certifyRound.length, 0);
        assertFalse(hook.activated(), "preparation is read only");
        for (uint256 i; i < calls.length; ++i) {
            assertEq(calls[i].chainId, 1);
            assertEq(calls[i].from, owner);
            assertEq(calls[i].value, 0);
            assertEq(calls[i].to, i == 0 || i + 1 == calls.length ? address(hook) : plan.evidence);
            vm.prank(calls[i].from);
            (bool ok,) = calls[i].to.call(calls[i].data);
            assertTrue(ok, "wallet sequence call");
        }
        assertTrue(hook.activated());
        assertEq(hook.stagedRewards(), plan.evidence);
        assertEq(hook.stagedOracle(), plan.oracle);
        assertTrue(MerkleClaimEvidence(plan.evidence).certified(0));
        assertEq(block.timestamp, time);
        assertEq(block.number, number);
        vm.expectRevert("stage 1 not ready");
        planner.sourceTransaction(hook, LAUNCH_NUMBER, _expected());
    }

    function testWrongDistributorAndNumberRejectedBeforeWalletSigning() public {
        PrepareImd.Config memory config = _stagePrice();
        config.distributor = bob;
        vm.expectRevert("wrong native distributor");
        planner.transactions(config, _expected(), recipients, amounts);
        config.distributor = address(distributor);
        config.number += 1;
        vm.expectRevert();
        planner.transactions(config, _expected(), recipients, amounts);
        assertEq(hook.stagedRewards(), address(0));
    }

    function testWrongChainOwnerPayerAndRuntimeRejected() public {
        PrepareOwnerTransactions.Expected memory expected = _expected();
        expected.owner = bob;
        vm.expectRevert("paid owner or payer mismatch");
        planner.sourceTransaction(hook, LAUNCH_NUMBER, expected);
        expected = _expected();
        expected.payer = bob;
        vm.expectRevert("paid owner or payer mismatch");
        planner.sourceTransaction(hook, LAUNCH_NUMBER, expected);
        expected = _expected();
        expected.hookRuntimeHash = keccak256("wrong runtime");
        vm.expectRevert("resolved hook runtime mismatch");
        planner.sourceTransaction(hook, LAUNCH_NUMBER, expected);
        vm.chainId(11155111);
        vm.expectRevert("Ethereum mainnet required");
        planner.sourceTransaction(hook, LAUNCH_NUMBER, _expected());
    }

    function testMalformedOrIncompleteTreeCannotBecomeWalletCalls() public {
        PrepareImd.Config memory config = _stagePrice();
        address[] memory duplicate = recipients;
        duplicate[1] = duplicate[0];
        vm.expectRevert("duplicate tree recipient");
        planner.transactions(config, _expected(), duplicate, amounts);
        uint256[] memory changed = amounts;
        changed[0] += 1;
        vm.expectRevert("round0 tree root mismatch");
        planner.transactions(config, _expected(), recipients, changed);
        vm.expectRevert("invalid tree length");
        planner.transactions(config, _expected(), new address[](0), new uint256[](0));
        assertEq(hook.stagedRewards(), address(0));
    }

    function testChangedServiceSourceAndAllocationRejectedBeforeSigning() public {
        PrepareImd.Config memory config = _stagePrice();
        uint256 snapshot = vm.snapshotState();
        vm.etch(ROUTER, hex"00");
        vm.expectRevert("mainnet services mismatch");
        planner.transactions(config, _expected(), recipients, amounts);
        assertTrue(vm.revertToState(snapshot));
        snapshot = vm.snapshotState();
        vm.etch(address(config.feed), hex"00");
        vm.expectRevert("wrong spot source runtime");
        planner.transactions(config, _expected(), recipients, amounts);
        assertTrue(vm.revertToState(snapshot));
        IMerkleDistributor.Round memory round = IMerkleDistributor(address(distributor)).roundOf(0);
        round.funded -= 1;
        vm.mockCall(address(distributor), abi.encodeWithSignature("roundOf(uint256)", 0), abi.encode(round));
        vm.expectRevert("round0 allocation mismatch");
        planner.transactions(config, _expected(), recipients, amounts);
    }
}

contract OwnerTransactionsLargeTreeTest is OwnerTransactionsTest {
    function _leafCount() internal pure override returns (uint256) {
        return 1025;
    }
}
