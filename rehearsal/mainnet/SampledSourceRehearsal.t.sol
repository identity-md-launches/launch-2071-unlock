// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ImdSampledUsdSource} from "src/mainnet/ImdSampledUsdSource.sol";

/// @notice Read-only recorded-block rehearsal on ACTUAL Ethereum state (run via scripts/mainnet/fork.sh semantics:
/// `forge test --fork-url <RPC> --fork-block-number 26204279`). No transaction is broadcast.
contract SampledSourceRehearsal is Test {
    function testActualPoolSampleAndSpotAtRecordedBlock() public {
        if (block.chainid != 1 || block.number != 26204279) return; // offline default run: nothing to rehearse
        ImdSampledUsdSource source = new ImdSampledUsdSource();
        int24 recorded = source.sample();
        assertEq(recorded, 58963, "actual IMD-per-ETH tick at block 26204279");
        (, int24 tick, bool liquid,,,) = _first(source);
        assertEq(tick, 58963);
        assertTrue(liquid, "actual pool passes the 250 virtual-ETH liveness screen");
        (uint256 usdPerImd,, int24 spotTick, uint256 virtualEth, uint256 ethUsd) = source.spot();
        assertEq(spotTick, 58963);
        assertApproxEqRel(virtualEth, 610.5036 ether, 1e14);
        assertEq(ethUsd, 245175659282 * 1e10);
        assertApproxEqRel(usdPerImd, 6.743192 ether, 1e14);
        vm.expectRevert(ImdSampledUsdSource.InvalidPrice.selector);
        source.priceUsd(); // one real sample is not history
    }

    function _first(ImdSampledUsdSource source)
        private
        view
        returns (uint32, int24, bool, uint64, int56, uint32)
    {
        (uint32 time, int24 tick,, bool liquid, uint64 number, int56 cumulative, uint32 bad) =
            source.observations(0);
        return (time, tick, liquid, number, cumulative, bad);
    }
}
