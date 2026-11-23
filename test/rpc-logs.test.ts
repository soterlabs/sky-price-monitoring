import{it}from'node:test';import assert from'node:assert/strict';import{Rpc}from'../src/rpc.js';
class LimitedRpc extends Rpc{
 ranges:{from:bigint;to:bigint}[]=[];outage=false;constructor(){super('https://unused.invalid');}
 override async many(calls:{method:string;params:unknown[]}[]){
  if(this.outage)throw new Error('RPC HTTP 503');
  return calls.map(c=>{const p=c.params[0] as{fromBlock:string;toBlock:string},from=BigInt(p.fromBlock),to=BigInt(p.toBlock);this.ranges.push({from,to});if(to-from>=2n)throw new Error('RPC eth_getLogs failed (-32602)');return Array.from({length:Number(to-from+1n)},(_,i)=>({address:'0x1',topics:['0x2'],data:'0x',blockNumber:'0x'+(from+BigInt(i)).toString(16),transactionHash:'tx'+(from+BigInt(i)),logIndex:'0x0'}));});
 }
}
it('splits limited log queries without gaps, overlaps or duplicate events',async()=>{const rpc=new LimitedRpc();const logs=await rpc.logs(10n,20n,'0x1',['0x2'],8n);assert.deepEqual(logs.map(l=>BigInt(l.blockNumber)),Array.from({length:11},(_,i)=>10n+BigInt(i)));assert.ok(rpc.ranges.some(r=>r.to-r.from===7n));assert.equal(new Set(logs.map(l=>l.transactionHash+':'+l.logIndex)).size,11);});
it('does not disguise a provider outage as a range-limit problem',async()=>{const rpc=new LimitedRpc();rpc.outage=true;await assert.rejects(rpc.logs(10n,20n,'0x1',['0x2']),/HTTP 503/);assert.equal(rpc.ranges.length,0);});
