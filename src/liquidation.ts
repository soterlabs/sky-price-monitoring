// Morpho Blue liquidations of stUSDS collateral. All live stUSDS markets price the
// collateral at the vault rate (ERC4626 convertToAssets), the same figure as the
// redemption reference, so a Curve discount does not trigger liquidations. It decides
// whether a liquidator that sells the seized stUSDS on Curve makes money: the
// liquidator repays debt and receives collateral worth incentive x debt at the oracle
// price, so selling on Curve breaks even at redemption price / incentive.

/** Morpho Blue: LIF = min(1.15, 1 / (0.3 x LLTV + 0.7)). */
export const liquidationIncentive = (lltv: number) => Math.min(1.15, 1 / (0.3 * lltv + 0.7));

/** Ethereum Morpho Blue markets with stUSDS collateral (all LLTV 86%). */
export const STUSDS_MORPHO_MARKETS = [
  { id: '0xd570c19c0dc0fbe4ab7faf4a37c4150e1c141c8aada8ca3e1b4b6c1b712af93d', loan: 'USDC', lltv: 0.86 },
  { id: '0x77e624dd9dd980810c2b804249e88f3598d9c7ec91f16aa5fbf6e3fdf6087f82', loan: 'USDS', lltv: 0.86 },
  { id: '0x710f02caee4555b8ff75b7d48e5b52adc48898dc0c670b977fb1ea83bf4e7d8a', loan: 'USDT', lltv: 0.86 },
] as const;

export type Liquidation = {
  lltv: number;
  incentive: number; // e.g. 1.0438: collateral received per unit of debt repaid, at the oracle price
  breakEvenRatio: number; // Curve price / redemption price at which selling seized collateral breaks even
  breakEvenGapBps: number; // the same as a premium/discount in basis points (negative)
  markets: readonly { id: string; loan: string; lltv: number }[];
};

export function liquidation(
  markets: readonly { id: string; loan: string; lltv: number }[] = STUSDS_MORPHO_MARKETS,
): Liquidation {
  const lltvs = [...new Set(markets.map((m) => m.lltv))];
  if (lltvs.length !== 1) throw new Error('stUSDS markets with different LLTVs need one line each');
  const lltv = lltvs[0]!,
    incentive = liquidationIncentive(lltv),
    breakEvenRatio = 1 / incentive;
  return { lltv, incentive, breakEvenRatio, breakEvenGapBps: (breakEvenRatio - 1) * 10000, markets };
}
