// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {RecordedRuntime} from "./RecordedRuntime.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

interface IRecordedRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
    function msgSender() external view returns (address);
}

interface IRecordedPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IRecordedQuoter {
    struct Quote {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 exactAmount;
        bytes hookData;
    }
    function quoteExactInputSingle(Quote calldata q) external returns (uint256, uint256);
    function quoteExactOutputSingle(Quote calldata q) external returns (uint256, uint256);
    function _quoteExactInputSingle(Quote calldata q) external returns (bytes memory);
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

/// @dev Diagnostic observer, deliberately NOT a quota hook. Captures exactly the information a hook gets.
contract RouteObserver {
    address immutable manager;
    bytes32 public beforeObservation;
    bytes32 public afterObservation;
    address public logicalSender;
    uint256 public observations;

    constructor(address manager_) {
        manager = manager_;
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata p, bytes calldata data)
        external
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        require(msg.sender == manager);
        (bool ok, bytes memory logical) = sender.staticcall(abi.encodeCall(IRecordedRouter.msgSender, ()));
        logicalSender = ok && logical.length == 32 ? abi.decode(logical, (address)) : address(0);
        beforeObservation = keccak256(abi.encode(sender, key, p, data, logicalSender));
        ++observations;
        return (IHooks.beforeSwap.selector, BeforeSwapDelta.wrap(0), 0);
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata p,
        BalanceDelta d,
        bytes calldata data
    ) external returns (bytes4, int128) {
        require(msg.sender == manager);
        afterObservation = keccak256(abi.encode(sender, key, p, d, data, logicalSender));
        return (IHooks.afterSwap.selector, 0);
    }
}

contract RecordedSmartWallet {
    function execute(address target, bytes calldata data) external payable {
        (bool ok, bytes memory reason) = target.call{value: msg.value}(data);
        if (!ok) {
            assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
        }
    }
}

