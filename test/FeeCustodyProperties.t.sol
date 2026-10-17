// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {LaunchFactory} from "./imd/LaunchFactory.sol";
import {LaunchFees} from "./imd/LaunchFees.sol";
import {PoolFees} from "./imd/PoolFees.sol";
import {UnlkToken} from "src/UnlkToken.sol";
import {UnlkHook} from "src/UnlkHook.sol";
import {UnlkSwapRouter} from "src/UnlkSwapRouter.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";

contract FeeForcedEther {
    constructor(address payable recipient) payable {
        selfdestruct(recipient);
    }
}

/// @dev Test-only recipients. Modes 2/3 attack the payout after the manager unlock has finished.
contract FeeRecipientWallet {
    LaunchFactory private immutable factory;
    Currency private immutable tokenCurrency;
    address private immutable driver;
    uint64 private immutable number;
    uint8 public mode;
    uint256 public received;
    uint256 public reentries;
    bool private entered;

    constructor(LaunchFactory factory_, UnlkToken token_, uint64 number_) {
        factory = factory_;
        tokenCurrency = Currency.wrap(address(token_));
        number = number_;
        driver = msg.sender;
    }

    function setMode(uint8 next) external {
        require(msg.sender == driver, "test driver only");
        mode = next;
    }

    receive() external payable {
        require(msg.sender == address(factory), "factory only");
        require(mode != 1, "recipient refuses ETH");
        received += msg.value;
        if (entered || mode < 2) return;
        entered = true;
        ++reentries;
        if (mode == 2) {
            factory.withdraw(address(this), Currency.wrap(address(0)));
            factory.withdraw(address(this), tokenCurrency);
            factory.withdrawNetwork(Currency.wrap(address(0)));
            factory.withdrawNetwork(tokenCurrency);
        } else {
            factory.claimFees(number);
        }
        entered = false;
    }
}

