// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SuccessorFixture} from "./SuccessorFixture.sol";
import {SuccessorFeeMath} from "../../src/successor/SuccessorFeeMath.sol";
import {UnlkHookV3} from "../../src/successor/UnlkHookV3.sol";
import {NftFeeVault} from "../../src/candidate/NftFeeVault.sol";
import {UnlkToken} from "../../src/UnlkToken.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {Test} from "forge-std/Test.sol";

interface IRouterLike {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @dev Random standard-router traffic from three initiators, including diverted delivery and transfers.
contract SuccessorHandler is Test {
    address internal constant ROUTER = 0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b;
    UnlkHookV3 internal immutable hook;
    UnlkToken internal immutable token;
    NftFeeVault internal immutable vault;
    PoolKey internal key;
    address[3] public actors;
    uint256 public ghostBuyFees;
    uint256 public ghostCredited;
    uint256 public ghostSold;
    uint256 public settled;

    struct ExactIn {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    constructor(
        UnlkHookV3 hook_,
        UnlkToken token_,
        NftFeeVault vault_,
        PoolKey memory key_,
        address[3] memory a
    ) {
        hook = hook_;
        token = token_;
        vault = vault_;
        key = key_;
        actors = a;
    }

    function _plan(bool buy, uint256 amount, address recipient)
        internal
        view
        returns (bytes[] memory inputs)
    {
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(ExactIn(key, buy, uint128(amount), 1, bytes("")));
        params[1] = abi.encode(buy ? key.currency0 : key.currency1, amount);
        params[2] = recipient == address(0)
            ? abi.encode(buy ? key.currency1 : key.currency0, uint256(1))
            : abi.encode(key.currency1, recipient, uint256(0));
        inputs = new bytes[](1);
        inputs[0] = abi.encode(recipient == address(0) ? bytes(hex"060c0f") : bytes(hex"060c0e"), params);
    }

    function buy(uint256 who, uint256 to, uint256 amount) external {
        address initiator = actors[who % 3];
        address recipient = to % 2 == 0 ? address(0) : actors[to % 3];
        amount = bound(amount, 0.0001 ether, 5 ether);
        vm.deal(initiator, amount);
        uint256 credit = hook.eligible(initiator);
        vm.prank(initiator);
        try IRouterLike(ROUTER).execute{value: amount}(
            hex"10", _plan(true, amount, recipient), block.timestamp
        ) {
            (, uint256 fee) = SuccessorFeeMath.exactInputBuyFee(amount);
            ghostBuyFees += fee;
            ghostCredited += hook.eligible(initiator) - credit;
            ++settled;
        } catch {}
    }

    function sell(uint256 who, uint256 bps) external {
        address initiator = actors[who % 3];
        uint256 amount = Math.mulDiv(token.balanceOf(initiator), bound(bps, 1, 10000), 10000);
        if (amount == 0) return;
        uint256 before = hook.sold(initiator);
        vm.prank(initiator);
        try IRouterLike(ROUTER).execute(hex"10", _plan(false, amount, address(0)), block.timestamp) {
            ghostSold += hook.sold(initiator) - before;
            ++settled;
        } catch {}
    }

    function transfer(uint256 from, uint256 to, uint256 bps) external {
        address a = actors[from % 3];
        uint256 amount = Math.mulDiv(token.balanceOf(a), bound(bps, 0, 10000), 10000);
        vm.prank(a);
        token.transfer(actors[to % 3], amount);
    }
}

contract SuccessorInvariantTest is SuccessorFixture {
    SuccessorHandler internal handler;
    address internal carol;

    function setUp() public override {
        super.setUp();
        carol = makeAddr("local Carol");
        _approveRouter(carol);
        handler = new SuccessorHandler(hook, token, vault, key, [alice, bob, carol]);
        targetContract(address(handler));
    }

    function invariant_quotaNeverExceededForAnyInitiator() public view {
        for (uint256 i; i < 3; ++i) {
            address a = handler.actors(i);
            assertLe(hook.sold(a), Math.mulDiv(hook.eligible(a), hook.p(), 10000));
        }
    }

    function invariant_creditsEqualExecutedBuysOnly() public view {
        uint256 sum;
        for (uint256 i; i < 3; ++i) {
            sum += hook.eligible(handler.actors(i));
        }
        assertEq(sum, handler.ghostCredited(), "no credit from transfers or deliveries");
    }

    function invariant_feesAreNativeClaimsAndNeverUnlk() public view {
        assertGe(vault.totalAccrued(), handler.ghostBuyFees());
        assertEq(IPoolManager(MANAGER).balanceOf(address(vault), 0), vault.totalAccrued());
        assertEq(token.balanceOf(address(vault)), 0);
        assertEq(token.balanceOf(address(hook)), 0);
        assertEq(address(hook).balance, 0);
        assertEq(ROUTER.balance, 0, "no hidden overpayment retained");
    }
}

/// @dev A second, hookless UNLK/OTHER pool seeded by a local helper so a multihop can run through the real router.
contract SecondPoolSeeder is IUnlockCallback {
    IPoolManager internal immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function seed(PoolKey calldata key) external {
        manager.initialize(key, uint160(1 << 96));
        manager.unlock(abi.encode(key));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        PoolKey memory key = abi.decode(data, (PoolKey));
        (BalanceDelta d,) =
            manager.modifyLiquidity(key, ModifyLiquidityParams(-600, 600, 20_000_000 ether, 0), "");
        _pay(key.currency0, d.amount0());
        _pay(key.currency1, d.amount1());
        return "";
    }

    function _pay(Currency currency, int128 delta) private {
        manager.sync(currency);
        MockERC20(Currency.unwrap(currency)).transfer(address(manager), uint256(-int256(delta)));
        manager.settle();
    }
}

contract SuccessorMultihopTest is SuccessorFixture {
    function testMultihopOfficialLegCreditsInitiatorEvenWhenOutputLeavesUnlk() public {
        MockERC20 other = new MockERC20("Second", "OTHER", 1_000_000 ether);
        SecondPoolSeeder seeder = new SecondPoolSeeder(IPoolManager(MANAGER));
        other.transfer(address(seeder), 1_000_000 ether);
        vm.prank(payer);
        token.transfer(address(seeder), 1_000_000 ether);
        bool tokenFirst = address(token) < address(other);
        PoolKey memory second = PoolKey(
            Currency.wrap(tokenFirst ? address(token) : address(other)),
            Currency.wrap(tokenFirst ? address(other) : address(token)),
            3000,
            60,
            IHooks(address(0))
        );
        seeder.seed(second);
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(ExactIn(key, true, uint128(0.001 ether), 1, bytes("")));
        params[1] = abi.encode(ExactIn(second, tokenFirst, 0, 1, bytes("")));
        params[2] = abi.encode(key.currency0, uint256(0.001 ether));
        params[3] = abi.encode(Currency.wrap(address(other)), uint256(1));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"06060c0f", params);
        _execute(alice, hex"10", inputs, 0.001 ether);
        assertEq(token.balanceOf(alice), 0, "no UNLK delivered");
        assertGt(other.balanceOf(alice), 0);
        assertGt(hook.eligible(alice), 0, "initiator credited for the executed official leg");
    }
}
