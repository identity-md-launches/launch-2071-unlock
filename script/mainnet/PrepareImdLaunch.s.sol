// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/src/libraries/SqrtPriceMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {UnlkToken} from "../../src/UnlkToken.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";
// Exact accepted platform ABI source, also exercised against real factory runtime by the fork rehearsal.
// No local factory/distributor is deployed or substituted by this calldata-only script.
import {LaunchFactory} from "../../test/imd/LaunchFactory.sol";
import {LaunchRegistry} from "../../test/imd/LaunchRegistry.sol";

/// @notice Read-only stage1 preparation. All real launch/admission identities are explicit inputs.
/// No broadcast, signature, key/environment access, launch registration or live configuration write.
contract PrepareImdLaunch is Script {
    struct Config {
        uint64 number;
        address setupAuthority;
        address payer;
        bytes32 merkleRoot;
        uint64 contributorLockSeconds;
        uint64 sweepDelaySeconds;
        bytes32 hookSalt;
        uint256 openingFdvImd; // 18 decimals, selected mainnet policy cap (not USD).
        LaunchRegistry.Launch record;
        uint256[] agentIds;
    }

    struct Plan {
        address to;
        address requiredSigner;
        address token;
        address hook;
        address distributor;
        PoolKey key;
        uint256 seededTokens;
        uint256 openingFdvImd;
        LaunchFactory.LaunchParams params;
        bytes data;
    }

    function prepare(Config calldata config) external view returns (Plan memory plan) {
        LaunchFactory factory = LaunchFactory(payable(MainnetPins.FACTORY_ADDRESS));
        require(
            block.chainid == 1 && address(factory).codehash == MainnetPins.FACTORY
                && address(factory.poolManager()) == MainnetPins.MANAGER_ADDRESS,
            "mainnet factory pin"
        );
        require(
            config.number != 0 && !factory.registry().isRecorded(config.number)
                && config.setupAuthority != address(0) && config.payer != address(0)
                && config.setupAuthority != address(factory)
                && config.setupAuthority != MainnetPins.MANAGER_ADDRESS,
            "actual new launch identities required"
        );
        require(
            config.merkleRoot != bytes32(0) && config.contributorLockSeconds != 0
                && config.sweepDelaySeconds >= config.contributorLockSeconds,
            "actual claim schedule required"
        );
        require(
            config.record.kind == "univ4_hook" && config.record.launchNumber == config.number
                && config.record.sourceCommit != bytes32(0) && config.record.manifestHash != bytes32(0)
                && config.record.attestationHash != bytes32(0) && config.record.verifierKey != bytes32(0)
                && bytes(config.record.sourceRepoUrl).length != 0,
            "actual accepted provenance required"
        );
        // The registry records the publisher's delivered tree, whose URL may differ from the imported
        // repository. The release service must match this entire record to its actual signed attestation.
        require(
            config.openingFdvImd >= 250 ether && config.openingFdvImd <= 250000 ether,
            "recorded policy cap range"
        );
        LaunchFactory.LaunchParams memory p;
        p.launchNumber = config.number;
        p.kind = "univ4_hook";
        p.tokenCreationCode = type(UnlkToken).creationCode;
        plan.token = factory.predictToken(config.number, p.tokenCreationCode);
        require(config.setupAuthority != plan.token, "authority is token");
        plan.distributor = _predictDistributor(factory, plan.token, config.number, config.sweepDelaySeconds);
        require(
            config.payer != plan.distributor && config.setupAuthority != plan.distributor,
            "launch wallet is distributor"
        );
        p.hookCreationCode = bytes.concat(
            type(UnlkImdHook).creationCode,
            abi.encode(
                IPoolManager(MainnetPins.MANAGER_ADDRESS), plan.token, address(factory), config.setupAuthority
            )
        );
        p.hookSalt = config.hookSalt;
        p.hookFlags = 0x3fcc;
        plan.hook = factory.predictHook(p.hookCreationCode, config.hookSalt);
        require(uint160(plan.hook) & 0x3fff == 0x3fcc, "mine salt for exact final code");
        require(
            config.setupAuthority != plan.hook && config.payer != address(factory)
                && config.payer != MainnetPins.MANAGER_ADDRESS && config.payer != plan.token
                && config.payer != plan.hook,
            "launch wallets must be controllable"
        );
        p.totalSupply = 1_000_000_000 ether;
        p.poolBps = 8700;
        p.remainderTo = config.payer;
        p.requester = config.payer;
        p.merkleRoot = config.merkleRoot;
        p.contributorLockSeconds = config.contributorLockSeconds;
        p.sweepDelaySeconds = config.sweepDelaySeconds;
        p.pairedCurrency = Currency.wrap(MainnetPins.IMD_ADDRESS);
        p.fee = 12500;
        p.tickSpacing = 60;
        p.record = config.record;
        p.agentIds = config.agentIds;
        bool token0 = plan.token < MainnetPins.IMD_ADDRESS;
        // Round normalized IMD-per-UNLK tick DOWN to spacing before inverting for token1.
        uint160 normalizedSqrt =
            uint160(Math.sqrt(Math.mulDiv(config.openingFdvImd, 1 << 192, p.totalSupply)));
        int24 normalizedTick = TickMath.getTickAtSqrtPrice(normalizedSqrt);
        if (normalizedTick < 0 && normalizedTick % 60 != 0) normalizedTick -= 60;
        normalizedTick = normalizedTick / 60 * 60;
        p.tickLower = token0 ? normalizedTick : TickMath.minUsableTick(60);
        p.tickUpper = token0 ? TickMath.maxUsableTick(60) : -normalizedTick;
        p.sqrtPriceX96 = TickMath.getSqrtPriceAtTick(token0 ? p.tickLower : p.tickUpper);
        uint160 lower = TickMath.getSqrtPriceAtTick(p.tickLower);
        uint160 upper = TickMath.getSqrtPriceAtTick(p.tickUpper);
        uint256 liquidity = token0
            ? Math.mulDiv(870_000_000 ether, Math.mulDiv(lower, upper, 1 << 96), upper - lower)
            : Math.mulDiv(870_000_000 ether, 1 << 96, upper - lower);
        require(liquidity >= 1e18 && liquidity <= type(uint128).max, "seed liquidity bounds");
        p.liquidity = uint128(liquidity);
        plan.seededTokens = token0
            ? SqrtPriceMath.getAmount0Delta(lower, upper, p.liquidity, true)
            : SqrtPriceMath.getAmount1Delta(lower, upper, p.liquidity, true);
        require(
            plan.seededTokens <= 870_000_000 ether && plan.seededTokens >= 861_300_000 ether,
            "seed allocation band"
        );
        uint256 square = uint256(p.sqrtPriceX96) * p.sqrtPriceX96; // policy bounds sqrt below uint128.
        plan.openingFdvImd = token0
            ? Math.mulDiv(p.totalSupply, square, 1 << 192)
            : Math.mulDiv(p.totalSupply, 1 << 192, square);
        require(plan.openingFdvImd <= config.openingFdvImd, "cap rounding");
        plan.to = address(factory);
        plan.requiredSigner = factory.deployer();
        plan.key = PoolKey(
            Currency.wrap(token0 ? plan.token : MainnetPins.IMD_ADDRESS),
            Currency.wrap(token0 ? MainnetPins.IMD_ADDRESS : plan.token),
            12500,
            60,
            IHooks(plan.hook)
        );
        plan.params = p;
        plan.data = abi.encodeCall(LaunchFactory.launch, (p));
    }

    /// @dev The exact PINNED factory runtime embeds its native creation body at offset 12803, 4504 bytes.
    /// Derivation checked against Sourcify's accepted runtime archive and the factory's own getter, not
    /// the local distributor compiler output. The factory runtime pin above and body hash below MUST match;
    /// a different layout fails closed. No stand-in distributor or guessed address is used.
    function _predictDistributor(LaunchFactory factory, address token, uint64 number, uint64 sweepDelay)
        private
        view
        returns (address)
    {
        bytes memory nativeCreation = new bytes(4504);
        address at = address(factory);
        assembly ("memory-safe") {
            extcodecopy(at, add(nativeCreation, 32), 12803, 4504)
        }
        require(
            keccak256(nativeCreation) == factory.distributorCreationCodeHash(),
            "native creation body mismatch"
        );
        bytes32 initHash =
            keccak256(bytes.concat(nativeCreation, abi.encode(token, at, factory.fees(), sweepDelay)));
        return address(
            uint160(
                uint256(keccak256(abi.encodePacked(bytes1(0xff), at, bytes32(uint256(number)), initHash)))
            )
        );
    }
}
