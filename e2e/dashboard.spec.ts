import {test,expect}from'@playwright/test';
import{readFileSync}from'node:fs';import{gunzipSync}from'node:zlib';
import {holderSeries,initialState,applyEvent,type HolderEvent,ZERO} from '../src/holders.js';
import{makePoints,summarize,displayPoint,depth}from'../src/math.js';
const f=JSON.parse(gunzipSync(readFileSync(new URL('../test/fixtures/study-24h.json.gz',import.meta.url))).toString());
const points=makePoints(f.snapshots,f.events),latest=f.snapshots.at(-1);
function holders(snapshots=f.snapshots){const state=initialState(),a='0x'+'1'.repeat(40),b='0x'+'2'.repeat(40);applyEvent(state,{block:0,index:0,tx:'mint',kind:'liquid',from:ZERO,to:a,raw:String(1000000n*10n**18n)});const e:HolderEvent={block:Number(f.snapshots[2].block),index:0,tx:'move',kind:'liquid',from:a,to:b,raw:String(100000n*10n**18n)};applyEvent(state,e);return {data:{...holderSeries(state,[e],snapshots,[]),complete:true},job:null};}
function data(range:string){return{range,asOf:new Date(latest.time*1000).toISOString(),fresh:true,collecting:false,jobs:[],latest:{price:Number(latest.usdsRaw)/Number(latest.skyRaw),...depth(latest)},summary:summarize(points),points:points.map(displayPoint),coverage:{complete:range==='24h',actualFrom:points[0]!.from,provisionalToday:range!=='24h'&&range!=='7d'},trades:[{tx:f.events.find((e:any)=>e.kind==='swap').tx,time:points.at(-1)!.through,side:'buy',buyback:true,usds:5448.6,sky:120000}]};}
for(const viewport of [{width:390,height:844},{width:1440,height:1000}]){
  test(`charts, ranges, theme and links at ${viewport.width}px`,async({page})=>{
    await page.setViewportSize(viewport);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/dashboard?*',route=>route.fulfill({json:data(new URL(route.request().url()).searchParams.get('range')!)}));
    await page.route('**/api/holders?*',route=>route.fulfill({json:holders()}));
    await page.goto('/');await expect(page.locator('#spot')).toHaveText('0.04153');await expect(page.locator('#buyback')).toHaveText('751.91K');
    await expect(page.getByRole('link',{name:'PSM monitor'})).toHaveCount(0);
    await expect(page.getByText('How this monitor works',{exact:true})).toHaveCount(0);
    await expect(page.locator('#period')).toHaveValue('24h');await expect(page.locator('canvas')).toHaveCount(7);
    expect(await page.locator('body').evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    for(const p of ['60m','7d','30d','90d','180d','24h']){await page.selectOption('#period',p);await expect(page.locator('[data-period-label]').first()).toHaveText(p==='60m'?'Last 60min':p==='24h'?'Last 24h':p.replace('d',' days'));}
    const theme=await page.locator('html').getAttribute('data-theme');await page.click('#theme');await expect(page.locator('html')).toHaveAttribute('data-theme',theme==='dark'?'light':'dark');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme',theme==='dark'?'light':'dark');
    await page.locator('#flow-chart').focus();await page.keyboard.press('ArrowLeft');
    const tooltip=page.locator('#flow-chart + .chart-hover');await expect(tooltip).toBeVisible();
    for(const series of ['blue','green','red']){
      const row=tooltip.locator(`[data-series="${series}"]`);await expect(row).toBeVisible();
      const valueColor=await row.locator('.tooltip-value').evaluate(el=>getComputedStyle(el).color);
      const markerColor=await row.locator('.tooltip-dot').evaluate(el=>getComputedStyle(el).backgroundColor);
      const legendColor=await page.locator(`#flow-title`).locator('..').locator('..').locator('..').locator(`.legend .dot.${series}`).evaluate(el=>getComputedStyle(el).backgroundColor);
      expect(valueColor).toEqual(markerColor);expect(valueColor).toEqual(legendColor);
    }
    await page.locator('#flow-chart').hover({position:{x:100,y:80}});await expect(tooltip).toBeVisible();
    const box=(await tooltip.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);
    await tooltip.screenshot({path:`test-results/flow-tooltip-${viewport.width}.png`});
    await page.locator('.recent summary').click();await expect(page.locator('#trades a')).toHaveAttribute('href',/^https:\/\/etherscan.io\/tx\/0x/);
    await page.locator('#price-chart').focus();await page.keyboard.press('ArrowLeft');await expect(page.locator('#price-chart + .chart-hover')).toBeVisible();
    await expect(page.locator('#holder-count')).toHaveText('2');await expect(page.locator('#holder-change')).toHaveText('−10%');
    await page.locator('#holder-date').fill('0');await expect(page.locator('#holder-count')).toHaveText('1');await page.selectOption('#distribution-mode','counts');
    await page.locator('#retention-chart').focus();await page.keyboard.press('ArrowLeft');await expect(page.locator('#retention-chart + .chart-hover')).toBeVisible();
    await page.locator('.holder-details summary').click();await expect(page.locator('#holder-addresses a').first()).toHaveText('0x'+'1'.repeat(40));await expect(page.locator('#holder-addresses a').first()).toHaveAttribute('href','https://etherscan.io/address/0x'+'1'.repeat(40));
    expect(errors).toEqual([]);await page.screenshot({path:`test-results/dashboard-${viewport.width}.png`,fullPage:true});
  });
}
test('collection and failures do not display a healthy status',async({page})=>{
  await page.route('**/api/dashboard?*',route=>route.fulfill({json:{range:'24h',collecting:true,fresh:false,asOf:null,points:[],summary:null,jobs:[],trades:[]}}));
  await page.goto('/');await expect(page.locator('#status-title')).toHaveText('Collecting onchain history');await expect(page.locator('#spot')).toHaveText('—');
  await page.unroute('**/api/dashboard?*');await page.route('**/api/dashboard?*',route=>route.fulfill({status:503,json:{error:'Unavailable'}}));await page.click('#refresh');await expect(page.locator('#status-title')).toContainText('Unable to refresh');
});
test('explicit refresh reads live headlines without replacing saved history, and handles failure',async({page})=>{
  let reads=0;await page.route('**/api/dashboard?*',route=>route.fulfill({json:data('24h')}));
  await page.route('**/api/live',route=>{reads++;return route.fulfill({json:{block:'26480000',asOf:'2026-11-23T04:00:12Z',latest:{...data('24h').latest,price:.05,tvlUsds:9000000,usds:4500000}}});});
  await page.goto('/');await expect(page.locator('#spot')).toHaveText('0.04153');expect(reads).toBe(0);
  const twap=await page.locator('#twap').textContent();await page.click('#refresh');await expect(page.locator('#spot')).toHaveText('0.05000');await expect(page.locator('#live-status')).toContainText('26,480,000');await expect(page.locator('#twap')).toHaveText(twap!);expect(reads).toBe(1);
  await page.selectOption('#period','7d');await expect(page.locator('#spot')).toHaveText('0.04153');await expect(page.locator('#live-status')).toBeHidden();expect(reads).toBe(1);
  await page.unroute('**/api/live');await page.route('**/api/live',route=>route.fulfill({status:503,json:{error:'Unavailable'}}));await page.click('#refresh');await expect(page.locator('#live-status')).toContainText('Live read unavailable');await expect(page.locator('#spot')).toHaveText('0.04153');
});
test('last hour uses the shared selector, five-minute holder snapshots and five-minute polling',async({page})=>{
  const {splitSnapshots}=await import('../test/fine-fixture.js');const snaps=splitSnapshots(f.snapshots,f.events).slice(-13),fine=makePoints(snaps,f.events.filter((e:any)=>e.time>snaps[0]!.time),300);let hourlyReads=0;
  await page.clock.install();
  await page.route('**/api/dashboard?*',route=>{const range=new URL(route.request().url()).searchParams.get('range');if(range==='60m'){hourlyReads++;return route.fulfill({json:{...data('60m'),refreshSeconds:300,interval:'5-minute',summary:summarize(fine),points:fine.map(displayPoint),coverage:{complete:true}}});}return route.fulfill({json:data(range!)});});
  await page.route('**/api/holders?*',route=>{const range=new URL(route.request().url()).searchParams.get('range');return route.fulfill({json:holders(range==='60m'?snaps:f.snapshots)});});
  await page.goto('/');await expect(page.locator('#spot')).toHaveText('0.04153');await page.selectOption('#period','60m');await expect(page.locator('[data-period-label]').first()).toHaveText('Last 60min');
  await expect(page.locator('#period option:checked')).toHaveText('Last 60min - 5min updates');await expect(page.locator('#holder-date')).toHaveAttribute('max','12');expect(hourlyReads).toBe(1);
  await page.clock.runFor(299000);expect(hourlyReads).toBe(1);await page.clock.runFor(2000);await expect.poll(()=>hourlyReads).toBe(2);
});
