// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {MockEthUsd} from "./fixtures/LocalFixtures.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {UnlkHook} from "../src/UnlkHook.sol";
import {UnlkOracle} from "../src/UnlkOracle.sol";
import {UnlkToken} from "../src/UnlkToken.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Pool} from "v4-core/src/libraries/Pool.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

/// @notice Properties of the revised router (2026-10-13): every swap's price limit is clamped to the factory's
/// seed range read from the hook. The fixture is the Sepolia-faithful token-only seed with no local quote
/// depth, so the seed range is the pool's only liquidity exactly as on the public chain.
///
/// The clamp is checked three ways: (1) under fuzzed caller limits the executed result equals the result of
/// passing the clamped limit explicitly, and a tighter caller limit is still honoured; (2) the failure paths the
/// clamp creates (a sell in the launch state, an exact-output sell beyond the reserve) revert without leaving
/// state, so retries work; (3) a random trade campaign never leaves the seed range, never records an illiquid
/// observation, never moves the locked principal and keeps the manager's assets equal to executed flows.
contract SeedRangeLimitPropertiesTest is SystemFixture {
    using StateLibrary for IPoolManager;

    uint160 internal floorSqrt;
    uint160 internal ceilingSqrt;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _deployCompanions();
        _activate();
        floorSqrt = TickMath.getSqrtPriceAtTick(seedLower);
        ceilingSqrt = TickMath.getSqrtPriceAtTick(seedUpper);
        assertEq(hook.seedTickLower(), seedLower);
        assertEq(hook.seedTickUpper(), seedUpper);
    }

    // ------------------------------------------------------------------ helpers

    function _slot0() internal view returns (uint160 sqrtPrice, int24 tick) {
        (sqrtPrice, tick,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
    }

    struct Outcome {
        bool ok;
        bytes32 revertHash;
        uint256 input;
        uint256 output;
        uint160 price;
        uint256 sold;
        uint256 eligible;
        uint256 nonce;
    }

    /// @dev Executes one swap as `who` and records everything observable about it, including the exact revert.
    function _attempt(address who, UnlkSwapRouter.SwapRequest memory request, uint256 value)
        internal
        returns (Outcome memory o)
    {
        if (value > 0) vm.deal(who, who.balance + value);
        vm.prank(who);
        try router.swap{value: value}(request) returns (uint256 input, uint256 output) {
            o.ok = true;
            o.input = input;
            o.output = output;
        } catch (bytes memory data) {
            o.revertHash = keccak256(data);
        }
        (o.price,) = _slot0();
        o.sold = hook.sold(who);
        o.eligible = hook.eligible(who);
        o.nonce = router.nonce();
    }

    function _assertSame(Outcome memory a, Outcome memory b) internal pure {
        assertEq(a.ok, b.ok, "success differs");
        assertEq(a.revertHash, b.revertHash, "revert differs");
        assertEq(a.input, b.input, "input differs");
        assertEq(a.output, b.output, "output differs");
        assertEq(a.price, b.price, "end price differs");
        assertEq(a.sold, b.sold, "sold differs");
        assertEq(a.eligible, b.eligible, "eligible differs");
        assertEq(a.nonce, b.nonce, "nonce differs");
    }

    // ------------------------------------------------------------------ failure paths

    /// @dev Launch state: the price sits on the seed's upper boundary and the pool holds no ETH. The clamp turns
    /// the client's open limit into the boundary itself, which v4 refuses as already exceeded. Nothing is sold,
    /// no nonce is consumed and the prefund returns with the revert.
    function testLaunchStateSellRevertsAsPriceLimitAlreadyExceeded() public {
        hook.syncPayer();
        uint256 quota = hook.remainingQuota(payer);
        assertGt(quota, 0);
        (uint160 price,) = _slot0();
        assertEq(price, ceilingSqrt, "launch state is the seed's upper boundary");
        uint256 nonceBefore = router.nonce();
        uint256 held = token.balanceOf(payer);
        vm.prank(payer);
        vm.expectRevert(
            abi.encodeWithSelector(Pool.PriceLimitAlreadyExceeded.selector, ceilingSqrt, ceilingSqrt)
        );
        router.swap(_request(false, -int256(quota), quota));
        assertEq(router.nonce(), nonceBefore);
        assertEq(hook.sold(payer), 0);
        assertEq(token.balanceOf(payer), held);
        assertEq(token.allowance(payer, address(router)), type(uint256).max, "prefund approval untouched");
        // The same caller limit that is refused in the launch state works once there is a reserve to sell into.
        _buy(alice, 0.2 ether);
        vm.prank(payer);
        (uint256 input, uint256 output) = router.swap(_request(false, -int256(quota), quota));
        assertGt(input, 0);
        assertGt(output, 0);
        assertEq(hook.sold(payer), input);
    }

    /// @dev An exact-output sale asking for more ETH than the seed range holds stops at the boundary, which the
    /// router treats as an unfilled exact output: `Slippage`, with every balance and counter restored.
    function testExactOutputSellBeyondTheReserveRevertsSlippageWithoutState() public {
        // A reserve worth less than the payer's quota, so the boundary is reached before the quota is.
        _buy(alice, 0.05 ether);
        uint256 reserve = address(manager).balance;
        assertGt(reserve, 0);
        hook.syncPayer();
        uint256 quota = hook.remainingQuota(payer);
        uint256 held = token.balanceOf(payer);
        uint256 nonceBefore = router.nonce();
        uint256 observations = oracle.observationCount();
        UnlkSwapRouter.SwapRequest memory request = _request(false, int256(reserve + 1), quota);
        vm.prank(payer);
        vm.expectRevert(UnlkSwapRouter.Slippage.selector);
        router.swap(request);
        assertEq(token.balanceOf(payer), held);
        assertEq(hook.sold(payer), 0);
        assertEq(router.nonce(), nonceBefore);
        assertEq(oracle.observationCount(), observations, "no observation from a reverted trade");
        (uint160 price,) = _slot0();
        assertLt(price, ceilingSqrt, "the post-buy price is untouched");
        // Half the reserve is an exact output the range can fill: the corrected request succeeds.
        request = _request(false, int256(reserve / 2), quota);
        vm.prank(payer);
        (uint256 input, uint256 output) = router.swap(request);
        assertEq(output, reserve / 2);
        assertEq(hook.sold(payer), input);
    }

    /// @dev A caller limit beyond the seed's lower boundary is clamped for buys too: the open client limit and the
    /// floor itself execute identically, and a limit above the current price is refused before any state change.
    function testBuyLimitBelowTheFloorIsClampedAndLimitAboveThePriceIsRefused() public {
        UnlkSwapRouter.SwapRequest memory open = _request(true, -1 ether, 1 ether);
        assertLt(open.sqrtPriceLimitX96, floorSqrt, "the client's open limit is below the seed floor");
        uint256 snap = vm.snapshotState();
        Outcome memory viaOpen = _attempt(alice, open, 1 ether);
        vm.revertToState(snap);
        UnlkSwapRouter.SwapRequest memory clamped = open;
        clamped.sqrtPriceLimitX96 = floorSqrt;
        Outcome memory viaFloor = _attempt(alice, clamped, 1 ether);
        assertTrue(viaOpen.ok && viaFloor.ok);
        _assertSame(viaOpen, viaFloor);
        // A buy whose limit is at or above the current price has nothing to do; v4 refuses it unchanged.
        (uint160 price,) = _slot0();
        UnlkSwapRouter.SwapRequest memory idle = open;
        idle.sqrtPriceLimitX96 = price;
        uint256 nonceBefore = router.nonce();
        uint256 eligibleBefore = hook.eligible(alice);
        vm.deal(alice, alice.balance + 1 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.PriceLimitAlreadyExceeded.selector, price, price));
        router.swap{value: 1 ether}(idle);
        assertEq(router.nonce(), nonceBefore);
        assertEq(hook.eligible(alice), eligibleBefore);
        assertEq(router.nativeCredit(alice), 0, "a reverted buy leaves no refund credit");
    }

    // ------------------------------------------------------------------ fuzz: exact clamp semantics

    /// forge-config: default.fuzz.runs = 512
    /// @dev For any caller limit, executing the request equals executing it with the limit clamped to the seed
    /// range by hand. Inside the range the caller's own limit is honoured: a successful sell either fills in full
    /// or ends exactly on the caller's limit.
    function testFuzzSellLimitIsClampedExactlyToTheSeedCeiling(
        uint96 buyAmount,
        uint160 limitSeed,
        uint8 shape
    ) public {
        uint256 bought = bound(uint256(buyAmount), 1e12, 5 ether);
        _buy(alice, bought);
        // Within the seller's own quota, so the only possible refusal is the price limit.
        uint256 size = hook.remainingQuota(alice) / (1 + (shape % 7));
        assertGt(size, 0);
        (uint160 before,) = _slot0();
        // Three regions: at or below the current price (refused), between the price and the ceiling (honoured)
        // and above the ceiling, including v4's open limit (clamped).
        uint160 limit;
        if (shape % 3 == 0) {
            limit = uint160(bound(uint256(limitSeed), TickMath.MIN_SQRT_PRICE + 1, before));
        } else if (shape % 3 == 1) {
            limit = uint160(bound(uint256(limitSeed), before + 1, ceilingSqrt));
        } else {
            limit = uint160(bound(uint256(limitSeed), ceilingSqrt, TickMath.MAX_SQRT_PRICE - 1));
        }
        UnlkSwapRouter.SwapRequest memory request = _request(false, -int256(size), size);
        request.sqrtPriceLimitX96 = limit;
        uint256 snap = vm.snapshotState();
        Outcome memory viaCaller = _attempt(alice, request, 0);
        vm.revertToState(snap);
        UnlkSwapRouter.SwapRequest memory clamped = request;
        clamped.sqrtPriceLimitX96 = limit > ceilingSqrt ? ceilingSqrt : limit;
        Outcome memory viaClamp = _attempt(alice, clamped, 0);
        _assertSame(viaCaller, viaClamp);
        if (limit <= before) {
            assertFalse(viaCaller.ok, "a limit at or below the price is refused");
            assertEq(
                viaCaller.revertHash,
                keccak256(abi.encodeWithSelector(Pool.PriceLimitAlreadyExceeded.selector, before, limit))
            );
            assertEq(viaCaller.price, before);
            assertEq(viaCaller.sold, 0);
        } else if (!viaCaller.ok) {
            // A limit a few units above the price can only fill dust whose ETH output rounds to zero; the router
            // refuses a zero-output swap and leaves nothing behind. Any other refusal is a failure.
            assertEq(
                viaCaller.revertHash,
                keccak256(abi.encodeWithSelector(UnlkSwapRouter.InvalidSwap.selector)),
                "only a zero-output dust fill may be refused above the price"
            );
            assertEq(viaCaller.price, before);
            assertEq(viaCaller.sold, 0);
            assertEq(token.balanceOf(alice), hook.eligible(alice), "the prefund came back");
        } else {
            uint160 effective = limit > ceilingSqrt ? ceilingSqrt : limit;
            assertLe(viaCaller.price, effective, "never past the effective limit");
            assertLe(viaCaller.price, ceilingSqrt, "never past the seed ceiling");
            if (viaCaller.input < size) {
                assertEq(viaCaller.price, effective, "a partial fill ends exactly on the effective limit");
            }
            assertEq(viaCaller.sold, viaCaller.input, "only the executed input is sold");
            (,, bool liquid,,) = oracle.observations(oracle.observationCount() - 1);
            assertTrue(liquid, "a sale that stops on the boundary is still a liquid observation");
        }
    }

    /// forge-config: default.fuzz.runs = 256
    /// @dev After any sequence of a buy, a reserve-draining sell and a second buy, the price is inside the seed
    /// range and the TWAP is readable a window later: the boundary stop records no illiquid seconds.
    function testFuzzDrainAndRebuyKeepsTheOracleReadable(uint96 first, uint96 second, uint8 delay) public {
        // The payer's 3% allocation quota (7.5M UNLK at p = 2500) is worth about 0.15 ETH at the opening
        // price, so a reserve of at most 0.1 ETH is always drained to the boundary by one quota-sized sale.
        uint256 a = bound(uint256(first), 1e12, 0.1 ether);
        uint256 b = bound(uint256(second), 1e12, 3 ether);
        _buy(alice, a);
        hook.syncPayer();
        _advance(uint256(delay) * 60 + 1);
        uint256 quota = hook.remainingQuota(payer);
        vm.prank(payer);
        (uint256 input, uint256 output) = router.swap(_request(false, -int256(quota), quota));
        assertGt(output, 0);
        assertLt(input, quota, "the reserve runs out before the quota does");
        (uint160 price, int24 tick) = _slot0();
        assertEq(price, ceilingSqrt, "the drain ends on the ceiling");
        assertEq(tick, seedUpper);
        assertEq(hook.sold(payer), input);
        assertEq(address(manager).balance, a - output, "manager ETH equals the executed flow");
        _advance(1);
        assertGt(_buy(bob, b), 0, "trading resumes from the boundary");
        _advance(oracle.WINDOW());
        oracle.checkpoint();
        assertGt(oracle.fdvUsd(), 0, "the window after a boundary stop is priced");
        for (uint256 i; i < oracle.observationCount(); ++i) {
            (,, bool liquid,,) = oracle.observations(i);
            assertTrue(liquid, "every observation of the campaign is liquid");
        }
    }
}

