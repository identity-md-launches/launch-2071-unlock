// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {BlockState} from "../../src/mainnet/BlockState.sol";
import {StateProof} from "../../src/mainnet/StateProof.sol";
import {ImdV4UsdSource} from "../../src/mainnet/ImdV4UsdSource.sol";
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {MainnetRuntime} from "./MainnetRuntime.sol";
import {V4StateEvidence} from "./V4StateEvidence.sol";

contract BlockProofHarness {
    function verify(BlockState.Proof calldata p) external view returns (BlockState.State memory) {
        return BlockState.verify(p);
    }

    function inclusion(bytes32 root, bytes32 key, bytes[] calldata proof)
        external
        pure
        returns (bytes memory)
    {
        return StateProof.inclusion(root, key, proof);
    }

    function uintRlp(bytes calldata data) external pure returns (uint256) {
        StateProof.Item memory x = StateProof.item(data, 0);
        require(x.end == data.length);
        return StateProof.uintValue(data, x);
    }
}

/// @dev Synthetic interval tests only. NOT deployable production oracle and not admissible to staging.
contract V4OracleHarness is ImdV4UsdSource {
    function synthetic(BlockState.State calldata s) external {
        _append(s);
    }
}

contract V4BlockProofTest is Test {
    BlockProofHarness harness;

    function setUp() public {
        vm.chainId(1);
        vm.roll(V4StateEvidence.BLOCK + 64);
        vm.warp(V4StateEvidence.TIME + 768);
        vm.setBlockhash(V4StateEvidence.BLOCK, V4StateEvidence.HASH);
        harness = new BlockProofHarness();
    }

    function testActualMainnetProofVerifiesExactStorageButCannotPrice() public {
        BlockState.State memory s = harness.verify(V4StateEvidence.proof());
        assertEq(s.number, V4StateEvidence.BLOCK);
        assertEq(s.time, V4StateEvidence.TIME);
        assertEq(s.tick, 58773);
        assertEq(s.lpFee, 10000);
        assertEq(s.protocolFee, 0x3e83e8);
        assertEq(s.liquidity, 11803017312680583666866);
        ImdV4UsdSource source = new ImdV4UsdSource();
        source.submit(V4StateEvidence.proof());
        assertEq(source.observationCount(), 1);
        (,,, bool liquid,,) = source.observations(0);
        assertFalse(liquid, "real market below depth floor");
        vm.expectRevert(ImdV4UsdSource.InvalidPrice.selector);
        source.priceUsd();
    }

    function testFuzzChangedHeaderNeverAuthenticates(uint16 offset, uint8 bit) public {
        BlockState.Proof memory proof = V4StateEvidence.proof();
        uint256 at = bound(offset, 0, proof.header.length - 1);
        proof.header[at] = bytes1(uint8(proof.header[at]) ^ uint8(1 << (bit % 8)));
        vm.expectRevert();
        harness.verify(proof);
    }

    function testFuzzChangedStorageProofRejected(uint16 offset, uint8 bit) public {
        BlockState.Proof memory proof = V4StateEvidence.proof();
        uint256 at = bound(offset, 0, proof.slot0[0].length - 1);
        proof.slot0[0][at] = bytes1(uint8(proof.slot0[0][at]) ^ uint8(1 << (bit % 8)));
        vm.expectRevert();
        harness.verify(proof);
    }

    function testWrongAccountSlotChainAgeAndConfirmationRejected() public {
        BlockState.Proof memory proof = V4StateEvidence.proof();
        proof.slot0 = proof.liquidity;
        vm.expectRevert();
        harness.verify(proof);
        proof = V4StateEvidence.proof();
        proof.account = proof.slot0;
        vm.expectRevert();
        harness.verify(proof);
        vm.chainId(11155111);
        vm.expectRevert();
        harness.verify(V4StateEvidence.proof());
        vm.chainId(1);
        vm.roll(V4StateEvidence.BLOCK + 257);
        vm.expectRevert();
        harness.verify(V4StateEvidence.proof());
        vm.roll(V4StateEvidence.BLOCK + 1);
        vm.setBlockhash(V4StateEvidence.BLOCK, V4StateEvidence.HASH);
        ImdV4UsdSource source = new ImdV4UsdSource();
        vm.expectRevert();
        source.submit(V4StateEvidence.proof());
    }

    function testDuplicateAndTrailingProofNodesRejected() public {
        ImdV4UsdSource source = new ImdV4UsdSource();
        source.submit(V4StateEvidence.proof());
        vm.expectRevert();
        source.submit(V4StateEvidence.proof());
        BlockState.Proof memory proof = V4StateEvidence.proof();
        bytes[] memory extra = new bytes[](proof.slot0.length + 1);
        for (uint256 i; i < proof.slot0.length; i++) {
            extra[i] = proof.slot0[i];
        }
        extra[extra.length - 1] = hex"80";
        proof.slot0 = extra;
        vm.expectRevert();
        harness.verify(proof);
    }

    function testNonCanonicalRlpAndMalformedNodesRejected() public {
        assertEq(harness.uintRlp(hex"80"), 0);
        assertEq(harness.uintRlp(hex"7f"), 127);
        assertEq(harness.uintRlp(hex"8180"), 128);
        bytes[5] memory bad = [bytes(hex"00"), hex"8101", hex"b801ff", hex"8200ff", hex"b90038"];
        for (uint256 i; i < bad.length; i++) {
            vm.expectRevert();
            harness.uintRlp(bad[i]);
        }
        bytes[] memory proof = new bytes[](1);
        proof[0] = hex"c180";
        vm.expectRevert();
        harness.inclusion(keccak256(proof[0]), bytes32(0), proof);
    }
}

