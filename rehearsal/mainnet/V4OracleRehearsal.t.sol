// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {BlockState} from "src/mainnet/BlockState.sol";
import {ImdV4UsdSource} from "src/mainnet/ImdV4UsdSource.sol";
import {V4StateEvidence} from "test/mainnet/V4StateEvidence.sol";
import {BlockProofHarness} from "test/mainnet/V4OracleProof.t.sol";
import {MainnetPins} from "src/mainnet/MainnetPins.sol";
import {IUniversalRouter, IPermit2Allowance} from "test/mainnet/ImdFixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";

contract V4ActualOracleRehearsal is Test {
    using StateLibrary for IPoolManager;
    bytes32 constant ID = 0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3;

    function testActualBlockhashAnchorsRecordedStateProofAndSourceFailsClosed() public {
        vm.createSelectFork("https://ethereum-rpc.publicnode.com", 26203856);
        assertEq(blockhash(V4StateEvidence.BLOCK), V4StateEvidence.HASH);
        BlockProofHarness verifier = new BlockProofHarness();
        BlockState.State memory state = verifier.verify(V4StateEvidence.proof());
        assertEq(state.tick, 58773);
        ImdV4UsdSource source = new ImdV4UsdSource();
        uint256 start = gasleft();
        source.submit(V4StateEvidence.proof());
        emit log_named_uint("measured submit execution gas (excluding calldata/base tx)", start - gasleft());
        vm.expectRevert(ImdV4UsdSource.InvalidPrice.selector);
        source.priceUsd();
    }

    struct Swap {
        PoolKey key;
        bool zeroForOne;
        uint128 amount;
        uint128 minimum;
        bytes hookData;
    }

    function _trade(bool buy, uint128 amount) private {
        PoolKey memory key = PoolKey(
            Currency.wrap(address(0)), Currency.wrap(MainnetPins.IMD_ADDRESS), 10000, 200, IHooks(address(0))
        );
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(Swap(key, buy, amount, 1, ""));
        params[1] = abi.encode(buy ? key.currency0 : key.currency1, uint256(amount));
        params[2] = abi.encode(buy ? key.currency1 : key.currency0, uint256(1));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0f", params);
        IUniversalRouter(MainnetPins.ROUTER_ADDRESS).execute{value: buy ? amount : 0}(
            hex"10", inputs, block.timestamp
        );
    }

    function testActualV4GrossCapitalAndNetExitCost() public {
        vm.createSelectFork("https://ethereum-rpc.publicnode.com", 26203792);
        IERC20 imd = IERC20(MainnetPins.IMD_ADDRESS);
        imd.approve(MainnetPins.PERMIT2_ADDRESS, type(uint256).max);
        IPermit2Allowance(MainnetPins.PERMIT2_ADDRESS)
            .approve(address(imd), MainnetPins.ROUTER_ADDRESS, type(uint160).max, type(uint48).max);
        uint128[6] memory budgets =
            [uint128(10 ether), 100 ether, 500 ether, 1000 ether, 10000 ether, 10100 ether];
        vm.deal(address(this), 20000 ether);
        IPoolManager manager = IPoolManager(MainnetPins.MANAGER_ADDRESS);
        for (uint256 i; i < budgets.length; i++) {
            uint256 snapshot = vm.snapshotState();
            uint256 ethBefore = address(this).balance;
            uint256 imdBefore = imd.balanceOf(address(this));
            (uint160 initial,,,) = manager.getSlot0(PoolId.wrap(ID));
            uint256 routerNativeBefore = MainnetPins.ROUTER_ADDRESS.balance;
            _trade(true, budgets[i]);
            assertEq(
                MainnetPins.ROUTER_ADDRESS.balance,
                routerNativeBefore,
                "full input spent, no retained native refund"
            );
            uint256 acquired = imd.balanceOf(address(this)) - imdBefore;
            (uint160 raised,,,) = manager.getSlot0(PoolId.wrap(ID));
            emit log_named_uint("gross ETH capital", budgets[i]);
            emit log_named_uint("IMD acquired", acquired);
            emit log_named_uint(
                "active virtual ETH after buy",
                uint256(manager.getLiquidity(PoolId.wrap(ID))) * (1 << 96) / raised
            );
            emit log_named_uint(
                "IMD price factor bps", uint256(initial) * initial / (uint256(raised) * raised / 10000)
            );
            // Exit without arbitrage, after one block; no claim of a lower-bound cost or sustained strategy.
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 12);
            _trade(false, uint128(acquired));
            emit log_named_uint("net ETH exit cost excluding gas/MEV", ethBefore - address(this).balance);
            assertLt(address(this).balance, ethBefore);
            vm.revertToState(snapshot);
        }
    }
    receive() external payable {}
}
