import {keccak256,toHex} from 'viem';
import {POOL,SKY,USDS,SPLITTER,FACTORY} from './config.js';
import type {Snapshot,PoolEvent} from './types.js';
export const selector=(signature:string)=>keccak256(toHex(signature)).slice(0,10);
export const topic=(signature:string)=>keccak256(toHex(signature));
export const topics={sync:topic('Sync(uint112,uint112)'),swap:topic('Swap(address,uint256,uint256,uint256,uint256,address)'),mint:topic('Mint(address,uint256,uint256)'),burn:topic('Burn(address,uint256,uint256,address)')};
const execTopic=topic('Exec(uint256,uint256)');
type Call={method:string;params:unknown[]};
interface Block {number:string;timestamp:string;hash:string}
interface Log {address:string;topics:string[];data:string;transactionHash:string;logIndex:string;blockNumber:string;removed?:boolean}
const words=(data:string)=>{const s=data.slice(2);return Array.from({length:s.length/64},(_,i)=>BigInt('0x'+s.slice(i*64,i*64+64)));};
const addr=(v:string)=>'0x'+v.slice(-40).toLowerCase();
const wordAddr=(v:string)=>v.slice(2).padStart(64,'0');
const read=(to:string,sig:string,n:bigint,args=''):Call=>({method:'eth_call',params:[{to,data:selector(sig)+args},toHex(n)]});
export class Rpc {
  private id=0;
  constructor(private readonly url:string){}
  async batch(calls:Call[]):Promise<unknown[]> {
    if(!calls.length)return [];
    for(let attempt=0;attempt<4;attempt++) {
      try {
        const ids=calls.map(()=>++this.id);
        const response=await fetch(this.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(calls.map((c,i)=>({jsonrpc:'2.0',id:ids[i],...c}))),signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error(`RPC HTTP ${response.status}`);
        const body=await response.json() as {id:number;result?:unknown;error?:{code:number}}[];
        if(!Array.isArray(body))throw new Error('Invalid RPC batch response');
        const indexed=new Map(body.map(r=>[r.id,r]));
        return ids.map(id=>{const r=indexed.get(id);if(!r||r.error||r.result===undefined)throw new Error(`RPC ${calls[ids.indexOf(id)]!.method} failed (${r?.error?.code??'missing result'})`);return r.result;});
      } catch(error) {if(attempt===3)throw error;await new Promise(r=>setTimeout(r,500*2**attempt));}
    }
    throw new Error('RPC unavailable');
  }
  async many(calls:Call[]):Promise<unknown[]> {
    const out:unknown[]=[];
    for(let i=0;i<calls.length;i+=60) {
      const chunks=[];for(let j=i;j<Math.min(i+60,calls.length);j+=20)chunks.push(calls.slice(j,j+20));
      const groups=await Promise.all(chunks.map(c=>this.batch(c)));out.push(...groups.flat());
    }return out;
  }
  async block(n:bigint|'latest'):Promise<Block> {
    const b=(await this.batch([{method:'eth_getBlockByNumber',params:[n==='latest'?'latest':toHex(n),false]}]))[0] as Block|null;
    if(!b)throw new Error('RPC block unavailable');return b;
  }
  async verify(n:bigint) {
    const v=await this.many([{method:'eth_chainId',params:[]},...['token0()','token1()','factory()'].map(s=>read(POOL,s,n)),read(SKY,'decimals()',n),read(USDS,'decimals()',n),read(FACTORY,'getPair(address,address)',n,wordAddr(SKY)+wordAddr(USDS))]) as string[];
    if(BigInt(v[0]!)!==1n||addr(v[1]!)!==SKY||addr(v[2]!)!==USDS||addr(v[3]!)!==FACTORY||BigInt(v[4]!)!==18n||BigInt(v[5]!)!==18n||addr(v[6]!)!==POOL)throw new Error('Pool identity verification failed');
  }
  async boundaries(times:number[],head:Block):Promise<Snapshot[]> {
    const hn=BigInt(head.number),ht=Number(BigInt(head.timestamp));
    let guesses=times.map(t=>hn-BigInt(Math.floor((ht-t)/12)));
    for(let iteration=0;iteration<8;iteration++) {
      const bs=await this.many(guesses.map(n=>({method:'eth_getBlockByNumber',params:[toHex(n),false]}))) as Block[];
      if(bs.some(b=>!b))throw new Error('Historical block unavailable');
      const adjusted=guesses.map((n,i)=>n+BigInt(Math.floor((times[i]!-Number(BigInt(bs[i]!.timestamp)))/12)));
      if(adjusted.every((n,i)=>n===guesses[i]))break;guesses=adjusted;
    }
    const bs=await this.many(guesses.map(n=>({method:'eth_getBlockByNumber',params:[toHex(n),false]}))) as Block[];
    const nexts=await this.many(guesses.map(n=>({method:'eth_getBlockByNumber',params:[toHex(n+1n),false]}))) as Block[];
    for(let i=0;i<times.length;i++) {
      let b=bs[i]!,next=nexts[i]!;
      if(!b||!next)throw new Error('Historical block unavailable');
      while(Number(BigInt(b.timestamp))>times[i]!) {guesses[i]=guesses[i]!-1n;b=await this.block(guesses[i]!);}
      while(Number(BigInt(next.timestamp))<=times[i]!) {guesses[i]=guesses[i]!+1n;b=next;next=await this.block(guesses[i]!+1n);}
      if(!(Number(BigInt(b.timestamp))<=times[i]!&&Number(BigInt(next.timestamp))>times[i]!))throw new Error('Timestamp boundary verification failed');
      bs[i]=b;
    }
    const values=await this.many(guesses.flatMap(n=>[read(POOL,'getReserves()',n),read(POOL,'price0CumulativeLast()',n),read(POOL,'totalSupply()',n),read(SPLITTER,'flapper()',n)])) as string[];
    return times.map((time,i)=> {
      const [s,u,t]=words(values[4*i]!);if(!s||!u||t===undefined)throw new Error('Invalid pool reserves');
      return {time,block:String(guesses[i]!),hash:bs[i]!.hash,blockTime:Number(BigInt(bs[i]!.timestamp)),skyRaw:String(s),usdsRaw:String(u),reserveTime:Number(t),cumulativeRaw:String(BigInt(values[4*i+1]!)),lpRaw:String(BigInt(values[4*i+2]!)),flapper:addr(values[4*i+3]!)};
    });
  }
  async logs(from:bigint,to:bigint,address:string|string[],topic0:string[]):Promise<Log[]> {
    if(from>to)return [];
    const calls:Call[]=[];for(let n=from;n<=to;n+=2000n)calls.push({method:'eth_getLogs',params:[{address,fromBlock:toHex(n),toBlock:toHex(n+1999n<to?n+1999n:to),topics:[topic0]}]});
    const groups=await this.many(calls) as Log[][];
    return [...new Map(groups.flat().filter(l=>!l.removed).map(l=>[`${l.transactionHash}:${l.logIndex}`,l])).values()].sort((a,b)=>Number(BigInt(a.blockNumber)-BigInt(b.blockNumber))||Number(BigInt(a.logIndex)-BigInt(b.logIndex)));
  }
  async events(snapshots:Snapshot[]):Promise<PoolEvent[]> {
    const a=snapshots[0]!,b=snapshots.at(-1)!;
    const logs=await this.logs(BigInt(a.block)+1n,BigInt(b.block),POOL,Object.values(topics));
    const flappers=[...new Set(snapshots.map(s=>s.flapper))];
    const execs=await this.logs(BigInt(a.block)+1n,BigInt(b.block),flappers,[execTopic]);
    const blockNumbers=[...new Set(logs.map(l=>l.blockNumber))];
    const headers=await this.many(blockNumbers.map(n=>({method:'eth_getBlockByNumber',params:[n,false]}))) as Block[];
    if(headers.some(b=>!b))throw new Error('Event block timestamp unavailable');
    const timestamps=new Map(headers.map(h=>[h.number,Number(BigInt(h.timestamp))]));
    const execMap=new Map<string,[bigint,bigint]>();
    for(const e of execs){const key=e.transactionHash+':'+e.address.toLowerCase(),v=words(e.data),previous=execMap.get(key)??[0n,0n];execMap.set(key,[previous[0]+v[0]!,previous[1]+v[1]!]);}
    const output=logs.map(l=> {
      const kind=(Object.keys(topics) as (keyof typeof topics)[]).find(k=>topics[k]===l.topics[0]);if(!kind)throw new Error('Unknown pool event');
      const time=timestamps.get(l.blockNumber);if(time===undefined||time<=a.time||time>b.time)throw new Error('Event outside snapshot window');
      const sender=l.topics[1]?addr(l.topics[1]):'',recipient=l.topics[2]?addr(l.topics[2]):'';
      return {kind,time,block:String(BigInt(l.blockNumber)),tx:l.transactionHash,index:Number(BigInt(l.logIndex)),values:words(l.data).map(String),sender,recipient,buyback:kind==='swap'&&execMap.has(l.transactionHash+':'+sender)};
    });
    for(const e of output.filter(e=>e.kind==='swap'&&flappers.includes(e.sender))) {
      if(!e.buyback)throw new Error('Configured Flapper swap missing its Exec event');
    }
    for(const [key,[lot,bought]] of execMap) {
      const swaps=output.filter(e=>e.kind==='swap'&&e.tx+':'+e.sender===key);
      if(swaps.reduce((s,e)=>s+BigInt(e.values[1]!),0n)!==lot||swaps.reduce((s,e)=>s+BigInt(e.values[2]!),0n)!==bought)throw new Error('Protocol buyback amounts do not match pool swaps');
    }
    return output;
  }
}
