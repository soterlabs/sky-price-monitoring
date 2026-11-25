import{decodeEventLog,keccak256,parseAbi,toHex,toEventSelector,type Hex}from'viem';
import{Rpc,addr,words,read,topic,type Block,type Call}from'./rpc.js';
import{markets,USDS}from'./config.js';
import{curveEvents}from'./curve-abi.js';
import{WAD,RAY,rpow,headroom}from'./curve-math.js';
import type{Snapshot,PoolEvent,CurveState,CurveQuote}from'./types.js';
export const STUSDS=markets.stusds.token,CURVE_POOL=markets.stusds.pool;
export const CURVE_FACTORY='0x6a8cbed756804b16e05e741edabd5cb544ae21bf';
export const STUSDS_DEPLOY=23219535;
const IMPLEMENTATION='0x7a61b7adcfd493f7cf0f86dfcecb94b72c227f22';
const POOL_HASH='0x609cfd86731e3c2138ab004e263bd5b78074454cf09ddb0a37cbe3a9a20e06cd';
const VAULT_HASH='0x5ec91832daf3d00586187a409bd6c2d787e0e714cc4f20d37577c95e46d248cb';
const SLOT='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ZERO='0x'+'0'.repeat(40),w=(n:bigint|number)=>BigInt(n).toString(16).padStart(64,'0'),wa=(a:string)=>a.slice(2).padStart(64,'0');
const transferTopic=topic('Transfer(address,address,uint256)');
const vaultEvents=parseAbi(['event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)','event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)','event Cut(uint256 assets,uint256 oldChi,uint256 newChi)','event File(bytes32 indexed what,uint256 data)']);
const poolTopics=curveEvents.map(e=>toEventSelector(e)),vaultTopics=vaultEvents.map(e=>toEventSelector(e));
export class CurveRpc extends Rpc{
 private context:{vat:string;jug:string;clip:string;ilk:string}|undefined;
 override async verify(n:bigint){
  const values=await this.many([{method:'eth_chainId',params:[]},read(CURVE_POOL,'coins(uint256)',n,w(0)),read(CURVE_POOL,'coins(uint256)',n,w(1)),read(STUSDS,'asset()',n),read(STUSDS,'decimals()',n),read(USDS,'decimals()',n),read(CURVE_FACTORY,'find_pool_for_coins(address,address,uint256)',n,wa(USDS)+wa(STUSDS)+w(0)),read(CURVE_FACTORY,'get_pool_asset_types(address)',n,wa(CURVE_POOL)),{method:'eth_getStorageAt',params:[STUSDS,SLOT,toHex(n)]},{method:'eth_getCode',params:[CURVE_POOL,toHex(n)]},{method:'eth_getCode',params:[IMPLEMENTATION,toHex(n)]}])as string[];
  const types=words(values[7]!).slice(2);
  if(BigInt(values[0]!)!==1n||addr(values[1]!)!==USDS||addr(values[2]!)!==STUSDS||addr(values[3]!)!==USDS||BigInt(values[4]!)!==18n||BigInt(values[5]!)!==18n||addr(values[6]!)!==CURVE_POOL||types.length!==2||types[0]!==0n||types[1]!==3n||addr(values[8]!)!==IMPLEMENTATION||keccak256(values[9]! as Hex)!==POOL_HASH||keccak256(values[10]! as Hex)!==VAULT_HASH)throw new Error('Curve or stUSDS contract identity mismatch');
  const ctx=await this.many(['vat()','jug()','clip()','ilk()'].map(sig=>read(STUSDS,sig,n)))as string[];
  this.context={vat:addr(ctx[0]!),jug:addr(ctx[1]!),clip:addr(ctx[2]!),ilk:ctx[3]!.slice(2)};
 }
 override async liveSnapshot(){const h=await this.block('latest');await this.verify(BigInt(h.number));const [s]=await this.snapshots([Number(BigInt(h.timestamp))],[h],true);if((await this.block(BigInt(h.number))).hash!==h.hash)throw new Error('Live block was reorganized; retry');return s!;}
 override async boundaries(times:number[],head:Block){const blocks=await this.boundaryBlocks(times,head);return this.snapshots(times,blocks,true);}
 async snapshots(times:number[],blocks:Block[],withDepth=false):Promise<Snapshot[]>{
  if(!blocks.length)return[];if(!this.context)await this.verify(BigInt(blocks.at(-1)!.number));const ctx=this.context!;
  const core=(n:bigint):Call[]=>[
   read(CURVE_POOL,'balances(uint256)',n,w(0)),read(CURVE_POOL,'balances(uint256)',n,w(1)),read(USDS,'balanceOf(address)',n,wa(CURVE_POOL)),read(STUSDS,'balanceOf(address)',n,wa(CURVE_POOL)),read(CURVE_POOL,'admin_balances(uint256)',n,w(0)),read(CURVE_POOL,'admin_balances(uint256)',n,w(1)),
   read(CURVE_POOL,'stored_rates()',n),read(CURVE_POOL,'get_p(uint256)',n,w(0)),read(CURVE_POOL,'price_oracle(uint256)',n,w(0)),read(CURVE_POOL,'totalSupply()',n),read(CURVE_POOL,'A()',n),read(CURVE_POOL,'fee()',n),read(CURVE_POOL,'offpeg_fee_multiplier()',n),
   read(STUSDS,'convertToAssets(uint256)',n,w(WAD)),read(STUSDS,'previewRedeem(uint256)',n,w(WAD)),read(STUSDS,'totalSupply()',n),read(STUSDS,'totalAssets()',n),read(STUSDS,'chi()',n),read(STUSDS,'rho()',n),read(STUSDS,'str()',n),
   read(ctx.vat,'ilks(bytes32)',n,ctx.ilk),read(ctx.jug,'ilks(bytes32)',n,ctx.ilk),read(ctx.clip,'Due()',n),read(STUSDS,'maxWithdraw(address)',n,wa(CURVE_POOL)),read(STUSDS,'maxRedeem(address)',n,wa(CURVE_POOL)),{method:'eth_getStorageAt',params:[STUSDS,SLOT,toHex(n)]}
  ];
  const values=await this.many(blocks.flatMap(b=>core(BigInt(b.number))))as string[],width=26;
  const output=blocks.map((b,i):Snapshot=>{
   const v=values.slice(i*width,(i+1)*width),rates=words(v[6]!).slice(2),vat=words(v[20]!),jug=words(v[21]!),ts=Number(BigInt(b.timestamp));
   if(rates.length!==2||rates[0]!==WAD||rates[1]!<=0n||addr(v[25]!)!==IMPLEMENTATION)throw new Error('Unsupported historical Curve or vault implementation');
   const chi0=BigInt(v[17]!),rho=BigInt(v[18]!),str=BigInt(v[19]!),chi=(BigInt(ts)>rho?rpow(str,BigInt(ts)-rho)*chi0/RAY:chi0),rate=(BigInt(ts)>jug[1]!?rpow(jug[0]!,BigInt(ts)-jug[1]!)*vat[1]!/RAY:vat[1]!),supply=BigInt(v[15]!),cap=headroom(supply,chi,vat[0]!,rate,BigInt(v[22]!)),poolShares=BigInt(v[3]!);
   if(BigInt(v[13]!)!==chi*WAD/RAY||BigInt(v[16]!)!==supply*chi/RAY||rates[1]!==BigInt(v[13]!))throw new Error('Vault accrual does not reconcile to ERC4626 views');
   const min=(a:bigint,b:bigint)=>a<b?a:b;
   if(BigInt(v[23]!)!==min(poolShares*chi/RAY,cap.assets)||BigInt(v[24]!)!==min(poolShares,cap.shares))throw new Error('Vault capacity does not reconcile to owner limits');
   if(BigInt(v[0]!)+BigInt(v[4]!)>BigInt(v[2]!)||BigInt(v[1]!)+BigInt(v[5]!)>poolShares)throw new Error('Curve balances exceed physical balances');
   const price=BigInt(v[7]!)*rates[1]!/rates[0]!;if(price<=0n)throw new Error('Curve price unavailable');
   const c:CurveState={priceRaw:String(price),normalizedPriceRaw:String(BigInt(v[7]!)),oracleRaw:String(BigInt(v[8]!)*rates[1]!/rates[0]!),rate0Raw:String(rates[0]),rate1Raw:String(rates[1]),navRaw:String(BigInt(v[13]!)),redeemRaw:String(BigInt(v[14]!)),vaultSupplyRaw:String(supply),totalAssetsRaw:String(BigInt(v[16]!)),capacityRaw:String(cap.assets),capacitySharesRaw:String(cap.shares),rawTokenRaw:String(poolShares),rawUsdsRaw:String(BigInt(v[2]!)),adminTokenRaw:String(BigInt(v[5]!)),adminUsdsRaw:String(BigInt(v[4]!)),feeRaw:String(BigInt(v[11]!)),offpegRaw:String(BigInt(v[12]!)),ampRaw:String(BigInt(v[10]!)),chiRaw:String(chi0),rhoRaw:String(rho),strRaw:String(str),artRaw:String(vat[0]),rateRaw:String(vat[1]),dutyRaw:String(jug[0]),jugRhoRaw:String(jug[1]),dueRaw:String(BigInt(v[22]!)),implementation:IMPLEMENTATION,implementationHash:VAULT_HASH,poolCodeHash:POOL_HASH,quotes:{}};
   return{time:times[i]!,block:String(BigInt(b.number)),hash:b.hash,blockTime:ts,skyRaw:String(BigInt(v[1]!)),usdsRaw:String(BigInt(v[0]!)),lpRaw:String(BigInt(v[9]!)),reserveTime:ts,cumulativeRaw:'0',flapper:ZERO,curve:c};
  });
  const quoteCalls=output.flatMap(s=>{const n=BigInt(s.block),price=BigInt(s.curve!.priceRaw);return[10_000n,100_000n].flatMap(size=>{const q=size*WAD*WAD/price;return[read(CURVE_POOL,'get_dy(int128,int128,uint256)',n,w(0)+w(1)+w(size*WAD)),read(CURVE_POOL,'get_dy(int128,int128,uint256)',n,w(1)+w(0)+w(q)),read(STUSDS,'previewRedeem(uint256)',n,w(q))];}).concat([read(CURVE_POOL,'get_dy(int128,int128,uint256)',n,w(1)+w(0)+w(WAD)),read(CURVE_POOL,'get_dy(int128,int128,uint256)',n,w(0)+w(1)+w(WAD))]);});
  const quotes=await this.many(quoteCalls,true)as(string|null)[];
  output.forEach((s,i)=>{const c=s.curve!,price=BigInt(c.priceRaw),v=quotes.slice(i*8,(i+1)*8);for(const [j,key,size]of[[0,'10k',10_000n],[1,'100k',100_000n]]as const){const shares=size*WAD*WAD/price;if(v[j*3+2]===null)throw new Error('Vault redemption preview unavailable');c.quotes[key]={inputUsdsRaw:String(size*WAD),buyOutRaw:v[j*3]==null?null:String(BigInt(v[j*3]!)),sellInRaw:String(shares),sellOutRaw:v[j*3+1]==null?null:String(BigInt(v[j*3+1]!)),previewRaw:String(BigInt(v[j*3+2]!)),capacitySufficient:shares<=BigInt(c.capacitySharesRaw)};}
   if(v[6]&&BigInt(v[6])>price+10000n||v[7]&&price*BigInt(v[7])>WAD*WAD+10n**24n)throw new Error('Curve spot fails executable bid/ask normalization check');
  });
  if(withDepth){const last=output.at(-1)!.time,coarse=Math.floor(last/600)*600;for(const s of output.filter(s=>s.time===last||s.time===coarse)){const [buy,sell]=await this.depth(s);s.curve!.buyDepthRaw=buy;s.curve!.sellDepthRaw=sell;}}
  return output;
 }
 private async depth(s:Snapshot){
  const price=BigInt(s.curve!.priceRaw),upper=(BigInt(s.usdsRaw)+BigInt(s.skyRaw)*price/WAD)*10n,n=BigInt(s.block);
  const low=[0n,0n],high=[upper,upper];
  for(let i=0;i<24;i++){
   const mid=low.map((l,j)=>(l+high[j]!)/2n),calls=mid.map((amount,j)=>read(CURVE_POOL,'get_dy(int128,int128,uint256)',n,j===0?w(0)+w(1)+w(amount):w(1)+w(0)+w(amount*WAD/price)));
   const values=await this.many(calls,true)as(string|null)[];
   for(let j=0;j<2;j++){const out=values[j]==null?0n:BigInt(values[j]!);const good=out>0n&&(j===0?mid[j]!*WAD*100n<=out*price*101n:out*WAD*100n>=(mid[j]!*WAD/price)*price*99n);if(good)low[j]=mid[j]!;else high[j]=mid[j]!;}
  }
  // The result is a conservative lower bound at the binary-search resolution.
  return low.map(v=>String(v))as[string|null,string|null];
 }
 override async events(snapshots:Snapshot[]):Promise<PoolEvent[]>{
  const a=snapshots[0]!,b=snapshots.at(-1)!,from=BigInt(a.block)+1n,to=BigInt(b.block),poolWord='0x'+wa(CURVE_POOL),zeroWord='0x'+wa(ZERO);
  const [poolLogs,vaultLogs,tokenIn,tokenOut,usdsIn,usdsOut,mints,burns]=await Promise.all([
   this.logs(from,to,CURVE_POOL,poolTopics),this.logs(from,to,STUSDS,vaultTopics),this.logs(from,to,STUSDS,[transferTopic],2000n,[null,poolWord]),this.logs(from,to,STUSDS,[transferTopic],2000n,[poolWord]),this.logs(from,to,USDS,[transferTopic],2000n,[null,poolWord]),this.logs(from,to,USDS,[transferTopic],2000n,[poolWord]),this.logs(from,to,STUSDS,[transferTopic],2000n,[zeroWord]),this.logs(from,to,STUSDS,[transferTopic],2000n,[null,zeroWord])]);
  const logs=[...new Map([...poolLogs,...vaultLogs,...tokenIn,...tokenOut,...usdsIn,...usdsOut,...mints,...burns].map(l=>[l.transactionHash+':'+l.logIndex,l])).values()];
  const headers=await this.many([...new Set(logs.map(l=>l.blockNumber))].map(number=>({method:'eth_getBlockByNumber',params:[number,false]})))as Block[];const times=new Map(headers.map(h=>[h.number,Number(BigInt(h.timestamp))]));
  const output:PoolEvent[]=[];
  for(const l of logs){const time=times.get(l.blockNumber);if(time===undefined||time<=a.time||time>b.time)throw new Error('Curve event outside snapshot window');const base={time,block:String(BigInt(l.blockNumber)),tx:l.transactionHash,index:Number(BigInt(l.logIndex)),buyback:false},address=l.address.toLowerCase();
   if(l.topics[0]===transferTopic){const f=addr(l.topics[1]!),t=addr(l.topics[2]!),value=BigInt(l.data);
    if(address===CURVE_POOL){if(f===ZERO||t===ZERO)output.push({...base,kind:'lpTransfer',sender:f,recipient:t,values:[String(f===ZERO?value:-value)]});}
    else if(f===CURVE_POOL||t===CURVE_POOL)output.push({...base,kind:'transfer',asset:address===STUSDS?'token':'usds',eventName:address===STUSDS&&f===ZERO?'VaultMint':address===STUSDS&&t===ZERO?'VaultBurn':'Transfer',sender:f,recipient:t,values:[String((t===CURVE_POOL?value:0n)-(f===CURVE_POOL?value:0n))]});
    else if(address===STUSDS&&(f===ZERO||t===ZERO))output.push({...base,kind:'parameter',eventName:f===ZERO?'VaultMint':'VaultBurn',sender:f,recipient:t,values:[String(value)]});
    continue;
   }
   if(address===CURVE_POOL){const decoded=decodeEventLog({abi:curveEvents,data:l.data as Hex,topics:l.topics as[Hex,...Hex[]]}),name=decoded.eventName,args=decoded.args as unknown as Record<string,unknown>;
    if(name==='TokenExchange'||name==='TokenExchangeUnderlying'){const sold=Number(args.sold_id),bought=Number(args.bought_id);if(!((sold===0&&bought===1)||(sold===1&&bought===0)))throw new Error('Unexpected Curve coin index');const amount=String(args.tokens_sold),out=String(args.tokens_bought);output.push({...base,kind:'swap',eventName:name,sender:String(args.buyer).toLowerCase(),recipient:'',values:sold===0?['0',amount,out,'0']:[amount,'0','0',out]});}
    else if(name==='AddLiquidity'||name.startsWith('RemoveLiquidity')){const amounts=args.token_amounts as bigint[]|undefined;output.push({...base,kind:name==='AddLiquidity'?'mint':'burn',eventName:name,sender:String(args.provider).toLowerCase(),recipient:'',values:amounts?[String(amounts[1]),String(amounts[0])]:[]});}
    else output.push({...base,kind:'parameter',eventName:name,sender:'',recipient:'',values:words(l.data).map(String)});
   }else{const decoded=decodeEventLog({abi:vaultEvents,data:l.data as Hex,topics:l.topics as[Hex,...Hex[]]}),args=decoded.args as unknown as Record<string,unknown>;if(decoded.eventName==='Deposit'||decoded.eventName==='Withdraw')output.push({...base,kind:decoded.eventName==='Deposit'?'deposit':'withdraw',eventName:decoded.eventName,sender:String(args.sender).toLowerCase(),recipient:String(args.receiver??args.owner).toLowerCase(),owner:String(args.owner).toLowerCase(),values:[String(args.assets),String(args.shares)]});else output.push({...base,kind:'parameter',eventName:decoded.eventName,sender:'',recipient:'',values:words(l.data).map(String)});}
  }
  return output.sort((a,b)=>Number(BigInt(a.block)-BigInt(b.block))||a.index-b.index);
 }
}