/// @dev Reference ledger is updated from actual v4 execution and collected fee deltas. It does not
/// copy owed/nativeCredit/balances out of the contracts being checked. All three recipients start empty.
contract FeeCustodyHandler is Test {
    LaunchFactory public immutable factory;
    LaunchFees public immutable fees;
    UnlkToken public immutable token;
    UnlkSwapRouter public immutable router;
    UnlkHook public immutable hook;
    address public immutable manager;
    address public immutable trader;
    address public immutable originalPayer;
    address private immutable feeAdmin;
    uint64 public immutable number;
    FeeRecipientWallet[3] public wallets;
    uint256 public requester;
    uint256 public networkRecipient = 1;

    // Currency index 0 is ETH, 1 is UNLK. Rows are independent recipient identities.
    uint256[2][3] public paid;
    uint256[2][3] public pending;
    uint256[2] public networkPending;
    uint256[2] public collected;
    uint256 public nativeIn;
    uint256 public nativeOut;
    uint256 public tokensBought;
    uint256 public tokensSold;
    uint256 public donatedNative;
    uint256 public donatedTokens;
    uint256 public tradePairs;
    uint256 public collections;
    uint256 public invalidCalls;

    constructor(LaunchFactory f, UnlkHook h, uint64 n, address originalPayer_, address feeAdmin_) {
        factory = f;
        fees = f.fees();
        hook = h;
        token = h.token();
        router = UnlkSwapRouter(payable(h.router()));
        manager = address(h.poolManager());
        number = n;
        originalPayer = originalPayer_;
        feeAdmin = feeAdmin_;
        trader = makeAddr("fee custody local trader");
        for (uint256 i; i < 3; ++i) {
            wallets[i] = new FeeRecipientWallet(f, token, n);
        }
        vm.prank(trader);
        token.approve(address(router), type(uint256).max);
    }

    function tradePair(uint96 amountSeed) external {
        uint256 amount = bound(amountSeed, 1e12, 1 ether);
        vm.deal(trader, trader.balance + amount);
        UnlkSwapRouter.SwapRequest memory buy = UnlkSwapRouter.SwapRequest(
            true, -int256(amount), TickMath.MIN_SQRT_PRICE + 1, amount, 1, block.timestamp
        );
        vm.prank(trader);
        (uint256 input, uint256 output) = router.swap{value: amount}(buy);
        assertEq(input, amount, "bounded exact-input buy must fill");
        nativeIn += input;
        tokensBought += output;
        uint256 sale = output / 5;
        UnlkSwapRouter.SwapRequest memory sell = UnlkSwapRouter.SwapRequest(
            false, -int256(sale), TickMath.MAX_SQRT_PRICE - 1, sale, 1, block.timestamp
        );
        vm.prank(trader);
        (input, output) = router.swap(sell);
        assertEq(input, sale, "bounded exact-input sale must fill");
        tokensSold += input;
        nativeOut += output;
        ++tradePairs;
    }

    function collect() external {
        uint256 nativeBefore = manager.balance;
        uint256 tokensBefore = token.balanceOf(manager);
        (uint256 amount0, uint256 amount1) = factory.claimFees(number);
        // A return value alone is not evidence that the fees actually left the manager.
        assertEq(nativeBefore - manager.balance, amount0, "native collection differs from custody movement");
        assertEq(
            tokensBefore - token.balanceOf(manager), amount1, "token collection differs from custody movement"
        );
        _split(amount0, 0);
        _split(amount1, 1);
        _modelAccountPayment(requester, 0);
        _modelAccountPayment(requester, 1);
        _modelNetworkPayment(0);
        _modelNetworkPayment(1);
        ++collections;
    }

    function setRecipientMode(uint256 accountSeed, bool rejecting) external {
        wallets[accountSeed % 3].setMode(rejecting ? 1 : 0);
    }

    /// @dev Not an invariant target: adversarial callback modes get deterministic tests below.
    function setReentryMode(uint256 account, uint8 mode) external {
        require(account < 3 && mode >= 2 && mode <= 3);
        wallets[account].setMode(mode);
    }

    function transferRequester(uint256 nextSeed) external {
        uint256 next = nextSeed % 3;
        address current = address(wallets[requester]);
        address recipient = address(wallets[next]);
        vm.prank(current);
        factory.setRequester(number, recipient);
        requester = next;
    }

    function rotateNetwork(uint256 nextSeed) external {
        uint256 next = nextSeed % 3;
        address recipient = address(wallets[next]);
        vm.prank(feeAdmin);
        fees.setFeeRecipient(recipient);
        networkRecipient = next;
    }

    function withdrawAccount(uint256 accountSeed, bool tokenSide) external {
        uint256 account = accountSeed % 3;
        uint256 currency = tokenSide ? 1 : 0;
        factory.withdraw(address(wallets[account]), _currency(currency));
        _modelAccountPayment(account, currency);
    }

    function withdrawNetwork(bool tokenSide) external {
        uint256 currency = tokenSide ? 1 : 0;
        factory.withdrawNetwork(_currency(currency));
        _modelNetworkPayment(currency);
    }

    function donate(uint96 nativeSeed, uint96 tokenSeed) external {
        uint256 nativeAmount = bound(nativeSeed, 0, 1 ether);
        vm.deal(address(this), nativeAmount);
        new FeeForcedEther{value: nativeAmount}(payable(address(factory)));
        donatedNative += nativeAmount;
        uint256 amount = bound(tokenSeed, 0, token.balanceOf(originalPayer));
        vm.prank(originalPayer);
        token.transfer(address(factory), amount);
        donatedTokens += amount;
    }

    function refuseInvalidOperations(uint8 choice) external {
        if (choice % 3 == 0) {
            address recipient = address(wallets[(requester + 1) % 3]);
            vm.expectRevert(abi.encodeWithSelector(PoolFees.NotRequester.selector, number));
            vm.prank(trader);
            factory.setRequester(number, recipient);
        } else if (choice % 3 == 1) {
            address current = address(wallets[requester]);
            vm.expectRevert(PoolFees.ZeroRequester.selector);
            vm.prank(current);
            factory.setRequester(number, address(0));
        } else {
            vm.expectRevert(abi.encodeWithSelector(PoolFees.NoPosition.selector, type(uint64).max));
            factory.claimFees(type(uint64).max);
        }
        ++invalidCalls;
    }

    function _split(uint256 amount, uint256 currency) private {
        collected[currency] += amount;
        uint256 payerShare = amount * 4 / 5;
        pending[requester][currency] += payerShare;
        networkPending[currency] += amount - payerShare;
    }

    function _modelAccountPayment(uint256 account, uint256 currency) private {
        if (currency == 0 && wallets[account].mode() == 1) return;
        paid[account][currency] += pending[account][currency];
        pending[account][currency] = 0;
    }

    function _modelNetworkPayment(uint256 currency) private {
        if (currency == 0 && wallets[networkRecipient].mode() == 1) return;
        paid[networkRecipient][currency] += networkPending[currency];
        networkPending[currency] = 0;
    }

    function _currency(uint256 index) private view returns (Currency) {
        return Currency.wrap(index == 0 ? address(0) : address(token));
    }
}

