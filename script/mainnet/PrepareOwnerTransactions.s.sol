// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PrepareImd} from "./PrepareImd.s.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {ImdSetupVerifier} from "../../src/mainnet/ImdSetupVerifier.sol";
import {ImdSpotUsdSource} from "../../src/mainnet/ImdSpotUsdSource.sol";
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";
import {MerkleClaimEvidence} from "../../src/MerkleClaimEvidence.sol";
import {IMerkleDistributor, ILaunchFactoryView} from "../../src/interfaces/IIntegration.sol";
import {Arrays} from "@openzeppelin/contracts/utils/Arrays.sol";
import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";

/// @notice Local read-only wallet preparation, never a publicly deployed launch companion.
/// All identities come from actual stage1 records. Caller supplies the independently verified resolved
/// hook runtime hash and the owner/payer bound by the paid request. No keys, broadcasts or defaults.
contract PrepareOwnerTransactions is PrepareImd {
    ImdSetupVerifier private immutable verifier = new ImdSetupVerifier();
    uint256 private constant CHUNK = 256;

    struct WalletTransaction {
        uint256 chainId;
        address from;
        address to;
        uint256 value;
        bytes data;
        string effect;
    }

    struct Expected {
        address owner;
        address payer;
        bytes32 hookRuntimeHash;
    }

    /// @notice First owner transaction, available immediately after verified stage1.
    function sourceTransaction(UnlkImdHook hook, uint64 number, Expected calldata expected)
        external
        view
        returns (WalletTransaction memory)
    {
        _launch(hook, number, expected);
        return _tx(
            expected.owner,
            address(hook),
            this.preparePriceSource(),
            "Stage the pinned stateless ImdSpotUsdSource; trading remains inactive."
        );
    }

    /// @notice Remaining ordered owner transactions after source staging. Re-run against fresh actual state
    /// if a staging nonce changes. Certification arrays must use native-tree heap leaf order.
    function transactions(
        Config calldata config,
        Expected calldata expected,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external view returns (Plan memory plan, WalletTransaction[] memory calls) {
        address distributor = _launch(config.hook, config.number, expected);
        require(distributor == config.distributor, "wrong native distributor");
        require(
            address(config.feed).codehash == keccak256(type(ImdSpotUsdSource).runtimeCode),
            "wrong spot source runtime"
        );
        _tree(IMerkleDistributor(distributor), recipients, amounts);
        // Existing builder verifies the actual staged source and a valid CURRENT price, with no warm-up.
        plan = this.run(config, recipients, amounts);
        bytes[] memory certification = _certification(recipients, amounts);
        calls = new WalletTransaction[](certification.length + 2);
        calls[0] = _tx(
            expected.owner,
            plan.hook,
            plan.deployCompanions,
            "Deploy the pinned evidence, oracle, IMD fee vault and setup verifier; trading remains inactive."
        );
        for (uint256 i; i < certification.length; ++i) {
            calls[i + 1] = _tx(
                expected.owner,
                plan.evidence,
                certification[i],
                "Certify the actual complete native round0 tree; native claims remain independent."
            );
        }
        calls[calls.length - 1] = _tx(
            expected.owner,
            plan.hook,
            plan.activate,
            "Atomically validate current price and all bindings, activate trading and permanently seal setup."
        );
        // A large tree must never be presented as an executable single certifyRound call.
        if (recipients.length > 1024) plan.certifyRound = "";
    }

    function _launch(UnlkImdHook hook, uint64 number, Expected calldata expected)
        private
        view
        returns (address distributor)
    {
        require(block.chainid == 1, "Ethereum mainnet required");
        require(
            expected.hookRuntimeHash != bytes32(0) && address(hook).code.length != 0
                && address(hook).codehash == expected.hookRuntimeHash,
            "resolved hook runtime mismatch"
        );
        require(hook.bound() && hook.seedRecorded() && !hook.activated(), "stage 1 not ready");
        ILaunchFactoryView factory = ILaunchFactoryView(MainnetPins.FACTORY_ADDRESS);
        require(
            hook.launchFactory() == address(factory) && address(factory).codehash == MainnetPins.FACTORY
                && address(hook.poolManager()) == MainnetPins.MANAGER_ADDRESS
                && MainnetPins.MANAGER_ADDRESS.codehash == MainnetPins.MANAGER
                && factory.fees() == MainnetPins.FEES_ADDRESS
                && MainnetPins.FEES_ADDRESS.codehash == MainnetPins.FEES
                && address(factory.registry()) == MainnetPins.REGISTRY_ADDRESS
                && MainnetPins.REGISTRY_ADDRESS.codehash == MainnetPins.REGISTRY
                && MainnetPins.ROUTER_ADDRESS.codehash == MainnetPins.ROUTER
                && MainnetPins.QUOTER_ADDRESS.codehash == MainnetPins.QUOTER
                && MainnetPins.PERMIT2_ADDRESS.codehash == MainnetPins.PERMIT2
                && MainnetPins.IMD_ADDRESS.codehash == MainnetPins.IMD,
            "mainnet services mismatch"
        );
        require(
            expected.owner != address(0) && expected.payer != address(0)
                && hook.setupAuthority() == expected.owner
                && hook.token().initialRecipient() == expected.payer,
            "paid owner or payer mismatch"
        );
        (,,, address requester) = factory.positionOf(number);
        require(requester == expected.payer, "LP requester mismatch");
        distributor = verifier.verify(address(hook), number);
    }

    function _tree(IMerkleDistributor distributor, address[] calldata recipients, uint256[] calldata amounts)
        private
        view
    {
        uint256 n = recipients.length;
        require(n != 0 && n == amounts.length, "invalid tree length");
        bytes32[] memory tree = new bytes32[](2 * n - 1);
        address[] memory sorted = recipients;
        uint256 total;
        for (uint256 i; i < n; ++i) {
            require(recipients[i] != address(0), "zero tree recipient");
            total += amounts[i];
            tree[n - 1 + i] = keccak256(bytes.concat(keccak256(abi.encode(recipients[i], amounts[i]))));
        }
        Arrays.sort(sorted);
        for (uint256 i = 1; i < n; ++i) {
            require(sorted[i] != sorted[i - 1], "duplicate tree recipient");
        }
        for (uint256 i = n - 1; i != 0;) {
            --i;
            tree[i] = Hashes.commutativeKeccak256(tree[2 * i + 1], tree[2 * i + 2]);
        }
        IMerkleDistributor.Round memory round = distributor.roundOf(0);
        require(round.root == tree[0], "round0 tree root mismatch");
        require(round.funded == 100_000_000 ether && total == round.funded, "round0 allocation mismatch");
    }

    function _certification(address[] calldata recipients, uint256[] calldata amounts)
        private
        pure
        returns (bytes[] memory data)
    {
        uint256 n = recipients.length;
        if (n <= 1024) {
            data = new bytes[](1);
            data[0] = abi.encodeCall(MerkleClaimEvidence.certifyRound, (0, recipients, amounts));
            return data;
        }
        uint256 submissions = (n + CHUNK - 1) / CHUNK;
        uint256 reductions = (n - 1 + CHUNK - 1) / CHUNK;
        data = new bytes[](submissions + reductions);
        for (uint256 i; i < submissions; ++i) {
            uint256 start = i * CHUNK;
            uint256 end = start + CHUNK > n ? n : start + CHUNK;
            data[i] = abi.encodeCall(
                MerkleClaimEvidence.submitLeaves, (0, n, recipients[start:end], amounts[start:end])
            );
        }
        for (uint256 i; i < reductions; ++i) {
            data[submissions + i] = abi.encodeCall(MerkleClaimEvidence.reduce, (0, CHUNK));
        }
    }

    function _tx(address signer, address to, bytes memory data, string memory effect)
        private
        pure
        returns (WalletTransaction memory)
    {
        return WalletTransaction(1, signer, to, 0, data, effect);
    }
}
