// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {UnlkToken} from "src/UnlkToken.sol";

/// @notice Local ERC-20 tests. The minter and recipients below are test actors, not deployment inputs.
contract TokenReceiptPropertiesTest is Test {
    UnlkToken internal token;
    address internal swarm;
    address internal pool;
    address internal payer;
    address internal spender;

    function setUp() public {
        token = new UnlkToken();
        swarm = makeAddr("receipt swarm");
        pool = makeAddr("receipt pool");
        payer = makeAddr("receipt payer");
        spender = makeAddr("receipt spender");
    }

    function test_MetadataAndUnsealedIssuance() public view {
        assertEq(token.name(), "UNLOCK");
        assertEq(token.symbol(), "UNLK");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(address(this)), 1_000_000_000 ether);
        assertEq(token.initialMinter(), address(this));
        assertFalse(token.distributionComplete());
        assertEq(token.initialAllocation(address(this)), 0);
        assertEq(token.initialRecipient(), address(0));
    }

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_ReceiptsSurviveRoundingDelegationAndReturnedInventory(uint96 shortfallSeed) public {
        // The launch allows up to 1% seed rounding, all of which belongs to the remainder wallet.
        uint256 shortfall = bound(shortfallSeed, 0, 8_700_000 ether);
        uint256 poolAmount = 870_000_000 ether - shortfall;
        uint256 payerAmount = 30_000_000 ether + shortfall;
        token.transfer(swarm, 100_000_000 ether);
        token.transfer(pool, poolAmount);
        token.approve(spender, payerAmount);
        vm.prank(spender);
        token.transferFrom(address(this), payer, payerAmount);

        assertEq(token.initialAllocation(swarm), 100_000_000 ether);
        assertEq(token.initialAllocation(pool), poolAmount);
        assertEq(token.initialAllocation(payer), payerAmount);
        assertEq(token.initialRecipient(), payer, "spender cannot become the remainder recipient");
        assertTrue(token.distributionComplete());
        assertEq(token.allowance(address(this), spender), 0);

        // Returning all inventory to the factory and sending it elsewhere must never reopen receipts.
        vm.prank(swarm);
        token.transfer(address(this), 100_000_000 ether);
        vm.prank(pool);
        token.transfer(address(this), poolAmount);
        vm.prank(payer);
        token.transfer(address(this), payerAmount);
        token.transfer(spender, token.totalSupply());
        assertEq(token.balanceOf(spender), 1_000_000_000 ether);
        assertEq(token.initialAllocation(spender), 0);
        assertEq(token.initialAllocation(swarm), 100_000_000 ether);
        assertEq(token.initialAllocation(pool), poolAmount);
        assertEq(token.initialAllocation(payer), payerAmount);
        assertEq(token.initialRecipient(), payer);
        assertTrue(token.distributionComplete());
    }

    function test_ZeroAndSelfTransfersCannotSealOrCreateAllocationReceipts() public {
        token.transfer(address(this), token.totalSupply());
        token.transfer(payer, 0);
        token.approve(spender, type(uint256).max);
        uint256 supply = token.totalSupply();
        vm.prank(spender);
        token.transferFrom(address(this), address(this), supply);
        assertEq(token.initialAllocation(address(this)), 0);
        assertEq(token.initialAllocation(payer), 0);
        assertFalse(token.distributionComplete());
        assertEq(token.initialRecipient(), address(0));
        assertEq(token.balanceOf(address(this)), token.totalSupply());
        assertEq(token.allowance(address(this), spender), type(uint256).max);

        token.transfer(payer, token.totalSupply() - 1);
        assertFalse(token.distributionComplete());
        token.transfer(swarm, 0);
        assertFalse(token.distributionComplete());
        token.transfer(pool, 1);
        assertTrue(token.distributionComplete());
        assertEq(token.initialRecipient(), pool, "last positive wei seals the actual recipient");
        assertEq(token.initialAllocation(pool), 1);
        token.transfer(swarm, 0); // zero transfer by the now-empty minter is still an ordinary ERC-20 call
        assertEq(token.initialRecipient(), pool);
    }

    function test_FailedFinalTransferRollsBackAllowanceAndDistribution() public {
        token.transfer(pool, token.totalSupply() - 1);
        token.approve(spender, 2);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, address(this), 1, 2)
        );
        vm.prank(spender);
        token.transferFrom(address(this), payer, 2);
        assertEq(token.allowance(address(this), spender), 2);
        assertEq(token.balanceOf(address(this)), 1);
        assertEq(token.initialAllocation(payer), 0);
        assertFalse(token.distributionComplete());

        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        vm.prank(spender);
        token.transferFrom(address(this), address(0), 1);
        assertEq(token.allowance(address(this), spender), 2);
        assertFalse(token.distributionComplete());

        vm.prank(spender);
        token.transferFrom(address(this), payer, 1);
        assertEq(token.allowance(address(this), spender), 1);
        assertTrue(token.distributionComplete());
        assertEq(token.initialRecipient(), payer);
        assertEq(token.initialAllocation(payer), 1);
    }
}

