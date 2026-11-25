import{toHex}from'viem';
import{Rpc,topic,selector,addr}from'./rpc.js';
import{STUSDS,STUSDS_DEPLOY}from'./curve.js';
import{Store}from'./store.js';
import{initialState,applyEvent,holderSchema,rewindHolders,saveHolderCheckpoint,publishHolderViews,type HolderState,type HolderEvent}from'./holders.js';
import{safeError}from'./errors.js';
export async function collectStusdsHolders(store:Store,rpc:Rpc,budgetMs=90000){
 await holderSchema(store);
 return store.lock('holders',async()=>{
  await store.attempt('holders');try{
   const latest=await store.latest();if(!latest)return;const target=Number(latest.block),began=Date.now();
   if((await rpc.block(BigInt(target))).hash!==latest.hash)throw new Error('Holder target is not canonical');
   const checkpoints=(await store.pool.query<{payload:HolderState}>('SELECT payload FROM sky_holder_checkpoints ORDER BY block DESC')).rows;
   let state:HolderState={...initialState(),block:STUSDS_DEPLOY-1};
   for(const row of checkpoints)if(row.payload.block<=target&&(await rpc.block(BigInt(row.payload.block))).hash===row.payload.hash){state=row.payload;break;}
   if(checkpoints.length&&state.block<STUSDS_DEPLOY)throw new Error('No canonical stUSDS holder checkpoint');
   if(checkpoints[0]&&checkpoints[0].payload.block!==state.block)await rewindHolders(store,state.block);
   const full=!state.complete||!state.verifiedBalances,changed=new Set<string>();
   while(state.block<target&&Date.now()-began<budgetMs){
    const from=state.block+1,to=Math.min(from+99999,target),logs=await rpc.logs(BigInt(from),BigInt(to),STUSDS,[topic('Transfer(address,address,uint256)')],10000n);
    const events:HolderEvent[]=logs.map(l=>({block:Number(BigInt(l.blockNumber)),index:Number(BigInt(l.logIndex)),tx:l.transactionHash,kind:'liquid',from:addr(l.topics[1]!),to:addr(l.topics[2]!),raw:String(BigInt(l.data))}));
    for(const e of events){applyEvent(state,e);changed.add(e.from);changed.add(e.to);}state.block=to;state.hash=(await rpc.block(BigInt(to))).hash;state.complete=false;
    if(to===target){
     if(state.hash!==latest.hash)throw new Error('Holder head changed during collection');
     const [supply]=await rpc.batch([{method:'eth_call',params:[{to:STUSDS,data:selector('totalSupply()')},toHex(target)]}]);
     if(Object.values(state.balances).some(v=>BigInt(v)<0n)||Object.values(state.balances).reduce((n,v)=>n+BigInt(v),0n)!==BigInt(supply as string))throw new Error('stUSDS holder supply does not reconcile');
     const addresses=[...new Set([...(full?Object.keys(state.balances):[]),...changed])].filter(a=>a!=='0x'+'0'.repeat(40));
     const values=await rpc.many(addresses.map(a=>({method:'eth_call',params:[{to:STUSDS,data:selector('balanceOf(address)')+a.slice(2).padStart(64,'0')},toHex(target)]})))as string[];
     if(addresses.some((a,i)=>BigInt(values[i]!)!==BigInt(state.balances[a]??'0')))throw new Error('stUSDS holder address reconciliation failed');
     state.verifiedBalances=true;state.complete=true;
    }
    await saveHolderCheckpoint(store,state,events);console.log(JSON.stringify({event:'stusds_holder_segment',block:to,target,transfers:events.length}));
   }
   if(state.block===target&&state.complete){await publishHolderViews(store,state,latest);await store.success('holders');}
  }catch(e){await store.failure('holders',safeError(e));throw e;}
 });
}
