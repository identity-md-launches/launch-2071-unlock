// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";

/// @notice Project-defined credit boundary. `MerkleClaimEvidence` implements it on top of the verified IMD
/// `MerkleDistributor`; it is not itself an IMD ABI.
interface IClaimEvidence {
    function distributor() external view returns (address);
    function token() external view returns (address);
    /// @dev Must return cumulative tokens actually delivered to this exact wallet by native claims.
    /// Unclaimed allocations, logs, caller-selected amounts and transferable receipts are NOT evidence.
    function claimed(address recipient) external view returns (uint256);
}

/// @notice Subset of the verified IMD `MerkleDistributor` ABI (Sourcify full match of the contract the mainnet
/// `LaunchFactory` 0x12c63b581d07093f6126bc02263c58f7eadaa96f creates; see test/imd/README.md).
interface IMerkleDistributor {
    struct Round {
        bytes32 root;
        uint256 funded;
        uint256 claimed;
        uint64 unlocksAt;
    }

    function token() external view returns (address);
    function opener() external view returns (address);
    function claimed(uint256 round, address account) external view returns (bool);
    function swept(uint256 round) external view returns (bool);
    function roundCount() external view returns (uint256);
    function roundOf(uint256 round) external view returns (Round memory);
}

interface IRouteContext {
    function context() external view returns (address trader, bytes32 operation);
}

interface IUnlkHookView {
    function poolKey() external view returns (PoolKey memory);
    function bound() external view returns (bool);
    function activated() external view returns (bool);
    function token() external view returns (address);
    function poolManager() external view returns (IPoolManager);
    function router() external view returns (address);
    function launchFactory() external view returns (address);
    function seedTickLower() external view returns (int24);
    function seedTickUpper() external view returns (int24);
}

interface IUnlkRouterView {
    function hook() external view returns (address);
    function poolManager() external view returns (IPoolManager);
}

/// @notice Subset of the verified IMD `LaunchRegistry` ABI.
interface ILaunchRegistryView {
    function writer() external view returns (address);

    struct Artifact {
        bytes32 role;
        bytes32 name;
        address addr;
    }

    function artifactsOf(uint64 launchNumber) external view returns (Artifact[] memory);
    function isRecorded(uint64 launchNumber) external view returns (bool);
}

/// @notice Subset of the verified IMD `LaunchFactory` (+ `PoolFees`) ABI.
interface ILaunchFactoryView {
    function fees() external view returns (address);
    function deployer() external view returns (address);
    function registry() external view returns (ILaunchRegistryView);
    function poolManager() external view returns (IPoolManager);
    function positionOf(uint64 launchNumber)
        external
        view
        returns (PoolKey memory key, int24 tickLower, int24 tickUpper, address requester);
}

interface IChainlinkEthUsd {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
