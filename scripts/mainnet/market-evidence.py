#!/usr/bin/env python3
"""Read-only mainnet venue discovery. Never submits transactions or treats logs as on-chain oracle proof."""
import argparse, json, subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--rpc',default='https://ethereum-rpc.publicnode.com');a=p.parse_args()
def rpc(method,params):
 raw=subprocess.check_output(['curl','-fsS','--max-time','90','-H','Content-Type: application/json','--data',json.dumps(dict(jsonrpc='2.0',id=1,method=method,params=params)),a.rpc],text=True)
 r=json.loads(raw)
 if 'error' in r: raise RuntimeError(r['error'])
 return r['result']
def cast(*args):return subprocess.check_output(['cast',*args],text=True).strip()
manager='0x000000000004444c5dc75cb358380d2e3de08a90';imd='0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7';pid='0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3'
block=rpc('eth_blockNumber',[]);head=rpc('eth_getBlockByNumber',[block,False]);out={'source':'https://ethereum-rpc.publicnode.com','block':int(block,16),'header':head}
slot=cast('keccak',pid+'00'*31+'06');liq='0x'+(int(slot,16)+3).to_bytes(32,'big').hex()
out['slots']=[slot,liq]
out['storage']=[rpc('eth_getStorageAt',[manager,x,block]) for x in [slot,liq]]
out['proof']=rpc('eth_getProof',[manager,[slot,liq],block])
target=1785353567;lo=24000000;hi=int(block,16)
while lo<hi:
 mid=(lo+hi)//2
 h=rpc('eth_getBlockByNumber',[hex(mid),False])
 if int(h['timestamp'],16)<target:lo=mid+1
 else:hi=mid
sig=cast('keccak','Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)')
out['initialize']=rpc('eth_getLogs',[dict(address=manager,fromBlock=hex(lo-20),toBlock=hex(lo+20),topics=[sig,pid])])
# Record actual metadata and alternatives, including absence and unavailable history.
def call(addr,sig,**kwargs):
 data=cast('calldata',sig,*kwargs.get('args',[]))
 try:return rpc('eth_call',[dict(to=addr,data=data),block])
 except RuntimeError as e:return {'error':str(e)}
out['metadata']={s:call(imd,s) for s in ['name()','symbol()','decimals()','totalSupply()']}
out['v3']={}
for addr in ['0xd6a822d028bbf7b6edfa1533e110ee40c08551d9','0x894d4e6d3d2abc64fc0de0e4e2ea63a93bc9c520','0xf0262866f9e0588f67d1a7936726fab0a75bb1a6']:
 out['v3'][addr]={s:call(addr,s) for s in ['factory()','token0()','token1()','fee()','liquidity()','slot0()']}
 out['v3'][addr]['observe']=call(addr,'observe(uint32[])',args=['[86400,7200,0]'])
out['feed']={s:call('0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',s) for s in ['latestRoundData()','decimals()','aggregator()']}
f=Path('docs/mainnet/revision/market-evidence.json');f.write_text(json.dumps(out,indent=2)+'\n')
print('Saved',f,'at block',int(block,16),'initialization block',lo,'storage',out['storage'],'init',out['initialize'])
