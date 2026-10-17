# Verified IMD LaunchFactory sources (test fixture copy)

These files are a copy of the Sourcify **full match** (creation and runtime bytecode) for the
Ethereum mainnet `LaunchFactory` at `0x12c63b581d07093f6126bc02263c58f7eadaa96f`, compiler
`0.8.26+commit.8a97fa7a`, optimizer 200 runs, EVM `cancun`, `bytecodeHash: none`, verified
2026-10-08T17:44:20Z, deployed in transaction
`0x1441cd85a00735eb68f4e4964bc07fa4b21b038e9e1d7dcab2b5efbd7f9178f3` (block 26128678) by
`0x047F606fD5b2BaA5f5C6c4aB8958E45CB6B054B7`. They are MIT licensed (SPDX header in each file).

They are **test fixtures**: the local tests launch UNLOCK through this exact factory logic against
the vendored Uniswap v4 `PoolManager`. They are not deployed by this project and are not
production substitutes for the mainnet or Sepolia factory instances.

Historical note (superseded): an earlier revision edited them for v4-core v4.0.0
(`e50237c43811bd9b526eff40f26772152a42daba`), whose `ModifyLiquidityParams` struct lives inside
`IPoolManager` rather than in `types/PoolOperation.sol`: the import in `LaunchFactory.sol` and
`PoolFees.sol` was replaced and the struct is referenced as `IPoolManager.ModifyLiquidityParams`.
The struct's ABI encoding is identical, so the calls the factory makes are unchanged.
The current source reference and runtime evidence are saved in `docs/network/`.

Current state: v4-core is now vendored at `46c6834698c48bc4a463a86d8420f4eb1d7f3b75`, which has
`types/PoolOperation.sol`; `LaunchFactory.sol` and `PoolFees.sol` import `ModifyLiquidityParams` from
there as the verified sources do. `src/HookFlags.sol` is a copy of `HookFlags.sol` for the protected tests.

The fixture resolves OpenZeppelin through the recovered vendored tree, so its distributor creation bytes are
not claimed to equal the newer production build. `docs/network/factory-reference.json` includes the verified
production compiler inputs (including its OpenZeppelin sources), and `factory-artifacts.json` records their
compiler output. `scripts/verify_network.py` compares those outputs with the saved Sepolia runtime.
`rehearsal/Sepolia.t.sol` uses the actual factory/distributor bytecode on the recorded Sepolia fork.
