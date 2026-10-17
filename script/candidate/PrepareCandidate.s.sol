// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Script} from "forge-std/Script.sol";
import {UnlkHookV2} from "../../src/candidate/UnlkHookV2.sol";
import {UnlkRouterV2} from "../../src/candidate/UnlkRouterV2.sol";
import {NftFeeVault} from "../../src/candidate/NftFeeVault.sol";
import {SetupVerifierV2} from "../../src/candidate/SetupVerifierV2.sol";
import {UnlkOracle} from "../../src/UnlkOracle.sol";
import {MerkleClaimEvidence} from "../../src/MerkleClaimEvidence.sol";
import {IChainlinkEthUsd, IClaimEvidence} from "../../src/interfaces/IIntegration.sol";

/// @notice Calldata preparation only. No broadcast, key access or deployment occurs in this script.
/// Release is BLOCKED pending attribution design and independent review. Inputs come from the actual new
/// stage-1 factory receipt; this script never substitutes addresses or changes sealed historical contracts.
contract PrepareCandidate is Script {
    struct Config {
        UnlkHookV2 hook;
        uint64 number;
        IChainlinkEthUsd feed;
        address distributor;
    }

    struct Plan {
        address setupAuthority;
        address hook;
        bytes deployCompanions;
        address evidence;
        bytes certifyRound;
        bytes activate;
    }

    function run(Config calldata config, address[] calldata recipients, uint256[] calldata amounts)
        external
        view
        returns (Plan memory plan)
    {
        UnlkHookV2 hook = config.hook;
        require(hook.bound() && hook.seedRecorded() && !hook.activated(), "stage 1 not ready");
        require(
            config.distributor != address(0) && address(config.feed) != address(0),
            "actual deployment inputs required"
        );
        bytes[5] memory codes = [
            type(UnlkRouterV2).creationCode,
            type(MerkleClaimEvidence).creationCode,
            type(UnlkOracle).creationCode,
            type(NftFeeVault).creationCode,
            type(SetupVerifierV2).creationCode
        ];
        plan.setupAuthority = hook.setupAuthority();
        plan.hook = address(hook);
        plan.deployCompanions =
            abi.encodeCall(UnlkHookV2.deployCompanions, (config.number, config.feed, codes));
        (plan.evidence, plan.activate) = _activation(config, codes);
        plan.certifyRound = abi.encodeCall(MerkleClaimEvidence.certifyRound, (0, recipients, amounts));
    }

    function _activation(Config calldata config, bytes[5] memory codes)
        private
        view
        returns (address evidence, bytes memory activate)
    {
        UnlkHookV2 hook = config.hook;
        uint64 staging = hook.stagings() + 1;
        address r = _predict(
            address(hook),
            staging,
            "router",
            bytes.concat(codes[0], abi.encode(hook.poolManager(), address(hook)))
        );
        evidence = _predict(
            address(hook),
            staging,
            "evidence",
            bytes.concat(codes[1], abi.encode(config.distributor, hook.token()))
        );
        address o = _predict(
            address(hook),
            staging,
            "oracle",
            bytes.concat(codes[2], abi.encode(hook.poolManager(), config.feed, address(hook)))
        );
        activate = abi.encodeCall(
            UnlkHookV2.configureAndActivate, (r, IClaimEvidence(evidence), UnlkOracle(o), config.number)
        );
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
