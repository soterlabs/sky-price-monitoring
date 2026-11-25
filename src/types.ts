export interface Snapshot {
  time: number; block: string; hash: string; blockTime: number;
  skyRaw: string; usdsRaw: string; lpRaw: string;
  curve?:CurveState;
  reserveTime: number; cumulativeRaw: string; flapper: string;
}
export interface PoolEvent {
  kind: 'sync'|'swap'|'mint'|'burn'|'transfer'|'lpTransfer'|'deposit'|'withdraw'|'parameter'; time: number; block: string; tx: string; index: number;
  asset?:'token'|'usds';owner?:string;eventName?:string;
  values: string[]; sender: string; recipient: string; buyback: boolean;
}
export interface Point {
  from: number; through: number; duration: number; samples: number; complete: boolean;
  curve?:CurveState; vaultFlow?:VaultFlow; minGapBps?:number|null; maxGapBps?:number|null; otherUsdsRaw?:string;
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

export interface VaultFlow {depositRaw:string;withdrawRaw:string;mintRaw:string;burnRaw:string;deposits:number;withdrawals:number}
export interface CurveQuote {inputUsdsRaw:string;buyOutRaw:string|null;sellInRaw:string;sellOutRaw:string|null;previewRaw:string;capacitySufficient:boolean}
export interface CurveState {
 priceRaw:string;normalizedPriceRaw:string;oracleRaw:string;rate0Raw:string;rate1Raw:string;
 navRaw:string;redeemRaw:string;vaultSupplyRaw:string;totalAssetsRaw:string;capacityRaw:string;capacitySharesRaw:string;
 rawTokenRaw:string;rawUsdsRaw:string;adminTokenRaw:string;adminUsdsRaw:string;
 feeRaw:string;offpegRaw:string;ampRaw:string;chiRaw:string;rhoRaw:string;strRaw:string;artRaw:string;rateRaw:string;dutyRaw:string;jugRhoRaw:string;dueRaw:string;
 implementation:string;implementationHash:string;poolCodeHash:string;
 quotes:Record<string,CurveQuote>;buyDepthRaw?:string|null;sellDepthRaw?:string|null;
}
