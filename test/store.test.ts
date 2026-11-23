import assert from 'node:assert/strict';
import {it} from 'node:test';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Pool} from 'pg';
import {Store} from '../src/store.js';
import {makePoints,dailyPoints} from '../src/math.js';
import {dashboardData} from '../src/view.js';
import type {Snapshot,PoolEvent} from '../src/types.js';
const url=process.env.TEST_DATABASE_URL;
const fixture=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/study-24h.json.gz',import.meta.url))).toString()) as {snapshots:Snapshot[];events:PoolEvent[]};
it('persists idempotent overlapping collection, serializes collectors, and derives consistent daily API data',{skip:!url},async()=>{
  const admin=new Pool({connectionString:url!}),schema='sky_test_'+randomBytes(6).toString('hex');
  const u=new URL(url!);u.searchParams.set('options','-c search_path='+schema);
  const a=new Store(u.toString()),b=new Store(u.toString());
  try{
    await admin.query(`CREATE SCHEMA ${schema}`);await Promise.all([a.initialize(),b.initialize()]);
    const points=makePoints(fixture.snapshots,fixture.events);
    await a.saveSegment(fixture.snapshots,fixture.events,points);await a.saveSegment(fixture.snapshots,fixture.events,points);
    assert.equal((await a.points(0,Number.MAX_SAFE_INTEGER)).length,144);
    assert.equal(Number((await admin.query(`SELECT count(*) FROM ${schema}.sky_events`)).rows[0].count),fixture.events.length);
    await a.lock('collect',async()=>{assert.equal(await b.lock('collect',async()=>assert.fail('Competing collector entered')),false);});
    for(const p of dailyPoints(points))await a.rollupDay(Math.floor(p.from/86400)*86400,p);
    const now=fixture.snapshots.at(-1)!.time*1000+1000;
    const short=await dashboardData(a,'24h',now),long=await dashboardData(a,'30d',now);
    assert.equal(short.coverage?.complete,true);assert.equal(short.fresh,true);
    assert.equal(long.coverage?.complete,false);assert.equal(short.summary?.buybackCount,138);
    assert.equal(long.summary?.buybackCount,138);assert.equal(long.summary?.volumeUsds,short.summary?.volumeUsds);
    // Reprocessing a segment invalidates affected materialized days.
    await a.saveSegment(fixture.snapshots,fixture.events,points);assert.equal((await a.daily(0,Number.MAX_SAFE_INTEGER)).length,0);
    await a.attempt('collector');await a.failure('collector','Upstream unavailable');assert.equal((await dashboardData(a,'24h',now)).fresh,false);
    await a.attempt('collector');assert.equal((await dashboardData(a,'24h',now)).fresh,false,'a retry is not yet a successful refresh');
    await a.success('collector');assert.equal((await dashboardData(a,'24h',now)).fresh,true);
  }finally{await a.close();await b.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
