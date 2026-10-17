// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {UnlkHook} from "src/UnlkHook.sol";
import {UnlkToken} from "src/UnlkToken.sol";
import {UnlkSwapRouter} from "src/UnlkSwapRouter.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {TransientStateLibrary} from "v4-core/src/libraries/TransientStateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

contract CustodyForcedEther {
    constructor(address payable recipient) payable {
        selfdestruct(recipient);
    }
}

/// @dev Real contract callers exercise router identity independently of tx.origin and can reject ETH
/// or reenter its withdrawal. Only the handler drives this test wallet.
contract CustodyWallet {
    address private immutable driver;
    UnlkSwapRouter private immutable router;
    UnlkToken private immutable token;
    uint8 public mode;
    uint256 public received;

    constructor(UnlkSwapRouter r, UnlkToken t) {
        driver = msg.sender;
        router = r;
        token = t;
        t.approve(address(r), type(uint256).max);
    }

    modifier onlyDriver() {
        require(msg.sender == driver, "test wallet driver");
        _;
    }

    function batch(UnlkSwapRouter.SwapRequest[] calldata requests)
        external
        payable
        onlyDriver
        returns (uint256[] memory, uint256[] memory)
    {
        return router.swapBatch{value: msg.value}(requests);
    }

    function withdraw(uint8 mode_) external onlyDriver {
        mode = mode_;
        router.withdrawNative();
    }

    function transfer(address recipient, uint256 amount) external onlyDriver {
        token.transfer(recipient, amount);
    }

    receive() external payable {
        require(msg.sender == address(router), "router only");
        require(mode != 1, "wallet rejects ETH");
        received += msg.value;
        if (mode == 2) router.withdrawNative();
    }
}

