// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SpotIntegrationFixture} from "./SpotIntegrationFixture.sol";
import {IUniversalRouter, IPermit2Allowance} from "./ImdFixture.sol";
import {UnlkImdHook} from "src/mainnet/UnlkImdHook.sol";
import {ImdFeeVault} from "src/mainnet/ImdFeeVault.sol";
import {MainnetPins} from "src/mainnet/MainnetPins.sol";
import {UnlkImdOracle, IImdUsdSource} from "src/mainnet/UnlkImdOracle.sol";
import {IClaimEvidence} from "src/interfaces/IIntegration.sol";
import {MerkleClaimEvidence} from "src/MerkleClaimEvidence.sol";
import {LaunchFactory} from "../imd/LaunchFactory.sol";
import {MerkleDistributor} from "../imd/MerkleDistributor.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";

/// @dev Every swap executes through the recorded Universal Router/Permit2/manager runtimes.
/// The model uses executed token receipts, actual ERC6909 receipts and independently tracked deliveries.
/// Funding of simulated traders and the external reference state are the only storage writes.
contract SpotCustodyHandler is Test, IUnlockCallback {
    UnlkImdHook public immutable hook;
    ImdFeeVault public immutable vault;
    IERC20 public immutable token;
    IERC20 public constant imd = IERC20(MainnetPins.IMD_ADDRESS);
    IPoolManager public constant manager = IPoolManager(MainnetPins.MANAGER_ADDRESS);
    address[3] public actors;
    uint256 public immutable managerImdAtStart;
    uint256 public immutable beneficiaryImdAtStart;
    uint256 public immutable nativeClaimUnlock;
    uint256 public constant REWARD = 1_000_000 ether;

    mapping(address => uint256) public credits;
    mapping(address => uint256) public sales;
    mapping(address => uint256) public freshBuys;
    mapping(address => uint256) public buyBlock;
    uint8 public highestTier;
    uint256 public accrued;
    uint256 public redeemed;
    uint256 public withdrawn;
    uint256 public donatedTokens;
    uint256 public donationsPaid;
    uint256 public donatedClaims;
    uint256 public buyImdIn;
    uint256 public sellImdOut;
    uint256 public lpImdOut;
    uint256 public boughtTokens;
    uint256 public soldTokens;
    bool public payerSynced;
    bool public nativeClaimed;
    bool public rewardSynced;
    uint256 public successfulBuys;
    uint256 public successfulSales;
    uint256 public refusedSales;
    uint256 public invalidCheckpoints;

    constructor(UnlkImdHook h, address alice, address bob, uint256 unlockAt) {
        hook = h;
        vault = h.nftFeeVault();
        token = IERC20(address(h.token()));
        actors = [alice, bob, h.payer()];
        nativeClaimUnlock = unlockAt;
        managerImdAtStart = imd.balanceOf(address(manager));
        beneficiaryImdAtStart = imd.balanceOf(vault.BENEFICIARY());
        for (uint256 i; i < actors.length; ++i) {
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

    function _inputs(bool buy, uint256 amount) private view returns (bytes[] memory inputs) {
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(Swap(hook.poolKey(), buy != hook.tokenIs0(), uint128(amount), 0, ""));
        params[1] = abi.encode(buy ? address(imd) : address(token), amount);
        params[2] = abi.encode(buy ? address(token) : address(imd), uint256(0));
        inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0f", params);
    }

    function _execute(address who, bytes[] memory inputs) private {
        vm.prank(who);
        IUniversalRouter(MainnetPins.ROUTER_ADDRESS).execute(hex"10", inputs, block.timestamp);
    }

    function _fund(address who, uint256 amount) private {
        vm.store(address(imd), keccak256(abi.encode(who, uint256(5))), bytes32(imd.balanceOf(who) + amount));
    }

    function _claimBalance() private view returns (uint256) {
        return manager.balanceOf(address(vault), uint160(address(imd)));
    }

    function buy(uint256 actorSeed, uint256 raw) public {
        address who = actors[actorSeed % 3];
        uint256 gross = bound(raw, 1e12, 100 ether);
        _fund(who, gross);
        uint256 beforeTokens = token.balanceOf(who);
        uint256 beforeClaims = _claimBalance();
        uint256 beforeImd = imd.balanceOf(who);
        _execute(who, _inputs(true, gross));
        uint256 received = token.balanceOf(who) - beforeTokens;
        uint256 fee = _claimBalance() - beforeClaims;
        assertGt(received, 0);
        assertEq(beforeImd - imd.balanceOf(who), gross);
        // Fee-inclusive input: the maximal pool leg fits the budget, the next wei would not.
        uint256 poolLeg = gross - fee;
        assertLe(poolLeg + poolLeg * 75 / 10000, gross);
        assertGt(poolLeg + 1 + (poolLeg + 1) * 75 / 10000, gross);
        accrued += fee;
        buyImdIn += gross;
        boughtTokens += received;
        credits[who] += received;
        if (buyBlock[who] != block.number) freshBuys[who] = 0;
        freshBuys[who] += received;
        buyBlock[who] = block.number;
        ++successfulBuys;
        _observe();
    }

    function mature(address who) public view returns (uint256) {
        return credits[who] - (buyBlock[who] == block.number ? freshBuys[who] : 0);
    }

    function quota(address who) public view returns (uint256) {
        if (highestTier == 16) return type(uint256).max;
        uint256 cap = mature(who) * (2000 + uint256(highestTier) * 500) / 10000;
        return cap > sales[who] ? cap - sales[who] : 0;
    }

    function sell(uint256 actorSeed, uint256 raw) public {
        address who = actors[actorSeed % 3];
        uint256 maximum = token.balanceOf(who);
        if (quota(who) < maximum) maximum = quota(who);
        // Do not generate a seed-range exit: such failures have their own explicit regression tests.
        uint256 marketCapacity = (boughtTokens - soldTokens) / 2;
        if (marketCapacity < maximum) maximum = marketCapacity;
        if (maximum < 1e12) return;
        uint256 amount = bound(raw, 1e12, maximum);
        uint256 beforeImd = imd.balanceOf(who);
        uint256 beforeTokens = token.balanceOf(who);
        uint256 beforeClaims = _claimBalance();
        _execute(who, _inputs(false, amount));
        uint256 net = imd.balanceOf(who) - beforeImd;
        uint256 fee = _claimBalance() - beforeClaims;
        assertEq(beforeTokens - token.balanceOf(who), amount);
        assertEq(fee, (net + fee) * 75 / 10000, "treasury receives 75bps of actual IMD output");
        sales[who] += amount;
        soldTokens += amount;
        sellImdOut += net;
        accrued += fee;
        ++successfulSales;
        _observe();
    }

    function rejectExcessSale(uint256 actorSeed) public {
        address who = actors[actorSeed % 3];
        if (highestTier == 16) return;
        uint256 amount = quota(who) + 1;
        if (amount > token.balanceOf(who) || amount > (boughtTokens - soldTokens) / 2) return;
        bytes[] memory inputs = _inputs(false, amount);
        vm.prank(who);
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                IHooks.afterSwap.selector,
                abi.encodeWithSelector(UnlkImdHook.QuotaExceeded.selector),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
        IUniversalRouter(MainnetPins.ROUTER_ADDRESS).execute(hex"10", inputs, block.timestamp);
        ++refusedSales;
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint256 raw) public {
        address from = actors[fromSeed % 3];
        address to = actors[toSeed % 3];
        uint256 amount = bound(raw, 0, token.balanceOf(from));
        vm.prank(from);
        token.transfer(to, amount);
        // No quota-model update: tokens and eligibility are deliberately independent.
    }

    function nextBlock(uint256 raw) public {
        uint256 blocks = bound(raw, 1, 5);
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + blocks * 12);
    }

    function referenceState(uint8 raw, uint8 fault) public {
        uint160 sqrtPrice = uint160(uint256(1) << (90 + uint256(raw) % 14));
        uint128 liquidity = fault % 4 == 1 ? 0 : 1e18;
        bytes32 slot = keccak256(
            abi.encode(
                bytes32(0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3), uint256(6)
            )
        );
        vm.store(
            address(manager),
            slot,
            bytes32(
                uint256(sqrtPrice) | uint256(uint24(TickMath.getTickAtSqrtPrice(sqrtPrice))) << 160
                    | uint256(10000) << 208
            )
        );
        vm.store(address(manager), bytes32(uint256(slot) + 3), bytes32(uint256(liquidity)));
        uint256 updated = fault % 4 == 2 ? block.timestamp - 5401 : block.timestamp;
        int256 answer = fault % 4 == 3 ? int256(-1) : int256(3000e8);
        vm.mockCall(
            MainnetPins.ETHUSD_ADDRESS,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(uint80(7), answer, updated, updated, uint80(7))
        );
    }

    function checkpoint() public {
        uint8 beforeTier = highestTier;
        bool changed = hook.checkpoint();
        _observe();
        assertEq(changed, highestTier > beforeTier);
    }

    function _observe() private {
        try hook.oracle().fdvUsd() returns (uint256 fdv) {
            uint256[16] memory thresholds = [
                uint256(100000),
                250000,
                500000,
                1000000,
                2000000,
                3500000,
                5000000,
                7500000,
                10000000,
                15000000,
                20000000,
                25000000,
                30000000,
                35000000,
                40000000,
                50000000
            ];
            for (uint8 i; i < thresholds.length; ++i) {
                if (fdv >= thresholds[i] * 1 ether && highestTier < i + 1) highestTier = i + 1;
            }
        } catch {
            ++invalidCheckpoints;
        }
        assertEq(hook.tier(), highestTier, "persist only the highest successful observed touch");
    }

    function redeem() public {
        uint256 before = imd.balanceOf(address(vault));
        vault.redeem();
        assertEq(imd.balanceOf(address(vault)) - before, accrued - redeemed);
        redeemed = accrued;
    }

    function withdraw(bool donationsOnly) public {
        uint256 expected = donationsOnly ? donatedTokens - donationsPaid : redeemed - withdrawn;
        uint256 before = imd.balanceOf(vault.BENEFICIARY());
        vm.prank(vault.BENEFICIARY());
        if (donationsOnly) vault.withdrawDonations();
        else vault.withdraw();
        assertEq(imd.balanceOf(vault.BENEFICIARY()) - before, expected);
        if (donationsOnly) donationsPaid += expected;
        else withdrawn += expected;
    }

    function donate(uint256 raw, bool asClaims) public {
        uint256 amount = bound(raw, 1, 25 ether);
        _fund(address(this), amount);
        if (asClaims) {
            manager.unlock(abi.encode(amount));
            donatedClaims += amount;
        } else {
            imd.transfer(address(vault), amount);
            donatedTokens += amount;
        }
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "manager only");
        uint256 amount = abi.decode(data, (uint256));
        manager.mint(address(vault), uint160(address(imd)), amount);
        manager.sync(Currency.wrap(address(imd)));
        imd.transfer(address(manager), amount);
        manager.settle();
        return "";
    }

    function collectLpFees() public {
        LaunchFactory factory = LaunchFactory(payable(hook.launchFactory()));
        uint256 beforeImd = imd.balanceOf(hook.payer());
        uint256 beforeTokens = token.balanceOf(hook.payer());
        (uint256 fee0, uint256 fee1) = factory.claimFees(hook.launchNumber());
        uint256 imdFee = hook.tokenIs0() ? fee1 : fee0;
        uint256 tokenFee = hook.tokenIs0() ? fee0 : fee1;
        assertEq(imd.balanceOf(hook.payer()) - beforeImd, imdFee * 8000 / 10000);
        assertEq(token.balanceOf(hook.payer()) - beforeTokens, tokenFee * 8000 / 10000);
        lpImdOut += imdFee;
    }

    function claimAndSync(uint8 operation) public {
        if (operation % 3 == 0) {
            uint256 amount = hook.syncPayer();
            assertEq(amount, payerSynced ? 0 : 30_000_000 ether);
            credits[hook.payer()] += amount;
            payerSynced = true;
        } else if (operation % 3 == 1) {
            if (block.timestamp < nativeClaimUnlock) return;
            if (nativeClaimed) {
                address distributor = hook.swarm();
                vm.expectRevert(MerkleDistributor.AlreadyClaimed.selector);
                MerkleDistributor(distributor).claim(0, actors[0], REWARD, new bytes32[](0));
                return;
            }
            uint256 before = token.balanceOf(actors[0]);
            MerkleDistributor(hook.swarm()).claim(0, actors[0], REWARD, new bytes32[](0));
            assertEq(token.balanceOf(actors[0]) - before, REWARD);
            nativeClaimed = true;
        } else if (nativeClaimed) {
            MerkleClaimEvidence evidence = MerkleClaimEvidence(address(hook.rewards()));
            if (rewardSynced) vm.expectRevert(MerkleClaimEvidence.AlreadyAttested.selector);
            evidence.attest(0, actors[0], REWARD, new bytes32[](0));
            uint256 amount = hook.syncRewards(actors[0]);
            assertEq(amount, rewardSynced ? 0 : REWARD);
            credits[actors[0]] += amount;
            rewardSynced = true;
        }
    }

    function rejectUnauthorized(uint8 operation, uint256 actorSeed) public {
        address who = actors[actorSeed % 2];
        vm.prank(who);
        vm.expectRevert(ImdFeeVault.Unauthorized.selector);
        if (operation % 4 == 0) vault.withdraw();
        else if (operation % 4 == 1) vault.withdrawDonations();
        else if (operation % 4 == 2) vault.recordAccrual(1);
        else vault.unlockCallback("");
    }

    function rejectReconfiguration(uint8 operation) public {
        address authority = hook.setupAuthority();
        uint64 number = hook.launchNumber();
        IClaimEvidence evidence = hook.rewards();
        UnlkImdOracle oracle = hook.oracle();
        IImdUsdSource source = oracle.feed();
        bytes[4] memory codes;
        vm.prank(authority);
        vm.expectRevert(UnlkImdHook.AlreadyActivated.selector);
        if (operation % 3 == 0) hook.deployPriceSource("", "");
        else if (operation % 3 == 1) hook.deployCompanions(number, source, codes);
        else hook.configureAndActivate(evidence, oracle, number);
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = true
contract SpotCustodyInvariantsTest is SpotIntegrationFixture {
    using TransientStateLibrary for IPoolManager;
    SpotCustodyHandler internal handler;

    function setUp() public override {
        super.setUp();
        uint256 unlockAt = block.timestamp + CONTRIBUTOR_LOCK;
        _advance(CONTRIBUTOR_LOCK);
        handler = new SpotCustodyHandler(hook, alice, bob, unlockAt);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](15);
        selectors[0] = handler.buy.selector;
        selectors[1] = handler.sell.selector;
        selectors[2] = handler.rejectExcessSale.selector;
        selectors[3] = handler.transfer.selector;
        selectors[4] = handler.nextBlock.selector;
        selectors[5] = handler.referenceState.selector;
        selectors[6] = handler.checkpoint.selector;
        selectors[7] = handler.redeem.selector;
        selectors[8] = handler.withdraw.selector;
        selectors[9] = handler.donate.selector;
        selectors[10] = handler.collectLpFees.selector;
        selectors[11] = handler.claimAndSync.selector;
        selectors[12] = handler.rejectUnauthorized.selector;
        // Weight buys twice so every random sequence has spendable acquisitions to exercise.
        selectors[13] = handler.buy.selector;
        selectors[14] = handler.rejectReconfiguration.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
        handler.buy(0, 2 ether);
        handler.buy(1, 2 ether);
        handler.buy(2, 2 ether);
        handler.nextBlock(1);
    }

    function invariant_TreasuryReceiptsCashAndPayoutsReconcile() public view {
        assertEq(vault.totalAccrued(), handler.accrued());
        assertEq(vault.totalRedeemed(), handler.redeemed());
        assertEq(vault.totalWithdrawn(), handler.withdrawn());
        assertEq(vault.donationsWithdrawn(), handler.donationsPaid());
        assertEq(vault.pendingClaims(), handler.accrued() - handler.redeemed());
        assertEq(vault.claimable(), handler.redeemed() - handler.withdrawn());
        assertEq(vault.donations(), handler.donatedTokens() - handler.donationsPaid());
        assertEq(vault.totalDonations(), handler.donatedTokens());
        assertEq(vault.donatedClaims(), handler.donatedClaims());
        assertEq(
            manager.balanceOf(address(vault), uint160(address(quote))),
            handler.accrued() - handler.redeemed() + handler.donatedClaims()
        );
        assertEq(
            quote.balanceOf(address(vault)),
            handler.redeemed() - handler.withdrawn() + handler.donatedTokens() - handler.donationsPaid()
        );
        assertGe(
            quote.balanceOf(vault.BENEFICIARY()),
            handler.beneficiaryImdAtStart() + handler.withdrawn() + handler.donationsPaid()
        );
        assertEq(
            quote.balanceOf(MANAGER) + handler.sellImdOut() + handler.redeemed() + handler.lpImdOut(),
            handler.managerImdAtStart() + handler.buyImdIn() + handler.donatedClaims()
        );
    }

    function invariant_QuotaUsesOnlyMatureAcquisitionsAndNeverForgetsSales() public view {
        for (uint256 i; i < 3; ++i) {
            address who = handler.actors(i);
            assertEq(hook.eligible(who), handler.credits(who));
            assertEq(hook.sold(who), handler.sales(who));
            assertEq(hook.spendableEligible(who), handler.mature(who));
            assertEq(hook.remainingQuota(who), handler.quota(who));
            if (handler.highestTier() < 16) {
                assertLe(handler.sales(who), handler.mature(who) * hook.p() / 10000);
            }
        }
        assertEq(hook.tier(), handler.highestTier());
        assertEq(hook.p(), 2000 + uint256(handler.highestTier()) * 500);
        assertEq(hook.fullyUnlocked(), handler.highestTier() == 16);
    }

    function invariant_PrincipalSupplyAndSealedConfigurationSurviveEverySequence() public view {
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        address[12] memory holders = [
            MANAGER,
            address(distributor),
            payer,
            launchFees.feeRecipient(),
            address(factory),
            ROUTER,
            address(hook),
            address(vault),
            address(handler),
            alice,
            bob,
            vault.BENEFICIARY()
        ];
        uint256 sum;
        for (uint256 i; i < holders.length; ++i) {
            bool duplicate;
            for (uint256 j; j < i; ++j) {
                if (holders[j] == holders[i]) duplicate = true;
            }
            if (!duplicate) sum += token.balanceOf(holders[i]);
        }
        assertEq(sum, token.SUPPLY());
        assertTrue(hook.activated());
        assertEq(address(hook.oracle()), address(oracle));
        assertEq(address(hook.rewards()), address(rewards));
        assertEq(address(hook.nftFeeVault()), address(vault));
        assertEq(hook.stagedPriceSource(), address(spotSource));
        assertEq(hook.setupAuthority(), owner);
        assertEq(vault.BENEFICIARY(), 0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9);
        assertFalse(IPoolManager(MANAGER).isUnlocked());
        assertEq(IPoolManager(MANAGER).getNonzeroDeltaCount(), 0);
        assertEq(quote.balanceOf(ROUTER), 0);
        assertEq(token.balanceOf(ROUTER), 0);
    }

    function afterInvariant() public {
        handler.redeem();
        handler.withdraw(false);
        handler.withdraw(true);
        invariant_TreasuryReceiptsCashAndPayoutsReconcile();
        assertEq(vault.pendingClaims(), 0);
        assertEq(vault.claimable(), 0);
        assertEq(quote.balanceOf(address(vault)), 0);
        // Unsolicited ERC6909 transfers stay separate; they must never be booked as trading fees.
        assertEq(manager.balanceOf(address(vault), uint160(address(quote))), handler.donatedClaims());
    }

    function testHandlerExercisesFailuresDonationsClaimsAndPermanentBypass() public {
        handler.rejectExcessSale(0);
        handler.sell(0, 1 ether);
        handler.claimAndSync(1);
        handler.claimAndSync(2);
        handler.claimAndSync(2);
        handler.claimAndSync(0);
        handler.donate(1, false);
        handler.donate(1 ether, true);
        handler.redeem();
        handler.withdraw(true);
        handler.collectLpFees();
        handler.referenceState(0, 2);
        handler.checkpoint();
        handler.buy(1, 2 ether);
        handler.nextBlock(1);
        handler.sell(1, 1 ether);
        handler.referenceState(0, 0);
        handler.checkpoint();
        handler.transfer(0, 1, 1 ether);
        handler.sell(1, 1 ether);
        handler.referenceState(13, 1);
        handler.checkpoint();
        for (uint8 i; i < 4; ++i) {
            handler.rejectUnauthorized(i, 0);
        }
        for (uint8 i; i < 3; ++i) {
            handler.rejectReconfiguration(i);
        }
        assertGt(handler.successfulBuys(), 3);
        assertGt(handler.successfulSales(), 0);
        assertGt(handler.refusedSales(), 0);
        assertGt(handler.invalidCheckpoints(), 0);
        assertEq(handler.highestTier(), 16);
        invariant_TreasuryReceiptsCashAndPayoutsReconcile();
        invariant_QuotaUsesOnlyMatureAcquisitionsAndNeverForgetsSales();
        invariant_PrincipalSupplyAndSealedConfigurationSurviveEverySequence();
        afterInvariant();
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = true
contract SpotCustodyInvariantsReverseOrderTest is SpotCustodyInvariantsTest {
    function _preferToken0() internal pure override returns (bool) {
        return false;
    }
}
