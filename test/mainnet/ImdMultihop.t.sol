// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {ImdFixture, IPermit2Allowance} from "./ImdFixture.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ImdMultihopTest is ImdFixture, IUnlockCallback {
    MockERC20 internal auxiliary;
    PoolKey internal auxiliaryKey;
    bool private seeding;

    struct Path {
        address intermediateCurrency;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
        bytes hookData;
    }

    struct MultiIn {
        address currencyIn;
        Path[] path;
        uint128 amountIn;
        uint128 amountOutMinimum;
    }

    function _seedAuxiliary() internal {
        auxiliary = new MockERC20("local auxiliary routing token", "AUX", 1e27);
        bool aux0 = address(auxiliary) < address(quote);
        auxiliaryKey = PoolKey(
            Currency.wrap(aux0 ? address(auxiliary) : address(quote)),
            Currency.wrap(aux0 ? address(quote) : address(auxiliary)),
            3000,
            60,
            IHooks(address(0))
        );
        manager.initialize(auxiliaryKey, uint160(1 << 96));
        _fundQuote(address(this), 1e25);
        seeding = true;
        manager.unlock("");
        seeding = false;
        auxiliary.transfer(alice, 1000 ether);
        vm.startPrank(alice);
        auxiliary.approve(PERMIT2, 1000 ether);
        IPermit2Allowance(PERMIT2)
            .approve(address(auxiliary), ROUTER, 1000 ether, uint48(block.timestamp + 600));
        vm.stopPrank();
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        require(msg.sender == MANAGER && seeding, "unexpected callback");
        (BalanceDelta delta,) = manager.modifyLiquidity(
            auxiliaryKey, ModifyLiquidityParams(-887220, 887220, 1e24, bytes32(0)), ""
        );
        _settle(auxiliaryKey.currency0, delta.amount0());
        _settle(auxiliaryKey.currency1, delta.amount1());
        return "";
    }

    function _settle(Currency currency, int128 delta) private {
        require(delta <= 0, "unexpected credit");
        uint256 amount = uint256(-int256(delta));
        manager.sync(currency);
        IERC20(Currency.unwrap(currency)).transfer(MANAGER, amount);
        manager.settle();
    }

    function testMultihopAuxiliaryImdUnlkUsesInitiatorAndSettlesBothPools() public {
        _seedAuxiliary();
        Path[] memory path = new Path[](2);
        path[0] = Path(address(quote), 3000, 60, address(0), "");
        path[1] = Path(address(token), 12500, 60, address(hook), "");
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(MultiIn(address(auxiliary), path, 100 ether, 1));
        params[1] = abi.encode(address(auxiliary), uint256(100 ether));
        params[2] = abi.encode(address(token), uint256(1));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"070c0f", params);
        _execute(alice, hex"10", inputs, 0);
        assertGt(token.balanceOf(alice), 0);
        assertEq(hook.eligible(alice), token.balanceOf(alice));
        assertEq(auxiliary.balanceOf(alice), 900 ether);
        assertEq(quote.balanceOf(ROUTER), 0);
        assertEq(token.balanceOf(ROUTER), 0);
        assertGt(vault.totalAccrued(), 0);
    }
}