/// @dev A closed four-account ledger, with balances and approvals derived only from submitted operations.
/// No balance/storage cheats, pool/router mocks, or reading the token's result into the reference ledger.
contract TokenLedgerHandler is Test {
    UnlkToken public immutable token;
    address[4] public actors;
    uint256[4] public balances;
    uint256[4][4] public allowances;
    uint256 public successfulTransfers;
    uint256 public refusedTransfers;

    constructor() {
        token = new UnlkToken();
        actors[0] = address(this);
        actors[1] = makeAddr("ledger swarm");
        actors[2] = makeAddr("ledger pool");
        actors[3] = makeAddr("ledger payer");
        balances[1] = 100_000_000 ether;
        balances[2] = 870_000_000 ether;
        balances[3] = 30_000_000 ether;
        for (uint256 i = 1; i < 4; ++i) {
            token.transfer(actors[i], balances[i]);
        }
    }

    function approve(uint256 ownerSeed, uint256 spenderSeed, uint256 amount) external {
        uint256 owner = ownerSeed % 4;
        uint256 spender = spenderSeed % 4;
        vm.prank(actors[owner]);
        assertTrue(token.approve(actors[spender], amount));
        allowances[owner][spender] = amount;
    }

    function transfer(uint256 fromSeed, uint256 toSeed, uint256 amountSeed) external {
        uint256 from = fromSeed % 4;
        uint256 to = toSeed % 4;
        uint256 amount = bound(amountSeed, 0, balances[from]);
        vm.prank(actors[from]);
        assertTrue(token.transfer(actors[to], amount));
        _move(from, to, amount);
    }

    function transferAll(uint256 fromSeed, uint256 toSeed) external {
        uint256 from = fromSeed % 4;
        uint256 to = toSeed % 4;
        uint256 amount = balances[from];
        vm.prank(actors[from]);
        assertTrue(token.transfer(actors[to], amount));
        _move(from, to, amount);
    }

    function transferFrom(uint256 fromSeed, uint256 spenderSeed, uint256 toSeed, uint256 amountSeed)
        external
    {
        uint256 from = fromSeed % 4;
        uint256 spender = spenderSeed % 4;
        uint256 to = toSeed % 4;
        uint256 allowed = allowances[from][spender];
        uint256 amount = bound(amountSeed, 0, allowed < balances[from] ? allowed : balances[from]);
        vm.prank(actors[spender]);
        assertTrue(token.transferFrom(actors[from], actors[to], amount));
        if (allowed != type(uint256).max) allowances[from][spender] -= amount;
        _move(from, to, amount);
    }

    function refuseOverspend(uint256 fromSeed, uint256 spenderSeed, bool insufficientAllowance) external {
        uint256 from = fromSeed % 4;
        uint256 spender = spenderSeed % 4;
        uint256 to = (from + 1) % 4;
        uint256 amount = balances[from] + 1;
        uint256 allowed = insufficientAllowance ? amount - 1 : amount;
        vm.prank(actors[from]);
        token.approve(actors[spender], allowed);
        allowances[from][spender] = allowed;
        bytes memory reason = insufficientAllowance
            ? abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, actors[spender], allowed, amount
            )
            : abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, actors[from], balances[from], amount
            );
        vm.expectRevert(reason);
        vm.prank(actors[spender]);
        token.transferFrom(actors[from], actors[to], amount);
        ++refusedTransfers;
    }

    function refuseZeroAddress(uint256 actorSeed, bool approval) external {
        address actor = actors[actorSeed % 4];
        bytes4 errorSelector =
            approval ? IERC20Errors.ERC20InvalidSpender.selector : IERC20Errors.ERC20InvalidReceiver.selector;
        vm.expectRevert(abi.encodeWithSelector(errorSelector, address(0)));
        vm.prank(actor);
        if (approval) token.approve(address(0), 0);
        else token.transfer(address(0), 0);
        ++refusedTransfers;
    }

    function _move(uint256 from, uint256 to, uint256 amount) private {
        balances[from] -= amount;
        balances[to] += amount;
        ++successfulTransfers;
    }
}

