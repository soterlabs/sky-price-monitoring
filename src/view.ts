import type {Period} from './config.js';
import {POOL} from './config.js';
import type {Store} from './store.js';
import {combine,dailyPoints,displayPoint,spot,summarize,units,depth,swapSide} from './math.js';
export async function dashboardData(store:Store,range:Period,now=Date.now()) {
  const [latest,earliest,jobs]=await Promise.all([store.latest(),store.earliest(),store.jobs()]);
  if(!latest||!earliest)return {range,asOf:null,fresh:false,collecting:true,jobs,points:[],summary:null,coverage:null,trades:[],pool:POOL};
  const end=latest.time,intraday=range==='24h'||range==='7d',days=range==='24h'?1:Number(range.slice(0,-1));
  const requestedFrom=intraday?end-days*86400:Math.floor(end/86400)*86400-(days-1)*86400;
  let points;
  if(intraday)points=await store.points(requestedFrom,end);
  else {
    const [stored,recent]=await Promise.all([store.daily(requestedFrom,end),store.points(Math.max(requestedFrom,Math.floor((end-7*86400)/86400)*86400),end)]);
    const merged=new Map(stored.map(p=>[Math.floor(p.from/86400),p]));
    for(const p of dailyPoints(recent))merged.set(Math.floor(p.from/86400),p);
    points=[...merged.values()].filter(p=>p.through>requestedFrom&&p.through<=end).sort((a,b)=>a.from-b.from);
  }
  const summary=summarize(points),combined=combine(points),collector=jobs.find(j=>j.name==='collector');
  const complete=!!combined&&combined.from===requestedFrom&&combined.through===end&&combined.duration===end-requestedFrom;
  const trades=(await store.recentTrades(Math.max(requestedFrom,end-7*86400),end)).map(e=> {
    const side=swapSide(e.values),ds=BigInt(e.values[0]!)-BigInt(e.values[2]!),du=BigInt(e.values[1]!)-BigInt(e.values[3]!);
    return {tx:e.tx,time:e.time,side,buyback:e.buyback,usds:units(du<0n?-du:du),sky:units(ds<0n?-ds:ds),sender:e.sender};
  });
  return {range,asOf:new Date(end*1000).toISOString(),fresh:now-end*1000<25*60000&&!collector?.error,collecting:false,jobs,pool:POOL,
    latest:{price:spot(latest),...depth(latest),block:latest.block,blockTime:latest.blockTime,flapper:latest.flapper},
    interval:intraday?'10-minute':'daily',coverage:{complete,requestedFrom,actualFrom:points[0]?.from??end,through:end,availableSince:earliest.time,provisionalToday:!intraday&&points.at(-1)?.through!==Math.floor(end/86400)*86400},
    summary,points:points.map(displayPoint),trades};
}
