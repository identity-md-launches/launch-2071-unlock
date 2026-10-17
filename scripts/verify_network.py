#!/usr/bin/env python3
"""Check saved Sepolia bytecode against verified source build outputs, without a network.
With --rpc URL also re-read the exact recorded block. Foundry cast is the only dependency.
"""
import lzma
import json, pathlib, subprocess, sys
root=pathlib.Path(__file__).resolve().parent.parent
folder=root/'docs/network'
data=json.loads((folder/'sepolia.json').read_text())
def digest(value):
    return subprocess.check_output(['cast','keccak','0x'+value.hex()],text=True).strip()
def matches(actual, expected, slots):
    actual=bytearray(actual);expected=bytearray.fromhex(expected.removeprefix('0x'))
    if len(actual)!=len(expected):return False
    for refs in slots.values():
        values=[actual[x['start']:x['start']+x['length']] for x in refs]
        if any(x!=values[0] for x in values):return False
        for x in refs:
            i,n=x['start'],x['length'];actual[i:i+n]=expected[i:i+n]=bytes(n)
    return actual==expected
artifacts=json.loads(lzma.decompress((folder/'factory-artifacts.json.xz').read_bytes()))
for name, fact in data['contracts'].items():
    actual=bytes.fromhex((folder/(name+'.runtime.hex')).read_text().strip()[2:])
    assert digest(actual)==fact['codehash'],name+' saved bytecode hash mismatch'
    if '--rpc' in sys.argv:
        rpc=sys.argv[sys.argv.index('--rpc')+1]
        chain=subprocess.check_output(['cast','chain-id','--rpc-url',rpc],text=True).strip()
        assert chain=='11155111','Sepolia only'
        live=subprocess.check_output(['cast','code',fact['address'],'--block',str(data['blockNumber']),'--rpc-url',rpc],text=True).strip()
        assert bytes.fromhex(live[2:])==actual,name+' RPC bytecode differs'
    if name in ['factory','registry','fees']:
        contract={'factory':'LaunchFactory','registry':'LaunchRegistry','fees':'LaunchFees'}[name]
        a=artifacts[contract]['evm']['deployedBytecode']
        assert matches(actual,a['object'],a['immutableReferences']),name+' differs from verified build'
    if name=='feed':
        a=json.loads((folder/'feed-reference.json').read_text())['runtimeBytecode']
        template=bytearray.fromhex(a['recompiledBytecode'][2:])
        # Sourcify reports a metadata-only (CBOR/IPFS) difference for this verified proxy.
        # Preserve and check the complete onchain code hash, comparing executable bytes separately.
        executable=bytearray(actual)
        for item in a['cborAuxdata'].values():
            start=item['offset'];length=len(bytes.fromhex(item['value'][2:]))
            template[start:start+length]=executable[start:start+length]=bytes(length)
        assert executable==template, 'feed executable template mismatch' 
    print(name, fact['address'],fact['codehash'],'OK')
print('Manager: published Uniswap deployment, pinned runtime; compatibility exercised on the recorded fork.')
print('No claim that the manager was independently recompiled from source.')
