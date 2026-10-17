#!/usr/bin/env python3
"""Build-time commitments and release artifacts; no network, signing, or deployment.
Run forge build, then --write, then forge build, then --write, then forge build, then --check.
The second pass resolves verifier -> token commitment without weakening any protected checks.
"""
import json, pathlib, subprocess, sys
root = pathlib.Path(__file__).resolve().parents[2]
names = {'TOKEN':'UnlkToken','EVIDENCE':'MerkleClaimEvidence','ORACLE':'UnlkImdOracle',
         'VAULT':'ImdFeeVault','VERIFIER':'ImdSetupVerifier','PRICE_SOURCE':'ImdSpotUsdSource'}
def artifact(name):
    return json.loads((root/'out'/f'{name}.sol'/f'{name}.json').read_text())
def digest(code):
    return subprocess.check_output(['cast','keccak',code],text=True).strip()
s = '// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\n\n/// @notice Generated creation-code commitments; scripts/mainnet/artifacts.py.\nlibrary ImdReviewedCode {\n'
for label,name in names.items():
    s += f'    bytes32 internal constant {label} = {digest(artifact(name)["bytecode"]["object"])};\n'
s += '}\n'
s = subprocess.check_output(['forge','fmt','--raw','-'],input=s,text=True)
p = root/'src/mainnet/ImdReviewedCode.sol'
if '--write' in sys.argv:
    p.write_text(s)
else:
    assert p.read_text() == s, 'Creation commitments stale; rebuild and regenerate after review'
    output = {}
    for name in [*names.values(), 'UnlkImdHook', 'WalletExecutor']:
        a=artifact(name); creation=a['bytecode']['object']; runtime=a['deployedBytecode']['object']
        size=(len(runtime)-2)//2
        assert size <= 24576, (name,size,'EIP-170')
        constructor = next((item for item in a['abi'] if item['type'] == 'constructor'), {'inputs': []})
        count = len(constructor['inputs'])
        assert count <= 16, (name,'constructor word count')
        assert all(item['type'] in ('address','bytes32','uint128','uint64','uint256') for item in constructor['inputs']), (name,'review new constructor encoding')
        assert (len(creation)-2)//2 + 32*count <= 49152, (name,'EIP-3860 including constructor arguments')
        assert not a['bytecode'].get('linkReferences'), (name,'external libraries')
        output[name]={'creationKeccak':digest(creation),'creationBytes':(len(creation)-2)//2,
                      'runtimeTemplateKeccak':digest(runtime),'runtimeBytes':size,'constructorWords':count,
                      'initcodeBytesWithConstructor':(len(creation)-2)//2 + 32*count,
                      'immutableReferences':a['deployedBytecode'].get('immutableReferences',{})}
        folder=root/'docs/mainnet/abi';folder.mkdir(exist_ok=True)
        (folder/f'{name}.json').write_text(json.dumps(a['abi'],indent=2)+'\n')
        folder=root/'test/scratch/mainnet-artifacts';folder.mkdir(parents=True,exist_ok=True)
        (folder/f'{name}.json').write_text(json.dumps({'abi':a['abi'],'bytecode':a['bytecode'],'runtime':output[name]},indent=2)+'\n')
    (root/'docs/mainnet/ARTIFACTS.json').write_text(json.dumps(output,indent=2)+'\n')
    print('Creation commitments, link references, EIP-170/EIP-3860 sizes verified; artifacts exported.')
