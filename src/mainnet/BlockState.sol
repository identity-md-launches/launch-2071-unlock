// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {StateProof} from "./StateProof.sol";
import {MainnetPins} from "./MainnetPins.sol";

/// @notice Authenticates a canonical Ethereum header and the pinned manager's pool storage under its root.
library BlockState {
    using StateProof for bytes;
    bytes32 internal constant POOL_ID = 0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3;

    struct Proof {
        bytes header;
        bytes[] account;
        bytes[] slot0;
        bytes[] liquidity;
    }

    struct State {
        uint64 number;
        uint64 time;
        uint160 sqrtPrice;
        int24 tick;
        uint24 protocolFee;
        uint24 lpFee;
        uint128 liquidity;
    }
    error InvalidBlock();

    function verify(Proof memory proof) internal view returns (State memory s) {
        StateProof.Item[] memory header = proof.header.list();
        if (header.length < 15) revert InvalidBlock();
        uint256 number = StateProof.uintValue(proof.header, header[8]);
        uint256 time = StateProof.uintValue(proof.header, header[11]);
        if (
            block.chainid != 1 || number >= block.number || block.number - number > 256
                || number > type(uint64).max || time > block.timestamp || time > type(uint64).max
                || blockhash(number) == bytes32(0) || keccak256(proof.header) != blockhash(number)
        ) revert InvalidBlock();
        bytes32 root = StateProof.word(proof.header, header[3]);
        bytes memory account = StateProof.inclusion(
            root, keccak256(abi.encodePacked(MainnetPins.MANAGER_ADDRESS)), proof.account
        );
        StateProof.Item[] memory fields = account.list();
        if (fields.length != 4 || StateProof.word(account, fields[3]) != MainnetPins.MANAGER) {
            revert InvalidBlock();
        }
        bytes32 storageRoot = StateProof.word(account, fields[2]);
        bytes32 slot = keccak256(abi.encode(POOL_ID, uint256(6)));
        uint256 value = StateProof.storageValue(storageRoot, slot, proof.slot0);
        uint256 liquidity = StateProof.storageValue(storageRoot, bytes32(uint256(slot) + 3), proof.liquidity);
        if (liquidity > type(uint128).max || value >> 232 != 0) revert InvalidBlock();
        s = State(
            uint64(number),
            uint64(time),
            uint160(value),
            int24(uint24(value >> 160)),
            uint24(value >> 184),
            uint24(value >> 208),
            uint128(liquidity)
        );
    }
}
