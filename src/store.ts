import {Pool, type PoolClient} from 'pg';
import type {Snapshot,PoolEvent,Point,JobStatus} from './types.js';
export class Store {
  readonly pool:Pool;
  private ready:Promise<void>|undefined;
  constructor(url:string) {this.pool=new Pool({connectionString:url,max:4,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,allowExitOnIdle:true});}
  async initialize() {
    this.ready??=this.schema().catch(e=>{this.ready=undefined;throw e;});return this.ready;
  }
  private async schema() {
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(734902,0)');
      await c.query(`CREATE TABLE IF NOT EXISTS sky_snapshots(time bigint PRIMARY KEY,block_number bigint NOT NULL,block_hash text NOT NULL,payload jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS sky_events(tx_hash text NOT NULL,log_index integer NOT NULL,block_number bigint NOT NULL,time bigint NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(tx_hash,log_index));
        CREATE INDEX IF NOT EXISTS sky_events_time_idx ON sky_events(time);
        CREATE INDEX IF NOT EXISTS sky_events_block_idx ON sky_events(block_number);
        CREATE TABLE IF NOT EXISTS sky_buckets(time bigint PRIMARY KEY,payload jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS sky_daily(day bigint PRIMARY KEY,payload jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
        CREATE TABLE IF NOT EXISTS sky_jobs(name text PRIMARY KEY,attempted_at timestamptz NOT NULL,succeeded_at timestamptz,error text);`);
      await c.query('COMMIT');
    } catch(e) {await c.query('ROLLBACK');throw e;} finally {c.release();}
  }
  async lock(name:'collect'|'daily',fn:()=>Promise<void>):Promise<boolean> {
    await this.initialize();const c=await this.pool.connect(),key=1;
    // Rollups wait for collection so a concurrent segment replacement cannot
    // invalidate a day just before an older rollup overwrites it.
    const result=name==='daily'
      ?(await c.query('SELECT pg_advisory_lock(734902,$1)',[key]),{rows:[{locked:true}]})
      :await c.query<{locked:boolean}>('SELECT pg_try_advisory_lock(734902,$1) AS locked',[key]);
    if (!result.rows[0]?.locked) {c.release();return false;}
    try {await fn();return true;} finally {try {await c.query('SELECT pg_advisory_unlock(734902,$1)',[key]);} finally {c.release();}}
  }
  async attempt(name:string) {await this.initialize();await this.pool.query(`INSERT INTO sky_jobs(name,attempted_at) VALUES($1,now()) ON CONFLICT(name) DO UPDATE SET attempted_at=now()`,[name]);}
  async success(name:string) {await this.pool.query('UPDATE sky_jobs SET succeeded_at=now(),error=NULL WHERE name=$1',[name]);}
  async failure(name:string,error:string) {await this.pool.query('UPDATE sky_jobs SET error=$2 WHERE name=$1',[name,error]);}
  async jobs():Promise<JobStatus[]> {
    await this.initialize();const r=await this.pool.query<{name:string;attempted_at:Date;succeeded_at:Date|null;error:string|null}>('SELECT * FROM sky_jobs ORDER BY name');
    return r.rows.map(r=>({name:r.name,attemptedAt:r.attempted_at.toISOString(),succeededAt:r.succeeded_at?.toISOString()??null,error:r.error}));
  }
  async snapshots(from=0,to=Number.MAX_SAFE_INTEGER):Promise<Snapshot[]> {
    await this.initialize();const r=await this.pool.query<{payload:Snapshot}>('SELECT payload FROM sky_snapshots WHERE time >= $1 AND time <= $2 ORDER BY time',[from,to]);return r.rows.map(r=>r.payload);
  }
  async latest():Promise<Snapshot|null> {await this.initialize();return (await this.pool.query<{payload:Snapshot}>('SELECT payload FROM sky_snapshots ORDER BY time DESC LIMIT 1')).rows[0]?.payload??null;}
  async earliest():Promise<Snapshot|null> {await this.initialize();return (await this.pool.query<{payload:Snapshot}>('SELECT payload FROM sky_snapshots ORDER BY time LIMIT 1')).rows[0]?.payload??null;}
  async points(from:number,to:number):Promise<Point[]> {
    await this.initialize();return (await this.pool.query<{payload:Point}>('SELECT payload FROM sky_buckets WHERE time > $1 AND time <= $2 ORDER BY time',[from,to])).rows.map(r=>r.payload);
  }
  async daily(from:number,to:number):Promise<Point[]> {
    await this.initialize();return (await this.pool.query<{payload:Point}>('SELECT payload FROM sky_daily WHERE day >= $1 AND day < $2 ORDER BY day',[from,to])).rows.map(r=>r.payload);
  }
  async saveSegment(snapshots:Snapshot[],events:PoolEvent[],points:Point[]) {
    await this.initialize();if (!snapshots.length) throw new Error('No segment snapshots');
    const a=snapshots[0]!,b=snapshots.at(-1)!,c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM sky_events WHERE block_number > $1 AND block_number <= $2',[a.block,b.block]);
      await c.query('DELETE FROM sky_snapshots WHERE time > $1 AND time <= $2',[a.time,b.time]);
      await c.query('DELETE FROM sky_buckets WHERE time > $1 AND time <= $2',[a.time,b.time]);
      await c.query('DELETE FROM sky_daily WHERE day >= $1 AND day <= $2',[Math.floor(a.time/86400)*86400,Math.floor((b.time-1)/86400)*86400]);
      await c.query(`INSERT INTO sky_snapshots(time,block_number,block_hash,payload)
        SELECT (v->>'time')::bigint,(v->>'block')::bigint,v->>'hash',v FROM jsonb_array_elements($1::jsonb) v
        ON CONFLICT(time) DO UPDATE SET block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,payload=EXCLUDED.payload`,[JSON.stringify(snapshots)]);
      if(events.length) await c.query(`INSERT INTO sky_events(tx_hash,log_index,block_number,time,payload)
        SELECT v->>'tx',(v->>'index')::integer,(v->>'block')::bigint,(v->>'time')::bigint,v FROM jsonb_array_elements($1::jsonb) v
        ON CONFLICT(tx_hash,log_index) DO UPDATE SET block_number=EXCLUDED.block_number,time=EXCLUDED.time,payload=EXCLUDED.payload`,[JSON.stringify(events)]);
      if(points.length) await c.query(`INSERT INTO sky_buckets(time,payload) SELECT (v->>'through')::bigint,v FROM jsonb_array_elements($1::jsonb) v
        ON CONFLICT(time) DO UPDATE SET payload=EXCLUDED.payload`,[JSON.stringify(points)]);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async rollupDay(day:number,point:Point) {
    await this.pool.query(`INSERT INTO sky_daily(day,payload) VALUES($1,$2::jsonb) ON CONFLICT(day) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`,[day,JSON.stringify(point)]);
  }
  async daysToRollup(today:number):Promise<number[]> {
    await this.initialize();const r=await this.pool.query<{day:string}>(`SELECT DISTINCT ((b.time-600)/86400)*86400 AS day FROM sky_buckets b
      LEFT JOIN sky_daily d ON d.day=((b.time-600)/86400)*86400 WHERE d.day IS NULL OR ((b.time-600)/86400)*86400 >= $1 ORDER BY day`,[today-86400]);return r.rows.map(r=>Number(r.day));
  }
  async recentTrades(from:number,to:number,limit=20) {
    await this.initialize();return (await this.pool.query<{payload:PoolEvent}>(`SELECT payload FROM sky_events WHERE time > $1 AND time <= $2 AND payload->>'kind'='swap' ORDER BY time DESC,log_index DESC LIMIT $3`,[from,to,limit])).rows.map(r=>r.payload);
  }
  async ping() {await this.pool.query('SELECT 1');}
  async close() {await this.pool.end();}
}
