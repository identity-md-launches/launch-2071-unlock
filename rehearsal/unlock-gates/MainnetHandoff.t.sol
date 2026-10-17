// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ImdLaunchPlanTest} from "test/mainnet/ImdLaunchPlan.t.sol";
import {ImdFixture} from "test/mainnet/ImdFixture.sol";
import {ImdSwapsTest} from "test/mainnet/ImdSwaps.t.sol";
import {ImdPermitAndBatchTest} from "test/mainnet/ImdPermitAndBatch.t.sol";
import {ImdSetupTest} from "test/mainnet/ImdSetup.t.sol";
import {QuotaMitigationTest} from "test/mainnet/QuotaMitigation.t.sol";
import {OneWayGatesTest} from "test/mainnet/OneWayGates.t.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {UnlkImdHook} from "src/mainnet/UnlkImdHook.sol";
import {UnlkImdOracle, IImdUsdSource} from "src/mainnet/UnlkImdOracle.sol";
import {ImdUsdSource} from "src/mainnet/ImdUsdSource.sol";
import {ImdSpotUsdSource} from "src/mainnet/ImdSpotUsdSource.sol";
import {MerkleClaimEvidence} from "src/MerkleClaimEvidence.sol";
import {ImdFeeVault} from "src/mainnet/ImdFeeVault.sol";
import {MainnetPins} from "src/mainnet/MainnetPins.sol";
import {IChainlinkEthUsd} from "src/interfaces/IIntegration.sol";
import {PrepareImd} from "script/mainnet/PrepareImd.s.sol";
import {PrepareOwnerTransactions} from "script/mainnet/PrepareOwnerTransactions.s.sol";

