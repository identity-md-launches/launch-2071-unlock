// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {UnlkImdHook} from "./UnlkImdHook.sol";
import {MainnetPins} from "./MainnetPins.sol";

interface IWalletRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IWalletPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// @notice OPTIONAL single-wallet execution through the unmodified standard router.
/// @dev This executor owns a SEPARATE E/S ledger. It does not move, merge or impersonate the wallet's E/S.
/// Immutable wallet may itself be a smart account. Not an identity/personhood assertion. If that account
/// shares its authority among users, their rights still pool. Direct router access remains available.
contract WalletExecutor is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable wallet;
    UnlkImdHook public immutable hook;
    error Unauthorized();
    error InvalidTrade();

    constructor(address wallet_, UnlkImdHook hook_) {
        if (wallet_ == address(0) || address(hook_) == address(0)) revert InvalidTrade();
        wallet = wallet_;
        hook = hook_;
    }

    /// @param amount Exact input or exact output, according to exactInput.
    /// @param limit Minimum output or maximum input. Budget is pulled only from the authenticated CALLER.
    /// Plans are constructed here: no arbitrary targets, recipients, funding accounts, subplans or hookData.
    function trade(bool buy, bool exactInput, uint128 amount, uint128 limit, uint256 deadline)
        external
        nonReentrant
    {
        if (msg.sender != wallet) revert Unauthorized();
        if (amount == 0 || limit == 0 || deadline < block.timestamp || deadline > type(uint48).max) {
            revert InvalidTrade();
        }
        if (
            block.chainid != 1 || MainnetPins.ROUTER_ADDRESS.codehash != MainnetPins.ROUTER
                || MainnetPins.PERMIT2_ADDRESS.codehash != MainnetPins.PERMIT2 || !hook.activated()
        ) {
            revert InvalidTrade();
        }
        PoolKey memory key = hook.poolKey();
        IERC20 input = IERC20(buy ? MainnetPins.IMD_ADDRESS : address(hook.token()));
        IERC20 output = IERC20(buy ? address(hook.token()) : MainnetPins.IMD_ADDRESS);
        uint256 budget = exactInput ? amount : limit;
        uint256 beforeInput = input.balanceOf(address(this));
        // msg.sender is both authorized wallet and funds owner: no arbitrary-from transferFrom.
        input.safeTransferFrom(msg.sender, address(this), budget);
        if (input.balanceOf(address(this)) != beforeInput + budget) revert InvalidTrade();
        input.forceApprove(MainnetPins.PERMIT2_ADDRESS, budget);
        IWalletPermit2(MainnetPins.PERMIT2_ADDRESS)
            .approve(address(input), MainnetPins.ROUTER_ADDRESS, uint160(budget), uint48(deadline));
        bytes[] memory params = new bytes[](3);
        // ExactInputSingle and ExactOutputSingle share the tuple layout; the action selects semantics.
        // A dynamic struct must be encoded as one tuple, not five top-level parameters.
        params[0] = abi.encode(Swap(key, buy != hook.tokenIs0(), amount, limit, ""));
        params[1] = abi.encode(Currency.wrap(address(input)), budget);
        params[2] = abi.encode(Currency.wrap(address(output)), wallet, uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(exactInput ? hex"060c0e" : hex"080c0e", params);
        IWalletRouter(MainnetPins.ROUTER_ADDRESS).execute(hex"10", inputs, deadline);
        IWalletPermit2(MainnetPins.PERMIT2_ADDRESS).approve(address(input), MainnetPins.ROUTER_ADDRESS, 0, 0);
        input.forceApprove(MainnetPins.PERMIT2_ADDRESS, 0);
        uint256 remainder = input.balanceOf(address(this));
        if (remainder < beforeInput || remainder - beforeInput > budget) revert InvalidTrade();
        if (remainder > beforeInput) input.safeTransfer(wallet, remainder - beforeInput);
    }

    struct Swap {
        PoolKey key;
        bool zeroForOne;
        uint128 amount;
        uint128 limit;
        bytes hookData;
    }

    /// @notice Only this wallet can recover accidental ERC20 transfers. This never moves eligibility.
    function recover(IERC20 asset) external nonReentrant {
        if (msg.sender != wallet) revert Unauthorized();
        asset.safeTransfer(msg.sender, asset.balanceOf(address(this)));
    }
}
