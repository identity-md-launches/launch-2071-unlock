// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {QuotaMitigationTest} from "test/mainnet/QuotaMitigation.t.sol";
import {ImdMultihopTest} from "test/mainnet/ImdMultihop.t.sol";
import {ImdSetupTest} from "test/mainnet/ImdSetup.t.sol";
import {Test} from "forge-std/Test.sol";
import {ImdUsdSource, IV3OraclePool} from "src/mainnet/ImdUsdSource.sol";
import {ImdFixture} from "test/mainnet/ImdFixture.sol";
import {ImdSwapsTest} from "test/mainnet/ImdSwaps.t.sol";
import {ImdPermitAndBatchTest} from "test/mainnet/ImdPermitAndBatch.t.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {MainnetPins} from "src/mainnet/MainnetPins.sol";

/// @notice Actual Ethereum state, exact block and actual factory launch (local deployer impersonation).
/// Real Manager/Router/Quoter/Permit2/IMD. Price venue and feed calls are SYNTHETIC fixtures inherited
/// from ImdFixture: no reliable actual IMD/USD venue is certified. This is not a production oracle rehearsal.
contract MainnetRecordedBlockRehearsal is ImdSwapsTest, ImdPermitAndBatchTest, ImdSetupTest {
    function setUp() public override {
        LAUNCH_NUMBER = type(uint64).max - 1000;
        ImdFixture.setUp();
    }

    function _newManager() internal override returns (PoolManager) {
        vm.createSelectFork("https://ethereum-rpc.publicnode.com", 26203203);
        require(block.chainid == 1, "mainnet fork required");
        return PoolManager(payable(MainnetPins.MANAGER_ADDRESS));
    }
}

contract MainnetOracleEvidence is Test {
    function testDiscoveredV3MarketHasNoActiveLiquidityAndCannotCertifyUsd() public {
        vm.createSelectFork("https://ethereum-rpc.publicnode.com", 26203203);
        IV3OraclePool venue = IV3OraclePool(0xD6A822D028bbf7b6EDfA1533e110Ee40c08551d9);
        assertEq(venue.liquidity(), 0);
        ImdUsdSource source = new ImdUsdSource(venue, address(venue).codehash, 1e18);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(ImdUsdSource.InvalidPrice.selector);
        source.priceUsd();
    }
}

contract MainnetMultihopRehearsal is ImdMultihopTest {
    function setUp() public override {
        LAUNCH_NUMBER = type(uint64).max - 2000;
        ImdFixture.setUp();
    }

    function _newManager() internal override returns (PoolManager) {
        vm.createSelectFork("https://ethereum-rpc.publicnode.com", 26203203);
        require(block.chainid == 1, "mainnet fork required");
        return PoolManager(payable(MainnetPins.MANAGER_ADDRESS));
    }
}

/// @dev Actual router, factory, manager, token and Permit2; only unlock-pricing fixtures are synthetic.
contract MainnetQuotaMitigationRehearsal is QuotaMitigationTest {
    function setUp() public override {
        LAUNCH_NUMBER = type(uint64).max - 3000;
        ImdFixture.setUp();
    }

    function _newManager() internal override returns (PoolManager) {
        vm.createSelectFork("https://ethereum-rpc.publicnode.com", 26203856);
        require(block.chainid == 1, "mainnet fork required");
        return PoolManager(payable(MainnetPins.MANAGER_ADDRESS));
    }
}
