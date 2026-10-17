// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Script} from "forge-std/Script.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {ImdFeeVault} from "../../src/mainnet/ImdFeeVault.sol";
import {ImdSetupVerifier} from "../../src/mainnet/ImdSetupVerifier.sol";
import {UnlkImdOracle} from "../../src/mainnet/UnlkImdOracle.sol";
import {MerkleClaimEvidence} from "../../src/MerkleClaimEvidence.sol";
import {IClaimEvidence} from "../../src/interfaces/IIntegration.sol";
import {IImdUsdSource} from "../../src/mainnet/UnlkImdOracle.sol";
import {ImdSpotUsdSource} from "../../src/mainnet/ImdSpotUsdSource.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Calldata preparation only. No broadcast, key access, environment read or deployment occurs here.
/// Release is BLOCKED pending independent review. Inputs come from the actual new stage-1 factory receipt.
contract PrepareImd is Script {
    /// @notice Calldata only. Missing venue evidence blocks use; never supplies a stand-in venue.
    function preparePriceSource() external pure returns (bytes memory) {
        return abi.encodeCall(UnlkImdHook.deployPriceSource, (type(ImdSpotUsdSource).creationCode, bytes("")));
    }

    struct Config {
        UnlkImdHook hook;
        uint64 number;
        IImdUsdSource feed;
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
        UnlkImdHook hook = config.hook;
        require(hook.bound() && hook.seedRecorded() && !hook.activated(), "stage 1 not ready");
        require(
            config.distributor != address(0) && address(config.feed) != address(0),
            "actual deployment inputs required"
        );
        require(hook.stagedPriceSource() == address(config.feed), "stage price source first");
        require(config.feed.priceUsd() > 0, "verified price source not ready");
        bytes[4] memory codes = [
            type(MerkleClaimEvidence).creationCode,
            type(UnlkImdOracle).creationCode,
            type(ImdFeeVault).creationCode,
            type(ImdSetupVerifier).creationCode
        ];
        plan.setupAuthority = hook.setupAuthority();
        plan.hook = address(hook);
        plan.deployCompanions =
            abi.encodeCall(UnlkImdHook.deployCompanions, (config.number, config.feed, codes));
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
            bytes.concat(codes[2], abi.encode(hook.poolManager(), address(hook), IERC20(hook.quoteToken())))
        );
        plan.activate = abi.encodeCall(
            UnlkImdHook.configureAndActivate,
            (IClaimEvidence(plan.evidence), UnlkImdOracle(plan.oracle), config.number)
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
