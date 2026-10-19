import { readFileSync } from 'node:fs';
import { EDITORIAL_IDENTITIES } from './identities.mjs';
import { assert, address } from './security.mjs';
/** Operator settings, outside the static export. No keys are accepted or required. */
export function marketConfig(filename=process.env.LABS_MARKET_CONFIG||new URL('./production-config.json',import.meta.url)) {
 if(!filename)return {simulationPlans:{},extraLaunchIds:[],poolStartBlocks:{},attributions:[],marketplaces:[],indexStartBlock:null};
 const c=JSON.parse(readFileSync(filename,'utf8'));assert(c&&typeof c==='object',500,'config_invalid','Market configuration must be a JSON object.');
 const extraLaunchIds=c.extraLaunchIds||[];assert(Array.isArray(extraLaunchIds)&&extraLaunchIds.length<=30&&extraLaunchIds.every(x=>/^[a-f0-9-]{36}$/i.test(x)),500,'config_invalid','Use up to 30 authoritative IMD launch IDs.');
 const editorialSelections=c.editorialSelections||{};assert(editorialSelections&&typeof editorialSelections==='object'&&!Array.isArray(editorialSelections)&&Object.entries(editorialSelections).every(([symbol,token])=>EDITORIAL_IDENTITIES.records.some(r=>r.chainId===1&&r.symbol===symbol&&r.address===address(token))),500,'config_invalid','Editorial selections must name an exact chain/address from the evidenced identity records. Ambiguous symbols default to no badge.');
 for(const symbol of Object.keys(editorialSelections))editorialSelections[symbol]=address(editorialSelections[symbol]);
 const simulationPlans=Object.fromEntries(Object.entries(c.simulationPlans||{}).map(([token,p])=>{assert(p&&typeof p==='object',500,'config_invalid','Invalid simulation plan.');return [address(token),{account:address(p.account),amountRaw:p.amountRaw,minimumQuoteRaw:p.minimumQuoteRaw}];}));
 const poolStartBlocks=c.poolStartBlocks||{};assert(Object.entries(poolStartBlocks).every(([id,n])=>/^0x[\da-f]{64}$/i.test(id)&&Number.isSafeInteger(n)&&n>0),500,'config_invalid','Pool start blocks must name exact PoolIds and evidenced Initialize blocks.');
 const attributions=c.attributions||[];assert(Array.isArray(attributions)&&attributions.length<=20,500,'config_invalid','At most 20 public attribution records.');
 for(const a of attributions)assert(['Vitalik','CZ','Asem'].includes(a.label)&&address(a.address)&&typeof a.sourceUrl==='string'&&a.sourceUrl.startsWith('https://')&&typeof a.evidence==='string'&&a.evidence.length>=30&&a.custody==='personal'&&a.reviewed===true,500,'config_invalid','Public labels require a reviewed reliable attribution link, explicit personal-wallet evidence and an exact address; exchange custody is never personal.');
 const marketplaces=c.marketplaces||[];assert(Array.isArray(marketplaces)&&marketplaces.length<=4&&marketplaces.every(m=>address(m.address)&&/^0x[\da-f]{64}$/i.test(m.runtimeCodeHash)&&typeof m.sourceUrl==='string'&&m.sourceUrl.startsWith('https://')),500,'config_invalid','NFT venues need exact addresses, verified runtime hashes and authoritative source links.');
 const indexStartBlock=c.indexStartBlock??null;assert(indexStartBlock===null||(Number.isSafeInteger(indexStartBlock)&&indexStartBlock>0),500,"config_invalid","Use a verified positive start block for full history backfill, or null for the recent bounded scan.");
 return {simulationPlans,extraLaunchIds,poolStartBlocks,attributions,marketplaces,indexStartBlock,editorialSelections};
}
