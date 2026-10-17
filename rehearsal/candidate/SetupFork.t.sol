// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {NftFeeVault} from "src/candidate/NftFeeVault.sol";
import {SetupVerifierV2} from "src/candidate/SetupVerifierV2.sol";
import {CandidateFixture} from "test/candidate/CandidateFixture.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {LaunchFactory} from "test/imd/LaunchFactory.sol";
import {LaunchFees} from "test/imd/LaunchFees.sol";
import {MerkleDistributor} from "test/imd/MerkleDistributor.sol";
import {UnlkToken} from "src/UnlkToken.sol";
import {UnlkHookV2} from "src/candidate/UnlkHookV2.sol";
import {UnlkRouterV2} from "src/candidate/UnlkRouterV2.sol";
import {UnlkOracle} from "src/UnlkOracle.sol";
import {MerkleClaimEvidence} from "src/MerkleClaimEvidence.sol";
import {HookDeployerV2} from "src/candidate/HookDeployerV2.sol";
import {IChainlinkEthUsd, IMerkleDistributor, IUnlkHookView} from "src/interfaces/IIntegration.sol";

/// @notice Fork-only simulation. No broadcast, fake service, mocked price, or seeded ETH.
/// The claim leaf and launch number are deliberately local rehearsal inputs, never release records.
contract CandidateSepoliaRehearsal is CandidateFixture {
    uint64 constant FORK_NUMBER = type(uint64).max;
    address constant CURRENT_FACTORY = 0x315752fEE5cBcAA00333E0d4d91E0cD69429E908;
    address constant CURRENT_DEPLOYER = 0xcECc29B037f5064fCdF45a5C318F132ef76aA551;
    address constant OWNER = 0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9;
    address constant FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    function setUp() public override {
        vm.createSelectFork("https://ethereum-sepolia-rpc.publicnode.com", 11918468);
        require(block.chainid == 11155111 && block.number == 11918468, "recorded Sepolia fork required");
        factory = LaunchFactory(payable(CURRENT_FACTORY));
        manager = PoolManager(address(factory.poolManager()));
        launchFees = factory.fees();
        require(factory.deployer() == CURRENT_DEPLOYER, "deployer mismatch");
        require(!factory.registry().isRecorded(FORK_NUMBER), "fork number collision");
        owner = OWNER;
        payer = OWNER;
        imd = launchFees.feeRecipient();
        alice = makeAddr("fork test claimant");
        bob = makeAddr("fork test transfer recipient");
        deployer = new HookDeployerV2();
        address predictedToken = factory.predictToken(FORK_NUMBER, type(UnlkToken).creationCode);
        hookInitCode = deployer.initCode(
            type(UnlkHookV2).creationCode,
            HookDeployerV2.Config(manager, UnlkToken(predictedToken), CURRENT_FACTORY, OWNER)
        );
        _mineHookSalt();
        key = PoolKey(
            Currency.wrap(address(0)), Currency.wrap(predictedToken), 12500, 60, IHooks(predictedHook)
        );
        seedLower = LOWER;
        seedUpper = -OPENING_TICK;
        uint160 sqrt = TickMath.getSqrtPriceAtTick(seedUpper);
        seedLiquidity = _tokenOnlyLiquidity(UnlkToken(predictedToken), sqrt);
        LaunchFactory.LaunchParams memory params = _launchParams(sqrt, seedLower, seedUpper, seedLiquidity);
        params.launchNumber = FORK_NUMBER;
        params.record.launchNumber = FORK_NUMBER;
        vm.prank(CURRENT_DEPLOYER);
        (address t, address h, address d) = factory.launch(params);
        token = UnlkToken(t);
        hook = UnlkHookV2(h);
        distributor = MerkleDistributor(d);
    }

    function testRecordedForkBothStagesTradingClaimsAndFees() public {
        assertFalse(hook.activated());
        assertEq(token.initialRecipient(), OWNER);
        vm.prank(OWNER);
        token.transfer(bob, 1 ether); // ordinary transfers already work
        vm.warp(block.timestamp + CONTRIBUTOR_LOCK);
        distributor.claim(0, alice, REWARD, new bytes32[](0)); // native claim before activation
        vm.prank(OWNER);
        (address r, address e, address o) = hook.deployCompanions(
            FORK_NUMBER,
            IChainlinkEthUsd(FEED),
            [
                type(UnlkRouterV2).creationCode,
                type(MerkleClaimEvidence).creationCode,
                type(UnlkOracle).creationCode,
                type(NftFeeVault).creationCode,
                type(SetupVerifierV2).creationCode
            ]
        );
        rewards = MerkleClaimEvidence(e);
        router = UnlkRouterV2(payable(r));
        oracle = UnlkOracle(o);
        _certifyInitialRound();
        vm.prank(OWNER);
        hook.configureAndActivate(address(router), rewards, oracle, FORK_NUMBER);
        assertTrue(hook.activated());
        assertEq(hook.nftFeeVault().BENEFICIARY(), OWNER);
        _approveRouter(alice);
        uint256 bought = _buy(alice, 1 ether);
        assertEq(hook.eligible(alice), bought);
        _sell(alice, bought / 5);
        vm.expectRevert();
        _sell(alice, 1);
        _attestReward();
        assertEq(hook.syncRewards(alice), REWARD);
        hook.syncPayer();
        assertEq(hook.eligible(OWNER), token.PAYER_ALLOCATION());
        vm.prank(alice);
        router.withdrawNative();
        (uint256 f0, uint256 f1) = factory.claimFees(FORK_NUMBER);
        assertGt(f0 + f1, 0);
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
        NftFeeVault vault = hook.nftFeeVault();
        vault.redeem();
        assertGt(vault.claimable(), 0);
        vm.prank(OWNER);
        vault.withdraw();
        assertEq(vault.claimable(), 0);
        emit log_named_address("FORK ONLY token", address(token));
        emit log_named_address("FORK ONLY hook", address(hook));
        emit log_named_address("FORK ONLY distributor", address(distributor));
        emit log_named_address("FORK ONLY router", address(router));
        emit log_named_address("FORK ONLY evidence", address(rewards));
        emit log_named_address("FORK ONLY oracle", address(oracle));
        emit log_named_bytes32("FORK ONLY poolId", PoolId.unwrap(hook.poolId()));
    }
}
