// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {UnlkHook} from "../src/UnlkHook.sol";
import {UnlkToken} from "../src/UnlkToken.sol";
import {UnlkOracle} from "../src/UnlkOracle.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {MerkleClaimEvidence} from "../src/MerkleClaimEvidence.sol";
import {HookDeployer} from "../src/HookDeployer.sol";
import {OperationHash} from "../src/libraries/OperationHash.sol";
import {IUnlkHookView, IMerkleDistributor, IChainlinkEthUsd} from "../src/interfaces/IIntegration.sol";
import {LaunchFactory} from "./imd/LaunchFactory.sol";
import {MerkleDistributor} from "./imd/MerkleDistributor.sol";
import {MockEthUsd} from "./fixtures/LocalFixtures.sol";
import {StdStorage, stdStorage} from "forge-std/StdStorage.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice The inputs the implementation did not expect: zero, the minimum, the maximum, an empty batch, a batch
/// one too long, the same call twice, a caller who is not who the code assumed. Run on the ACTIVATED system.
contract RouterAndHookFailurePathsTest is SystemFixture {
    using StateLibrary for IPoolManager;

    function _snapshot(address who) internal view returns (bytes32) {
        (uint160 sqrtPrice,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        return keccak256(
            abi.encode(
                hook.eligible(who),
                hook.sold(who),
                token.balanceOf(who),
                who.balance,
                router.nonce(),
                router.totalNativeCredit(),
                oracle.observationCount(),
                sqrtPrice
            )
        );
    }

    function _expectInvalidSwap(UnlkSwapRouter.SwapRequest memory r, uint256 value) internal {
        vm.prank(alice);
        vm.expectRevert(UnlkSwapRouter.InvalidSwap.selector);
        router.swap{value: value}(r);
    }

    function testRouterRefusesDegenerateRequests() public {
        vm.deal(alice, 100 ether);
        bytes32 before = _snapshot(alice);
        UnlkSwapRouter.SwapRequest memory r = _request(true, -1 ether, 1 ether);
        r.amountSpecified = 0;
        _expectInvalidSwap(r, 1 ether);
        r = _request(true, -1 ether, 1 ether);
        r.amountSpecified = type(int256).min;
        _expectInvalidSwap(r, 1 ether);
        r = _request(true, -1 ether, 0);
        _expectInvalidSwap(r, 0);
        r = _request(true, -1 ether, uint256(uint128(type(int128).max)) + 1);
        _expectInvalidSwap(r, 0);
        r = _request(true, -1 ether, 1 ether);
        r.minOutput = 0;
        _expectInvalidSwap(r, 1 ether);
        r = _request(true, -1 ether, 1 ether);
        r.deadline = block.timestamp - 1;
        _expectInvalidSwap(r, 1 ether);
        // ETH attached to a token-input (sell) request, and a native buy with the wrong value.
        _expectInvalidSwap(_request(false, -1 ether, 1 ether), 1 wei);
        _expectInvalidSwap(_request(true, -1 ether, 1 ether), 1 ether - 1);
        assertEq(_snapshot(alice), before, "a refused request changed state");
    }

    function testBatchBoundsAndValueMustMatch() public {
        UnlkSwapRouter.SwapRequest[] memory none = new UnlkSwapRouter.SwapRequest[](0);
        vm.prank(alice);
        vm.expectRevert(UnlkSwapRouter.InvalidSwap.selector);
        router.swapBatch(none);
        UnlkSwapRouter.SwapRequest[] memory many = new UnlkSwapRouter.SwapRequest[](17);
        for (uint256 i; i < 17; ++i) {
            many[i] = _request(true, int256(1 ether), 0.01 ether);
        }
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(UnlkSwapRouter.InvalidSwap.selector);
        router.swapBatch{value: 0.17 ether}(many);
        UnlkSwapRouter.SwapRequest[] memory two = new UnlkSwapRouter.SwapRequest[](2);
        two[0] = _request(true, int256(1 ether), 0.01 ether);
        two[1] = _request(true, int256(1 ether), 0.01 ether);
        vm.prank(alice);
        vm.expectRevert(UnlkSwapRouter.InvalidSwap.selector);
        router.swapBatch{value: 0.03 ether}(two);
        assertEq(hook.eligible(alice), 0);
    }

    /// @dev A batch is one transaction: a later step that fails (an over-quota sale) rolls back the earlier buys.
    function testBatchIsAtomicWhenALaterStepFails() public {
        bytes32 before = _snapshot(alice);
        UnlkSwapRouter.SwapRequest[] memory steps = new UnlkSwapRouter.SwapRequest[](2);
        steps[0] = _request(true, int256(1000 ether), 1 ether);
        steps[1] = _request(false, -int256(500 ether), 500 ether);
        vm.deal(alice, alice.balance + 1 ether);
        vm.prank(alice);
        vm.expectRevert();
        router.swapBatch{value: 1 ether}(steps);
        vm.deal(alice, alice.balance - 1 ether);
        assertEq(_snapshot(alice), before, "a failed batch left state behind");
    }

    function testSlippageRefusalsLeaveNoTrace() public {
        bytes32 before = _snapshot(alice);
        UnlkSwapRouter.SwapRequest memory r = _request(true, -1 ether, 1 ether);
        r.minOutput = type(uint256).max;
        vm.deal(alice, alice.balance + 1 ether);
        vm.prank(alice);
        vm.expectRevert(UnlkSwapRouter.Slippage.selector);
        router.swap{value: 1 ether}(r);
        // Exact output that costs more than the prefunded maximum.
        r = _request(true, int256(100_000_000 ether), 1 ether);
        vm.prank(alice);
        vm.expectRevert(UnlkSwapRouter.Slippage.selector);
        router.swap{value: 1 ether}(r);
        vm.deal(alice, alice.balance - 1 ether);
        assertEq(_snapshot(alice), before);
    }

    /// @dev Exact input stopped by the trader's own price limit: only the executed input is charged and credited,
    /// the unused ETH is a withdrawable credit, and E equals the tokens actually received.
    function testPartialFillAtPriceLimitChargesOnlyExecutedInput() public {
        (uint160 sqrtPrice,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        UnlkSwapRouter.SwapRequest memory r = _request(true, -1 ether, 1 ether);
        r.sqrtPriceLimitX96 = uint160(uint256(sqrtPrice) * 9995 / 10000);
        uint256 tokensBefore = token.balanceOf(alice);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (uint256 input, uint256 output) = router.swap{value: 1 ether}(r);
        assertLt(input, 1 ether, "the limit should stop the fill early");
        assertGt(output, 0);
        assertEq(token.balanceOf(alice) - tokensBefore, output);
        assertEq(hook.eligible(alice), output);
        assertEq(router.nativeCredit(alice), 1 ether - input);
        assertEq(address(router).balance, router.totalNativeCredit());
        assertEq(address(hook).balance, 0, "no hook fee");
        assertEq(token.balanceOf(address(hook)), 0);
        // Exact output cannot partially fill: a price limit that stops it short is a slippage failure.
        _buy(bob, 1 ether);
        (sqrtPrice,,,) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        UnlkSwapRouter.SwapRequest memory sell = _request(false, int256(0.5 ether), hook.remainingQuota(bob));
        sell.sqrtPriceLimitX96 = uint160(uint256(sqrtPrice) * 10005 / 10000);
        vm.prank(bob);
        vm.expectRevert(UnlkSwapRouter.Slippage.selector);
        router.swap(sell);
        assertEq(hook.sold(bob), 0);
    }

    function testRouterCallbackNeedsALiveSwap() public {
        vm.prank(address(manager));
        vm.expectRevert(UnlkSwapRouter.Unauthorized.selector);
        router.unlockCallback(abi.encode(key, SwapParams(true, -1, 1), uint256(1), uint256(1)));
        vm.prank(bob);
        vm.expectRevert(UnlkSwapRouter.Unauthorized.selector);
        router.unlockCallback("");
    }

    function testHookRejectsMalformedRouteDataAndUnknownSenders() public {
        SwapParams memory params = SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1);
        vm.startPrank(address(manager));
        vm.expectRevert(UnlkHook.InvalidRoute.selector);
        hook.beforeSwap(address(router), key, params, new bytes(31));
        vm.expectRevert(UnlkHook.InvalidRoute.selector);
        hook.beforeSwap(address(router), key, params, new bytes(33));
        vm.expectRevert(UnlkHook.InvalidRoute.selector);
        hook.beforeSwap(alice, key, params, abi.encode(uint256(1)));
        // Nothing pending: afterSwap cannot be fed a delta out of band.
        vm.expectRevert(UnlkHook.InvalidRoute.selector);
        hook.afterSwap(address(router), key, params, BalanceDelta.wrap(0), abi.encode(uint256(1)));
        // The pool is bound once; a second initialization from the factory itself is refused.
        vm.expectRevert(UnlkHook.InvalidPool.selector);
        hook.beforeInitialize(address(factory), key, TickMath.getSqrtPriceAtTick(0));
        PoolKey memory wrong = key;
        wrong.tickSpacing = 120;
        vm.expectRevert(UnlkHook.InvalidPool.selector);
        hook.beforeAddLiquidity(address(factory), wrong, ModifyLiquidityParams(-60, 60, 1, 0), "");
        vm.stopPrank();
        assertEq(hook.eligible(alice), 0);
    }

    function testFullUnlockKeepsFeesAndRouterAuthentication() public {
        _localWarmUpBuy(12 ether);
        feed.set(300000e8);
        _fullyConfirm();
        assertTrue(hook.fullyUnlocked());
        // A transfer-only holder may sell now...
        vm.prank(payer);
        token.transfer(bob, 1000 ether);
        _sell(bob, 1000 ether);
        // ...but still only through the router, and the pool fee still accrues to the factory position.
        BypassSwapper bypass = new BypassSwapper(manager);
        vm.deal(address(bypass), 1 ether);
        vm.expectRevert();
        bypass.swap(key, 1 ether);
        (, uint256 f1) = factory.claimFees(LAUNCH_NUMBER);
        assertGt(f1, 0, "LP fee still charged after full unlock");
        (,, uint24 protocolFee, uint24 lpFee) = IPoolManager(address(manager)).getSlot0(hook.poolId());
        assertEq(lpFee, 12500);
        assertEq(protocolFee, 0);
    }

    /// @dev A higher tier widens Q for sales already capped at the lower rate: Q = floor(E*p/10000) - S.
    function testQuotaWidensWithTierAndNeverDoubleCounts() public {
        uint256 e = _buy(alice, 1 ether);
        _sell(alice, e / 4);
        assertEq(hook.remainingQuota(alice), 0);
        vm.expectRevert();
        _sell(alice, 1);
        _localWarmUpBuy(12 ether);
        _advance(oracle.WINDOW());
        oracle.checkpoint();
        // Scale the ETH/USD answer so the TWAP FDV sits at $150K: above the first tier, below the second.
        uint256 baseFdv = oracle.fdvUsd();
        feed.set(int256(Math.mulDiv(2000e8, 150_000 ether, baseFdv)));
        _confirm();
        assertEq(hook.tier(), 1);
        assertEq(hook.p(), 3500);
        uint256 widened = Math.mulDiv(e, 3500, 10000) - e / 4;
        assertEq(hook.remainingQuota(alice), widened);
        vm.expectRevert();
        _sell(alice, widened + 1);
        _sell(alice, widened);
        assertEq(hook.sold(alice), Math.mulDiv(e, 3500, 10000));
    }

    /// @dev One second short of the confirmation hour is not a tier; the full hour is.
    function testConfirmationRequiresSixHoursAndCannotSkipTiers() public {
        _localWarmUpBuy(12 ether);
        feed.set(300000e8);
        _advance(oracle.WINDOW());
        hook.updateMilestone();
        uint256 start = block.timestamp;
        for (uint256 i; i < 71; ++i) {
            _advance(5 minutes);
            hook.updateMilestone();
        }
        _advance(5 minutes - 1);
        hook.updateMilestone();
        assertEq(hook.tier(), 0);
        _advance(1);
        hook.updateMilestone();
        assertEq(hook.tier(), 0, "minimum cadence applies even at duration boundary");
        _advance(4 minutes);
        hook.updateMilestone();
        assertEq(hook.tier(), 1);
        assertGe(block.timestamp - start, 6 hours);
        assertFalse(hook.fullyUnlocked());
    }

    /// @dev The factory's requester can hand its fee share on after activation; the hook's payer stays sealed.
    function testRequesterChangeAfterActivationDoesNotMoveThePayer() public {
        vm.prank(payer);
        factory.setRequester(LAUNCH_NUMBER, bob);
        (,,, address requester) = factory.positionOf(LAUNCH_NUMBER);
        assertEq(requester, bob);
        assertEq(hook.payer(), payer);
        hook.syncPayer();
        assertEq(hook.eligible(payer), token.PAYER_ALLOCATION());
        assertEq(hook.eligible(bob), 0);
    }

    /// @dev Claims across rounds accumulate once each; a replayed attestation and a foreign round are refused.
    function testSecondRoundClaimsAccumulateOncePerRound() public {
        _advance(1 hours);
        bytes32[] memory proof = new bytes32[](0);
        distributor.claim(0, alice, REWARD, proof);
        rewards.attest(0, alice, REWARD, proof);
        assertEq(hook.syncRewards(alice), REWARD);
        // The treasury (IMD) funds and opens a remediation round with a different amount for the same wallet.
        uint256 second = 250_000 ether;
        vm.prank(payer);
        token.transfer(address(distributor), second);
        bytes32 root = keccak256(bytes.concat(keccak256(abi.encode(alice, second))));
        vm.prank(imd);
        distributor.openRound(root, second, 0);
        _certifySingle(rewards, 1, alice, second);
        vm.expectRevert(MerkleClaimEvidence.NotClaimed.selector);
        rewards.attest(1, alice, second, proof);
        distributor.claim(1, alice, second, proof);
        vm.expectRevert(MerkleClaimEvidence.InvalidProof.selector);
        rewards.attest(1, alice, REWARD, proof);
        rewards.attest(1, alice, second, proof);
        vm.expectRevert(MerkleClaimEvidence.AlreadyAttested.selector);
        rewards.attest(1, alice, second, proof);
        assertEq(rewards.claimed(alice), REWARD + second);
        assertEq(hook.syncRewards(alice), second);
        assertEq(hook.eligible(alice), REWARD + second);
        assertEq(hook.syncRewards(alice), 0);
        assertEq(hook.eligible(bob), 0);
    }

    /// @dev Nobody can create credit for a wallet that never claimed, whoever pays the gas.
    function testSyncForStrangerAndZeroAddressCreatesNothing() public {
        vm.expectRevert(UnlkHook.InvalidEvidence.selector);
        hook.syncRewards(address(0));
        assertEq(hook.syncRewards(bob), 0);
        assertEq(hook.syncRewards(address(this)), 0);
        assertEq(hook.eligible(bob), 0);
    }

    // ------------------------------------------------------------------ properties

    /// forge-config: default.fuzz.runs = 512
    function testFuzzRemainingQuotaFormula(uint128 eligible, uint128 sold, uint8 tierSeed) public {
        uint16[7] memory percentages = [uint16(2500), 3500, 4500, 5500, 7000, 8500, 10000];
        uint16 p = percentages[tierSeed % 6];
        stdstore.target(address(hook))
            .sig(hook.eligible.selector)
            .with_key(bob)
            .checked_write(uint256(eligible));
        stdstore.target(address(hook)).sig(hook.sold.selector).with_key(bob).checked_write(uint256(sold));
        stdstore.target(address(hook)).sig(hook.p.selector).enable_packed_slots().checked_write(p);
        uint256 cap = uint256(eligible) * p / 10000;
        assertEq(hook.remainingQuota(bob), cap > sold ? cap - sold : 0);
    }

    /// forge-config: default.fuzz.runs = 512
    function testFuzzTierIsMonotonicInFdv(uint256 a, uint256 b) public view {
        (a, b) = a <= b ? (a, b) : (b, a);
        assertLe(hook.tierForFdv(a), hook.tierForFdv(b));
        assertLe(hook.tierForFdv(b), 6);
    }

    /// forge-config: default.fuzz.runs = 256
    function testFuzzOperationHashBindsTraderNonceAndChain(address trader, uint256 nonce, uint64 chain)
        public
    {
        vm.assume(trader != alice && nonce != 1 && chain != block.chainid && chain != 0);
        SwapParams memory params = SwapParams(true, -1 ether, TickMath.MIN_SQRT_PRICE + 1);
        bytes32 base = OperationHash.hash(key, params, alice, 1);
        assertTrue(base != OperationHash.hash(key, params, trader, 1));
        assertTrue(base != OperationHash.hash(key, params, alice, nonce));
        vm.chainId(chain);
        assertTrue(
            base != OperationHash.hash(key, params, alice, 1), "a swap context must not replay cross-chain"
        );
    }

    /// forge-config: default.fuzz.runs = 256
    function testFuzzTransfersMoveExactlyTheAmount(address to, uint96 amount) public {
        vm.assume(to != address(0) && to != payer);
        uint256 bounded = bound(amount, 0, token.balanceOf(payer));
        uint256 toBefore = token.balanceOf(to);
        uint256 fromBefore = token.balanceOf(payer);
        vm.prank(payer);
        assertTrue(token.transfer(to, bounded));
        assertEq(token.balanceOf(to), toBefore + bounded);
        assertEq(token.balanceOf(payer), fromBefore - bounded);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(hook.eligible(to), 0);
    }

    using stdStorage for StdStorage;
}

/// @dev Swaps straight through the PoolManager with native ETH, bypassing the router.
contract BypassSwapper is IUnlockCallback {
    IPoolManager immutable manager;
    PoolKey key;
    uint256 amount;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function swap(PoolKey memory key_, uint256 amount_) external {
        key = key_;
        amount = amount_;
        manager.unlock("");
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        manager.swap(
            key, SwapParams(true, -int256(amount), TickMath.MIN_SQRT_PRICE + 1), abi.encode(uint256(1))
        );
        manager.settle{value: amount}();
        return "";
    }

    receive() external payable {}
}

/// @notice Stage 2 against the wrong launch: a REAL second launch from the same factory, companions of one hook
/// offered to the other, and the Sepolia feed rule in both directions.
contract ActivationFailurePathsTest is SystemFixture {
    using StateLibrary for IPoolManager;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _localQuoteDepth(10000 ether);
        _deployCompanions();
    }

    /// @dev Launches a second UNLK-shaped token and hook under another launch number through the same factory.
    function _secondLaunch(uint64 number) internal returns (UnlkHook h2, UnlkToken t2, MerkleDistributor d2) {
        address predictedToken2 = factory.predictToken(number, type(UnlkToken).creationCode);
        bytes memory init2 = deployer.initCode(
            type(UnlkHook).creationCode,
            HookDeployer.Config(manager, UnlkToken(predictedToken2), address(factory), owner)
        );
        bytes32 codeHash = keccak256(init2);
        bytes32 salt2;
        for (uint256 i;; ++i) {
            salt2 = bytes32(i);
            address predicted = address(
                uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(factory), salt2, codeHash))))
            );
            if (uint160(predicted) & 0x3fff == 0x3fc0) break;
        }
        LaunchFactory.LaunchParams memory params =
            _launchParams(TickMath.getSqrtPriceAtTick(seedUpper), seedLower, seedUpper, seedLiquidity);
        params.launchNumber = number;
        params.hookCreationCode = init2;
        params.hookSalt = salt2;
        (address t, address h, address d) = factory.launch(params);
        return (UnlkHook(h), UnlkToken(t), MerkleDistributor(d));
    }

    function testCrossLaunchSetupIsRefusedInEveryDirection() public {
        (UnlkHook hook2, UnlkToken token2, MerkleDistributor distributor2) = _secondLaunch(LAUNCH_NUMBER + 1);
        assertTrue(hook2.bound());
        vm.prank(owner);
        (address rr, address ee, address oo) = hook2.deployCompanions(
            LAUNCH_NUMBER + 1,
            feed,
            type(UnlkSwapRouter).creationCode,
            type(MerkleClaimEvidence).creationCode,
            type(UnlkOracle).creationCode
        );
        MerkleClaimEvidence rewards2 = MerkleClaimEvidence(ee);
        UnlkSwapRouter router2 = UnlkSwapRouter(payable(rr));
        UnlkOracle oracle2 = UnlkOracle(oo);
        _certifySingle(rewards2, 0, alice, REWARD);

        // This hook with the other launch's number: the registry lists the other token and hook.
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidEvidence.selector);
        hook.configureAndActivate(address(router), rewards, oracle, LAUNCH_NUMBER + 1);
        // This hook with evidence over the other launch's distributor.
        MerkleClaimEvidence crossed =
            new MerkleClaimEvidence(IMerkleDistributor(address(distributor2)), address(token));
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidEvidence.selector);
        hook.configureAndActivate(address(router), crossed, oracle, LAUNCH_NUMBER);
        // Evidence over this distributor but naming another token.
        MerkleClaimEvidence wrongToken =
            new MerkleClaimEvidence(IMerkleDistributor(address(distributor)), address(token2));
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidEvidence.selector);
        hook.configureAndActivate(address(router), wrongToken, oracle, LAUNCH_NUMBER);
        // The other hook offered this hook's companions, one at a time: evidence, router, oracle.
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidEvidence.selector);
        hook2.configureAndActivate(address(router2), rewards, oracle2, LAUNCH_NUMBER + 1);
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook2.configureAndActivate(address(router), rewards2, oracle2, LAUNCH_NUMBER + 1);
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook2.configureAndActivate(address(router2), rewards2, oracle, LAUNCH_NUMBER + 1);
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidEvidence.selector);
        hook2.configureAndActivate(address(router2), rewards2, oracle2, LAUNCH_NUMBER);
        assertFalse(hook.activated());
        assertFalse(hook2.activated());
        assertEq(oracle.observationCount(), 0);
        assertEq(oracle2.observationCount(), 0);

        // Each hook activates only with its own record, independently of the other.
        vm.prank(owner);
        hook2.configureAndActivate(address(router2), rewards2, oracle2, LAUNCH_NUMBER + 1);
        assertTrue(hook2.activated());
        assertFalse(hook.activated());
        _activate();
        assertTrue(hook.activated());
        assertEq(hook.swarm(), address(distributor));
        assertEq(hook2.swarm(), address(distributor2));
    }

    /// @dev On chain 11155111 the oracle must read the published Chainlink ETH/USD proxy, and then activation works.
    function testSepoliaRefusesLocallyClonedServicesEvenWithFeedAtPublishedAddress() public {
        address published = hook.SEPOLIA_ETH_USD();
        MockEthUsd impl = new MockEthUsd();
        vm.etch(published, address(impl).code);
        MockEthUsd(published).setDecimals(8);
        MockEthUsd(published).setRound(1, block.timestamp, block.timestamp, 1);
        MockEthUsd(published).set(2000e8);
        UnlkOracle candidate = new UnlkOracle(manager, IChainlinkEthUsd(published), address(hook));
        vm.chainId(11155111);
        vm.prank(owner);
        vm.expectRevert(UnlkHook.InvalidConfig.selector);
        hook.configureAndActivate(address(router), rewards, candidate, LAUNCH_NUMBER);
        assertFalse(hook.activated());
        assertFalse(candidate.bound());
    }

    /// @dev The stage-2 companions reject the inputs the hook cannot see for them.
    function testCompanionConstructorsRejectMissingInputs() public {
        vm.expectRevert(UnlkSwapRouter.InvalidConfig.selector);
        new UnlkSwapRouter(IPoolManager(address(0)), IUnlkHookView(address(hook)));
        vm.expectRevert(UnlkSwapRouter.InvalidConfig.selector);
        new UnlkSwapRouter(manager, IUnlkHookView(address(0)));
        vm.expectRevert(UnlkOracle.InvalidConfig.selector);
        new UnlkOracle(manager, feed, address(0));
        vm.expectRevert(UnlkOracle.InvalidConfig.selector);
        new UnlkOracle(manager, IChainlinkEthUsd(address(0)), address(hook));
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        new MerkleClaimEvidence(IMerkleDistributor(address(0)), address(token));
        vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        new MerkleClaimEvidence(IMerkleDistributor(address(distributor)), address(0));
        // The oracle refuses a bind that is not its hook's native-ETH pool, even from the hook.
        PoolKey memory wrong = key;
        wrong.fee = 3000;
        vm.prank(address(hook));
        vm.expectRevert(UnlkOracle.InvalidConfig.selector);
        oracle.bind(wrong, address(token), seedLower, seedUpper);
        vm.prank(address(hook));
        vm.expectRevert(UnlkOracle.InvalidConfig.selector);
        oracle.bind(key, address(token), seedUpper, seedLower);
        assertFalse(oracle.bound());
        vm.expectRevert(UnlkOracle.InvalidOracle.selector);
        oracle.checkpoint();
    }
}

