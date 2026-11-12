import type { Candle } from './types';

function validPeriod(period: number): number {
  if (!Number.isInteger(period) || period < 1) throw new Error('Indicator period must be a positive integer.');
  return period;
}

function validValues(values: number[]): void {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Indicator input contains a non-finite value.');
  }
}

function validCandle(candle: Candle): boolean {
  return Number.isFinite(candle.time) && candle.time > 0 &&
    Number.isFinite(candle.open) && Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) && Number.isFinite(candle.close) &&
    Number.isFinite(candle.volume) && candle.open > 0 && candle.high > 0 &&
    candle.low > 0 && candle.close > 0 && candle.volume >= 0 &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) && candle.high >= candle.low;
}

export function ema(values: number[], period: number): Array<number | null> {
  validPeriod(period);
  validValues(values);
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return result;
  const multiplier = 2 / (period + 1);
  let previous = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = previous;
  for (let i = period; i < values.length; i += 1) {
    previous = (values[i] - previous) * multiplier + previous;
    result[i] = previous;
  }
  return result;
}

export function sma(values: number[], period: number): Array<number | null> {
  validPeriod(period);
  validValues(values);
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

export function rsi(values: number[], period = 14): Array<number | null> {
  validPeriod(period);
  validValues(values);
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length <= period) return result;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const value = () => avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  result[period] = value();
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[i] = value();
  }
  return result;
}

export function atr(candles: Candle[], period = 14): Array<number | null> {
  validPeriod(period);
  if (candles.some((candle) => !validCandle(candle))) throw new Error('ATR input contains an invalid candle.');
  const result: Array<number | null> = Array(candles.length).fill(null);
  if (candles.length <= period) return result;
  const trueRanges = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  let current = trueRanges.slice(1, period + 1).reduce((sum, value) => sum + value, 0) / period;
  result[period] = current;
  for (let i = period + 1; i < candles.length; i += 1) {
    current = (current * (period - 1) + trueRanges[i]) / period;
    result[i] = current;
  }
  return result;
}

export interface MacdPoint { macd: number | null; signal: number | null; histogram: number | null }
export function macd(values: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MacdPoint[] {
  if (fastPeriod >= slowPeriod) throw new Error('MACD fast period must be smaller than slow period.');
  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);
  const line = values.map((_, index) => fast[index] === null || slow[index] === null ? null : (fast[index] as number) - (slow[index] as number));
  const firstValid = line.findIndex((value) => value !== null);
  const signalValues = firstValid < 0 ? [] : line.slice(firstValid).map((value) => value as number);
  const signalTail = ema(signalValues, signalPeriod);
  const signal: Array<number | null> = Array(values.length).fill(null);
  signalTail.forEach((value, index) => { signal[firstValid + index] = value; });
  return values.map((_, index) => ({
    macd: line[index],
    signal: signal[index],
    histogram: line[index] === null || signal[index] === null ? null : (line[index] as number) - (signal[index] as number),
  }));
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  returnPct: number;
}

export interface EquityPoint { time: number; equity: number }

export interface BacktestResult {
  trades: BacktestTrade[];
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  netReturnPct: number;
  expectancy: number;
  benchmarkReturnPct: number;
  exposurePct: number;
  equityCurve: EquityPoint[];
}

interface Position {
  entryFill: number;
  entryTime: number;
  entryCapital: number;
  entryFeeFactor: number;
}

/**
 * Long-only, fully invested, spot-style historical simulation.
 * Signals use a completed candle close and execute at the next candle open.
 * Entry/exit slippage and fee are applied on both sides. Incomplete candles are excluded.
 */
