// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IClaimEvidence, IMerkleDistributor} from "./interfaces/IIntegration.sol";

/// @notice Immutable adapter from the verified IMD `MerkleDistributor` to the hook's cumulative-claim view.
/// @dev The distributor stores only `claimed[round][account] == true`, never an amount. The amount lives in the
/// leaf `keccak256(bytes.concat(keccak256(abi.encode(account, amount))))` committed by the round's root, and
/// `MerkleDistributor.claim` transfers exactly that amount to exactly that account. So a claim is proven here by
/// (1) the distributor's own `claimed` flag for the round and account and (2) a proof of the leaf against the
/// round's root read from the distributor. Nothing is caller-selected: a wrong amount fails the proof, a wrong
/// account fails the flag, a round can be attested once per account, and the credit can only go to `account`.
/// The adapter never touches the distributor's claim path; native claims need no interaction with it.
///
/// Every round must first have its COMPLETE tree reconstructed with unique recipients. A membership proof
/// alone cannot show that a different amount for the same recipient was not claimed. Certification is
/// permissionless, immutable per root, and independent of the distributor's native claim path.
contract MerkleClaimEvidence is IClaimEvidence {
    IMerkleDistributor public immutable merkleDistributor;
    address public immutable token;

    mapping(address account => uint256) public claimed;
    mapping(uint256 round => mapping(address account => bool)) public attested;

    mapping(uint256 round => bool) public certified;
    /// @notice Leaves one `certifyRound` call accepts. Larger rounds use the chunked path below.
    uint256 public constant MAX_LEAVES = 1024;

    /// @notice A chunked certification in progress. Sessions are per submitter and generation, so nobody can
    /// pollute or abandon anyone else's; a finished session certifies the round for everyone.
    struct Session {
        uint256 leaves;
        uint256 submitted;
        uint256 reduced;
    }

    mapping(address submitter => mapping(uint256 round => uint256)) public generation;
    mapping(bytes32 session => Session) public sessions;
    mapping(bytes32 session => mapping(uint256 index => bytes32)) private nodes;
    mapping(bytes32 session => mapping(address account => bool)) private listed;

    error UncertifiedRound();
    error DuplicateRecipient();
    error InvalidConfig();
    event Certified(uint256 indexed round, bytes32 root, uint256 recipients);
    event LeavesSubmitted(uint256 indexed round, address indexed submitter, uint256 from, uint256 count);
    event SessionAbandoned(uint256 indexed round, address indexed submitter, uint256 generation);
    error NotClaimed();
    error AlreadyAttested();
    error InvalidProof();

    event Attested(uint256 indexed round, address indexed account, uint256 amount);

    /// @param distributor_ The distributor the factory creates for this launch, predicted or already deployed.
    /// @param token_ The launched token, predicted with `LaunchFactory.predictToken` or already deployed.
    constructor(IMerkleDistributor distributor_, address token_) {
        if (address(distributor_) == address(0) || token_ == address(0)) revert InvalidConfig();
        merkleDistributor = distributor_;
        token = token_;
    }

    function distributor() external view returns (address) {
        return address(merkleDistributor);
    }

    /// @notice Supply every leaf in the tree's heap order (leaf nodes from index n-1 to 2n-2).
    /// Checks uniqueness after sorting a copy of the accounts and recomputes every internal node.
    /// This proves complete coverage of the root, including for non-power-of-two trees.
    function certifyRound(uint256 round, address[] memory accounts, uint256[] calldata amounts) external {
        uint256 n = accounts.length;
        if (n == 0 || n > MAX_LEAVES || n != amounts.length || certified[round]) revert InvalidConfig();
        bytes32[] memory tree = new bytes32[](2 * n - 1);
        for (uint256 i; i < n; ++i) {
            if (accounts[i] == address(0)) revert InvalidConfig();
            tree[n - 1 + i] = keccak256(bytes.concat(keccak256(abi.encode(accounts[i], amounts[i]))));
        }
        _sort(accounts);
        for (uint256 i = 1; i < n; ++i) {
            if (accounts[i] == accounts[i - 1]) revert DuplicateRecipient();
        }
        for (uint256 i = n - 1; i > 0;) {
            --i;
            tree[i] = Hashes.commutativeKeccak256(tree[2 * i + 1], tree[2 * i + 2]);
        }
        _finish(round, tree[0], n);
    }

    function _finish(uint256 round, bytes32 root, uint256 n) private {
        if (root != merkleDistributor.roundOf(round).root) revert InvalidProof();
        certified[round] = true;
        emit Certified(round, root, n);
    }

    function sessionOf(address submitter, uint256 round) public view returns (bytes32) {
        return keccak256(abi.encode(submitter, round, generation[submitter][round]));
    }

    /// @notice Chunked certification for rounds larger than one transaction can hold. Submit the complete tree's
    /// leaves in heap order (leaf i of n is node n-1+i), in any chunk sizes; `leaves` is the total and is fixed
    /// by the caller's first chunk. Uniqueness is enforced across chunks. Only the caller's own session advances.
    function submitLeaves(
        uint256 round,
        uint256 leaves,
        address[] calldata accounts,
        uint256[] calldata amounts
    ) external {
        bytes32 id = sessionOf(msg.sender, round);
        Session storage s = sessions[id];
        if (certified[round] || leaves == 0 || accounts.length == 0 || accounts.length != amounts.length) {
            revert InvalidConfig();
        }
        if (s.leaves == 0) {
            s.leaves = leaves;
        } else if (s.leaves != leaves) {
            revert InvalidConfig();
        }
        uint256 start = s.submitted;
        if (start + accounts.length > leaves) revert InvalidConfig();
        for (uint256 i; i < accounts.length; ++i) {
            _list(id, leaves - 1 + start + i, accounts[i], amounts[i]);
        }
        s.submitted = start + accounts.length;
        emit LeavesSubmitted(round, msg.sender, start, accounts.length);
    }

    function _list(bytes32 id, uint256 index, address account, uint256 amount) private {
        if (account == address(0)) revert InvalidConfig();
        if (listed[id][account]) revert DuplicateRecipient();
        listed[id][account] = true;
        nodes[id][index] = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    /// @notice Computes up to `count` internal nodes of the caller's complete session, highest index first, and
    /// certifies the round when the root is reached and matches the distributor's. A mismatch changes nothing;
    /// the submitter can `abandonSession` and start over.
    function reduce(uint256 round, uint256 count) external {
        bytes32 id = sessionOf(msg.sender, round);
        Session storage s = sessions[id];
        uint256 n = s.leaves;
        if (certified[round] || n == 0 || s.submitted != n || count == 0) revert InvalidConfig();
        uint256 internalNodes = n - 1;
        uint256 done = s.reduced;
        uint256 end = done + count > internalNodes ? internalNodes : done + count;
        for (uint256 k = done; k < end; ++k) {
            uint256 i = internalNodes - 1 - k;
            nodes[id][i] = Hashes.commutativeKeccak256(nodes[id][2 * i + 1], nodes[id][2 * i + 2]);
        }
        s.reduced = end;
        if (end == internalNodes) _finish(round, nodes[id][0], n);
    }

    /// @notice Discards the caller's own session for a round so a corrected tree can be submitted.
    function abandonSession(uint256 round) external {
        uint256 next = ++generation[msg.sender][round];
        emit SessionAbandoned(round, msg.sender, next);
    }

    // Iterative heapsort bounds certification to O(n log n), including adversarially ordered accounts.
    // A recursive first-pivot quicksort can exhaust the EVM stack for a valid but sorted large tree.
    function _sort(address[] memory values) private pure {
        uint256 n = values.length;
        for (uint256 i = n / 2; i != 0;) {
            _sift(values, --i, n);
        }
        while (n > 1) {
            --n;
            (values[0], values[n]) = (values[n], values[0]);
            _sift(values, 0, n);
        }
    }

    function _sift(address[] memory values, uint256 root, uint256 end) private pure {
        while (2 * root + 1 < end) {
            uint256 child = 2 * root + 1;
            if (child + 1 < end && values[child] < values[child + 1]) ++child;
            if (values[root] >= values[child]) return;
            (values[root], values[child]) = (values[child], values[root]);
            root = child;
        }
    }

    /// @notice Records one actual native claim. Anyone may submit it; the credit belongs to `account`.
    function attest(uint256 round, address account, uint256 amount, bytes32[] calldata proof)
        external
        returns (uint256)
    {
        if (attested[round][account]) revert AlreadyAttested();
        if (!merkleDistributor.claimed(round, account)) revert NotClaimed();
        if (!certified[round]) revert UncertifiedRound();
        bytes32 root = merkleDistributor.roundOf(round).root;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        if (!MerkleProof.verifyCalldata(proof, root, leaf)) revert InvalidProof();
        attested[round][account] = true;
        claimed[account] += amount;
        emit Attested(round, account, amount);
        return amount;
    }
}