/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = true
contract TokenLedgerInvariantTest is Test {
    TokenLedgerHandler internal handler;
    UnlkToken internal token;

    function setUp() public {
        handler = new TokenLedgerHandler();
        token = handler.token();
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.approve.selector;
        selectors[1] = handler.transfer.selector;
        selectors[2] = handler.transferAll.selector;
        selectors[3] = handler.transferFrom.selector;
        selectors[4] = handler.refuseOverspend.selector;
        selectors[5] = handler.refuseZeroAddress.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_BalancesAndAllowancesMatchIndependentLedger() public view {
        uint256 total;
        for (uint256 i; i < 4; ++i) {
            address actor = handler.actors(i);
            assertEq(token.balanceOf(actor), handler.balances(i), "ERC-20 balance diverged");
            total += token.balanceOf(actor);
            for (uint256 j; j < 4; ++j) {
                assertEq(
                    token.allowance(actor, handler.actors(j)), handler.allowances(i, j), "allowance diverged"
                );
            }
        }
        assertEq(total, 1_000_000_000 ether);
        assertEq(token.totalSupply(), total);
        assertEq(token.balanceOf(address(0)), 0);
    }

    function invariant_OriginalReceiptsRemainSealedDespiteArbitraryTransfers() public view {
        assertTrue(token.distributionComplete());
        assertEq(token.initialMinter(), address(handler));
        assertEq(token.initialRecipient(), handler.actors(3));
        assertEq(token.initialAllocation(handler.actors(0)), 0);
        assertEq(token.initialAllocation(handler.actors(1)), 100_000_000 ether);
        assertEq(token.initialAllocation(handler.actors(2)), 870_000_000 ether);
        assertEq(token.initialAllocation(handler.actors(3)), 30_000_000 ether);
    }

    function afterInvariant() public {
        // All inventory remains freely transferable, even back through the original minter.
        for (uint256 i = 1; i < 4; ++i) {
            handler.transferAll(i, 0);
        }
        handler.transferAll(0, 3);
        assertEq(token.balanceOf(handler.actors(3)), 1_000_000_000 ether);
        invariant_BalancesAndAllowancesMatchIndependentLedger();
        invariant_OriginalReceiptsRemainSealedDespiteArbitraryTransfers();
    }

    function test_HandlerCoversFiniteInfiniteSelfRevokedAndFailedAllowancePaths() public {
        handler.approve(1, 2, 10 ether);
        handler.transferFrom(1, 2, 3, 3 ether);
        assertEq(token.allowance(handler.actors(1), handler.actors(2)), 7 ether);
        handler.transferFrom(1, 2, 1, 2 ether); // a delegated self-transfer spends finite allowance
        assertEq(token.allowance(handler.actors(1), handler.actors(2)), 5 ether);
        handler.approve(1, 2, type(uint256).max);
        handler.transferFrom(1, 2, 1, 1 ether);
        assertEq(token.allowance(handler.actors(1), handler.actors(2)), type(uint256).max);
        handler.approve(1, 2, 0);
        handler.transferFrom(1, 2, 3, 0);
        handler.refuseOverspend(1, 2, true);
        handler.refuseOverspend(1, 2, false);
        handler.refuseZeroAddress(1, true);
        handler.refuseZeroAddress(2, false);
        assertEq(handler.refusedTransfers(), 4);
        assertEq(handler.successfulTransfers(), 4);
        invariant_BalancesAndAllowancesMatchIndependentLedger();
        invariant_OriginalReceiptsRemainSealedDespiteArbitraryTransfers();
        afterInvariant();
    }
}