contract RecordedRouterTest is Test, IUnlockCallback {
    using StateLibrary for IPoolManager;
    address internal constant MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant ROUTER = 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;
    address internal constant QUOTER = 0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    IPoolManager internal manager = IPoolManager(MANAGER);
    MockERC20 internal token;
    RouteObserver internal observer;
    PoolKey internal key;
    address internal alice;
    address internal bob;

    struct SwapIn {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    function setUp() public virtual {
        _prepare(true);
    }

    function _prepare(bool offline) internal {
        if (offline) {
            vm.chainId(11155111);
            vm.warp(1_800_000_000);
            vm.etch(MANAGER, RecordedRuntime.manager());
            vm.etch(ROUTER, RecordedRuntime.router());
            vm.etch(QUOTER, RecordedRuntime.quoter());
            vm.etch(PERMIT2, RecordedRuntime.permit2());
        }
        assertEq(MANAGER.codehash, keccak256(RecordedRuntime.manager()));
        assertEq(ROUTER.codehash, keccak256(RecordedRuntime.router()));
        assertEq(QUOTER.codehash, keccak256(RecordedRuntime.quoter()));
        assertEq(PERMIT2.codehash, keccak256(RecordedRuntime.permit2()));
        alice = makeAddr("counterexample Alice");
        bob = makeAddr("counterexample Bob");
        token = new MockERC20("Diagnostic", "DIAG", 1_000_000 ether);
        bytes memory code = abi.encodePacked(type(RouteObserver).creationCode, abi.encode(MANAGER));
        bytes32 h = keccak256(code);
        for (uint256 i;; ++i) {
            address at = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), bytes32(i), h))))
            );
            if (uint160(at) & 0x3fff != 0xc0) continue;
            observer = new RouteObserver{salt: bytes32(i)}(MANAGER);
            break;
        }
        key = PoolKey(
            Currency.wrap(address(0)), Currency.wrap(address(token)), 12500, 60, IHooks(address(observer))
        );
        manager.initialize(key, uint160(1 << 96));
        vm.deal(address(this), 1000 ether);
        manager.unlock(abi.encode(key));
        vm.deal(alice, 100 ether);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == MANAGER);
        PoolKey memory seedKey = abi.decode(data, (PoolKey));
        (BalanceDelta d,) =
            manager.modifyLiquidity(seedKey, ModifyLiquidityParams(-600, 600, 10000 ether, bytes32(0)), "");
        _settle(seedKey.currency0, d.amount0());
        _settle(seedKey.currency1, d.amount1());
        return "";
    }

    function _settle(Currency currency, int128 delta) private {
        manager.sync(currency);
        uint256 owed = uint256(-int256(delta));
        if (currency.isAddressZero()) {
            manager.settle{value: owed}();
        } else {
            MockERC20(Currency.unwrap(currency)).transfer(MANAGER, owed);
            manager.settle();
        }
    }

    function testBatchBuysCanAggregateDeliveryToAnotherWallet() public {
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(SwapIn(key, true, uint128(1 ether), 1, ""));
        params[1] = params[0];
        params[2] = abi.encode(key.currency0, uint256(2 ether));
        params[3] = abi.encode(key.currency1, bob, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"06060c0e", params);
        vm.prank(alice);
        IRecordedRouter(ROUTER).execute{value: 2 ether}(hex"10", inputs, block.timestamp);
        assertEq(observer.observations(), 2);
        assertEq(observer.logicalSender(), alice);
        assertEq(token.balanceOf(alice), 0);
        assertGt(token.balanceOf(bob), 0);
    }

    function testMultihopBuyOutputNeverDeliveredToAnyWallet() public {
        MockERC20 other = new MockERC20("Second diagnostic", "OTHER", 1_000_000 ether);
        bool tokenFirst = address(token) < address(other);
        PoolKey memory second = PoolKey(
            Currency.wrap(tokenFirst ? address(token) : address(other)),
            Currency.wrap(tokenFirst ? address(other) : address(token)),
            12500,
            60,
            IHooks(address(0))
        );
        manager.initialize(second, uint160(1 << 96));
        manager.unlock(abi.encode(second));
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(SwapIn(key, true, uint128(1 ether), 1, ""));
        params[1] = abi.encode(SwapIn(second, tokenFirst, 0, 1, ""));
        params[2] = abi.encode(key.currency0, uint256(1 ether));
        params[3] = abi.encode(Currency.wrap(address(other)), uint256(1));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"06060c0f", params);
        vm.prank(alice);
        IRecordedRouter(ROUTER).execute{value: 1 ether}(hex"10", inputs, block.timestamp);
        assertEq(observer.observations(), 1);
        assertEq(observer.logicalSender(), alice);
        assertEq(token.balanceOf(alice), 0);
        assertGt(other.balanceOf(alice), 0);
    }

    function _plan(bool buy, bool takeBob, bool prefund, uint128 amount)
        internal
        view
        returns (bytes[] memory inputs)
    {
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(SwapIn(key, buy, amount, 1, ""));
        Currency input = buy ? key.currency0 : key.currency1;
        Currency output = buy ? key.currency1 : key.currency0;
        params[1] = prefund ? abi.encode(input, uint256(0), false) : abi.encode(input, uint256(amount));
        params[2] = takeBob ? abi.encode(output, bob, uint256(0)) : abi.encode(output, uint256(1));
        bytes memory actions = abi.encodePacked(
            bytes1(0x06), prefund ? bytes1(0x0b) : bytes1(0x0c), takeBob ? bytes1(0x0e) : bytes1(0x0f)
        );
        inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
    }

    function testCounterexampleTakeAllVersusTakeBobIdenticalHookObservations() public {
        uint256 snap = vm.snapshotState();
        bytes[] memory plan = _plan(true, false, false, 1 ether);
        vm.prank(alice);
        IRecordedRouter(ROUTER).execute{value: 1 ether}(hex"10", plan, block.timestamp);
        uint256 output = token.balanceOf(alice);
        bytes32 beforeHash = observer.beforeObservation();
        bytes32 afterHash = observer.afterObservation();
        assertGt(output, 0);
        assertEq(token.balanceOf(bob), 0);
        assertEq(observer.logicalSender(), alice);
        vm.revertToState(snap);
        plan = _plan(true, true, false, 1 ether);
        vm.prank(alice);
        IRecordedRouter(ROUTER).execute{value: 1 ether}(hex"10", plan, block.timestamp);
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(bob), output);
        assertEq(observer.beforeObservation(), beforeHash);
        assertEq(observer.afterObservation(), afterHash);
        assertEq(observer.logicalSender(), alice);
        emit log_named_uint("Same executed output; different beneficiary", output);
        emit log_named_bytes32("Identical beforeSwap observation", beforeHash);
        emit log_named_bytes32("Identical afterSwap observation", afterHash);
    }

    function testPermit2UserSourceVersusRouterPrefundingSameLogicalSender() public {
        token.transfer(alice, 1 ether);
        token.transfer(bob, 1 ether);
        vm.startPrank(alice);
        token.approve(PERMIT2, type(uint256).max);
        IRecordedPermit2(PERMIT2)
            .approve(address(token), ROUTER, type(uint160).max, uint48(block.timestamp + 1 days));
        vm.stopPrank();
        // Identical initial state in BOTH runs, including router and wallet balances. Only a later
        // settlement instruction changes who supplies tokens after the hook has finished observing.
        vm.prank(bob);
        token.transfer(ROUTER, 1 ether);
        uint256 snap = vm.snapshotState();
        bytes[] memory plan = _plan(false, false, false, 1 ether);
        vm.prank(alice);
        IRecordedRouter(ROUTER).execute(hex"10", plan, block.timestamp);
        bytes32 beforeHash = observer.beforeObservation();
        bytes32 afterHash = observer.afterObservation();
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(bob), 0);
        assertEq(token.balanceOf(ROUTER), 1 ether, "prefunding is untouched when Alice pays");
        vm.revertToState(snap);
        plan = _plan(false, false, true, 1 ether);
        vm.prank(alice);
        IRecordedRouter(ROUTER).execute(hex"10", plan, block.timestamp);
        assertEq(token.balanceOf(alice), 1 ether, "Alice supplied no sale tokens");
        assertEq(token.balanceOf(bob), 0, "Bob funded this sale");
        assertEq(token.balanceOf(ROUTER), 0, "the prefunded tokens paid instead");
        assertEq(observer.beforeObservation(), beforeHash);
        assertEq(observer.afterObservation(), afterHash);
        assertEq(observer.logicalSender(), alice);
    }

    function testSmartWalletDoesNotRevealTakeBeneficiary() public {
        RecordedSmartWallet wallet = new RecordedSmartWallet();
        bytes[] memory plan = _plan(true, true, false, 1 ether);
        wallet.execute{value: 1 ether}(
            ROUTER, abi.encodeCall(IRecordedRouter.execute, (hex"10", plan, block.timestamp))
        );
        assertEq(observer.logicalSender(), address(wallet));
        assertGt(token.balanceOf(bob), 0);
        assertEq(token.balanceOf(address(wallet)), 0);
    }

    function testActualQuoterCannotCommitPoolTradesOrHookWrites() public {
        (uint160 beforePrice,,,) = manager.getSlot0(key.toId());
        uint256 beforeEth = MANAGER.balance;
        uint256 beforeToken = token.balanceOf(MANAGER);
        IRecordedQuoter.Quote memory q = IRecordedQuoter.Quote(key, true, uint128(1 ether), "");
        vm.prank(alice);
        (uint256 output,) = IRecordedQuoter(QUOTER).quoteExactInputSingle(q);
        assertGt(output, 0);
        (uint160 afterPrice,,,) = manager.getSlot0(key.toId());
        assertEq(afterPrice, beforePrice);
        assertEq(observer.observations(), 0);
        assertEq(MANAGER.balance, beforeEth);
        assertEq(token.balanceOf(MANAGER), beforeToken);
        assertEq(token.balanceOf(alice), 0);
        vm.expectRevert();
        IRecordedQuoter(QUOTER)._quoteExactInputSingle(q);
        vm.expectRevert();
        IRecordedQuoter(QUOTER).unlockCallback(abi.encodeCall(IRecordedQuoter._quoteExactInputSingle, (q)));
    }
    receive() external payable {}
}
