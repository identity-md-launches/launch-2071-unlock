// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {SystemFixture} from "../../test/fixtures/SystemFixture.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {LaunchFactory} from "../../test/imd/LaunchFactory.sol";
import {LaunchFees} from "../../test/imd/LaunchFees.sol";
import {MerkleDistributor} from "../../test/imd/MerkleDistributor.sol";
import {UnlkToken} from "../../src/UnlkToken.sol";
import {UnlkHook} from "../../src/UnlkHook.sol";
import {UnlkSwapRouter} from "../../src/UnlkSwapRouter.sol";
import {UnlkOracle} from "../../src/UnlkOracle.sol";
import {MerkleClaimEvidence} from "../../src/MerkleClaimEvidence.sol";
import {HookDeployer} from "../../src/HookDeployer.sol";
import {SepoliaRelease} from "../../src/libraries/SepoliaRelease.sol";
import {CheckReleaseConfig} from "../../script/CheckReleaseConfig.s.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IChainlinkEthUsd, IMerkleDistributor, IUnlkHookView} from "../../src/interfaces/IIntegration.sol";

/// @notice Additional delivery harness at block 11905741; original published files are unchanged.
/// Current payer and factory signer verified in delivery/network/preflight.json and current-job.json.
/// @notice Fork-only simulation. No broadcast, fake service, mocked price, or seeded ETH.
/// The claim leaf and launch number are deliberately local rehearsal inputs, never release records.
contract RecordedSepoliaRehearsal is SystemFixture {
    uint64 constant FORK_NUMBER = type(uint64).max;
    uint256 constant FORK_REWARD = 100_000_000 ether;
    address constant CURRENT_FACTORY = 0x315752fEE5cBcAA00333E0d4d91E0cD69429E908;
    address constant CURRENT_DEPLOYER = 0xcECc29B037f5064fCdF45a5C318F132ef76aA551;
    address constant OWNER = 0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9;
    address constant FEED = 0x694AA1769357215DE4FAC081bf1f309aDC325306;

    function setUp() public override {
        require(block.chainid == 11155111 && block.number == 11905741, "recorded Sepolia fork required");
        factory = LaunchFactory(payable(CURRENT_FACTORY));
        manager = PoolManager(address(factory.poolManager()));
        launchFees = factory.fees();
        assertEq(CURRENT_FACTORY.codehash, SepoliaRelease.FACTORY);
        assertEq(address(factory.registry()).codehash, SepoliaRelease.REGISTRY);
        assertEq(address(manager).codehash, SepoliaRelease.MANAGER);
        assertEq(address(launchFees).codehash, SepoliaRelease.FEES);
        assertEq(FEED.codehash, SepoliaRelease.FEED);
        require(factory.deployer() == CURRENT_DEPLOYER, "deployer mismatch");
        require(!factory.registry().isRecorded(FORK_NUMBER), "fork number collision");
        owner = OWNER;
        payer = OWNER;
        imd = launchFees.feeRecipient();
        alice = makeAddr("fork test claimant");
        bob = makeAddr("fork test transfer recipient");
        deployer = new HookDeployer();
        address predictedToken = factory.predictToken(FORK_NUMBER, type(UnlkToken).creationCode);
        hookInitCode = deployer.initCode(
            type(UnlkHook).creationCode,
            HookDeployer.Config(manager, UnlkToken(predictedToken), CURRENT_FACTORY, OWNER)
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
        hook = UnlkHook(h);
        distributor = MerkleDistributor(d);
    }

    function _rewardRoot() internal view override returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(alice, FORK_REWARD))));
    }

    function _certifyInitialRound() internal override {
        _certifySingle(rewards, 0, alice, FORK_REWARD);
    }

    function testRecordedForkBothStagesTradingClaimsAndFees() public {
        assertFalse(hook.activated());
        assertEq(token.initialRecipient(), OWNER);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(address(distributor)), FORK_REWARD);
        assertEq(token.balanceOf(address(factory)), 0);
        assertEq(distributor.roundOf(0).funded, FORK_REWARD);
        assertEq(distributor.roundOf(0).root, _rewardRoot());
        assertEq(
            token.initialAllocation(address(manager)) + token.initialAllocation(OWNER) + FORK_REWARD,
            token.totalSupply()
        );
        assertGe(hook.seedQuoteCapacity(), 17 ether);
        vm.expectRevert(UnlkHook.NotActivated.selector);
        hook.syncPayer();
        vm.expectRevert(UnlkHook.NotActivated.selector);
        hook.syncRewards(alice);
        vm.expectRevert(UnlkHook.NotActivated.selector);
        hook.updateMilestone();
        vm.prank(OWNER);
        token.transfer(bob, 1 ether); // ordinary transfers already work
        vm.expectRevert();
        distributor.claim(0, alice, FORK_REWARD, new bytes32[](0));
        // Local time travel only: public claimants must wait for this actual on-chain timestamp.
        vm.warp(distributor.roundOf(0).unlocksAt);
        distributor.claim(0, alice, FORK_REWARD, new bytes32[](0)); // native claim before activation
        vm.prank(OWNER);
        (address r, address e, address o) = hook.deployCompanions(
            FORK_NUMBER,
            IChainlinkEthUsd(FEED),
            type(UnlkSwapRouter).creationCode,
            type(MerkleClaimEvidence).creationCode,
            type(UnlkOracle).creationCode
        );
        rewards = MerkleClaimEvidence(e);
        router = UnlkSwapRouter(payable(r));
        oracle = UnlkOracle(o);
        vm.prank(OWNER);
        vm.expectRevert(UnlkHook.InvalidEvidence.selector);
        hook.configureAndActivate(address(router), rewards, oracle, FORK_NUMBER);
        assertFalse(hook.activated());
        assertEq(hook.router(), address(0));
        assertFalse(oracle.bound());
        _certifyInitialRound();
        vm.prank(OWNER);
        hook.configureAndActivate(address(router), rewards, oracle, FORK_NUMBER);
        assertTrue(hook.activated());
        new CheckReleaseConfig().run(hook, 11155111, SepoliaRelease.MANAGER, SepoliaRelease.FEED);
        vm.prank(OWNER);
        vm.expectRevert(UnlkHook.AlreadyActivated.selector);
        hook.configureAndActivate(address(router), rewards, oracle, FORK_NUMBER);
        vm.prank(OWNER);
        vm.expectRevert(UnlkHook.AlreadyActivated.selector);
        hook.deployCompanions(
            FORK_NUMBER,
            IChainlinkEthUsd(FEED),
            type(UnlkSwapRouter).creationCode,
            type(MerkleClaimEvidence).creationCode,
            type(UnlkOracle).creationCode
        );
        _approveRouter(bob);
        vm.expectRevert();
        _sell(bob, 1 ether);
        assertEq(token.balanceOf(bob), 1 ether);
        assertEq(hook.eligible(bob), 0);
        assertEq(hook.sold(bob), 0);
        _approveRouter(alice);
        uint256 bought = _buy(alice, 1 ether);
        assertEq(hook.eligible(alice), bought);
        _sell(alice, bought / 4);
        vm.expectRevert();
        _sell(alice, 1);
        rewards.attest(0, alice, FORK_REWARD, new bytes32[](0));
        assertEq(hook.syncRewards(alice), FORK_REWARD);
        assertEq(hook.syncRewards(alice), 0);
        vm.expectRevert(MerkleClaimEvidence.AlreadyAttested.selector);
        rewards.attest(0, alice, FORK_REWARD, new bytes32[](0));
        _sell(alice, FORK_REWARD / 4);
        assertEq(hook.remainingQuota(alice), 0);
        vm.expectRevert();
        _sell(alice, 1);
        hook.syncPayer();
        assertEq(hook.eligible(OWNER), token.PAYER_ALLOCATION());
        assertEq(hook.syncPayer(), 0);
        vm.prank(alice);
        router.withdrawNative();
        uint256 payerEthBefore = OWNER.balance;
        uint256 imdEthBefore = imd.balance;
        uint256 payerTokensBefore = token.balanceOf(OWNER);
        uint256 imdTokensBefore = token.balanceOf(imd);
        (uint256 f0, uint256 f1) = factory.claimFees(FORK_NUMBER);
        assertGt(f0 + f1, 0);
        assertEq(OWNER.balance - payerEthBefore, f0 * 8000 / 10000);
        assertEq(imd.balance - imdEthBefore, f0 - f0 * 8000 / 10000);
        assertEq(token.balanceOf(OWNER) - payerTokensBefore, f1 * 8000 / 10000);
        assertEq(token.balanceOf(imd) - imdTokensBefore, f1 - f1 * 8000 / 10000);
        assertEq(_factoryLiquidity(seedLower, seedUpper), seedLiquidity);
        vm.prank(address(manager));
        vm.expectRevert(UnlkHook.PrincipalLocked.selector);
        hook.beforeRemoveLiquidity(
            CURRENT_FACTORY, key, ModifyLiquidityParams(seedLower, seedUpper, -1, bytes32(0)), ""
        );
        emit log_named_uint("FORK ONLY opening sqrtPriceX96", TickMath.getSqrtPriceAtTick(seedUpper));
        emit log_named_uint("FORK ONLY seed tokens", hook.seedTokens());
        emit log_named_uint("FORK ONLY seed quote capacity", hook.seedQuoteCapacity());
        emit log_named_address("FORK ONLY token", address(token));
        emit log_named_address("FORK ONLY hook", address(hook));
        emit log_named_address("FORK ONLY distributor", address(distributor));
        emit log_named_address("FORK ONLY router", address(router));
        emit log_named_address("FORK ONLY evidence", address(rewards));
        emit log_named_address("FORK ONLY oracle", address(oracle));
        emit log_named_bytes32("FORK ONLY poolId", PoolId.unwrap(hook.poolId()));
    }
}