/// @notice Random buys and sells with caller limits drawn from the whole v4 range, exact-input and exact-output,
/// time advances and payer synchronisation against the Sepolia-faithful token-only seed.
contract SeedRangeTradeHandler is Test {
    using StateLibrary for IPoolManager;

    PoolManager internal immutable manager;
    UnlkHook internal immutable hook;
    UnlkSwapRouter internal immutable router;
    UnlkOracle internal immutable oracle;
    UnlkToken internal immutable token;
    MockEthUsd internal immutable feed;
    address[3] internal actors;

    uint256 public ethIn;
    uint256 public ethOut;
    uint256 public tokensOut;
    uint256 public tokensIn;
    mapping(address => uint256) public ghostSold;
    mapping(address => uint256) public ghostBought;
    uint256 public executedTrades;
    uint256 public refusedAtLimit;
    uint256 public refusedSlippage;
    uint256 public refusedQuota;
    uint256 public refusedDust;
    uint256 public clampedLimits;

    constructor(
        PoolManager manager_,
        UnlkHook hook_,
        UnlkSwapRouter router_,
        UnlkOracle oracle_,
        UnlkToken token_,
        MockEthUsd feed_,
        address[3] memory actors_
    ) {
        manager = manager_;
        hook = hook_;
        router = router_;
        oracle = oracle_;
        token = token_;
        feed = feed_;
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % 3];
    }

    function _price() internal view returns (uint160 sqrtPrice) {
        (sqrtPrice,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
    }

    function _limit(uint256 seed, bool zeroForOne) internal view returns (uint160) {
        uint256 mode = seed % 4;
        if (mode == 0) return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        if (mode == 1) return _price();
        return uint160(bound(seed >> 8, TickMath.MIN_SQRT_PRICE + 1, TickMath.MAX_SQRT_PRICE - 1));
    }

    function _request(bool zeroForOne, int256 specified, uint256 maxInput, uint160 limit)
        internal
        view
        returns (UnlkSwapRouter.SwapRequest memory)
    {
        return
            UnlkSwapRouter.SwapRequest(zeroForOne, specified, limit, maxInput, 1, block.timestamp + 1 hours);
    }

    /// @dev Only the two refusals the clamp can produce are tolerated; any other revert fails the campaign.
    function _execute(address who, UnlkSwapRouter.SwapRequest memory request, uint256 value)
        internal
        returns (bool ok, uint256 input, uint256 output)
    {
        uint160 before = _price();
        if (request.zeroForOne
                ? request.sqrtPriceLimitX96 < TickMath.getSqrtPriceAtTick(hook.seedTickLower())
                : request.sqrtPriceLimitX96 > TickMath.getSqrtPriceAtTick(hook.seedTickUpper())) {
            ++clampedLimits;
        }
        if (value > 0) vm.deal(who, who.balance + value);
        vm.prank(who);
        try router.swap{value: value}(request) returns (uint256 i, uint256 o) {
            ++executedTrades;
            return (true, i, o);
        } catch (bytes memory data) {
            bytes4 selector = bytes4(data);
            if (selector == Pool.PriceLimitAlreadyExceeded.selector) {
                // Only when the effective limit cannot move the price in the swap's direction.
                uint160 effective = request.sqrtPriceLimitX96;
                if (request.zeroForOne) {
                    uint160 floor_ = TickMath.getSqrtPriceAtTick(hook.seedTickLower());
                    if (effective < floor_) effective = floor_;
                    require(effective >= before, "refused although the limit was below the price");
                } else {
                    uint160 ceiling = TickMath.getSqrtPriceAtTick(hook.seedTickUpper());
                    if (effective > ceiling) effective = ceiling;
                    require(effective <= before, "refused although the limit was above the price");
                }
                ++refusedAtLimit;
            } else if (selector == UnlkSwapRouter.Slippage.selector) {
                require(request.amountSpecified > 0, "slippage on an exact-input trade with minOutput 1");
                ++refusedSlippage;
            } else if (selector == UnlkSwapRouter.InvalidSwap.selector) {
                // A dust exact-input sale whose ETH output rounds to zero is refused before settlement.
                require(request.amountSpecified < 0 && !request.zeroForOne, "InvalidSwap outside dust sales");
                ++refusedDust;
            } else if (selector == CustomRevert.WrappedError.selector) {
                // v4 wraps hook reverts. The only hook refusal a prefund-bounded request can meet is the
                // quota check on an exact-output sale whose required input exceeds the seller's quota.
                bytes memory payload = new bytes(data.length - 4);
                for (uint256 i; i < payload.length; ++i) {
                    payload[i] = data[i + 4];
                }
                (address target, bytes4 callSelector, bytes memory reason,) =
                    abi.decode(payload, (address, bytes4, bytes, bytes));
                require(
                    target == address(hook) && callSelector == UnlkHook.afterSwap.selector, "foreign wrap"
                );
                require(bytes4(reason) == UnlkHook.QuotaExceeded.selector, "unexpected hook refusal");
                require(request.amountSpecified > 0 && !request.zeroForOne, "quota refusal outside exact-out");
                ++refusedQuota;
            } else {
                assembly {
                    revert(add(data, 32), mload(data))
                }
            }
            require(_price() == before, "a refused trade moved the price");
        }
    }

    function buyExactIn(uint256 actorSeed, uint96 amount, uint256 limitSeed) external {
        address who = _actor(actorSeed);
        uint256 value = bound(uint256(amount), 1e9, 20 ether);
        UnlkSwapRouter.SwapRequest memory request =
            _request(true, -int256(value), value, _limit(limitSeed, true));
        uint256 ethBefore = address(manager).balance;
        uint256 tokenBefore = token.balanceOf(who);
        uint256 creditBefore = router.nativeCredit(who);
        (bool ok, uint256 input, uint256 output) = _execute(who, request, value);
        if (!ok) return;
        uint160 floor_ = TickMath.getSqrtPriceAtTick(hook.seedTickLower());
        uint160 effective = request.sqrtPriceLimitX96 < floor_ ? floor_ : request.sqrtPriceLimitX96;
        require(input <= value, "never more than the value sent");
        require(input == value || _price() == effective, "a partial buy ends exactly on its effective limit");
        require(router.nativeCredit(who) == creditBefore + value - input, "unused ETH is credited back");
        require(address(manager).balance == ethBefore + input, "manager ETH equals the executed input");
        require(token.balanceOf(who) == tokenBefore + output, "buyer receives exactly the output");
        ethIn += input;
        tokensOut += output;
        ghostBought[who] += output;
    }

    function sellExactIn(uint256 actorSeed, uint256 amountSeed, uint256 limitSeed) external {
        address who = _actor(actorSeed);
        uint256 cap = hook.remainingQuota(who);
        uint256 held = token.balanceOf(who);
        if (cap > held) cap = held;
        if (cap == 0) return;
        uint256 size = bound(amountSeed, 1, cap);
        UnlkSwapRouter.SwapRequest memory request =
            _request(false, -int256(size), size, _limit(limitSeed, false));
        uint256 ethBefore = address(manager).balance;
        uint256 soldBefore = hook.sold(who);
        (bool ok, uint256 input, uint256 output) = _execute(who, request, 0);
        if (!ok) return;
        require(input <= size, "never more than the prefund");
        require(token.balanceOf(who) == held - input, "unused prefund returned");
        require(hook.sold(who) == soldBefore + input, "sold counts the executed input only");
        require(address(manager).balance == ethBefore - output, "manager ETH falls by the executed output");
        ethOut += output;
        tokensIn += input;
        ghostSold[who] += input;
    }

    function sellExactOut(uint256 actorSeed, uint256 wantSeed, uint256 limitSeed) external {
        address who = _actor(actorSeed);
        uint256 cap = hook.remainingQuota(who);
        uint256 held = token.balanceOf(who);
        if (cap > held) cap = held;
        if (cap == 0) return;
        uint256 want = bound(wantSeed, 1, address(manager).balance + 1 ether);
        UnlkSwapRouter.SwapRequest memory request =
            _request(false, int256(want), cap, _limit(limitSeed, false));
        uint256 soldBefore = hook.sold(who);
        (bool ok, uint256 input, uint256 output) = _execute(who, request, 0);
        if (!ok) return;
        require(output == want, "an accepted exact output is filled completely");
        require(input <= cap, "never more than the prefund");
        require(hook.sold(who) == soldBefore + input, "sold counts the executed input only");
        ethOut += output;
        tokensIn += input;
        ghostSold[who] += input;
    }

    function advance(uint16 secondsSeed) external {
        vm.warp(block.timestamp + bound(uint256(secondsSeed), 1, 2 hours));
        vm.roll(block.number + 1);
        feed.fresh();
        oracle.checkpoint();
    }

    function syncPayer() external {
        hook.syncPayer();
    }

    function withdraw(uint256 actorSeed) external {
        address who = _actor(actorSeed);
        if (router.nativeCredit(who) == 0) return;
        vm.prank(who);
        router.withdrawNative();
    }
}

