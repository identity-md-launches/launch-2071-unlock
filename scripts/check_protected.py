#!/usr/bin/env python3
"""Run the unmodified supplied admission checks with isolated manifest-derived probe environment.
Usage: scripts/check_protected.py [directory containing Hook.protected.t.sol and Token.protected.t.sol]
The supplied checks intentionally use vm.env*; production tests do not. Copies live only in test/scratch.
"""
import hashlib, json, os, pathlib, shutil, subprocess, sys
root=pathlib.Path(__file__).resolve().parent.parent
inputs=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else root/'.imd/reads/protected/univ4_hook')
# Rebuild production artifacts first: the creation code supplied to the floor must be this source.
subprocess.run(['forge','build','--skip','test','--skip','script'],cwd=root,check=True)
target=root/'test/scratch/protected'
target.mkdir(parents=True,exist_ok=True)
for name in ['Hook.protected.t.sol','Token.protected.t.sol']:
    shutil.copyfile(inputs/name,target/name)
    assert (inputs/name).read_bytes() == (target/name).read_bytes()
    print(name, "unmodified SHA-256", hashlib.sha256((inputs/name).read_bytes()).hexdigest(), flush=True)
manifest=json.loads((root/'launch.json').read_text())
# Test-only probes, never deployment inputs. Derived from descriptive labels to avoid legacy launch identities.
def addr(label):
    return '0x'+subprocess.check_output(['cast','keccak',label],text=True).strip()[-40:]
manager=addr('UNLK protected manager');token=addr('UNLK protected token')
factory=addr('UNLK protected factory');owner=addr('UNLK protected owner')
def bytecode(c):
    return json.loads((root/'out'/f'{c}.sol'/f'{c}.json').read_text())['bytecode']['object']
args=subprocess.check_output(['cast','abi-encode','f(address,address,address,address)',manager,token,factory,owner],text=True).strip()
env=os.environ.copy()
permissions = ['beforeInitialize', 'afterInitialize', 'beforeAddLiquidity', 'afterAddLiquidity',
    'beforeRemoveLiquidity', 'afterRemoveLiquidity', 'beforeSwap', 'afterSwap', 'beforeDonate',
    'afterDonate', 'beforeSwapReturnDelta', 'afterSwapReturnDelta',
    'afterAddLiquidityReturnDelta', 'afterRemoveLiquidityReturnDelta']
flags = sum(1 << (13 - permissions.index(p)) for p in set(manifest['hook']['permissions']))
env.update(IMD_PROJECT_CHAIN_ID="1", IMD_EXPECTED_SUPPLY=str(10**27), IMD_TOKEN_DECIMALS=str(manifest["token"]["decimals"]), IMD_HOOK_CREATION_CODE=bytecode(manifest['hook']['contract'])+args[2:],IMD_HOOK_FLAGS=str(flags),
    IMD_POOL_MANAGER=manager,IMD_TOKEN_PROBE=token,IMD_TOKEN_CREATION_CODE=bytecode(manifest['token']['contract']),
    IMD_FACTORY_PROBE=factory,IMD_PAIRED_CURRENCY=manifest['pool']['pairedCurrency'],IMD_POOL_FEE=str(manifest['pool']['fee']),
    IMD_TICK_SPACING=str(manifest['pool']['tickSpacing']),IMD_SQRT_PRICE=manifest['pool']['initialPrice'])
print('Local execution of supplied Hook and Token checks; not official platform admission.', flush=True)
print('Owners.protected.t.sol is not executed: its platform OwnerChecks.sol and Swapper.sol helpers are not supplied.', flush=True)
print('Resolved local test probes:', json.dumps({'manager':manager,'token':token,'factory':factory,'owner':owner,'chainId':1,'flags':hex(flags)}), flush=True)
print('Creation code keccak:', subprocess.check_output(['cast','keccak',env['IMD_HOOK_CREATION_CODE']],text=True).strip(), flush=True)
try:
    result=subprocess.run(['forge','test','--match-path','test/scratch/protected/*.sol','-vv'],cwd=root,env=env)
finally:
    shutil.rmtree(target)
sys.exit(result.returncode)