contract NativeCustodyHandler is Test {
    UnlkSwapRouter public immutable router;
    UnlkToken public immutable token;
    UnlkHook public immutable hook;
    CustodyWallet[3] public wallets;
    uint256[3] public bought;
    uint256[3] public sold;
    uint256[3] public tokensHeld;
    uint256[3] public owed;
    uint256[3] public paid;
    uint256 public forcedEther;
    uint256 public donatedTokens;
    uint256 public poolNativeIn;
    uint256 public poolNativeOut;
    uint256 public successfulBatches;
    uint256 public rejectedBatches;
    uint256 public rejectedWithdrawals;

    constructor(UnlkSwapRouter r, UnlkHook h) {
        router = r;
        hook = h;
        token = h.token();
        for (uint256 i; i < wallets.length; ++i) {
            wallets[i] = new CustodyWallet(r, token);
        }
    }

    function tradeBatch(uint256 actorSeed, uint96 amountSeed, uint8 pairsSeed) external {
        uint256 actor = actorSeed % wallets.length;
        uint256 amount = bound(amountSeed, 100 ether, 1000 ether);
        uint256 pairs = bound(pairsSeed, 1, 4);
        UnlkSwapRouter.SwapRequest[] memory requests = _requests(amount, pairs);
        uint256 value = pairs * 0.01 ether;
        vm.deal(address(this), value);
        (uint256[] memory inputs, uint256[] memory outputs) = wallets[actor].batch{value: value}(requests);
        assertEq(inputs.length, pairs * 2);
        assertEq(outputs.length, pairs * 2);
        for (uint256 i; i < pairs * 2; ++i) {
            if (i % 2 == 0) {
                assertEq(outputs[i], amount, "exact-output buy must deliver in full");
                bought[actor] += outputs[i];
                tokensHeld[actor] += outputs[i];
                owed[actor] += 0.01 ether - inputs[i];
                poolNativeIn += inputs[i];
            } else {
                assertEq(inputs[i], amount / 5, "small exact-input sale fills in full");
                sold[actor] += inputs[i];
                tokensHeld[actor] -= inputs[i];
                owed[actor] += outputs[i];
                poolNativeOut += outputs[i];
            }
        }
        ++successfulBatches;
    }

    function failBatch(uint256 actorSeed, uint96 amountSeed) external {
        uint256 actor = actorSeed % wallets.length;
        UnlkSwapRouter.SwapRequest[] memory requests = _requests(bound(amountSeed, 100 ether, 1000 ether), 2);
        requests[3].minOutput = type(uint256).max;
        uint256 nonce = router.nonce();
        vm.deal(address(this), 0.02 ether);
        vm.expectRevert(UnlkSwapRouter.Slippage.selector);
        wallets[actor].batch{value: 0.02 ether}(requests);
        assertEq(address(this).balance, 0.02 ether, "failed batch retained its ETH prefund");
        assertEq(router.nonce(), nonce, "failed batch consumed nonces");
        ++rejectedBatches;
    }

    function withdraw(uint256 actorSeed, uint8 modeSeed) external {
        uint256 actor = actorSeed % wallets.length;
        uint8 mode = modeSeed % 3;
        uint256 amount = owed[actor];
        if (mode == 1 && amount != 0) {
            vm.expectRevert(UnlkSwapRouter.SettlementMismatch.selector);
            wallets[actor].withdraw(mode);
            ++rejectedWithdrawals;
        } else {
            wallets[actor].withdraw(mode);
            owed[actor] = 0;
            paid[actor] += amount;
        }
        assertEq(wallets[actor].received(), paid[actor], "withdrawal paid more or less than settled credit");
        assertEq(address(wallets[actor]).balance, paid[actor]);
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint96 amountSeed) external {
        uint256 from = fromSeed % wallets.length;
        uint256 to = toSeed % wallets.length;
        uint256 amount = bound(amountSeed, 0, tokensHeld[from]);
        wallets[from].transfer(address(wallets[to]), amount);
        tokensHeld[from] -= amount;
        tokensHeld[to] += amount;
    }

    function donateTokens(uint256 actorSeed, uint96 amountSeed) external {
        uint256 actor = actorSeed % wallets.length;
        uint256 amount = bound(amountSeed, 0, tokensHeld[actor]);
        wallets[actor].transfer(address(router), amount);
        tokensHeld[actor] -= amount;
        donatedTokens += amount;
    }

    function forceEther(uint96 amountSeed) external {
        uint256 amount = bound(amountSeed, 1, 1 ether);
        vm.deal(address(this), amount);
        new CustodyForcedEther{value: amount}(payable(address(router)));
        forcedEther += amount;
    }

    function _requests(uint256 amount, uint256 pairs)
        private
        view
        returns (UnlkSwapRouter.SwapRequest[] memory requests)
    {
        requests = new UnlkSwapRouter.SwapRequest[](pairs * 2);
        for (uint256 i; i < pairs; ++i) {
            requests[2 * i] = UnlkSwapRouter.SwapRequest(
                true, int256(amount), TickMath.MIN_SQRT_PRICE + 1, 0.01 ether, amount, block.timestamp
            );
            requests[2 * i + 1] = UnlkSwapRouter.SwapRequest(
                false, -int256(amount / 5), TickMath.MAX_SQRT_PRICE - 1, amount / 5, 1, block.timestamp
            );
        }
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = true
contract NativeCustodyInvariantsTest is SystemFixture {
    using TransientStateLibrary for IPoolManager;
    NativeCustodyHandler internal handler;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _deployCompanions();
        _activate();
        handler = new NativeCustodyHandler(router, hook);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.tradeBatch.selector;
        selectors[1] = handler.failBatch.selector;
        selectors[2] = handler.withdraw.selector;
        selectors[3] = handler.transfer.selector;
        selectors[4] = handler.donateTokens.selector;
        selectors[5] = handler.forceEther.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_NativeLiabilitiesRemainFullyBackedAndBelongToTheirWallet() public view {
        uint256 total;
        for (uint256 i; i < 3; ++i) {
            CustodyWallet wallet = handler.wallets(i);
            uint256 owed = handler.owed(i);
            assertEq(router.nativeCredit(address(wallet)), owed);
            assertEq(wallet.received(), handler.paid(i));
            assertEq(address(wallet).balance, handler.paid(i));
            total += owed;
        }
        assertEq(router.totalNativeCredit(), total);
        assertEq(
            address(router).balance, total + handler.forcedEther(), "donations are surplus, not liabilities"
        );
        assertEq(address(manager).balance, handler.poolNativeIn() - handler.poolNativeOut());
        assertEq(router.nativeCredit(address(handler)), 0, "driver is not the authenticated trader");
        assertEq(address(hook).balance, 0, "no hook fee");
    }

    function invariant_TransfersDonationsAndFailedBatchesCannotCreateOrMoveRights() public view {
        uint256 walletTokens;
        for (uint256 i; i < 3; ++i) {
            address wallet = address(handler.wallets(i));
            assertEq(hook.eligible(wallet), handler.bought(i));
            assertEq(hook.sold(wallet), handler.sold(i));
            assertLe(handler.sold(i), handler.bought(i) / 4);
            assertEq(token.balanceOf(wallet), handler.tokensHeld(i));
            walletTokens += handler.tokensHeld(i);
        }
        assertEq(token.balanceOf(address(router)), handler.donatedTokens());
        assertEq(hook.eligible(address(router)), 0);
        assertEq(hook.eligible(address(handler)), 0);
        assertEq(
            token.balanceOf(address(manager)) + token.balanceOf(address(distributor)) + token.balanceOf(payer)
                + walletTokens + handler.donatedTokens(),
            1_000_000_000 ether
        );
    }

    function invariant_ManagerHasNoUnsettledDeltaOrReusableRouteContext() public view {
        IPoolManager pm = IPoolManager(address(manager));
        assertEq(pm.getNonzeroDeltaCount(), 0);
        assertFalse(pm.isUnlocked());
        assertEq(pm.currencyDelta(address(router), key.currency0), 0);
        assertEq(pm.currencyDelta(address(router), key.currency1), 0);
        (address trader, bytes32 operation) = router.context();
        assertEq(trader, address(0));
        assertEq(operation, bytes32(0));
    }

    function afterInvariant() public {
        // Liveness after EVERY random sequence: once a wallet accepts ETH, all its credit is redeemable.
        for (uint256 i; i < 3; ++i) {
            handler.withdraw(i, 0);
        }
        assertEq(router.totalNativeCredit(), 0);
        assertEq(address(router).balance, handler.forcedEther());
        invariant_NativeLiabilitiesRemainFullyBackedAndBelongToTheirWallet();
        invariant_TransfersDonationsAndFailedBatchesCannotCreateOrMoveRights();
        invariant_ManagerHasNoUnsettledDeltaOrReusableRouteContext();
    }

    function test_HandlerTradesRejectsReentersAndDrainsWithoutTakingDonations() public {
        handler.forceEther(0.7 ether);
        handler.tradeBatch(0, 1000 ether, 4);
        handler.tradeBatch(1, 100 ether, 1);
        handler.donateTokens(0, 13 ether);
        handler.transfer(0, 2, 100 ether);
        handler.withdraw(2, 2); // transfer-only wallet has no proceeds to withdraw
        handler.failBatch(2, 1000 ether);
        handler.withdraw(0, 1); // rejection restores its whole liability
        assertEq(handler.rejectedWithdrawals(), 1);
        assertGt(router.nativeCredit(address(handler.wallets(0))), 0);
        handler.withdraw(1, 2); // callback attempts to collect the same liability twice
        assertEq(handler.rejectedBatches(), 1);
        assertEq(handler.successfulBatches(), 2);
        invariant_NativeLiabilitiesRemainFullyBackedAndBelongToTheirWallet();
        invariant_TransfersDonationsAndFailedBatchesCannotCreateOrMoveRights();
        afterInvariant();
    }
}
