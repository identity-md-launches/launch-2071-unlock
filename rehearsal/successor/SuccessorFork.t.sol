// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SuccessorTest} from "test/successor/Successor.t.sol";
import {SuccessorMultihopTest, SuccessorInvariantTest} from "test/successor/SuccessorInvariants.t.sol";

// Read-only public Sepolia fork at recorded block 11920551 (the public RPC no longer serves state for the earlier
// 11918468; runtime hashes are identical at both): the ACTUAL deployed PoolManager, Universal Router,
// Quoter and Permit2 with their real storage. Never signs or broadcasts.
contract SuccessorRecordedBlockForkTest is SuccessorTest {
    function _forkBlock() internal pure override returns (uint256) {
        return 11920551;
    }
}

contract SuccessorRecordedBlockMultihopForkTest is SuccessorMultihopTest {
    function _forkBlock() internal pure override returns (uint256) {
        return 11920551;
    }
}
