import {config} from './config.js';
import {Store} from './store.js';
import {Rpc} from './rpc.js';
import {makePoints} from './math.js';
import {collectHolders} from './holders.js';
import {safeError} from './errors.js';
export async function collect(store:Store,rpc:Rpc,backfillDays:number,confirmations:number) {
  return store.lock('collect',async()=> {
    await store.attempt('collector');
    try {
      const head=await rpc.block('latest');
      const safe=await rpc.block(BigInt(head.number)-BigInt(confirmations));
      const end=Math.floor(Number(BigInt(safe.timestamp))/600)*600;
      await rpc.verify(BigInt(safe.number));
      const latest=await store.latest();
      if(latest&&latest.time>end)throw new Error('RPC confirmed head is behind the saved checkpoint');
      let from=end-backfillDays*86400;
      if(latest) {
        // Re-read overlapping windows. If the anchor was reorganized, walk back
        // to a matching saved block before replacing any data.
        const candidates=(await store.snapshots(latest.time-86400,Math.max(0,latest.time-1200))).reverse();
        if(!candidates.length) {const oldest=await store.earliest();if(oldest)candidates.push(oldest);}
        const anchor=await (async()=> {
          for(const candidate of candidates) {
            const block=await rpc.block(BigInt(candidate.block));
            if(block.hash===candidate.hash)return candidate;
          }
          throw new Error('No canonical anchor within the saved overlap; collection paused');
        })();
        from=anchor.time;
      }
      for(let left=from;left<end;left+=21600) {
        const right=Math.min(left+21600,end),times:number[]=[];
        for(let time=left;time<=right;time+=600)times.push(time);
        const snapshots=await rpc.boundaries(times,head);
        const events=await rpc.events(snapshots);
        const points=makePoints(snapshots,events);
        await store.saveSegment(snapshots,events,points);
        console.log(JSON.stringify({event:'collection_segment',from:new Date(left*1000).toISOString(),through:new Date(right*1000).toISOString(),buckets:points.length,events:events.length}));
      }
      await store.success('collector');
      console.log(JSON.stringify({event:'collector_complete',through:new Date(end*1000).toISOString()}));
    }catch(error){await store.failure('collector',safeError(error));throw error;}
  });
}
async function main() {
  const c=config(),store=new Store(c.databaseUrl);
  try {const acquired=await collect(store,new Rpc(c.rpcUrl),c.backfillDays,c.confirmations);if(!acquired)console.log(JSON.stringify({event:'collector_already_running'}));else await collectHolders(store,new Rpc(c.rpcUrl));}
  finally {await store.close();}
}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(e=>{console.error(JSON.stringify({event:'collector_failed',error:safeError(e)}));process.exitCode=1;});
