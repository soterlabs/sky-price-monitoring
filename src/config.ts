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
  return {databaseUrl,rpcUrl,market:marketProfile(),defaultPeriod:period(process.env.DASHBOARD_DEFAULT_PERIOD ?? '24h'),
    backfillDays:integer('BACKFILL_DAYS',7,1,180),confirmations:integer('CONFIRMATIONS',12,2,256),port:integer('PORT',3000,1,65535)};
}

export function rangeSpec(range:Period,latestTime:number){
  const step=range==='60m'?300:range==='24h'||range==='7d'?600:86400;
  const end=Math.floor(latestTime/(range==='60m'?300:600))*(range==='60m'?300:600);
  const days=range==='24h'?1:Number(range.slice(0,-1));
  const from=range==='60m'?end-3600:step===600?end-days*86400:Math.floor(end/86400)*86400-(days-1)*86400;
  return {from,end,step,refreshSeconds:range==='60m'?300:600};
}

export type MarketId='sky'|'stusds';
export const markets={
 sky:{id:'sky',chainId:1,metricVersion:1,deployment:20663735,symbol:'SKY',pool:POOL,token:SKY,amm:'Uniswap V2',schema:'public',lockNamespace:734902,averageKind:'oracle-twap'},
 stusds:{id:'stusds',chainId:1,metricVersion:1,deployment:23219535,symbol:'stUSDS',pool:'0x2c7c98a3b1582d83c43987202aeff638312478ae',token:'0x99cd4ec3f88a45940936f469e4bb72a2a701eeb9',amm:'Curve StableSwap NG',schema:'stusds',lockNamespace:734903,averageKind:'sampled-trapezoid-5m'}
} as const;
export function marketProfile(value=process.env.MARKET_PROFILE??'sky'){
 if(value!=='sky'&&value!=='stusds')throw new Error('Invalid MARKET_PROFILE');return markets[value];
}
export type Market=ReturnType<typeof marketProfile>;