contract V4OracleIntervalsTest is Test {
    V4OracleHarness source;
    uint64 number;
    uint64 time;

    function setUp() public {
        vm.chainId(1);
        vm.warp(1_800_000_000);
        vm.roll(1000);
        vm.etch(MainnetPins.MANAGER_ADDRESS, MainnetRuntime.manager());
        source = new V4OracleHarness();
        time = uint64(block.timestamp);
        number = 900;
        vm.etch(MainnetPins.ETHUSD_ADDRESS, MainnetRuntime.ethUsd());
        _append(60000, true, 0);
        _feed();
    }

    function _feed() internal {
        vm.mockCall(MainnetPins.ETHUSD_ADDRESS, abi.encodeWithSignature("decimals()"), abi.encode(uint8(8)));
        vm.mockCall(
            MainnetPins.ETHUSD_ADDRESS,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(uint80(1), int256(3000e8), block.timestamp, block.timestamp, uint80(1))
        );
    }

    function _state(int24 tick, bool deep) internal view returns (BlockState.State memory) {
        return BlockState.State(
            number,
            time,
            TickMath.getSqrtPriceAtTick(tick),
            tick,
            0x3e83e8,
            10000,
            deep ? uint128(1_000_000 ether) : uint128(1 ether)
        );
    }

    function _append(int24 tick, bool deep, uint64 elapsed) internal {
        if (elapsed != 0) {
            ++number;
            time += elapsed;
        }
        vm.roll(uint256(number) + 64);
        vm.warp(uint256(time) + 768);
        BlockState.State memory state = _state(tick, deep);
        bytes32 slot = keccak256(abi.encode(source.POOL_ID(), uint256(6)));
        vm.store(
            MainnetPins.MANAGER_ADDRESS,
            slot,
            bytes32(
                uint256(state.sqrtPrice) | (uint256(uint24(tick)) << 160) | (uint256(0x3e83e8) << 184)
                    | (uint256(10000) << 208)
            )
        );
        vm.store(MainnetPins.MANAGER_ADDRESS, bytes32(uint256(slot) + 3), bytes32(uint256(state.liquidity)));
        source.synthetic(state);
    }

    function _day(int24 tick) internal {
        for (uint256 i; i < 1440; ++i) {
            _append(tick, true, 60);
        }
        _feed();
    }

    function testInsufficientHistoryWarmupAndNoExtrapolation() public {
        vm.expectRevert();
        source.priceUsd();
        _day(60000);
        assertGt(source.priceUsd(), 0);
        vm.warp(block.timestamp + 21 minutes);
        _feed();
        vm.expectRevert();
        source.priceUsd();
    }

    function testSameBlockAndFlashSampleCannotSupplyElapsedHistory() public {
        _day(60000);
        uint256 normal = source.priceUsd();
        vm.expectRevert(ImdV4UsdSource.InvalidSequence.selector);
        source.synthetic(_state(0, true));
        _append(30000, true, 12);
        _append(60000, true, 12);
        _feed();
        uint256 changed = source.priceUsd();
        assertLt(changed, normal * 1001 / 1000);
    }

    function testSustainedAndCrossMarketManipulationRemainExecutableLimit() public {
        _day(60000);
        uint256 normal = source.priceUsd();
        _append(50000, true, 60);
        for (uint256 i; i < 120; ++i) {
            _append(50000, true, 60);
        }
        _feed();
        vm.expectRevert(ImdV4UsdSource.InvalidPrice.selector);
        source.priceUsd();
        _day(50000);
        assertGt(source.priceUsd(), normal * 2, "long manipulation passes: history does not prove fair value");
        // Both legs manipulated in the same direction: agreement across windows is not independence.
        vm.mockCall(
            MainnetPins.ETHUSD_ADDRESS,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(uint80(1), int256(6000e8), block.timestamp, block.timestamp, uint80(1))
        );
        assertGt(source.priceUsd(), normal * 4);
    }

    function testDepthAndGapInvalidateWholeWindowThenRecoverWithoutReset() public {
        _day(60000);
        uint256 normal = source.priceUsd();
        _append(60000, false, 60);
        _feed();
        vm.expectRevert();
        source.priceUsd();
        _append(60000, true, 60);
        _feed();
        vm.expectRevert();
        source.priceUsd();
        _day(60000);
        assertEq(source.priceUsd(), normal);
        _append(60000, true, 120);
        _feed();
        vm.expectRevert();
        source.priceUsd();
        _day(60000);
        assertEq(source.priceUsd(), normal);
    }

    function testOmittedBlocksCannotBeSmoothedAndLateRecoveryRecordsBadInterval() public {
        _day(60000);
        number += 2;
        time += 24;
        vm.roll(uint256(number) + 64);
        vm.warp(uint256(time) + 768);
        vm.expectRevert(ImdV4UsdSource.InvalidSequence.selector);
        source.synthetic(_state(60000, true));
        number += 300;
        time += 3600;
        vm.roll(uint256(number) + 64);
        vm.warp(uint256(time) + 768);
        source.synthetic(_state(60000, true));
        _feed();
        vm.expectRevert();
        source.priceUsd();
        _day(60000);
        assertGt(source.priceUsd(), 0);
    }

    function testCurrentDepthWithdrawalInvalidatesEvenFreshProvenHistory() public {
        _day(60000);
        assertGt(source.priceUsd(), 0);
        bytes32 slot = keccak256(abi.encode(source.POOL_ID(), uint256(6)));
        vm.store(MainnetPins.MANAGER_ADDRESS, bytes32(uint256(slot) + 3), bytes32(0));
        vm.expectRevert(ImdV4UsdSource.InvalidPrice.selector);
        source.priceUsd();
    }

    function testBadEthRoundsAndCodeFailClosed() public {
        _day(60000);
        for (uint256 i; i < 5; ++i) {
            vm.mockCall(
                MainnetPins.ETHUSD_ADDRESS,
                abi.encodeWithSignature("latestRoundData()"),
                abi.encode(
                    uint80(2),
                    i == 0 ? int256(-1) : int256(3000e8),
                    block.timestamp - 2 hours,
                    i == 1 ? block.timestamp + 1 : i == 2 ? block.timestamp - 2 hours : block.timestamp,
                    i == 3 ? uint80(1) : uint80(2)
                )
            );
            if (i == 4) vm.etch(MainnetPins.ETHUSD_ADDRESS, hex"00");
            vm.expectRevert();
            source.priceUsd();
        }
    }
}
