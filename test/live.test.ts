import {it} from 'node:test';
import assert from 'node:assert/strict';
import {Rpc} from '../src/rpc.js';
import {POOL,SKY,USDS,FACTORY} from '../src/config.js';
import {selector} from '../src/rpc.js';
const word=(n:bigint)=>n.toString(16).padStart(64,'0');
class FakeRpc extends Rpc {
  blocks=0; reorg=false; calls:{method:string;params:unknown[]}[]=[];
  constructor(){super('https://unused.invalid');}
  override async block(){this.blocks++;return {number:'0x64',timestamp:'0x1234',hash:this.reorg&&this.blocks>1?'changed':'canonical'};}
  override async batch(calls:{method:string;params:unknown[]}[]){
    this.calls.push(...calls);
    return calls.map(c=>{if(c.method==='eth_chainId')return '0x1';const data=(c.params[0] as {data:string}).data;
      if(data.startsWith(selector('getReserves()')))return '0x'+word(100n)+word(20n)+word(4000n);
      if(data.startsWith(selector('token0()')))return '0x'+SKY.slice(2).padStart(64,'0');
      if(data.startsWith(selector('token1()')))return '0x'+USDS.slice(2).padStart(64,'0');
      if(data.startsWith(selector('factory()')))return '0x'+FACTORY.slice(2).padStart(64,'0');
      if(data.startsWith(selector('getPair(address,address)')))return '0x'+POOL.slice(2).padStart(64,'0');
      if(data.startsWith(selector('decimals()')))return '0x12';return '0x'+word(1n);
    });
  }
}
it('pins every live state read to one head and rejects a reorganized head',async()=>{
  const rpc=new FakeRpc();const s=await rpc.liveSnapshot();assert.equal(s.block,'100');assert.equal(s.blockTime,4660);assert.equal(s.skyRaw,'100');assert.equal(s.usdsRaw,'20');
  assert.ok(rpc.calls.filter(c=>c.method==='eth_call').every(c=>c.params[1]==='0x64'));
  const changed=new FakeRpc();changed.reorg=true;await assert.rejects(changed.liveSnapshot(),/reorganized/);
});
