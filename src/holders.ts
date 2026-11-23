import {toHex} from 'viem';
import {Rpc,selector,topic} from './rpc.js';
import {SKY,POOL,periods,type Period} from './config.js';
import {units,swapSide} from './math.js';
import type {Snapshot} from './types.js';
import type {Store} from './store.js';
import {safeError} from './errors.js';
// Pinned mainnet registry: sky-ecosystem/spells-mainnet/src/test/addresses_mainnet.sol.
export const ENGINE='0xce01c90de7fd1bcfa39e237fe6d8d9f569e8a6a3';
export const LSSKY='0xf9a9cfd3229e985b91f99bc866d42938044ffa1c';
export const CHIEF='0x929d9a1435662357f54adcf64dcee4d6b867a6f9';
export const DELEGATE_FACTORY='0x4cf3daefa2683cd18df00f7aff5169c00a9eccd5';
export const ZERO='0x'+'0'.repeat(40);
export const START=20663735;
const addr=(s:string)=>'0x'+s.slice(-40).toLowerCase();
const words=(s:string)=>s.slice(2).match(/.{64}/g)?.map(v=>BigInt('0x'+v))??[];
const t={transfer:topic('Transfer(address,address,uint256)'),open:topic('Open(address,uint256,address)'),create:topic('CreateVoteDelegate(address,address)'),lock:topic('Lock(address,uint256)'),free:topic('Free(address,uint256)')};
export const exchangeLabels:Record<string,string>={
  '0x28c6c06298d514db089934071355e5743bf21d60':'Binance 14',
  '0x21a31ee1afc51d94c2efccaa2092ad1028285549':'Binance 15',
  '0xdfd5293d8e347dfe59e90efd55b2956a1343963d':'Binance 16',
  '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be':'Binance',
  '0x503828976d22510aad0201ac7ec88293211d23da':'Coinbase 2',
  '0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740':'Coinbase 3',
};
export const excludedLabels:Record<string,string>={...exchangeLabels,[ZERO]:'Mint / burn','0x000000000000000000000000000000000000dead':'Burn address',[POOL]:'SKY/USDS pool',[ENGINE]:'Lockstake Engine',[CHIEF]:'Governance Chief',
  [LSSKY]:'Lockstake receipt token',
  '0xbe8e3e3618f7474f8cb1d074a26affef007e98fb':'Sky treasury / buyback receiver',
  '0xa1ea1ba18e88c381c724a75f23a130420c403f9a':'MKR/SKY converter',
  '0xbdcfca946b6cdd965f99a839e4435bcdc1bc470b':'Legacy MKR/SKY converter',
  '0x67eadb3288ccede034ce95b0511dcc65cf630bb6':'SKY vesting',
};
export interface HolderEvent {block:number;index:number;tx:string;kind:'liquid'|'position'|'vote'|'delegate';from:string;to:string;raw:string}
export interface HolderState {block:number;hash:string;balances:Record<string,string>;positions:Record<string,string>;votes:Record<string,string>;owners:Record<string,string>;delegates:string[];complete:boolean}
export const initialState=():HolderState=>({block:START-1,hash:'',balances:{},positions:{},votes:{},owners:{},delegates:[],complete:false});
function add(map:Record<string,string>,a:string,n:bigint){if(a===ZERO)return;const v=BigInt(map[a]??'0')+n;if(v===0n)delete map[a];else map[a]=String(v);}
export function applyEvent(state:HolderState,e:HolderEvent,sign=1n){
  const map=e.kind==='liquid'?state.balances:e.kind==='position'?state.positions:state.votes;
  const v=BigInt(e.raw)*sign;add(map,e.from,-v);add(map,e.to,v);
}
export function balances(state:HolderState):Map<string,bigint>{
  const out=new Map<string,bigint>(),excluded=new Set([...Object.keys(excludedLabels),...state.delegates]);
  for(const map of [state.balances,state.positions,state.votes])for(const [a,v]of Object.entries(map))if(!excluded.has(a))out.set(a,(out.get(a)??0n)+BigInt(v));
  for(const [a,v]of out){if(v<0n)throw new Error('Negative attributed holder balance');if(!v)out.delete(a);}return out;
}
const bucketLimits=[10_000n,100_000n,1_000_000n,10_000_000n,100_000_000n].map(n=>n*10n**18n);
export const bucketLabels=['<10k','10k–100k','100k–1M','1M–10M','10M–100M','≥100M'];
export function distribution(b:Map<string,bigint>){
  const counts=Array<number>(6).fill(0),sums=Array<bigint>(6).fill(0n);let total=0n;
  for(const v of b.values()){let i=bucketLimits.findIndex(l=>v<l);if(i<0)i=5;counts[i]=counts[i]!+1;sums[i]=sums[i]!+v;total+=v;}
  const sorted=[...b.values()].sort((a,b)=>a>b?-1:a<b?1:0);
  const share=(n:number)=>total?Number(sorted.slice(0,n).reduce((s,v)=>s+v,0n))*100/Number(total):0;
  return {counts,sky:sums.map(String),shares:sums.map(v=>total?Number(v)*100/Number(total):0),holders:b.size,total:units(String(total)),top10:share(10),top100:share(100)};
}
export function holderSeries(state:HolderState,events:HolderEvent[],snapshots:Snapshot[],trades:{tx:string;values:string[]}[]){
  const start=snapshots[0]!,end=snapshots.at(-1)!;
  // Work on a copy: one period must never mutate another period's ledger.
  const work:HolderState={...state,balances:{...state.balances},positions:{...state.positions},votes:{...state.votes}};
  const ordered=events.filter(e=>e.block>Number(start.block)&&e.block<=Number(end.block)).sort((a,b)=>a.block-b.block||a.index-b.index);
  for(const e of [...ordered].reverse())applyEvent(work,e,-1n);
  const baseline=balances(work),ranked=[...baseline].sort((a,b)=>a[1]>b[1]?-1:a[1]<b[1]?1:a[0].localeCompare(b[0]));
  const cohort=new Map(ranked.map(([a],i)=>[a,i<100?0:i<1000?1:2]));
  const initial=[0n,0n,0n];for(const [a,v]of baseline)initial[cohort.get(a)!]=initial[cohort.get(a)!]!+v;
  const top=new Set(ranked.slice(0,100).map(([a])=>a));
  const byTx=new Map<string,{sides:Set<string>;input:bigint;output:bigint;transferredIn:bigint;transferredOut:bigint}>();
  for(const e of trades){const match=byTx.get(e.tx)??{sides:new Set<string>(),input:0n,output:0n,transferredIn:0n,transferredOut:0n};match.sides.add(swapSide(e.values));match.input+=BigInt(e.values[0]!);match.output+=BigInt(e.values[2]!);byTx.set(e.tx,match);}
  for(const e of ordered)if(e.kind==='liquid'){const match=byTx.get(e.tx);if(match){if(e.to===POOL)match.transferredIn+=BigInt(e.raw);if(e.from===POOL)match.transferredOut+=BigInt(e.raw);}}
  const stakingCustody=new Set([ENGINE,CHIEF,...state.delegates]);
  let cursor=0;const points=[];
  for(let i=0;i<snapshots.length;i++){
    const s=snapshots[i]!,activity={buys:0,sells:0,exchangeDeposits:0,otherOut:0};
    while(cursor<ordered.length&&ordered[cursor]!.block<=Number(s.block)){
      const e=ordered[cursor++]!;applyEvent(work,e);
      if(e.kind==='liquid'){
        const n=units(e.raw),match=byTx.get(e.tx),sides=match?.sides,verified=match&&match.sides.size===1&&match.input===match.transferredIn&&match.output===match.transferredOut;
        if(top.has(e.from)){
          if(e.to===POOL&&verified&&sides?.has('sell'))activity.sells+=n;
          else if(exchangeLabels[e.to])activity.exchangeDeposits+=n;
          else if(!top.has(e.to)&&!stakingCustody.has(e.to))activity.otherOut+=n;
        }
        if(top.has(e.to)&&e.from===POOL&&verified&&sides?.has('buy'))activity.buys+=n;
      }
    }
    const b=balances(work),totals=[0n,0n,0n];let newcomers=0n;
    for(const [a,v]of b){const group=cohort.get(a);if(group===undefined)newcomers+=v;else totals[group]=totals[group]!+v;}
    points.push({time:s.time,block:s.block,retention:totals.map((v,j)=>initial[j]?Number(v)*100/Number(initial[j]):null),distribution:distribution(b),activity,newcomerSky:units(String(newcomers))});
  }
  const final=balances(work),addresses=ranked.slice(0,100).map(([address,v])=>({address,start:units(String(v)),end:units(String(final.get(address)??0n)),change:units(String((final.get(address)??0n)-v))})).sort((a,b)=>a.change-b.change);
  return {from:start.time,through:end.time,labels:['Initial top 100','Initial 101–1,000','Initial remaining holders'],buckets:bucketLabels,points,addresses,initialSky:initial.map(v=>units(String(v))),activity:points.reduce((s,p)=>({buys:s.buys+p.activity.buys,sells:s.sells+p.activity.sells,exchangeDeposits:s.exchangeDeposits+p.activity.exchangeDeposits,otherOut:s.otherOut+p.activity.otherOut}),{buys:0,sells:0,exchangeDeposits:0,otherOut:0})};
}
async function schema(store:Store){await store.initialize();await store.pool.query(`CREATE TABLE IF NOT EXISTS sky_holder_checkpoints(block bigint PRIMARY KEY,hash text NOT NULL,payload jsonb NOT NULL);
 CREATE TABLE IF NOT EXISTS sky_holder_events(block bigint NOT NULL,log_index integer NOT NULL,tx text NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(tx,log_index));
 CREATE INDEX IF NOT EXISTS sky_holder_events_block ON sky_holder_events(block);
 CREATE TABLE IF NOT EXISTS sky_holder_views(period text PRIMARY KEY,payload jsonb NOT NULL);`);}
