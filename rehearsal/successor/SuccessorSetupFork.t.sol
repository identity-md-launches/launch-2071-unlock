// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {NftFeeVault} from "src/candidate/NftFeeVault.sol";
import {SuccessorFixture} from "test/successor/SuccessorFixture.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {LaunchFactory} from "test/imd/LaunchFactory.sol";
import {MerkleDistributor} from "test/imd/MerkleDistributor.sol";
import {UnlkToken} from "src/UnlkToken.sol";
import {UnlkHookV3} from "src/successor/UnlkHookV3.sol";
import {UnlkOracle} from "src/UnlkOracle.sol";
import {MerkleClaimEvidence} from "src/MerkleClaimEvidence.sol";
import {HookDeployerV2} from "src/candidate/HookDeployerV2.sol";
import {IChainlinkEthUsd} from "src/interfaces/IIntegration.sol";

/// @notice Fork-only simulation on public Sepolia at block 11920551 under the REAL chain id: the actual IMD
/// LaunchFactory (prank of its authorized deployer), registry, fees, PoolManager, Chainlink feed, Universal
/// Router, Quoter and Permit2, with the hook's Sepolia service pins active. No broadcast, no mocked price.
/// The launch number and claim leaf are local rehearsal inputs, never release records.
contract SuccessorSepoliaSetupRehearsal is SuccessorFixture {
    uint64 constant FORK_NUMBER = type(uint64).max;
    address constant CURRENT_FACTORY = 0x315752fEE5cBcAA00333E0d4d91E0cD69429E908;
    address constant CURRENT_DEPLOYER = 0xcECc29B037f5064fCdF45a5C318F132ef76aA551;
    address constant REHEARSAL_OWNER = 0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9;
    address constant FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    function setUp() public override {
        vm.createSelectFork("https://ethereum-sepolia-rpc.publicnode.com", 11920551);
        require(block.chainid == 11155111, "Sepolia fork required");
        factory = LaunchFactory(payable(CURRENT_FACTORY));
        manager = PoolManager(payable(address(factory.poolManager())));
        require(address(manager) == MANAGER, "manager mismatch");
        launchFees = factory.fees();
        require(factory.deployer() == CURRENT_DEPLOYER, "deployer mismatch");
        require(!factory.registry().isRecorded(FORK_NUMBER), "fork number collision");
        owner = REHEARSAL_OWNER;
        payer = REHEARSAL_OWNER;
        imd = launchFees.feeRecipient();
        alice = makeAddr("fork test claimant");
        bob = makeAddr("fork test transfer recipient");
        deployer = new HookDeployerV2();
        address predictedToken = factory.predictToken(FORK_NUMBER, type(UnlkToken).creationCode);
        hookInitCode = deployer.initCode(
            type(UnlkHookV3).creationCode,
            HookDeployerV2.Config(manager, UnlkToken(predictedToken), CURRENT_FACTORY, REHEARSAL_OWNER)
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
        hook = UnlkHookV3(h);
        distributor = MerkleDistributor(d);
    }

    function testRealFactoryBothStagesStandardRouterClaimsAndFees() public {
        assertFalse(hook.activated());
        vm.prank(REHEARSAL_OWNER);
        token.transfer(bob, 1 ether);
        vm.warp(block.timestamp + CONTRIBUTOR_LOCK);
        distributor.claim(0, alice, REWARD, new bytes32[](0));
        vm.prank(REHEARSAL_OWNER);
        (address e, address o, address v) =
            hook.deployCompanions(FORK_NUMBER, IChainlinkEthUsd(FEED), _codes());
        rewards = MerkleClaimEvidence(e);
        oracle = UnlkOracle(o);
        vault = NftFeeVault(payable(v));
        _certifyInitialRound();
        vm.prank(REHEARSAL_OWNER);
        hook.configureAndActivate(rewards, oracle, FORK_NUMBER);
        assertTrue(hook.activated());
        _approveRouter(alice);
        uint256 bought = _buy(alice, 1 ether);
        assertEq(hook.eligible(alice), bought);
        uint256 net = _sell(alice, bought / 5);
        assertGt(net, 0);
        vm.prank(alice);
        vm.expectRevert();
        router.execute(hex"10", _explorerPlan(false, 1 ether, 1), block.timestamp + 60);
        _attestReward();
        assertEq(hook.syncRewards(alice), REWARD);
        hook.syncPayer();
        assertEq(hook.eligible(REHEARSAL_OWNER), token.PAYER_ALLOCATION());
        (uint256 f0, uint256 f1) = factory.claimFees(FORK_NUMBER);
        assertGt(f0 + f1, 0, "1.25% LP fee still flows to the factory position");
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
        uint256 accrued = vault.totalAccrued();
        assertGt(accrued, 0);
        vault.redeem();
        assertEq(vault.claimable(), accrued);
        vm.prank(REHEARSAL_OWNER);
        vault.withdraw();
        assertEq(vault.claimable(), 0);
    }
}
