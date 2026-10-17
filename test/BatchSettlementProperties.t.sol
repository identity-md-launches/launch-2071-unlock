// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {UnlkSwapRouter} from "src/UnlkSwapRouter.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @dev A forced ETH donation is possible even though the router rejects ordinary ETH transfers.
contract BatchForcedEther {
    constructor(address payable recipient) payable {
        selfdestruct(recipient);
    }
}

/// @notice Compare batching with the same independently settled trades, including refunds, exact-output
/// sales and price-limited fills. Uses the actual v4 manager and the factory's token-only seed: no extra
/// quote position, mocked deltas, forged quota or storage writes.
contract BatchSettlementPropertiesTest is SystemFixture {
    using StateLibrary for IPoolManager;
    using TransientStateLibrary for IPoolManager;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _deployCompanions();
        _activate();
    }

    struct Execution {
        UnlkSwapRouter.SwapRequest[] requests;
        uint256[] inputs;
        uint256[] outputs;
        uint256 value;
        bytes32 finalState;
    }

    function _poolState() internal view returns (bytes32) {
        IPoolManager pm = IPoolManager(address(manager));
        (uint160 sqrt, int24 tick, uint24 protocol, uint24 lp) = pm.getSlot0(hook.poolId());
        (uint256 fees0, uint256 fees1) = pm.getFeeGrowthGlobals(hook.poolId());
        return keccak256(
            abi.encode(
                sqrt,
                tick,
                protocol,
                lp,
                fees0,
                fees1,
                pm.getLiquidity(hook.poolId()),
                _factoryLiquidity(seedLower, seedUpper),
                address(manager).balance,
                token.balanceOf(address(manager))
            )
        );
    }

    function _state() internal view returns (bytes32) {
        bytes32 balances = keccak256(
            abi.encode(
                alice.balance,
                bob.balance,
                address(router).balance,
                token.balanceOf(alice),
                token.balanceOf(bob),
                token.balanceOf(address(router)),
                token.allowance(alice, address(router)),
                router.nativeCredit(alice),
                router.nativeCredit(bob),
                router.totalNativeCredit(),
                router.nonce()
            )
        );
        (address trader, bytes32 operation) = router.context();
        bytes32 accounting = keccak256(
            abi.encode(
                hook.eligible(alice),
                hook.sold(alice),
                hook.eligible(bob),
                hook.sold(bob),
                hook.p(),
                hook.tier(),
                hook.fullyUnlocked(),
                hook.qualifyingSince(0),
                hook.lastConfirmation(),
                trader,
                operation
            )
        );
        uint256 n = oracle.observationCount();
        (uint64 time, int24 tick, bool liquid, int256 cumulative, uint256 bad) = oracle.observations(n - 1);
        return
            keccak256(abi.encode(balances, accounting, _poolState(), n, time, tick, liquid, cumulative, bad));
    }

    function _assertSettled() internal view {
        IPoolManager pm = IPoolManager(address(manager));
        assertFalse(pm.isUnlocked(), "manager must be locked after the route");
        assertEq(pm.getNonzeroDeltaCount(), 0, "unsettled manager debt or credit");
        assertEq(pm.currencyDelta(address(router), key.currency0), 0);
        assertEq(pm.currencyDelta(address(router), key.currency1), 0);
        (address trader, bytes32 operation) = router.context();
        assertEq(trader, address(0));
        assertEq(operation, bytes32(0));
    }

    function _preexistingLiabilitiesAndDonations() internal {
        vm.prank(bob);
        router.swap{value: 1 ether}(_request(true, int256(2000 ether), 1 ether));
        assertGt(router.nativeCredit(bob), 0);
        vm.prank(payer);
        token.transfer(address(router), 17 ether);
        vm.deal(address(this), 0.333 ether);
        new BatchForcedEther{value: 0.333 ether}(payable(address(router)));
    }

    /// @dev The reference path actually executes each call separately. Requests use real state so the
    /// limited-price branch always fills partially and subsequent sells have earned quota and balance.
    function _sequential(uint256 seed, uint256 count) internal returns (Execution memory e) {
        e.requests = new UnlkSwapRouter.SwapRequest[](count);
        e.inputs = new uint256[](count);
        e.outputs = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            uint256 random = uint256(keccak256(abi.encode(seed, i)));
            UnlkSwapRouter.SwapRequest memory request;
            if (i % 5 == 0) {
                uint256 tokens = bound(random, 1000 ether, 10000 ether);
                request = _request(true, int256(tokens), 0.01 ether);
            } else if (i % 5 == 1) {
                request = _request(false, -int256(10 ether), 10 ether);
            } else if (i % 5 == 2) {
                uint256 ethIn = bound(random, 0.001 ether, 0.01 ether);
                request = _request(true, -int256(ethIn), ethIn);
            } else if (i % 5 == 3) {
                request = _request(false, int256(bound(random, 1e9, 1e10)), 10 ether);
            } else {
                request = _request(true, -int256(1 ether), 1 ether);
                (uint160 price,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
                request.sqrtPriceLimitX96 = uint160(uint256(price) * 9999 / 10000);
            }
            e.requests[i] = request;
            uint256 value = request.zeroForOne ? request.maxInput : 0;
            e.value += value;
            vm.prank(alice);
            (e.inputs[i], e.outputs[i]) = router.swap{value: value}(request);
            if (i % 5 == 4) {
                assertLt(e.inputs[i], request.maxInput, "exercise partial fills");
                assertGt(e.inputs[i], 0);
            }
            _assertSettled();
        }
        e.finalState = _state();
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_BatchEqualsSequentialExecution(uint256 seed, uint8 length, bool dirty) public {
        if (dirty) _preexistingLiabilitiesAndDonations();
        uint256 count = bound(length, 1, 16);
        uint256 snapshot = vm.snapshotState();
        Execution memory e = _sequential(seed, count);
        assertTrue(vm.revertToStateAndDelete(snapshot));
        vm.prank(alice);
        (uint256[] memory inputs, uint256[] memory outputs) = router.swapBatch{value: e.value}(e.requests);
        assertEq(inputs, e.inputs, "batch must charge the same executed inputs");
        assertEq(outputs, e.outputs, "batch must deliver the same outputs");
        assertEq(_state(), e.finalState, "batch diverged from independent settlements");
        _assertSettled();
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_FailureAtAnyBatchIndexRestoresAllowancesFeesAndCredits(uint256 seed, uint8 index)
        public
    {
        _preexistingLiabilitiesAndDonations();
        // A finite allowance makes consumption (and rollback) observable.
        vm.prank(alice);
        token.approve(address(router), 100 ether);
        bytes32 original = _state();
        uint256 snapshot = vm.snapshotState();
        Execution memory e = _sequential(seed, 16);
        assertTrue(vm.revertToStateAndDelete(snapshot));
        uint256 failingIndex = uint256(index) % 16;
        e.requests[failingIndex].minOutput = type(uint256).max;
        vm.prank(alice);
        vm.expectRevert(UnlkSwapRouter.Slippage.selector);
        router.swapBatch{value: e.value}(e.requests);
        assertEq(
            _state(), original, "failed suffix retained a prefund, fee, credit, observation or allowance"
        );
        _assertSettled();

        // A failure cannot leave a live callback or reentrancy flag which strands subsequent trading.
        e.requests[failingIndex].minOutput = 1;
        vm.prank(alice);
        router.swapBatch{value: e.value}(e.requests);
        assertEq(_state(), e.finalState);
        _assertSettled();
    }

    function test_MaximumMixedBatchOnFreshTokenOnlyManager() public {
        assertEq(address(manager).balance, 0, "fresh manager has no ETH subsidy");
        uint256 snapshot = vm.snapshotState();
        Execution memory e = _sequential(42, 16);
        assertTrue(vm.revertToStateAndDelete(snapshot));
        vm.prank(alice);
        router.swapBatch{value: e.value}(e.requests);
        assertEq(_state(), e.finalState);
        uint256 balanceBefore = alice.balance;
        uint256 credit = router.nativeCredit(alice);
        vm.prank(alice);
        router.withdrawNative();
        assertEq(alice.balance, balanceBefore + credit);
        assertEq(address(router).balance, 0);
        assertEq(router.totalNativeCredit(), 0);
        _assertSettled();
    }

    function test_PartialSaleMayPrefundMoreThanQuotaButChargesOnlyExecution() public {
        uint256 bought = _buy(alice, 10 ether);
        uint256 quota = hook.remainingQuota(alice);
        assertGt(bought, quota);
        uint256 beforeBalance = token.balanceOf(alice);
        (uint160 price,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        UnlkSwapRouter.SwapRequest memory request = _request(false, -int256(bought), bought);
        request.sqrtPriceLimitX96 = uint160(uint256(price) * 10001 / 10000);
        vm.prank(alice);
        token.approve(address(router), bought);
        vm.prank(alice);
        (uint256 input, uint256 output) = router.swap(request);
        assertGt(input, 0);
        assertLt(input, quota, "limited execution fits the real quota");
        assertEq(hook.sold(alice), input);
        assertEq(token.balanceOf(alice), beforeBalance - input);
        assertEq(token.allowance(alice, address(router)), 0, "the whole prefund consumes allowance");
        assertEq(token.balanceOf(address(router)), 0, "unused prefund is refunded");
        assertEq(router.nativeCredit(alice), output);
        assertEq(hook.remainingQuota(alice), quota - input);
        _assertSettled();
    }

    function test_OneWeiShortAllowanceRestoresEntireBatchAndRetryWorks() public {
        UnlkSwapRouter.SwapRequest[] memory requests = new UnlkSwapRouter.SwapRequest[](2);
        requests[0] = _request(true, int256(1000 ether), 1 ether);
        requests[1] = _request(false, -int256(100 ether), 100 ether);
        vm.prank(alice);
        token.approve(address(router), 100 ether - 1);
        bytes32 beforeState = _state();
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSignature(
                "ERC20InsufficientAllowance(address,uint256,uint256)",
                address(router),
                100 ether - 1,
                100 ether
            )
        );
        router.swapBatch{value: 1 ether}(requests);
        assertEq(_state(), beforeState);
        _assertSettled();
        vm.prank(alice);
        token.approve(address(router), 100 ether);
        vm.prank(alice);
        router.swapBatch{value: 1 ether}(requests);
        assertEq(hook.eligible(alice), 1000 ether);
        assertEq(hook.sold(alice), 100 ether);
        assertEq(token.balanceOf(alice), 900 ether);
        assertEq(token.allowance(alice, address(router)), 0);
        _assertSettled();
    }
}