async function checkpoint(store:Store,state:HolderState,events:HolderEvent[]){const c=await store.pool.connect();try{await c.query('BEGIN');if(events.length)await c.query(`INSERT INTO sky_holder_events(block,log_index,tx,payload) SELECT (v->>'block')::bigint,(v->>'index')::integer,v->>'tx',v FROM jsonb_array_elements($1::jsonb) v ON CONFLICT(tx,log_index) DO UPDATE SET block=EXCLUDED.block,payload=EXCLUDED.payload`,[JSON.stringify(events)]);await c.query('INSERT INTO sky_holder_checkpoints(block,hash,payload) VALUES($1,$2,$3) ON CONFLICT(block) DO UPDATE SET hash=EXCLUDED.hash,payload=EXCLUDED.payload',[state.block,state.hash,JSON.stringify(state)]);await c.query('DELETE FROM sky_holder_checkpoints WHERE block < (SELECT block FROM sky_holder_checkpoints ORDER BY block DESC OFFSET 12 LIMIT 1)');await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function readWord(rpc:Rpc,to:string,sig:string,block:number,args=''){return (await rpc.batch([{method:'eth_call',params:[{to,data:selector(sig)+args},toHex(block)]}]))[0] as string;}
export async function collectHolders(store:Store,rpc:Rpc,budgetMs=300000){
 await schema(store);const connection=await store.pool.connect();
 const locked=(await connection.query<{locked:boolean}>('SELECT pg_try_advisory_lock(734902,2) AS locked')).rows[0]?.locked;
 if(!locked){connection.release();return;}
 try{
  await store.attempt('holders');const started=Date.now(),latest=await store.latest();if(!latest)return;
  const target=Number(latest.block),head=await rpc.block(BigInt(target));
  if(head.hash!==latest.hash)throw new Error('Holder target snapshot is no longer canonical');
  const verified=await Promise.all([readWord(rpc,ENGINE,'sky()',target),readWord(rpc,ENGINE,'lssky()',target),readWord(rpc,CHIEF,'gov()',target)]);
  if(addr(verified[0]!)!==SKY||addr(verified[1]!)!==LSSKY||addr(verified[2]!)!==SKY)throw new Error('Holder contract identity mismatch');
  const saved=(await store.pool.query<{payload:HolderState}>('SELECT payload FROM sky_holder_checkpoints ORDER BY block DESC')).rows;
  let state=initialState();for(const row of saved){if(row.payload.block<=target&&(await rpc.block(BigInt(row.payload.block))).hash===row.payload.hash){state=row.payload;break;}}
  if(saved.length&&state.block<START)throw new Error('No canonical holder checkpoint; rebuild required');
  if(saved[0]&&saved[0].payload.block!==state.block){await store.pool.query('DELETE FROM sky_holder_checkpoints WHERE block > $1',[state.block]);await store.pool.query('DELETE FROM sky_holder_events WHERE block > $1',[state.block]);await store.pool.query('DELETE FROM sky_holder_views');}
  while(state.block<target&&Date.now()-started<budgetMs){
    const from=state.block+1,to=Math.min(from+(from<25000000?99999:19999),target);
    const logs=await rpc.logs(BigInt(from),BigInt(to),[SKY,LSSKY,ENGINE,CHIEF,DELEGATE_FACTORY],Object.values(t),10000n);
    const delegates=new Set(state.delegates);
    for(const l of logs)if(l.address.toLowerCase()===DELEGATE_FACTORY&&l.topics[0]===t.create)delegates.add(addr(l.topics[2]!));
    const delegation=delegates.size?await rpc.logs(BigInt(from),BigInt(to),[...delegates],[t.lock,t.free],10000n):[];
    const all=[...logs,...delegation].sort((a,b)=>Number(BigInt(a.blockNumber)-BigInt(b.blockNumber))||Number(BigInt(a.logIndex)-BigInt(b.logIndex)));
    const events:HolderEvent[]=[];
    for(const l of all){
      const contract=l.address.toLowerCase(),sig=l.topics[0],v=words(l.data),base={block:Number(BigInt(l.blockNumber)),index:Number(BigInt(l.logIndex)),tx:l.transactionHash};
      if(contract===ENGINE&&sig===t.open){state.owners[addr(l.data)]=addr(l.topics[1]!);continue;}
      let e:HolderEvent|undefined;
      if(contract===SKY&&sig===t.transfer)e={...base,kind:'liquid',from:addr(l.topics[1]!),to:addr(l.topics[2]!),raw:String(v[0]!)};
      else if(contract===LSSKY&&sig===t.transfer){
        const f=addr(l.topics[1]!),dest=addr(l.topics[2]!);if(f!==ZERO&&dest!==ZERO)continue;
        const urn=f===ZERO?dest:f,owner=state.owners[urn];if(!owner)throw new Error('Missing Lockstake urn owner');
        e={...base,kind:'position',from:f===ZERO?ZERO:owner,to:dest===ZERO?ZERO:owner,raw:String(v[0]!)};
      }else if((contract===CHIEF||delegates.has(contract))&&(sig===t.lock||sig===t.free)){
        const user=addr(l.topics[1]!);e={...base,kind:contract===CHIEF?'vote':'delegate',from:sig===t.lock?(contract===CHIEF?ZERO:contract):user,to:sig===t.free?(contract===CHIEF?ZERO:contract):user,raw:String(v[0]!)};
      }
      if(e){events.push(e);applyEvent(state,e);}
    }
    state.delegates=[...delegates];state.block=to;state.hash=(await rpc.block(BigInt(to))).hash;state.complete=false;
    if(to===target){
      if(state.hash!==latest.hash)throw new Error('Holder target reorganized during indexing');
      const supply=BigInt(await readWord(rpc,SKY,'totalSupply()',target)),sum=Object.values(state.balances).reduce((s,v)=>s+BigInt(v),0n);
      if(sum!==supply||Object.values(state.balances).some(v=>BigInt(v)<0n))throw new Error('Holder transfer ledger does not reconcile to SKY total supply');
      const receipts=BigInt(await readWord(rpc,LSSKY,'totalSupply()',target)),positions=Object.values(state.positions).reduce((s,v)=>s+BigInt(v),0n);
      if(receipts!==positions||Object.values(state.positions).some(v=>BigInt(v)<0n))throw new Error('Holder staking ledger does not reconcile');
      if(Object.values(state.votes).some(v=>BigInt(v)<0n))throw new Error('Negative governance owner position');
      const voting=Object.values(state.votes).reduce((s,v)=>s+BigInt(v),0n);if(voting>BigInt(state.balances[CHIEF]??'0'))throw new Error('Governance positions exceed Chief custody balance');
      state.complete=true;
    }
    await checkpoint(store,state,events);console.log(JSON.stringify({event:'holder_segment',block:to,target,events:events.length,addresses:Object.keys(state.balances).length}));
  }
  if(state.block!==target||!state.complete)return;
  // Snapshot boundaries share the pool's exact confirmed blocks and granularity.
  for(const range of periods){
    const days=range==='24h'?1:Number(range.slice(0,-1)),intraday=range==='24h'||range==='7d';
    const requested=intraday?latest.time-days*86400:Math.floor(latest.time/86400)*86400-(days-1)*86400;
    let snaps=await store.snapshots(requested,latest.time);if(!intraday)snaps=snaps.filter((s,i)=>i===0||s.time%86400===0||s.time===latest.time);
    if(snaps.length<2)continue;
    const events=(await store.pool.query<{payload:HolderEvent}>('SELECT payload FROM sky_holder_events WHERE block > $1 AND block <= $2 ORDER BY block,log_index',[snaps[0]!.block,latest.block])).rows.map(r=>r.payload);
    const trades=(await store.pool.query<{payload:{tx:string;values:string[]}}>(`SELECT payload FROM sky_events WHERE block_number > $1 AND block_number <= $2 AND payload->>'kind'='swap'`,[snaps[0]!.block,latest.block])).rows.map(r=>r.payload);
    const view={...holderSeries(state,events,snaps,trades),complete:snaps[0]!.time===requested,asOf:new Date(latest.time*1000).toISOString(),requestedFrom:requested};
    await store.pool.query('INSERT INTO sky_holder_views(period,payload) VALUES($1,$2) ON CONFLICT(period) DO UPDATE SET payload=EXCLUDED.payload',[range,JSON.stringify(view)]);
  }
  await store.success('holders');
 }catch(e){await store.failure('holders',safeError(e));throw e;}
 finally{try{await connection.query('SELECT pg_advisory_unlock(734902,2)');}finally{connection.release();}}
}
export async function holderData(store:Store,range:Period){
 await schema(store);const [view,job]=await Promise.all([store.pool.query('SELECT payload FROM sky_holder_views WHERE period=$1',[range]),store.pool.query("SELECT attempted_at,succeeded_at,error FROM sky_jobs WHERE name='holders'")]);
 return {data:view.rows[0]?.payload??null,job:job.rows[0]??null,excludedLabels,exchangeLabels};
}
