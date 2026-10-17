// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {UnlkHook} from "../src/UnlkHook.sol";
import {UnlkOracle} from "../src/UnlkOracle.sol";
import {UnlkSwapRouter} from "../src/UnlkSwapRouter.sol";
import {MerkleClaimEvidence} from "../src/MerkleClaimEvidence.sol";
import {
    IChainlinkEthUsd,
    IMerkleDistributor,
    IUnlkHookView,
    ILaunchFactoryView,
    ILaunchRegistryView
} from "../src/interfaces/IIntegration.sol";

/// @notice STAGE 2 for UNLOCK. NOT EXECUTED in this delivery: no Sepolia stage-1 launch exists yet.
/// @dev `deployCompanions` reads every identity from the ACTUAL stage-1 hook and the factory's registry record,
/// so nothing is typed in by hand except the hook address, the launch number and the published feed. The final
/// `configureAndActivate` must be sent by the hook's immutable `setupAuthority` (the launch owner) from its own
/// wallet; `run()` uses the immutable setup authority as its broadcast sender. Use its wallet or keystore.
contract Stage2 is Script {
    struct Config {
        UnlkHook hook;
        uint64 launchNumber;
        IChainlinkEthUsd feed;
    }

    struct Companions {
        UnlkSwapRouter router;
        MerkleClaimEvidence rewards;
        UnlkOracle oracle;
    }

    error Stage1NotReady();

    /// @notice Owner-wallet execution with explicit, reviewable inputs. No environment lookup.
    /// accounts/amounts must contain the complete frozen round-0 tree in heap leaf order.
    function run(UnlkHook hook, uint64 number, address[] calldata accounts, uint256[] calldata amounts)
        external
    {
        require(block.chainid == 11155111, "Sepolia only");
        Config memory config = Config(hook, number, IChainlinkEthUsd(hook.SEPOLIA_ETH_USD()));
        vm.startBroadcast(hook.setupAuthority());
        config.hook
            .deployCompanions(
                config.launchNumber,
                config.feed,
                type(UnlkSwapRouter).creationCode,
                type(MerkleClaimEvidence).creationCode,
                type(UnlkOracle).creationCode
            );
        Companions memory companions = readCompanions(config);
        companions.rewards.certifyRound(0, accounts, amounts);
        activate(config, companions);
        vm.stopBroadcast();
    }

    function distributorOf(Config memory config) public view returns (address distributor) {
        ILaunchRegistryView registry = ILaunchFactoryView(config.hook.launchFactory()).registry();
        ILaunchRegistryView.Artifact[] memory artifacts = registry.artifactsOf(config.launchNumber);
        for (uint256 i; i < artifacts.length; ++i) {
            if (artifacts[i].role == "distributor") distributor = artifacts[i].addr;
        }
    }

    /// @notice Exact owner transaction data. It deploys all three companions atomically through the hook.
    function deploymentCall(Config memory config) public view returns (bytes memory) {
        if (!config.hook.bound() || config.hook.activated()) revert Stage1NotReady();
        if (distributorOf(config) == address(0)) revert Stage1NotReady();
        return abi.encodeCall(
            UnlkHook.deployCompanions,
            (
                config.launchNumber,
                config.feed,
                type(UnlkSwapRouter).creationCode,
                type(MerkleClaimEvidence).creationCode,
                type(UnlkOracle).creationCode
            )
        );
    }

    function readCompanions(Config memory config) public view returns (Companions memory companions) {
        if (config.hook.stagedRouter() == address(0)) revert Stage1NotReady();
        companions.router = UnlkSwapRouter(payable(config.hook.stagedRouter()));
        companions.rewards = MerkleClaimEvidence(config.hook.stagedRewards());
        companions.oracle = UnlkOracle(config.hook.stagedOracle());
    }

    /// @dev Must be called by `hook.setupAuthority()`; the hook refuses anyone else.
    function activate(Config memory config, Companions memory companions) public {
        config.hook
            .configureAndActivate(
                address(companions.router), companions.rewards, companions.oracle, config.launchNumber
            );
    }
}
