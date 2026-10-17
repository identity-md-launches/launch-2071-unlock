pragma solidity 0.8.26;

import {ImdSetupVerifier} from "../../src/mainnet/ImdSetupVerifier.sol";
import {ImdFeeVault} from "../../src/mainnet/ImdFeeVault.sol";
import {Test} from "forge-std/Test.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {UnlkToken} from "../../src/UnlkToken.sol";
import {CustomRevert} from "v4-core/src/libraries/CustomRevert.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {UnlkImdHook} from "../../src/mainnet/UnlkImdHook.sol";
import {MainnetRuntime} from "./MainnetRuntime.sol";
import {MainnetPins} from "../../src/mainnet/MainnetPins.sol";
import {ImdSpotUsdSource} from "../../src/mainnet/ImdSpotUsdSource.sol";
import {ImdUsdSource, IV3OraclePool} from "../../src/mainnet/ImdUsdSource.sol";
import {IImdUsdSource} from "../../src/mainnet/UnlkImdOracle.sol";
import {MockImdMarket} from "./MockImdMarket.sol";
import {UnlkImdOracle} from "../../src/mainnet/UnlkImdOracle.sol";
import {MerkleClaimEvidence} from "../../src/MerkleClaimEvidence.sol";
import {HookDeployerV2} from "../../src/candidate/HookDeployerV2.sol";
import {MockWETH, MockEthUsd} from "../fixtures/LocalFixtures.sol";
import {LaunchFactory} from "../imd/LaunchFactory.sol";
import {LaunchFees} from "../imd/LaunchFees.sol";
import {LaunchRegistry} from "../imd/LaunchRegistry.sol";
import {MerkleDistributor} from "../imd/MerkleDistributor.sol";

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
    function msgSender() external view returns (address);
}

interface IPermit2Allowance {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IV4Quoter {
    struct Quote {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 exactAmount;
        bytes hookData;
    }
    function quoteExactInputSingle(Quote calldata q) external returns (uint256 amountOut, uint256 gas);
    function quoteExactOutputSingle(Quote calldata q) external returns (uint256 amountIn, uint256 gas);
}

abstract contract ImdFixture is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    PoolManager internal manager;
    MockWETH internal weth;
    MockEthUsd internal feed;
    LaunchFees internal launchFees;
    LaunchFactory internal factory;
    MerkleDistributor internal distributor;
    MerkleClaimEvidence internal rewards;
    UnlkToken internal token;
    address internal constant MANAGER = MainnetPins.MANAGER_ADDRESS;
    address internal constant ROUTER = MainnetPins.ROUTER_ADDRESS;
    address internal constant QUOTER = MainnetPins.QUOTER_ADDRESS;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    IUniversalRouter internal router = IUniversalRouter(ROUTER);
    UnlkImdOracle internal oracle;
    UnlkImdHook internal hook;
    ImdFeeVault internal vault;
    HookDeployerV2 internal deployer;
    PoolKey internal key;
    address internal alice;
    address internal bob;
    address internal payer;
    address internal imd;
    address internal owner;
    address internal predictedHook;
    bytes32 internal hookSalt;
    bytes internal hookInitCode;
    uint256 internal constant REWARD = 1_000_000 ether;
    uint64 internal LAUNCH_NUMBER = 1;
    uint64 internal constant SWEEP_DELAY = 365 days;
    uint64 internal constant CONTRIBUTOR_LOCK = 1 hours;
    bool internal tokenIs0;
    IERC20 internal quote = IERC20(MainnetPins.IMD_ADDRESS);
    int256 internal feedAnswer = 3000e8;
    ImdUsdSource internal priceSource;
    MockImdMarket internal market;
    int24 internal constant SPACING = 60;
    int24 internal constant LOWER = -887220;
    int24 internal constant UPPER = 887220;
    int24 internal constant OPENING_TICK = -177300;
    int24 internal seedLower;
    int24 internal seedUpper;
    uint128 internal seedLiquidity;

    function setUp() public virtual {
        _deploy(false);
        _launchTokenOnly(-129000);
        _deployCompanions();
        _activate();
    }

    function _preferToken0() internal pure virtual returns (bool) {
        return true;
    }

    function _forkBlock() internal view virtual returns (uint256) {
        return 0;
    }

    function _newManager() internal virtual returns (PoolManager) {
        vm.chainId(1);
        vm.etch(MANAGER, MainnetRuntime.manager());
        vm.etch(ROUTER, MainnetRuntime.router());
        vm.etch(QUOTER, MainnetRuntime.quoter());
        vm.etch(PERMIT2, MainnetRuntime.permit2());
        vm.etch(MainnetPins.FACTORY_ADDRESS, MainnetRuntime.factory());
        vm.etch(MainnetPins.FEES_ADDRESS, MainnetRuntime.fees());
        vm.etch(MainnetPins.REGISTRY_ADDRESS, MainnetRuntime.registry());
        vm.etch(MainnetPins.IMD_ADDRESS, MainnetRuntime.imd());
        vm.etch(MainnetPins.ETHUSD_ADDRESS, MainnetRuntime.ethUsd());
        return PoolManager(payable(MANAGER));
    }

