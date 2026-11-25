import {createServer,type ServerResponse} from 'node:http';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {config,period,type Period} from './config.js';
import {Store} from './store.js';
import {dashboardData} from './view.js';
import {Rpc} from './rpc.js';
import {depth,spot} from './math.js';
import {holderData} from './holders.js';
import {CurveRpc} from './curve.js';
import {displayVault} from './curve-math.js';
import {renderHtml} from './html.js';
import {safeError} from './errors.js';
const c=config(),store=new Store(c.databaseUrl,c.market.id);
const root=new URL('../public/',import.meta.url);
const appJs=readFileSync(new URL('app.js',root)),stylesCss=readFileSync(new URL('styles.css',root));
const assetVersion=createHash('sha256').update(appJs).update(stylesCss).digest('hex').slice(0,12);
const files=new Map([
  ['/',{type:'text/html; charset=utf-8',body:renderHtml(readFileSync(new URL('index.html',root),'utf8'),c.market,c.defaultPeriod,assetVersion)}],
  ['/app.js',{type:'text/javascript; charset=utf-8',body:appJs}],
  ['/styles.css',{type:'text/css; charset=utf-8',body:stylesCss}],
  ['/favicon.svg',{type:'image/svg+xml',body:readFileSync(new URL('favicon.svg',root))}],
  ['/soter-labs.png',{type:'image/png',body:readFileSync(new URL('soter-labs.png',root))}],
  ['/deltha.otf',{type:'font/otf',body:readFileSync(new URL('deltha.otf',root))}],
]);
const rpc=c.market.id==='stusds'?new CurveRpc(c.rpcUrl):new Rpc(c.rpcUrl);
let livePending:Promise<unknown>|undefined;
function live(){return livePending??=rpc.liveSnapshot().then(s=>{if(Date.now()-s.blockTime*1000>120000)throw new Error('RPC latest head is stale');return {market:c.market,asOf:new Date(s.blockTime*1000).toISOString(),block:s.block,hash:s.hash,latest:{...(s.curve?{vault:displayVault(s.curve)}:{}),price:spot(s),...depth(s),block:s.block,blockTime:s.blockTime}};}).finally(()=>{livePending=undefined;});}
const cache=new Map<Period,{at:number;data:Awaited<ReturnType<typeof dashboardData>>}>();
const pending=new Map<Period,Promise<Awaited<ReturnType<typeof dashboardData>>>>();
async function data(p:Period){const hit=cache.get(p);if(hit&&Date.now()-hit.at<15000)return hit.data;let task=pending.get(p);if(!task){task=dashboardData(store,p).then(d=>{cache.set(p,{at:Date.now(),data:d});return d;}).finally(()=>pending.delete(p));pending.set(p,task);}return task;}
function send(res:ServerResponse,status:number,type:string,body:string|Uint8Array,staticAsset=false){res.writeHead(status,{'content-type':type,'cache-control':staticAsset?'public,max-age=3600':'no-store','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'"});res.end(body);}
const server=createServer((req,res)=>{void(async()=>{
  const url=new URL(req.url??'/','http://localhost');
  if(req.method!=='GET'&&req.method!=='HEAD'){send(res,405,'application/json',JSON.stringify({error:'Method not allowed'}));return;}
  if(url.pathname==='/healthz'){await store.ping();send(res,200,'application/json',JSON.stringify({ok:true,market:c.market.id}));return;}
  if(url.pathname==='/api/live'){send(res,200,'application/json',JSON.stringify(await live()));return;}
  if(url.pathname==='/api/holders'){
    let p:Period;try{p=period(url.searchParams.get('range')??c.defaultPeriod);}catch{send(res,400,'application/json',JSON.stringify({error:'Invalid period'}));return;}
    send(res,200,'application/json',JSON.stringify(await holderData(store,p)));return;
  }
  if(url.pathname==='/api/dashboard'){
    let p:Period;try{p=period(url.searchParams.get('range')??c.defaultPeriod);}catch{send(res,400,'application/json',JSON.stringify({error:'Invalid period'}));return;}
    send(res,200,'application/json',JSON.stringify(await data(p)));return;
  }
  const file=files.get(url.pathname);if(file){send(res,200,file.type,file.body,url.pathname!=='/');return;}
  send(res,404,'application/json',JSON.stringify({error:'Not found'}));
})().catch(e=>{console.error(JSON.stringify({event:'http_failed',error:safeError(e)}));send(res,503,'application/json',JSON.stringify({error:'Data temporarily unavailable; retrying shortly.'}));});});
await store.initialize();
server.listen(c.port,'0.0.0.0',()=>console.log(JSON.stringify({event:'server_started',port:c.port})));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(()=>{void store.close().then(()=>process.exit(0));});});