/// @notice LOCAL fresh native pool, real vendored v4 manager and IMD factory, with no quote-depth top-up.
/// The existing factory custody dependency is exercised; its source is not modified.
/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = true
contract FeeCustodyInvariantTest is SystemFixture {
    using TransientStateLibrary for IPoolManager;
    FeeCustodyHandler internal handler;
    uint256 internal initialPoolTokens;
    uint256 internal initialPayerTokens;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _deployCompanions();
        _activate();
        hook.syncPayer();
        initialPoolTokens = token.balanceOf(address(manager));
        initialPayerTokens = token.balanceOf(payer);
        handler = new FeeCustodyHandler(factory, hook, LAUNCH_NUMBER, payer, address(this));
        address firstRequester = address(handler.wallets(0));
        vm.prank(payer);
        factory.setRequester(LAUNCH_NUMBER, firstRequester);
        launchFees.setFeeRecipient(address(handler.wallets(1)));

        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = handler.tradePair.selector;
        selectors[1] = handler.collect.selector;
        selectors[2] = handler.setRecipientMode.selector;
        selectors[3] = handler.transferRequester.selector;
        selectors[4] = handler.rotateNetwork.selector;
        selectors[5] = handler.withdrawAccount.selector;
        selectors[6] = handler.withdrawNetwork.selector;
        selectors[7] = handler.donate.selector;
        selectors[8] = handler.refuseInvalidOperations.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_FactoryAssetsBackEveryUnpaidFeeAndDonationsRemainSurplus() public view {
        uint256[2] memory liabilities;
        uint256[2] memory paidOut;
        for (uint256 i; i < 3; ++i) {
            FeeRecipientWallet wallet = handler.wallets(i);
            address recipient = address(wallet);
            assertEq(recipient.balance, handler.paid(i, 0), "ETH sent to wrong fee recipient");
            assertEq(wallet.received(), handler.paid(i, 0));
            assertEq(token.balanceOf(recipient), handler.paid(i, 1), "UNLK sent to wrong fee recipient");
            for (uint256 c; c < 2; ++c) {
                Currency currency = Currency.wrap(c == 0 ? address(0) : address(token));
                assertEq(
                    factory.owed(recipient, currency), handler.pending(i, c), "fee entitlement moved or lost"
                );
                liabilities[c] += handler.pending(i, c);
                paidOut[c] += handler.paid(i, c);
            }
        }
        for (uint256 c; c < 2; ++c) {
            Currency currency = Currency.wrap(c == 0 ? address(0) : address(token));
            assertEq(factory.networkOwed(currency), handler.networkPending(c));
            liabilities[c] += handler.networkPending(c);
            assertEq(paidOut[c] + liabilities[c], handler.collected(c), "collected fees created or destroyed");
        }
        assertEq(address(factory).balance, liabilities[0] + handler.donatedNative());
        assertEq(token.balanceOf(address(factory)), liabilities[1] + handler.donatedTokens());
    }

    function invariant_FeeCollectionCannotTouchPrincipalOrCreateQuota() public view {
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
        assertEq(address(manager).balance, handler.nativeIn() - handler.nativeOut() - handler.collected(0));
        assertEq(
            token.balanceOf(address(manager)),
            initialPoolTokens + handler.tokensSold() - handler.tokensBought() - handler.collected(1)
        );
        assertEq(token.balanceOf(handler.trader()), handler.tokensBought() - handler.tokensSold());
        assertEq(hook.eligible(handler.trader()), handler.tokensBought());
        assertEq(hook.sold(handler.trader()), handler.tokensSold());
        assertEq(hook.payer(), payer);
        assertEq(hook.eligible(payer), 30_000_000 ether, "fee reassignment changes no original quota");
        assertEq(token.balanceOf(payer), initialPayerTokens - handler.donatedTokens());
        for (uint256 i; i < 3; ++i) {
            assertEq(hook.eligible(address(handler.wallets(i))), 0);
            assertEq(hook.sold(address(handler.wallets(i))), 0);
        }
        assertEq(hook.eligible(address(factory)), 0);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.initialAllocation(address(manager)), initialPoolTokens);
        assertEq(token.initialRecipient(), payer);
        assertTrue(token.distributionComplete());
    }

    function invariant_RecipientsAndSettlementStayBoundToTheirActualOwners() public view {
        (,,, address requester) = factory.positionOf(LAUNCH_NUMBER);
        assertEq(requester, address(handler.wallets(handler.requester())));
        assertEq(launchFees.feeRecipient(), address(handler.wallets(handler.networkRecipient())));
        assertEq(router.nativeCredit(handler.trader()), handler.nativeOut());
        assertEq(router.totalNativeCredit(), handler.nativeOut());
        assertEq(address(router).balance, handler.nativeOut());
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(address(hook).balance, 0);
        assertEq(token.balanceOf(address(hook)), 0);
        IPoolManager pm = IPoolManager(address(manager));
        assertFalse(pm.isUnlocked());
        assertEq(pm.getNonzeroDeltaCount(), 0);
        assertEq(pm.currencyDelta(address(factory), key.currency0), 0);
        assertEq(pm.currencyDelta(address(factory), key.currency1), 0);
        (address active, bytes32 operation) = router.context();
        assertEq(active, address(0));
        assertEq(operation, bytes32(0));
    }

    function afterInvariant() public {
        // Liveness at the end of every random sequence: accepting recipients can redeem every owed wei.
        for (uint256 i; i < 3; ++i) {
            handler.setRecipientMode(i, false);
        }
        handler.collect();
        for (uint256 i; i < 3; ++i) {
            handler.withdrawAccount(i, false);
            handler.withdrawAccount(i, true);
            assertEq(factory.owed(address(handler.wallets(i)), key.currency0), 0);
            assertEq(factory.owed(address(handler.wallets(i)), key.currency1), 0);
        }
        handler.withdrawNetwork(false);
        handler.withdrawNetwork(true);
        assertEq(factory.networkOwed(key.currency0), 0);
        assertEq(factory.networkOwed(key.currency1), 0);
        assertEq(address(factory).balance, handler.donatedNative());
        assertEq(token.balanceOf(address(factory)), handler.donatedTokens());
        _assertAll();
    }

    function test_DeferredPayerDebtStaysWithOldWalletWhileNetworkDebtFollowsRecipient() public {
        handler.donate(0.3 ether, 500 ether);
        handler.setRecipientMode(0, true);
        handler.setRecipientMode(1, true);
        handler.tradePair(1 ether);
        handler.collect();
        uint256 payerDebt = handler.pending(0, 0);
        uint256 networkDebt = handler.networkPending(0);
        assertGt(payerDebt, 0);
        assertGt(networkDebt, 0);
        assertGt(handler.paid(0, 1), 0, "rejecting ETH cannot withhold ERC-20 payout");
        assertGt(handler.paid(1, 1), 0);
        _assertAll();

        handler.transferRequester(2);
        handler.rotateNetwork(2);
        handler.withdrawNetwork(false);
        assertEq(address(handler.wallets(2)).balance, networkDebt);
        assertEq(factory.owed(address(handler.wallets(0)), key.currency0), payerDebt);
        handler.tradePair(0.1 ether);
        handler.collect();
        assertEq(factory.owed(address(handler.wallets(0)), key.currency0), payerDebt);
        handler.setRecipientMode(0, false);
        handler.withdrawAccount(0, false);
        assertEq(address(handler.wallets(0)).balance, payerDebt);
        handler.refuseInvalidOperations(0);
        handler.refuseInvalidOperations(1);
        handler.refuseInvalidOperations(2);
        assertEq(handler.invalidCalls(), 3);
        assertEq(handler.tradePairs(), 2);
        _assertAll();
        afterInvariant();
    }

    function test_ReentrantFeeWithdrawalsCannotPayEitherShareTwice() public {
        handler.setReentryMode(0, 2);
        handler.setReentryMode(1, 2);
        handler.tradePair(1 ether);
        handler.collect();
        assertGt(handler.wallets(0).reentries(), 0);
        assertGt(handler.wallets(1).reentries(), 0);
        _assertAll();
        afterInvariant();
    }

    function test_ReentrantFeeCollectionHasNoSecondPrincipalOrFeeWithdrawal() public {
        handler.setReentryMode(0, 3);
        handler.setReentryMode(1, 3);
        handler.tradePair(1 ether);
        handler.collect();
        assertGt(handler.wallets(0).reentries(), 0);
        assertGt(handler.wallets(1).reentries(), 0);
        _assertAll();
        afterInvariant();
    }

    function test_RejectingNetworkRecipientCannotHoldPayerFeesHostage() public {
        handler.setRecipientMode(1, true);
        handler.tradePair(1 ether);
        handler.collect();
        assertGt(address(handler.wallets(0)).balance, 0);
        assertEq(handler.pending(0, 0), 0);
        assertGt(handler.networkPending(0), 0);
        assertEq(address(handler.wallets(1)).balance, 0);
        _assertAll();
        afterInvariant();
    }

    function _assertAll() internal view {
        invariant_FactoryAssetsBackEveryUnpaidFeeAndDonationsRemainSurplus();
        invariant_FeeCollectionCannotTouchPrincipalOrCreateQuota();
        invariant_RecipientsAndSettlementStayBoundToTheirActualOwners();
    }
}