/// @notice Local-only actual recorded-block factory/manager/router/Permit2 rehearsal. No broadcast.
/// Stage1 is a LOCAL deployer impersonation with synthetic launch number, identities, complete two-recipient 100M tree and token funding.
/// Companion creation, certification and activation use exact production code, including the CURRENT-STATE
/// spot source reading the ACTUAL recorded IMD/ETH v4 pool and the ACTUAL recorded Chainlink round.
/// Activation happens in the setup block: no vm.warp, no sample history, no priceUsd mock, no fabricated round.
///
/// After activation, inherited tests that advance time renew Chainlink round timestamps through the fixture's
/// _freshFeed() (recorded answer held constant). Gate-boundary tests inherited from OneWayGatesTest deliberately
/// substitute reference/state fixtures AFTER activation to isolate exact edge cases; those are not real market
/// moves. Actual swaps still run the recorded standard runtime.
abstract contract MainnetHandoffFixture is ImdFixture {
    uint256 internal constant RECORDED_BLOCK = 26210931;

    function _newManager() internal virtual override returns (PoolManager) {
        vm.createSelectFork("https://ethereum-rpc.publicnode.com", RECORDED_BLOCK);
        require(block.chainid == 1, "mainnet required");
        (uint80 round, int256 answer,, uint256 updated,) =
            IChainlinkEthUsd(MainnetPins.ETHUSD_ADDRESS).latestRoundData();
        require(round > 0 && answer > 0 && updated <= block.timestamp, "actual recorded feed required");
        feedAnswer = answer;
        return PoolManager(payable(MainnetPins.MANAGER_ADDRESS));
    }

    function _rewardLeaf(address recipient, uint256 amount) private pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(recipient, amount))));
    }

    function _rewardRoot() internal view virtual override returns (bytes32) {
        bytes32 a = _rewardLeaf(alice, REWARD);
        bytes32 b = _rewardLeaf(bob, 100_000_000 ether - REWARD);
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _certifyInitialRound() internal virtual override {
        address[] memory recipients = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        recipients[0] = alice;
        recipients[1] = bob;
        amounts[0] = REWARD;
        amounts[1] = 100_000_000 ether - REWARD;
        rewards.certifyRound(0, recipients, amounts);
    }

    function _claimReward() internal virtual override {
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = _rewardLeaf(bob, 100_000_000 ether - REWARD);
        // Activation needed no time; only the factory's native contributor lock matures here, after activation.
        _advance(CONTRIBUTOR_LOCK);
        distributor.claim(0, alice, REWARD, proof);
    }

    function _attestReward() internal virtual override returns (uint256) {
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = _rewardLeaf(bob, 100_000_000 ether - REWARD);
        return rewards.attest(0, alice, REWARD, proof);
    }

    function _deployCompanions() internal virtual override {
        uint256 t = block.timestamp;
        uint256 n = block.number;
        PrepareOwnerTransactions planner = new PrepareOwnerTransactions();
        // Locally deployed hook is this build's exact code; real release must independently resolve
        // the final runtime immutables before supplying its expected hash to the wallet preparer.
        PrepareOwnerTransactions.Expected memory expected =
            PrepareOwnerTransactions.Expected(owner, payer, address(hook).codehash);
        PrepareOwnerTransactions.WalletTransaction memory sourceCall =
            planner.sourceTransaction(hook, LAUNCH_NUMBER, expected);
        vm.prank(sourceCall.from);
        (bool sourceOk, bytes memory result) = sourceCall.to.call(sourceCall.data);
        assertTrue(sourceOk, "owner source transaction");
        address sourceAddress = abi.decode(result, (address));
        priceSource = ImdUsdSource(sourceAddress); // shared fixture ABI; deployed code is the spot source.
        address[] memory recipients = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        recipients[0] = alice;
        recipients[1] = bob;
        amounts[0] = REWARD;
        amounts[1] = 100_000_000 ether - REWARD;
        (PrepareImd.Plan memory plan, PrepareOwnerTransactions.WalletTransaction[] memory calls) = planner.transactions(
            PrepareImd.Config(hook, LAUNCH_NUMBER, IImdUsdSource(sourceAddress), address(distributor)),
            expected,
            recipients,
            amounts
        );
        // The shared fixture executes configureAndActivate immediately after this function.
        // Assert it uses exactly the final wallet calldata, with the same owner and target.
        for (uint256 i; i + 1 < calls.length; ++i) {
            assertEq(calls[i].chainId, 1);
            assertEq(calls[i].from, owner);
            assertEq(calls[i].value, 0);
            vm.prank(calls[i].from);
            (bool ok,) = calls[i].to.call(calls[i].data);
            assertTrue(ok, "owner companion/certification transaction");
        }
        rewards = MerkleClaimEvidence(plan.evidence);
        oracle = UnlkImdOracle(plan.oracle);
        vault = ImdFeeVault(payable(plan.vault));
        assertEq(calls[calls.length - 1].to, address(hook));
        assertEq(calls[calls.length - 1].from, owner);
        assertEq(
            calls[calls.length - 1].data,
            abi.encodeWithSelector(hook.configureAndActivate.selector, rewards, oracle, LAUNCH_NUMBER)
        );
        // Actual recorded pool and feed: a valid current reference with no history.
        uint256 usd = ImdSpotUsdSource(sourceAddress).priceUsd();
        emit log_named_decimal_uint("recorded IMD/USD (spot x Chainlink)", usd, 18);
        assertGt(usd, 0);
        assertEq(block.timestamp, t, "no time travel before activation");
        assertEq(block.number, n);
        _approveRouter(alice);
        _approveRouter(bob);
        _approveRouter(payer);
    }
}

