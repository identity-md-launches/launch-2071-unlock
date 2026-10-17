#!/usr/bin/env python3
"""Build unsigned submit calldata. No wallet, signer, broadcast, or trusted price sampling.
One transaction is needed for EACH consecutive produced block, submitted 64..256 blocks later.
Run only after release approval. RPC data is untrusted; the contract verifies the canonical proof.
"""
import argparse,json,subprocess
from pathlib import Path
MANAGER='0x000000000004444c5dc75cb358380d2e3de08a90'
POOL='0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3'
PUBLIC_RPC='https://ethereum-rpc.publicnode.com'

def cast(*args):return subprocess.check_output(['cast',*args],text=True).strip()
def rlp(value):
    if isinstance(value,list): body=b''.join(map(rlp,value));prefix=0xc0
    else:
        body=value;prefix=0x80
        if len(body)==1 and body[0]<0x80:return body
    if len(body)<56:return bytes([prefix+len(body)])+body
    n=len(body).to_bytes((len(body).bit_length()+7)//8,'big')
    return bytes([prefix+55+len(n)])+n+body

def header_rlp(h):
    fields=['parentHash','sha3Uncles','miner','stateRoot','transactionsRoot','receiptsRoot','logsBloom','difficulty','number','gasLimit','gasUsed','timestamp','extraData','mixHash','nonce','baseFeePerGas','withdrawalsRoot','blobGasUsed','excessBlobGas','parentBeaconBlockRoot','requestsHash']
    integer={'difficulty','number','gasLimit','gasUsed','timestamp','baseFeePerGas','blobGasUsed','excessBlobGas'}
    values=[]
    for name in fields:
        if name not in h:continue
        if name in integer:
            v=int(h[name],16);values.append(v.to_bytes((v.bit_length()+7)//8,'big'))
        else:values.append(bytes.fromhex(h[name][2:]))
    encoded='0x'+rlp(values).hex()
    if cast('keccak',encoded)!=h['hash']:raise ValueError('Header fields/hash mismatch (unsupported fork or corrupt RPC)')
    return encoded

def calldata(header,proof):
    arrays=[proof['accountProof'],proof['storageProof'][0]['proof'],proof['storageProof'][1]['proof']]
    arg='('+header+','+','.join('['+','.join(a)+']' for a in arrays)+')'
    return cast('calldata','submit((bytes,bytes[],bytes[],bytes[]))',arg)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--rpc',default=PUBLIC_RPC)
    p.add_argument('--block',type=int,required=True);p.add_argument('--output',required=True)
    p.add_argument('--recorded',help='Previously captured header/proof JSON; useful when the RPC prunes old proofs')
    p.add_argument('--capture-only',action='store_true',help='Capture unconfirmed proof data now; do not produce submit calldata yet')
    args=p.parse_args()
    def rpc(method,params):
        response=json.loads(subprocess.check_output(['curl','-fsS','--max-time','60','-H','Content-Type: application/json','--data',json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}),args.rpc],text=True))
        if 'error' in response:raise RuntimeError(response['error'])
        return response['result']
    if int(rpc('eth_chainId',[]),16)!=1:raise ValueError('Ethereum mainnet required')
    head=int(rpc('eth_blockNumber',[]),16)
    minimum_age=0 if args.capture_only else 64
    if not minimum_age<=head-args.block<=256:raise ValueError('Block outside capture/confirmed proof horizon')
    slot=cast('keccak',POOL+'00'*31+'06');liquidity='0x'+(int(slot,16)+3).to_bytes(32,'big').hex()
    if args.recorded:
        recorded=json.loads(Path(args.recorded).read_text());header=recorded['header'];proof=recorded['proof']
        if int(header['number'],16)!=args.block:raise ValueError('Recorded block mismatch')
    else:
        header=rpc('eth_getBlockByNumber',[hex(args.block),False])
        proof=rpc('eth_getProof',[MANAGER,[slot,liquidity],hex(args.block)])
    encoded=header_rlp(header)
    if proof['address'].lower()!=MANAGER:raise ValueError('Wrong manager account')
    # Locate returned proofs by slot; never trust RPC ordering.
    by_slot={int(p['key'],16):p for p in proof['storageProof']}
    proof['storageProof']=[by_slot[int(slot,16)],by_slot[int(liquidity,16)]]
    data=None if args.capture_only else calldata(encoded,proof)
    output={'source':PUBLIC_RPC,'block':args.block,'blockHash':header['hash'],'sourceContract':'Use the actual reviewed stagedPriceSource address; no placeholder supplied','unsigned':True,'phase':'capture-only' if args.capture_only else 'confirmed-calldata','value':'0','data':data,'header':header,'proof':proof}
    Path(args.output).write_text(json.dumps(output,indent=2)+'\n')
    print('Proof capture or unsigned calldata written; no transaction sent. Verify phase, next required block and release gates before use.')
if __name__=='__main__':main()
