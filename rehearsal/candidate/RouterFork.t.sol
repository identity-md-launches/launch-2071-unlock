// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {RecordedRouterTest} from "test/compatibility/RecordedRouter.t.sol";

contract RecordedBlockRouterForkTest is RecordedRouterTest {
    function setUp() public override {
        vm.createSelectFork("https://ethereum-sepolia-rpc.publicnode.com", 11918468);
        _prepare(false);
    }
}
