export interface Snapshot {
  time: number; block: string; hash: string; blockTime: number;
  skyRaw: string; usdsRaw: string; lpRaw: string;
  reserveTime: number; cumulativeRaw: string; flapper: string;
}
export interface PoolEvent {
  kind: 'sync'|'swap'|'mint'|'burn'; time: number; block: string; tx: string; index: number;
  values: string[]; sender: string; recipient: string; buyback: boolean;
}
export interface Point {
  from: number; through: number; duration: number; samples: number; complete: boolean;
  open: number; high: number; low: number; close: number; twap: number;
  buyRaw: string; sellRaw: string; buybackRaw: string;
  skyBoughtRaw: string; skySoldRaw: string; skyBuybackRaw: string;
  buyCount: number; sellCount: number; buybackCount: number;
  flashCount?: number; flashSkyRaw?: string; flashUsdsRaw?: string;
  lpSkyRaw: string; lpUsdsRaw: string;
  skyRaw: string; usdsRaw: string; lpRaw: string;
}
export interface JobStatus {
  name: string; attemptedAt: string; succeededAt: string|null; error: string|null;
}
