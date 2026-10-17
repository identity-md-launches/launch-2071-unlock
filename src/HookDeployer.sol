// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {UnlkToken} from "./UnlkToken.sol";

/// @notice Off-chain/test helper that encodes the stage-1 hook init code exactly as IMD's manifest does.
/// @dev Not part of the launch. The real hook is deployed by `LaunchFactory.launch` with the four flat words
/// `$poolManager`, `$token`, `$factory`, `$owner`; no companion address is a constructor argument.
contract HookDeployer {
    struct Config {
        IPoolManager manager;
        UnlkToken token;
        address launchFactory;
        address setupAuthority;
    }

    /// @dev The caller supplies the reviewed hook creation body; this helper only encodes, never deploys.
    function initCode(bytes memory hookCreationCode, Config calldata config)
        public
        pure
        returns (bytes memory)
    {
        return bytes.concat(
            hookCreationCode,
            abi.encode(config.manager, config.token, config.launchFactory, config.setupAuthority)
        );
    }

    function initCodeHash(bytes memory hookCreationCode, Config calldata config)
        external
        pure
        returns (bytes32)
    {
        return keccak256(initCode(hookCreationCode, config));
    }
}
