import {config} from './config.js';
import {Store} from './store.js';
import {dailyPoints} from './math.js';
import {safeError} from './errors.js';
export async function rollup(store:Store,now=Date.now()) {
  return store.lock('daily',async()=> {
    await store.attempt('daily');
    try {
      const today=Math.floor(now/1000/86400)*86400,days=await store.daysToRollup(today);
      for(const day of days) {
        const points=await store.points(day,day+86400),daily=dailyPoints(points);
        if(daily.length!==1)continue;
        await store.rollupDay(day,daily[0]!);
      }
      await store.success('daily');console.log(JSON.stringify({event:'daily_complete',days:days.length}));
    }catch(e){await store.failure('daily',safeError(e));throw e;}
  });
}
async function main(){const c=config(),store=new Store(c.databaseUrl);try{await rollup(store);}finally{await store.close();}}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(e=>{console.error(JSON.stringify({event:'daily_failed',error:safeError(e)}));process.exitCode=1;});