contract MainnetHandoffRehearsal is
    OneWayGatesTest,
    ImdSwapsTest,
    ImdPermitAndBatchTest,
    ImdSetupTest,
    QuotaMitigationTest,
    MainnetHandoffFixture
{
    function _newManager() internal override(ImdFixture, MainnetHandoffFixture) returns (PoolManager) {
        return MainnetHandoffFixture._newManager();
    }

    function _deployCompanions() internal override(ImdFixture, MainnetHandoffFixture) {
        MainnetHandoffFixture._deployCompanions();
    }

    function _rewardRoot() internal view override(ImdFixture, MainnetHandoffFixture) returns (bytes32) {
        return MainnetHandoffFixture._rewardRoot();
    }

    function _certifyInitialRound() internal override(ImdFixture, MainnetHandoffFixture) {
        MainnetHandoffFixture._certifyInitialRound();
    }

    function _claimReward() internal override(ImdFixture, MainnetHandoffFixture) {
        MainnetHandoffFixture._claimReward();
    }

    function _attestReward() internal override(ImdFixture, MainnetHandoffFixture) returns (uint256) {
        return MainnetHandoffFixture._attestReward();
    }

    function _breakReference() internal override {
        // Stale Chainlink round on the actual source, without a price mock: existing rights/trades must survive.
        vm.mockCall(
            MainnetPins.ETHUSD_ADDRESS,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(uint80(1), feedAnswer, block.timestamp - 2 hours, block.timestamp - 2 hours, uint80(1))
        );
    }

    function setUp() public override {
        LAUNCH_NUMBER = type(uint64).max - 5000;
        ImdFixture.setUp();
    }

    function testActivatedImmediatelyFromRecordedCurrentState() public view {
        assertTrue(hook.activated());
        assertEq(block.number, RECORDED_BLOCK, "activation without block or time travel");
        assertGt(oracle.fdvUsd(), 0);
    }

    function testActualProtocolFeeControllerChangePreservesRouterTradesAndSpot() public {
        uint256 bought = _buy(alice, 100 ether);
        uint256 oldEligible = hook.eligible(alice);
        address controller = manager.protocolFeeController();
        require(controller != address(0), "recorded controller required");
        vm.prank(controller); // Local fork only: exercise the actual core governance entry point.
        manager.setProtocolFee(key, 0x3e83e8);
        assertEq(hook.eligible(alice), oldEligible);
        assertGt(oracle.fdvUsd(), 0);
        uint256 accrued = vault.totalAccrued();
        assertGt(_sell(alice, bought / 10), 0);
        assertGt(_buy(bob, 1 ether), 0);
        assertGt(vault.totalAccrued(), accrued);
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
    }

    function testOperatingGasCheckpointOnly() public {
        uint256 beforeGas = gasleft();
        hook.checkpoint();
        uint256 checkpointGas = beforeGas - gasleft();
        emit log_named_uint("checkpoint execution gas (base transaction gas excluded)", checkpointGas);
        assertGt(checkpointGas, 0);
    }

    function testActualFactoryNameSupplyAndExactDistributionProvenance() public view {
        assertEq(token.name(), "UNLOCK");
        assertEq(token.symbol(), "UNLK");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.initialAllocation(address(distributor)), 100_000_000 ether);
        assertGe(token.initialAllocation(MANAGER), hook.MIN_POOL_ALLOCATION());
        assertLe(token.initialAllocation(MANAGER), 870_000_000 ether);
        assertEq(
            token.initialAllocation(payer),
            1_000_000_000 ether - 100_000_000 ether - token.initialAllocation(MANAGER)
        );
        assertTrue(hook.activated());
        assertTrue(oracle.bound());
    }
}

contract MainnetHandoffReverseRehearsal is MainnetHandoffRehearsal {
    function _preferToken0() internal pure override returns (bool) {
        return false;
    }
}

/// @dev Unsigned stage1 preparation is also exercised against the ACTUAL recorded factory runtime.
contract MainnetLaunchPlanRehearsal is ImdLaunchPlanTest {
    function _newManager() internal override returns (PoolManager) {
        vm.createSelectFork("https://ethereum-rpc.publicnode.com", 26210931);
        LAUNCH_NUMBER = type(uint64).max - 6000;
        return PoolManager(payable(MainnetPins.MANAGER_ADDRESS));
    }
}

contract MainnetLaunchPlanReverseRehearsal is MainnetLaunchPlanRehearsal {
    function _preferToken0() internal pure override returns (bool) {
        return false;
    }
}
