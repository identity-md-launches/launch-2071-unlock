// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixture} from "./fixtures/SystemFixture.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Adversarial capital model on the actual token-only v4 seed. Prices/clock are LOCAL fixtures.
/// No fabricated liquidity, storage overwrite, or full-unlock shortcut. Every tier is confirmed on chain.
contract ManipulationEconomicsTest is SystemFixture {
    uint256 internal gross;
    uint256 internal counterProceeds;
    uint160 internal targetPrice;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(OPENING_TICK);
        _deployCompanions();
        _activate();
        targetPrice = uint160(Math.sqrt(Math.mulDiv(2_000_000_000_000, 1 << 192, 5_100_000)));
    }

    function _rewardRoot() internal view override returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(bob, 100_000_000 ether))));
    }

    function _certifyInitialRound() internal override {
        _certifySingle(rewards, 0, bob, 100_000_000 ether);
    }

    function _restorePrice(address attacker) internal {
        uint256 budget = 1000 ether;
        vm.deal(attacker, attacker.balance + budget);
        UnlkSwapRouter.SwapRequest memory r = _request(true, -int256(budget), budget);
        r.sqrtPriceLimitX96 = targetPrice;
        vm.prank(attacker);
        (uint256 spent,) = router.swap{value: budget}(r);
        gross += spent;
        vm.prank(attacker);
        router.withdrawNative(); // refunds aren't capital consumed
    }

    function _counterSell() internal {
        address[2] memory actors = [payer, bob];
        for (uint256 i; i < actors.length; ++i) {
            uint256 amount = Math.min(hook.remainingQuota(actors[i]), token.balanceOf(actors[i]));
            if (amount != 0) counterProceeds += _sell(actors[i], amount);
        }
    }

    function _attack(address attacker, bool counterSelling) internal {
        if (counterSelling) {
            _advance(CONTRIBUTOR_LOCK);
            distributor.claim(0, bob, 100_000_000 ether, new bytes32[](0));
            rewards.attest(0, bob, 100_000_000 ether, new bytes32[](0));
            hook.syncRewards(bob);
            hook.syncPayer();
        }
        uint256 start = block.timestamp;
        uint256 tokensBefore = token.balanceOf(attacker);
        _restorePrice(attacker);
        if (counterSelling) {
            _counterSell();
            _restorePrice(attacker);
        }
        _advance(oracle.WINDOW());
        hook.updateMilestone();
        uint8 previous;
        while (!hook.fullyUnlocked()) {
            _advance(5 minutes);
            hook.updateMilestone();
            if (counterSelling && hook.tier() > previous) {
                _counterSell();
                // The attacker must defend the price through every intermediate increase in sale rights.
                if (!hook.fullyUnlocked()) _restorePrice(attacker);
                previous = hook.tier();
            }
            require(block.timestamp - start <= 4 days, "model failed to unlock");
        }
        uint256 duration = block.timestamp - start;
        uint256 acquired = token.balanceOf(attacker) - tokensBefore;
        uint256 exit = _sell(attacker, acquired);
        uint256 payerBalanceBefore = payer.balance;
        factory.claimFees(LAUNCH_NUMBER);
        uint256 payerNativeFees = payer.balance - payerBalanceBefore;
        emit log_named_uint("gross ETH capital (wei)", gross);
        emit log_named_uint("attacker ETH exit (wei)", exit);
        emit log_named_uint("net ETH exit cost before fee recapture (wei)", gross - exit);
        emit log_named_uint("payer ETH fee receipts (wei)", payerNativeFees);
        emit log_named_uint("counter-seller ETH proceeds (wei)", counterProceeds);
        emit log_named_uint("duration seconds", duration);
        if (attacker == payer) {
            emit log_named_uint(
                "net ETH cost after native fee recapture (wei)", gross - exit - payerNativeFees
            );
        }
        assertGe(duration, oracle.WINDOW() + 5 * hook.CONFIRMATION() + hook.FINAL_CONFIRMATION());
        assertGt(gross, exit);
        assertTrue(hook.fullyUnlocked());
        if (counterSelling) {
            assertGt(counterProceeds, 0);
            assertGt(gross - exit, 100 ether);
        }
    }

    function testSustainedManipulationUnlockAndExit() public {
        _attack(alice, false);
    }

    function testPayerCanRecaptureItsNativeFeeShare() public {
        _attack(payer, false);
    }

    function testCounterSellingOfAllInitialNonPoolTokens() public {
        _attack(alice, true);
    }
}