export function runEmaBacktest(
  inputCandles: Candle[],
  fastPeriod = 9,
  slowPeriod = 21,
  feeBps = 10,
  slippageBps = 5,
): BacktestResult | null {
  if (
    !Number.isInteger(fastPeriod) || !Number.isInteger(slowPeriod) ||
    !Number.isFinite(feeBps) || !Number.isFinite(slippageBps) ||
    fastPeriod < 2 || fastPeriod >= slowPeriod || slowPeriod > 250 ||
    feeBps < 0 || feeBps > 500 || slippageBps < 0 || slippageBps > 500
  ) return null;

  const candles = inputCandles.filter((candle) => candle.closed !== false);
  if (candles.some((candle) => !validCandle(candle))) return null;
  candles.sort((a, b) => a.time - b.time);
  if (candles.some((candle, index) => index > 0 && candle.time === candles[index - 1].time)) return null;
  if (candles.length < slowPeriod + 5) return null;
  const closes = candles.map((candle) => candle.close);
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const feeFactor = 1 - feeBps / 10_000;
  const entrySlipFactor = 1 + slippageBps / 10_000;
  const exitSlipFactor = 1 - slippageBps / 10_000;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let capital = 1;
  let position: Position | null = null;
  let pendingEntry = false;
  let pendingExit = false;
  let exposureBars = 0;
  let peak = 1;
  let maxDrawdown = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];

    if (pendingExit && position) {
      const exitFill = candle.open * exitSlipFactor;
      const netFactor = (exitFill / position.entryFill) * feeFactor * position.entryFeeFactor;
      const tradeReturn = (netFactor - 1) * 100;
      trades.push({ entryTime: position.entryTime, exitTime: candle.time, returnPct: tradeReturn });
      const pnl = position.entryCapital * (netFactor - 1);
      if (pnl > 0) grossProfit += pnl;
      else grossLoss += Math.abs(pnl);
      capital = position.entryCapital * netFactor;
      position = null;
      pendingExit = false;
    }

    if (pendingEntry && !position) {
      position = {
        entryFill: candle.open * entrySlipFactor,
        entryTime: candle.time,
        entryCapital: capital,
        entryFeeFactor: feeFactor,
      };
      pendingEntry = false;
    }

    let markedEquity = capital;
    if (position) {
      exposureBars += 1;
      // Mark the open position net of estimated exit slippage and fees as well as entry costs.
      markedEquity = position.entryCapital * (candle.close * exitSlipFactor / position.entryFill) * position.entryFeeFactor * feeFactor;
    }
    equityCurve.push({ time: candle.time, equity: markedEquity * 100 });
    peak = Math.max(peak, markedEquity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - markedEquity) / peak) * 100);

    if (i < candles.length - 1) {
      const currentFast = fast[i];
      const previousFast = fast[i - 1];
      const currentSlow = slow[i];
      const previousSlow = slow[i - 1];
      if (currentFast !== null && previousFast !== null && currentSlow !== null && previousSlow !== null) {
        const bullishCross = previousFast <= previousSlow && currentFast > currentSlow;
        const bearishCross = previousFast >= previousSlow && currentFast < currentSlow;
        if (!position && !pendingEntry && bullishCross) pendingEntry = true;
        else if (position && !pendingExit && bearishCross) pendingExit = true;
      }
    }
  }

  // Mark any remaining open position to the final completed close. This is a simulated liquidation.
  if (position) {
    const last = candles[candles.length - 1];
    const exitFill = last.close * exitSlipFactor;
    const netFactor = (exitFill / position.entryFill) * feeFactor * position.entryFeeFactor;
    const tradeReturn = (netFactor - 1) * 100;
    trades.push({ entryTime: position.entryTime, exitTime: last.time, returnPct: tradeReturn });
    const pnl = position.entryCapital * (netFactor - 1);
    if (pnl > 0) grossProfit += pnl;
    else grossLoss += Math.abs(pnl);
    capital = position.entryCapital * netFactor;
    const lastPoint = equityCurve[equityCurve.length - 1];
    if (lastPoint) lastPoint.equity = capital * 100;
  }

  const wins = trades.filter((trade) => trade.returnPct > 0);
  const benchmarkEntry = candles[0].open * entrySlipFactor;
  const benchmarkExit = candles[candles.length - 1].close * exitSlipFactor;
  const benchmarkReturnPct = ((benchmarkExit / benchmarkEntry) * feeFactor * feeFactor - 1) * 100;
  // Recompute close-to-close drawdown after any final-position liquidation adjustment.
  peak = 0;
  maxDrawdown = 0;
  for (const point of equityCurve) {
    const markedCapital = point.equity / 100;
    peak = Math.max(peak, markedCapital);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - markedCapital) / peak) * 100);
  }

  return {
    trades,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0) : grossProfit / grossLoss,
    maxDrawdown,
    netReturnPct: (capital - 1) * 100,
    expectancy: trades.length ? trades.reduce((sum, trade) => sum + trade.returnPct, 0) / trades.length : 0,
    benchmarkReturnPct,
    exposurePct: (exposureBars / candles.length) * 100,
    equityCurve,
  };
}