    function _deploy(bool) internal {
        vm.warp(1_800_000_000);
        alice = makeAddr("local Alice");
        bob = makeAddr("local Bob");
        payer = makeAddr("local paying wallet");
        imd = makeAddr("local IMD fee recipient and treasury");
        owner = makeAddr("local launch owner (setup authority)");
        manager = _newManager();
        factory = LaunchFactory(payable(MainnetPins.FACTORY_ADDRESS));
        launchFees = factory.fees();
        weth = new MockWETH();
        feed = new MockEthUsd();
        address predictedToken = factory.predictToken(LAUNCH_NUMBER, type(UnlkToken).creationCode);
        while ((predictedToken < MainnetPins.IMD_ADDRESS) != _preferToken0()) {
            predictedToken = factory.predictToken(++LAUNCH_NUMBER, type(UnlkToken).creationCode);
        }
        deployer = new HookDeployerV2();
        hookInitCode = deployer.initCode(
            type(UnlkImdHook).creationCode,
            HookDeployerV2.Config(manager, UnlkToken(predictedToken), address(factory), owner)
        );
        _mineHookSalt();
        tokenIs0 = predictedToken < MainnetPins.IMD_ADDRESS;
        key = PoolKey(
            Currency.wrap(tokenIs0 ? predictedToken : MainnetPins.IMD_ADDRESS),
            Currency.wrap(tokenIs0 ? MainnetPins.IMD_ADDRESS : predictedToken),
            12500,
            SPACING,
            IHooks(predictedHook)
        );
        weth.mint(address(this), 1_000_000 ether);
        vm.deal(alice, 10_000 ether);
        vm.deal(bob, 10_000 ether);
    }

    function _deployCompanions() internal virtual {
        market = new MockImdMarket();
        vm.mockCall(
            priceFactory(),
            abi.encodeWithSignature(
                "getPool(address,address,uint24)", priceWeth(), MainnetPins.IMD_ADDRESS, uint24(3000)
            ),
            abi.encode(address(market))
        );
        _freshFeed();
        vm.prank(owner);
        address source = hook.deployPriceSource(type(ImdSpotUsdSource).creationCode, bytes(""));
        // SYNTHETIC oracle only: redirect priceUsd to the historical v3 mock adapter. No proof/history
        // safety is claimed by these router/economics fixtures. V4 proof tests never use this redirection.
        ImdUsdSource synthetic =
            new ImdUsdSource(IV3OraclePool(address(market)), address(market).codehash, uint128(1e18));
        vm.mockFunction(source, address(synthetic), abi.encodeWithSignature("priceUsd()"));
        priceSource = ImdUsdSource(source);
        _advance(24 hours);
        vm.prank(owner);
        (address e, address o, address v) =
            hook.deployCompanions(LAUNCH_NUMBER, IImdUsdSource(source), _codes());
        rewards = MerkleClaimEvidence(e);
        oracle = UnlkImdOracle(o);
        vault = ImdFeeVault(payable(v));
        _certifyInitialRound();
        _approveRouter(alice);
        _approveRouter(bob);
        _approveRouter(payer);
    }

    function _codes() internal pure returns (bytes[4] memory) {
        return [
            type(MerkleClaimEvidence).creationCode,
            type(UnlkImdOracle).creationCode,
            type(ImdFeeVault).creationCode,
            type(ImdSetupVerifier).creationCode
        ];
    }

    function _certifyInitialRound() internal virtual {
        _certifySingle(rewards, 0, alice, REWARD);
    }

    function _certifySingle(MerkleClaimEvidence evidence, uint256 round, address who, uint256 amount)
        internal
    {
        address[] memory accounts = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        accounts[0] = who;
        amounts[0] = amount;
        evidence.certifyRound(round, accounts, amounts);
    }

    function _activate() internal {
        vm.prank(owner);
        hook.configureAndActivate(rewards, oracle, LAUNCH_NUMBER);
    }

    function _mineHookSalt() internal {
        bytes32 codeHash = keccak256(hookInitCode);
        for (uint256 i;; ++i) {
            hookSalt = bytes32(i);
            predictedHook = address(
                uint160(
                    uint256(keccak256(abi.encodePacked(bytes1(0xff), address(factory), hookSalt, codeHash)))
                )
            );
            if (uint160(predictedHook) & 0x3fff == 0x3fcc) break;
        }
        assertEq(factory.predictHook(hookInitCode, hookSalt), predictedHook, "factory prediction");
    }

