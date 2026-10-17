#!/usr/bin/env python3
"""Encode recorded RPC header/proofs as ordinary Solidity test data, verifying the header hash."""
import json,subprocess
from pathlib import Path
r=json.loads(Path('docs/mainnet/revision/market-evidence.json').read_text());h=r['header']
def enc(x):
 if isinstance(x,list):
  b=b''.join(map(enc,x));off=0xc0
 else:
  b=x;off=0x80
  if len(b)==1 and b[0]<0x80:return b
 if len(b)<56:return bytes([off+len(b)])+b
 n=len(b).to_bytes((len(b).bit_length()+7)//8,'big');return bytes([off+55+len(n)])+n+b
keys=['parentHash','sha3Uncles','miner','stateRoot','transactionsRoot','receiptsRoot','logsBloom','difficulty','number','gasLimit','gasUsed','timestamp','extraData','mixHash','nonce','baseFeePerGas','withdrawalsRoot','blobGasUsed','excessBlobGas','parentBeaconBlockRoot','requestsHash']
ints={'difficulty','number','gasLimit','gasUsed','timestamp','baseFeePerGas','blobGasUsed','excessBlobGas'}
fields=[]
for k in keys:
 if k not in h:continue
 x=h[k]
 if k in ints:
  i=int(x,16);fields.append(i.to_bytes((i.bit_length()+7)//8,'big'))
 else:fields.append(bytes.fromhex(x[2:]))
header=enc(fields).hex();digest=subprocess.check_output(['cast','keccak','0x'+header],text=True).strip()
assert digest==h['hash'],(digest,h['hash'],list(h))
s='// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\nimport {BlockState} from "../../src/mainnet/BlockState.sol";\n// Actual recorded header and eth_getProof; blockhash anchoring is separately tested on a fork.\nlibrary V4StateEvidence {\n'
s+=f'uint256 internal constant BLOCK = {int(h["number"],16)};\nuint256 internal constant TIME = {int(h["timestamp"],16)};\nbytes32 internal constant HASH = {digest};\n'
s+='function proof() internal pure returns (BlockState.Proof memory p) {\n'
s+=f'p.header=hex"{header}";\n'
for name,arr in [('account',r['proof']['accountProof']),('slot0',r['proof']['storageProof'][0]['proof']),('liquidity',r['proof']['storageProof'][1]['proof'])]:
 s+=f'p.{name}=new bytes[]({len(arr)});\n'
 for i,x in enumerate(arr):s+=f'p.{name}[{i}]=hex"{x[2:]}";\n'
s+='}\n}\n';Path('test/mainnet/V4StateEvidence.sol').write_text(s)
print('Verified recorded header hash',digest,'block',r['block'],'proof fixture bytes',len(s))
