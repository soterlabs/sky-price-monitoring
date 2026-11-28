import { liquidation } from './liquidation.js';
import type {Period} from './config.js';
import {POOL,rangeSpec} from './config.js';
import type {Store} from './store.js';
import {displayVault} from './curve-math.js';
import {combine,dailyPoints,intervalPoints,displayPoint,spot,summarize,units,depth,swapSide} from './math.js';
export async function dashboardData(store:Store,range:Period,now=Date.now()) {
  const [newest,earliest,jobs]=await Promise.all([store.latest(),store.earliest(),store.jobs()]);
  if(!newest||!earliest)return {range,asOf:null,fresh:false,collecting:true,jobs,points:[],summary:null,coverage:null,trades:[],pool:store.market.pool,market:store.market};
  const {end,from:requestedFrom,step,refreshSeconds}=rangeSpec(range,newest.time),intraday=step<86400;
  const latest=end===newest.time?newest:(await store.snapshots(end,end))[0];
  if(!latest)throw new Error('Selected interval snapshot unavailable');
  let points;
  if(intraday){const raw=await store.points(requestedFrom,end);points=range==='60m'?raw.filter(p=>p.duration===300):intervalPoints(raw);}
  else {
    const [stored,recent]=await Promise.all([store.daily(requestedFrom,end),store.points(Math.max(requestedFrom,Math.floor((end-7*86400)/86400)*86400),end)]);
    const merged=new Map(stored.map(p=>[Math.floor(p.from/86400),p]));
    for(const p of dailyPoints(recent))merged.set(Math.floor(p.from/86400),p);
    points=[...merged.values()].filter(p=>p.through>requestedFrom&&p.through<=end).sort((a,b)=>a.from-b.from);
  }
  const summary=summarize(points),combined=combine(points),collector=jobs.find(j=>j.name==='collector');
  const complete=!!combined&&combined.complete&&combined.from===requestedFrom&&combined.through===end&&combined.duration===end-requestedFrom;
  const trades=(await store.recentTrades(Math.max(requestedFrom,end-7*86400),end)).map(e=> {
    const side=swapSide(e.values),ds=BigInt(e.values[0]!)-BigInt(e.values[2]!),du=BigInt(e.values[1]!)-BigInt(e.values[3]!);
    return {tx:e.tx,time:e.time,side,buyback:e.buyback,usds:units(du<0n?-du:du),sky:units(ds<0n?-ds:ds),sender:e.sender};
  });
  return {range,asOf:new Date(end*1000).toISOString(),fresh:now-end*1000<(range==='60m'?15:25)*60000&&!collector?.error,collecting:false,jobs,pool:store.market.pool,market:store.market,
    liquidation:store.market.id==='stusds'?liquidation():null,
    latest:{...(latest.curve?{vault:displayVault(latest.curve)}:{}),price:spot(latest),...depth(latest),block:latest.block,blockTime:latest.blockTime,flapper:latest.flapper},
    interval:range==='60m'?'5-minute':intraday?'10-minute':'daily',refreshSeconds,coverage:{complete,requestedFrom,actualFrom:points[0]?.from??end,through:end,availableSince:earliest.time,provisionalToday:!intraday&&points.at(-1)?.through!==Math.floor(end/86400)*86400},
    summary,points:points.map(displayPoint),trades,
    vaultEvents:store.market.id==='stusds'?(await store.pool.query<{payload:import('./types.js').PoolEvent}>(`SELECT payload FROM sky_events WHERE time>$1 AND time<=$2 AND payload->>'kind' IN ('deposit','withdraw') ORDER BY time DESC,log_index DESC LIMIT 20`,[requestedFrom,end])).rows.map(({payload:e})=>({time:e.time,tx:e.tx,kind:e.kind,owner:e.owner,receiver:e.recipient,assets:units(e.values[0]!),shares:units(e.values[1]!)})):[]};
}
