// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";

/// @notice Explicit synthetic oracle venue; not a known mainnet pool.
contract MockImdMarket {
    int24 public tick = 60000;
    uint128 public liquidity = 1e24;
    bool public outage;
    bool public splitWindows;
    int24 public shortTick;
    uint128 public historyLiquidity = 1e24;

    function factory() external pure returns (address) {
        return 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    }

    function token0() external pure returns (address) {
        return 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    }

    function token1() external pure returns (address) {
        return MainnetPins.IMD_ADDRESS;
    }

    function fee() external pure returns (uint24) {
        return 3000;
    }

    function setWindowTicks(int24 longValue, int24 shortValue) external {
        tick = longValue;
        shortTick = shortValue;
        splitWindows = true;
    }

    function setHistoryLiquidity(uint128 value) external {
        historyLiquidity = value;
    }

    function setTick(int24 value) external {
        tick = value;
    }

    function setLiquidity(uint128 value) external {
        liquidity = value;
    }

    function setOutage(bool value) external {
        outage = value;
    }

    function observe(uint32[] calldata ago) external view returns (int56[] memory t, uint160[] memory l) {
        require(!outage, "history unavailable");
        t = new int56[](ago.length);
        l = new uint160[](ago.length);
        for (uint256 i; i < ago.length; i++) {
            uint256 time = block.timestamp - ago[i];
            t[i] = splitWindows
                ? -int56(uint56(ago[i])) * int56(ago[i] == 7200 ? shortTick : tick)
                : int56(int256(time) * tick);
            l[i] = uint160((time << 128) / historyLiquidity);
        }
    }
}
