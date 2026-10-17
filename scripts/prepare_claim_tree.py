#!/usr/bin/env python3
"""Convert IMD's frozen claims JSON to certifyRound arrays. Requires Foundry cast, no network.
Usage: python3 scripts/prepare_claim_tree.py launch-with-claims.json
Outputs JSON with accounts/amounts in OpenZeppelin StandardMerkleTree heap leaf order.
"""
import json, subprocess, sys

def keccak(value):
    return bytes.fromhex(subprocess.check_output(['cast','keccak','0x'+value.hex()],text=True).strip()[2:])

def prepare(claims):
    rows=[]
    seen=set()
    for leaf in claims['leaves']:
        account=leaf['wallet'].lower()
        address=bytes.fromhex(account.removeprefix('0x'))
        amount=int(leaf['amount'])
        if len(address)!=20 or int.from_bytes(address)==0 or account in seen or not 0<=amount<2**256:
            raise ValueError('invalid or duplicate recipient/amount')
        seen.add(account)
        h=keccak(keccak(address.rjust(32,b'\0')+amount.to_bytes(32)))
        rows.append((h,account,amount))
    if not 1<=len(rows)<=1024:
        raise ValueError('certification supports 1..1024 unique leaves per round')
    rows.sort(reverse=True)
    tree=[b'']*(len(rows)-1)+[r[0] for r in rows]
    for i in range(len(rows)-2,-1,-1):
        a,b=sorted(tree[2*i+1:2*i+3])
        tree[i]=keccak(a+b)
    root='0x'+tree[0].hex()
    if root.lower()!=claims['root'].lower():
        raise ValueError('the complete unique tree does not reproduce the frozen root')
    return dict(root=root,accounts=[r[1] for r in rows],amounts=[str(r[2]) for r in rows])

if __name__=='__main__':
    source=json.load(open(sys.argv[1]))
    print(json.dumps(prepare(source.get('claims',source)),indent=2))
