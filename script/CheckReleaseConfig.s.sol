// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {UnlkHook} from "../src/UnlkHook.sol";
import {IMerkleDistributor} from "../src/interfaces/IIntegration.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {UnlkOracle} from "../src/UnlkOracle.sol";
import {UnlkToken} from "../src/UnlkToken.sol";
import {MerkleClaimEvidence} from "../src/MerkleClaimEvidence.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

/// @notice Read-only post-launch/fork gate. Supply actual addresses/expected code hashes as arguments.
/// Never broadcasts or invents chain-specific configuration. Passing this is not an IMD integration audit.
contract CheckReleaseConfig {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    function run(UnlkHook hook, uint256 expectedChain, bytes32 managerCodeHash, bytes32 feedCodeHash)
        external
        view
        returns (PoolId id, uint128 liquidity, uint256 pendingPayer)
    {
        require(block.chainid == expectedChain, "chain mismatch");
        require(managerCodeHash != 0 && feedCodeHash != 0, "verified hashes required");
        require(address(hook.poolManager()).codehash == managerCodeHash, "manager code mismatch");
        require(hook.activated(), "stage 2 not activated: pool deployed, trading inactive");
        UnlkOracle oracle = hook.oracle();
        require(address(oracle.feed()).codehash == feedCodeHash, "feed code mismatch");
        require(hook.bound() && uint160(address(hook)) & 0x3fff == hook.FLAGS(), "hook flags/binding");
        PoolKey memory key = hook.poolKey();
        id = key.toId();
        require(
            PoolId.unwrap(id) == PoolId.unwrap(hook.poolId()) && address(key.hooks) == address(hook),
            "wrong key"
        );
        (,, uint24 protocolFee, uint24 lpFee) = hook.poolManager().getSlot0(id);
        require(protocolFee == 0 && lpFee == 12500 && key.fee == 12500, "fee mismatch");
        require(
            oracle.hook() == address(hook) && oracle.bound()
                && address(oracle.poolManager()) == address(hook.poolManager())
                && PoolId.unwrap(oracle.poolId()) == PoolId.unwrap(id)
                && oracle.token() == address(hook.token()) && oracle.factory() == hook.launchFactory(),
            "oracle mismatch"
        );
        require(
            hook.router() == hook.stagedRouter() && address(hook.rewards()) == hook.stagedRewards()
                && address(oracle) == hook.stagedOracle() && hook.launchNumber() == hook.stagedLaunchNumber(),
            "staged bundle mismatch"
        );
        liquidity = _checkLiquidity(hook, id);
        UnlkToken token = hook.token();
        require(token.totalSupply() == 1_000_000_000 ether, "supply mismatch");
        require(
            Currency.unwrap(key.currency0) == address(0) && Currency.unwrap(key.currency1) == address(token)
                && key.tickSpacing == 60 && token.distributionComplete()
                && token.initialMinter() == hook.launchFactory() && token.initialRecipient() == hook.payer(),
            "token/pool mismatch"
        );
        address swarm = hook.rewards().distributor();
        require(
            swarm == hook.swarm() && hook.rewards().token() == address(token)
                && IMerkleDistributor(swarm).token() == address(token)
                && IMerkleDistributor(swarm).opener() == hook.launchFactory(),
            "claim source mismatch"
        );
        require(MerkleClaimEvidence(address(hook.rewards())).certified(0), "uncertified reward tree");
        (, pendingPayer) = hook.pendingPayerCredit();
    }

    /// @dev The factory keeps the seeded position; its range is the oracle's recorded liquidity range.
    function _checkLiquidity(UnlkHook hook, PoolId id) private view returns (uint128 liquidity) {
        UnlkSwapRouter router = UnlkSwapRouter(payable(hook.router()));
        require(
            address(router.hook()) == address(hook)
                && address(router.poolManager()) == address(hook.poolManager()),
            "route mismatch"
        );
        (int24 lower, int24 upper) = hook.oracle().liquidityRangeTicks();
        (liquidity,,) = hook.poolManager().getPositionInfo(id, hook.launchFactory(), lower, upper, 0);
        require(liquidity != 0, "principal not seeded");
    }
}
