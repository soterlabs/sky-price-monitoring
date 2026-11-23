import {test,expect}from'@playwright/test';
import{readFileSync}from'node:fs';import{gunzipSync}from'node:zlib';
import{makePoints,summarize,displayPoint,depth}from'../src/math.js';
const f=JSON.parse(gunzipSync(readFileSync(new URL('../test/fixtures/study-24h.json.gz',import.meta.url))).toString());
const points=makePoints(f.snapshots,f.events),latest=f.snapshots.at(-1);
function data(range:string){return{range,asOf:new Date(latest.time*1000).toISOString(),fresh:true,collecting:false,jobs:[],latest:{price:Number(latest.usdsRaw)/Number(latest.skyRaw),...depth(latest)},summary:summarize(points),points:points.map(displayPoint),coverage:{complete:range==='24h',actualFrom:points[0]!.from,provisionalToday:range!=='24h'&&range!=='7d'},trades:[{tx:f.events.find((e:any)=>e.kind==='swap').tx,time:points.at(-1)!.through,side:'buy',buyback:true,usds:5448.6,sky:120000}]};}
for(const viewport of [{width:390,height:844},{width:1440,height:1000}]){
  test(`charts, ranges, theme and links at ${viewport.width}px`,async({page})=>{
    await page.setViewportSize(viewport);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/dashboard?*',route=>route.fulfill({json:data(new URL(route.request().url()).searchParams.get('range')!)}));
    await page.goto('/');await expect(page.locator('#spot')).toHaveText('0.04153');await expect(page.locator('#buyback')).toHaveText('751.91K');
    await expect(page.getByRole('link',{name:'PSM monitor'})).toHaveCount(0);
    await expect(page.getByText('How this monitor works',{exact:true})).toHaveCount(0);
    await expect(page.locator('#period')).toHaveValue('24h');await expect(page.locator('canvas')).toHaveCount(4);
    expect(await page.locator('body').evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    for(const p of ['7d','30d','90d','180d','24h']){await page.selectOption('#period',p);await expect(page.locator('[data-period-label]').first()).toHaveText(p==='24h'?'Last 24h':p.replace('d',' days'));}
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
