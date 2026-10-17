// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Narrow, strict RLP/Merkle-Patricia inclusion verifier. All functions internal (no link addresses).
/// @dev Inclusion only. Empty or missing state is rejected, never interpreted as a usable oracle value.
/// Newly implemented security-sensitive code: independent review remains mandatory.
library StateProof {
    error InvalidProof();

    struct Item {
        uint256 start;
        uint256 payload;
        uint256 length;
        uint256 end;
        bool list;
    }

    function item(bytes memory data, uint256 at) internal pure returns (Item memory x) {
        if (at >= data.length) revert InvalidProof();
        uint256 p = uint8(data[at]);
        x.start = at;
        if (p < 0x80) {
            x.payload = at;
            x.length = 1;
        } else if (p < 0xb8) {
            x.payload = at + 1;
            x.length = p - 0x80;
            if (x.length == 1 && x.payload < data.length && uint8(data[x.payload]) < 0x80) {
                revert InvalidProof();
            }
        } else if (p < 0xc0) {
            uint256 n = p - 0xb7;
            x.payload = at + 1 + n;
            x.length = lengthOf(data, at + 1, n);
            if (x.length < 56) revert InvalidProof();
        } else if (p < 0xf8) {
            x.list = true;
            x.payload = at + 1;
            x.length = p - 0xc0;
        } else {
            uint256 n = p - 0xf7;
            x.list = true;
            x.payload = at + 1 + n;
            x.length = lengthOf(data, at + 1, n);
            if (x.length < 56) revert InvalidProof();
        }
        x.end = x.payload + x.length;
        if (x.end > data.length) revert InvalidProof();
    }

    function lengthOf(bytes memory data, uint256 at, uint256 n) private pure returns (uint256 v) {
        if (n == 0 || n > 8 || at + n > data.length || data[at] == 0) revert InvalidProof();
        for (uint256 i; i < n; ++i) {
            v = (v << 8) | uint8(data[at + i]);
        }
    }

    function list(bytes memory data) internal pure returns (Item[] memory entries) {
        Item memory parent = item(data, 0);
        if (!parent.list || parent.end != data.length) revert InvalidProof();
        uint256 count;
        for (uint256 at = parent.payload; at < parent.end;) {
            Item memory child = item(data, at);
            if (child.end > parent.end) revert InvalidProof();
            ++count;
            at = child.end;
        }
        entries = new Item[](count);
        uint256 at = parent.payload;
        for (uint256 i; i < count; ++i) {
            entries[i] = item(data, at);
            at = entries[i].end;
        }
    }

    function copy(bytes memory data, uint256 at, uint256 n) internal pure returns (bytes memory out) {
        if (at + n > data.length) revert InvalidProof();
        out = new bytes(n);
        for (uint256 i; i < n; ++i) {
            out[i] = data[at + i];
        }
    }

    function raw(bytes memory data, Item memory x) internal pure returns (bytes memory) {
        if (x.list) revert InvalidProof();
        return copy(data, x.payload, x.length);
    }

    function uintValue(bytes memory data, Item memory x) internal pure returns (uint256 v) {
        if (x.list || x.length > 32 || (x.length != 0 && data[x.payload] == 0)) revert InvalidProof();
        for (uint256 i; i < x.length; ++i) {
            v = (v << 8) | uint8(data[x.payload + i]);
        }
    }

    function word(bytes memory data, Item memory x) internal pure returns (bytes32 v) {
        if (x.list || x.length != 32) revert InvalidProof();
        uint256 at = x.payload;
        assembly ("memory-safe") { v := mload(add(add(data, 32), at)) }
    }

    function nibble(bytes32 key, uint256 at) private pure returns (uint8) {
        if (at >= 64) revert InvalidProof();
        return uint8(uint256(key) >> ((63 - at) * 4)) & 15;
    }

    /// @dev proof contains root and each subsequent HASHED node. Embedded nodes are traversed directly.
    function inclusion(bytes32 root, bytes32 key, bytes[] memory proof) internal pure returns (bytes memory) {
        if (proof.length == 0 || keccak256(proof[0]) != root) revert InvalidProof();
        bytes memory node = proof[0];
        uint256 used = 1;
        uint256 offset;
        for (uint256 steps; steps < 66; ++steps) {
            Item[] memory parts = list(node);
            Item memory child;
            if (parts.length == 17) {
                if (offset == 64) {
                    if (used != proof.length) revert InvalidProof();
                    return raw(node, parts[16]);
                }
                child = parts[nibble(key, offset++)];
            } else if (parts.length == 2) {
                (uint256 length, bool leaf) = matchPath(raw(node, parts[0]), key, offset);
                offset += length;
                if (leaf) {
                    if (offset != 64 || used != proof.length) revert InvalidProof();
                    return raw(node, parts[1]);
                }
                child = parts[1];
            } else {
                revert InvalidProof();
            }
            if (child.list) {
                if (child.end - child.start >= 32) revert InvalidProof();
                node = copy(node, child.start, child.end - child.start);
            } else {
                if (child.length != 32 || used >= proof.length) revert InvalidProof();
                bytes32 expected = word(node, child);
                node = proof[used++];
                if (node.length < 32 || keccak256(node) != expected) revert InvalidProof();
            }
        }
        revert InvalidProof();
    }

    function matchPath(bytes memory path, bytes32 key, uint256 offset)
        private
        pure
        returns (uint256 length, bool leaf)
    {
        if (path.length == 0) revert InvalidProof();
        uint8 flag = uint8(path[0]) >> 4;
        if (flag > 3 || ((flag & 1) == 0 && (uint8(path[0]) & 15) != 0)) revert InvalidProof();
        uint256 start = (flag & 1) == 1 ? 1 : 2;
        length = path.length * 2 - start;
        if (offset + length > 64 || (flag < 2 && length == 0)) revert InvalidProof();
        for (uint256 j; j < length; ++j) {
            uint256 k = j + start;
            uint8 actual = (uint8(path[k / 2]) >> (k % 2 == 0 ? 4 : 0)) & 15;
            if (actual != nibble(key, offset + j)) revert InvalidProof();
        }
        leaf = flag >= 2;
    }

    function storageValue(bytes32 root, bytes32 slot, bytes[] memory proof) internal pure returns (uint256) {
        bytes memory encoded = inclusion(root, keccak256(abi.encode(slot)), proof);
        Item memory x = item(encoded, 0);
        if (x.end != encoded.length) revert InvalidProof();
        return uintValue(encoded, x);
    }
}
