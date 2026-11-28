'use strict';
const $=id=>document.getElementById(id);
const IS_STUSDS=document.body.dataset.market==='stusds',TOKEN=IS_STUSDS?'stUSDS':'SKY';
const compact=n=>n==null?'—':new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n);
const full=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);
const price=n=>n==null?'—':IS_STUSDS?n.toFixed(6):n<1?n.toFixed(5):full(n);
const signed=n=>(n>0?'+':n<0?'−':'')+compact(Math.abs(n));
const pct=(n,d=2)=>n==null?'—':(n<0?'−':'')+Math.abs(n).toFixed(d)+'%';
const periodNames={'60m':'Last 60min','24h':'Last 24h','7d':'7 days','30d':'30 days','90d':'90 days','180d':'180 days'};
const color=name=>getComputedStyle(document.documentElement).getPropertyValue('--'+name).trim();
let current=null,controller=null,sequence=0,timer=null;
const charts=[];
// Morpho liquidation break-even: Curve price at which selling seized stUSDS repays the debt (redemption / incentive).
const breakEven=p=>current?.liquidation&&p.referencePrice!=null?p.referencePrice*current.liquidation.breakEvenRatio:null;
function set(id,text){if($(id))$(id).textContent=text;}
function direction(el,n){el.classList.remove('positive','negative');if(n!==0)el.classList.add(n>0?'positive':'negative');}
function theme(next){document.documentElement.dataset.theme=next;try{localStorage.setItem('sky-monitor-theme',next);}catch{}$('theme').setAttribute('aria-label',next==='dark'?'Switch to light theme':'Switch to dark theme');charts.forEach(c=>c.draw());if(typeof holderCharts!=='undefined')holderCharts.forEach(c=>c.draw());}
$('theme').addEventListener('click',()=>theme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
let saved;try{saved=localStorage.getItem('sky-monitor-theme');}catch{}
document.documentElement.dataset.theme=['light','dark'].includes(saved)?saved:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
$('period').value=document.body.dataset.defaultPeriod||'24h';
function axis(min,max,zero=false){
  if(zero){min=Math.min(min,0);max=Math.max(max,0);}const span=max-min;
  if(span<=0){const padding=Math.max(Math.abs(max)*.02,.001);min-=padding;max+=padding;}
  const raw=(max-min)/4,power=10**Math.floor(Math.log10(raw)),step=[1,2,2.5,5,10].find(n=>n*power>=raw)*power;
  const lo=Math.floor(min/step)*step,hi=Math.ceil(max/step)*step,ticks=[];
  for(let v=lo;v<=hi+step*.001;v+=step)ticks.push(v);
  return{lo,hi,step,ticks};
}
class Chart {
  constructor(id,kind){this.canvas=$(id);this.kind=kind;this.ctx=this.canvas.getContext('2d');this.hover=-1;this.plot=null;this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(this.canvas.parentElement);this.canvas.addEventListener('pointermove',e=>this.pointer(e));this.canvas.addEventListener('pointerleave',()=>{this.hover=-1;this.tooltip().hidden=true;this.draw();});this.canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key)||!current?.points.length)return;e.preventDefault();this.hover=Math.max(0,Math.min(current.points.length-1,(this.hover<0?current.points.length-1:this.hover)+(e.key==='ArrowLeft'?-1:1)));this.draw();this.showTooltip();});charts.push(this);}
  tooltip(){return this.canvas.parentElement.querySelector('.chart-hover');}
  pointer(e){if(!this.plot||!current?.points.length)return;const rect=this.canvas.getBoundingClientRect(),x=e.clientX-rect.left,{left,width,start,duration}=this.plot;const t=start+(x-left)/width*duration;let i=0;current.points.forEach((p,j)=>{if(Math.abs(p.through-t)<Math.abs(current.points[i].through-t))i=j;});this.hover=i;this.draw();this.showTooltip();}
  showTooltip(){
    if(this.hover<0||!this.plot)return;
    const p=current.points[this.hover],tip=this.tooltip();tip.replaceChildren();
    const title=document.createElement('div');title.className='tooltip-title';
    title.textContent=new Date(p.through*1000).toLocaleString(undefined,{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' UTC';if(this.kind==='flow')title.textContent=new Date(p.from*1000).toLocaleString(undefined,{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' – '+new Date(p.through*1000).toLocaleString(undefined,{timeZone:'UTC',hour:'2-digit',minute:'2-digit',hour12:false})+' UTC';tip.append(title);
    const row=(label,value,series,total=false)=>{
      const line=document.createElement('div');line.className='tooltip-row'+(total?' tooltip-total':'');line.dataset.series=series;
      const key=document.createElement('span');key.className='tooltip-label';
      const dot=document.createElement('i');dot.className='tooltip-dot';dot.setAttribute('aria-hidden','true');
      const text=document.createElement('span');text.textContent=label;key.append(dot,text);
      const amount=document.createElement('strong');amount.className='tooltip-value';amount.textContent=value;
      line.append(key,amount);tip.append(line);
    };
    if(this.kind==='price'){row('Spot',price(p.close)+' USDS','ink');row(IS_STUSDS?'Sampled average':'Interval TWAP',price(p.twap)+' USDS','blue');}
    if(this.kind==='flow'){
      if(!IS_STUSDS)row('Protocol buys',full(p.buybackUsds)+' USDS','blue');row(IS_STUSDS?'Buys':'Other buys',full(p.otherBuyUsds)+' USDS','green');
      row('Sells',full(p.sellUsds)+' USDS','red');row('Net buying',signed(p.netBuyUsds)+' USDS','ink',true);
    }
    if(this.kind==='buyback'){const s=this.cumulative[this.hover];row(IS_STUSDS?'Deposits':'Protocol',signed(s.buybacks)+' USDS','blue');row(IS_STUSDS?'Withdrawals':'Other net',signed(s.other)+' USDS','red');row(IS_STUSDS?'Net deposits':'Combined',signed(s.net)+' USDS','ink',true);}
    if(this.kind==='liquidity'){row('USDS reserve',compact(p.usds)+' USDS','purple');row(TOKEN+' reserve',compact(p.sky)+' '+TOKEN,'ink');}
    if(this.kind==='reference'){row('Curve spot',price(p.close)+' USDS','ink');row('Vault reference',price(p.referencePrice)+' USDS','blue');if(breakEven(p)!=null)row('Liquidation break-even',price(breakEven(p))+' USDS','red');}
    if(this.kind==='gap'){row('Premium / discount',p.gapBps==null?'—':full(p.gapBps)+' bps','blue');if(current.liquidation&&p.gapBps!=null)row('Above liquidation break-even',signed(p.gapBps-current.liquidation.breakEvenGapBps)+' bps','red');row('Unused capacity',compact(p.capacityUsds)+' USDS','ink');}
    tip.hidden=false;const {left,width,start,duration}=this.plot;const x=left+(p.through-start)/duration*width;
    tip.style.left=Math.max(0,Math.min(this.canvas.clientWidth-tip.offsetWidth,x+10))+'px';tip.style.top='12px';
  }
  draw(){
    const canvas=this.canvas,ctx=this.ctx,rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height;if(!w||!h)return;
    const dpr=window.devicePixelRatio||1;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const points=current?.points||[],empty=canvas.parentElement.querySelector('.chart-empty');empty.hidden=points.length>0;if(!points.length){empty.textContent=current?.collecting?'Collecting onchain history…':'Waiting for complete historical intervals…';this.plot=null;this.tooltip().hidden=true;return;}
    const left=w<500?59:70,right=12,top=15,bottom=35,width=w-left-right,height=h-top-bottom,start=points[0].from,duration=Math.max(1,points.at(-1).through-start);
    let values=[],sumBb=0,sumOther=0,sumNet=0;this.cumulative=points.map(p=>({buybacks:sumBb+=(IS_STUSDS?p.vaultDepositUsds:p.buybackUsds),other:sumOther+=(IS_STUSDS?-p.vaultWithdrawUsds:p.otherNetBuyUsds),net:sumNet+=(IS_STUSDS?p.vaultDepositUsds-p.vaultWithdrawUsds:p.netBuyUsds)}));
    if(this.kind==='price')values=[points[0].open,...points.map(p=>p.close)].concat(current.summary?.twap??[]);
    if(this.kind==='flow')values=points.flatMap(p=>[p.buyUsds,-p.sellUsds]);
    if(this.kind==='buyback')values=[0,...this.cumulative.flatMap(p=>[p.buybacks,p.other,p.net])];
    if(this.kind==='liquidity')values=points.map(p=>p.usds);
    if(this.kind==='reference')values=points.flatMap(p=>[p.close,p.referencePrice,breakEven(p)]).filter(v=>v!=null);
    if(this.kind==='gap')values=[0,...points.map(p=>p.gapBps).filter(v=>v!=null),...(current.liquidation?[current.liquidation.breakEvenGapBps]:[])];
    const a=axis(Math.min(...values),Math.max(...values),['flow','buyback'].includes(this.kind));
    const x=t=>left+(t-start)/duration*width,y=v=>top+(a.hi-v)/(a.hi-a.lo)*height;
    ctx.font='11px system-ui,sans-serif';ctx.textBaseline='middle';ctx.fillStyle=color('muted');ctx.strokeStyle=color('grid');ctx.lineWidth=1;
    for(const v of a.ticks){const py=y(v);ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(w-right,py);ctx.stroke();let label;if(['price','reference'].includes(this.kind)){const decimals=Math.max(3,Math.min(8,-Math.floor(Math.log10(a.step))));label=v.toFixed(decimals);}else label=compact(Math.abs(v)<a.step*.001?0:v)+(this.kind==='gap'?' bps':'');ctx.fillText(label,2,py);}
    const drawLine=(values,stroke,anchor=null)=>{ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.beginPath();let previous=null;if(anchor!==null){ctx.moveTo(x(start),y(anchor));previous=start;}values.forEach((v,i)=>{if(v==null){previous=null;return;}const p=points[i],gap=previous!==null&&p.from>previous;if(previous===null||gap)ctx.moveTo(x(p.through),y(v));else ctx.lineTo(x(p.through),y(v));previous=p.through;});ctx.stroke();};
    if(this.kind==='price'){drawLine(points.map(p=>p.close),color('ink'),points[0].open);if(current.summary){ctx.setLineDash([5,5]);ctx.strokeStyle=color('blue');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y(current.summary.twap));ctx.lineTo(w-right,y(current.summary.twap));ctx.stroke();ctx.setLineDash([]);}}
    if(this.kind==='reference'){if(current.liquidation){ctx.setLineDash([6,4]);drawLine(points.map(breakEven),color('red'));ctx.setLineDash([]);}drawLine(points.map(p=>p.close),color('ink'));drawLine(points.map(p=>p.referencePrice),color('blue'));}
    if(this.kind==='gap'){if(current.liquidation){const py=y(current.liquidation.breakEvenGapBps);ctx.setLineDash([6,4]);ctx.strokeStyle=color('red');ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(w-right,py);ctx.stroke();ctx.setLineDash([]);}drawLine(points.map(p=>p.gapBps),color('blue'));}
    if(this.kind==='flow'){points.forEach(p=>{const bw=Math.max(1,Math.min(40,(p.through-p.from)/duration*width*.8)),px=(x(p.from)+x(p.through))/2-bw/2;ctx.fillStyle=color('blue');ctx.fillRect(px,y(p.buybackUsds),bw,y(0)-y(p.buybackUsds));ctx.fillStyle=color('green');ctx.fillRect(px,y(p.buyUsds),bw,y(p.buybackUsds)-y(p.buyUsds));ctx.fillStyle=color('red');ctx.fillRect(px,y(0),bw,y(-p.sellUsds)-y(0));});}
    if(this.kind==='buyback'){drawLine(this.cumulative.map(p=>p.buybacks),color('blue'),0);drawLine(this.cumulative.map(p=>p.other),color('red'),0);drawLine(this.cumulative.map(p=>p.net),color('ink'),0);}
    if(this.kind==='liquidity')drawLine(points.map(p=>p.usds),color('purple'));
    if(a.lo<0&&a.hi>0){ctx.strokeStyle=color('muted');ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(left,y(0));ctx.lineTo(w-right,y(0));ctx.stroke();}
    ctx.fillStyle=color('muted');ctx.textBaseline='alphabetic';[start,start+duration/2,start+duration].forEach((t,i)=>{const label=new Date(t*1000).toLocaleString(undefined,duration<=86400?{timeZone:'UTC',hour:'2-digit',minute:'2-digit',hour12:false}:{timeZone:'UTC',month:'short',day:'numeric'}),tw=ctx.measureText(label).width;ctx.fillText(label,i===0?left:i===2?w-right-tw:x(t)-tw/2,h-8);});
    this.plot={left,width,start,duration};
    if(this.hover>=0&&this.hover<points.length){ctx.strokeStyle=color('muted');ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x(points[this.hover].through),top);ctx.lineTo(x(points[this.hover].through),h-bottom);ctx.stroke();ctx.setLineDash([]);}
  }
}
if(IS_STUSDS){new Chart('reference-chart','reference');new Chart('gap-chart','gap');}
new Chart('price-chart','price');new Chart('flow-chart','flow');new Chart('buyback-chart','buyback');new Chart('liquidity-chart','liquidity');
function renderTrades(rows){const tbody=$('trades');tbody.replaceChildren();if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='No swaps in this period.';tr.append(td);tbody.append(tr);return;}for(const r of rows){const tr=document.createElement('tr');const time=new Date(r.time*1000).toLocaleString(undefined,{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});for(const [i,text]of [time,r.side==='buy'?'Buy '+TOKEN:r.side==='sell'?'Sell '+TOKEN:'Flash swap',r.buyback?'Protocol buyback':r.side==='flash'?'Flash repayment':'Other swap',full(r.usds)].entries()){const td=document.createElement('td');td.textContent=text;if(i===1)td.className=r.side==='buy'?'positive':r.side==='sell'?'negative':'';if(i===2&&r.buyback)td.className='protocol';tr.append(td);}const td=document.createElement('td'),a=document.createElement('a');a.href='https://etherscan.io/tx/'+r.tx;a.target='_blank';a.rel='noopener';a.textContent=r.tx.slice(0,10)+'…'+r.tx.slice(-6);a.title=r.tx;td.append(a);tr.append(td);tbody.append(tr);}}
function clearPeriod(){for(const id of ['net','buyback','twap','range-price','drawdown','volatility','buys','sells','volume','swaps','buyback-spent','sky-bought','buyback-count','other-net','lp-flow']){set(id,'—');$(id).classList.remove('positive','negative');}set('price-change','Waiting for period data');direction($('price-change'),0);set('buy-share','Buys minus sells, by value');set('buyback-share','Verified protocol purchases');set('support-note','Waiting for verified buyback data.');}
function render(d){
  $('live-status').hidden=true;document.querySelectorAll('.live-label').forEach(el=>el.textContent='SAVED');
  current=d;const range=$('period').value;document.querySelectorAll('[data-period-label]').forEach(el=>el.textContent=periodNames[range]);
  $('status').className='status-banner '+(d.fresh?'fresh':d.collecting?'':'stale');set('status-title',d.fresh?'Onchain data up to date':d.collecting?'Collecting onchain history':'Showing the latest saved data');set('updated',d.asOf?'As of '+new Date(d.asOf).toLocaleString(undefined,{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' UTC':'Data refreshes every '+(range==='60m'?5:10)+' minutes');
  const jobIssue=d.jobs?.find(j=>j.error&&j.name!=='holders'),coverage=$('coverage'),notes=[];
  if(d.coverage&&!d.coverage.complete)notes.push('Available history starts '+new Date(d.coverage.actualFrom*1000).toLocaleString(undefined,{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' UTC. Figures cover the available portion of this range.');
  if(d.coverage?.provisionalToday)notes.push('Today’s daily point is provisional.');
  if(jobIssue)notes.push('Latest '+(jobIssue.name==='collector'?'collection':jobIssue.name==='backfill'?'history backfill':'daily rollup')+' issue: '+jobIssue.error);
  coverage.hidden=!notes.length;coverage.textContent=notes.join(' ');
  if(d.latest){set('spot',price(d.latest.price));set('tvl',compact(d.latest.tvlUsds));set('pool-reserve',compact(d.latest.usds)+' USDS held');set('usds-reserve',compact(d.latest.usds)+' USDS');set('sky-reserve',compact(d.latest.sky)+' '+TOKEN);set('depth',compact(d.latest.buyDepth1Percent)+' USDS');set('buy-10k',pct(d.latest.quote10k.buyPercent));set('sell-10k',pct(d.latest.quote10k.sellPercent));set('buy-100k',pct(d.latest.quote100k.buyPercent));set('sell-100k',pct(d.latest.quote100k.sellPercent));}
  const s=d.summary;
  if(s){set('price-change',(s.changePercent>=0?'+':'')+pct(s.changePercent)+' · '+(d.coverage.complete?periodNames[range]:'available history'));direction($('price-change'),s.changePercent);set('net',signed(s.netBuyUsds));direction($('net'),s.netBuyUsds);set('buy-share',s.buySharePercent==null?'No trading volume':pct(s.buySharePercent,1)+' of volume was buying');set('buyback',compact(s.buybackUsds));set('buyback-share',s.buybackSharePercent==null?'No buying in this period':pct(s.buybackSharePercent,1)+' of buy volume');set('twap',price(s.twap)+' USDS');set('range-price',price(s.high)+' / '+price(s.low));set('drawdown',pct(s.maxDrawdownPercent));set('volatility',pct(s.realizedVolatilityPercent));set('buys',compact(s.buyUsds)+' USDS');set('sells',compact(s.sellUsds)+' USDS');set('volume',compact(s.volumeUsds)+' USDS');set('swaps',full(s.buyCount+s.sellCount+(s.flashCount||0)));set('buyback-spent',compact(s.buybackUsds)+' USDS');set('sky-bought',compact(s.skyBuyback)+' '+TOKEN);set('buyback-count',full(s.buybackCount));set('other-net',signed(s.otherNetBuyUsds)+' USDS');direction($('other-net'),s.otherNetBuyUsds);set('lp-flow',signed(s.lpUsdsNet)+' USDS');set('support-note',s.otherNetBuyUsds<0?'Other net selling was '+compact(-s.otherNetBuyUsds)+' USDS. Protocol purchases '+(s.netBuyUsds>=0?'more than offset it':'offset part of it')+', leaving '+compact(Math.abs(s.netBuyUsds))+' USDS of combined net '+(s.netBuyUsds>=0?'buying.':'selling.'):'Protocol buybacks contributed '+compact(s.buybackUsds)+' USDS alongside '+compact(s.otherNetBuyUsds)+' USDS of other net buying.');}
  if(!s)clearPeriod();
  if(IS_STUSDS){if(d.latest){set('pool-imbalance',pct(d.latest.usds/d.latest.tvlUsds*100));set('pool-reference-value',compact(d.latest.referenceTvlUsds)+' USDS');}renderVault(d.latest?.vault,s);renderVaultEvents(d.vaultEvents||[]);if(s?.vaultFlow){const v=s.vaultFlow;set('buyback',signed(v.netUsds));direction($('buyback'),v.netUsds);set('buyback-share',v.deposits+' deposits · '+v.withdrawals+' redemptions');set('buyback-spent',compact(v.depositUsds)+' USDS');set('sky-bought',compact(v.withdrawUsds)+' USDS');set('buyback-count',v.deposits+' / '+v.withdrawals);set('other-net',compact(v.mintShares)+' / '+compact(v.burnShares));direction($('other-net'),0);set('support-note','Whole-vault ERC4626 flows, independent of Curve trading. Minted and burned shares do not represent market buys or sells.');}}
  renderTrades(d.trades||[]);charts.forEach(c=>{c.hover=-1;c.tooltip().hidden=true;c.draw();});
}
async function load(live=false){
  const seq=++sequence;controller?.abort();const requestController=new AbortController();controller=requestController;clearTimeout(timer);$('refresh').disabled=true;
  const timeout=setTimeout(()=>requestController.abort(),25000);
  try{const r=await fetch('/api/dashboard?range='+encodeURIComponent($('period').value),{cache:'no-store',signal:requestController.signal});if(!r.ok)throw new Error('The data service is temporarily unavailable.');const d=await r.json();if(seq!==sequence)return;render(d);void loadHolders(seq,requestController.signal);timer=setTimeout(load,d.collecting?30000:(d.refreshSeconds??600)*1000);
    if(live){
      try{const response=await fetch('/api/live',{cache:'no-store',signal:requestController.signal});if(!response.ok)throw new Error('Live read failed');const result=await response.json();if(seq!==sequence)return;
        if(d.latest&&Number(result.block)<Number(d.latest.block))throw new Error('RPC behind saved data');
        const v=result.latest;set('spot',price(v.price));set('tvl',compact(v.tvlUsds));set('pool-reserve',compact(v.usds)+' USDS held');set('usds-reserve',compact(v.usds)+' USDS');set('sky-reserve',compact(v.sky)+' '+TOKEN);set('depth',compact(v.buyDepth1Percent)+' USDS');for(const size of ['10k','100k']){set('buy-'+size,pct(v['quote'+size].buyPercent));set('sell-'+size,pct(v['quote'+size].sellPercent));}
        if(IS_STUSDS){renderVault(v.vault);set('pool-imbalance',pct(v.usds/v.tvlUsds*100));set('pool-reference-value',compact(v.referenceTvlUsds)+' USDS');}
        document.querySelectorAll('.live-label').forEach(el=>el.textContent='LIVE');
        set('live-status','Live price and liquidity · block '+full(Number(result.block))+' · '+new Date(result.asOf).toLocaleString(undefined,{timeZone:'UTC',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})+' UTC. Charts and period figures use saved snapshots.');$('live-status').hidden=false;
      }catch(e){if(seq!==sequence)return;set('live-status','Live read unavailable. Showing saved headline values; charts are unchanged.');$('live-status').hidden=false;}
    }}
  catch(e){if(seq!==sequence)return;$('status').className='status-banner stale';set('status-title','Unable to refresh · retrying shortly');set('updated',current?.asOf?'Saved data as of '+new Date(current.asOf).toLocaleString():'Waiting for the data service');timer=setTimeout(load,30000);}
  finally{clearTimeout(timeout);if(seq===sequence)$('refresh').disabled=false;}
}
$('period').addEventListener('change',()=>{renderHolders({data:null});clearPeriod();if(current)current={...current,summary:null,points:[]};charts.forEach(c=>{c.hover=-1;c.tooltip().hidden=true;c.draw();});load();});$('refresh').addEventListener('click',()=>load(true));document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});load();

// Holder history is independently indexed and can be behind pool collection.
let holderView=null,holderCursor=0;
const holderColors=['blue','purple','green'];
const utc=t=>new Date(t*1000).toLocaleString(undefined,{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' UTC';
function holderFacts(){
  const d=holderView,last=d?.points.at(-1),p=d?.points[holderCursor];if(!p||!last)return;
  set('holder-change',last.retention[0]==null?'—':signed(last.retention[0]-100)+'%');
  set('holder-net',signed(d.addresses.reduce((s,a)=>s+a.change,0))+' '+TOKEN);
  set('holder-new',compact(last.newcomerSky)+' '+TOKEN);set('holder-baseline',utc(d.from));
  set('holder-date-label',utc(p.time));set('holder-count',full(p.distribution.holders));set('holder-top10',pct(p.distribution.top10));set('holder-top100',pct(p.distribution.top100));set('holder-supply',compact(p.distribution.total)+' '+TOKEN);
  if(IS_STUSDS){set('holder-issued',compact(p.supplyShares)+' shares');set('holder-excluded',compact(p.excludedHoldings)+' shares');}
  for(const [id,key]of [['whale-buys','buys'],['whale-sells','sells'],['whale-exchanges','exchangeDeposits'],['whale-other',IS_STUSDS?'redemptions':'otherOut']])set(id,compact(d.activity[key])+' '+TOKEN);
}
class HolderChart {
  constructor(id,kind){this.canvas=$(id);this.kind=kind;this.hover=-1;this.plot=null;new ResizeObserver(()=>this.draw()).observe(this.canvas.parentElement);this.canvas.addEventListener('pointermove',e=>{if(!this.plot||!holderView)return;const r=this.canvas.getBoundingClientRect();if(kind==='distribution')this.hover=Math.max(0,Math.min(5,Math.floor((e.clientY-r.top-16)/((r.height-50)/6))));else{const {left,width,start,duration}=this.plot,t=start+(e.clientX-r.left-left)/width*duration;let nearest=0;holderView.points.forEach((p,i)=>{if(Math.abs(p.time-t)<Math.abs(holderView.points[nearest].time-t))nearest=i;});this.hover=nearest;}this.draw();this.tip();});this.canvas.addEventListener('pointerleave',()=>{this.hover=-1;this.tooltip().hidden=true;this.draw();});this.canvas.addEventListener('keydown',e=>{if(!holderView||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const max=kind==='distribution'?5:holderView.points.length-1;this.hover=Math.max(0,Math.min(max,(this.hover<0?max:this.hover)+(e.key==='ArrowLeft'?-1:1)));this.draw();this.tip();});}
  tooltip(){return this.canvas.parentElement.querySelector('.chart-hover');}
  tip(){
    if(!holderView||this.hover<0)return;const tip=this.tooltip();tip.replaceChildren();
    const title=document.createElement('div');title.className='tooltip-title';const p=holderView.points[this.kind==='distribution'?holderCursor:this.hover];title.textContent=this.kind==='activity'&&this.hover>0?utc(holderView.points[this.hover-1].time)+' – '+utc(p.time):utc(p.time);tip.append(title);
    const row=(label,value,series)=>{const el=document.createElement('div');el.className='tooltip-row';el.dataset.series=series;const key=document.createElement('span');key.className='tooltip-label';const dot=document.createElement('i');dot.className='tooltip-dot';key.append(dot,document.createTextNode(label));const val=document.createElement('strong');val.className='tooltip-value';val.textContent=value;el.append(key,val);tip.append(el);};
    if(this.kind==='retention')p.retention.forEach((v,i)=>row(holderView.labels[i],v==null?'No baseline':full(v)+' (start 100)',holderColors[i]));
    if(this.kind==='activity'){row('Pool purchases',full(p.activity.buys)+' '+TOKEN,'green');row('Pool sales',full(p.activity.sells)+' '+TOKEN,'red');if(IS_STUSDS)row('Vault redemptions',full(p.activity.redemptions||0)+' '+TOKEN,'blue');row('Exchange deposits',full(p.activity.exchangeDeposits)+' '+TOKEN,'purple');}
    if(this.kind==='distribution'){const i=this.hover;row(holderView.buckets[i]+' '+TOKEN,pct(p.distribution.shares[i]),'blue');row('Addresses',full(p.distribution.counts[i]),'ink');row('Starting share',pct(holderView.points[0].distribution.shares[i]),'ink');}
    tip.hidden=false;tip.style.left='8px';tip.style.top='8px';
  }
  draw(){
    const canvas=this.canvas,ctx=canvas.getContext('2d'),r=canvas.getBoundingClientRect(),w=r.width,h=r.height;if(!w||!h)return;const dpr=devicePixelRatio||1;canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const points=holderView?.points??[],empty=canvas.parentElement.querySelector('.chart-empty');empty.hidden=points.length>0;if(!points.length){this.tooltip().hidden=true;this.plot=null;return;}
    ctx.font='12px system-ui';ctx.fillStyle=color('muted');ctx.textBaseline='middle';
    if(this.kind==='distribution'){
      const mode=$('distribution-mode').value,now=points[holderCursor].distribution[mode],base=points[0].distribution[mode],a=axis(0,Math.max(...now,...base),true),left=94,width=w-left-14,row=(h-50)/6;
      for(let i=0;i<6;i++){const y=16+i*row;ctx.fillStyle=color('muted');ctx.fillText(holderView.buckets[i],0,y+row/2);ctx.fillStyle=color('blue');ctx.globalAlpha=.2;ctx.fillRect(left,y+6,base[i]/a.hi*width,row-12);ctx.globalAlpha=1;ctx.fillRect(left,y+row*.35,now[i]/a.hi*width,row*.3);ctx.strokeStyle=color('muted');ctx.strokeRect(left,y+6,base[i]/a.hi*width,row-12);}
      a.ticks.filter(v=>mode==='shares'||Number.isInteger(v)).forEach(v=>{const label=mode==='shares'?compact(v)+'%':compact(v);ctx.fillStyle=color('muted');ctx.fillText(label,Math.min(w-ctx.measureText(label).width,Math.max(left,left+v/a.hi*width-ctx.measureText(label).width/2)),h-15);});this.plot={left,width};return;
    }
    const left=58,right=12,top=16,bottom=35,width=w-left-right,height=h-top-bottom,start=points[0].time,duration=Math.max(1,points.at(-1).time-start);
    const values=this.kind==='retention'?[100,...points.flatMap(p=>p.retention.filter(v=>v!=null))]:points.flatMap(p=>[p.activity.buys,-p.activity.sells-p.activity.exchangeDeposits-(IS_STUSDS?p.activity.redemptions||0:0)]);const min=this.kind==='retention'?Math.min(99,...values):Math.min(-1,...values),max=this.kind==='retention'?Math.max(101,...values):Math.max(1,...values);const a=axis(min,max,this.kind==='activity');
    const x=t=>left+(t-start)/duration*width,y=v=>top+(a.hi-v)/(a.hi-a.lo)*height;
    for(const v of a.ticks){const py=y(v);ctx.strokeStyle=color('grid');ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(w-right,py);ctx.stroke();ctx.fillStyle=color('muted');ctx.fillText(compact(v),0,py);}
    if(this.kind==='retention'){
      ctx.strokeStyle=color('muted');ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(left,y(100));ctx.lineTo(w-right,y(100));ctx.stroke();ctx.setLineDash([]);
      for(let group=0;group<3;group++){ctx.strokeStyle=color(holderColors[group]);ctx.lineWidth=2;ctx.beginPath();let started=false;for(const p of points){const v=p.retention[group];if(v==null){started=false;continue;}if(!started)ctx.moveTo(x(p.time),y(v));else ctx.lineTo(x(p.time),y(v));started=true;}ctx.stroke();}ctx.lineWidth=1;
    }else for(let i=1;i<points.length;i++){const p=points[i],v=p.activity,bw=Math.max(1,Math.min(40,(p.time-points[i-1].time)/duration*width*.75)),px=x((p.time+points[i-1].time)/2)-bw/2;ctx.fillStyle=color('green');ctx.fillRect(px,y(v.buys),bw,y(0)-y(v.buys));ctx.fillStyle=color('red');ctx.fillRect(px,y(0),bw,y(-v.sells)-y(0));const redemptions=IS_STUSDS?v.redemptions||0:0;ctx.fillStyle=color('blue');ctx.fillRect(px,y(-v.sells),bw,y(-v.sells-redemptions)-y(-v.sells));ctx.fillStyle=color('purple');ctx.fillRect(px,y(-v.sells-redemptions),bw,y(-v.sells-redemptions-v.exchangeDeposits)-y(-v.sells-redemptions));}
    ctx.fillStyle=color('muted');ctx.textBaseline='alphabetic';[start,start+duration/2,start+duration].forEach((t,i)=>{const label=new Date(t*1000).toLocaleString(undefined,duration<=86400?{timeZone:'UTC',hour:'2-digit',minute:'2-digit',hour12:false}:{timeZone:'UTC',month:'short',day:'numeric'}),tw=ctx.measureText(label).width;ctx.fillText(label,i===0?left:i===2?w-right-tw:x(t)-tw/2,h-8);});
    this.plot={left,width,start,duration};if(this.hover>=0){ctx.strokeStyle=color('muted');ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x(points[this.hover].time),top);ctx.lineTo(x(points[this.hover].time),h-bottom);ctx.stroke();ctx.setLineDash([]);}
  }
}
const holderCharts=[new HolderChart('retention-chart','retention'),new HolderChart('distribution-chart','distribution'),new HolderChart('holder-activity-chart','activity')];
function renderHolders(payload){
  holderView=payload.data;holderCursor=Math.max(0,(holderView?.points.length??1)-1);const slider=$('holder-date');slider.max=String(holderCursor);slider.value=String(holderCursor);slider.disabled=!holderView;
  const notes=[];if(!holderView)notes.push('Indexing holder history from '+TOKEN+' deployment'+(payload.progress?' · '+pct(payload.progress.percent,1)+' of blocks scanned':'')+'. Holder figures will appear after supply reconciliation.');else{notes.push('Holder data as of '+utc(holderView.through)+'.');if(!holderView.complete)notes.push('The selected range has partial history, starting '+utc(holderView.from)+'.');if(Date.now()-holderView.through*1000>($('period').value==='60m'?15:25)*60000)notes.push('Holder data is behind the latest collection.');}if(payload.job?.error)notes.push('Latest holder index issue: '+payload.job.error);set('holder-status',notes.join(' '));
  const tbody=$('holder-addresses');tbody.replaceChildren();if(holderView){holderFacts();for(const r of holderView.addresses){const tr=document.createElement('tr'),td=document.createElement('td'),a=document.createElement('a');a.href='https://etherscan.io/address/'+r.address;a.target='_blank';a.rel='noopener';a.textContent=r.address;td.append(a);tr.append(td);for(const n of [r.start,r.end,r.change]){const cell=document.createElement('td');cell.textContent=compact(n);tr.append(cell);}tbody.append(tr);}}
  else{for(const id of ['holder-change','holder-net','holder-new','holder-baseline','holder-count','holder-top10','holder-top100','holder-supply','whale-buys','whale-sells','whale-exchanges','whale-other'])set(id,'—');set('holder-date-label','—');}
  holderCharts.forEach(c=>{c.hover=-1;c.tooltip().hidden=true;c.draw();});
}
async function loadHolders(seq,signal){try{const response=await fetch('/api/holders?range='+encodeURIComponent($('period').value),{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});if(!response.ok)throw new Error('Unavailable');const payload=await response.json();if(seq===sequence)renderHolders(payload);}catch{if(seq===sequence){renderHolders({data:null});set('holder-status','Holder history temporarily unavailable. Pool data is unaffected.');}}}
$('holder-date').addEventListener('input',()=>{holderCursor=Number($('holder-date').value);holderFacts();holderCharts.forEach(c=>{c.hover=-1;c.tooltip().hidden=true;c.draw();});});
$('distribution-mode').addEventListener('change',()=>holderCharts[1].draw());

function renderLiquidation(v){
 const l=current?.liquidation,box=$('liquidation-note');if(!box)return;box.hidden=!l;if(!l)return;
 const bonus=((l.incentive-1)*100).toFixed(2)+'%';set('liquidation-legend','Liquidation break-even (redemption ÷ '+l.incentive.toFixed(4)+')');
 const head=v?.gapBps==null?null:v.gapBps-l.breakEvenGapBps;
 box.textContent='Liquidation break-even: '+full(l.breakEvenGapBps)+' bps versus the redemption reference ('+l.markets.length+' Morpho markets, LLTV '+Math.round(l.lltv*100)+'%, liquidation bonus '+bonus+'). '+(head==null?'':head>0?'The Curve price is '+full(head)+' bps above it: a liquidator selling seized stUSDS on Curve makes money.':'The Curve price is '+full(-head)+' bps below it: liquidating and selling on Curve loses money, so liquidations rely on vault redemption capacity.');
}
function renderVault(v,summary){
 renderLiquidation(v);if(!v)return;
 set('vault-reference',price(v.referencePrice)+' USDS');set('vault-nav',price(v.navPrice)+' USDS');
 set('vault-gap',v.gapBps==null?'—':full(v.gapBps)+' bps ('+pct(v.gapPercent)+')');direction($('vault-gap'),v.gapBps||0);
 set('vault-delta',v.deltaUsds.toFixed(6)+' USDS');
 set('vault-capacity',(v.capacityUsds>0&&v.capacityUsds<.01?'<0.01':compact(v.capacityUsds))+' USDS');
 set('vault-capacity-percent',pct(v.capacityPercent,4));set('vault-supply',compact(v.supplyShares)+' shares');set('vault-assets',compact(v.totalAssets)+' USDS');
 if(summary){set('vault-low-gap',summary.minGapBps==null?'—':full(summary.minGapBps)+' bps');set('vault-high-gap',summary.maxGapBps==null?'—':full(summary.maxGapBps)+' bps');}
 const body=$('vault-quotes');body.replaceChildren();for(const q of Object.values(v.quotes)){
  const tr=document.createElement('tr');for(const text of [compact(q.notionalUsds)+' USDS',full(q.shares),q.curveUsds==null?'Unavailable':full(q.curveUsds),full(q.vaultUsds),q.exitGapBps==null?'—':full(q.exitGapBps)+' bps',q.capacitySufficient?'Within global capacity':'Capacity limited']){const td=document.createElement('td');td.textContent=text;tr.append(td);}body.append(tr);
 }
}
function renderVaultEvents(rows){
 const body=$('vault-events');body.replaceChildren();
 const link=(value,kind)=>{const a=document.createElement('a');a.href='https://etherscan.io/'+kind+'/'+value;a.target='_blank';a.rel='noopener';a.textContent=kind==='tx'?value.slice(0,10)+'…'+value.slice(-6):value;return a;};
 for(const r of rows){const tr=document.createElement('tr');for(const value of [utc(r.time),r.kind==='deposit'?'Deposit':'Redemption',link(r.owner,'address'),link(r.receiver,'address'),full(r.assets),full(r.shares),link(r.tx,'tx')]){const td=document.createElement('td');if(typeof value==='string')td.textContent=value;else td.append(value);tr.append(td);}body.append(tr);}
 if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;td.textContent='No vault events in the available period.';tr.append(td);body.append(tr);}
}