/// @notice A launch nobody paid for: the factory records no requester and the remainder goes to the treasury.
/// The hook then has no payer, credits nobody and still trades.
contract UnpaidLaunchTest is SystemFixture {
    function setUp() public override {
        _deploy(false);
        int24 tick = -OPENING_TICK;
        (seedLower, seedUpper) = (LOWER, tick);
        uint160 sqrt = TickMath.getSqrtPriceAtTick(tick);
        seedLiquidity = _tokenOnlyLiquidity(UnlkToken(address(0)), sqrt);
        LaunchFactory.LaunchParams memory params = _launchParams(sqrt, seedLower, seedUpper, seedLiquidity);
        params.requester = address(0);
        params.remainderTo = address(0);
        (address t, address h, address d) = factory.launch(params);
        token = UnlkToken(t);
        hook = UnlkHook(h);
        distributor = MerkleDistributor(d);
        _localQuoteDepth(10000 ether);
        _deployCompanions();
        _activate();
    }

    function testNoRequesterMeansNoPayerCreditAnywhere() public {
        assertEq(hook.payer(), imd);
        assertGe(token.balanceOf(imd), token.PAYER_ALLOCATION(), "the treasury received the remainder");
        (address recipient, uint256 pending) = hook.pendingPayerCredit();
        assertEq(recipient, imd);
        assertEq(pending, token.PAYER_ALLOCATION());
        assertEq(hook.syncPayer(), token.PAYER_ALLOCATION());
        assertTrue(hook.payerCredited());
        assertEq(hook.eligible(imd), token.PAYER_ALLOCATION());
        assertEq(hook.eligible(address(0)), 0);
        // Trading and the swarm credit path are unaffected.
        uint256 bought = _buy(alice, 1 ether);
        assertEq(hook.eligible(alice), bought);
        _advance(1 hours);
        _claimReward();
        _attestReward();
        assertEq(hook.syncRewards(alice), REWARD);
        // The treasury's tokens carry no sale rights before full unlock.
        vm.prank(imd);
        token.approve(address(router), type(uint256).max);
        _sell(imd, 1 ether);
    }
}
