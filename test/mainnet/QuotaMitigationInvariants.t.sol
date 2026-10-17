// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {ImdFixture, IUniversalRouter, IPermit2Allowance} from "./ImdFixture.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";

contract QuotaMitigationHandler is Test {
    UnlkImdHook public immutable hook;
    IERC20 public immutable token;
    IERC20 public constant imd = IERC20(MainnetPins.IMD_ADDRESS);
    address[3] public actors;
    mapping(address => uint256) public purchased;
    mapping(address => uint256) public executedSales;
    mapping(address => uint256) public delayed;
    mapping(address => uint256) public boughtBlock;
    uint256 public successes;

    constructor(UnlkImdHook h) {
        hook = h;
        token = IERC20(address(h.token()));
        for (uint256 i; i < 3; i++) {
            actors[i] = address(uint160(uint256(keccak256(abi.encode("quota invariant actor", i)))));
            vm.startPrank(actors[i]);
            token.approve(MainnetPins.PERMIT2_ADDRESS, type(uint256).max);
            imd.approve(MainnetPins.PERMIT2_ADDRESS, type(uint256).max);
            IPermit2Allowance(MainnetPins.PERMIT2_ADDRESS)
                .approve(address(token), MainnetPins.ROUTER_ADDRESS, type(uint160).max, type(uint48).max);
            IPermit2Allowance(MainnetPins.PERMIT2_ADDRESS)
                .approve(address(imd), MainnetPins.ROUTER_ADDRESS, type(uint160).max, type(uint48).max);
            vm.stopPrank();
        }
    }

    struct Swap {
        PoolKey key;
        bool zeroForOne;
        uint128 amount;
        uint128 minimum;
        bytes hookData;
    }

    function _trade(address who, bool buy, uint256 amount) private returns (bool ok) {
        PoolKey memory key = hook.poolKey();
        bytes[] memory p = new bytes[](3);
        p[0] = abi.encode(Swap(key, buy != hook.tokenIs0(), uint128(amount), 1, ""));
        p[1] = abi.encode(buy ? address(imd) : address(token), amount);
        p[2] = abi.encode(buy ? address(token) : address(imd), uint256(1));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0f", p);
        vm.prank(who);
        (ok,) = MainnetPins.ROUTER_ADDRESS
            .call(abi.encodeCall(IUniversalRouter.execute, (hex"10", inputs, block.timestamp)));
    }

    function buy(uint256 actor, uint96 raw) external {
        address who = actors[actor % 3];
        uint256 amount = bound(raw, 1e10, 30 ether);
        vm.store(address(imd), keccak256(abi.encode(who, uint256(5))), bytes32(imd.balanceOf(who) + amount));
        uint256 before = token.balanceOf(who);
        if (_trade(who, true, amount)) {
            uint256 got = token.balanceOf(who) - before;
            purchased[who] += got;
            if (boughtBlock[who] != block.number) {
                delayed[who] = got;
                boughtBlock[who] = block.number;
            } else {
                delayed[who] += got;
            }
            successes++;
        }
    }

    function sell(uint256 actor, uint96 raw) external {
        address who = actors[actor % 3];
        uint256 balance = token.balanceOf(who);
        if (balance == 0) return;
        uint256 amount = bound(raw, 1, balance);
        if (_trade(who, false, amount)) {
            executedSales[who] += amount;
            successes++;
        }
    }

    function transfer(uint256 from, uint256 to, uint96 raw) external {
        address who = actors[from % 3];
        uint256 balance = token.balanceOf(who);
        if (balance == 0) return;
        vm.prank(who);
        token.transfer(actors[to % 3], bound(raw, 0, balance));
    }

    function nextBlock() external {
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 12);
    }
}

contract QuotaMitigationInvariantTest is ImdFixture {
    QuotaMitigationHandler handler;

    function setUp() public override {
        super.setUp();
        handler = new QuotaMitigationHandler(hook);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = handler.buy.selector;
        selectors[1] = handler.sell.selector;
        selectors[2] = handler.transfer.selector;
        selectors[3] = handler.nextBlock.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariantDirectRightsMatchOnlyExecutedAcquisitionsAndSales() public view {
        for (uint256 i; i < 3; i++) {
            address a = handler.actors(i);
            uint256 e = handler.purchased(a);
            uint256 s = handler.executedSales(a);
            assertEq(hook.eligible(a), e);
            assertEq(hook.sold(a), s);
            uint256 mature = e - (handler.boughtBlock(a) == block.number ? handler.delayed(a) : 0);
            assertEq(hook.spendableEligible(a), mature);
            assertLe(s, mature / 5);
            assertEq(hook.remainingQuota(a), mature / 5 - s);
        }
        assertEq(hook.tier(), 0);
    }

    function invariantFeeReceiptsAndProtectedPrincipalRemainConserved() public view {
        assertEq(manager.balanceOf(address(vault), uint160(address(quote))), vault.totalAccrued());
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
        assertFalse(hook.fullyUnlocked());
    }
}
