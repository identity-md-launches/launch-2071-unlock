// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {SpotIntegrationFixture} from "./SpotIntegrationFixture.sol";
import {UnlkImdHook} from "src/mainnet/UnlkImdHook.sol";
import {UnlkToken} from "src/UnlkToken.sol";
import {MerkleClaimEvidence} from "src/MerkleClaimEvidence.sol";
import {UnlkImdOracle, IImdUsdSource} from "src/mainnet/UnlkImdOracle.sol";
import {ImdSpotUsdSource} from "src/mainnet/ImdSpotUsdSource.sol";
import {ImdFeeVault} from "src/mainnet/ImdFeeVault.sol";
import {MainnetPins} from "src/mainnet/MainnetPins.sol";
import {MerkleDistributor} from "../imd/MerkleDistributor.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";

/// @dev Exercises setup in arbitrary transaction order. The production hook, source, evidence,
/// oracle and vault are unmodified. Recorded service code runs on synthetic local state.
/// No mocks replace priceUsd, setup verification, native claim delivery, or hook accounting.
contract SetupLifecycleHandler is Test {
    struct Bundle {
        address source;
        MerkleClaimEvidence evidence;
        UnlkImdOracle oracle;
        ImdFeeVault vault;
        bool certified;
        bool attested;
    }

    UnlkImdHook public immutable hook;
    UnlkToken public immutable token;
    MerkleDistributor public immutable distributor;
    address public immutable authority;
    address public immutable payer;
    uint64 public immutable number;
    address[3] public actors;
    bytes[4] private codes;
    bytes private sourceCode;
    Bundle[] private bundles;

    address public modelSource;
    uint64 public modelStagings;
    bool public modelActive;
    bool public referenceValid = true;
    bool public nativeClaimed;
    bool public payerSynced;
    bool public rewardSynced;
    uint256 public successfulActivations;
    uint256 public refusedActivations;
    uint256 public refusedSetup;
    uint256 public transfers;
    uint256 public constant REWARD = 1_000_000 ether;

    constructor(
        UnlkImdHook h,
        MerkleDistributor d,
        uint64 n,
        address alice,
        address bob,
        address payer_,
        bytes[4] memory bundleCodes,
        bytes memory priceCode
    ) {
        hook = h;
        token = h.token();
        distributor = d;
        authority = h.setupAuthority();
        payer = payer_;
        number = n;
        actors = [alice, bob, payer_];
        codes = bundleCodes;
        sourceCode = priceCode;
    }

    function bundleCount() external view returns (uint256) {
        return bundles.length;
    }

    function bundle(uint256 i) external view returns (Bundle memory) {
        return bundles[i];
    }

    function _state() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                hook.activated(),
                hook.stagings(),
                hook.stagedPriceSource(),
                hook.stagedRewards(),
                hook.stagedOracle(),
                hook.stagedLaunchNumber(),
                address(hook.setupVerifier()),
                address(hook.nftFeeVault()),
                address(hook.rewards()),
                address(hook.oracle()),
                hook.payer(),
                hook.swarm(),
                hook.launchNumber()
            )
        );
    }

    function _refusal(bytes memory callData, address caller, bytes4 reason) private {
        bytes32 beforeState = _state();
        vm.prank(caller);
        (bool ok, bytes memory result) = address(hook).call(callData);
        assertFalse(ok, "invalid setup succeeded");
        assertEq(result, abi.encodeWithSelector(reason), "unexpected underlying setup revert");
        assertEq(_state(), beforeState, "failed setup changed configuration");
        ++refusedSetup;
    }

    function stageSource() public {
        bytes memory data = abi.encodeCall(hook.deployPriceSource, (sourceCode, bytes("")));
        if (modelActive) {
            _refusal(data, authority, UnlkImdHook.AlreadyActivated.selector);
            return;
        }
        vm.prank(authority);
        modelSource = hook.deployPriceSource(sourceCode, "");
        ++modelStagings;
    }

    function stageBundle() public {
        bytes[4] memory creation = codes;
        bytes memory data =
            abi.encodeCall(hook.deployCompanions, (number, IImdUsdSource(modelSource), creation));
        if (modelActive || modelSource == address(0)) {
            _refusal(
                data,
                authority,
                modelActive ? UnlkImdHook.AlreadyActivated.selector : UnlkImdHook.InvalidConfig.selector
            );
            return;
        }
        vm.prank(authority);
        (address e, address o, address v) =
            hook.deployCompanions(number, IImdUsdSource(modelSource), creation);
        bundles.push(
            Bundle(modelSource, MerkleClaimEvidence(e), UnlkImdOracle(o), ImdFeeVault(v), false, false)
        );
        ++modelStagings;
    }

    function certify(uint256 pick) public {
        if (bundles.length == 0) return;
        Bundle storage b = bundles[pick % bundles.length];
        address[] memory recipients = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        recipients[0] = actors[0];
        amounts[0] = REWARD;
        if (b.certified) vm.expectRevert(MerkleClaimEvidence.InvalidConfig.selector);
        b.evidence.certifyRound(0, recipients, amounts);
        b.certified = true;
    }

    function activate() public {
        if (bundles.length == 0) return;
        Bundle storage b = bundles[bundles.length - 1];
        bytes memory data = abi.encodeCall(hook.configureAndActivate, (b.evidence, b.oracle, number));
        bytes4 reason;
        if (modelActive) reason = UnlkImdHook.AlreadyActivated.selector;
        else if (!b.certified) reason = UnlkImdHook.InvalidEvidence.selector;
        else if (b.source != modelSource) reason = UnlkImdHook.InvalidConfig.selector;
        else if (!referenceValid) reason = ImdSpotUsdSource.InvalidPrice.selector;
        if (reason != bytes4(0)) {
            _refusal(data, authority, reason);
            ++refusedActivations;
            return;
        }
        vm.prank(authority);
        hook.configureAndActivate(b.evidence, b.oracle, number);
        modelActive = true;
        ++successfulActivations;
    }

    function rejectObsoleteBundle(uint256 pick) public {
        if (bundles.length < 2) return;
        Bundle storage old = bundles[pick % (bundles.length - 1)];
        _refusal(
            abi.encodeCall(hook.configureAndActivate, (old.evidence, old.oracle, number)),
            authority,
            modelActive ? UnlkImdHook.AlreadyActivated.selector : UnlkImdHook.InvalidConfig.selector
        );
        assertFalse(old.oracle.bound(), "abandoned oracle bound");
    }

    function unauthorizedSetup(uint8 kind, uint256 who) public {
        address caller = actors[who % actors.length];
        bytes memory data;
        if (kind % 3 == 0) {
            data = abi.encodeCall(hook.deployPriceSource, (sourceCode, bytes("")));
        } else if (kind % 3 == 1) {
            bytes[4] memory creation = codes;
            data = abi.encodeCall(hook.deployCompanions, (number, IImdUsdSource(modelSource), creation));
        } else {
            data = abi.encodeCall(hook.configureAndActivate, (hook.rewards(), hook.oracle(), number));
        }
        _refusal(data, caller, UnlkImdHook.Unauthorized.selector);
    }

    function invalidateReference(bool invalid) public {
        referenceValid = !invalid;
        _refreshReference();
    }

    function _refreshReference() private {
        vm.mockCall(
            MainnetPins.ETHUSD_ADDRESS,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(
                uint80(1),
                referenceValid ? int256(3000e8) : int256(0),
                block.timestamp,
                block.timestamp,
                uint80(1)
            )
        );
    }

    function advance(uint16 seconds_) public {
        vm.warp(block.timestamp + bound(seconds_, 1, 2 hours));
        vm.roll(block.number + 1);
        _refreshReference();
    }

    function claim() public {
        uint256 beforeBalance = token.balanceOf(actors[0]);
        if (nativeClaimed) {
            vm.expectRevert(MerkleDistributor.AlreadyClaimed.selector);
            distributor.claim(0, actors[0], REWARD, new bytes32[](0));
        } else if (block.timestamp >= distributor.roundOf(0).unlocksAt) {
            distributor.claim(0, actors[0], REWARD, new bytes32[](0));
            assertEq(token.balanceOf(actors[0]) - beforeBalance, REWARD);
            nativeClaimed = true;
        }
    }

    function attest(uint256 pick) public {
        if (bundles.length == 0 || !nativeClaimed) return;
        Bundle storage b = bundles[pick % bundles.length];
        if (b.attested) vm.expectRevert(MerkleClaimEvidence.AlreadyAttested.selector);
        else if (!b.certified) vm.expectRevert(MerkleClaimEvidence.UncertifiedRound.selector);
        b.evidence.attest(0, actors[0], REWARD, new bytes32[](0));
        if (b.certified) b.attested = true;
    }

    function sync(bool initialPayer) public {
        if (!modelActive) {
            vm.expectRevert(UnlkImdHook.NotActivated.selector);
            if (initialPayer) hook.syncPayer();
            else hook.syncRewards(actors[0]);
        } else if (initialPayer) {
            assertEq(hook.syncPayer(), payerSynced ? 0 : 30_000_000 ether);
            payerSynced = true;
        } else {
            bool delivered = bundles[bundles.length - 1].attested;
            assertEq(hook.syncRewards(actors[0]), delivered && !rewardSynced ? REWARD : 0);
            if (delivered) rewardSynced = true;
        }
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint256 raw) public {
        address from = actors[fromSeed % actors.length];
        address to = actors[toSeed % actors.length];
        uint256 amount = bound(raw, 0, token.balanceOf(from));
        vm.prank(from);
        assertTrue(token.transfer(to, amount));
        ++transfers;
    }

    function checkpoint() public {
        if (!modelActive) vm.expectRevert(UnlkImdHook.NotActivated.selector);
        bool changed = hook.checkpoint();
        if (modelActive) assertFalse(changed, "fixed low opening price cannot open a gate");
    }
}

