import {it} from 'node:test';import assert from 'node:assert/strict';
import {initialState,applyEvent,balances,distribution,holderSeries,ZERO,ENGINE,CHIEF,LSSKY,DELEGATE_FACTORY,excludedLabels,type HolderEvent} from '../src/holders.js';
import {POOL} from '../src/config.js';import type {Snapshot} from '../src/types.js';
const A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40),C='0x'+'3'.repeat(40),D='0x'+'4'.repeat(40),wad=(n:number)=>String(BigInt(n)*10n**18n);
function event(block:number,index:number,kind:HolderEvent['kind'],from:string,to:string,n:number):HolderEvent{return{block,index,kind,from,to,raw:wad(n),tx:'0x'+block};}
function snap(block:number):Snapshot{return{time:block*600,block:String(block),hash:'x',blockTime:block*600,skyRaw:'1',usdsRaw:'1',lpRaw:'1',reserveTime:0,cumulativeRaw:'0',flapper:''};}
it('attributes Lockstake and direct/delegated governance holdings without double counting',()=>{
 const s=initialState();s.delegates=[D];for(const e of [event(1,0,'liquid',ZERO,A,100),event(2,0,'liquid',A,ENGINE,40),event(2,1,'position',ZERO,A,40),event(3,0,'liquid',A,D,30),event(3,1,'liquid',D,CHIEF,30),event(3,2,'vote',ZERO,D,30),event(3,3,'delegate',D,A,30)])applyEvent(s,e);
 assert.equal(balances(s).get(A),BigInt(wad(100)));assert.equal(balances(s).size,1);
});
it('keeps sold-out whales in their original cohort, separates newcomers, classifies only verified pool sales, and does not mutate state',()=>{
 const s=initialState();applyEvent(s,event(1,0,'liquid',ZERO,A,100));applyEvent(s,event(1,1,'liquid',ZERO,B,50));
 const events=[event(2,0,'liquid',A,POOL,20),event(3,0,'liquid',B,C,10),event(4,0,'liquid',A,B,80)];events.forEach(e=>applyEvent(s,e));const before=JSON.stringify(s);
 const result=holderSeries(s,events,[snap(1),snap(2),snap(3),snap(4)],[{tx:'0x2',values:[wad(20),'0','0',wad(1)]}]);
 assert.equal(result.points[0]!.retention[0],100);assert.equal(result.points.at(-1)!.retention[0],80);assert.equal(result.points.at(-1)!.newcomerSky,10);assert.equal(result.addresses.find(a=>a.address===A)!.end,0);assert.equal(result.activity.sells,20);assert.equal(result.activity.buys,0);assert.equal(JSON.stringify(s),before);
 const withoutSwap=holderSeries(s,events,[snap(1),snap(4)],[]);assert.equal(withoutSwap.activity.sells,0);
});
it('uses exact token balance boundaries, counts and supply shares independently',()=>{
 const d=distribution(new Map([[A,BigInt(wad(9999))],[B,BigInt(wad(10000))],[C,BigInt(wad(100000000))]]));assert.deepEqual(d.counts,[1,1,0,0,0,1]);assert.equal(d.holders,3);assert.ok(Math.abs(d.shares.reduce((s,v)=>s+v,0)-100)<1e-10);assert.equal(d.top10,100);
});

it('uses valid Ethereum addresses for every pinned holder contract and label',()=>{for(const address of [ENGINE,CHIEF,LSSKY,DELEGATE_FACTORY,...Object.keys(excludedLabels)])assert.match(address,/^0x[0-9a-f]{40}$/);});
it('leaves pool donations and transfers mixed with liquidity events unclassified',()=>{
 const s=initialState();applyEvent(s,event(1,0,'liquid',ZERO,A,100));const transfers=[event(2,0,'liquid',A,POOL,30)];transfers.forEach(e=>applyEvent(s,e));
 const result=holderSeries(s,transfers,[snap(1),snap(2)],[{tx:'0x2',values:[wad(20),'0','0',wad(1)]}]);assert.equal(result.activity.sells,0);assert.equal(result.activity.otherOut,30);
});
