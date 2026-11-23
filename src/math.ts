import {formatUnits} from 'viem';
import type {Snapshot, PoolEvent, Point} from './types.js';
const Q = 2n**112n, MOD = 2n**256n;
export const units = (v: string|bigint) => Number(formatUnits(BigInt(v),18));
export const spot = (s: Pick<Snapshot,'skyRaw'|'usdsRaw'>) => Number(s.usdsRaw)/Number(s.skyRaw);
export function swapSide(values:string[]):'buy'|'sell'|'flash' {
  const [sIn,uIn,sOut,uOut]=values.map(BigInt) as [bigint,bigint,bigint,bigint];
  const ds=sIn-sOut,du=uIn-uOut;
  if(ds<0n&&du>0n)return 'buy';
  if(ds>0n&&du<0n)return 'sell';
  if(ds>=0n&&du>=0n)return 'flash';
  throw new Error('Unsupported swap token deltas');
}
export function cumulative(s: Snapshot): bigint {
  const elapsed = BigInt((s.time-s.reserveTime+2**32)%2**32);
  return (BigInt(s.cumulativeRaw)+BigInt(s.usdsRaw)*Q/BigInt(s.skyRaw)*elapsed)%MOD;
}
export function makePoints(snapshots: Snapshot[], events: PoolEvent[], interval:300|600=600): Point[] {
  const points: Point[]=[];
  const ordered=[...events].sort((a,b)=>Number(BigInt(a.block)-BigInt(b.block))||a.index-b.index);
  let cursor=0;
  for (let i=1;i<snapshots.length;i++) {
    const a=snapshots[i-1]!,b=snapshots[i]!;
    if (b.time-a.time!==interval) throw new Error('Non-consecutive snapshot boundaries');
    let sky=BigInt(a.skyRaw),usds=BigInt(a.usdsRaw),buy=0n,sell=0n,buyback=0n,skyBought=0n,skySold=0n,skyBuyback=0n;
    let ds=0n,du=0n,lpSky=0n,lpUsds=0n,area=0n,last=a.time;
    let buyCount=0,sellCount=0,buybackCount=0,flashCount=0,flashSky=0n,flashUsds=0n,high=spot(a),low=high;
    let previous:PoolEvent|undefined;
    while(cursor<ordered.length && ordered[cursor]!.time<=a.time) cursor++;
    while(cursor<ordered.length && ordered[cursor]!.time<=b.time) {
      const e=ordered[cursor++]!,v=e.values.map(BigInt);
      if (e.kind==='sync') {
        area+=usds*Q/sky*BigInt(e.time-last); last=e.time;
        [sky,usds]=[v[0]!,v[1]!];
        if (sky<=0n||usds<=0n) throw new Error('Pool has zero reserves');
        const p=Number(usds)/Number(sky);high=Math.max(high,p);low=Math.min(low,p);
      } else {
        if (previous?.kind!=='sync'||previous.block!==e.block||previous.tx!==e.tx) throw new Error('Pool operation missing its Sync event');
        if (e.kind==='swap') {
          const [sIn,uIn,sOut,uOut]=v as [bigint,bigint,bigint,bigint];
          const side=swapSide(e.values),isBuy=side==='buy',isSell=side==='sell';
          ds+=sIn-sOut;du+=uIn-uOut;
          if (isBuy) {buy+=uIn-uOut;skyBought+=sOut-sIn;buyCount++;}
          else if(isSell){sell+=uOut-uIn;skySold+=sIn-sOut;sellCount++;}
          else {flashCount++;flashSky+=sIn-sOut;flashUsds+=uIn-uOut;}
          if (e.buyback) {
            if (!isBuy) throw new Error('Protocol buyback is not a SKY purchase');
            buyback+=uIn;skyBuyback+=sOut;buybackCount++;
          }
        } else {
          const sign=e.kind==='mint'?1n:-1n;
          ds+=sign*v[0]!;du+=sign*v[1]!;lpSky+=sign*v[0]!;lpUsds+=sign*v[1]!;
        }
      }
      previous=e;
    }
    area+=usds*Q/sky*BigInt(b.time-last);
    if (sky!==BigInt(b.skyRaw)||usds!==BigInt(b.usdsRaw)) throw new Error('Sync states do not reconcile to archive reserves');
    if (BigInt(a.skyRaw)+ds!==sky||BigInt(a.usdsRaw)+du!==usds) throw new Error('Token-flow ledger does not reconcile');
    const delta=(cumulative(b)-cumulative(a)+MOD)%MOD;
    if (delta!==area) throw new Error('TWAP does not reconcile to the cumulative oracle');
    points.push({from:a.time,through:b.time,duration:interval,samples:1,complete:true,
      open:spot(a),close:spot(b),high,low,twap:Number(delta)/Number(Q)/interval,
      buyRaw:String(buy),sellRaw:String(sell),buybackRaw:String(buyback),skyBoughtRaw:String(skyBought),skySoldRaw:String(skySold),skyBuybackRaw:String(skyBuyback),
      buyCount,sellCount,buybackCount,flashCount,flashSkyRaw:String(flashSky),flashUsdsRaw:String(flashUsds),lpSkyRaw:String(lpSky),lpUsdsRaw:String(lpUsds),skyRaw:b.skyRaw,usdsRaw:b.usdsRaw,lpRaw:b.lpRaw});
  }
  return points;
}
const rawFields=['buyRaw','sellRaw','buybackRaw','skyBoughtRaw','skySoldRaw','skyBuybackRaw','lpSkyRaw','lpUsdsRaw','flashSkyRaw','flashUsdsRaw'] as const;
export function combine(points: Point[]): Point|null {
  if (!points.length) return null;
  const first=points[0]!,last=points.at(-1)!,duration=points.reduce((s,p)=>s+p.duration,0);
  const sums=Object.fromEntries(rawFields.map(k=>[k,String(points.reduce((s,p)=>s+BigInt(p[k]??'0'),0n))])) as Pick<Point,typeof rawFields[number]>;
  return {...last,...sums,from:first.from,open:first.open,high:Math.max(...points.map(p=>p.high)),low:Math.min(...points.map(p=>p.low)),duration,
    twap:points.reduce((s,p)=>s+p.twap*p.duration,0)/duration,
    samples:points.reduce((s,p)=>s+p.samples,0),complete:points.every(p=>p.complete)&&duration===last.through-first.from,
    buyCount:points.reduce((s,p)=>s+p.buyCount,0),sellCount:points.reduce((s,p)=>s+p.sellCount,0),buybackCount:points.reduce((s,p)=>s+p.buybackCount,0),flashCount:points.reduce((s,p)=>s+(p.flashCount??0),0)};
}
export function intervalPoints(points:Point[],seconds=600):Point[]{
  const groups=new Map<number,Point[]>();
  for(const p of points){const start=Math.floor(p.from/seconds)*seconds;const rows=groups.get(start)??[];rows.push(p);groups.set(start,rows);}
  return [...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([start,rows])=>{const p=combine(rows)!;return {...p,complete:p.complete&&p.from===start&&p.through===start+seconds};});
}
export function dailyPoints(points: Point[]): Point[] {
  const groups=new Map<number,Point[]>();
  for (const p of points) {const date=Math.floor(p.from/86400)*86400;const list=groups.get(date)??[];list.push(p);groups.set(date,list);}
  return [...groups.entries()].sort((a,b)=>a[0]-b[0]).map(([date,rows])=> {
    const p=combine(rows)!;return {...p,complete:p.complete&&p.from===date&&p.through===date+86400};
  });
}
export function depth(p: Pick<Point,'skyRaw'|'usdsRaw'>) {
  const usds=units(p.usdsRaw),sky=units(p.skyRaw),price=usds/sky;
  const quote=(size:number) => {
    const skyOut=997*size*sky/(1000*usds+997*size);
    const skyIn=size/price,usdsOut=997*skyIn*usds/(1000*sky+997*skyIn);
    return {buyPercent:(size/skyOut/price-1)*100,sellPercent:(1-usdsOut/size)*100};
  };
  return {usds,sky,tvlUsds:2*usds,quote10k:quote(10000),quote100k:quote(100000),
    buyDepth1Percent:usds*(1.01-1000/997),sellDepth1Percent:usds*(997/990-1)*1000/997};
}
export function summarize(points: Point[]) {
  const p=combine(points);if (!p) return null;
  const buy=units(p.buyRaw),sell=units(p.sellRaw),buyback=units(p.buybackRaw),volume=buy+sell;
  let peak=p.open,drawdown=0,variance=0,previous=p.open,previousTime=points[0]!.from;
  for (const row of points) {
    peak=Math.max(peak,row.close);drawdown=Math.min(drawdown,row.close/peak-1);
    if (row.from===previousTime) variance+=Math.log(row.close/previous)**2;
    previous=row.close;previousTime=row.through;
  }
  return {from:p.from,through:p.through,open:p.open,close:p.close,high:p.high,low:p.low,twap:p.twap,changePercent:(p.close/p.open-1)*100,
    spotVsTwapPercent:(p.close/p.twap-1)*100,buyUsds:buy,sellUsds:sell,volumeUsds:volume,netBuyUsds:buy-sell,
    buySharePercent:volume?buy/volume*100:null,imbalancePercent:volume?(buy-sell)/volume*100:null,
    buybackUsds:buyback,otherBuyUsds:buy-buyback,otherNetBuyUsds:buy-buyback-sell,buybackSharePercent:buy?buyback/buy*100:null,
    skyBuyback:units(p.skyBuybackRaw),buybackCount:p.buybackCount,buyCount:p.buyCount,sellCount:p.sellCount,flashCount:p.flashCount??0,
    lpUsdsNet:units(p.lpUsdsRaw),maxDrawdownPercent:drawdown*100,realizedVolatilityPercent:Math.sqrt(variance)*100,depth:depth(p)};
}
export function displayPoint(p:Point) {
  const buy=units(p.buyRaw),sell=units(p.sellRaw),buyback=units(p.buybackRaw);
  return {from:p.from,through:p.through,open:p.open,high:p.high,low:p.low,close:p.close,twap:p.twap,complete:p.complete,
    buyUsds:buy,sellUsds:sell,buybackUsds:buyback,otherBuyUsds:buy-buyback,netBuyUsds:buy-sell,otherNetBuyUsds:buy-buyback-sell,
    volumeUsds:buy+sell,buyCount:p.buyCount,sellCount:p.sellCount,buybackCount:p.buybackCount,...depth(p)};
}
