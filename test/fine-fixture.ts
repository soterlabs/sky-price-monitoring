import type {Snapshot,PoolEvent} from '../src/types.js';
import {cumulative} from '../src/math.js';
// Derive each five-minute midpoint from the immutable fixture's Sync ledger,
// independently integrating the cumulative price oracle up to that boundary.
export function splitSnapshots(snapshots:Snapshot[],events:PoolEvent[]):Snapshot[]{
 const result:Snapshot[]=[],q=2n**112n,mod=2n**256n;
 for(let i=0;i<snapshots.length-1;i++){
  const a=snapshots[i]!,b=snapshots[i+1]!,time=a.time+300;let sky=BigInt(a.skyRaw),usds=BigInt(a.usdsRaw),last=a.time,area=0n;
  for(const e of events.filter(e=>e.kind==='sync'&&e.time>a.time&&e.time<=time)){area+=usds*q/sky*BigInt(e.time-last);last=e.time;sky=BigInt(e.values[0]!);usds=BigInt(e.values[1]!);}
  area+=usds*q/sky*BigInt(time-last);
  result.push(a,{...a,time,block:String((BigInt(a.block)+BigInt(b.block))/2n),blockTime:time,skyRaw:String(sky),usdsRaw:String(usds),reserveTime:time,cumulativeRaw:String((cumulative(a)+area)%mod)});
 }
 result.push(snapshots.at(-1)!);return result;
}
