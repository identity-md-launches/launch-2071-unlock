# Successor release and hosting: separate, later authorizations

**This job deploys nothing and publishes nothing.** These steps are for a later, separately authorized
Sepolia release, after independent review of this exact source finds no unresolved critical/high issues.
The existing token, launch 1560/1534 contracts and live website stay as they are. The successor is a **new
launch**: new token prediction, new hook, new pool. The existing UNLK token is never redeployed, replaced or
re-minted. Nothing here creates a different token for the existing launch.

## Contract release (Sepolia)

1. **Freeze and review.** Run the checks in [VALIDATION.md](VALIDATION.md). Give the independent reviewer the
   commit containing `src/successor/`, `test/successor/`, `rehearsal/successor/`, `script/successor/`,
   `scripts/successor/` and these docs. Critical/high findings block release.
2. **Re-verify the route** right before launch:
   `cast keccak $(cast code 0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b --rpc-url <sepolia>)` must equal
   `0x14f7c9253a5406bafa90cb512f4a2db2a10513886603e7a9b4a2e72329e944f4`, and the Quoter `0x61b3…9227` must
   equal `0xf481…47d1`. If either differs, the hook cannot trade. Stop and re-review; do not edit the
   constants without a new review. Also re-check the Explorer bundle still encodes `0x10` / `0x060c0f` with
   empty hookData.
3. **Stage 1 (IMD launch).** The IMD factory deploys `UnlkHookV3` with the four constructor words
   `(PoolManager, new token, factory, setupAuthority = launch owner)`, plus hook flags **`0x3fcc`**. Mine the
   salt offline with `node scripts/successor/mine.mjs FACTORY POOL_MANAGER NEW_TOKEN SETUP_AUTHORITY`. All four
   inputs are real launch values; the script refuses zero or duplicate inputs. The launch manifest
   (`launch.json`) is written by the IMD manifest step after acceptance. This delivery does not write one.
4. **Stage 2 (owner).** Use `script/successor/PrepareSuccessor.s.sol` (pure calldata, no broadcast). Owner
   signs `deployCompanions(number, feed=0x694AA1769357215DE4FAC081bf1f309aDC325306, [evidence, oracle, vault,
   verifier])`, then the round-0 tree is certified on the staged evidence contract, then the owner signs
   `configureAndActivate(evidence, oracle, number)`. After that, setup is sealed.
5. **Post-activation checks.** Verify `UNIVERSAL_ROUTER()`, `FLAGS() == 0x3fcc`, `FEE() == 12500`, the vault's
   `BENEFICIARY()`, PoolManager protocol fee 0, and an Explorer buy and sell of small size.

## After launch

There are **no owner settings**. Every external value is a constant, or a constructor word checked at
activation: router, Quoter, feed, beneficiary, fee, tiers. Ongoing permissionless operations: oracle
checkpoints and `updateMilestone` (4-minute cadence, 10-minute maximum gap), `syncPayer`, `syncRewards`,
`vault.redeem()`. The beneficiary alone calls `vault.withdraw()` / `withdrawDonations()` and decides any NFT
purchase manually, off chain.

## Website hosting (separate approval)

1. Fill `CANDIDATE_DEPLOYMENT` in `web/src/candidate.ts` with the **actual** token, hook and vault addresses
   and their **deployed** runtime hashes (not artifact templates). The reader refuses mismatches and also
   checks the Universal Router hash.
2. `node web/scripts/typecheck-offline.mjs && node web/scripts/build-offline.mjs && node web/scripts/build-offline.mjs --test && (cd web && node --test ../test/scratch/frontend/*.test.mjs)`.
3. Host `dist-candidate/` only after review of the built bundle. The live `dist/` and its config are
   preserved unchanged by this delivery. The IMD Explorer needs no change: its existing payloads are the
   supported route.
