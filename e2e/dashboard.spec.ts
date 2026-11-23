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
    await expect(page.locator('#period')).toHaveValue('24h');await expect(page.locator('canvas')).toHaveCount(4);
    expect(await page.locator('body').evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    for(const p of ['7d','30d','90d','180d','24h']){await page.selectOption('#period',p);await expect(page.locator('[data-period-label]').first()).toHaveText(p==='24h'?'Last 24h':p.replace('d',' days'));}
    const theme=await page.locator('html').getAttribute('data-theme');await page.click('#theme');await expect(page.locator('html')).toHaveAttribute('data-theme',theme==='dark'?'light':'dark');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme',theme==='dark'?'light':'dark');
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
