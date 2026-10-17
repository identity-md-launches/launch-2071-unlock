// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Fixed beneficiary treasury. NFT purchases are manual, outside this contract.
/// @dev Claims accrue without sending IMD to the beneficiary during swaps. No LP principal access.
contract ImdFeeVault is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable quoteToken;
    uint256 public immutable claimId;
    address public constant BENEFICIARY = 0x48E4E74fE1d0c14404cEB57B9fec5b21329C6ec9;
    IPoolManager public immutable poolManager;
    address public immutable hook;
    uint256 public totalAccrued;
    uint256 public totalRedeemed;
    uint256 public totalWithdrawn;
    uint256 public donationsWithdrawn;
    bool private redeeming;

    error Unauthorized();
    error InvalidReceipt();
    error WithdrawalFailed();
    event Accrued(uint256 amount, uint256 totalAccrued);
    event Redeemed(uint256 amount);
    event Withdrawn(uint256 amount);
    event DonationWithdrawn(uint256 amount);
    event DonationReceived(address indexed sender, uint256 amount);

    constructor(IPoolManager manager_, address hook_, IERC20 quote_) {
        if (address(manager_) == address(0) || hook_ == address(0) || address(quote_) == address(0)) {
            revert InvalidReceipt();
        }
        poolManager = manager_;
        hook = hook_;
        quoteToken = quote_;
        claimId = uint160(address(quote_));
    }

    function pendingClaims() public view returns (uint256) {
        return totalAccrued - totalRedeemed;
    }

    function claimable() public view returns (uint256) {
        return totalRedeemed - totalWithdrawn;
    }

    function donations() public view returns (uint256) {
        return quoteToken.balanceOf(address(this)) - claimable();
    }

    function totalDonations() external view returns (uint256) {
        return donations() + donationsWithdrawn;
    }

    function donatedClaims() external view returns (uint256) {
        return poolManager.balanceOf(address(this), claimId) - pendingClaims();
    }

    /// @dev Only the immutable hook records revenue, backed by manager-issued IMD claims.
    function recordAccrual(uint256 amount) external {
        if (msg.sender != hook) revert Unauthorized();
        if (amount == 0 || poolManager.balanceOf(address(this), claimId) < pendingClaims() + amount) {
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
        uint256 beforeBalance = quoteToken.balanceOf(address(this));
        totalRedeemed += amount;
        poolManager.burn(address(this), claimId, amount);
        poolManager.take(Currency.wrap(address(quoteToken)), address(this), amount);
        if (quoteToken.balanceOf(address(this)) != beforeBalance + amount) revert InvalidReceipt();
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
        uint256 beforeVault = quoteToken.balanceOf(address(this));
        uint256 beforeRecipient = quoteToken.balanceOf(BENEFICIARY);
        quoteToken.safeTransfer(BENEFICIARY, amount);
        if (
            quoteToken.balanceOf(address(this)) + amount != beforeVault
                || quoteToken.balanceOf(BENEFICIARY) != beforeRecipient + amount
        ) revert InvalidReceipt();
    }
}
