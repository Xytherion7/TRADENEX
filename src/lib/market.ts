import type { Candle, Interval, StreamStatus, Ticker } from './types';

const BINANCE_REST = 'https://data-api.binance.vision';
const BINANCE_WS = 'wss://stream.binance.com:9443/ws/!miniTicker@arr';
const TWELVE_DATA = 'https://api.twelvedata.com';
const EXCLUDED_STABLE_PAIRS = new Set(['USDCUSDT', 'FDUSDUSDT', 'TUSDUSDT', 'USDPUSDT', 'DAIUSDT']);

async function getJson<T>(url: string, timeoutMs = 12_000): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'msg' in payload
        ? String((payload as { msg: unknown }).msg)
        : `HTTP ${response.status}`;
      throw new Error(`Market data request failed: ${message}`);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Market data request timed out. Check your connection and retry.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanCryptoSymbol(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function cleanStockSymbol(value: string): string {
  return value.toUpperCase().trim().replace(/[^A-Z0-9.-]/g, '').replace(/^[.-]+|[.-]+$/g, '');
}

function normalizeCandles(candles: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of candles) {
    if (
      !Number.isFinite(candle.time) || candle.time <= 0 ||
      !Number.isFinite(candle.open) || !Number.isFinite(candle.high) ||
      !Number.isFinite(candle.low) || !Number.isFinite(candle.close) ||
      !Number.isFinite(candle.volume) ||
      candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 ||
      candle.volume < 0 || candle.high < candle.low ||
      candle.high < Math.max(candle.open, candle.close) ||
      candle.low > Math.min(candle.open, candle.close)
    ) continue;
    byTime.set(candle.time, candle);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export async function fetchCryptoTickers(): Promise<Ticker[]> {
  const rows = await getJson<Array<Record<string, string>>>(`${BINANCE_REST}/api/v3/ticker/24hr`);
  const receivedAt = Date.now();
  return rows
    .filter((row) => row.symbol?.endsWith('USDT') && !EXCLUDED_STABLE_PAIRS.has(row.symbol))
    .map((row) => ({
      symbol: row.symbol,
      label: row.symbol.replace(/USDT$/, ''),
      market: 'crypto' as const,
      price: number(row.lastPrice),
      changePct: number(row.priceChangePercent),
      high24h: number(row.highPrice),
      low24h: number(row.lowPrice),
      volume: number(row.volume),
      quoteVolume: number(row.quoteVolume),
      updatedAt: receivedAt,
    }))
    .filter((item) => item.price > 0 && Number.isFinite(item.changePct))
    .sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
}

const binanceIntervals: Record<Interval, string> = {
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
};

export async function fetchCryptoCandles(symbol: string, interval: Interval): Promise<Candle[]> {
  const safeSymbol = cleanCryptoSymbol(symbol);
  if (!safeSymbol || !safeSymbol.endsWith('USDT')) throw new Error('Enter a valid USDT spot symbol.');
  const query = new URLSearchParams({ symbol: safeSymbol, interval: binanceIntervals[interval], limit: '500' });
  const rows = await getJson<unknown[][]>(`${BINANCE_REST}/api/v3/klines?${query.toString()}`);
  return normalizeCandles(rows.map((row) => ({
    time: Math.floor(number(row[0]) / 1000),
    open: number(row[1]),
    high: number(row[2]),
    low: number(row[3]),
    close: number(row[4]),
    volume: number(row[5]),
    closed: number(row[6]) < Date.now(),
  })));
}

interface TwelveQuote {
  symbol?: string;
  name?: string;
  currency?: string;
  close?: string;
  price?: string;
  percent_change?: string;
  change?: string;
  high?: string;
  low?: string;
  volume?: string;
  status?: string;
  message?: string;
  code?: number;
}

interface TwelveTimeSeries {
  values?: Array<Record<string, string>>;
  status?: string;
  message?: string;
  code?: number;
}

function assertTwelveData<T extends { status?: string; message?: string; code?: number }>(payload: T): T {
  if (payload.status === 'error' || payload.code) {
    throw new Error(payload.message || `Twelve Data error (${payload.code ?? 'unknown'})`);
  }
  return payload;
}

export async function fetchStockQuote(symbol: string, apiKey: string): Promise<Ticker> {
  if (!apiKey.trim()) throw new Error('Add a Twelve Data API key in Settings to load stock data.');
  const safeSymbol = cleanStockSymbol(symbol);
  if (!safeSymbol) throw new Error('Enter a valid stock symbol.');
  const query = new URLSearchParams({ symbol: safeSymbol, apikey: apiKey.trim() });
  const payload = assertTwelveData(await getJson<TwelveQuote>(`${TWELVE_DATA}/quote?${query.toString()}`));
  const price = number(payload.close ?? payload.price);
  if (!price) throw new Error(payload.message || `No quote returned for ${safeSymbol}.`);
  return {
    symbol: safeSymbol,
    label: safeSymbol,
    market: 'stock',
    currency: /^[A-Z]{3}$/.test((payload.currency ?? '').toUpperCase()) ? payload.currency!.toUpperCase() : undefined,
    price,
    changePct: number(payload.percent_change),
    high24h: number(payload.high),
    low24h: number(payload.low),
    volume: number(payload.volume),
    updatedAt: Date.now(),
  };
}

const twelveIntervals: Record<Interval, string> = {
  '15m': '15min',
  '1h': '1h',
  '4h': '4h',
  '1d': '1day',
  '1w': '1week',
};
const intervalSeconds: Record<Interval, number> = { '15m': 900, '1h': 3600, '4h': 14_400, '1d': 86_400, '1w': 604_800 };

export async function fetchStockCandles(symbol: string, interval: Interval, apiKey: string): Promise<Candle[]> {
  if (!apiKey.trim()) throw new Error('Add a Twelve Data API key in Settings to load stock charts.');
  const safeSymbol = cleanStockSymbol(symbol);
  if (!safeSymbol) throw new Error('Enter a valid stock symbol.');
  const query = new URLSearchParams({
    symbol: safeSymbol,
    interval: twelveIntervals[interval],
    outputsize: '500',
    order: 'ASC',
    timezone: 'UTC',
    apikey: apiKey.trim(),
  });
  const payload = assertTwelveData(await getJson<TwelveTimeSeries>(`${TWELVE_DATA}/time_series?${query.toString()}`));
  if (!payload.values?.length) throw new Error(payload.message || `No candles returned for ${safeSymbol}.`);
  const nowSeconds = Math.floor(Date.now() / 1000);
  return normalizeCandles(payload.values.map((row) => {
    const iso = row.datetime?.includes('T') ? row.datetime : row.datetime?.replace(' ', 'T');
    const timeMs = Date.parse(iso?.endsWith('Z') ? iso : `${iso}Z`);
    const time = Math.floor(timeMs / 1000);
    return {
      time,
      open: number(row.open),
      high: number(row.high),
      low: number(row.low),
      close: number(row.close),
      volume: number(row.volume),
      closed: time + intervalSeconds[interval] <= nowSeconds,
    };
  }));
}

export interface BinanceStreamController {
  close: () => void;
}

/**
 * Streams only changed 24h mini-tickers. A REST snapshot should be loaded first,
 * then these incremental updates are merged into that snapshot.
 */
export function connectBinanceTickerStream(
  onTickers: (updates: Ticker[]) => void,
  onStatus: (status: StreamStatus) => void,
): BinanceStreamController {
  let socket: WebSocket | null = null;
  let reconnectTimer = 0;
  let rotationTimer = 0;
  let retry = 0;
  let stopped = false;

  const connect = () => {
    if (stopped) return;
    onStatus(retry === 0 ? 'connecting' : 'reconnecting');
    try {
      socket = new WebSocket(BINANCE_WS);
    } catch {
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      retry = 0;
      onStatus('live');
      // Binance stream connections are time-limited; rotate before the 24h limit.
      window.clearTimeout(rotationTimer);
      rotationTimer = window.setTimeout(() => socket?.close(1000, 'Scheduled connection rotation'), 23 * 60 * 60 * 1000 + 50 * 60 * 1000);
    };

    socket.onmessage = (event) => {
      try {
        const rows = JSON.parse(String(event.data)) as Array<Record<string, string>>;
        if (!Array.isArray(rows)) return;
        const receivedAt = Date.now();
        const updates = rows
          .filter((row) => row.s?.endsWith('USDT') && !EXCLUDED_STABLE_PAIRS.has(row.s))
          .map((row) => {
            const price = number(row.c);
            const open = number(row.o);
            return {
              symbol: row.s,
              label: row.s.replace(/USDT$/, ''),
              market: 'crypto' as const,
              price,
              changePct: open > 0 ? ((price - open) / open) * 100 : 0,
              high24h: number(row.h),
              low24h: number(row.l),
              volume: number(row.v),
              quoteVolume: number(row.q),
              updatedAt: receivedAt,
            } satisfies Ticker;
          })
          .filter((item) => item.price > 0);
        if (updates.length) onTickers(updates);
      } catch {
        // Ignore malformed payloads; the REST fallback remains available.
      }
    };

    socket.onerror = () => socket?.close();
    socket.onclose = () => {
      window.clearTimeout(rotationTimer);
      if (!stopped) scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    retry += 1;
    onStatus(retry > 5 ? 'offline' : 'reconnecting');
    const delay = Math.min(30_000, 1_000 * (2 ** Math.min(retry - 1, 5)));
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = 0;
      connect();
    }, delay);
  };

  connect();
  return {
    close: () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(rotationTimer);
      socket?.close(1000, 'Application cleanup');
      socket = null;
    },
  };
}

export const DEFAULT_CRYPTO_WATCHLIST = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
export const DEFAULT_STOCK_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'GOOGL'];

export function formatPrice(value: number, market: 'crypto' | 'stock' = 'crypto', currency?: string): string {
  if (!Number.isFinite(value) || value <= 0) return '—';
  const digits = value >= 1000 ? 2 : value >= 1 ? 2 : value >= 0.01 ? 4 : 6;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: value >= 1000 ? 2 : 0,
    maximumFractionDigits: digits,
    style: 'decimal',
  }).format(value);
  if (market === 'crypto') return `${formatted} USDT`;
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined;
  if (!code) return formatted;
  return code === 'USD' ? `$${formatted}` : `${code} ${formatted}`;
}

export function formatCompact(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}
