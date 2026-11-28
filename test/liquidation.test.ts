import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liquidation, liquidationIncentive } from '../src/liquidation.js';

test('Morpho liquidation incentive and break-even for 86% LLTV', () => {
  assert.ok(Math.abs(liquidationIncentive(0.86) - 1.043841) < 1e-6);
  assert.equal(liquidationIncentive(0.385), 1.15, 'capped at 15%');
  const l = liquidation();
  assert.equal(l.lltv, 0.86);
  assert.ok(Math.abs(l.breakEvenRatio - 0.958) < 1e-12, 'redemption / incentive = redemption x 0.958');
  assert.ok(Math.abs(l.breakEvenGapBps + 420) < 1e-6);
  assert.equal(l.markets.length, 3);
});

test('markets with different LLTVs are rejected rather than averaged', () => {
  assert.throws(() =>
    liquidation([
      { id: '0x1', loan: 'USDC', lltv: 0.86 },
      { id: '0x2', loan: 'USDC', lltv: 0.915 },
    ]),
  );
});