/// forge-config: default.invariant.runs = 128
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = true
contract SetupLifecycleInvariantsTest is SpotIntegrationFixture {
    SetupLifecycleHandler internal handler;
    bytes32 internal allocationReceipt;
    bytes32 internal boundPool;

    function setUp() public override {
        _deploy(false);
        _launchTokenOnly(-129000);
        _prepareReference();
        _freshFeed();
        handler = new SetupLifecycleHandler(
            hook, distributor, LAUNCH_NUMBER, alice, bob, payer, _codes(), type(ImdSpotUsdSource).creationCode
        );
        allocationReceipt = _receipt();
        boundPool = PoolId.unwrap(hook.poolId());
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](13);
        selectors[0] = handler.stageSource.selector;
        selectors[1] = handler.stageBundle.selector;
        selectors[2] = handler.certify.selector;
        selectors[3] = handler.activate.selector;
        selectors[4] = handler.rejectObsoleteBundle.selector;
        selectors[5] = handler.unauthorizedSetup.selector;
        selectors[6] = handler.invalidateReference.selector;
        selectors[7] = handler.advance.selector;
        selectors[8] = handler.claim.selector;
        selectors[9] = handler.attest.selector;
        selectors[10] = handler.sync.selector;
        selectors[11] = handler.transfer.selector;
        selectors[12] = handler.checkpoint.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function _receipt() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                token.initialRecipient(),
                token.initialMinter(),
                token.initialAllocation(address(manager)),
                token.initialAllocation(address(distributor)),
                token.initialAllocation(payer),
                token.distributionComplete()
            )
        );
    }

    function invariant_OnlyTheLatestCertifiedBundleCanSealOnce() public view {
        assertEq(hook.activated(), handler.modelActive());
        assertEq(hook.stagings(), handler.modelStagings());
        assertEq(hook.stagedPriceSource(), handler.modelSource());
        assertEq(handler.successfulActivations(), hook.activated() ? 1 : 0);
        uint256 count = handler.bundleCount();
        for (uint256 i; i < count; ++i) {
            SetupLifecycleHandler.Bundle memory b = handler.bundle(i);
            bool selected = i == count - 1;
            assertEq(b.oracle.bound(), selected && hook.activated());
            assertEq(b.evidence.certified(0), b.certified);
            assertEq(b.evidence.claimed(alice), b.attested ? REWARD : 0);
            assertEq(address(b.oracle.feed()), b.source);
            assertEq(b.vault.totalAccrued(), 0, "setup cannot create trading revenue");
            if (selected) {
                assertEq(hook.stagedRewards(), address(b.evidence));
                assertEq(hook.stagedOracle(), address(b.oracle));
                assertEq(address(hook.nftFeeVault()), address(b.vault));
                if (hook.activated()) {
                    assertEq(address(hook.rewards()), address(b.evidence));
                    assertEq(address(hook.oracle()), address(b.oracle));
                    assertEq(hook.payer(), payer);
                    assertEq(hook.swarm(), address(distributor));
                    assertEq(hook.launchNumber(), LAUNCH_NUMBER);
                    assertEq(b.source, handler.modelSource());
                }
            }
        }
        if (!hook.activated()) {
            assertEq(address(hook.rewards()), address(0));
            assertEq(address(hook.oracle()), address(0));
            assertEq(hook.payer(), address(0));
            assertEq(hook.swarm(), address(0));
            assertEq(hook.launchNumber(), 0);
        }
    }

    function invariant_NativeClaimsTransfersAndCreditsRemainIndependent() public view {
        assertEq(distributor.claimed(0, alice), handler.nativeClaimed());
        assertEq(hook.eligible(alice), handler.rewardSynced() ? REWARD : 0);
        assertEq(hook.eligible(payer), handler.payerSynced() ? token.PAYER_ALLOCATION() : 0);
        assertEq(hook.eligible(bob), 0);
        assertEq(hook.claimedCredit(alice), handler.rewardSynced() ? REWARD : 0);
        assertEq(hook.sold(alice) + hook.sold(bob) + hook.sold(payer), 0);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(
            token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(payer)
                + token.balanceOf(address(manager)) + token.balanceOf(address(distributor))
                + token.balanceOf(address(factory)),
            token.SUPPLY()
        );
        assertEq(_receipt(), allocationReceipt, "transfers rewrote original allocation evidence");
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
        assertEq(PoolId.unwrap(hook.poolId()), boundPool);
        assertEq(hook.p(), 2000);
        assertEq(hook.tier(), 0);
        assertFalse(hook.fullyUnlocked());
    }

    function afterInvariant() public {
        // Every explored inactive state must still be recoverable by staging the reviewed bundle.
        // This also forces a real activation and native-claim reconciliation in every campaign run.
        if (!handler.modelActive()) {
            handler.invalidateReference(false);
            handler.stageSource();
            handler.stageBundle();
            handler.certify(handler.bundleCount() - 1);
            handler.activate();
        }
        handler.advance(uint16(CONTRIBUTOR_LOCK));
        handler.claim();
        handler.attest(handler.bundleCount() - 1);
        handler.sync(false);
        handler.sync(true);
        invariant_OnlyTheLatestCertifiedBundleCanSealOnce();
        invariant_NativeClaimsTransfersAndCreditsRemainIndependent();
        assertTrue(hook.activated());
        assertEq(hook.eligible(alice), REWARD);
        assertEq(hook.eligible(payer), token.PAYER_ALLOCATION());
    }

    function testRestagingInvalidatesOldBundlesButPreservesPreactivationNativeClaims() public {
        handler.stageBundle(); // No source: fail atomically.
        handler.advance(uint16(CONTRIBUTOR_LOCK));
        handler.invalidateReference(true);
        handler.claim(); // No source, companions, or activation needed.
        handler.transfer(0, 1, REWARD);
        handler.sync(false);
        handler.stageSource();
        handler.stageBundle();
        handler.activate(); // Uncertified.
        handler.certify(0);
        handler.attest(0);
        handler.activate(); // Certified but invalid live reference.
        handler.stageSource();
        handler.invalidateReference(false);
        handler.activate(); // Old oracle still names the replaced source.
        handler.stageBundle();
        handler.rejectObsoleteBundle(0);
        handler.certify(1);
        handler.activate();
        handler.sync(false); // Attestation of the abandoned adapter cannot issue active credits.
        assertEq(hook.eligible(alice), 0);
        handler.attest(1);
        handler.sync(false);
        handler.sync(false);
        handler.sync(true);
        handler.sync(true);
        handler.stageSource();
        handler.stageBundle();
        handler.activate();
        handler.rejectObsoleteBundle(0);
        handler.unauthorizedSetup(2, 1);
        invariant_OnlyTheLatestCertifiedBundleCanSealOnce();
        invariant_NativeClaimsTransfersAndCreditsRemainIndependent();
        assertEq(handler.successfulActivations(), 1);
        assertGe(handler.refusedActivations(), 4);
        assertGt(handler.refusedSetup(), 0);
        assertEq(token.balanceOf(bob), REWARD);
        assertEq(hook.remainingQuota(alice), REWARD / 5);

        // The sealed configuration also works on the real recorded router, with the production spot source.
        uint256 bought = _buy(bob, 1 ether);
        assertGt(bought, 0);
        assertEq(hook.eligible(bob), bought, "transferred rewards never became buy credits");
        assertGt(_sell(bob, bought / 5), 0);
    }
}

/// forge-config: default.invariant.runs = 128
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = true
contract SetupLifecycleReverseOrderInvariantsTest is SetupLifecycleInvariantsTest {
    function _preferToken0() internal pure override returns (bool) {
        return false;
    }
}