    function _quoteAddress() internal view virtual returns (address) {
        return MainnetPins.IMD_ADDRESS;
    }

    function _launchTokenOnly(int24 normalizedTick) internal {
        int24 tick = tokenIs0 ? normalizedTick : -normalizedTick;
        if (tokenIs0) {
            (seedLower, seedUpper) = (tick, UPPER);
        } else {
            (seedLower, seedUpper) = (LOWER, tick);
        }
        uint160 sqrt = TickMath.getSqrtPriceAtTick(tick);
        seedLiquidity =
            _tokenOnlyLiquidity(UnlkToken(Currency.unwrap(tokenIs0 ? key.currency0 : key.currency1)), sqrt);
        _launch(sqrt, seedLower, seedUpper, seedLiquidity);
    }

    function _tokenOnlyLiquidity(UnlkToken, uint160 sqrt) internal view returns (uint128) {
        uint256 amount = 870_000_000 ether;
        if (tokenIs0) {
            uint160 upper = TickMath.getSqrtPriceAtTick(seedUpper);
            uint256 intermediate = Math.mulDiv(sqrt, upper, 1 << 96);
            return uint128(Math.mulDiv(amount, intermediate, upper - sqrt));
        }
        uint160 lower = TickMath.getSqrtPriceAtTick(seedLower);
        return uint128(Math.mulDiv(amount, 1 << 96, sqrt - lower));
    }

    function _launchParams(uint160 sqrt, int24 lower, int24 upper, uint128 liquidity)
        internal
        view
        returns (LaunchFactory.LaunchParams memory params)
    {
        params.launchNumber = LAUNCH_NUMBER;
        params.kind = "univ4_hook";
        params.tokenCreationCode = type(UnlkToken).creationCode;
        params.hookCreationCode = hookInitCode;
        params.hookSalt = hookSalt;
        params.hookFlags = 0x3fcc;
        params.totalSupply = 1_000_000_000 ether;
        params.poolBps = 8700;
        params.remainderTo = payer;
        params.merkleRoot = _rewardRoot();
        params.contributorLockSeconds = CONTRIBUTOR_LOCK;
        params.sweepDelaySeconds = SWEEP_DELAY;
        params.pairedCurrency = Currency.wrap(_quoteAddress());
        params.fee = 12500;
        params.tickSpacing = SPACING;
        params.sqrtPriceX96 = sqrt;
        params.tickLower = lower;
        params.tickUpper = upper;
        params.liquidity = liquidity;
        params.record = LaunchRegistry.Launch({
            kind: "univ4_hook",
            launchNumber: LAUNCH_NUMBER,
            recordedAt: 0,
            sourceCommit: bytes32(0),
            manifestHash: bytes32(0),
            attestationHash: bytes32(0),
            verifierKey: bytes32(0),
            sourceRepoUrl: "local fixture"
        });
        params.agentIds = new uint256[](0);
        params.requester = payer;
    }

    function _launch(uint160 sqrt, int24 lower, int24 upper, uint128 liquidity) internal {
        vm.prank(factory.deployer());
        (address tokenAddress, address hookAddress, address distributorAddress) =
            factory.launch(_launchParams(sqrt, lower, upper, liquidity));
        token = UnlkToken(tokenAddress);
        hook = UnlkImdHook(hookAddress);
        distributor = MerkleDistributor(distributorAddress);
        assertEq(hookAddress, predictedHook, "hook prediction");
        assertEq(address(distributor.token()), tokenAddress, "actual factory distributor token");
    }

