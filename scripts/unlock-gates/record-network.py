#!/usr/bin/env python3
"""Read-only, one-block mainnet preflight. No signing, accounts, environment or host configuration.
All target identities come from the accepted project's network record and are checked against runtime pins.
Usage: python3 scripts/unlock-gates/record-network.py [public-RPC-URL] [block-number]
"""
import concurrent.futures, datetime, json, pathlib, subprocess, sys, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/unlock-gates/network'
RPC = sys.argv[1] if len(sys.argv) > 1 else 'https://ethereum-rpc.publicnode.com'

def rpc(method, params):
    # cast uses the same public RPC transport as the fork runner; arguments are structured, no shell.
    raw = subprocess.check_output(['cast', 'rpc', '--rpc-url', RPC, method, *[json.dumps(x, separators=(',', ':')) for x in params]], text=True)
    return json.loads(raw)

def cast(*args):
    return subprocess.check_output(['cast', *map(str, args)], text=True).strip()

def http_json(path):
    with urllib.request.urlopen('https://api.imd.fun'+path, timeout=30) as r:
        data = r.read()
    (OUT / (path.rsplit('/', 1)[-1]+'.json')).write_bytes(data)
    return json.loads(data)

OUT.mkdir(parents=True, exist_ok=True)
assert int(rpc('eth_chainId', []), 16) == 1
block = hex(int(sys.argv[2])) if len(sys.argv) > 2 else rpc('eth_blockNumber', [])
header = rpc('eth_getBlockByNumber', [block, False])
assert header and int(header['number'],16) == int(block,16)
record = {'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'rpc': RPC,
          'chainId': 1, 'block': int(block,16), 'blockHash': header['hash'],
          'blockTimestamp': int(header['timestamp'],16), 'contracts': {}, 'calls': {}}
base = json.loads((ROOT / 'docs/mainnet/network/mainnet.json').read_text())['contracts']

def runtime(item):
    name, expected = item
    code = rpc('eth_getCode', [expected['address'], block])
    digest = cast('keccak', code)
    return name, {**expected, 'bytes': (len(code)-2)//2, 'codehash': digest, 'matchesAcceptedPin': digest == expected['codehash']}

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    record['contracts'] = dict(executor.map(runtime, [(n, d) for n, d in base.items() if n != 'deployer']))

calls = [('factory', 'poolManager()(address)'), ('factory','fees()(address)'), ('factory','registry()(address)'),
         ('factory','deployer()(address)'), ('registry','writer()(address)'), ('imd','name()(string)'),
         ('imd','symbol()(string)'), ('imd','decimals()(uint8)'), ('imd','totalSupply()(uint256)'),
         ('fees','poolFee()(uint24)'), ('fees','REQUESTER_BPS()(uint16)'), ('fees','feeRecipient()(address)'),
         ('fees','treasury()(address)'), ('ethUsd','decimals()(uint8)'),
         ('ethUsd','latestRoundData()(uint80,int256,uint256,uint256,uint80)')]

def call(item):
    role, signature = item
    data = cast('sig', signature.split(')')[0]+')')
    raw = rpc('eth_call', [{'to': base[role]['address'], 'data': data}, block])
    decoded = cast('abi-decode', signature, raw)
    return role+'.'+signature, {'raw': raw, 'decoded': decoded}

with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    record['calls'] = dict(executor.map(call, calls))

c = record['calls']
for getter, role in [('poolManager', 'manager'), ('fees', 'fees'), ('registry', 'registry')]:
    assert c[f'factory.{getter}()(address)']['decoded'].lower() == base[role]['address'].lower()
assert c['registry.writer()(address)']['decoded'].lower() == base['factory']['address'].lower()
assert c['imd.symbol()(string)']['decoded'] == '"IMD"'
assert c['imd.decimals()(uint8)']['decoded'] == '18'
assert c['fees.poolFee()(uint24)']['decoded'].split()[0] == '12500'
assert c['fees.REQUESTER_BPS()(uint16)']['decoded'] == '8000'

imd = base['imd']['address']
key = cast('abi-encode','f(address,address,uint24,int24,address)', '0x'+'00'*20, imd, 10000, 200, '0x'+'00'*20)
pool = cast('keccak', key)
assert pool == '0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3'
slot = cast('keccak', cast('abi-encode','f(bytes32,uint256)',pool,6))
word = rpc('eth_getStorageAt', [base['manager']['address'], slot, block])
liquidity = rpc('eth_getStorageAt', [base['manager']['address'], hex(int(slot,16)+3), block])
x = int(word,16); tick = (x >> 160) & 0xffffff; tick = tick-(1<<24) if tick & (1<<23) else tick
sqrt = x & ((1<<160)-1)
feed_raw = bytes.fromhex(c['ethUsd.latestRoundData()(uint80,int256,uint256,uint256,uint80)']['raw'][2:])
words = [int.from_bytes(feed_raw[i:i+32], 'big') for i in range(0,len(feed_raw),32)]
round_id, answer, started, updated, answered = words
if answer & (1 << 255):
    answer -= 1 << 256
assert c['ethUsd.decimals()(uint8)']['decoded'] == '8'
assert round_id > 0 and 0 < answer <= 1_000_000 * 10**8 and 0 < started <= updated <= record['blockTimestamp']
assert answered >= round_id and record['blockTimestamp'] - updated <= 5400
record['chainlinkValidation'] = {'round':str(round_id),'answer8':str(answer),'startedAt':started,'updatedAt':updated,
    'ageSeconds':record['blockTimestamp']-updated,'answeredInRound':str(answered),'validAtRecordedBlock':True}
record['externalReferencePool'] = {'poolId':pool,'slot':slot,'slot0Word':word,'sqrtPriceX96':str(sqrt),
    'tick':tick,'protocolFee':(x>>184)&0xffffff,'lpFee':(x>>208)&0xffffff,'liquidity':str(int(liquidity,16)),
    'virtualEthWei':str(int(liquidity,16)*(1<<96)//sqrt) if sqrt else None,
    'note':'one actual recorded state, not observation history or a warm production source'}
cap = http_json('/requests/capabilities')
policies = http_json('/launch/policies')
http_json('/services')
chain = next(x for x in cap['launches']['chains'] if x['chainId'] == 1)
assert 'univ4_hook' in chain['kinds']
pairing = next(x for x in chain['pairings'] if x['pairWith'] == 'imd')
assert 'univ4_hook' in pairing['kinds'] and pairing['currency'].lower() == imd.lower() and pairing['decimals'] == 18
policy = max((p for p in policies['policies'] if p['kind'] == 'univ4_hook' and p['params'].get('chainId') == 1 and imd.lower() in p['params'].get('pairedCurrencyAllowlist',[])),key=lambda p:p['version'])
assert 12500 in policy['params']['feeTiers'] and policy['params']['totalSupply'] == str(10**27)
record['platform'] = {'advertisesMainnetImdHooks':True,'selectedPolicyVersion':policy['version'],'pairing':pairing,
    'note':'support advertisement + runtime/getter verification, not admission of this unpublished candidate'}
record['allRuntimePinsMatch'] = all(d['matchesAcceptedPin'] for d in record['contracts'].values())
(OUT/'preflight.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'block':record['block'],'blockHash':record['blockHash'],'allRuntimePinsMatch':record['allRuntimePinsMatch'],
                  'policy':policy['version'],'referencePool':record['externalReferencePool']},indent=2))
assert record['allRuntimePinsMatch'], 'mainnet runtime changed: release blocked; inspect preflight.json'
