import{it}from'node:test';import assert from'node:assert/strict';import{randomBytes}from'node:crypto';import{Pool}from'pg';import{readFileSync}from'node:fs';import{gunzipSync}from'node:zlib';
import{Rpc}from'../src/rpc.js';import{Store}from'../src/store.js';import{collect}from'../src/collector.js';import{makePoints}from'../src/math.js';import{dashboardData}from'../src/view.js';import{splitSnapshots}from'./fine-fixture.js';import type{Snapshot,PoolEvent}from'../src/types.js';
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/study-24h.json.gz',import.meta.url))).toString())as{snapshots:Snapshot[];events:PoolEvent[]};
const old=fixture.snapshots.at(-1)!,fine=splitSnapshots(fixture.snapshots,fixture.events);for(let i=1;i<=2;i++)fine.push({...old,time:old.time+i*300,block:String(BigInt(old.block)+BigInt(i*25))});
class Archive extends Rpc{
 end=old.time+300;requested:number[][]=[];constructor(){super('https://unused.invalid');}
 override async block(n:bigint|'latest'){if(n==='latest')return{number:'0xfffffff',timestamp:'0x'+(this.end+174).toString(16),hash:'head'};if(n===0xfffffffn-12n)return{number:'0x'+n.toString(16),timestamp:'0x'+(this.end+30).toString(16),hash:'safe'};const s=fine.find(s=>BigInt(s.block)===n);if(!s)throw new Error('Unexpected fixture block');return{number:'0x'+n.toString(16),timestamp:'0x'+s.time.toString(16),hash:s.hash};}
 override async verify(){}
 override async boundaries(times:number[]){this.requested.push(times);return times.map(time=>{const s=fine.find(s=>s.time===time);if(!s)throw new Error('Unexpected fixture timestamp');return s;});}
 override async events(snaps:Snapshot[]){return fixture.events.filter(e=>e.time>snaps[0]!.time&&e.time<=snaps.at(-1)!.time);}
}
it('backfills the last hour on upgrade, then resumes five-minute collection without changing ten-minute totals',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const url=process.env.TEST_DATABASE_URL!,admin=new Pool({connectionString:url}),schema='collector_'+randomBytes(5).toString('hex'),u=new URL(url);u.searchParams.set('options','-c search_path='+schema);const store=new Store(u.toString());
 try{await admin.query(`CREATE SCHEMA ${schema}`);await store.saveSegment(fixture.snapshots,fixture.events,makePoints(fixture.snapshots,fixture.events));const before=await dashboardData(store,'24h');const rpc=new Archive();await collect(store,rpc,7,12);
  assert.equal(rpc.requested[0]![0],old.time-3600);assert.equal((await store.latest())!.time,old.time+300);
  const hour=await dashboardData(store,'60m'),day=await dashboardData(store,'24h');assert.equal(hour.coverage?.complete,true);assert.equal(hour.points.length,12);assert.equal(day.summary?.volumeUsds,before.summary?.volumeUsds);assert.equal(day.asOf,before.asOf);
  rpc.end=old.time+600;rpc.requested=[];await collect(store,rpc,7,12);assert.equal(rpc.requested[0]![0],old.time+300-1200);assert.equal((await dashboardData(store,'24h')).points.length,144);
 }finally{await store.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