    function _rewardRoot() internal view virtual returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(alice, REWARD))));
    }

    function _predictDistributor(address predictedToken) internal view returns (address) {
        bytes32 codeHash = keccak256(
            bytes.concat(
                type(MerkleDistributor).creationCode,
                abi.encode(IERC20(predictedToken), address(factory), launchFees, SWEEP_DELAY)
            )
        );
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            bytes1(0xff), address(factory), bytes32(uint256(LAUNCH_NUMBER)), codeHash
                        )
                    )
                )
            )
        );
    }

    function _localWarmUpBuy(uint256 quoteAmount) internal {
        address warm = address(uint160(uint256(keccak256("local warm-up buyer"))));
        _buy(warm, quoteAmount);
    }

    function _approveRouter(address who) internal {
        vm.startPrank(who);
        token.approve(PERMIT2, type(uint256).max);
        quote.approve(PERMIT2, type(uint256).max);
        IPermit2Allowance(PERMIT2)
            .approve(address(quote), ROUTER, type(uint160).max, uint48(block.timestamp + 3650 days));
        IPermit2Allowance(PERMIT2)
            .approve(address(token), ROUTER, type(uint160).max, uint48(block.timestamp + 3650 days));
        vm.stopPrank();
    }

    function _claimReward() internal virtual {
        distributor.claim(0, alice, REWARD, new bytes32[](0));
    }

    function _attestReward() internal virtual returns (uint256) {
        return rewards.attest(0, alice, REWARD, new bytes32[](0));
    }

    struct ExactIn {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    struct ExactOut {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 amountOut;
        uint128 amountInMaximum;
        bytes hookData;
    }

    function _explorerPlan(bool buy, uint256 amountIn, uint256 minOut)
        internal
        view
        returns (bytes[] memory inputs)
    {
        Currency input = Currency.wrap(buy ? address(quote) : address(token));
        Currency output = Currency.wrap(buy ? address(token) : address(quote));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(ExactIn(key, buy != tokenIs0, uint128(amountIn), uint128(minOut), bytes("")));
        params[1] = abi.encode(input, amountIn);
        params[2] = abi.encode(output, minOut);
        inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"060c0f", params);
    }

    function _execute(address who, bytes memory commands, bytes[] memory inputs, uint256 value) internal {
        vm.deal(who, who.balance + value);
        vm.prank(who);
        router.execute{value: value}(commands, inputs, block.timestamp + 600);
    }

    function _buy(address who, uint256 amount) internal returns (uint256 output) {
        uint256 before = token.balanceOf(who);
        _fundQuote(who, amount);
        _approveRouter(who);
        _execute(who, hex"10", _explorerPlan(true, amount, 1), 0);
        output = token.balanceOf(who) - before;
        // Helpers represent separately mined trades; same-block adversarial tests use _execute directly.
        vm.roll(block.number + 1);
    }

    function _sell(address who, uint256 amount) internal returns (uint256 output) {
        uint256 before = quote.balanceOf(who);
        _execute(who, hex"10", _explorerPlan(false, amount, 1), 0);
        output = quote.balanceOf(who) - before;
    }

    function _exactOut(address who, bool buy, uint256 amountOut, uint256 maxIn) internal {
        Currency input = Currency.wrap(buy ? address(quote) : address(token));
        Currency output = Currency.wrap(buy ? address(token) : address(quote));
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(ExactOut(key, buy != tokenIs0, uint128(amountOut), uint128(maxIn), bytes("")));
        params[1] = abi.encode(input, maxIn);
        params[2] = abi.encode(output, amountOut);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(hex"080c0f", params);
        if (buy) {
            _fundQuote(who, maxIn);
            _approveRouter(who);
        }
        _execute(who, hex"10", inputs, 0);
        if (buy) vm.roll(block.number + 1);
    }

    function _expectHookRevert(bytes4 callback, bytes4 err) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                callback,
                abi.encodeWithSelector(err),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    function _quoteIn(bool buy, uint256 amount) internal returns (uint256 out) {
        (out,) = IV4Quoter(QUOTER)
            .quoteExactInputSingle(IV4Quoter.Quote(key, buy != tokenIs0, uint128(amount), ""));
    }

    function _quoteOut(bool buy, uint256 amount) internal returns (uint256 input) {
        (input,) = IV4Quoter(QUOTER)
            .quoteExactOutputSingle(IV4Quoter.Quote(key, buy != tokenIs0, uint128(amount), ""));
    }

    function _advance(uint256 seconds_) internal {
        vm.warp(block.timestamp + seconds_);
        vm.roll(block.number + 1);
        _freshFeed();
    }

    function _confirm() internal {
        hook.checkpoint();
    }

    function _fullyConfirm() internal {
        hook.checkpoint();
        assertTrue(hook.fullyUnlocked(), "current valid spot must touch final threshold");
    }

    function priceFactory() internal pure returns (address) {
        return 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    }

    function priceWeth() internal pure returns (address) {
        return 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    }

    function _freshFeed() internal {
        vm.mockCall(MainnetPins.ETHUSD_ADDRESS, abi.encodeWithSignature("decimals()"), abi.encode(uint8(8)));
        vm.mockCall(
            MainnetPins.ETHUSD_ADDRESS,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(uint80(1), feedAnswer, block.timestamp, block.timestamp, uint80(1))
        );
    }

    function _fundQuote(address who, uint256 amount) internal {
        bytes32 slot = keccak256(abi.encode(who, uint256(5)));
        vm.store(address(quote), slot, bytes32(quote.balanceOf(who) + amount));
    }

    function _factoryLiquidity(int24 lower, int24 upper) internal view returns (uint128 liquidity) {
        (liquidity,,) = IPoolManager(address(manager))
            .getPositionInfo(hook.poolId(), address(factory), lower, upper, bytes32(0));
    }
}
