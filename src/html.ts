import type{Market}from'./config.js';
export function renderHtml(template:string,market:Market,defaultPeriod:string,assetVersion=''){
 let html=template.replace('{{DEFAULT_PERIOD}}',defaultPeriod).replace('{{MARKET_PROFILE}}',market.id);
 if(assetVersion)html=html.replace('/app.js',`/app.js?v=${assetVersion}`).replace('/styles.css',`/styles.css?v=${assetVersion}`);
 if(market.id==='sky')return html.replace(/<!-- STUSDS_START -->[\s\S]*?<!-- STUSDS_END -->/g,'');
 html=html.replaceAll('SKY','stUSDS').replaceAll('Uniswap V2','Curve StableSwap NG').replaceAll('UNISWAP V2','CURVE STABLESWAP NG').replaceAll('0x2621cc0b3f3c079c1db0e80794aa24976f0b9e3c',market.pool)
 .replaceAll('Price, trading flows and protocol buybacks in the stUSDS / USDS pool.','Curve market prices, vault redemptions and holder behavior for stUSDS.')
 .replaceAll('stUSDS price, trading flows, protocol buybacks and liquidity in the stUSDS/USDS Curve StableSwap NG pool.','stUSDS Curve prices, ERC4626 redemption references, liquidity and holder behavior.')
 .replaceAll('Protocol buyback support','Vault deposits and redemptions')
 .replaceAll('Cumulative protocol buying, other net flow and their combined balance.','Whole-vault deposits, redemptions and their cumulative net flow, separate from Curve trading.')
 .replaceAll('Protocol buybacks','Net vault deposits').replaceAll('Protocol buys','Buys')
 .replaceAll('Period TWAP','Sampled period average').replaceAll('Period average','Sampled period average')
 .replaceAll('Pool spot price and the time-weighted average over the selected period.','Curve spot and an approximate time-weighted average of five-minute samples.')
 .replaceAll('High / low','Sampled high / low').replaceAll('Interval TWAP','Sampled average')
 .replaceAll('Trading pressure measured by USDS value, with protocol buying shown separately.','Curve buys and sells measured by actual USDS paid or received.')
 .replaceAll('Other buys','Buys').replaceAll('USDS spent','Deposited USDS').replaceAll('stUSDS purchased','Withdrawn USDS').replaceAll('Buyback executions','Deposit / redemption events').replaceAll('Other net flow','Minted / burned shares')
 .replaceAll('Combined net flow','Net deposits')
 .replaceAll('including the 0.30% pool fee','including current dynamic Curve fees')
 .replaceAll('staking and governance deposits are attributed to their owners.','balances are measured in shares, independently of yield accrual.')
 .replaceAll('Known protocol reserves, pools, converters and exchange wallets are excluded.','Known pool, protocol custody and labeled exchange balances are excluded.')
 .replaceAll('Other outgoing transfers','Vault redemptions')
 .replaceAll('Pool spot price and the time-weighted average','Pool spot price and the sampled time-weighted average')
 .replaceAll('Loading buybacks…','Loading vault activity…').replaceAll('Waiting for verified buyback data.','Waiting for vault activity.')
 .replaceAll('Verified protocol purchases','Whole-vault deposits minus redemptions').replaceAll('Protocol buys, other buys and sells by USDS volume','Curve buys and sells by USDS volume')
 .replaceAll('Cumulative protocol buybacks and other net USDS trading flows','Cumulative vault deposits, redemptions and net flow')
 .replaceAll('Confirmed trades require a direct stUSDS transfer','Vault redemptions require a share burn matched to a vault Withdraw event. Confirmed trades require a direct stUSDS transfer')
 .replaceAll('“Other” includes arbitrage and MEV, and does not imply organic demand. Fee-only flash repayments are excluded from directional volume.','Swaps include arbitrage and MEV, and do not imply organic demand.')
 .replaceAll('Versus pretrade spot, including the 0.30% pool fee.','Versus pretrade spot, including current dynamic Curve fees.');
 // Section-specific legends keep the same color/value mapping as the shared charts.
 html=html.replace(/(<section class="section" aria-labelledby="buyback-title">)[\s\S]*?(?=<section class="section" aria-labelledby="liquidity-title">)/,section=>section.replace('Net vault deposits</span>','Deposits</span>').replace('Minted / burned shares</span>','Withdrawals</span>'));
 html=html.replace('Pool value uses the pool’s own spot price.','Pool market value equals USDS plus stUSDS valued at Curve spot.');
 html=html.replace('Shares use tracked holdings after known infrastructure and custody exclusions, rather than total token supply.','Shares use tracked holdings after known custody exclusions. Issued share supply and excluded custody are shown separately.');
 return html.replaceAll('<!-- STUSDS_START -->','').replaceAll('<!-- STUSDS_END -->','');
}