/// forge-config: default.invariant.runs = 128
/// forge-config: default.invariant.depth = 48
/// forge-config: default.invariant.fail-on-revert = true
contract SeedRangeInvariantTest is SystemFixture {
    using StateLibrary for IPoolManager;

    SeedRangeTradeHandler internal handler;
    uint160 internal floorSqrt;
    uint160 internal ceilingSqrt;
    uint256 internal managerTokensAtStart;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _deployCompanions();
        _activate();
        floorSqrt = TickMath.getSqrtPriceAtTick(seedLower);
        ceilingSqrt = TickMath.getSqrtPriceAtTick(seedUpper);
        managerTokensAtStart = token.balanceOf(address(manager));
        handler = new SeedRangeTradeHandler(manager, hook, router, oracle, token, feed, [alice, bob, payer]);
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.buyExactIn.selector;
        selectors[1] = handler.sellExactIn.selector;
        selectors[2] = handler.sellExactOut.selector;
        selectors[3] = handler.advance.selector;
        selectors[4] = handler.syncPayer.selector;
        selectors[5] = handler.withdraw.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_PriceNeverLeavesTheSeedRange() public view {
        (uint160 sqrtPrice, int24 tick,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        assertGe(sqrtPrice, floorSqrt, "below the seed floor");
        assertLe(sqrtPrice, ceilingSqrt, "above the seed ceiling");
        assertGe(tick, seedLower);
        assertLe(tick, seedUpper);
    }

    function invariant_EveryObservationIsLiquid() public view {
        uint256 count = oracle.observationCount();
        for (uint256 i; i < count; ++i) {
            (,, bool liquid,, uint256 badSeconds) = oracle.observations(i);
            assertTrue(liquid, "an observation was classed illiquid");
            assertEq(badSeconds, 0, "illiquid seconds were recorded");
        }
    }

    function invariant_PrincipalLockedAndManagerAssetsEqualExecutedFlows() public view {
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity, "seed principal changed");
        assertEq(
            address(manager).balance, handler.ethIn() - handler.ethOut(), "manager ETH is not executed flow"
        );
        assertEq(
            token.balanceOf(address(manager)),
            managerTokensAtStart + handler.tokensIn() - handler.tokensOut(),
            "manager tokens are not executed flow"
        );
    }

    function invariant_SoldMatchesExecutedSalesAndQuota() public view {
        address[3] memory who = [alice, bob, payer];
        for (uint256 i; i < 3; ++i) {
            assertEq(hook.sold(who[i]), handler.ghostSold(who[i]), "sold differs from executed sales");
            uint256 cap = hook.eligible(who[i]) * hook.p() / 10_000;
            assertLe(hook.sold(who[i]), cap, "sold above the quota");
            assertEq(hook.remainingQuota(who[i]), cap - hook.sold(who[i]), "quota formula");
        }
    }

    /// @dev Scripted reachability: each handler branch, including both tolerated refusals, actually runs.
    function testHandlerBranchesAreReachable() public {
        handler.sellExactIn(2, 1, 0);
        assertEq(handler.executedTrades(), 0, "no quota before synchronisation");
        handler.syncPayer();
        handler.sellExactIn(2, 1, 0);
        assertEq(handler.refusedAtLimit(), 1, "launch-state sell is refused at the clamped limit");
        assertEq(handler.clampedLimits(), 1);
        // A reserve below the payer's quota value: the exact output beyond it stops on the boundary.
        handler.buyExactIn(0, 0.05 ether, 0);
        assertEq(handler.executedTrades(), 1);
        handler.sellExactOut(2, type(uint256).max, 0);
        assertEq(handler.refusedSlippage(), 1, "exact output beyond the reserve is refused as slippage");
        handler.sellExactIn(2, type(uint256).max, 0);
        assertEq(handler.executedTrades(), 2, "the drain executes");
        (uint160 price,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        assertEq(price, ceilingSqrt, "and stops on the ceiling");
        handler.advance(600);
        handler.buyExactIn(1, 0.5 ether, 1);
        assertEq(handler.refusedAtLimit(), 2, "a limit at the price is refused");
        handler.buyExactIn(1, 0.5 ether, 2);
        assertEq(handler.executedTrades(), 3);
        // A reserve above the quota value: the exact output beyond it needs more input than the quota allows.
        handler.buyExactIn(0, 2 ether, 0);
        handler.sellExactOut(2, type(uint256).max, 0);
        assertEq(handler.refusedQuota(), 1, "exact output past the quota is the hook's refusal");
        handler.withdraw(2);
        assertEq(router.nativeCredit(payer), 0);
        invariant_PriceNeverLeavesTheSeedRange();
        invariant_EveryObservationIsLiquid();
        invariant_PrincipalLockedAndManagerAssetsEqualExecutedFlows();
        invariant_SoldMatchesExecutedSalesAndQuota();
    }
}
