import{Store}from'./store.js';import{CurveRpc}from'./curve.js';import{makeCurvePoints}from'./curve-math.js';import{safeError}from'./errors.js';
export async function backfillCurve(store:Store,rpc:CurveRpc,days:number,budgetMs=120000){
 return store.lock('collect',async()=>{await store.attempt('backfill');try{
  const latest=await store.latest();if(!latest)return;const target=Math.floor((latest.time-days*86400)/600)*600,started=Date.now(),head=await rpc.block('latest');await rpc.verify(BigInt(head.number));
  for(let earliest=await store.earliest();earliest&&earliest.time>target&&Date.now()-started<budgetMs;earliest=await store.earliest()){
   const from=Math.max(target,Math.floor((earliest.time-21600)/600)*600),times:number[]=[];for(let t=from;t<=earliest.time;t+=300)times.push(t);
   const snaps=await rpc.boundaries(times,head);if(snaps.at(-1)!.hash!==earliest.hash)throw new Error('Backfill anchor is not canonical');const events=await rpc.events(snaps);await store.saveSegment(snaps,events,makeCurvePoints(snaps,events));console.log(JSON.stringify({event:'stusds_backfill_segment',from:new Date(from*1000).toISOString(),through:new Date(earliest.time*1000).toISOString()}));
  }
  await store.success('backfill');
 }catch(e){await store.failure('backfill',safeError(e));throw e;}});
}
