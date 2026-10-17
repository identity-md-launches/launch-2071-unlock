// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {UnlkToken} from "../UnlkToken.sol";
import {ILaunchFactoryView, ILaunchRegistryView, IMerkleDistributor} from "../interfaces/IIntegration.sol";
import {SeedDepth} from "../libraries/SeedDepth.sol";
import {ReviewedCodeV2} from "./ReviewedCodeV2.sol";

interface ICandidateSetup {
    function token() external view returns (UnlkToken);
    function launchFactory() external view returns (address);
    function poolManager() external view returns (IPoolManager);
    function poolId() external view returns (PoolId);
    function seedTickLower() external view returns (int24);
    function seedTickUpper() external view returns (int24);
}

/// @notice Stateless setup checks extracted unchanged in meaning from the accepted hook.
/// No owner, delegatecall, configuration, storage, fund custody or production trade path.
contract SetupVerifierV2 {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;
    uint256 private constant MIN_POOL_ALLOCATION = 861_300_000 ether;
    error InvalidEvidence();
    error InvalidPool();

    function verify(address hookAddress, uint64 number) external view returns (address distributor) {
        ICandidateSetup hook = ICandidateSetup(hookAddress);
        address factoryAddress = hook.launchFactory();
        ILaunchFactoryView factory = ILaunchFactoryView(factoryAddress);
        UnlkToken token = hook.token();
        IPoolManager manager = hook.poolManager();
        address predictedToken = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff), factoryAddress, bytes32(uint256(number)), ReviewedCodeV2.TOKEN
                        )
                    )
                )
            )
        );
        if (predictedToken != address(token) || address(factory.poolManager()) != address(manager)) {
            revert InvalidEvidence();
        }
        ILaunchRegistryView registry = factory.registry();
        if (!registry.isRecorded(number) || registry.writer() != factoryAddress) revert InvalidEvidence();
        distributor = _record(registry.artifactsOf(number), hookAddress, address(token));
        _allocations(hookAddress, token, factoryAddress, address(manager), distributor);
        _position(hook, factory, number, token);
    }

    function _record(ILaunchRegistryView.Artifact[] memory artifacts, address hook, address token)
        private
        pure
        returns (address distributor)
    {
        bool tokenSeen;
        bool hookSeen;
        for (uint256 i; i < artifacts.length; ++i) {
            bytes32 role = artifacts[i].role;
            address at = artifacts[i].addr;
            if (role == "token") {
                if (at != token || tokenSeen) revert InvalidEvidence();
                tokenSeen = true;
            } else if (role == "hook") {
                if (at != hook || hookSeen) revert InvalidEvidence();
                hookSeen = true;
            } else if (role == "distributor") {
                if (distributor != address(0) || at == address(0)) revert InvalidEvidence();
                distributor = at;
            }
        }
        if (!tokenSeen || !hookSeen || distributor == address(0)) revert InvalidEvidence();
    }

    function _allocations(
        address hook,
        UnlkToken token,
        address factory,
        address manager,
        address distributor
    ) private view {
        address requester = token.initialRecipient();
        uint256 poolReceived = token.initialAllocation(manager);
        uint256 requesterReceived = token.initialAllocation(requester);
        if (
            !token.distributionComplete() || token.initialMinter() != factory || requester == address(0)
                || requester == manager || requester == distributor || requester == factory
                || requester == hook || token.initialAllocation(distributor) != token.SWARM_ALLOCATION()
                || poolReceived > token.POOL_ALLOCATION() || poolReceived < MIN_POOL_ALLOCATION
                || requesterReceived < token.PAYER_ALLOCATION()
                || token.SWARM_ALLOCATION() + poolReceived + requesterReceived != token.SUPPLY()
                || IMerkleDistributor(distributor).token() != address(token)
                || IMerkleDistributor(distributor).opener() != factory
        ) revert InvalidEvidence();
    }

    function _position(ICandidateSetup hook, ILaunchFactoryView factory, uint64 number, UnlkToken token)
        private
        view
    {
        (PoolKey memory recorded, int24 lower, int24 upper, address requester) = factory.positionOf(number);
        PoolId id = hook.poolId();
        if (
            PoolId.unwrap(recorded.toId()) != PoolId.unwrap(id) || lower != hook.seedTickLower()
                || upper != hook.seedTickUpper() || requester == address(factory)
                || requester == address(hook)
        ) revert InvalidEvidence();
        IPoolManager manager = hook.poolManager();
        (uint128 liquidity,,) = manager.getPositionInfo(id, address(factory), lower, upper, bytes32(0));
        (uint256 principal, uint256 depth) = SeedDepth.quoteCapacity(
            TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), liquidity
        );
        if (
            liquidity < 1e18 || depth < SeedDepth.MIN_SEED_QUOTE_CAPACITY || principal < MIN_POOL_ALLOCATION
                || principal > token.initialAllocation(address(manager))
        ) revert InvalidPool();
    }
}
