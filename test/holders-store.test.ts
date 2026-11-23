import {it}from'node:test';import assert from'node:assert/strict';import{randomBytes}from'node:crypto';import{Pool}from'pg';
import{Store}from'../src/store.js';import{Rpc,topic,selector}from'../src/rpc.js';import{SKY}from'../src/config.js';
import{collectHolders,holderData,START,ENGINE,LSSKY,CHIEF,ZERO}from'../src/holders.js';import type{Snapshot}from'../src/types.js';
const url=process.env.TEST_DATABASE_URL,a='0x'+'1'.repeat(40),urn='0x'+'2'.repeat(40),word=(s:string)=>'0x'+s.replace(/^0x/,'').padStart(64,'0'),amount=(n:bigint)=>word((n*10n**18n).toString(16));
class Chain extends Rpc{
 tamper=false;requests=0;constructor(){super('https://unused.invalid');}
 override async block(n:bigint|'latest'){const number=n==='latest'?BigInt(START+4):n;return{number:'0x'+number.toString(16),hash:'hash'+number,timestamp:'0x'+(1800000000n+number).toString(16)};}
 override async batch(calls:{method:string;params:unknown[]}[]){return calls.map(c=>{const {to,data}=c.params[0] as{to:string;data:string};if(data===selector('sky()')||data===selector('gov()'))return word(SKY);if(data===selector('lssky()'))return word(LSSKY);if(data===selector('totalSupply()'))return amount(to===SKY?100n:40n);throw new Error('Unexpected fixture call');});}
 override async logs(from:bigint,to:bigint){this.requests++;const raw=[
  {block:START,index:0,address:SKY,topics:[topic('Transfer(address,address,uint256)'),word(ZERO),word(a)],data:amount(this.tamper?99n:100n)},
  {block:START+1,index:0,address:ENGINE,topics:[topic('Open(address,uint256,address)'),word(a),word('0')],data:word(urn)},
  {block:START+2,index:0,address:SKY,topics:[topic('Transfer(address,address,uint256)'),word(a),word(ENGINE)],data:amount(40n)},
  {block:START+2,index:1,address:LSSKY,topics:[topic('Transfer(address,address,uint256)'),word(ZERO),word(urn)],data:amount(40n)},
 ];return raw.filter(l=>BigInt(l.block)>=from&&BigInt(l.block)<=to).map(l=>({...l,transactionHash:'tx'+l.block,logIndex:'0x'+l.index.toString(16),blockNumber:'0x'+l.block.toString(16)}));}
}
it('indexes genesis once, reconciles staking, resumes checkpoints and serves independent period views',{skip:!url},async()=>{
 const admin=new Pool({connectionString:url!}),schema='holders_'+randomBytes(5).toString('hex'),u=new URL(url!);u.searchParams.set('options','-c search_path='+schema);const store=new Store(u.toString());
 try{await admin.query(`CREATE SCHEMA ${schema}`);const snaps=[START,START+4].map((block,i):Snapshot=>({time:1800000000+i*600,block:String(block),hash:'hash'+block,blockTime:1800000000+i*600,skyRaw:'1',usdsRaw:'1',lpRaw:'1',reserveTime:0,cumulativeRaw:'0',flapper:''}));await store.saveSegment(snaps,[],[]);
  const chain=new Chain();chain.tamper=true;await assert.rejects(collectHolders(store,chain),/total supply/);assert.equal((await holderData(store,'24h')).data,null);
  chain.tamper=false;await collectHolders(store,chain);const data=(await holderData(store,'24h')).data;assert.equal(data.addresses[0].end,100);assert.deepEqual(data.points.map((p:any)=>p.retention[0]),[100,100]);
  const before=chain.requests;await collectHolders(store,chain);assert.equal(chain.requests,before,'unchanged canonical checkpoints do not rescan transfers');assert.equal((await holderData(store,'7d')).data.addresses[0].end,100);
  assert.equal((await store.jobs()).find(j=>j.name==='holders')!.error,null);
 }finally{await store.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
