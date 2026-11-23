export const POOL = '0x2621cc0b3f3c079c1db0e80794aa24976f0b9e3c' as const;
export const SKY = '0x56072c95faa701256059aa122697b133aded9279' as const;
export const USDS = '0xdc035d45d973e3ec169d2276ddab16f1e407384f' as const;
export const SPLITTER = '0xbf7111f13386d23cb2fba5a538107a73f6872bcf' as const;
export const FACTORY = '0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f' as const;
export const periods = ['60m','24h','7d','30d','90d','180d'] as const;
export type Period = typeof periods[number];
export function period(value: string): Period {
  if (!(periods as readonly string[]).includes(value)) throw new Error('Invalid period');
  return value as Period;
}
export function integer(name: string, fallback: number, min: number, max: number): number {
  const v = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new Error(`Invalid ${name}`);
  return v;
}
export function config() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const rpcUrl = process.env.ETH_RPC;
  if (!rpcUrl) throw new Error('ETH_RPC is required');
  if (!['http:','https:'].includes(new URL(rpcUrl).protocol)) throw new Error('Invalid ETH_RPC');
  return {databaseUrl,rpcUrl,defaultPeriod:period(process.env.DASHBOARD_DEFAULT_PERIOD ?? '24h'),
    backfillDays:integer('BACKFILL_DAYS',7,1,180),confirmations:integer('CONFIRMATIONS',12,2,256),port:integer('PORT',3000,1,65535)};
}

export function rangeSpec(range:Period,latestTime:number){
  const step=range==='60m'?300:range==='24h'||range==='7d'?600:86400;
  const end=Math.floor(latestTime/(range==='60m'?300:600))*(range==='60m'?300:600);
  const days=range==='24h'?1:Number(range.slice(0,-1));
  const from=range==='60m'?end-3600:step===600?end-days*86400:Math.floor(end/86400)*86400-(days-1)*86400;
  return {from,end,step,refreshSeconds:range==='60m'?300:600};
}
