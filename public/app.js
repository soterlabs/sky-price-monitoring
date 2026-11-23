'use strict';
const $=id=>document.getElementById(id);
const compact=n=>new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n);
const full=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n);
const price=n=>n<1?n.toFixed(5):full(n);
const signed=n=>(n>0?'+':n<0?'−':'')+compact(Math.abs(n));
const pct=(n,d=2)=>n==null?'—':(n<0?'−':'')+Math.abs(n).toFixed(d)+'%';
const periodNames={'24h':'Last 24h','7d':'7 days','30d':'30 days','90d':'90 days','180d':'180 days'};
const color=name=>getComputedStyle(document.documentElement).getPropertyValue('--'+name).trim();
let current=null,controller=null,sequence=0,timer=null;
const charts=[];
function set(id,text){$(id).textContent=text;}
function direction(el,n){el.classList.remove('positive','negative');if(n!==0)el.classList.add(n>0?'positive':'negative');}
function theme(next){document.documentElement.dataset.theme=next;try{localStorage.setItem('sky-monitor-theme',next);}catch{}$('theme').setAttribute('aria-label',next==='dark'?'Switch to light theme':'Switch to dark theme');charts.forEach(c=>c.draw());}
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
  showTooltip(){if(this.hover<0||!this.plot)return;const p=current.points[this.hover],tip=this.tooltip();let text=new Date(p.through*1000).toLocaleString(undefined,{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' UTC';if(this.kind==='price')text+='\nSpot: '+price(p.close)+' USDS / SKY\nInterval TWAP: '+price(p.twap);if(this.kind==='flow')text+='\nProtocol buys: '+full(p.buybackUsds)+' USDS\nOther buys: '+full(p.otherBuyUsds)+' USDS\nSells: '+full(p.sellUsds)+' USDS\nNet buying: '+signed(p.netBuyUsds)+' USDS';if(this.kind==='buyback'){const s=this.cumulative[this.hover];text+='\nProtocol: '+signed(s.buybacks)+' USDS\nOther net: '+signed(s.other)+' USDS\nCombined: '+signed(s.net)+' USDS';}if(this.kind==='liquidity')text+='\nUSDS reserve: '+full(p.usds)+'\nSKY reserve: '+full(p.sky);tip.textContent=text;tip.hidden=false;const {left,width,start,duration}=this.plot;const x=left+(p.through-start)/duration*width;tip.style.left=Math.max(0,Math.min(this.canvas.clientWidth-tip.offsetWidth,x+10))+'px';tip.style.top='12px';}
  draw(){
    const canvas=this.canvas,ctx=this.ctx,rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height;if(!w||!h)return;
    const dpr=window.devicePixelRatio||1;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const points=current?.points||[],empty=canvas.parentElement.querySelector('.chart-empty');empty.hidden=points.length>0;if(!points.length){empty.textContent=current?.collecting?'Collecting onchain history…':'Waiting for complete historical intervals…';this.plot=null;this.tooltip().hidden=true;return;}
    const left=w<500?59:70,right=12,top=15,bottom=35,width=w-left-right,height=h-top-bottom,start=points[0].from,duration=Math.max(1,points.at(-1).through-start);
    let values=[],sumBb=0,sumOther=0,sumNet=0;this.cumulative=points.map(p=>({buybacks:sumBb+=p.buybackUsds,other:sumOther+=p.otherNetBuyUsds,net:sumNet+=p.netBuyUsds}));
    if(this.kind==='price')values=[points[0].open,...points.map(p=>p.close)].concat(current.summary?.twap??[]);
    if(this.kind==='flow')values=points.flatMap(p=>[p.buyUsds,-p.sellUsds]);
    if(this.kind==='buyback')values=[0,...this.cumulative.flatMap(p=>[p.buybacks,p.other,p.net])];
    if(this.kind==='liquidity')values=points.map(p=>p.usds);
    const a=axis(Math.min(...values),Math.max(...values),['flow','buyback'].includes(this.kind));
    const x=t=>left+(t-start)/duration*width,y=v=>top+(a.hi-v)/(a.hi-a.lo)*height;
    ctx.font='11px system-ui,sans-serif';ctx.textBaseline='middle';ctx.fillStyle=color('muted');ctx.strokeStyle=color('grid');ctx.lineWidth=1;
    for(const v of a.ticks){const py=y(v);ctx.beginPath();ctx.moveTo(left,py);ctx.lineTo(w-right,py);ctx.stroke();let label;if(this.kind==='price'){const decimals=Math.max(3,Math.min(8,-Math.floor(Math.log10(a.step))));label=v.toFixed(decimals);}else label=compact(Math.abs(v)<a.step*.001?0:v);ctx.fillText(label,2,py);}
    const drawLine=(values,stroke,anchor=null)=>{ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.beginPath();let previous=null;if(anchor!==null){ctx.moveTo(x(start),y(anchor));previous=start;}values.forEach((v,i)=>{const p=points[i],gap=previous!==null&&p.from>previous;if(previous===null||gap)ctx.moveTo(x(p.through),y(v));else ctx.lineTo(x(p.through),y(v));previous=p.through;});ctx.stroke();};
    if(this.kind==='price'){drawLine(points.map(p=>p.close),color('ink'),points[0].open);if(current.summary){ctx.setLineDash([5,5]);ctx.strokeStyle=color('blue');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y(current.summary.twap));ctx.lineTo(w-right,y(current.summary.twap));ctx.stroke();ctx.setLineDash([]);}}
    if(this.kind==='flow'){points.forEach(p=>{const bw=Math.max(1,Math.min(40,(p.through-p.from)/duration*width*.8)),px=(x(p.from)+x(p.through))/2-bw/2;ctx.fillStyle=color('blue');ctx.fillRect(px,y(p.buybackUsds),bw,y(0)-y(p.buybackUsds));ctx.fillStyle=color('green');ctx.fillRect(px,y(p.buyUsds),bw,y(p.buybackUsds)-y(p.buyUsds));ctx.fillStyle=color('red');ctx.fillRect(px,y(0),bw,y(-p.sellUsds)-y(0));});}
    if(this.kind==='buyback'){drawLine(this.cumulative.map(p=>p.buybacks),color('blue'),0);drawLine(this.cumulative.map(p=>p.other),color('red'),0);drawLine(this.cumulative.map(p=>p.net),color('ink'),0);}
    if(this.kind==='liquidity')drawLine(points.map(p=>p.usds),color('purple'));
    if(a.lo<0&&a.hi>0){ctx.strokeStyle=color('muted');ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(left,y(0));ctx.lineTo(w-right,y(0));ctx.stroke();}
    ctx.fillStyle=color('muted');ctx.textBaseline='alphabetic';[start,start+duration/2,start+duration].forEach((t,i)=>{const label=new Date(t*1000).toLocaleString(undefined,duration<=86400?{timeZone:'UTC',hour:'2-digit',minute:'2-digit',hour12:false}:{timeZone:'UTC',month:'short',day:'numeric'}),tw=ctx.measureText(label).width;ctx.fillText(label,i===0?left:i===2?w-right-tw:x(t)-tw/2,h-8);});
    this.plot={left,width,start,duration};
    if(this.hover>=0&&this.hover<points.length){ctx.strokeStyle=color('muted');ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x(points[this.hover].through),top);ctx.lineTo(x(points[this.hover].through),h-bottom);ctx.stroke();ctx.setLineDash([]);}
  }
}
new Chart('price-chart','price');new Chart('flow-chart','flow');new Chart('buyback-chart','buyback');new Chart('liquidity-chart','liquidity');
function renderTrades(rows){const tbody=$('trades');tbody.replaceChildren();if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='No swaps in this period.';tr.append(td);tbody.append(tr);return;}for(const r of rows){const tr=document.createElement('tr');const time=new Date(r.time*1000).toLocaleString(undefined,{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});for(const [i,text]of [time,r.side==='buy'?'Buy SKY':r.side==='sell'?'Sell SKY':'Flash swap',r.buyback?'Protocol buyback':r.side==='flash'?'Flash repayment':'Other swap',full(r.usds)].entries()){const td=document.createElement('td');td.textContent=text;if(i===1)td.className=r.side==='buy'?'positive':r.side==='sell'?'negative':'';if(i===2&&r.buyback)td.className='protocol';tr.append(td);}const td=document.createElement('td'),a=document.createElement('a');a.href='https://etherscan.io/tx/'+r.tx;a.target='_blank';a.rel='noopener';a.textContent=r.tx.slice(0,10)+'…'+r.tx.slice(-6);a.title=r.tx;td.append(a);tr.append(td);tbody.append(tr);}}
function clearPeriod(){for(const id of ['net','buyback','twap','range-price','drawdown','volatility','buys','sells','volume','swaps','buyback-spent','sky-bought','buyback-count','other-net','lp-flow']){set(id,'—');$(id).classList.remove('positive','negative');}set('price-change','Waiting for period data');direction($('price-change'),0);set('buy-share','Buys minus sells, by value');set('buyback-share','Verified protocol purchases');set('support-note','Waiting for verified buyback data.');}
function render(d){
  current=d;const range=$('period').value;document.querySelectorAll('[data-period-label]').forEach(el=>el.textContent=periodNames[range]);
  $('status').className='status-banner '+(d.fresh?'fresh':d.collecting?'':'stale');set('status-title',d.fresh?'Onchain data up to date':d.collecting?'Collecting onchain history':'Showing the latest saved data');set('updated',d.asOf?'As of '+new Date(d.asOf).toLocaleString(undefined,{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' UTC':'Data refreshes every 10 minutes');
  const jobIssue=d.jobs?.find(j=>j.error),coverage=$('coverage'),notes=[];
  if(d.coverage&&!d.coverage.complete)notes.push('Available history starts '+new Date(d.coverage.actualFrom*1000).toLocaleString(undefined,{timeZone:'UTC',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' UTC. Figures cover the available portion of this range.');
  if(d.coverage?.provisionalToday)notes.push('Today’s daily point is provisional.');
  if(jobIssue)notes.push('Latest '+(jobIssue.name==='collector'?'collection':'daily rollup')+' issue: '+jobIssue.error);
  coverage.hidden=!notes.length;coverage.textContent=notes.join(' ');
  if(d.latest){set('spot',price(d.latest.price));set('tvl',compact(d.latest.tvlUsds));set('pool-reserve',compact(d.latest.usds)+' USDS held');set('usds-reserve',compact(d.latest.usds)+' USDS');set('sky-reserve',compact(d.latest.sky)+' SKY');set('depth',compact(d.latest.buyDepth1Percent)+' USDS');set('buy-10k',pct(d.latest.quote10k.buyPercent));set('sell-10k',pct(d.latest.quote10k.sellPercent));set('buy-100k',pct(d.latest.quote100k.buyPercent));set('sell-100k',pct(d.latest.quote100k.sellPercent));}
  const s=d.summary;
  if(s){set('price-change',(s.changePercent>=0?'+':'')+pct(s.changePercent)+' · '+(d.coverage.complete?periodNames[range]:'available history'));direction($('price-change'),s.changePercent);set('net',signed(s.netBuyUsds));direction($('net'),s.netBuyUsds);set('buy-share',s.buySharePercent==null?'No trading volume':pct(s.buySharePercent,1)+' of volume was buying');set('buyback',compact(s.buybackUsds));set('buyback-share',s.buybackSharePercent==null?'No buying in this period':pct(s.buybackSharePercent,1)+' of buy volume');set('twap',price(s.twap)+' USDS');set('range-price',price(s.high)+' / '+price(s.low));set('drawdown',pct(s.maxDrawdownPercent));set('volatility',pct(s.realizedVolatilityPercent));set('buys',compact(s.buyUsds)+' USDS');set('sells',compact(s.sellUsds)+' USDS');set('volume',compact(s.volumeUsds)+' USDS');set('swaps',full(s.buyCount+s.sellCount+(s.flashCount||0)));set('buyback-spent',compact(s.buybackUsds)+' USDS');set('sky-bought',compact(s.skyBuyback)+' SKY');set('buyback-count',full(s.buybackCount));set('other-net',signed(s.otherNetBuyUsds)+' USDS');direction($('other-net'),s.otherNetBuyUsds);set('lp-flow',signed(s.lpUsdsNet)+' USDS');set('support-note',s.otherNetBuyUsds<0?'Other net selling was '+compact(-s.otherNetBuyUsds)+' USDS. Protocol purchases '+(s.netBuyUsds>=0?'more than offset it':'offset part of it')+', leaving '+compact(Math.abs(s.netBuyUsds))+' USDS of combined net '+(s.netBuyUsds>=0?'buying.':'selling.'):'Protocol buybacks contributed '+compact(s.buybackUsds)+' USDS alongside '+compact(s.otherNetBuyUsds)+' USDS of other net buying.');}
  if(!s)clearPeriod();renderTrades(d.trades||[]);charts.forEach(c=>{c.hover=-1;c.tooltip().hidden=true;c.draw();});
}
async function load(){
  const seq=++sequence;controller?.abort();const requestController=new AbortController();controller=requestController;clearTimeout(timer);$('refresh').disabled=true;
  const timeout=setTimeout(()=>requestController.abort(),25000);
  try{const r=await fetch('/api/dashboard?range='+encodeURIComponent($('period').value),{cache:'no-store',signal:requestController.signal});if(!r.ok)throw new Error('The data service is temporarily unavailable.');const d=await r.json();if(seq!==sequence)return;render(d);timer=setTimeout(load,d.collecting?30000:600000);}
  catch(e){if(seq!==sequence)return;$('status').className='status-banner stale';set('status-title','Unable to refresh · retrying shortly');set('updated',current?.asOf?'Saved data as of '+new Date(current.asOf).toLocaleString():'Waiting for the data service');timer=setTimeout(load,30000);}
  finally{clearTimeout(timeout);if(seq===sequence)$('refresh').disabled=false;}
}
$('period').addEventListener('change',()=>{clearPeriod();if(current)current={...current,summary:null,points:[]};charts.forEach(c=>{c.hover=-1;c.tooltip().hidden=true;c.draw();});load();});$('refresh').addEventListener('click',load);document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});load();
