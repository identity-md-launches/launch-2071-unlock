// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Script} from "forge-std/Script.sol";
import {UnlkHookV3} from "../../src/successor/UnlkHookV3.sol";
import {NftFeeVault} from "../../src/candidate/NftFeeVault.sol";
import {SetupVerifierV2} from "../../src/candidate/SetupVerifierV2.sol";
import {UnlkOracle} from "../../src/UnlkOracle.sol";
import {MerkleClaimEvidence} from "../../src/MerkleClaimEvidence.sol";
import {IChainlinkEthUsd, IClaimEvidence} from "../../src/interfaces/IIntegration.sol";

/// @notice Calldata preparation only. No broadcast, key access, environment read or deployment occurs here.
/// Release is BLOCKED pending independent review. Inputs come from the actual new stage-1 factory receipt.
contract PrepareSuccessor is Script {
    struct Config {
        UnlkHookV3 hook;
        uint64 number;
        IChainlinkEthUsd feed;
        address distributor;
    }

    struct Plan {
        address setupAuthority;
        address hook;
        bytes deployCompanions;
        address evidence;
        address oracle;
        address vault;
        bytes certifyRound;
        bytes activate;
    }

    function run(Config calldata config, address[] calldata recipients, uint256[] calldata amounts)
        external
        view
        returns (Plan memory plan)
    {
        UnlkHookV3 hook = config.hook;
        require(hook.bound() && hook.seedRecorded() && !hook.activated(), "stage 1 not ready");
        require(
            config.distributor != address(0) && address(config.feed) != address(0),
            "actual deployment inputs required"
        );
        bytes[4] memory codes = [
            type(MerkleClaimEvidence).creationCode,
            type(UnlkOracle).creationCode,
            type(NftFeeVault).creationCode,
            type(SetupVerifierV2).creationCode
        ];
        plan.setupAuthority = hook.setupAuthority();
        plan.hook = address(hook);
        plan.deployCompanions =
            abi.encodeCall(UnlkHookV3.deployCompanions, (config.number, config.feed, codes));
        uint64 staging = hook.stagings() + 1;
        plan.evidence = _predict(
            address(hook),
            staging,
            "evidence",
            bytes.concat(codes[0], abi.encode(config.distributor, hook.token()))
        );
        plan.oracle = _predict(
            address(hook),
            staging,
            "oracle",
            bytes.concat(codes[1], abi.encode(hook.poolManager(), config.feed, address(hook)))
        );
        plan.vault = _predict(
            address(hook),
            staging,
            "vault",
            bytes.concat(codes[2], abi.encode(hook.poolManager(), address(hook)))
        );
        plan.activate = abi.encodeCall(
            UnlkHookV3.configureAndActivate,
            (IClaimEvidence(plan.evidence), UnlkOracle(plan.oracle), config.number)
        );
        plan.certifyRound = abi.encodeCall(MerkleClaimEvidence.certifyRound, (0, recipients, amounts));
    }

    function _predict(address hook, uint64 staging, bytes32 label, bytes memory code)
        private
        pure
        returns (address)
    {
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff), hook, keccak256(abi.encode(label, staging)), keccak256(code)
                        )
                    )
                )
            )
        );
    }
}
