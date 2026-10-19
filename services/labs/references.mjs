import { parseAbi } from '../../web/vendor/runtime/c5e656ecf7fbe34e412c.mjs';
const ETH_USD='0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419',VIEW='0x7ffe42c4a5deea5b0fec41c94c136cf115597227';
const IMD='0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7',NATIVE='0x0000000000000000000000000000000000000000',POOL='0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3';
const FEED=parseAbi(['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)','function decimals() view returns (uint8)']);
const STATE=parseAbi(['function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)','function getLiquidity(bytes32) view returns (uint128)']);
export function historicalReferences(io,store) {
 let used=0;return {reset(){used=0;},async at(block,timestamp){const key=`usd-reference:${block}`,old=store.get(key);if(old)return old;if(++used>24)throw Error('Historical USD reference quota reached');const tag='0x'+BigInt(block).toString(16);const [r,d,s,l]=await Promise.all([io.read(ETH_USD,FEED,'latestRoundData',[],tag),io.read(ETH_USD,FEED,'decimals',[],tag),io.read(VIEW,STATE,'getSlot0',[POOL],tag),io.read(VIEW,STATE,'getLiquidity',[POOL],tag)]);if(d!==8||r[0]===0n||r[1]<=0n||r[4]<r[0]||r[3]>BigInt(timestamp)||BigInt(timestamp)-r[3]>5400n||s[0]<=0n||s[3]!==10000||l<=0n)throw Error('Historical USD reference failed freshness/active pool checks');const eth=Number(r[1])/1e8,imd=eth/(Number(s[0])/2**96)**2;const result={[NATIVE]:eth,[IMD]:imd};store.set(key,result);return result;}};
}
