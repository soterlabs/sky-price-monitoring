import assert from 'node:assert/strict';
import {it} from 'node:test';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {makePoints,combine,intervalPoints,dailyPoints,summarize,depth,cumulative,swapSide} from '../src/math.js';
import {splitSnapshots} from './fine-fixture.js';
import type {Snapshot,PoolEvent,Point} from '../src/types.js';
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/study-24h.json.gz',import.meta.url))).toString()) as {snapshots:Snapshot[];events:PoolEvent[];expected:Record<string,any>};
const {snapshots,events,expected}=fixture;
it('reproduces the independent 24h onchain study and exact buyback amounts',()=>{
  const points=makePoints(snapshots,events),s=summarize(points)!;
  assert.equal(points.length,144);
  assert.equal(s.buyCount+s.sellCount,1165);assert.equal(s.buybackCount,138);
  assert.equal(s.buybackUsds,751906.8);
  assert.ok(Math.abs(s.buyUsds-Number(expected.flow.buyUsds))<1e-8);
  assert.ok(Math.abs(s.sellUsds-Number(expected.flow.sellUsds))<1e-8);
  assert.ok(Math.abs(s.twap-expected.price.twap24h)<1e-14);
  assert.ok(Math.abs(s.changePercent-expected.price.changePercent)<1e-10);
  assert.ok(Math.abs(s.maxDrawdownPercent-expected.price.maxDrawdown10minPercent)<1e-10);
});
it('rejects missing or altered events rather than persisting partial flow totals',()=>{
  const firstSwap=events.find(e=>e.kind==='swap')!;
  assert.throws(()=>makePoints(snapshots,events.filter(e=>e!==firstSwap)),/ledger/);
  const bad=events.map(e=>e===firstSwap?{...e,values:e.values.map((v,i)=>i===1?String(BigInt(v)+1n):v)}:e);
  assert.throws(()=>makePoints(snapshots,bad),/ledger|Complex/);
  const firstSync=events.find(e=>e.kind==='sync')!;
  assert.throws(()=>makePoints(snapshots,events.filter(e=>e!==firstSync)),/Sync|TWAP|reconcile/);
});
it('preserves a valid reserve price with zero volume and no invented buy ratio',()=>{
  const a:Snapshot={...snapshots[0]!,time:600,reserveTime:600,cumulativeRaw:'0'};
  const b:Snapshot={...a,time:1200,block:'2'};
  const p=makePoints([a,b],[]);const s=summarize(p)!;
  assert.equal(p.length,1);assert.equal(s.volumeUsds,0);assert.equal(s.buySharePercent,null);assert.equal(s.buybackSharePercent,null);assert.ok(Math.abs(s.twap-s.close)<1e-14);
});
it('daily rollups preserve summed volume and duration-weighted TWAP',()=>{
  const points=makePoints(snapshots,events),days=dailyPoints(points),a=combine(points)!,b=combine(days)!;
  for(const k of ['buyRaw','sellRaw','buybackRaw','skyBuybackRaw','buyCount','sellCount','duration']as const)assert.equal(a[k],b[k]);
  assert.ok(Math.abs(a.twap-b.twap)<1e-14);
  assert.equal(days.length,2);assert.equal(days[0]!.complete,false);assert.equal(days[1]!.complete,false);
});
it('marks missing intervals as incomplete and never fabricates their volume',()=>{
  const p=makePoints(snapshots,events),missing=p.filter((_,i)=>i!==10),c=combine(missing)!;
  assert.equal(c.complete,false);assert.equal(c.duration,86400-600);
  assert.equal(BigInt(c.buyRaw),BigInt(combine(p)!.buyRaw)-BigInt(p[10]!.buyRaw));
});
it('uses asymmetric buy/sell execution quotes with the V2 fee included',()=>{
  const p=makePoints(snapshots,events).at(-1)!;const d=depth(p);
  assert.ok(Math.abs(d.quote10k.buyPercent-0.5823529897483)<1e-10);
  assert.ok(Math.abs(d.quote100k.sellPercent-3.02128038824184)<1e-10);
  assert.ok(Math.abs(d.buyDepth1Percent-24839.10436479)<1e-6);
  assert.ok(d.quote100k.buyPercent>d.quote10k.buyPercent);
});
it('handles cumulative oracle wraparound',()=>{
  const a={...snapshots[0]!,time:600,reserveTime:600,cumulativeRaw:String(2n**256n-1n)};
  const b={...a,time:1200};
  assert.ok(cumulative(b)<cumulative(a));
  assert.ok(Math.abs(makePoints([a,b],[])[0]!.twap-Number(a.usdsRaw)/Number(a.skyRaw))<1e-14);
});
it('does not mistake same-asset flash repayments for buying or selling',()=>{
  // Actual SKY flash-swap deltas, tx 0xd4c9559e...415e048, 2026-11-19.
  assert.equal(swapSide(['6128856919614922820','0','6110470348856078051','0']),'flash');
  assert.equal(swapSide(['0','1003000000000000000','0','1000000000000000000']),'flash');
  assert.equal(swapSide(['20','10','30','0']),'buy');
  assert.equal(swapSide(['30','0','20','10']),'sell');
});

it('five-minute ledger intervals preserve exact ten-minute volume, prices, TWAP and volatility',()=>{
 const fine=makePoints(splitSnapshots(snapshots,events),events,300),coarse=makePoints(snapshots,events),rolled=intervalPoints(fine);
 assert.equal(fine.length,288);assert.equal(rolled.length,144);
 for(let i=0;i<coarse.length;i++){const a=coarse[i]!,b=rolled[i]!;
  for(const key of ['from','through','duration','open','close','high','low','buyRaw','sellRaw','buybackRaw','skyBoughtRaw','skySoldRaw','buyCount','sellCount','buybackCount','skyRaw','usdsRaw']as const)assert.equal(b[key],a[key],key);
  assert.equal(b.complete,true);assert.ok(Math.abs(b.twap-a.twap)<1e-14);
 }
 const a=summarize(coarse)!,b=summarize(rolled)!;assert.equal(a.volumeUsds,b.volumeUsds);assert.equal(a.realizedVolatilityPercent,b.realizedVolatilityPercent);
 assert.equal(intervalPoints(fine.slice(1))[0]!.complete,false,'a missing five-minute half must remain incomplete');
 assert.throws(()=>makePoints(splitSnapshots(snapshots,events).filter((_,i)=>i!==1),events,300),/Non-consecutive/);
});
