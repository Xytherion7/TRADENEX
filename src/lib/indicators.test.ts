import { describe, expect, it } from 'vitest';
import { atr, ema, macd, rsi, runEmaBacktest } from './indicators';
import { buildMarketBrief } from './intelligence';
import { formatPrice } from './market';
import type { Candle } from './types';

function candle(time: number, close: number, closed = true): Candle {
  return {
    time,
    open: close * 0.995,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 100 + (time % 17),
    closed,
  };
}

function sampleCandles(count = 160): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.08 + Math.sin(index / 5) * 4 + Math.sin(index / 13) * 2;
    return candle(1_700_000_000 + index * 3_600, close);
  });
}

describe('technical indicators', () => {
  it('seeds EMA with the first-period SMA', () => {
    expect(ema([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
  });

  it('returns neutral RSI for a perfectly flat series', () => {
    expect(rsi([10, 10, 10, 10, 10], 2).at(-1)).toBe(50);
  });

  it('returns 100 for a strictly rising sample and 0 for a falling sample', () => {
    expect(rsi([1, 2, 3, 4, 5], 2).at(-1)).toBe(100);
    expect(rsi([5, 4, 3, 2, 1], 2).at(-1)).toBe(0);
  });

  it('calculates ATR and MACD with aligned output lengths', () => {
    const candles = sampleCandles(80);
    expect(atr(candles, 14)).toHaveLength(candles.length);
    expect(macd(candles.map((item) => item.close)).at(-1)?.histogram).toEqual(expect.any(Number));
  });

  it('rejects invalid periods and non-finite inputs', () => {
    expect(() => ema([1, 2], 0)).toThrow();
    expect(() => rsi([1, 2], -1)).toThrow();
    expect(() => atr(sampleCandles(10), 1.5)).toThrow();
    expect(() => ema([1, Number.NaN, 2], 2)).toThrow();
    expect(() => rsi([1, Number.POSITIVE_INFINITY, 2], 2)).toThrow();
  });

  it('rejects malformed OHLC bars from the ATR calculation', () => {
    const invalid = sampleCandles(20);
    invalid[10] = { ...invalid[10], high: invalid[10].close * 0.5 };
    expect(() => atr(invalid, 14)).toThrow();
  });
});

describe('historical simulation', () => {
  it('ignores an unfinished final candle', () => {
    const candles = sampleCandles();
    const completedOnly = runEmaBacktest(candles, 9, 21, 10, 5);
    const withUnfinishedSpike = runEmaBacktest([...candles, candle(1_700_000_000 + candles.length * 3_600, 999, false)], 9, 21, 10, 5);
    expect(withUnfinishedSpike).toEqual(completedOnly);
  });

  it('returns null for insufficient history, invalid parameters or malformed bars', () => {
    expect(runEmaBacktest(sampleCandles(15), 9, 21)).toBeNull();
    expect(runEmaBacktest(sampleCandles(), 21, 9)).toBeNull();
    const invalid = sampleCandles();
    invalid[12] = { ...invalid[12], low: invalid[12].close * 2 };
    expect(runEmaBacktest(invalid, 9, 21)).toBeNull();
  });

  it('sorts valid candles chronologically and rejects duplicate timestamps', () => {
    const candles = sampleCandles();
    const ordered = runEmaBacktest(candles, 9, 21);
    const shuffled = runEmaBacktest([...candles].reverse(), 9, 21);
    expect(shuffled).toEqual(ordered);
    expect(runEmaBacktest([...candles, candles[20]], 9, 21)).toBeNull();
  });

  it('applies transaction costs to the buy-and-hold baseline', () => {
    const rising = Array.from({ length: 90 }, (_, index) => candle(1_700_000_000 + index * 3_600, 50 + index));
    const free = runEmaBacktest(rising, 9, 21, 0, 0);
    const costly = runEmaBacktest(rising, 9, 21, 25, 10);
    expect(free).not.toBeNull();
    expect(costly).not.toBeNull();
    expect(costly!.benchmarkReturnPct).toBeLessThan(free!.benchmarkReturnPct);
  });

  it('produces a reproducible equity curve and bounded drawdown', () => {
    const result = runEmaBacktest(sampleCandles(), 9, 21, 10, 5);
    expect(result).not.toBeNull();
    expect(result!.equityCurve).toHaveLength(160);
    expect(result!.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(result!.maxDrawdown).toBeLessThan(100);
  });
});

describe('market intelligence brief', () => {
  it('does not classify a short history', () => {
    const brief = buildMarketBrief('BTCUSDT', '1h', sampleCandles(30));
    expect(brief.classification).toBe('Insufficient history');
    expect(brief.metrics).toHaveLength(0);
  });

  it('returns transparent evidence for a sufficiently long history', () => {
    const brief = buildMarketBrief('BTCUSDT', '1h', sampleCandles(80));
    expect(brief.metrics).toHaveLength(6);
    expect(brief.evidence.length).toBeGreaterThan(2);
    expect(brief.cautions.length).toBeGreaterThan(0);
  });
});


describe('market value formatting', () => {
  it('keeps stock quote currencies explicit', () => {
    expect(formatPrice(123.45, 'stock', 'USD')).toBe('$123.45');
    expect(formatPrice(123.45, 'stock', 'EUR')).toBe('EUR 123.45');
    expect(formatPrice(123.45, 'stock')).toBe('123.45');
    expect(formatPrice(123.45, 'crypto')).toBe('123.45 USDT');
  });
});
