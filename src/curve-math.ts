import type {CurveState,Point,PoolEvent,Snapshot,VaultFlow} from './types.js';
export const WAD=10n**18n,RAY=10n**27n;
export function rpow(x:bigint,n:bigint){let z=n%2n?x:RAY;for(n/=2n;n;n/=2n){x=(x*x+RAY/2n)/RAY;if(n%2n)z=(z*x+RAY/2n)/RAY;}return z;}
export function headroom(total:bigint,chi:bigint,art:bigint,rate:bigint,due:bigint){const unused=total*chi-art*rate-due;return {assets:unused>0n?unused/RAY:0n,shares:chi>0n&&unused>0n?unused/chi:0n};}
export const gapBps=(priceRaw:string,referenceRaw:string)=>BigInt(referenceRaw)>0n?(Number(BigInt(priceRaw))/Number(BigInt(referenceRaw))-1)*10000:null;
export const emptyVaultFlow=():VaultFlow=>({depositRaw:'0',withdrawRaw:'0',mintRaw:'0',burnRaw:'0',deposits:0,withdrawals:0});
const u=(v:string|bigint)=>Number(BigInt(v))/1e18;
export function curveDepth(p:{skyRaw:string;usdsRaw:string;curve:CurveState}){
 const c=p.curve,price=u(c.priceRaw),usds=u(p.usdsRaw),sky=u(p.skyRaw);
 const quote=(key:string)=>{const q=c.quotes[key];if(!q)return{buyPercent:null,sellPercent:null};const buy=q.buyOutRaw&&BigInt(q.buyOutRaw)>0n?(u(q.inputUsdsRaw)/u(q.buyOutRaw)/price-1)*100:null;const sell=q.sellOutRaw&&BigInt(q.sellInRaw)>0n?(1-u(q.sellOutRaw)/u(q.sellInRaw)/price)*100:null;return{buyPercent:buy,sellPercent:sell};};
 return{usds,sky,token:sky,tvlUsds:usds+sky*price,referenceTvlUsds:usds+sky*u(c.navRaw),quote10k:quote('10k'),quote100k:quote('100k'),buyDepth1Percent:c.buyDepthRaw==null?null:u(c.buyDepthRaw),sellDepth1Percent:c.sellDepthRaw==null?null:u(c.sellDepthRaw)};
}
export function displayVault(c:CurveState){
 return {navPrice:u(c.navRaw),referencePrice:u(c.redeemRaw),gapBps:gapBps(c.priceRaw,c.redeemRaw),gapPercent:gapBps(c.priceRaw,c.redeemRaw)==null?null:gapBps(c.priceRaw,c.redeemRaw)!/100,deltaUsds:u(c.priceRaw)-u(c.redeemRaw),capacityUsds:u(c.capacityRaw),capacityShares:u(c.capacitySharesRaw),capacityPercent:BigInt(c.totalAssetsRaw)>0n?Number(BigInt(c.capacityRaw))*100/Number(BigInt(c.totalAssetsRaw)):null,totalAssets:u(c.totalAssetsRaw),supplyShares:u(c.vaultSupplyRaw),emaPrice:u(c.oracleRaw),quotes:Object.fromEntries(Object.entries(c.quotes).map(([key,q])=>[key,{notionalUsds:u(q.inputUsdsRaw),shares:u(q.sellInRaw),curveUsds:q.sellOutRaw==null?null:u(q.sellOutRaw),vaultUsds:u(q.previewRaw),exitGapBps:q.sellOutRaw==null?null:gapBps(q.sellOutRaw,q.previewRaw),capacitySufficient:q.capacitySufficient}]))};
}
export function displayVaultFlow(v:VaultFlow){return{depositUsds:u(v.depositRaw),withdrawUsds:u(v.withdrawRaw),netUsds:u(v.depositRaw)-u(v.withdrawRaw),mintShares:u(v.mintRaw),burnShares:u(v.burnRaw),deposits:v.deposits,withdrawals:v.withdrawals};}
export function makeCurvePoints(snapshots:Snapshot[],events:PoolEvent[]):Point[]{
 const output:Point[]=[];
 for(let i=1;i<snapshots.length;i++){
  const a=snapshots[i-1]!,b=snapshots[i]!,ac=a.curve!,bc=b.curve!;if(!ac||!bc||b.time-a.time!==300)throw new Error('Non-consecutive Curve snapshots');
  const rows=events.filter(e=>BigInt(e.block)>BigInt(a.block)&&BigInt(e.block)<=BigInt(b.block));
  let tokenDelta=0n,usdsDelta=0n,lpDelta=0n,buy=0n,sell=0n,bought=0n,sold=0n,buyCount=0,sellCount=0,minted=0n,burned=0n;
  const v=emptyVaultFlow(),lpTransactions=new Set(rows.filter(e=>e.kind==='mint'||e.kind==='burn').map(e=>e.tx));let lpUsds=0n,lpToken=0n,otherUsds=0n;
  for(const e of rows){
   if(e.eventName==='VaultMint')minted+=BigInt(e.asset==='token'?e.values[0]!.replace('-',''):e.values[0]!);
   if(e.eventName==='VaultBurn')burned+=BigInt(e.asset==='token'?e.values[0]!.replace('-',''):e.values[0]!);
   if(e.kind==='transfer'){const n=BigInt(e.values[0]!);if(e.asset==='token')tokenDelta+=n;else usdsDelta+=n;if(lpTransactions.has(e.tx)){if(e.asset==='token')lpToken+=n;else lpUsds+=n;}else if(e.asset==='usds')otherUsds+=n;}
   if(e.kind==='lpTransfer')lpDelta+=BigInt(e.values[0]!);
   if(e.kind==='swap'){const [si,ui,so,uo]=e.values.map(BigInt) as[bigint,bigint,bigint,bigint];if(si>0n&&uo>0n){sell+=uo;sold+=si;sellCount++;}else if(ui>0n&&so>0n){buy+=ui;bought+=so;buyCount++;}else throw new Error('Unsupported Curve exchange');if(lpTransactions.has(e.tx)){lpToken-=si-so;lpUsds-=ui-uo;}else otherUsds-=ui-uo;}
   if(e.kind==='deposit'){v.depositRaw=String(BigInt(v.depositRaw)+BigInt(e.values[0]!));v.mintRaw=String(BigInt(v.mintRaw)+BigInt(e.values[1]!));v.deposits++;}
   if(e.kind==='withdraw'){v.withdrawRaw=String(BigInt(v.withdrawRaw)+BigInt(e.values[0]!));v.burnRaw=String(BigInt(v.burnRaw)+BigInt(e.values[1]!));v.withdrawals++;}
  }
  if(BigInt(ac.rawTokenRaw)+tokenDelta!==BigInt(bc.rawTokenRaw)||BigInt(ac.rawUsdsRaw)+usdsDelta!==BigInt(bc.rawUsdsRaw))throw new Error('Curve physical token ledger does not reconcile');
  if(BigInt(a.lpRaw)+lpDelta!==BigInt(b.lpRaw))throw new Error('Curve LP supply ledger does not reconcile');
  if(minted!==BigInt(v.mintRaw)||burned!==BigInt(v.burnRaw))throw new Error('Vault deposit/withdraw events do not reconcile to share mint/burn transfers');
  if(BigInt(ac.vaultSupplyRaw)+BigInt(v.mintRaw)-BigInt(v.burnRaw)!==BigInt(bc.vaultSupplyRaw))throw new Error('Vault share issuance does not reconcile');
  const prices=[u(ac.priceRaw),u(bc.priceRaw)],gaps=[gapBps(ac.priceRaw,ac.redeemRaw),gapBps(bc.priceRaw,bc.redeemRaw)].filter((n):n is number=>n!==null);
  output.push({from:a.time,through:b.time,duration:300,samples:1,complete:true,open:prices[0]!,close:prices[1]!,high:Math.max(...prices),low:Math.min(...prices),twap:(prices[0]!+prices[1]!)/2,buyRaw:String(buy),sellRaw:String(sell),buybackRaw:'0',skyBoughtRaw:String(bought),skySoldRaw:String(sold),skyBuybackRaw:'0',buyCount,sellCount,buybackCount:0,lpSkyRaw:String(lpToken),lpUsdsRaw:String(lpUsds),otherUsdsRaw:String(otherUsds),skyRaw:b.skyRaw,usdsRaw:b.usdsRaw,lpRaw:b.lpRaw,curve:bc,vaultFlow:v,minGapBps:gaps.length?Math.min(...gaps):null,maxGapBps:gaps.length?Math.max(...gaps):null});
 }
 return output;
}
