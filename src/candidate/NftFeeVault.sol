// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed beneficiary treasury. NFT purchases are manual, outside this contract.
/// @dev Claims accrue without sending ETH to the beneficiary during swaps. No LP principal access.
contract NftFeeVault is IUnlockCallback, ReentrancyGuard {
    address public constant BENEFICIARY = 0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9;
    IPoolManager public immutable poolManager;
    address public immutable hook;
    uint256 public totalAccrued;
    uint256 public totalRedeemed;
    uint256 public totalWithdrawn;
    uint256 public donationsWithdrawn;
    bool private redeeming;
    bool private receiving;

    error Unauthorized();
    error InvalidReceipt();
    error WithdrawalFailed();
    event Accrued(uint256 amount, uint256 totalAccrued);
    event Redeemed(uint256 amount);
    event Withdrawn(uint256 amount);
    event DonationWithdrawn(uint256 amount);
    event DonationReceived(address indexed sender, uint256 amount);

    constructor(IPoolManager manager_, address hook_) {
        if (address(manager_) == address(0) || hook_ == address(0)) revert InvalidReceipt();
        poolManager = manager_;
        hook = hook_;
    }

    function pendingClaims() public view returns (uint256) {
        return totalAccrued - totalRedeemed;
    }

    function claimable() public view returns (uint256) {
        return totalRedeemed - totalWithdrawn;
    }

    function donations() public view returns (uint256) {
        return address(this).balance - claimable();
    }

    function totalDonations() external view returns (uint256) {
        return donations() + donationsWithdrawn;
    }

    function donatedClaims() external view returns (uint256) {
        return poolManager.balanceOf(address(this), 0) - pendingClaims();
    }

    /// @dev Only the immutable hook records revenue, backed by manager-issued native claims.
    function recordAccrual(uint256 amount) external {
        if (msg.sender != hook) revert Unauthorized();
        if (amount == 0 || poolManager.balanceOf(address(this), 0) < pendingClaims() + amount) {
            revert InvalidReceipt();
        }
        totalAccrued += amount;
        emit Accrued(amount, totalAccrued);
    }

    /// @notice Anyone may redeem genuine fee claims after settlement, to this vault only.
    function redeem() external nonReentrant {
        if (pendingClaims() == 0) return;
        redeeming = true;
        poolManager.unlock("");
        redeeming = false;
    }

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || !redeeming) revert Unauthorized();
        redeeming = false;
        uint256 amount = pendingClaims();
        uint256 beforeBalance = address(this).balance;
        totalRedeemed += amount;
        poolManager.burn(address(this), 0, amount);
        receiving = true;
        poolManager.take(Currency.wrap(address(0)), address(this), amount);
        receiving = false;
        if (address(this).balance != beforeBalance + amount) revert InvalidReceipt();
        emit Redeemed(amount);
        return "";
    }

    function withdraw() external nonReentrant {
        if (msg.sender != BENEFICIARY) revert Unauthorized();
        uint256 amount = claimable();
        totalWithdrawn += amount;
        emit Withdrawn(amount);
        _pay(amount);
    }

    function withdrawDonations() external nonReentrant {
        if (msg.sender != BENEFICIARY) revert Unauthorized();
        uint256 amount = donations();
        donationsWithdrawn += amount;
        emit DonationWithdrawn(amount);
        _pay(amount);
    }

    function _pay(uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = payable(BENEFICIARY).call{value: amount}("");
        if (!ok) revert WithdrawalFailed();
    }

    receive() external payable {
        if (!receiving) emit DonationReceived(msg.sender, msg.value);
    }
}
